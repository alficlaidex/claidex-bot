import config from '../../config.js'
import { onRichReply } from '../../core/richRegistry.js'
import {
  accessMode,
  setAccessMode,
  isAllowed,
  setAllowed,
} from '../../core/groupAccess.js'
import { getGroupRequest, setGroupRequestStatus, listChats } from '../../core/usage.js'
async function labelFor(client, jid) {
  try {
    const meta = await client.group.queryGroupMetadata(jid)
    return meta.subject || jid
  } catch {
    return jid
  }
}
function statusIcon(jid) {
  return isAllowed(jid) ? '✅' : accessMode() === 'allowlist' ? '⛔' : '🔓'
}
function statusText(jid) {
  if (isAllowed(jid)) return 'di-allow (bot aktif)'
  return accessMode() === 'allowlist' ? 'DITOLAK (bot diam)' : 'terbuka (bot aktif)'
}
async function renderList(ctx) {
  const groups = listChats({ limit: 60 }).filter((row) => row.chat.endsWith('@g.us'))
  const global = accessMode()
  const header =
    `🛡️ *Akses grup — ${config.botName}*\n\n` +
    `Mode global: *${global === 'open' ? 'OPEN — bot jalan di semua grup' : 'ALLOWLIST — hanya grup yang di-allow'}*\n\n`
  if (!groups.length) {
    return ctx.reply(`${header}Belum ada grup yang tercatat memakai bot (semua pemakaian di PM).`)
  }
  const body = []
  for (const [i, row] of groups.entries()) {
    const label = await labelFor(ctx.client, row.chat)
    body.push(
      `${i + 1}. ${statusIcon(row.chat)} *${label}*\n` +
      `   \`${row.chat}\`\n` +
      `   ${row.people} orang • ${statusText(row.chat)}`
    )
  }
  return ctx.reply(
    `${header}${body.join('\n\n')}\n\n` +
    'Ubah: `.allow <jid>` • `.allow <jid> off` • `.allow allowlist` • `.allow open`'
  )
}
export default {
  name: 'allow',
  aliases: ['deny', 'izin', 'allowlist'],
  tags: 'owner',
  owner: true,
  description: 'Allow/tolak grup + mode allowlist (.allow <jid>)',
  async run(ctx) {
    const args = (ctx.text || '').trim().split(/\s+/).filter(Boolean)
    const mode = (args[0] || '').toLowerCase()
    if (!mode || mode === 'list') return await renderList(ctx)
    if (mode === 'open') {
      setAccessMode('open')
      return ctx.reply('🔓 *Mode OPEN.*\n\nBot akan merespons di semua grup, termasuk yang baru.')
    }
    if (mode === 'allowlist' || mode === 'strict') {
      setAccessMode('allowlist')
      
      return ctx.reply(
        '⛔ *Mode ALLOWLIST aktif.*\n\n' +
        'Bot hanya merespons di grup yang sudah di-allow.\n' +
        'Grup baru melapor ke kamu lewat PM dengan tombol Allow/Tolak.'
      )
    }
    
    const raw = args[0]
    const jid = raw.includes('@') ? raw : `${raw}@g.us`
    const flag = (args[1] || '').toLowerCase()
    const turnOff = flag === 'off' || flag === 'no' || flag === 'false' || ctx.command === 'deny'
    if (!jid.endsWith('@g.us')) {
      return ctx.reply(
        '⚠️ Format: `.allow <jid-grup>` — contoh `.allow 120363…@g.us`.\n' +
        'Cari JID-nya pakai `.allow list`.'
      )
    }
    const label = await labelFor(ctx.client, jid)
    if (turnOff) {
      setAllowed(jid, false)
      setGroupAccessMode(jid, 'allowlist')
      setGroupRequestStatus(jid, 'denied')
      return ctx.reply(`❌ *${label}* dicabut.\n\nBot diam di grup itu.`)
    }
    setAllowed(jid, true)
    setGroupRequestStatus(jid, 'allowed')
    const request = getGroupRequest(jid)
    const suffix = request?.requested_by
      ? `\n\nDiminta oleh ${request.requested_by_name || request.requested_by}.`
      : ''
    return ctx.reply(`✅ *${label}* di-allow.\n\nBot aktif di grup itu.${suffix}`)
  },
}


onRichReply('allowreq:menu', async (ctx) => {
  const strict = accessMode() === 'allowlist'
  return ctx.replyButtons({
    text:
      `🛡️ *Kontrol akses grup*\n\n` +
      `Mode sekarang: *${strict ? 'ALLOWLIST' : 'OPEN'}*\n\n` +
      (strict
        ? 'Bot hanya merespons di grup yang sudah di-allow.\nGrup baru melapor ke sini otomatis.\n'
        : 'Bot merespons di semua grup.\nNyalakan allowlist supaya grup baru harus di-allow dulu.\n'),
    footer: `${config.botName} • akses grup`,
    buttons: [
      { id: strict ? 'allowmenu:open' : 'allowmenu:strict', text: strict ? '🔓 Mode OPEN' : '⛔ Mode ALLOWLIST' },
      { id: 'allowmenu:list', text: '📋 Daftar grup' },
      { id: 'allowreq:list', text: '📨 Permintaan menunggu' },
    ],
  })
})
onRichReply('allowmenu:strict', async (ctx) => {
  setAccessMode('allowlist')
  return ctx.reply('⛔ Mode ALLOWLIST aktif. Grup baru harus di-allow lewat tombol.')
})
onRichReply('allowmenu:open', async (ctx) => {
  setAccessMode('open')
  return ctx.reply('🔓 Mode OPEN. Bot merespons di semua grup.')
})
onRichReply('allowmenu:list', async (ctx) => renderList(ctx))