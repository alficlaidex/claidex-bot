import config from '../../config.js'
import { touchUser, setBanned, topUsers, totalUsers } from '../../core/database.js'
import { normalizeNumber } from '../../core/staff.js'
import { resolveLidToPn } from '../../core/lid.js'
export default {
  name: 'ban',
  aliases: ['unban', 'users'],
  tags: 'owner',
  admin: true,
  description: 'Ban/unban user (via nomor atau tag) & daftar user',
  async run(ctx) {
    if (ctx.command === 'users') {
      const top = topUsers(10)
      const lines = top.map(
        (u, i) => `${i + 1}. +${u.jid.split('@')[0]} — ${u.command_count} cmd${u.banned ? ' 🚫' : ''}`
      )
      await ctx.reply(`👥 *TOTAL USER: ${totalUsers()}*\n\n${lines.join('\n') || '(belum ada user tercatat)'}`)
      return
    }
    let targetJid = ctx.mentioned?.[0]
    if (!targetJid) {
      const targetNumber = (ctx.args[0] ?? '').replace(/\D/g, '')
      if (!targetNumber) {
        await ctx.reply(
          `Format:\n• ${ctx.prefix}${ctx.command} 628123456789\n• ${ctx.prefix}${ctx.command} <tag orangnya>`
        )
        return
      }
      targetJid = `${targetNumber}@s.whatsapp.net`
    }
    const isLid = targetJid.endsWith('@lid')
    
    
    
    let targetNumber = normalizeNumber(targetJid.split('@')[0].split(':')[0])
    if (isLid) {
      try {
        const resolved = await resolveLidToPn(ctx.client, ctx.chat, targetJid)
        const resolvedNumber = normalizeNumber(String(resolved ?? '').split('@')[0].split(':')[0])
        if (resolvedNumber) targetNumber = resolvedNumber
      } catch {}
    }
    const label = isLid ? 'User yang di-tag' : `+${targetNumber}`
    
    
    const ownerNumbers = config.staff.map((s) => normalizeNumber(s.number)).filter(Boolean)
    if (ownerNumbers.includes(targetNumber)) {
      await ctx.reply('🚫 Gak bisa ban/unban sesama owner!')
      return
    }
    if (isLid && !targetNumber) {
      await ctx.reply('⚠️ Gagal resolve LID ke nomor. Ban nggak dikirim demi keamanan.')
      return
    }
    if (ctx.command === 'ban') {
      touchUser(targetJid, null)
      setBanned(targetJid, true)
      await ctx.reply(`🚫 ${label} telah di-BAN.`)
    } else {
      setBanned(targetJid, false)
      await ctx.reply(`✅ ${label} telah di-unban.`)
    }
  }
}