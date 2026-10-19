import config from '../../config.js'
import { getYouTubeBuffer, ensureAudioFile } from '../../lib/youtube.js'
import { jhydl } from '../../scraper/YT-DL.js'
import { onRichReply, unregisterRichReply } from '../../core/richRegistry.js'
const SESSIONS = globalThis.CLAIDE_PLAY_SESSIONS ??= new Map()
// Ids handler yang dipasang untuk tiap sender, supaya bisa dibersihkan saat
// sesi diganti atau kedaluwarsa.
const HANDLERS = globalThis.CLAIDE_PLAY_HANDLERS ??= new Map()
const PER_PAGE = 2
const SESSION_TTL = 10 * 60 * 1000
const SESSION_CAP = 200
const MAX_AUDIO_BYTES = 50 * 1024 * 1024
function cut(value = '', max = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
function safeFileName(value = 'music') {
  return cut(value, 80).replace(/[\\/:*?"<>|]/g, '-').replace(/\.+$/g, '') || 'music'
}
function getSession(sender) {
  const session = SESSIONS.get(sender)
  if (!session) return null
  if (Date.now() - session.updatedAt > SESSION_TTL) {
    SESSIONS.delete(sender)
    clearSessionHandlers(sender)
    return null
  }
  session.updatedAt = Date.now()
  return session
}
function setSession(sender, value) {
  if (SESSIONS.size >= SESSION_CAP) {
    const oldest = SESSIONS.keys().next().value
    SESSIONS.delete(oldest)
    clearSessionHandlers(oldest)
  }
  SESSIONS.set(sender, { ...value, updatedAt: Date.now() })
}
async function ytSearch(query) {
  const results = await jhydl.search(query, 8)
  if (!Array.isArray(results) || !results.length) throw new Error('Lagu tidak ditemukan')
  return results
}
async function downloadAndSend(ctx, index) {
  const session = getSession(ctx.sender)
  if (!session) return ctx.reply('Sesi pencarian habis. Ketik `.play <judul>` lagi.')
  const video = session.results[index]
  if (!video) return ctx.reply('Pilihan lagu tidak valid. Kirim `.play <judul>` untuk mencari lagi.')
  await ctx.react('⏳')
  try {
    const data = await jhydl.download(video.url, 'mp3')
    const raw = await getYouTubeBuffer(data.download_url)
    const audio = await ensureAudioFile(raw)
    await ctx.client.message.send(ctx.chat, {
      type: 'audio',
      media: audio.buffer,
      mimetype: audio.mimetype,
      fileName: `${safeFileName(data.title || video.title)}.${audio.ext}`,
      caption: `🎧 *${cut(data.title || video.title, 700)}*\n${cut(video.author, 100)}`,
    })
    await ctx.react('🎧')
  } catch (error) {
    await ctx.react('❎')
    await ctx.reply(`❌ Gagal mengirim audio: ${cut(error?.message || error, 240)}`)
  }
}
// Satu handler per (sender, halaman) yang aktif saja. Versi lama mendaftarkan
// ulang SEMUA halaman + SEMUA item tiap kali .play/.halaman dipanggil, jadi
// registry membengkak tanpa batas (O(searches x results)) dan handler lama
// milik sesi yang sudah kedaluwarsa masih bisa memicu unduhan. Sekarang
// hapus dulu isi sesi itu sebelum pasang yang baru.
function clearSessionHandlers(sender) {
  for (const id of HANDLERS.get(sender) ?? []) unregisterRichReply(id)
  HANDLERS.delete(sender)
}
function registerSessionHandler(sender, id, handler) {
  onRichReply(id, handler)
  const ids = HANDLERS.get(sender) ?? []
  ids.push(id)
  HANDLERS.set(sender, ids)
}
async function sendPage(ctx, requestedPage = 0) {
  const session = getSession(ctx.sender)
  if (!session) return ctx.reply('Sesi pencarian habis. Ketik `.play <judul>` lagi.')
  const { results, query } = session
  const totalPages = Math.max(1, Math.ceil(results.length / PER_PAGE))
  const page = Math.max(0, Math.min(totalPages - 1, Number(requestedPage) || 0))
  const start = page * PER_PAGE
  const items = results.slice(start, start + PER_PAGE)
  const lines = [
    `🎧 *Music Player*`,
    `🔎 ${cut(query, 70)}`,
    `📄 Halaman ${page + 1}/${totalPages} • ${results.length} hasil`,
    '',
  ]
  items.forEach((video, index) => {
    lines.push(`${start + index + 1}. *${cut(video.title, 65)}*`)
    lines.push(`   ⏱ ${cut(video.duration || '-:--', 12)} • ${cut(video.author, 38)}`)
  })
  lines.push('', 'Pilih nomor untuk mengirim audio.')
  const buttons = items.map((video, index) => ({
    id: `music:${ctx.sender}:pick:${start + index}`,
    text: `${start + index + 1}. ${cut(video.title, 22)}`,
  }))
  if (page > 0) {
    buttons.push({ id: `music:${ctx.sender}:page:${page - 1}`, text: '⬅️ Sebelumnya' })
  }
  if (page < totalPages - 1) {
    buttons.push({ id: `music:${ctx.sender}:page:${page + 1}`, text: 'Berikutnya ➡️' })
  }
  clearSessionHandlers(ctx.sender)
  for (const video of items) {
    const itemIndex = results.indexOf(video)
    registerSessionHandler(ctx.sender, `music:${ctx.sender}:pick:${itemIndex}`, (replyContext) =>
      downloadAndSend(replyContext, itemIndex)
    )
  }
  for (let targetPage = 0; targetPage < totalPages; targetPage++) {
    registerSessionHandler(ctx.sender, `music:${ctx.sender}:page:${targetPage}`, (replyContext) =>
      sendPage(replyContext, targetPage)
    )
  }
  try {
    await ctx.replyButtons({
      text: lines.join('\n'),
      footer: `${config.botName} • YouTube Audio`,
      buttons,
    })
  } catch (err) {
    // Tanpa nativeFlow tidak ada cara memilih lagu, jadi turunkan ke teks
    // dengan instruksi eksplisit — lebih baik daripada diam.
    clearSessionHandlers(ctx.sender)
    await ctx.reply(`${lines.join('\n')}\n\nTombol gagal dimuat. Balas dengan \`.play ${query}\` untuk coba lagi.`)
    throw err
  }
}
function isYouTubeUrl(value) {
  try {
    const url = new URL(value)
    return ['youtube.com', 'www.youtube.com', 'youtu.be', 'www.youtu.be'].includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
}
export default {
  name: 'play',
  aliases: ['ytplay', 'playyt', 'music'],
  tags: 'downloader',
  description: 'Cari dan kirim audio YouTube lewat tombol interaktif',
  async run(ctx) {
    const query = (ctx.text || '').trim().slice(0, 250)
    if (!query) {
      return ctx.reply(
        `🎧 *${config.botName} — Music Player*\n\n` +
        'Gunakan `.play <judul lagu>` atau `.play <URL YouTube>`.\n' +
        'Contoh: `.play Bercinta Lewat Kata`'
      )
    }
    await ctx.react('⏳')
    try {
      const results = isYouTubeUrl(query)
        ? [{ id: query, url: query, title: 'Video YouTube', author: 'YouTube', duration: '-:--' }]
        : await ytSearch(query)
      setSession(ctx.sender, { query, results })
      await sendPage(ctx, 0)
      await ctx.react('✅')
    } catch (error) {
      await ctx.react('❎')
      await ctx.reply(`❌ ${cut(error?.message || error, 300)}`)
    }
  },
}