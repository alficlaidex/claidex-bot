import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const FEAT_ROOT = path.join(REPO_ROOT, 'feat')
const BLOCKED = new Set(['app.js', 'config.js', 'package.json', 'package-lock.json', '.env'])
const MAX_BYTES = 500 * 1024
function getEvent(ctx) {
  return ctx.message ?? ctx.event ?? ctx.raw ?? ctx.msg ?? null
}
function getContextInfo(message) {
  if (!message) return null
  for (const key of Object.keys(message)) {
    const node = message[key]
    if (node && typeof node === 'object' && node.contextInfo) return node.contextInfo
  }
  return null
}
function getQuotedText(ctx) {
  const event = getEvent(ctx)
  const raw = event?.message ?? event
  const q = getContextInfo(raw)?.quotedMessage
  if (!q) return ''
  return (
    q.conversation ||
    q.extendedTextMessage?.text ||
    q.imageMessage?.caption ||
    q.videoMessage?.caption ||
    q.documentMessage?.caption ||
    ''
  )
}
function resolveTarget(input) {
  let p = String(input || '').trim().replace(/^\/+/, '')
  if (!p) return null
  if (!p.startsWith('feat/')) p = 'feat/' + p
  if (!p.endsWith('.js')) p += '.js'
  const resolved = path.resolve(REPO_ROOT, p)
  if (!resolved.startsWith(FEAT_ROOT + path.sep)) return null
  if (BLOCKED.has(path.basename(resolved))) return null
  return { resolved, rel: path.relative(REPO_ROOT, resolved) }
}
export default {
  name: 'sf',
  aliases: ['savefile'],
  tags: 'owner',
  owner: true,
  description: 'Simpan isi pesan yg di-quote jadi file fitur (.sf owner/xxx)',
  async run(ctx) {
    const input = (ctx.text || '').trim()
    if (!input) {
      return ctx.reply(
        '💾 *SF — Save File*\n\n' +
        'Kirim kode sebagai pesan, quote pesan itu, lalu:\n' +
        '`.sf owner/xxx`\n\n' +
        'Path otomatis di-root ke `feat/`, extension `.js` otomatis.\n' +
        'Contoh: `.sf downloader/tiktok` → feat/downloader/tiktok.js'
      )
    }
    const content = getQuotedText(ctx)
    if (!content) return ctx.reply('⚠️ Quote dulu pesan yang berisi kode/file-nya, Kak.')
    const target = resolveTarget(input)
    if (!target) return ctx.reply('🚫 Path gak diizinkan (harus di dalam `feat/`, bukan file sistem).')
    const size = Buffer.byteLength(content, 'utf8')
    if (size > MAX_BYTES) return ctx.reply(`⚠️ Kebesaran: ${(size / 1024).toFixed(1)} KB (maks 500 KB).`)
    try {
      await fs.mkdir(path.dirname(target.resolved), { recursive: true })
      const existed = await fs.stat(target.resolved).then(() => true).catch(() => false)
      await fs.writeFile(target.resolved, content, 'utf8')
      await ctx.reply(
        `✅ *File ${existed ? 'di-update' : 'disimpan'}*\n\n` +
        `📄 \`${target.rel}\`\n📏 ${(size / 1024).toFixed(1)} KB\n` +
        `🔄 Hot-reload nangkep otomatis, atau \`.reload\`.`
      )
    } catch (e) {
      await ctx.reply('❌ Gagal simpan: ' + String(e.message || e).slice(0, 200))
    }
  }
}