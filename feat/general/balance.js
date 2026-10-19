import { getBalance } from '../../core/database.js'
import { getCharacter } from '../../core/rpg.js'
export default {
  name: 'balance',
  aliases: ['bal', 'saldo'],
  tags: 'general',
  description: 'Cek saldo reward kamu',
  async run(ctx) {
    const bal = getBalance(ctx.sender)
    const char = getCharacter(ctx.sender)
    const name = ctx.pushName || 'User'
    await ctx.reply(
`╭─💰「 *SALDO ${name.toUpperCase()}* 」💰─╮
│
│ 💰 Gold: *${bal.gold}*
│ 💎 Gems: *${bal.gems}*
│ ⭐ XP: *${char ? char.xp : 0}* (Lv.${char ? char.level : 1})
│
│ 💡 Gold & gems buat belanja;\n│ XP naikkin level petualangmu.
│
╰────────────────────✦╯`
    )
  }
}