/**
 * Claide Bot by Alfi
 * core/usage.js — Rekam siapa saja yang memakai bot, di chat mana.
 *
 * Kenapa tabel terpisah dari `users`: tabel users cuma tahu "orang ini pernah
 * nge-pake bot" per JID, jadi tidak bisa jawab pertanyaan "siapa aja yang
 * pake bot di grup ini". Yang dibutuhkan di sini justru pemisahan per CHAT —
 * satu orang bisa dipakai di PM dan di beberapa grup sekaligus.
 *
 * Tulisnya satu baris per (jid, chat) dengan counter, jadi query "top user"
 * itu SUM per kolom, bukan COUNT baris.
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'

const sessionDir = './session'
if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true })

const db = new Database(`${sessionDir}/usage.sqlite`)

db.exec(`
  CREATE TABLE IF NOT EXISTS bot_usage (
    jid TEXT NOT NULL,
    chat TEXT NOT NULL,
    name TEXT,
    commands INTEGER NOT NULL DEFAULT 0,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    PRIMARY KEY (jid, chat)
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS bot_group_requests (
    group_jid TEXT PRIMARY KEY,
    requested_by TEXT,
    requested_by_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  )
`)

db.exec('CREATE INDEX IF NOT EXISTS idx_usage_chat ON bot_usage(chat)')
db.exec('CREATE INDEX IF NOT EXISTS idx_usage_jid ON bot_usage(jid)')

const recordStmt = db.prepare(`
  INSERT INTO bot_usage (jid, chat, name, commands, first_seen, last_seen)
  VALUES (?, ?, ?, 1, ?, ?)
  ON CONFLICT(jid, chat) DO UPDATE SET
    commands = commands + 1,
    last_seen = excluded.last_seen,
    name = COALESCE(excluded.name, bot_usage.name)
`)

/** Catat satu pemakaian command. Owner juga ikut tercatat — justru itu gunanya. */
export function recordUsage(jid, chat, name) {
  if (!jid || !chat) return
  const now = Date.now()
  try {
    recordStmt.run(jid, chat, name ?? null, now, now)
  } catch (error) {
    console.log('[usage] record gagal:', error?.message || error)
  }
}

/** Semua chat (grup) yang pernah dipakai, dengan jumlah orang & command. */
export function listChats({ limit = 50 } = {}) {
  return db
    .prepare(
      `SELECT chat,
              COUNT(*) AS people,
              SUM(commands) AS commands,
              MAX(last_seen) AS last_seen
         FROM bot_usage
        GROUP BY chat
        ORDER BY last_seen DESC
        LIMIT ?`
    )
    .all(limit)
}

export function countChats() {
  return db.prepare('SELECT COUNT(DISTINCT chat) AS c FROM bot_usage').get().c
}

/** Orang-orang yang memakai bot di satu chat tertentu. */
export function usageInChat(chat, { limit = 100 } = {}) {
  return db
    .prepare(
      `SELECT jid, name, commands, first_seen, last_seen
         FROM bot_usage
        WHERE chat = ?
        ORDER BY commands DESC, last_seen DESC
        LIMIT ?`
    )
    .all(chat, limit)
}

/** Satu orang: semua chat yang pernah dia pakai. */
export function usageByUser(jid, { limit = 50 } = {}) {
  return db
    .prepare(
      `SELECT chat, name, commands, first_seen, last_seen
         FROM bot_usage
        WHERE jid = ?
        ORDER BY last_seen DESC
        LIMIT ?`
    )
    .all(jid, limit)
}

/** Ringkasan global: jumlah orang unik, jumlah chat, jumlah command. */
export function usageSummary() {
  return db
    .prepare(
      `SELECT COUNT(DISTINCT jid) AS people,
              COUNT(DISTINCT chat) AS chats,
              COALESCE(SUM(commands), 0) AS commands
         FROM bot_usage`
    )
    .get()
}

/* ---------- Permintaan izin grup ---------- */

/**
 * Catat grup yang minta izin. `createdAt` sengaja disimpan supaya pemanggil bisa
 * menentukan "sudah pernah lapor belum" tanpa perlu kolom status terpisah.
 */
export function upsertGroupRequest(groupJid, { by, byName }) {
  const now = Date.now()
  db.prepare(
    `INSERT INTO bot_group_requests (group_jid, requested_by, requested_by_name, status, created_at, resolved_at)
     VALUES (?, ?, ?, 'pending', ?, NULL)
     ON CONFLICT(group_jid) DO UPDATE SET
       requested_by = excluded.requested_by,
       requested_by_name = excluded.requested_by_name,
       status = 'pending',
       created_at = excluded.created_at,
       resolved_at = NULL`
  ).run(groupJid, by ?? null, byName ?? null, now)
}

export function getGroupRequest(groupJid) {
  return db.prepare('SELECT * FROM bot_group_requests WHERE group_jid = ?').get(groupJid)
}

export function listGroupRequests({ status } = {}) {
  const sql = status
    ? 'SELECT * FROM bot_group_requests WHERE status = ? ORDER BY created_at DESC LIMIT 100'
    : 'SELECT * FROM bot_group_requests ORDER BY created_at DESC LIMIT 100'
  return status ? db.prepare(sql).all(status) : db.prepare(sql).all()
}

export function setGroupRequestStatus(groupJid, status) {
  db.prepare(
    'UPDATE bot_group_requests SET status = ?, resolved_at = ? WHERE group_jid = ?'
  ).run(status, Date.now(), groupJid)
}