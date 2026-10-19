import { createCharacter, getInventory } from '../../core/rpg.js'
import { getCookRecipes, cookItem, itemInfo } from '../../core/shop.js'
import { ITEM_INDEX, TIER_ICON } from '../../src/rpg/dropTable.js'
const COOK_FLAVOR = [
  'Kamu menyalakan tungku kecil, aroma {item} segera memenuhi perkemahan.',
  'Dengan wajan pinjaman dari warung Pak Karman, kamu meracik {item} sampai matang sempurna.',
  'Asap tipis mengepul; {item} siap disantap selagi hangat.',
]
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}
function resolveRecipe(raw) {
  const q = String(raw ?? '').toLowerCase().trim()
  if (!q) return null
  const compact = q.replace(/[\s_\-]+/g, '')
  const rs = getCookRecipes()
  return (
    rs.find((r) => r.id === q) ??
    rs.find((r) => r.name.toLowerCase() === q) ??
    rs.find((r) => r.name.toLowerCase().replace(/\s+/g, '') === compact) ??
    null
  )
}
export default {
  name: 'cook',
  aliases: ['masak'],
  tags: 'rpg',
  cooldown: 3000,
  description: 'Masak bahan mentah jadi hidangan (restore lebih gede)',
  async run(ctx) {
    createCharacter(ctx.sender, ctx.pushName)
    const raw = ctx.args.join(' ')
    if (!raw) {
      const inv = getInventory(ctx.sender)
      const lines = getCookRecipes().map((r) => {
        const ings = r.ingredients
          .map((ing) => {
            const it = ITEM_INDEX[ing.id]
            const have = inv.find((row) => row.item_id === ing.id)?.amount ?? 0
            const ok = have >= ing.amount ? '✅' : '❌'
            return `${ok} ${it?.name ?? ing.id} ×${ing.amount} (${have})`
          })
          .join('\n│   ')
        const out = itemInfo(r.id)
        const gains = []
        if (out?.energy_restore) gains.push(`⚡+${out.energy_restore}`)
        if (out?.hp_restore) gains.push(`❤️+${out.hp_restore}`)
        return `│ 🍳 *${r.name}* _(${r.id})_ — ${gains.join(' ')}\n│   _${r.desc}_\n│   ${ings}`
      })
      await ctx.reply(
`╭─🍳「 *BUKU RESEP* 」🍳─╮
│
${lines.join('\n│\n')}
│
│ 💡 Masak: ${ctx.prefix}cook <id/nama>
│ 🍽️ Hasil bisa dipakai via ${ctx.prefix}use
╰────────────────────✦╯`
      )
      return
    }
    const recipe = resolveRecipe(raw)
    if (!recipe) {
      await ctx.reply(`❌ Resep "${raw}" tidak ada. Ketik ${ctx.prefix}cook buat lihat buku resep.`)
      return
    }
    const res = cookItem(ctx.sender, recipe.id)
    if (res.error === 'insufficient_ingredient') {
      const it = ITEM_INDEX[res.missing]
      await ctx.reply(
        `😅 Bahan kurang:\n• ${it?.name ?? res.missing} — butuh ${res.needed}, punya ${res.have}`
      )
      return
    }
    const out = itemInfo(recipe.id)
    const gains = []
    if (out?.energy_restore) gains.push(`⚡+${out.energy_restore}`)
    if (out?.hp_restore) gains.push(`❤️+${out.hp_restore}`)
    await ctx.reply(
      `${pick(COOK_FLAVOR).replaceAll('{item}', `*${recipe.name}*`)}\n\n` +
      `╭─🍽️「 *HIDANGAN SIAP* 」🍽️─╮\n` +
      `│ ${TIER_ICON[recipe.tier]} *${recipe.name}*\n` +
      `│ Efek: ${gains.join(' • ')}\n` +
      `│ 💵 Nilai jual: ${recipe.value}G\n` +
      `│\n` +
      `│ Santap: ${ctx.prefix}use ${recipe.id}\n` +
      `╰────────────────────✦╯`
    )
  }
}