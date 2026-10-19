
/**
 * Claide Bot by Alfi
 * Ported from j2download-engine.js. Downloads YouTube media without an API key.
 *
 * Flow: GET homepage -> parse window.__BOOTSTRAP__ -> proof-of-work (SHA-256,
 * leading zero nibbles) -> POST /api/auth/issue -> POST /api/autolink ->
 * SSE progress (cdn-ytb) -> direct CDN download URL.
 * Auth (cookie + token) is cached briefly so repeated downloads skip the PoW.
 */
import crypto from 'node:crypto'

const ORIGIN = 'https://j2download.com'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'

const AUTH_TTL_MS = 4 * 60 * 1000
const MAX_POW_ITERATIONS = 100_000_000

let sessionPromise = null
let cachedAuth = null // { accessToken, cookie, expiresAt }

// ============ PROOF OF WORK ============

function hasLeadingZeroNibbles(bytes, difficulty) {
  const fullBytes = Math.floor(difficulty / 2)
  const hasHalf = difficulty % 2 === 1
  for (let i = 0; i < fullBytes; i++) {
    if (bytes[i] !== 0) return false
  }
  if (hasHalf && (bytes[fullBytes] & 0xf0) !== 0) return false
  return true
}

async function solveSinglePow(challengeType, challenge, nonce, difficulty) {
  const prefix = challengeType === 'alt' ? `pow:${nonce}:` : `pow:${challenge}:`
  const suffix = challengeType === 'alt' ? `:${challenge}` : `:${nonce}:${challenge.length}`
  for (let n = 0; n < MAX_POW_ITERATIONS; n++) {
    // Yield periodically so the mining loop never freezes the bot's event loop.
    if (n > 0 && n % 50_000 === 0) await new Promise((resolve) => setImmediate(resolve))
    const hash = crypto.createHash('sha256').update(prefix + String(n) + suffix, 'utf8').digest()
    if (hasLeadingZeroNibbles(hash, difficulty)) return String(n)
  }
  throw new Error('Solusi proof-of-work tidak ditemukan (batas iterasi tercapai).')
}

function deriveAltChallenge(challenge, nonce, solution) {
  return crypto
    .createHash('sha256')
    .update(`pow:alt:${challenge}:${nonce}:${solution}`, 'utf8')
    .digest()
    .subarray(0, 16)
    .toString('hex')
}

async function solvePow(bootstrap) {
  const nonce = bootstrap?.nonce
  const challenge = bootstrap?.powChallenge
  const challengeType = bootstrap?.challengeType || 'std'
  const difficulty = Number(bootstrap?.powDifficulty)
  if (!nonce || !challenge) {
    throw new Error('Tantangan proof-of-work tidak ditemukan di bootstrap j2download.')
  }
  if (!Number.isFinite(difficulty) || difficulty < 1) {
    throw new Error('Difficulty proof-of-work tidak ditemukan di bootstrap j2download.')
  }
  const first = await solveSinglePow(challengeType, challenge, nonce, difficulty)
  if (challengeType !== 'alt') return first
  const second = await solveSinglePow(
    challengeType,
    deriveAltChallenge(challenge, nonce, first),
    nonce,
    difficulty
  )
  return `${first}.${second}`
}

// ============ SESSION (homepage + auth) ============

function extractBootstrap(html) {
  const patterns = [
    /window\.__BOOTSTRAP__\s*=\s*(\{[\s\S]*?\})\s*;/,
    /window\.__BOOTSTRAP__\s*=\s*(\{[\s\S]*?\})/,
    /<script[^>]*>\s*window\.__BOOTSTRAP__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i,
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (!match) continue
    try {
      return JSON.parse(match[1])
    } catch {}
  }
  throw new Error('window.__BOOTSTRAP__ tidak ditemukan di halaman j2download.')
}

async function fetchSession() {
  const page = await fetch(`${ORIGIN}/`, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!page.ok) throw new Error(`Halaman j2download tidak dapat dibuka (HTTP ${page.status}).`)
  const html = await page.text()
  const cookie = (page.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ')
  const bootstrap = extractBootstrap(html)

  const solution = await solvePow(bootstrap)
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': UA,
    Origin: ORIGIN,
    Referer: `${ORIGIN}/`,
    'X-Page-Nonce': String(bootstrap.nonce),
    'X-Pow-Solution': solution,
  }
  if (cookie) headers.Cookie = cookie
  const res = await fetch(`${ORIGIN}/api/auth/issue`, {
    method: 'POST',
    headers,
    body: '{}',
    signal: AbortSignal.timeout(30_000),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload?.accessToken) {
    throw new Error(`Token j2download tidak valid (HTTP ${res.status}).`)
  }
  const ttl = Math.min(Math.max(Number(payload.expiresIn) || AUTH_TTL_MS / 1000, 60), 3600) * 1000
  return { accessToken: String(payload.accessToken), cookie, expiresAt: Date.now() + ttl }
}

async function getSession(forceRefresh = false) {
  if (!forceRefresh && cachedAuth && cachedAuth.expiresAt > Date.now()) return cachedAuth
  if (!sessionPromise) {
    sessionPromise = fetchSession()
      .then((session) => {
        cachedAuth = session
        return session
      })
      .finally(() => {
        sessionPromise = null
      })
  }
  return sessionPromise
}

// ============ AUTOLINK ============

async function autolinkOnce(url, auth) {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': UA,
    Origin: ORIGIN,
    Referer: `${ORIGIN}/`,
    Authorization: `Bearer ${auth.accessToken}`,
  }
  if (auth.cookie) headers.Cookie = auth.cookie
  const res = await fetch(`${ORIGIN}/api/autolink`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data: { url, unlock: true } }),
    signal: AbortSignal.timeout(30_000),
  })
  const payload = await res.json().catch(() => null)
  return { res, payload }
}

function looksLikeAuthFailure(res, payload) {
  if (!payload || res.status >= 400) return true
  if (!payload.error) return false
  return /token|auth|unauthorized|forbidden|401|403/i.test(JSON.stringify(payload.error))
}

async function autolink(url) {
  let auth = await getSession()
  let result = await autolinkOnce(url, auth)
  if (looksLikeAuthFailure(result.res, result.payload)) {
    // Cached token rejected (or stale): refresh once — the PoW runs again.
    auth = await getSession(true)
    result = await autolinkOnce(url, auth)
  }
  const { res, payload } = result
  if (payload?.error) {
    const reason =
      typeof payload.error === 'string'
        ? payload.error
        : payload.error.message || JSON.stringify(payload.error)
    throw new Error(`Autolink j2download gagal: ${reason}`)
  }
  if (!res.ok || !payload || !Array.isArray(payload.medias)) {
    throw new Error(`Autolink j2download gagal (HTTP ${res.status}).`)
  }
  return payload
}

// ============ MEDIA ============

function parseDuration(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value) return 0
  const trimmed = value.trim()
  if (!trimmed.includes(':')) return Number(trimmed) || 0
  const parts = trimmed.split(':').map((part) => Number(part.trim()))
  if (parts.some((part) => !Number.isFinite(part))) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}

function mapMedias(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((media, index) => {
      const url = typeof media?.url === 'string' ? media.url : ''
      let ext = String(media?.ext ?? media?.container ?? media?.format ?? '')
        .replace(/^\./, '')
        .toLowerCase()
      if (url) {
        try {
          ext = new URL(url).searchParams.get('ext') || ext
        } catch {}
      }
      return {
        index,
        type: String(media?.type ?? media?.kind ?? '').toLowerCase(),
        quality: String(media?.quality ?? media?.label ?? media?.name ?? ''),
        ext: ext || 'mp4',
        url,
        size: Number(media?.size ?? media?.contentLength ?? 0) || null,
      }
    })
    .filter((media) => /^https:\/\//.test(media.url))
}

export async function detect(url) {
  const auto = await autolink(url)
  return {
    title: String(auto.title || auto.name || 'YouTube'),
    duration: parseDuration(auto.duration ?? auto.length ?? auto.durationText),
    durationText: String(auto.duration ?? ''),
    thumbnail: String(auto.thumbnail ?? auto.thumb ?? auto.image ?? ''),
    author: auto.author ?? auto.channel ?? auto.uploader ?? '',
    options: mapMedias(auto.medias),
    raw: auto,
  }
}

function kbpsOf(media) {
  return Number(String(media.quality).match(/^(\d+)kbps$/i)?.[1] ?? 0)
}

export function pickMedia(options, format = 'mp3') {
  if (!Array.isArray(options) || !options.length) return null
  const want = String(format).trim().toLowerCase()
  const byType = (type) => options.filter((media) => media.type === type)

  if (want === 'm4a' || want === 'audio') {
    const audio = byType('audio')
    if (audio.length) {
      const m4a = audio.find((media) => media.ext === 'm4a' || media.quality === 'default')
      return m4a || audio[0]
    }
    return options[0]
  }

  if (want === 'mp3' || want === 'song') {
    const audio = byType('audio')
    if (audio.length) {
      // 128kbps is served as real MP3 (ext=mp3 in the SSE link) and keeps the
      // upload small enough for WhatsApp audio messages.
      const exact = audio.find((media) => media.quality === '128kbps')
      if (exact) return exact
      return audio.slice().sort((a, b) => kbpsOf(a) - kbpsOf(b))[0]
    }
    return options[0]
  }

  const video = byType('video')
  const target = want.replace(/\D/g, '')
  if (video.length) {
    if (target) {
      const exact = video.find((media) => media.quality.replace(/\D/g, '') === target)
      if (exact) return exact
    }
    const heights = (media) => Number(media.quality.replace(/\D/g, '')) || 0
    return video.slice().sort((a, b) => heights(a) - heights(b))[0]
  }
  return options[0]
}

// ============ SSE PROGRESS ============

function isSseUrl(url) {
  try {
    return new URL(url).pathname.toLowerCase().includes('sse')
  } catch {
    return false
  }
}

// j2download tidak konsisten antar-qualitas: sebagian host menutup stream
// dengan `status: "success"` (BUKAN "completed") tanpa event `completed`, dan
// sebagian Agency memotong stream sebelum event final dikirim. Versi lama hanya menerima event
// 'completed' + status 'completed', jadi kasus itu jatuh ke "selesai tanpa hasil
// unduhan" walau file-nya sudah jadi. Sekarang URL dianggap sah begitu muncul
// di payload apa pun, dan status selesai dikenal dalam beberapa ejaan.
const FAIL_STATUS = /^(?:failed|failure|error|errored|cancelled|canceled|aborted)$/i

function pickDownloadUrl(payload) {
  if (!payload || typeof payload !== 'object') return ''
  const queue = [payload, payload.file_info, payload.data, payload.result, payload.result?.file_info]
  for (const node of queue) {
    if (!node || typeof node !== 'object') continue
    for (const key of ['download_url', 'downloadUrl', 'downloadURL', 'url', 'file_url', 'fileUrl']) {
      const value = node[key]
      if (typeof value === 'string' && /^https:\/\//i.test(value)) return value
    }
  }
  return ''
}

/** Pecah satu blok SSE jadi { event, payload }. Data yang bukan JSON -> null. */
function parseSseChunk(chunk) {
  let event = 'message'
  const dataLines = []
  for (const line of chunk.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (!dataLines.length) return null
  try {
    return { event, payload: JSON.parse(dataLines.join('\n')) }
  } catch {
    return null
  }
}

async function waitForDownload(sseUrl, { totalMs = 6 * 60 * 1000, idleMs = 75_000 } = {}) {
  const controller = new AbortController()
  const hardTimer = setTimeout(() => controller.abort(new Error('timeout total')), totalMs)
  let idleTimer = setTimeout(() => controller.abort(new Error('timeout idle')), idleMs)
  try {
    const response = await fetch(sseUrl, {
      headers: {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
        'User-Agent': UA,
      },
      signal: controller.signal,
    })
    if (!response.ok || !response.body) {
      throw new Error(`SSE progress j2download gagal (HTTP ${response.status}).`)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let lastFailure = ''

    // Sisa buffer setelah stream ditutup tetap diparse: event "completed"
    // kadang tiba persis di potongan terakhir tanpa \r\n\r\n penutup, dan
    // reader.read() sudah mengembalikan done=true sehingga isinya hilang.
    const drain = () => {
      for (const chunk of buffer.split(/\r?\n\r?\n/)) {
        const parsed = parseSseChunk(chunk)
        if (!parsed) continue
        const url = pickDownloadUrl(parsed.payload)
        if (url) return url
        const status = String(parsed.payload?.status ?? '').trim()
        if (FAIL_STATUS.test(status) || parsed.event === 'failed' || parsed.event === 'error') {
          lastFailure = String(parsed.payload?.message || parsed.payload?.error || status || 'unknown error')
        }
      }
      return ''
    }

    while (true) {
      let value
      let done
      try {
        ;({ value, done } = await reader.read())
      } catch (err) {
        const url = drain()
        if (url) return url
        throw err
      }
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => controller.abort(new Error('timeout idle')), idleMs)
      if (value) buffer += decoder.decode(value, { stream: true })
      const events = buffer.split(/\r?\n\r?\n/)
      buffer = events.pop() || ''
      for (const chunk of events) {
        const parsed = parseSseChunk(chunk)
        if (!parsed) continue
        const url = pickDownloadUrl(parsed.payload)
        if (url) return url
        const status = String(parsed.payload?.status ?? '').trim()
        if (FAIL_STATUS.test(status) || parsed.event === 'failed' || parsed.event === 'error') {
          throw new Error(
            `Unduhan j2download gagal: ${String(parsed.payload?.message || parsed.payload?.error || status || 'unknown error')}`
          )
        }
      }
      if (done) {
        buffer += decoder.decode()
        const url = drain()
        if (url) return url
        break
      }
    }

    throw new Error(
      lastFailure
        ? `Unduhan j2download gagal: ${lastFailure}`
        : 'SSE progress j2download selesai tanpa hasil unduhan.'
    )
  } finally {
    clearTimeout(hardTimer)
    clearTimeout(idleTimer)
  }
}

// ============ PUBLIC API ============

/**
 * Resolve a YouTube URL into a direct CDN download URL (no API key required).
 * @param {string} url YouTube watch/shorts/youtu.be URL.
 * @param {string} format 'mp3'/'audio' for audio, or a height like '720'.
 * @returns {Promise<{downloadUrl: string, rawTitle: string, title: string, author: string,
 *   duration: number, durationText: string, thumb: string, quality: string, ext: string}>}
 */
export async function resolveDownload(url, format = 'mp3') {
  const info = await detect(url)
  const media = pickMedia(info.options, format)
  if (!media?.url) throw new Error('j2download tidak menemukan media untuk URL ini.')
  const downloadUrl = isSseUrl(media.url) ? await waitForDownload(media.url) : media.url
  const author =
    typeof info.author === 'object'
      ? String(info.author?.name || '')
      : String(info.author || '')
  return {
    downloadUrl,
    rawTitle: info.title,
    title: info.title,
    author,
    duration: info.duration,
    durationText: info.durationText,
    thumb: info.thumbnail,
    quality: media.quality,
    ext: media.ext || 'mp4',
  }
}
