/**
 * © JamvanHax0r — Fiony Bot
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * messageHandler.js — Routing pesan masuk: richMessage, command, anti-spam.
 */
import config from '../config.js'
import { logger } from '../core/logger.js'
import { buildContext } from '../core/context.js'
import { readRichReply } from '../lib/richMessage.js'
import { getFeature } from '../feat/loader.js'
import { checkCooldown, checkFlood } from '../core/cooldown.js'
import { touchUser, incrementCommand, getUser, topUsers } from '../core/database.js'
import { recordUsage } from '../core/usage.js'
import { canServe } from '../core/groupAccess.js'
import { notifyOwnerForGroup } from '../core/groupRequest.js'
import { onRichReply, getRichHandler } from '../core/richRegistry.js'
import { sendTyping, markRead } from '../core/presence.js'
import { reactTo } from '../core/react.js'

// Registry tombol tinggal di core/richRegistry.js supaya feature & core bisa
// mendaftarkan handler tanpa mengimpor modul ini (dan tanpa siklus import).
export { onRichReply }

// Karakter invisible yang diselipin WA di sekeliling mention
const INVISIBLE_RE = /[\u200b-\u200f\u2060-\u2069\ufeff]/g

function numOnly(jid) {
  return jid?.split('@')[0]?.split(':')[0] ?? jid
}

/** Cari nama tampilan buat satu jid (PN/LID). */
async function nameForJid(client, jid, metaParticipants, userRows) {
  // 1) field nama di metadata (kalau ada)
  const p = (metaParticipants ?? []).find((mp) => {
    if (typeof mp === 'string') return mp === jid
    const ids = [mp.jid, mp.lid, mp.phoneJid, mp.pnJid, mp.participantJid, mp.jidAlt, mp.lidJid, mp.phoneNumber]
    return ids.includes(jid)
  })
  
  let metaName = p && typeof p === 'object' ? (p.pushName || p.name || p.notify || p.verifiedName) : null
  
  // ✅ Tambah phoneNumber handling: kalau ada phoneNumber, lookup ke users DB
  if (!metaName && p?.phoneNumber) {
    const pnJid = `${p.phoneNumber}@s.whatsapp.net`
    const viaPhone = getUser(pnJid)?.name
    if (viaPhone) metaName = viaPhone
  }
  
  if (metaName) return metaName

  // 2) users DB langsung (jid sama)
  const direct = getUser(jid)
  if (direct?.name) return direct.name

  // 3) LID → PN via users DB + batch lookup
  if (jid?.endsWith('@lid')) {
    try {
      const pns = (userRows ?? [])
        .map((r) => r.jid)
        .filter((j) => j?.endsWith('@s.whatsapp.net'))
      if (pns.length) {
        const rows = await client.profile.getLidsByPhoneNumbers(pns.map(numOnly))
        const hit = (rows ?? []).find((r) => r?.lidJid === jid)
        const pn = hit?.phoneJid ?? hit?.queriedJid
        if (pn) {
          const u = (userRows ?? []).find((r) => r.jid === pn)
          if (u?.name) return u.name
        }
      }
    } catch { /* fallback */ }
  }

  return null
}

/** Beautify teks: replace @<jid/lid> dengan @<nama>. */
async function beautifyText(client, chat, text, mentionedJid) {
  if (!text) return text
  // Strip invisible chars biar regex match (WA nyelipin isolate di mention)
  let result = String(text).replace(INVISIBLE_RE, '')
  if (!mentionedJid?.length || !chat?.endsWith('@g.us')) return result

  let metaParticipants = []
  try {
    const meta = await client.group.queryGroupMetadata(chat)
    metaParticipants = meta.participants ?? []
  } catch { /* pakai users DB aja */ }

  const userRows = topUsers(1000)

  for (const jid of mentionedJid) {
    const name = await nameForJid(client, jid, metaParticipants, userRows)
    const display = name ?? numOnly(jid)
    const regex = new RegExp(`@${numOnly(jid)}(?![0-9])`, 'g')
    result = result.replace(regex, `@${display}`)
  }

  return result
}

async function describeMessage(client, chat, message) {
  if (!message) return '(pesan kosong)'

  if (message.conversation) {
    return `teks: "${await beautifyText(client, chat, message.conversation, null)}"`
  }

  if (message.extendedTextMessage?.text) {
    const text = message.extendedTextMessage.text
    const mentioned = message.extendedTextMessage.contextInfo?.mentionedJid ?? []
    return `teks: "${await beautifyText(client, chat, text, mentioned)}"`
  }

  if (message.imageMessage) {
    const caption = message.imageMessage.caption
    const mentioned = message.imageMessage.contextInfo?.mentionedJid ?? []
    const beautified = await beautifyText(client, chat, caption, mentioned)
    return `gambar 📷${beautified ? ` • "${beautified}"` : ''}`
  }

  if (message.videoMessage) {
    const caption = message.videoMessage.caption
    const mentioned = message.videoMessage.contextInfo?.mentionedJid ?? []
    const beautified = await beautifyText(client, chat, caption, mentioned)
    return `video 🎥${beautified ? ` • "${beautified}"` : ''}`
  }

  if (message.stickerMessage) return 'stiker 🟡'
  if (message.audioMessage) return 'audio 🎵'
  if (message.documentMessage) return `dokumen 📄 ${message.documentMessage.fileName ?? ''}`
  if (message.contactMessage) return 'kontak 👤'
  if (message.locationMessage) return 'lokasi 📍'
  const keys = Object.keys(message)
  return keys.length ? `(bentuk belum dikenal: ${keys.join(', ')})` : '(pesan kosong)'
}

export async function route(client, event) {
  if (event.key.fromMe) return

  const ctx = buildContext(client, event)
  const who = `${ctx.pushName || 'Anonim'} +${ctx.senderNumber}`
  const where = ctx.isGroup ? 'GRUP' : 'PRIV'

  if (config.autoRead) void markRead(client, event)

  const richReply = readRichReply(event.message)
  if (richReply) {
    logger.info(`🖱️  ${who} [${where}] memilih "${richReply.id}"`)
    const handler = getRichHandler(richReply.id)
    if (handler) {
      try {
        await handler(ctx, richReply)
      } catch (err) {
        logger.error({ err, id: richReply.id }, 'Handler richMessage gagal')
      }
    } else {
      logger.warn(`⚠️  Tidak ada handler untuk rich id "${richReply.id}"`)
    }
    return
  }

  if (
    event.message?.interactiveResponseMessage ||
    event.message?.buttonsResponseMessage ||
    event.message?.listResponseMessage ||
    event.message?.templateButtonReplyMessage
  ) {
    logger.warn({ raw: event.message }, '🧩 Respons richMessage belum dikenal')
    return
  }

  // ✅ Beautify mention di log
  const desc = await describeMessage(client, ctx.chat, event.message)
  logger.info(`💬 ${who} [${where}] ${desc}`)

  // Gate akses grup. Bot yang belum di-allow TIDAK merespons — diabaikan diam-diam,
  // bukan dibalas pesan error, supaya tidak kelihatan rusak di grup stranger.
  // PM selalu lolos (bukan surface publik).
  if (ctx.isGroup && !canServe({ chat: ctx.chat, isGroup: true })) {
    // Owner tetap dilayani diam-diam di grup manapun. Kalau owner ikut
    // di-silence, dia tidak bisa menjalankan `.allow <jid>` untuk membuka akses
    // grup itu — feature jadi terkunci dari pintu masuknya sendiri.
    if (ctx.isOwner) {
      logger.info(`👑 owner dilayani di grup yang belum di-allow: ${ctx.chat}`)
    } else {
      await notifyOwnerForGroup(client, {
        groupJid: ctx.chat,
        groupName: null,
        requester: ctx.sender,
        requesterName: ctx.pushName,
      }).catch((err) => logger.warn(`📨 notifikasi izin gagal: ${err?.message || err}`))
      return
    }
  }

  if (!ctx.body) return

  let matchedPrefix = ''
  for (const prefix of config.prefixes) {
    if (ctx.body.startsWith(prefix)) {
      matchedPrefix = prefix
      break
    }
  }
  if (!matchedPrefix) return

  const withoutPrefix = ctx.body.slice(matchedPrefix.length).trim()
  const [commandName, ...args] = withoutPrefix.split(/\s+/)
  if (!commandName) return

  const feature = getFeature(commandName)
  if (!feature) return // Command gak ada → diem, no react

  // [UPDATE⭐] REACT: muncul di sini karena command valid
  void reactTo(client, event, '⏱️')

  touchUser(ctx.sender, ctx.pushName)

  if (!ctx.isStaff) {
    const rowPn = getUser(ctx.sender)
    const rowLid = ctx.senderLid ? getUser(ctx.senderLid) : undefined
    if (rowPn?.banned || rowLid?.banned) {
      logger.info(`🚫 ${who} [${where}] di-ban — command ${commandName} ditolak`)
      await ctx.reply('🚫 Kamu telah di-ban oleh owner bot.')
      return
    }
  }

  if (feature.owner && !ctx.isOwner) {
    await ctx.reply('🚫 Fitur ini khusus Owner bot.')
    return
  }

  if (feature.admin && !ctx.isAdmin) {
    await ctx.reply('🚫 Fitur ini khusus Owner/Admin bot.')
    return
  }

  if (!ctx.isStaff && config.antiSpam?.enabled) {
    const flood = checkFlood(ctx.sender, config.antiSpam)
    if (flood.flooded) {
      await ctx.reply(`🐢 Pelan-pelan! Tunggu ${(flood.remainingMs / 1000).toFixed(0)} detik.`)
      return
    }
  }

  if (!ctx.isStaff) {
    // feature.name = nama kanonik. Pakai commandName (token mentah) bikin
    // alias .forage/.fish dan .HUNT lolos cooldown yang sama.
    const cd = checkCooldown(ctx.sender, feature.name, feature.cooldown ?? config.cooldown ?? 0)
    if (cd.onCooldown) {
      await ctx.reply(`⏳ Tunggu ${(cd.remainingMs / 1000).toFixed(1)} detik buat pakai ${matchedPrefix}${commandName}.`)
      return
    }
  }

  if (config.typingPresence) void sendTyping(client, ctx.chat)

  ctx.prefix = matchedPrefix
  ctx.command = commandName.toLowerCase()
  ctx.args = args
  ctx.text = withoutPrefix.slice(commandName.length).trim()

  incrementCommand(ctx.sender)
  // Rekam per-CHAT (bukan per orang) supaya bisa dijawab "siapa aja yang pakai
  // bot di grup ini" dan "di chat mana orang ini pernah pakai".
  recordUsage(ctx.sender, ctx.chat, ctx.pushName)
  logger.info(`⚙️  [CMD] ${matchedPrefix}${commandName} oleh +${ctx.senderNumber}${ctx.role ? ` (${ctx.role})` : ''}`)

  try {
    await feature.run(ctx)
  } catch (err) {
    logger.error({ err, feature: feature.name }, 'Feature gagal dijalankan')
    await ctx.reply(`⚠️ Terjadi error saat menjalankan ${matchedPrefix}${feature.name}.`)
  }
}
