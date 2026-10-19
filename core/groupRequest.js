/**
 * Claide Bot by Alfi
 * core/groupRequest.js — Alur "izin grup": grup yang belum di-allow melapor
 * ke owner lewat private message dengan tombol quick reply.
 *
 * Kenapa tombol dan bukan chat: persetujuan itu keputusan owner, jadi harus
 * bisa diketuk dari HP tanpa mengetik command di grup yang belum tentu dia ada.
 * Tombol juga membuat aksi idempotent — tap kedua tidak menambah antrean.
 *
 * Dedupe: satu grup hanya melapor sekali per COOLDOWN_MS. Tanpa itu setiap
 * pesan di grup yang belum di-allow akan mengirim DM ke owner — spam.
 */
import config from '../config.js'
import { logger } from './logger.js'
import { onRichReply } from './richRegistry.js'
import { richButtons } from '../lib/richMessage.js'
import {
  upsertGroupRequest,
  getGroupRequest,
  setGroupRequestStatus,
  listGroupRequests,
} from './usage.js'
import { listChats } from './usage.js'
import { setAllowed, accessMode, isAllowed } from './groupAccess.js'

const COOLDOWN_MS = Number(process.env.GROUP_REQUEST_COOLDOWN_MS || 6 * 60 * 60 * 1000)
const recentSent = new Map() // groupJid -> timestamp

function ownerJids() {
  return (config.staff ?? [])
    .filter((entry) => entry.role === 'owner')
    .map((entry) => `${entry.number}@s.whatsapp.net`)
}

function fmtAgo(ts) {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'baru saja'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} menit lalu`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} jam lalu`
  return `${Math.round(diff / 86_400_000)} hari lalu`
}

/**
 * Kirim permintaan izin ke owner kalau grup ini belum di-allow dan belum
 * melapor belakangan ini. Tidak pernah melempar error — pemanggil ada di jalur
 * routing pesan dan tidak boleh ikut gagal karena notifikasi gagal.
 */
export async function notifyOwnerForGroup(client, { groupJid, groupName, requester, requesterName }) {
  // Kritis: cek mode GLOBAL dulu, bukan mode grup. Default bot ini 'open'
  // (bot jalan di semua grup), jadi kalau yang dicek mode grup, setiap grup baru
  // lolos di isAllowed() dan fungsi ini keluar di baris pertama — owner tidak
  // pernah dikasih tahu. Alert hanya bermakna kalau owner memang sedang
  // menyalakan allowlist.
  if (accessMode() !== 'allowlist') return
  if (isAllowed(groupJid)) return

  // Nama grup mahal (queryGroupMetadata) — baru diambil setelah lolos gate.

  const last = recentSent.get(groupJid)
  if (last && Date.now() - last < COOLDOWN_MS) return
  recentSent.set(groupJid, Date.now())

  upsertGroupRequest(groupJid, { by: requester, byName: requesterName })

  const text =
    '📨 *Permintaan izin grup*\n\n' +
    `🏷️ Grup    : ${groupName || groupJid}\n` +
    `🆔 JID     : ${groupJid}\n` +
    `🙋 Diminta : ${requesterName || '?'} (${(requester || '').split('@')[0]})\n` +
    `🕒 Waktu   : ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n\n` +
    'Bot diam di grup ini sampai kamu putuskan di bawah.'

  const buttons = [
    { id: `allowreq:yes:${groupJid}`, text: '✅ Allow' },
    { id: `allowreq:no:${groupJid}`, text: '❌ Tolak' },
    { id: 'allowreq:list', text: '📋 Daftar' },
  ]

  for (const jid of ownerJids()) {
    try {
      await client.message.send(jid, richButtons({
        text,
        footer: `${config.botName} • izin grup`,
        buttons,
      }))
      logger.info(`📨 izin grup dikirim ke owner: ${groupName || groupJid}`)
    } catch (error) {
      logger.warn(`📨 gagal kirim izin grup ke ${jid}: ${error?.message || error}`)
      // Kalau rich gagal, owner tetap harus tahu ada yang minta.
      try {
        await client.message.send(jid, `${text}\n\nBalas dengan: .allow ${groupJid}`)
      } catch {}
    }
  }
}

async function resolveDecision(ctx, jid, approved) {
  if (!jid) return ctx.reply('⚠️ ID tombol tidak lengkap.')

  const requested = getGroupRequest(jid)

  let groupName = jid
  try {
    const meta = await ctx.client.group.queryGroupMetadata(jid)
    groupName = meta.subject || jid
  } catch {}

  if (approved) {
    setAllowed(jid, true)
    // Sengaja TIDAK menyentuh mode grup di sini. Memaksa mode grup 'open' akan
    // override mode global, jadi grup yang di-allow jadi kebal dari mode
    // allowlist selamanya — itulah yang bikin kelihatan "auto allow".
    setGroupRequestStatus(jid, 'allowed')
    await ctx.reply(`✅ *${groupName}* sekarang di-allow.\n\nBot aktif di grup itu.`)
    logger.info(`✅ grup di-allow: ${groupName} (${jid})`)
  } else {
    setAllowed(jid, false)
    setGroupRequestStatus(jid, 'denied')
    await ctx.reply(`❌ *${groupName}* ditolak. Bot tetap diam di grup itu.`)
    logger.info(`❌ grup ditolak: ${groupName} (${jid})`)
  }

  if (requested?.requested_by) {
    try {
      await ctx.client.message.send(
        requested.requested_by,
        approved
          ? `✅ Grup *${groupName}* sudah di-allow. Bot sekarang aktif di sana.`
          : `❌ Grup *${groupName}* belum di-allowed.`
      )
    } catch {}
  }
}

onRichReply('allowreq:list', async (ctx) => {
  const requests = listGroupRequests({ status: 'pending' })
  const header = '📋 *Permintaan izin grup*\n\n'

  if (!requests.length) return ctx.reply(header + 'Tidak ada permintaan yang menunggu.')

  const knownChats = listChats()
  const body = requests
    .slice(0, 15)
    .map((r, i) => {
      const known = knownChats.find((c) => c.chat === r.group_jid)
      const people = known?.people ?? 0
      return (
        `${i + 1}. *${r.group_jid}*\n` +
        `   Diminta ${r.requested_by_name || '?'} • ${fmtAgo(r.created_at)} • ${people} orang pernah pakai`
      )
    })
    .join('\n\n')

  return ctx.reply(
    `${header}${body}\n\nKetuk tombol di pesan permintaan, atau \`.allow <jid>\` / \`.deny <jid>\`.`
  )
})

// Id tombol membawa JID grup: "allowreq:yes:<groupJid>". Dispatcher di
// messageHandler memakai prefix lookup untuk id seperti ini.
onRichReply('allowreq:yes', async (ctx, reply) => {
  await resolveDecision(ctx, String(reply.id).split(':')[2], true)
})

onRichReply('allowreq:no', async (ctx, reply) => {
  await resolveDecision(ctx, String(reply.id).split(':')[2], false)
})