import { isGroupAdmin } from '../../core/permission.js'
import { normalizeNumber } from '../../core/staff.js'
import { resolveGroupTargetJid, sendMention } from '../../core/lid.js'
export default {
  name: 'promote',
  aliases: ['demote'],
  tags: 'group',
  description: 'Naik/turunkan admin grup via tag atau nomor (admin grup/staff)',
  async run(ctx) {
    if (!ctx.isGroup) {
      await ctx.reply('🚫 Khusus grup.')
      return
    }
    if (!(await isGroupAdmin(ctx))) {
      await ctx.reply('🚫 Khusus Admin grup / Staff bot.')
      return
    }
    let target = ctx.mentioned?.[0]
    if (!target) {
      const num = normalizeNumber(ctx.args[0] ?? '')
      if (!num) {
        await ctx.reply(
          `Format:\n• ${ctx.prefix}${ctx.command} <tag orangnya>\n• ${ctx.prefix}${ctx.command} 628xxx`
        )
        return
      }
      target = `${num}@s.whatsapp.net`
    }
    try {
      target = await resolveGroupTargetJid(ctx.client, ctx.chat, target)
      const results = ctx.command === 'promote'
        ? await ctx.client.group.promoteParticipants(ctx.chat, [target])
        : await ctx.client.group.demoteParticipants(ctx.chat, [target])
      const result = results?.[0]
      if (!result || result.status !== 'ok') {
        throw new Error(`target ditolak (${result?.code ?? 'tanpa status'})`)
      }
      const message = ctx.command === 'promote'
        ? '⬆️ @user sekarang menjadi admin grup.'
        : '⬇️ @user berhasil menurunkan status admin.'
      await sendMention(ctx.client, ctx.chat, target, message)
    } catch (err) {
      await ctx.reply(`😵 Gagal ${ctx.command}: ${String(err.message).slice(0, 160)}`)
    }
  }
}