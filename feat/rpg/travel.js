import { createCharacter, getInventory } from '../../core/rpg.js'
import { getLocations, getLocation, travelTo, getCurrentLocation, checkRequirements } from '../../core/location.js'
import { itemInfo } from '../../core/shop.js'
export default {
  name: 'travel',
  aliases: ['pindah', 'pergi'],
  tags: 'rpg',
  cooldown: 5000,
  description: 'Pindah lokasi (butuh gear tertentu)',
  async run(ctx) {
    createCharacter(ctx.sender, ctx.pushName)
    const current = getCurrentLocation(ctx.sender)
    const sub = ctx.args[0]
    if (!sub) {
      const locs = getLocations()
      const lines = locs.map((l) => {
        const isHere = l.id === current.id ? ' 📍' : ''
        const reqs = l.requirements.length
          ? l.requirements.map((r) => itemInfo(r)?.name ?? r).join(', ')
          : 'tidak ada'
        return `│ 🗺️ *${l.name}* _(${l.id})_${isHere}\n│    _${l.desc}_\n│    Butuh: ${reqs}`
      })
      await ctx.reply(
`╭─🗺️「 *DAFTAR LOKASI* 」🗺️─
│
${lines.join('\n│\n')}
│
│ 📍 Kamu sekarang di: *${current.name}*
│ 💡 Pindah: ${ctx.prefix}travel <id>
╰────────────────────✦╯`
      )
      return
    }
    const locId = sub.toLowerCase()
    const loc = getLocation(locId)
    if (!loc) {
      await ctx.reply(`❌ Lokasi "${locId}" tidak ada. Ketik ${ctx.prefix}travel buat lihat daftar.`)
      return
    }
    if (loc.id === current.id) {
      await ctx.reply(`📍 Kamu sudah di *${loc.name}* — tidak perlu pindah.`)
      return
    }
    const res = travelTo(ctx.sender, locId)
    if (res.error === 'requirements') {
      const names = res.missing.map((r) => `• ${itemInfo(r)?.name ?? r}`).join('\n')
      await ctx.reply(
        `😅 Kamu belum punya perlengkapan buat ke *${loc.name}*:\n${names}\n\n` +
        `Beli di .shop atau craft dulu.`
      )
      return
    }
    await ctx.reply(
`╭─🚶「 *PERJALANAN* 」🚶─
│
│ Kamu meninggalkan ${current.name},
│ menyusuri jalan setapak menuju:
│ *${loc.name}*
│
│ _${loc.desc}_
│
╰────────────────────✦╯`
    )
  }
}