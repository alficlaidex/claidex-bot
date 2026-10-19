import config from '../../config.js'
import { isGroupAdmin } from '../../core/permission.js'
import { normalizeNumber } from '../../core/staff.js'
import { resolveGroupTargetJid, resolveLidToPn, sendMention } from '../../core/lid.js'
export default {
  name: 'kick',
  aliases: ['add'],
  tags: 'group',
  description: 'Kick/add member via tag atau nomor (admin grup/staff)',
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
    const targetPhoneJid = await resolveLidToPn(ctx.client, ctx.chat, target)
    const targetNumber = targetPhoneJid.split('@')[0].split(':')[0]
    const targetStaff = config.staff.find((s) => s.number === targetNumber)
    if (targetStaff?.role === 'owner') {
      await ctx.reply('🚫 Gak bisa kick/add sesama owner!')
      return
    }
    try {
      target = await resolveGroupTargetJid(ctx.client, ctx.chat, target)
      const results = ctx.command === 'kick'
        ? await ctx.client.group.removeParticipants(ctx.chat, [target])
        : await ctx.client.group.addParticipants(ctx.chat, [target])
      const result = results?.[0]
      if (!result || result.status !== 'ok') {
        throw new Error(`target ditolak (${result?.code ?? 'tanpa status'})`)
      }
      const action = ctx.command === 'kick' ? 'di-kick dari' : 'ditambahkan ke'
      await sendMention(ctx.client, ctx.chat, target, `✅ @user berhasil ${action} grup.`)
    } catch (err) {
      await ctx.reply(`😵 Gagal ${ctx.command}: ${String(err.message).slice(0, 160)}`)
    }
  }
}