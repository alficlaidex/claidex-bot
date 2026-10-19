import config from '../../config.js'
import {
  usageInChat,
  usageByUser,
  usageSummary,
  listChats,
} from '../../core/usage.js'
import { isAllowed, groupAccessMode } from '../../core/groupAccess.js'
import { normalizeNumber } from '../../core/staff.js'
const digits = (jid) => String(jid ?? '').split('@')[0].split(':')[0]
function fmtWhen(ts) {
  if (!ts) return '?'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'baru saja'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} menit lalu`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} jam lalu`
  return `${Math.round(diff / 86_400_000)} hari lalu`
}

function chatKind(jid) {
  return jid?.endsWith('@g.us') ? 'GRUP' : 'PM'
}
async function chatLabel(client, jid) {
  if (!jid?.endsWith('@g.us')) return jid
  try {
    const meta = await client.group.queryGroupMetadata(jid)
    return meta.subject || jid
  } catch {
    return jid
  }
}
async function renderChats(ctx) {
  const chats = listChats({ limit: 30 })
  const summary = usageSummary()
  const header =
    `👥 *Pengguna Bot — ${config.botName}*\n\n` +
    `📊 Total orang: *${summary.people}* • chat: *${summary.chats}* • command: *${summary.commands}*`
  if (!chats.length) {
    return ctx.reply(`${header}\n\nBelum ada pemakaian yang tercatat.`)
  }
  const body = []
  for (const [i, chat] of chats.entries()) {
    const label = await chatLabel(ctx.client, chat.chat)
    const allowed = chat.chat.endsWith('@g.us')
      ? (isAllowed(chat.chat) ? '✅' : groupAccessMode(chat.chat) === 'allowlist' ? '⏸️' : '🔓')
      : '📱'
    body.push(
      `${i + 1}. ${allowed} *${label}*\n` +
      `   \`${chat.chat}\`\n` +
      `   ${chat.people} orang • ${chat.commands} cmd • ${fmtWhen(chat.last_seen)}`
    )
  }
  const footer =
    `\n\nKetuk \`.whois g <jid>\` untuk lihat siapa saja yang pakai bot di chat itu.\n` +
    `Contoh: \`.whois g ${chats[0].chat}\``
  return ctx.reply(`${header}\n\n${body.join('\n\n')}${footer}`)
}
async function renderChatUsers(ctx, jid) {
  const rows = usageInChat(jid, { limit: 200 })
  const label = await chatLabel(ctx.client, jid)
  const kind = chatKind(jid)
  if (!rows.length) {
    return ctx.reply(`📭 Tidak ada yang tercatat memakai bot di *${label}* (${kind}).`)
  }
  const totalCmds = rows.reduce((sum, r) => sum + r.commands, 0)
  const header =
    `👥 *Pengguna bot di ${kind}*\n` +
    `🏷️ ${label}\n` +
    `🆔 \`${jid}\`\n` +
    `📊 ${rows.length} orang • ${totalCmds} command\n`
  const asDoc = (ctx.text || '').includes('--doc')
  const lines = rows.map((r, i) =>
    `${i + 1}. ${r.name || '(tanpa nama)'} — \`+${digits(r.jid)}\`\n` +
    `   ${r.commands} cmd • terakhir ${fmtWhen(r.last_seen)}`
  )
  if (asDoc || lines.join('\n').length > 3500) {
    const body =
      `Pengguna bot — ${label} (${kind})\n${jid}\n\n` +
      `${lines.join('\n')}\n\n— ${config.botName}`
    await ctx.client.message.send(ctx.chat, {
      type: 'document',
      media: Buffer.from(body, 'utf8'),
      mimetype: 'text/plain',
      fileName: `pengguna-${digits(jid)}.txt`,
      caption: `👥 ${rows.length} orang memakai bot di *${label}*`,
    })
    return
  }
  return ctx.reply(`${header}\n${lines.join('\n')}`)
}
async function renderUserChats(ctx, number) {
  const jid = `${number}@s.whatsapp.net`
  const rows = usageByUser(jid, { limit: 50 })
  if (!rows.length) {
    return ctx.reply(`📭 *+${number}* belum pernah memakai bot.`)
  }
  const body = []
  for (const [i, row] of rows.entries()) {
    const label = await chatLabel(ctx.client, row.chat)
    const kind = chatKind(row.chat)
    body.push(
      `${i + 1}. ${kind === 'GRUP' ? '👥' : '📱'} *${label}* (${kind})\n` +
      `   \`${row.chat}\`\n` +
      `   ${row.commands} cmd • terakhir ${fmtWhen(row.last_seen)}`
    )
  }
  return ctx.reply(
    `📱 *Chat yang dipakai +${number}*\n\n${body.join('\n\n')}`
  )
}
function renderSelf(ctx) {
  const rows = usageByUser(ctx.sender, { limit: 20 })
  const lids = ctx.senderLid ? usageByUser(ctx.senderLid, { limit: 20 }) : []
  const merged = [...rows, ...lids.filter((r) => !rows.some((x) => x.chat === r.chat))]
  if (!merged.length) {
    return ctx.reply('📭 Kamu belum memakai command bot ini.')
  }
  const total = merged.reduce((sum, r) => sum + r.commands, 0)
  const body = merged
    .map((r) => `• ${chatKind(r.chat) === 'GRUP' ? '👥' : '📱'} \`${r.chat}\` — ${r.commands} cmd`)
    .join('\n')
  return ctx.reply(
    `📱 *Pemakaianmu*\n` +
    `👤 ${ctx.pushName || '?'} (+${ctx.senderNumber})\n` +
    `📊 ${total} command di ${merged.length} chat\n\n${body}`
  )
}
const HELP =
  '👥 *WHOIS — siapa aja yang pakai bot*\n\n' +
  '`.whois` → semua chat + jumlah orangnya\n' +
  '`.whois g <jid grup>` → orang-orang yang pakai bot di grup itu\n' +
  '`.whois u <nomor>` → chat yang pernah dipakai orang itu\n' +
  '`.whois me` → pemakaian pribadi kamu\n' +
  '`.whois g <jid> --doc` → kirim sebagai dokumen (grup besar)\n\n' +
  'Data diambil dari core/usage.js yang merekam per (orang, chat).\n' +
  'Alias: `.siapapakai`, `.pengguna`, `.pemakai` (`.pakai` milik item RPG).'
export default {
  name: 'whois',
  aliases: ['siapapakai', 'pengguna', 'pemakai', 'pakaiwho'],
  tags: 'owner',
  owner: true,
  description: 'Cek siapa saja yang memakai bot, di PM atau grup (.whois)',
  async run(ctx) {
    const args = (ctx.text || '').trim().split(/\s+/).filter(Boolean)
    const mode = (args[0] || '').toLowerCase()
    const value = (args[1] || '').trim()
    try {
      if (!mode || mode === 'list') return await renderChats(ctx)
      if (mode === 'me') return await renderSelf(ctx)
      if (mode === 'g' || mode === 'grup' || mode === 'group') {
        if (!value) {
          return ctx.reply(
            `⚠️ JID grup-nya mana?\n\n` +
            'JID bisa dilihat dari \`.whois\` — formatnya \`120363…@g.us\`.'
          )
        }
        const jid = value.includes('@') ? value : `${value}@g.us`
        return await renderChatUsers(ctx, jid)
      }
      if (mode === 'u' || mode === 'user') {
        if (!value) return ctx.reply('⚠️ Nomor yang mana? Contoh: `.whois u 628123456789`')
        return await renderUserChats(ctx, normalizeNumber(value))
      }
      
      if (value.includes('@g.us')) return await renderChatUsers(ctx, value)
      if (/^\d{6,}$/.test(mode)) return await renderUserChats(ctx, normalizeNumber(mode))
      return ctx.reply(HELP)
    } catch (error) {
      console.error('[WHOIS ERROR]', error)
      return ctx.reply(`❌ Gagal: ${String(error?.message || error).slice(0, 200)}`)
    }
  },
}