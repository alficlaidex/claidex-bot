/**
 * © JamvanHax0r — Fiony Bot
 * Hapus credit gak bikin u jago dumbass. 
 * Hargai sebagaimana u mau dihargai.
 * cooldown.js — Anti-spam & cooldown management
 */

const perUserCommand = new Map()
const perUserFlood = new Map()

// Batas keras biar Map gak tumbuh tanpa kendali. Command token datang dari
// user (bisa random), jadi tanpa sweep entries menumpuk selamanya.
const MAX_COOLDOWN_ENTRIES = 5000
const MAX_FLOOD_ENTRIES = 5000
// Sweep paling lama 5 menit — cukup untuk semua cooldown di bot ini.
const SWEEP_AGE_MS = 5 * 60 * 1000

function sweepCooldown(now) {
  if (perUserCommand.size <= MAX_COOLDOWN_ENTRIES) return
  for (const [key, at] of perUserCommand) {
    if (now - at > SWEEP_AGE_MS) perUserCommand.delete(key)
  }
  // Kalau masih penuh (semua masih fresh), pangkas yang paling tua.
  while (perUserCommand.size > MAX_COOLDOWN_ENTRIES) {
    const oldest = perUserCommand.keys().next()
    if (oldest.done) break
    perUserCommand.delete(oldest.value)
  }
}

function sweepFlood(now) {
  if (perUserFlood.size <= MAX_FLOOD_ENTRIES) return
  for (const [id, st] of perUserFlood) {
    const idle = !st.mutedUntil || st.mutedUntil <= now
    const noHits = !Array.isArray(st.hits) || st.hits.length === 0
    if (idle && noHits) perUserFlood.delete(id)
  }
  while (perUserFlood.size > MAX_FLOOD_ENTRIES) {
    const oldest = perUserFlood.keys().next()
    if (oldest.done) break
    perUserFlood.delete(oldest.value)
  }
}

/**
 * @param {string} command - WAJIB nama kanonik feature (feature.name), bukan
 *   token mentah yang diketik user. Kalau token mentah yang dipakai, alias
 *   (.forage / .fish) dan variasi huruf besar (.HUNT) masing-masing punya key
 *   sendiri — cooldown per-feature jadi bisa dielakkan.
 */
export function checkCooldown(userId, command, cooldownMs = 0) {
  if (!cooldownMs || cooldownMs <= 0) return { onCooldown: false, remainingMs: 0 }

  const key = `${userId}:${command}`
  const now = Date.now()
  sweepCooldown(now)
  const last = perUserCommand.get(key) ?? 0

  if (now - last < cooldownMs) {
    return { onCooldown: true, remainingMs: cooldownMs - (now - last) }
  }

  perUserCommand.set(key, now)
  return { onCooldown: false, remainingMs: 0 }
}

export function checkFlood(userId, { max = 5, windowMs = 10_000, muteMs = 30_000 } = {}) {
  const now = Date.now()
  sweepFlood(now)
  const state = perUserFlood.get(userId) ?? { hits: [], mutedUntil: 0 }

  if (state.mutedUntil > now) {
    return { flooded: true, remainingMs: state.mutedUntil - now }
  }

  state.hits = state.hits.filter((t) => now - t < windowMs)
  state.hits.push(now)

  if (state.hits.length > max) {
    state.mutedUntil = now + muteMs
    state.hits = []
    perUserFlood.set(userId, state)
    return { flooded: true, remainingMs: muteMs }
  }

  perUserFlood.set(userId, state)
  return { flooded: false, remainingMs: 0 }
}
