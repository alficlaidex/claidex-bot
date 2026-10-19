import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const FEAT_ROOT = path.join(REPO_ROOT, 'feat')
const BLOCKED = new Set(['app.js', 'config.js', 'package.json', 'package-lock.json', '.env'])
const SELF_PROTECT = new Set(['sf.js', 'df.js'])
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
  name: 'df',
  aliases: ['delfile'],
  tags: 'owner',
  owner: true,
  description: 'Hapus file fitur (.df owner/xxx)',
  async run(ctx) {
    const input = (ctx.text || '').trim()
    if (!input) {
      return ctx.reply(
        '🗑️ *DF — Delete File*\n\n' +
        '`.df owner/xxx`\n' +
        'Contoh: `.df downloader/tiktok` → hapus feat/downloader/tiktok.js\n\n' +
        'Hapus permanen, hati-hati.'
      )
    }
    const target = resolveTarget(input)
    if (!target) return ctx.reply('🚫 Path gak diizinkan (harus di dalam `feat/`, bukan file sistem).')
    if (SELF_PROTECT.has(path.basename(target.resolved))) {
      return ctx.reply('🛡️ `sf.js` / `df.js` gak bisa hapus dirinya sendiri.')
    }
    try {
      const stat = await fs.stat(target.resolved)
      if (!stat.isFile()) return ctx.reply('⚠️ Bukan file: `' + target.rel + '`')
      await fs.unlink(target.resolved)
      await ctx.reply(`🗑️ *Dihapus:* \`${target.rel}\`\n🔄 \`.reload\` buat refresh daftar feature.`)
    } catch (e) {
      if (e.code === 'ENOENT') return ctx.reply('⚠️ File gak ada: `' + target.rel + '`')
      await ctx.reply('❌ Gagal hapus: ' + String(e.message || e).slice(0, 200))
    }
  }
}