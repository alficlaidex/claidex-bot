
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const ROOT_DIRS = ['feat/', 'lib/', 'scraper/', 'core/', 'handlers/', 'src/']
const ROOT_FILES = ['app.js', 'config.js']
const MAX_SIZE = 5 * 1024 * 1024
const TXT_CHUNK = 50000
function resolveTarget(input) {
  let p = String(input || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!p) return null
  if (!p.endsWith('.js')) p += '.js'
  const isRoot = ROOT_DIRS.some(d => p.startsWith(d)) || ROOT_FILES.includes(p)
  const rel = isRoot ? p : 'feat/' + p
  if (rel.split('/').includes('..')) return null
  const resolved = path.resolve(REPO_ROOT, rel)
  if (!resolved.startsWith(REPO_ROOT + path.sep)) return null
  return { rel, resolved }
}
async function caseFallback(resolved) {
  try {
    const dir = path.dirname(resolved)
    const want = path.basename(resolved).toLowerCase()
    const entries = await fs.readdir(dir)
    const hit = entries.find(n => n.toLowerCase() === want)
    return hit ? path.join(dir, hit) : null
  } catch {
    return null
  }
}
async function listFeatures() {
  const out = []
  async function walk(dir, prefix) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (e.isDirectory()) {
        await walk(path.join(dir, e.name), prefix + e.name + '/')
      } else if (e.name.endsWith('.js')) {
        out.push(prefix + e.name.replace(/\.js$/, ''))
      }
    }
  }
  await walk(path.join(REPO_ROOT, 'feat'), '')
  return out
}
const HELP =
  '📄 *GF — Get Feature*\n\n' +
  '`.gf <path>` → kirim sebagai document .js\n' +
  '`.gf <path> --txt` → kirim sebagai text inline\n' +
  '`.gf list` → daftar semua feature\n\n' +
  'Contoh:\n' +
  '`.gf game/uno`\n' +
  '`.gf game/uno --txt`\n' +
  '`.gf lib/jhrich` → lib/jhrich.js\n' +
  '`.gf scraper/igdl` → case-insensitive\n\n' +
  'Extension `.js` otomatis kalau gak ditulis.'
export default {
  name: 'gf',
  aliases: ['getfeature', 'getfeat'],
  tags: 'owner',
  owner: true,
  description: 'Ambil isi file feature/code (.gf <path> [--txt] / .gf list)',
  async run(ctx) {
    const tokens = (ctx.text || '').trim().split(/\s+/).filter(Boolean)
    const asText = tokens.some(t => t === '--txt' || t === '--text')
    const input = tokens.filter(t => t !== '--txt' && t !== '--text').join(' ')
    if (!input) return ctx.reply(HELP)
    if (/^list$/i.test(input)) {
      try {
        const list = await listFeatures()
        const body = list.slice(0, 80).map(f => '• ' + f).join('\n')
        const more = list.length > 80 ? `\n\n… +${list.length - 80} lainnya` : ''
        return ctx.reply('📚 *FEATURE LIST* (' + list.length + ')\n\n' + body + more)
      } catch (e) {
        return ctx.reply('❌ Gagal baca daftar feature: ' + String(e.message || e).slice(0, 150))
      }
    }
    const target = resolveTarget(input)
    if (!target) {
      return ctx.reply('⚠️ Path tidak valid. Contoh: `.gf game/uno`')
    }
    let filePath = target.resolved
    let buf = null
    try {
      buf = await fs.readFile(filePath)
    } catch {
      const alt = await caseFallback(filePath)
      if (alt) {
        filePath = alt
        try { buf = await fs.readFile(filePath) } catch {}
      }
    }
    if (!buf) {
      return ctx.reply('⚠️ File tidak ditemukan: `' + target.rel + '`\nCoba `.gf list` buat liat path yang ada.')
    }
    if (buf.length > MAX_SIZE) {
      return ctx.reply('⚠️ File kegedean buat dikirim (' + (buf.length / 1024 / 1024).toFixed(1) + ' MB).')
    }
    const rel = path.relative(REPO_ROOT, filePath).split(path.sep).join('/')
    const text = buf.toString('utf8')
    const lines = text.split('\n').length
    const info = '📏 ' + (buf.length / 1024).toFixed(1) + ' KB • ' + lines + ' baris'
    if (asText) {
      const parts = []
      for (let i = 0; i < text.length; i += TXT_CHUNK) parts.push(text.slice(i, i + TXT_CHUNK))
      try {
        await ctx.reply(
          '📄 `' + rel + '`\n' + info +
          ' • mode text' + (parts.length > 1 ? ' (' + parts.length + ' bagian)' : '')
        )
        for (const part of parts) {
          await ctx.client.message.send(ctx.chat, part)
        }
        await ctx.react('✅')
      } catch (e) {
        await ctx.react('❎')
        return ctx.reply('❌ Gagal kirim text: ' + String(e.message || e).slice(0, 150))
      }
      return
    }
    try {
      await ctx.client.message.send(ctx.chat, {
        type: 'document',
        media: buf,
        mimetype: 'application/javascript',
        fileName: path.basename(filePath),
        caption: '📄 `' + rel + '`\n' + info
      })
      await ctx.react('✅')
    } catch (e) {
      await ctx.react('❎')
      return ctx.reply('❌ Gagal kirim file: ' + String(e.message || e).slice(0, 150))
    }
  }
}