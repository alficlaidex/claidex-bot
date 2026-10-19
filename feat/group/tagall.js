import { isGroupAdmin } from '../../core/permission.js'
import { groupParticipantJids } from '../../core/lid.js'
export default {
  name: 'tagall',
  aliases: ['tall', 'mentionall'],
  tags: 'group',
  description: 'Mention kelihatan semua member + custom caption (admin grup/staff)',
  async run(ctx) {
    if (!ctx.isGroup) {
      await ctx.reply('🚫 Command ini khusus grup.')
      return
    }
    if (!(await isGroupAdmin(ctx))) {
      await ctx.reply('🚫 Khusus Admin grup / Staff bot.')
      return
    }
    const meta = await ctx.client.group.queryGroupMetadata(ctx.chat)
    const jids = groupParticipantJids(meta)
    const caption = ctx.text || '📢 Semua kumpul sini!'
    const batchSize = 50
    for (let offset = 0; offset < jids.length; offset += batchSize) {
      const batch = jids.slice(offset, offset + batchSize)
      const tags = batch.map((jid) => `@${jid.split('@')[0]}`).join(' ')
      const suffix = jids.length > batchSize ? ` (${Math.floor(offset / batchSize) + 1}/${Math.ceil(jids.length / batchSize)})` : ''
      await ctx.client.message.send(ctx.chat, {
        extendedTextMessage: {
          text: `*TAGALL${suffix}* — ${meta.subject ?? 'Grup'}\n${caption}\n\n${tags}`,
          contextInfo: { mentionedJid: batch },
        },
      })
    }
  }
}