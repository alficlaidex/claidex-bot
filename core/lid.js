/**
 * Claide Bot by Alfi
 * Based on Fiony Bot © JamvanHax0r. Upstream attribution is preserved.
 * core/lid.js — Canonical PN/LID helpers for group addressing.
 */

const isPn = (jid) => typeof jid === 'string' && jid.endsWith('@s.whatsapp.net')
const isLid = (jid) => typeof jid === 'string' && jid.endsWith('@lid')
const bareJid = (jid) => String(jid || '').split(':')[0]
const phoneFromJid = (jid) => bareJid(jid).split('@')[0]

function participantPhoneJid(participant) {
  if (typeof participant === 'string') return isPn(participant) ? participant : null
  if (isPn(participant?.jid)) return participant.jid
  if (participant?.phoneNumber) return `${String(participant.phoneNumber).replace(/\D/g, '')}@s.whatsapp.net`
  if (isPn(participant?.phoneJid)) return participant.phoneJid
  if (isPn(participant?.pnJid)) return participant.pnJid
  return null
}

function participantLidJid(participant) {
  if (typeof participant === 'string') return isLid(participant) ? participant : null
  if (isLid(participant?.jid)) return participant.jid
  if (isLid(participant?.lid)) return participant.lid
  if (isLid(participant?.lidJid)) return participant.lidJid
  return null
}

async function findPhoneForLid(client, metadata, lid) {
  const target = bareJid(lid)
  for (const participant of metadata?.participants ?? []) {
    if (participantLidJid(participant) !== target) continue
    const phone = participantPhoneJid(participant)
    if (phone) return phone
  }

  const phoneJids = (metadata?.participants ?? [])
    .map(participantPhoneJid)
    .filter(Boolean)
  if (phoneJids.length) {
    const rows = await client.profile.getLidsByPhoneNumbers(phoneJids.map(phoneFromJid))
    for (const row of rows) {
      if (bareJid(row?.lidJid) === target) return row.phoneJid || row.queriedJid || lid
    }
  }
  return lid
}

async function findLidForPhone(client, metadata, phoneJid) {
  const target = phoneFromJid(phoneJid)
  for (const participant of metadata?.participants ?? []) {
    const phone = participantPhoneJid(participant)
    if (phone && phoneFromJid(phone) === target) {
      const lid = participantLidJid(participant)
      if (lid) return lid
    }
  }

  const rows = await client.profile.getLidsByPhoneNumbers([target])
  return rows.find((row) => row?.lidJid)?.lidJid || phoneJid
}

export async function resolveLidToPn(client, groupJid, jid) {
  if (!isLid(jid)) return jid
  try {
    const metadata = await client.group.queryGroupMetadata(groupJid)
    return await findPhoneForLid(client, metadata, jid)
  } catch {
    return jid
  }
}

export async function resolveGroupTargetJid(client, groupJid, target) {
  const clean = bareJid(target)
  if (isLid(clean) || isPn(clean)) return clean

  const digits = String(clean).replace(/\D/g, '')
  if (!digits) throw new Error('Nomor target tidak valid')
  const phoneJid = `${digits}@s.whatsapp.net`
  const metadata = await client.group.queryGroupMetadata(groupJid)
  if (metadata?.addressingMode === 'lid') {
    return findLidForPhone(client, metadata, phoneJid)
  }
  return phoneJid
}

export function groupParticipantJids(metadata) {
  return (metadata?.participants ?? [])
    .map((participant) => typeof participant === 'string' ? participant : participant?.jid)
    .filter(Boolean)
}

export async function sendMention(client, chat, jid, text) {
  const target = bareJid(jid)
  const marker = `@${phoneFromJid(target)}`
  await client.message.send(chat, {
    extendedTextMessage: {
      text: String(text).replace('@user', marker),
      contextInfo: { mentionedJid: [target] },
    },
  })
}
