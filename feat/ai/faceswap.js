import { resolveMediaPayload } from 'zapo-js'
import { faceSwap } from '../../scraper/FACESWAP.js'
import { assertPublicHttpUrl, fetchPublicBuffer } from '../../lib/urlSafety.js'
const MAX_BUF = 10 * 1024 * 1024
const SESSION_TTL = 5 * 60 * 1000
const SESSION_CAP = 10
const MEM = (globalThis.CLAIDE_FACESWAP_MEM ??= new Map())
function getEvent(ctx) {
  return ctx.message ?? ctx.event ?? ctx.raw ?? ctx.msg ?? null
}
function getContextInfo(message) {
  if (!message || typeof message !== 'object') return null
  for (const key of Object.keys(message)) {
    const node = message[key]
    if (node && typeof node === 'object' && node.contextInfo) return node.contextInfo
  }
  return null
}
async function extractImageBuffer(client, message) {
  if (!message) return null
  try {
    const payload = resolveMediaPayload(message)
    if (!payload?.mimetype || !String(payload.mimetype).startsWith('image/')) return null
    const buffer = await client.message.downloadBytes(message, {
      maxBytes: MAX_BUF,
      timeoutMs: 30_000,
      signal: AbortSignal.timeout(35_000),
    })
    return buffer?.length ? Buffer.from(buffer) : null
  } catch (error) {
    console.log('[FaceSwap] extract image gagal:', String(error.message || error).slice(0, 120))
    return null
  }
}
function detectMime(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif'
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp'
  return 'image/jpeg'
}
function getSession(sender) {
  const s = MEM.get(sender)
  if (!s) return null
  if (Date.now() - s.ts > SESSION_TTL) {
    MEM.delete(sender)
    return null
  }
  return s
}
function setSession(sender, buf) {
  if (MEM.size >= SESSION_CAP) {
    const oldest = MEM.keys().next().value
    MEM.delete(oldest)
  }
  MEM.set(sender, { buf, ts: Date.now() })
}
async function processSwap(ctx, target, swap) {
  await ctx.react('⏳')
  let resultUrl
  try {
    const res = await faceSwap({ target, swap })
    resultUrl = res.resultUrl
  } catch (e) {
    console.log('[FaceSwap] engine error:', String(e.message || e).slice(0, 300))
    await ctx.react('❎')
    const message = e?.code === 'PROVIDER_NOT_CONFIGURED'
      ? '⚙️ Face Swap belum dikonfigurasi. Owner perlu mengatur `FACESWAP_API_URL` dan `FACESWAP_API_KEY`.'
      : '❌ Gagal proses Face Swap. Coba lagi dengan foto wajah yang jelas (close-up, tidak tertutup).'
    return ctx.reply(message)
  }
  try {
    const safeUrl = await assertPublicHttpUrl(resultUrl)
    const result = await fetchPublicBuffer(safeUrl, {
      maxBytes: MAX_BUF,
      timeoutMs: 60_000,
      headers: { Accept: 'image/*' },
    })
    if (!result.response.ok) throw new Error('fetch hasil HTTP ' + result.response.status)
    if (!result.buffer.length) throw new Error('hasil kosong')
    await ctx.client.message.send(ctx.chat, {
      type: 'image',
      media: result.buffer,
      mimetype: detectMime(result.buffer),
      caption: 'Ini dia hasil Face Swap-nya, Kak!'
    })
    await ctx.react('✅')
  } catch (e) {
    console.log('[FaceSwap] send error:', String(e.message || e).slice(0, 200))
    await ctx.react('❎')
    return ctx.reply('❌ Gagal kirim hasil Face Swap.')
  }
}
const HELP =
  '🎭 *FACE SWAP — AI*\n\n' +
  '*Mode 2 langkah:*\n' +
  '1) Reply/kirim foto + `.faceswap` → foto 1 tersimpan\n' +
  '2) Kirim/reply foto kedua + `.faceswap` → hasil!\n\n' +
  '*Mode sekali tembak:*\n' +
  '• Reply foto + kirim foto caption `.faceswap`\n' +
  '• Reply foto + `.faceswap <url>`\n' +
  '• Kirim foto caption `.faceswap <url>`\n' +
  '• `.faceswap <url1> <url2>`\n\n' +
  '`.faceswap reset` → buang foto 1 tersimpan\n' +
  'Tips: foto wajah close-up & tidak tertutup biar hasil maksimal.'
export default {
  name: 'faceswap',
  aliases: ['swap', 'fs'],
  tags: 'ai',
  description: 'Face Swap AI — tukar wajah dua foto (mode sesi & one-shot)',
  async run(ctx) {
    const text = (ctx.text || '').trim()
    const firstWord = (text.split(/\s+/)[0] || '').toLowerCase()
    if (/^(reset|del|hapus|cancel|batal)$/.test(firstWord)) {
      MEM.delete(ctx.sender)
      return ctx.reply('🗑️ Session Face Swap dibuang.')
    }
    const urls = (text.match(/https?:\/\/[^\s]+/gi) || []).slice(0, 2)
    const event = getEvent(ctx)
    const rawMessage = event?.message ?? event
    const ctxInfo = getContextInfo(rawMessage)
    const quoted = ctxInfo?.quotedMessage ?? null
    const quotedBuffer = await extractImageBuffer(ctx.client, quoted)
    const attachedBuffer = await extractImageBuffer(ctx.client, rawMessage)
    const sourcesNow = []
    if (quotedBuffer) sourcesNow.push(quotedBuffer)
    if (attachedBuffer) sourcesNow.push(attachedBuffer)
    for (const value of urls) {
      try {
        sourcesNow.push((await assertPublicHttpUrl(value)).href)
      } catch {
        return ctx.reply('⚠️ Salah satu URL gambar tidak valid atau mengarah ke alamat privat.')
      }
    }
    if (sourcesNow.length >= 2) {
      MEM.delete(ctx.sender)
      return processSwap(ctx, sourcesNow[0], sourcesNow[1])
    }
    if (sourcesNow.length === 1) {
      const saved = getSession(ctx.sender)
      if (saved) {
        MEM.delete(ctx.sender)
        return processSwap(ctx, saved.buf, sourcesNow[0])
      }
      setSession(ctx.sender, sourcesNow[0])
      return ctx.reply(
        '✅ Foto pertama sukses terupload.\n' +
        'Silahkan upload foto kedua untuk memulai proses Face Swap.\n\n' +
        'Kirim foto kedua caption `.faceswap` (atau reply foto kedua dengan `.faceswap`).\n' +
        '⏳ Foto pertama berlaku 5 menit • `.faceswap reset` buat batal.'
      )
    }
    const saved = getSession(ctx.sender)
    if (saved) {
      return ctx.reply(
        '⏳ Foto pertama kamu masih tersimpan.\n' +
        'Kirim foto kedua caption `.faceswap` untuk mulai proses.\n' +
        '`.faceswap reset` buat buang foto pertama.'
      )
    }
    return ctx.reply(HELP)
  }
}