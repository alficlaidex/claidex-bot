/**
 * Claide Bot by Alfi
 * core/groupAccess.js — Gerbang akses grup (allowlist).
 *
 * Default `allowlist`: bot HANYA merespons di grup yang owner sudah izinkan.
 * Grup lain diabaikan total — bot jadi diam, bukan membalas pesan error (yang
 * justru bikin bot kelihatan rusak di grup stranger).
 *
 * Kenapa default-nya `allowlist` dan bukan `open`: kalau defaultnya `open`,
 * `isAllowed()` selalu true untuk grup apa pun, sehingga fungsi lapor-grup tidak
 * pernah dipanggil sama sekali dan fitur ini kelihatan "otomatis allow".
 * Owner yang memang mau bot terbuka di semua grup bisa `.allow open`.
 *
 * Yang diatur HANYA grup. PM selalu boleh: private message bukan surface
 * publik, jadi allowlist tidak relevan di sana.
 */
import { getSetting, setSetting } from './groupSettings.js'

const GLOBAL_JID = '__global__'
const MODE_KEY = 'access_mode'
const ALLOWED_KEY = 'access_allowed'

/** 'allowlist' | 'open' — mode global, berlaku ke semua grup. */
export function accessMode() {
  const value = getSetting(GLOBAL_JID, MODE_KEY)
  // Default allowlist: bot tidak boleh masuk grup baru tanpa izin owner.
  if (value === 'open') return 'open'
  return 'allowlist'
}

export function setAccessMode(mode) {
  setSetting(GLOBAL_JID, MODE_KEY, mode === 'open' ? 'open' : 'allowlist')
}

/** Mode milik satu grup: default-nya mengikuti mode global. */
export function groupAccessMode(groupJid) {
  const own = getSetting(groupJid, MODE_KEY)
  if (own === 'allowlist') return 'allowlist'
  if (own === 'open') return 'open'
  return accessMode()
}

export function setGroupAccessMode(groupJid, mode) {
  setSetting(groupJid, MODE_KEY, mode === 'open' ? 'open' : 'allowlist')
}

export function isAllowed(groupJid) {
  if (groupAccessMode(groupJid) === 'open') return true
  return getSetting(groupJid, ALLOWED_KEY) === '1'
}

export function setAllowed(groupJid, allowed) {
  setSetting(groupJid, ALLOWED_KEY, allowed ? '1' : '0')
}

/**
 * Vrifikasi bot boleh merespons di chat ini. `isGroup` membedakan surface;
 * PM selalu true.
 */
export function canServe({ chat, isGroup }) {
  if (!isGroup) return true
  return isAllowed(chat)
}

/**
 * Chat yang boleh dilayani DIAM-DIAM tanpa melapor ke owner.
 *
 * Penting: tanpa ini, owner sendiri yang menjalankan `.allow <jid>` di grup
 * yang belum di-allow akan memicu lapor-grup — owner-boycott sendiri, karena
 * bot tidak bisa merespons perintah owner di grup yang belum diizinkan.
 */
const QUIET_JIDS = new Set([
  '__global__',
  'status@broadcast',
  '0@status',
])

export function isOwnerChat(chat, isOwner) {
  return Boolean(isOwner) || QUIET_JIDS.has(String(chat ?? '').split(':')[0])
}