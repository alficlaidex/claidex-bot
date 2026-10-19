
function getEvent(ctx) {
  return ctx.message ?? ctx.event ?? ctx.raw ?? ctx.msg ?? null
}
function getContextInfo(message) {
  if (!message || typeof message !== 'object') return null
  for (const key of Object.keys(message)) {
    const node = message[key]
    if (node && typeof node === 'object' && node.contextInfo) return node.contextInfo
  }
  return null
}
function normalizeNumber(input) {
  let n = String(input).replace(/[^\d]/g, '')
  if (!n || n.length < 8) return null
  if (n.startsWith('0')) n = '62' + n.slice(1)
  return n + '@s.whatsapp.net'
}
function getOwnJid(client) {
  const reads = [
    () => client?.auth?.getState?.()?.me?.id,
    () => client?.getCredentials?.()?.me?.id,
    () => client?.auth?.creds?.me?.id,
    () => client?.auth?.state?.creds?.me?.id,
    () => client?.store?.auth?.creds?.me?.id
  ]
  for (const fn of reads) {
    try {
      const v = fn()
      if (v && typeof v === 'string') return v
    } catch {}
  }
  return null
}
async function fetchPicture(client, jid, altJid) {
  try {
    return await client.profile.getProfilePicture(jid, 'image')
  } catch (e) {
    const msg = String(e.message || e)
    if (!/401/.test(msg)) throw e
    if (altJid) {
      try {
        return await client.profile.getProfilePicture(altJid, 'image')
      } catch {}
    }
    if (/@s\.whatsapp\.net$/.test(jid)) {
      const digits = jid.split('@')[0].split(':')[0]
      try {
        const results = await client.profile.getLidsByPhoneNumbers(['+' + digits])
        const lid = results?.[0]?.lidJid
        if (lid) return await client.profile.getProfilePicture(lid, 'image')
      } catch {}
    }
    throw e
  }
}
export default {
  name: 'getpp',
  aliases: ['getprofile', 'ambilpp'],
  tags: 'owner',
  owner: true,
  description: 'Ambil foto profile resolusi penuh (mention/quote/nomor/username/bot/self)',
  async run(ctx) {
    const event = getEvent(ctx)
    const rawMessage = event?.message ?? event
    const ci = getContextInfo(rawMessage)
    const text = (ctx.text || '').trim()
    let targetJid = null
    let altJid = null
    let label = 'lo sendiri'
    if (ci?.mentionedJid?.[0]) {
      targetJid = ci.mentionedJid[0]
      label = 'target mention'
    } else if (ci?.participant) {
      targetJid = ci.participant
      label = 'target quote'
    } else if (/\+?\d{8,15}/.test(text)) {
      targetJid = normalizeNumber(text.match(/\+?\d{8,15}/)[0])
      label = 'target nomor'
    } else if (/^bot$/i.test(text)) {
      targetJid = getOwnJid(ctx.client)
      label = 'bot sendiri'
      if (!targetJid) {
        return ctx.reply('⚠️ JID bot gak kedetect di Zapo versi ini. Pakai `.getpp <nomor bot>` buat ambil PP bot.')
      }
    } else if (/^@?[a-z0-9._]{3,30}(:\d{4})?$/i.test(text)) {
      try {
        const res = await ctx.client.profile.resolveUsername({ username: text })
        if (res?.status === 'found') {
          targetJid = res.jid || res.pnJid || null
          altJid = res.pnJid && res.pnJid !== targetJid ? res.pnJid : (res.jid && res.jid !== targetJid ? res.jid : null)
          label = 'target username'
        } else if (res?.status === 'key-required') {
          return ctx.reply('🔑 Username ini butuh key 4 digit. Pakai: `.getpp ' + text.replace(/^@/, '') + ':1234` (ganti 1234 sama key-nya).')
        } else {
          return ctx.reply('⚠️ Username `' + text + '` gak ketemu di WA.')
        }
      } catch (e) {
        return ctx.reply('⚠️ Gagal resolve username: ' + String(e.message || e).slice(0, 150))
      }
      if (!targetJid) return ctx.reply('⚠️ Username ketemu tapi JID-nya kosong.')
    } else if (ci?.quotedMessage && ci?.remoteJid) {
      targetJid = ci.remoteJid
      label = 'target quote'
    } else {
      targetJid = ctx.sender
      label = 'kau sendiri'
    }
    if (!targetJid) {
      return ctx.reply('⚠️ Target gak jelas. Contoh: `.getpp @user`, `.getpp 628xxx`, `.getpp @username`, `.getpp bot`.')
    }
    await ctx.react('⏳')
    try {
      const pic = await fetchPicture(ctx.client, targetJid, altJid)
      if (!pic?.url) {
        await ctx.react('❎')
        return ctx.reply('⚠️ Foto profile target gak tersedia — kemungkinan private atau belum pernah pasang PP.')
      }
      const res = await fetch(pic.url)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const buf = Buffer.from(await res.arrayBuffer())
      await ctx.client.message.send(ctx.chat, {
        type: 'image',
        media: buf,
        mimetype: 'image/jpeg',
        caption: label === 'bot sendiri'
          ? '📸 Ini PP ku sendiri, Kak.'
          : '📸 Ini dia PP-nya, Kak.'
      })
      await ctx.react('✅')
    } catch (e) {
      await ctx.react('❎')
      ctx.reply('Gagal ambil foto profile: ' + String(e.message || e).slice(0, 200))
    }
  }
}