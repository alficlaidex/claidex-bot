/**
 * Claide Bot by Alfi
 * core/richRegistry.js — Registry handler tombol quick reply.
 *
 * Kenapa modul terpisah dari handlers/messageHandler.js: `onRichReply` dipakai
 * oleh feature (feat/) DAN core (core/groupRequest.js). Kalau registry-nya tinggal
 * di messageHandler, modul yang mengimpornya ikut mencycla, dan karena
 * `const richHandlers = new Map()` baru ter-initialize setelah body modul
 * selesai, modul lain yang memanggil onRichReply lebih dulu akan kena
 * "Cannot access 'richHandlers' before initialization" — bot tidak start sama
 * sekali.
 *
 * Modul ini sengaja tidak mengimpor apa pun dari repo, jadi tidak pernah bisa
 * ikut menjadi siklus.
 */
const registry = new Map()

export function onRichReply(id, handler) {
  registry.set(id, handler)
}

/**
 * Lepas satu handler (atau semuanya). Dipakai feature yang mendaftarkan handler
 * dinamis per sesi user — tanpa ini registry tumbuh tanpa batas dan handler
 * milik sesi yang sudah kedaluwarsa tetap bisa dipicu.
 */
export function unregisterRichReply(id) {
  if (id === undefined) return registry.clear()
  return registry.delete(id)
}

export function getRichHandler(id) {
  // Exact dulu: id pendek seperti "allowreq:list" tidak boleh tertimpa prefix.
  const direct = registry.get(id)
  if (direct) return direct

  // Prefix kedua, untuk id yang membawa JID ("allowreq:yes:120363…@g.us").
  // JID tidak diketahui waktu modul dimuat, jadi satu handler per JID
  // tidak bisa didaftarkan. Yang terpanjang menang supaya handler spesifik
  // tidak kalah dari handler umum.
  let best = null
  let bestLen = 0
  for (const [key, handler] of registry) {
    if (!key.includes(':')) continue
    if (!id.startsWith(`${key}:`)) continue
    if (key.length > bestLen) {
      best = handler
      bestLen = key.length
    }
  }
  return best
}

export function richHandlerCount() {
  return registry.size
}