import { downloadInstagram } from '../../scraper/IG-DL.js'
import { assertPublicHttpUrl, fetchPublicBuffer } from '../../lib/urlSafety.js'
const MAX_VIDEO_BYTES = 75 * 1024 * 1024
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_MEDIA = 10
export default {
  name: 'ig',
  aliases: ['igdl', 'reels', 'instagram'],
  tags: 'downloader',
  description: 'Instagram downloader — reels/post/story/video/carousel',
  async run(ctx) {
    const input = (ctx.text || '').trim()
    if (!input) {
      return ctx.reply(
        '📥 *Instagram Downloader*\n\n' +
        '`.ig <url instagram>`\n\n' +
        'Support:\n' +
        '• Reels\n' +
        '• Post (video/image)\n' +
        '• Story (publik)\n' +
        '• Carousel (multi-media)\n\n' +
        'Contoh: `.ig https://www.instagram.com/p/Db8EFNOINcp/`'
      )
    }
    let igUrl
    try {
      const parsed = new URL(input)
      const host = parsed.hostname.toLowerCase()
      if (!['instagram.com', 'www.instagram.com', 'instagr.am', 'www.instagr.am'].includes(host)) throw new Error()
      igUrl = parsed.href
    } catch {
      return ctx.reply('⚠️ URL tidak valid. Gunakan URL `instagram.com` atau `instagr.am`.')
    }
    await ctx.react('📥')
    let result
    try {
      result = await downloadInstagram(igUrl)
    } catch (e) {
      await ctx.react('❎')
      const message = e?.code === 'PROVIDER_NOT_CONFIGURED'
        ? '⚙️ Instagram downloader belum dikonfigurasi. Owner perlu mengatur `IG_DOWNLOADER_API_URL` dan `IG_DOWNLOADER_API_KEY`.'
        : `❌ *IG Downloader Error*\n\n${String(e.message || e).slice(0, 300)}`
      return ctx.reply(message)
    }
    if (!result?.success || !Array.isArray(result.data) || !result.data.length) {
      await ctx.react('❎')
      return ctx.reply('⚠️ Tidak ada media yang bisa diunduh dari URL ini.')
    }
    const total = Math.min(result.data.length, MAX_MEDIA)
    if (result.data.length > MAX_MEDIA) {
      await ctx.reply(`⚠️ Provider mengembalikan ${result.data.length} media; hanya ${MAX_MEDIA} pertama yang diproses.`)
    }
    const nVideo = result.data.filter(m => m.type === 'video').length
    const nImage = total - nVideo
    await ctx.react('⏳')
    let sent = 0
    for (let i = 0; i < total; i++) {
      const media = result.data[i]
      const isVideo = media.type === 'video'
      const caption = i === 0
        ? (
          '📥 *Instagram Downloader*\n' +
          'Ini dia hasilnya, Kak!\n\n' +
          `🎬 Video: ${nVideo} • 🖼️ Gambar: ${nImage}\n` +
          `🔗 ${igUrl.replace(/https?:\/\//, '').slice(0, 60)}`
        )
        : `📎 Media ke-${i + 1}/${total}`
      try {
        const safeUrl = await assertPublicHttpUrl(media.url)
        const downloaded = await fetchPublicBuffer(safeUrl, {
          maxBytes: isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES,
          timeoutMs: 120_000,
          headers: { Accept: isVideo ? 'video/*' : 'image/*' },
        })
        if (!downloaded.response.ok || !downloaded.buffer.length) throw new Error('media kosong')
        await ctx.client.message.send(ctx.chat, {
          type: isVideo ? 'video' : 'image',
          media: downloaded.buffer,
          mimetype: isVideo ? 'video/mp4' : 'image/jpeg',
          caption
        })
        sent++
      } catch (e) {
        console.log('[IGDL] send fail #' + (i + 1) + ':', String(e.message || e).slice(0, 150))
      }
    }
    if (sent === 0) {
      await ctx.react('❎')
      return ctx.reply('❌ Semua media gagal dikirim (link CDN expired / host nolak fetch dari server).')
    }
    await ctx.react(sent === total ? '✅' : '⚠️')
    if (sent < total) {
      await ctx.reply(`⚠️ Terkirim ${sent}/${total} media. ${total - sent} gagal (link expired / host nolak).`)
    }
  }
}