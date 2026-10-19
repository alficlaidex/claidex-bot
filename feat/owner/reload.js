import { loadFeatures } from '../loader.js'
export default {
  name: 'reload',
  tags: 'owner',
  owner: true,
  description: 'Muat ulang semua feature tanpa restart bot',
  async run(ctx) {
    const { count, total, failed } = await loadFeatures()
    let text = `🔄 Feature dimuat ulang: ${count}/${total} feature aktif.`
    if (failed.length) {
      text += `\n\n❎ *${failed.length} gagal dimuat:*\n`
      text += failed.map(f => `• ${f.file}\n   ${f.reason.split(' -> ')[1] ?? f.reason}`).join('\n')
    }
    await ctx.reply(text)
  }
}