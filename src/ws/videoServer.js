/**
 * Claide Bot by Alfi
 * src/ws/videoServer.js — WebSocket media proxy KHUSUS VIDEO
 *
 * Kenapa endpoint video harus terpisah dari /wss/audio:
 *   1. Link CDN dari j2download membawa token berumur pendek (unix ts +
 *      signature). Kalau link itu dikirim ke klien lalu dipakai beberapa
 *      menit kemudian, upstream balas 403 "invalid or expired token" → WS
 *      ditutup dengan kode 1005 dan user cuma lihat "gagal koneksi". Di sini
 *      link baru diselesaikan SETIAP koneksi masuk, jadi tidak pernah ada
 *      link basi yang dikirim ke klien.
 *   2. Video jauh lebih besar dari audio: butuh batas ukuran, potong durasi,
 *      transcode ke profil yang bisa diputar webview WhatsApp, plus laporan
 *      progres. Semua itu nggak relevan untuk audio.
 *
 * Protokol (dibaca player video di feat/downloader/play2.js):
 *   S→C JSON {type:'progress', phase, message, ...}
 *   S→C JSON {type:'start', mime, contentLength, quality, title, duration}
 *   S→C binary chunks
 *   S→C JSON {type:'end'} | {type:'error', message}
 *
 * Query params:
 *   url       (wajib) URL YouTube (watch / shorts / youtu.be)
 *   quality   default 360 — tinggi yang DICITA, otomatis diturunkan jika gagal
 *   start     default 0   — potong dari detik ini
 *   limit     default PLAY2_VIDEO_MAX_SECONDS
 *   maxbytes  default PLAY2_VIDEO_MAX_BYTES
 *   token     wajib kalau server dijalankan dengan token
 */

import { registerWsRoute } from './wsRoutes.js'
import { createReadStream, createWriteStream } from 'node:fs'
import { readFile, mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { URL } from 'node:url'
import { resolveDownload, detect } from '../../lib/j2download.js'
import { assertPublicHttpUrl } from '../../lib/urlSafety.js'

// Batas keras per koneksi supaya endpoint ini tidak jadi amplifier.
const MAX_DOWNLOAD_BYTES = Number(process.env.PLAY2_VIDEO_MAX_DOWNLOAD_BYTES || 160 * 1024 * 1024)
const DOWNLOAD_TIMEOUT_MS = Number(process.env.PLAY2_VIDEO_DOWNLOAD_TIMEOUT_MS || 180_000)
const FFMPEG_TIMEOUT_MS = Number(process.env.PLAY2_VIDEO_FFMPEG_TIMEOUT_MS || 240_000)
const MAX_QUALITY = 1080

// Webview WhatsApp menahan video ini di memory sebelum diputar, jadi ini bukan
// cuma batas transfer — inilah batas yang bikin player tidak freeze di HP lama.
const DEFAULT_MAX_BYTES = Number(process.env.PLAY2_VIDEO_MAX_BYTES || 20 * 1024 * 1024)
const DEFAULT_MAX_SECONDS = Number(process.env.PLAY2_VIDEO_MAX_SECONDS || 180)
const TARGET_FPS = Number(process.env.PLAY2_VIDEO_FPS || 24)
const CRF = Number(process.env.PLAY2_VIDEO_CRF || 30)
const AUDIO_KBPS = 48
const WS_BACKPRESSURE_BYTES = 4 * 1024 * 1024

// pickMedia() mengembalikan kualitas paling rendah kalau tidak ada exact match,
// jadi urutan naik dari target: coba target dulu, baru naik kalau tidak ada.
const QUALITY_LADDER = [144, 240, 360, 480, 720, 1080]

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'

function safeSend(ws, payload) {
  if (ws.readyState !== 1) return false
  try {
    ws.send(payload)
    return true
  } catch {
    return false
  }
}

function sendJson(ws, payload) {
  return safeSend(ws, JSON.stringify(payload))
}

/**
 * Batasi angka dari query string. Nilai kosong/kosong string harus kembali ke
 * fallback — Number(null) = 0 yang masih finite, jadi tanpa cek eksplisit
 * "tidak dikirim" akan tertangkap sebagai 0 dan dijepit ke batas bawah.
 */
function clamp(value, min, max, fallback) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

/** Turunkan 360 → 240 → 144 dulu; kalau habis, naikkan ke 480/720/1080. */
function qualityLadder(requested) {
  const want = clamp(requested, 144, MAX_QUALITY, 360)
  const lower = QUALITY_LADDER.filter((q) => q <= want).reverse()
  const higher = QUALITY_LADDER.filter((q) => q > want)
  return [...lower, ...higher]
}

function tokenMatches(expected, given) {
  const a = Buffer.from(String(given ?? ''))
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function isYouTubeUrl(value) {
  try {
    const host = new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '')
    return (
      host === 'youtu.be' ||
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com'
    )
  } catch {
    return false
  }
}

/**
 * Resolve link video dari link YouTube. Sengaja dipanggil per koneksi: token
 * upstream berumur hitungan detik, jadi link yang dipakai pasti masih hidup.
 */
async function resolveFreshMedia(url, requestedQuality, { onProgress } = {}) {
  const tried = []
  let detected = null

  for (const quality of qualityLadder(requestedQuality)) {
    try {
      const info = await resolveDownload(url, String(quality))
      if (!info?.downloadUrl) throw new Error('tidak ada link download')
      if (!detected) detected = await detect(url).catch(() => null)
      onProgress?.({ phase: 'resolved', message: `Link ${info.quality || quality} siap` })
      return { info, meta: detected }
    } catch (error) {
      tried.push(`${quality}p: ${String(error?.message || error).slice(0, 70)}`)
    }
  }

  throw new Error(`semua kualitas gagal (${tried.join(' | ').slice(0, 240)})`)
}

/** Unduh media ke disk dengan batas ukuran dan timeout. */
async function downloadToDisk(url, directory, { onProgress } = {}) {
  let current = await assertPublicHttpUrl(url)
  let response = null

  for (let hop = 0; hop <= 3; hop++) {
    response = await fetch(current, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      redirect: 'manual',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    if (response.status < 300 || response.status >= 400) break
    const location = response.headers.get('location')
    if (!location) throw new Error('redirect tanpa tujuan')
    current = await assertPublicHttpUrl(new URL(location, current))
  }

  if (!response?.ok || !response.body) {
    throw new Error(`upstream menolak (HTTP ${response?.status ?? 'unknown'})`)
  }

  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_DOWNLOAD_BYTES) {
    throw new Error(`ukuran video ${Math.round(declared / 1048576)} MB melebihi batas`)
  }

  const target = join(directory, 'source.bin')
  const out = createWriteStream(target)
  const reader = response.body.getReader()
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_DOWNLOAD_BYTES) throw new Error('video melebihi batas ukuran unduhan')
      if (!out.write(Buffer.from(value))) {
        await new Promise((resolve) => out.once('drain', resolve))
      }
      onProgress?.({ phase: 'downloading', received: total, total: declared || 0 })
    }
  } finally {
    await new Promise((resolve) => out.end(resolve))
  }

  if (!total) throw new Error('upstream kirim 0 byte')
  return { path: target, bytes: total }
}

function probeDurationSec(path) {
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    let ff
    try {
      ff = spawn('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path,
      ])
    } catch {
      return done(0)
    }

    const timer = setTimeout(() => {
      try { ff.kill('SIGKILL') } catch {}
      done(0)
    }, 20_000)

    ff.stdout.on('data', (chunk) => { out += chunk })
    ff.on('error', () => { clearTimeout(timer); done(0) })
    ff.on('close', () => {
      clearTimeout(timer)
      const value = Number.parseFloat(out.trim())
      done(Number.isFinite(value) && value > 0 ? value : 0)
    })
  })
}

function runFfmpeg(inputPath, outputPath, args, { timeoutMs = FFMPEG_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let stderr = ''
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }

    const proc = spawn(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath, ...args, outputPath],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    )

    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      finish(new Error('FFmpeg timeout'))
    }, timeoutMs)

    proc.stderr.on('data', (chunk) => {
      if (stderr.length < 8000) stderr += chunk.toString().slice(0, 8000 - stderr.length)
    })
    proc.on('error', (error) => finish(new Error(`FFmpeg gagal dijalankan: ${error.message}`)))
    proc.on('close', (code) => {
      if (code === 0) finish()
      else finish(new Error(`FFmpeg error (${code}): ${stderr.slice(-400)}`))
    })
  })
}

/** Bitrate video supaya total file muat di maxBytes. */
function targetVideoKbps({ maxBytes, seconds, audioKbps = AUDIO_KBPS }) {
  const budgetBits = maxBytes * 8 * 0.88 // sisakan ruang untuk container + audio
  const usable = Math.max(24_000, budgetBits - audioKbps * 1000)
  const perSecond = usable / Math.max(1, seconds)
  return Math.round(Math.max(80, Math.min(1600, perSecond / 1000)))
}

/**
 * Berapa detik video yang muat di maxBytes pada bitrate tertentu.
 *
 * Dipakai karena ada lantai bitrate 80 kbps: 80 kbps * 180 detik = 1.8 MB,
 * jadi untuk maxBytes kecil (mis. 1.2 MB untuk webview) TIDAK mungkin voxels
 *-Identifier video 180 detik muat hanya dengan turunkan bitrate. Satu-satunya
 * cara yang benar adalah ALSO memotong durasi. Tanpa ini server diam-diam
 * mengembalikan file 2.6 MB untuk permintaan maxbytes=1.2MB, dan webview
 * kehabisan RAM.
 */
function secondsThatFit(maxBytes, kbps, audioKbps = AUDIO_KBPS) {
  const bytesPerSecond = ((kbps + audioKbps) * 1000) / 8
  return Math.max(3, Math.floor((maxBytes * 0.92) / bytesPerSecond))
}

/**
 * Potong + transcode ke MP4 (H.264 baseline + AAC). Baseline profile supaya
 * decoder webview di Android lama tidak menolaknya; selalu ada audio track
 * supaya mode video tetap punya suara.
 */
async function transcodeVideo(sourcePath, directory, { startSec, limitSec, maxBytes, outputPath }) {
  const probed = await probeDurationSec(sourcePath)
  const effectiveStart = Math.max(0, startSec)
  const limit = limitSec > 0 ? limitSec : DEFAULT_MAX_SECONDS
  const remaining = probed > 0 ? Math.max(1, probed - effectiveStart) : limit

  // Hitung bitrate untuk durasi yang diminta dulu; kalau hasilnya tidak muat,
  // potong durasi sampai muat pada bitrate lantai 80 kbps.
  let seconds = Math.max(1, Math.min(limit, remaining))
  const kbps = targetVideoKbps({ maxBytes, seconds })
  const maxSecondsAtFloor = secondsThatFit(maxBytes, 80)
  if (seconds > maxSecondsAtFloor) {
    seconds = maxSecondsAtFloor
  }
  // Caller boleh menunjuk file sendiri supaya hasilnya bisa masuk cache.
  const target = outputPath ?? join(directory, 'output.mp4')

  const buildArgs = (videoKbps) => [
    '-ss', effectiveStart.toFixed(2),
    '-t', seconds.toFixed(2),
    '-vf', `fps=${TARGET_FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-profile:v', 'baseline',
    '-level', '3.1',
    '-pix_fmt', 'yuv420p',
    '-crf', String(CRF),
    '-maxrate', `${videoKbps}k`,
    '-bufsize', `${videoKbps * 2}k`,
    '-c:a', 'aac',
    '-b:a', `${AUDIO_KBPS}k`,
    '-ac', '2',
    '-movflags', '+faststart',
    '-f', 'mp4',
  ]

  await runFfmpeg(sourcePath, target, buildArgs(kbps))
  let size = (await stat(target)).size
  let usedKbps = kbps

  // Masih lebih besar dari batas walau hitung-hitungan sudah maksa: turunkan.
  if (size > maxBytes && kbps > 90) {
    usedKbps = Math.max(90, Math.floor(kbps * (maxBytes / size) * 0.85))
    await runFfmpeg(sourcePath, target, buildArgs(usedKbps))
    size = (await stat(target)).size
  }

  if (!size) throw new Error('hasil transcode kosong')
  return { path: target, file: target, bytes: size, durationSec: seconds, videoKbps: usedKbps }
}

/** Kirim file lewat WS dengan disiplin backpressure supaya tidak menumpuk. */
async function streamFile(ws, path, isCancelled) {
  for await (const chunk of createReadStream(path, { highWaterMark: 128 * 1024 })) {
    if (isCancelled() || ws.readyState !== 1) return false
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const flushed = new Promise((resolve) => {
      if (!ws.send(buf, () => resolve())) resolve()
    })
    await flushed
    while (!isCancelled() && ws.bufferedAmount > WS_BACKPRESSURE_BYTES && ws.readyState === 1) {
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
  }
  return true
}

/**
 * Cache hasil transcode di disk.
 *
 * Kenapa perlu: bagian yang paling lambat bukan transfer, tapi resolve link
 * YouTube (30–100 detik diuji) plus ffmpeg. Video yang sama sering dibuka
 * berulang (undo, buka lagi, share ke 2 orang), jadi menyimpan file MP4
 * yang sudah jadi membuat request kedua+ jadi instan.
 *
 * Aman dipakai ulang: output-nya deterministik untuk key yang sama, dan file
 * hanya dibaca sendiri — tidak ada proses lain yang menulis ulang file itu.
 */
const CACHE_DIR = process.env.PLAY2_VIDEO_CACHE_DIR || join(tmpdir(), 'claide-video-cache')
const CACHE_TTL_MS = Number(process.env.PLAY2_VIDEO_CACHE_TTL_MS || 30 * 60 * 1000)
const CACHE_MAX_ENTRIES = 24
const cache = new Map() // key -> { file, bytes, durationSec, quality, expiresAt }
const inflight = new Map() // key -> Promise (anti stampede)

function cacheKey(options) {
  return crypto
    .createHash('sha1')
    .update(
      [
        options.url,
        options.quality,
        options.startSec,
        options.limitSec,
        options.maxBytes,
        CRF,
        TARGET_FPS,
      ].join('|')
    )
    .digest('hex')
}

async function readCache(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() > hit.expiresAt) {
    cache.delete(key)
    await rm(hit.file, { force: true }).catch(() => {})
    return null
  }
  // Refresh posisi LRU.
  cache.delete(key)
  cache.set(key, hit)
  const size = await stat(hit.file).then((s) => s.size).catch(() => 0)
  if (!size) {
    cache.delete(key)
    return null
  }
  return { ...hit, bytes: size }
}

async function writeCache(key, file, meta) {
  const entry = {
    file,
    bytes: meta.bytes,
    durationSec: meta.durationSec,
    quality: meta.quality,
    expiresAt: Date.now() + CACHE_TTL_MS,
  }
  cache.set(key, entry)
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    const gone = cache.get(oldest)
    cache.delete(oldest)
    if (gone && gone.file !== file) await rm(gone.file, { force: true }).catch(() => {})
  }
  return entry
}

/** Batasi jumlah proses encode yang jalan bersamaan (ffmpeg itu mahal). Sisanya antre. */
const MAX_CONCURRENT = Number(process.env.PLAY2_VIDEO_MAX_CONCURRENT || 2)
let active = 0
const waiters = []

/**
 * Broadcast progres ke semua penunggu satu job.
 *
 * Map ini wajib ada: `buildVideo` menerima satu callback `emit`, dan kalau 3
 * orang membuka video yang sama, hanya yang memulai yang dapat update progres.
 * Tanpa ini penunggu lama hanya diam sampai job selesai.
 */
const subsByJob = new Map()

async function withSlot(fn) {
  if (active >= MAX_CONCURRENT) {
    await new Promise((resolve) => waiters.push(resolve))
  }
  active += 1
  try {
    return await fn()
  } finally {
    active -= 1
    const next = waiters.shift()
    if (next) next()
  }
}

/**
 * Satu siklus: resolve link segar → unduh → transcode → stream.
 * Cache dicek dulu supaya request berulang tidak resolve YouTube lagi.
 * Semua error dikembalikan sebagai pesan supaya klien bisa menampilkannya.
 */
async function serveVideo(ws, options, isCancelled) {
  const key = cacheKey(options)
  const notify = (payload) => {
    if (!isCancelled()) sendJson(ws, payload)
  }

  const cached = await readCache(key)
  if (cached) {
    notify({
      type: 'start',
      mime: 'video/mp4',
      contentLength: cached.bytes,
      quality: cached.quality,
      title: '',
      duration: Number(cached.durationSec.toFixed(2)),
      cached: true,
    })
    const delivered = await streamFile(ws, cached.file, isCancelled)
    if (delivered) sendJson(ws, { type: 'end', bytes: cached.bytes })
    return
  }

  // Satu proses untuk satu key: 3 orang buka video yang sama = 1 resolve.
  // Semua yang menunggu tetap dapat progres karena job di-broadcast ke semua
  // subscriber-nya, bukan cuma yang memulai.
  let job = inflight.get(key)
  if (!job) {
    const subscribers = new Set()
    subscribers.add(notify)
    job = withSlot(() =>
      buildVideo(key, options, (payload) => {
        for (const send of subscribers) send(payload)
      })
    ).finally(() => {
      subscribers.clear()
      subsByJob.delete(job)
      inflight.delete(key)
    })
    inflight.set(key, job)
    subsByJob.set(job, subscribers)
  } else {
    // Penunggu lama: daftarkan agar tetap dapat update progres.
    subsByJob.get(job)?.add(notify)
  }

  notify({ type: 'progress', phase: 'resolving', message: 'Mencari link video...' })

  const output = await job
  notify({
    type: 'start',
    mime: 'video/mp4',
    contentLength: output.bytes,
    quality: output.quality,
    title: output.title,
    duration: Number(output.durationSec.toFixed(2)),
    videoKbps: output.videoKbps,
  })

  const delivered = await streamFile(ws, output.file, isCancelled)
  if (!delivered) return
  sendJson(ws, { type: 'end', bytes: output.bytes })
}

/**
 * Bangun file MP4 untuk satu key: resolve link segar, unduh, transcode, lalu
 * simpan ke cache. Dipisah dari serveVideo supaya bisa dipakai ulang oleh
 * request lain yang menunggu job yang sama.
 */
async function buildVideo(key, options, onProgress = () => {}) {
  await mkdir(CACHE_DIR, { recursive: true }).catch(() => {})
  const file = join(CACHE_DIR, `${key}.mp4`)
  const workdir = await mkdtemp(join(tmpdir(), 'claide-video-'))

  try {
    onProgress({ type: 'progress', phase: 'resolving', message: 'Mencari link video...' })

    const { info, meta } = await resolveFreshMedia(options.url, options.quality, { onProgress })

    onProgress({
      type: 'progress',
      phase: 'downloading',
      message: `Mengunduh ${info.quality || options.quality}p...`,
    })
    const { path: sourcePath, bytes } = await downloadToDisk(info.downloadUrl, workdir, {
      onProgress,
    })

    onProgress({
      type: 'progress',
      phase: 'encoding',
      message: 'Mengolah video...',
      sourceBytes: bytes,
    })
    const output = await transcodeVideo(sourcePath, workdir, { ...options, outputPath: file })
    await writeCache(key, file, {
      bytes: output.bytes,
      durationSec: output.durationSec,
      quality: info.quality || String(options.quality),
    })

    return { ...output, file, quality: info.quality || String(options.quality), title: info.title || meta?.title || '' }
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Ambil file MP4 dari cache kalau sudah ada, sebagai Buffer.
 *
 * Dipakai play2 untuk mengirim video sebagai `videoMessage` native WhatsApp,
 * bukan lewat Blob di dalam webview. Alasan: webview WhatsApp mengunduh
 * seluruh video ke RAM sebelum diputar, jadi file 3 MB yang aman di WS tetap
 * bisa memicu OutOfMemoryError di Android kelas bawah — dan itu muncul
 * sebagai "Video tidak bisa diputar", bukan sebagai OOM. File native dikirim
 * lewat media pipeline WA yang sama seperti audio, jadi tidak ada buffer
 * besar di sisi client sama sekali.
 *
 * @returns {Promise<Buffer|null>} null kalau belum ada di cache.
 */
export async function getCachedVideoBuffer(url, quality, { limitSec, maxBytes, startSec = 0 } = {}) {
  const options = {
    url: String(url),
    quality: clamp(quality, 144, MAX_QUALITY, 360),
    startSec: clamp(startSec, 0, 3600, 0),
    limitSec: clamp(limitSec, 0, 3600, DEFAULT_MAX_SECONDS),
    maxBytes: clamp(maxBytes, 512 * 1024, MAX_DOWNLOAD_BYTES, DEFAULT_MAX_BYTES),
  }
  const hit = await readCache(cacheKey(options))
  if (!hit) return null
  try {
    return await readFile(hit.file)
  } catch {
    return null
  }
}

/**
 * Trigger pembuatan file video di latar belakang, tanpa menunggu.
 *
 * Dipanggil play2 saat menangani `.play2 <judul> video`: pada saat itu kita
 * SUDAH tahu judulnya, jadi kerja berat (resolve link YouTube = 30–100 detik,
 * unduh, ffmpeg) bisa jalan sebelum user mengetuk ▶ di player. Waktu player
 * dibuka, WS-nya hanya perlu mengirim file dari cache — instan.
 *
 * Sengaja tidak di-await dan tidak melempar error: pemanggil ada di jalur
 * respons command dan tidak boleh ikut lambat/gagal karena pemrosesan video.
 *
 * @returns {{ done: Promise, cached: () => boolean }}
 */
export function prewarmVideo(url, quality, { limitSec, maxBytes, startSec = 0 } = {}) {
  const options = {
    url: String(url),
    quality: clamp(quality, 144, MAX_QUALITY, 360),
    startSec: clamp(startSec, 0, 3600, 0),
    limitSec: clamp(limitSec, 0, 3600, DEFAULT_MAX_SECONDS),
    maxBytes: clamp(maxBytes, 512 * 1024, MAX_DOWNLOAD_BYTES, DEFAULT_MAX_BYTES),
  }
  const key = cacheKey(options)

  const done = (async () => {
    if (await readCache(key)) return { cached: true }
    let job = inflight.get(key)
    if (!job) {
      job = withSlot(() => buildVideo(key, options, () => {})).finally(() => {
        inflight.delete(key)
      })
      inflight.set(key, job)
    }
    return job
  })()

  // Cegah unhandled rejection: kegagalan prewarm dicatat, bukan dilempar.
  done.catch((error) => {
    console.log(`[MediaWS:video] prewarm gagal: ${error?.message || error}`)
  })

  return {
    done,
    cached: async () => Boolean(await readCache(key)),
  }
}

/**
 * Pasang handler video di SUDAH ADA HTTP server milik mediaServer.
 *
 * Kenapa Attach, bukan server sendiri: tunnel Cloudflare yang menjangkau bot
 * cuma mem-forward SATU port (8090 untuk /wss/audio). Dulu video_tab-dilayani
 * di port 8091 terpisah, jadi request dari webview WhatsApp tidak pernah sampai
 * — player-nya menampilkan OFFLINE. Satu port dengan dua path WS fixes itu
 * tanpa mengubah Infrastruktur/tunnel sama sekali.
 */
export function attachVideoWsServer({ server, path = process.env.WS_VIDEO_PATH || '/wss/video', token } = {}) {
  const expectedToken = token || process.env.MEDIA_WS_VIDEO_TOKEN || process.env.MEDIA_WS_TOKEN || ''
  const wss = registerWsRoute(server, { path }).wss

  wss.on('connection', (ws, req) => {
    const params = new URL(req.url, 'http://localhost').searchParams

    // Token dicek sebelum apa pun. Tanpa ini endpoint ini open proxy.
    if (expectedToken) {
      const given = params.get('token') || req.headers['x-media-token']
      if (!tokenMatches(expectedToken, given)) {
        console.log('[MediaWS:video] reject: bad/missing token')
        ws.close(4003, 'unauthorized')
        return
      }
    }

    const url = params.get('url')
    if (!url || !isYouTubeUrl(url)) {
      console.log('[MediaWS:video] reject: url wajib YouTube')
      sendJson(ws, { type: 'error', message: 'Parameter url harus link YouTube' })
      ws.close(4001, 'invalid url')
      return
    }

    const options = {
      url: String(url),
      quality: clamp(params.get('quality'), 144, MAX_QUALITY, 360),
      startSec: clamp(params.get('start'), 0, 3600, 0),
      limitSec: clamp(params.get('limit'), 0, 3600, DEFAULT_MAX_SECONDS),
      maxBytes: clamp(params.get('maxbytes'), 512 * 1024, MAX_DOWNLOAD_BYTES, DEFAULT_MAX_BYTES),
    }

    console.log(
      `[MediaWS:video] connect | q=${options.quality}p start=${options.startSec}s ` +
      `limit=${options.limitSec}s max=${Math.round(options.maxBytes / 1048576)}MB`
    )

    let cancelled = false
    ws.on('close', () => { cancelled = true })
    ws.on('error', () => { cancelled = true })

    serveVideo(ws, options, () => cancelled).catch((error) => {
      console.log('[MediaWS:video] error:', error?.message || error)
      if (!cancelled) {
        sendJson(ws, { type: 'error', message: String(error?.message || error).slice(0, 200) })
        try { ws.close(1011, 'stream failed'); } catch {}
      }
    })
  })

  console.log(
    `[MediaWS:video] menempel di port media` +
    ` ${path} (maks ${Math.round(DEFAULT_MAX_BYTES / 1048576)}MB / ${DEFAULT_MAX_SECONDS}s)` +
    (expectedToken ? ' (token wajib)' : ' (TANPA token — jangan terekspos publik)')
  )

  return { wss }
}
