/**
 * © JamvanHax0r — Fiony Bot
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * location.js — Location & travel logic Nusantara Wilds.
 * Travel butuh gear tertentu (obor/tali/kompas), modifier drop sesuai lokasi.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getCharacter, updateCharacter, getInventory } from './rpg.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const LOCATIONS = JSON.parse(readFileSync(join(__dirname, '../src/rpg/locations.json'), 'utf8'))

export function getLocations() {
  return LOCATIONS.locations
}

export function getLocation(id) {
  return LOCATIONS.locations.find((l) => l.id === id) ?? null
}

/** Cek apakah player punya semua gear yang dibutuhkan buat travel ke lokasi. */
export function checkRequirements(jid, locationId) {
  const loc = getLocation(locationId)
  if (!loc) return { ok: false, error: 'not_found' }

  const inv = getInventory(jid)
  const missing = loc.requirements.filter((reqId) => {
    const owned = inv.find((r) => r.item_id === reqId)
    return !owned || owned.amount < 1
  })

  if (missing.length) {
    return { ok: false, missing }
  }

  return { ok: true }
}

/** Travel ke lokasi baru. */
export function travelTo(jid, locationId) {
  const loc = getLocation(locationId)
  if (!loc) return { error: 'not_found' }

  const req = checkRequirements(jid, locationId)
  if (!req.ok) return { error: 'requirements', missing: req.missing }

  updateCharacter(jid, { location: locationId })
  return { success: true, location: loc }
}

/** Get current location info. */
export function getCurrentLocation(jid) {
  const char = getCharacter(jid)
  return getLocation(char.location) ?? getLocation('desa')
}

/** Get drop modifier buat lokasi sekarang. */
export function getDropModifier(jid) {
  const loc = getCurrentLocation(jid)
  return loc?.drop_modifier ?? 1.0
}
