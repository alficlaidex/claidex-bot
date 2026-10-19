import { resolveMediaPayload, unwrapMessage } from 'zapo-js'
import { logger } from '../../core/logger.js'
import { downloadMedia } from '../../lib/media.js'
const MAX_CAPTION = 1000

const FALLBACK_MIME = {
  image: 'image/jpeg',
  gif: 'image/gif',
  video: 'video/mp4',
  ptv: 'video/mp4',
  ptt: 'audio/ogg; codecs=opus',
  audio: 'audio/ogg; codecs=opus',
  sticker: 'image/webp',
}

function findTarget(event) {
  const message = event?.message
  if (!message) return null
  const quoted =
    message.extendedTextMessage?.contextInfo?.quotedMessage ??
    message.imageMessage?.contextInfo?.quotedMessage ??
    message.videoMessage?.contextInfo?.quotedMessage
  if (quoted && resolveMediaPayload(quoted)) return quoted
  if (resolveMediaPayload(message)) return message
  return null
}

function isViewOnce(container) {
  if (!container) return false
  if (container.viewOnceMessage || container.viewOnceMessageV2) return true
  const inner = unwrapMessage(container)
  return Boolean(
    inner.imageMessage?.viewOnce ||
    inner.videoMessage?.viewOnce ||
    inner.audioMessage?.viewOnce ||
    inner.ptvMessage?.viewOnce
  )
}

function captionOf(container) {
  const inner = unwrapMessage(container)
  return (
    inner.imageMessage?.caption ??
    inner.videoMessage?.caption ??
    inner.documentMessage?.caption ??
    ''
  )
}
function resolveMimetype(media) {
  const raw = media.mimetype
  if (raw && raw !== 'application/octet-stream') return raw
  return FALLBACK_MIME[media.kind] ?? 'application/octet-stream'
}

function buildContent(media, caption) {
  const body = { media: media.buffer, mimetype: resolveMimetype(media) }
  const withCaption = caption ? { ...body, caption: caption.slice(0, MAX_CAPTION) } : body
  switch (media.kind) {
    case 'image':
      return { type: 'image', ...withCaption }
    case 'gif':
      return { type: 'video', ...withCaption, gifPlayback: true }
    case 'video':
      return { type: 'video', ...withCaption }
    case 'ptv':
      return { type: 'ptv', ...body }
    case 'ptt':
      return { type: 'audio', ...body, ptt: true }
    case 'audio':
      return { type: 'audio', ...body }
    case 'sticker':
      return { type: 'sticker', ...body }
    case 'document':
      return {
        type: 'document',
        ...withCaption,
        fileName: media.fileName || 'view-once-media',
      }
    default:
      return {
        type: 'document',
        ...body,
        fileName: media.fileName || 'view-once-media.bin',
      }
  }
}
export default {
  name: 'rvo',
  aliases: ['readviewonce', 'readview', 'rvonce', 'viewonce'],
  tags: 'tools',
  cooldown: 3000,
  description: 'Balas pesan view once → foto/video/voice dikirim ulang jadi media biasa',
  async run(ctx) {
    const target = findTarget(ctx.event)
    if (!target) {
      await ctx.reply(
        '👁️ *Read View Once*\n\n' +
        `Balas (reply) pesan *view once* dengan ${ctx.prefix}rvo — foto, video, GIF, ` +
        'atau voice note-nya bakal dikirim ulang jadi media biasa.\n\n' +
        `Ganti caption: ${ctx.prefix}rvo <teks>\n\n` +
        '💡 Jangan dibuka dulu pesan view once-nya di HP kamu, ' +
        'biar file-nya masih bisa diambil.'
      )
      return
    }
    const wasViewOnce = isViewOnce(target)
    await ctx.react('👁️').catch(() => {})
    const media = await downloadMedia(ctx.client, ctx.event)
    if (!media || !media.buffer?.length) {
      logger.warn(
        { chat: ctx.chat, from: ctx.senderNumber, viewOnce: wasViewOnce },
        'rvo: media gagal diunduh'
      )
      await ctx.reply(
        '😵 Gagal ambil media-nya.\n' +
        'Kemungkinan pesan view once-nya udah dibuka/dihapus di HP kamu, ' +
        'atau file-nya udah kedaluwarsa di server WhatsApp.'
      )
      return
    }
    const caption = (ctx.text || '').trim() || captionOf(target)
    const content = buildContent(media, caption)
    try {
      await ctx.client.message.send(ctx.chat, content)
    } catch (err) {
      logger.error(
        { err: err.message, kind: media.kind, size: media.buffer.length },
        'rvo: kirim media gagal'
      )
      await ctx.reply(`😵 Media udah keunduh tapi gagal dikirim: ${String(err.message).slice(0, 120)}`)
      return
    }
    logger.info(
      `👁️ rvo: ${media.kind} ${(media.buffer.length / 1024).toFixed(0)}KB terkirim ke ${ctx.chat}` +
        `${wasViewOnce ? '' : ' (bukan view once)'}`
    )
    await ctx.react('✅').catch(() => {})
  },
}