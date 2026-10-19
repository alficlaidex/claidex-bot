import { getContextInfo, unwrapMessage } from 'zapo-js'
import { isGroupAdmin } from '../../core/permission.js'
import { logger } from '../../core/logger.js'

// Cara pakai: balas (reply) pesan yang mau dihapus lalu kirim .del
//
// API: client.message.send(chat, { type: 'revoke', target })
// `target` boleh WaMessageKey { remoteJid, id, fromMe, participant } atau event
// message apa adanya. Karena pesan yang dibalas hanya membawa isinya (quotedMessage)
// tanpa stanza id, id diambil dari contextInfo.stanzaId. fromMe wajib diketahui:
// WA membedakan "undo pesan sendiri" (bisa tanpa admin) dari "hapus pesan orang
// lain" (harus admin grup).
//
// Batas WA: hanya pesan dalam ~2 jam terakhir, dan pesan orang lain hanya bisa
// dihapus kalau grup mengizinkan admin delete untuk member ('allow_admin_reports').
// Tipe 'revoke' bukan tipe khusus — ini protocolMessage biasa, tanpa OTP.

function targetFromReply(ctx) {
  const info = getContextInfo(ctx.event?.message)
  if (!info?.stanzaId) return null
  return {
    id: info.stanzaId,
    // Penulis pesan yang dibalas. WA butuh participant di grup; kalau kosong
    // (mis. pesan lama yang di-reply dari sesi lain) isi dari participantPn.
    participant: info.participant || info.participantPn || undefined,
  }
}

function previewOf(ctx) {
  const info = getContextInfo(ctx.event?.message)
  const quoted = info?.quotedMessage
  if (!quoted) return '(pesan)'
  const inner = unwrapMessage(quoted)
  return (
    inner.conversation ??
    inner.extendedTextMessage?.text ??
    inner.imageMessage?.caption ??
    inner.videoMessage?.caption ??
    '(media)'
  )
}

function clip(value = '', max = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export default {
  name: 'del',
  aliases: ['delete', 'hapus', 'delmsg', 'remove'],
  tags: 'group',
  admin: true,
  description: 'Hapus pesan di grup (balas pesannya lalu .del)',
  async run(ctx) {
    if (!ctx.isGroup) {
      await ctx.reply('🚫 Khusus grup.')
      return
    }
    const target = targetFromReply(ctx)
    if (!target) {
      await ctx.reply(
        `🗑️ *Hapus Pesan*\n\n` +
          `Balas (reply) pesan yang mau dihapus, lalu kirim ${ctx.prefix}${ctx.command}.\n\n` +
          'Contoh: tahan pesan → Balas → ketik `.del`\n\n' +
          '_Catatan: WA cuma izinin hapus pesan ~2 jam terakhir. ' +
          'Pesan orang lain butuh pengirim mengizinkan admin menghapusnya._'
      )
      return
    }

    // fromMe: pesan milik sendiri bisa dihapus tanpa admin. Selain itu harus
    // admin/superadmin grup.
    const author = target.participant
    const isOwn = author === ctx.sender || author === ctx.senderLid
    if (!isOwn && !(await isGroupAdmin(ctx))) {
      await ctx.reply('🚫 Hanya Admin grup yang bisa hapus pesan orang lain.')
      return
    }

    const preview = clip(previewOf(ctx))
    await ctx.react('🗑️').catch(() => {})
    try {
      await ctx.client.message.send(ctx.chat, {
        type: 'revoke',
        target: {
          remoteJid: ctx.chat,
          id: target.id,
          fromMe: isOwn,
          participant: target.participant,
        },
      })
      await ctx.react('✅').catch(() => {})
      logger.info(
        `🗑️ del: ${ctx.senderNumber} hapus pesan ${target.id} di ${ctx.chat}` +
          `${isOwn ? ' (miliknya sendiri)' : ' (pesan orang lain)'} — "${preview}"`
      )
    } catch (err) {
      await ctx.react('❌').catch(() => {})
      const why = String(err?.message || err).slice(0, 150)
      logger.error({ err, target: target.id, chat: ctx.chat }, 'del: revoke gagal')
      await ctx.reply(
        `😵 Gagal hapus pesan.\n\n` +
          `Pesan: _${preview}_\n` +
          `Alasan: ${why}\n\n` +
          'Penyebab umum: sudah lewat ~2 jam, pesan pengirim tidak mengizinkan ' +
          'admin menghapus, atau bot bukan admin.'
      )
    }
  },
}
