import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../../config.js'
import { LANGS, tokenize } from '../../lib/highlight.js'
import { parseMarkdown } from '../../lib/highlight.js'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const FEAT_ROOT = path.join(REPO_ROOT, 'feat')

const MAX_CODE_CHARS = 5500
const MAX_TABLE_ROWS = 40
const BOT_JID = '867051314767696@bot'
const ROOT_DIRS = ['feat/', 'lib/', 'scraper/', 'core/', 'handlers/', 'src/', 'config/', 'auth/']
const ROOT_FILES = ['app.js', 'config.js']
function resolveTarget(input) {
  let p = String(input || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!p) return null
  if (!p.endsWith('.js')) p += '.js'
  const isRoot = ROOT_DIRS.some((d) => p.startsWith(d)) || ROOT_FILES.includes(p)
  const rel = isRoot ? p : 'feat/' + p
  if (rel.split('/').includes('..')) return null
  const resolved = path.resolve(REPO_ROOT, rel)
  if (resolved !== REPO_ROOT && !resolved.startsWith(REPO_ROOT + path.sep)) return null
  const relFromRoot = path.relative(REPO_ROOT, resolved).split(path.sep).join('/')
  if (
    /(^|\/)\.env(\.|$)/i.test(relFromRoot) ||
    relFromRoot.startsWith('session/') ||
    relFromRoot.startsWith('node_modules/') ||
    /(^|\/)\.git(\/|$)/i.test(relFromRoot) ||
    /\.(sqlite|db)(-wal|-shm)?$/i.test(relFromRoot)
  ) return null
  return { rel: relFromRoot, resolved }
}
async function caseFallback(resolved) {
  try {
    const dir = path.dirname(resolved)
    const want = path.basename(resolved).toLowerCase()
    const entries = await fs.readdir(dir)
    const hit = entries.find((n) => n.toLowerCase() === want)
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
      if (e.name === 'getcode.js') continue
      if (e.isDirectory()) await walk(path.join(dir, e.name), prefix + e.name + '/')
      else if (e.name.endsWith('.js')) out.push(prefix + e.name.replace(/\.js$/, ''))
    }
  }
  await walk(FEAT_ROOT, '')
  return out
}

function buildFileStats(rel, text) {
  const lines = text.split('\n').length
  const bytes = Buffer.byteLength(text, 'utf8')
  const chars = text.length
  const isFeature = rel.startsWith('feat/')
  let exportsCount = 0
  let hasDefault = false
  let tags = ''
  let ownerFlag = false
  if (isFeature) {
    const m = text.match(/export\s+default\s*\{([\s\S]*?)\n\}/)
    if (m) {
      const body = m[1]
      exportsCount = (body.match(/name\s*:/g) || []).length ? 1 : 0
      hasDefault = true
      const t = body.match(/tags\s*:\s*'([^']+)'/)
      if (t) tags = t[1]
      if (/owner\s*:\s*true/.test(body)) ownerFlag = true
    }
    if (!hasDefault) exportsCount = (text.match(/export\s+(async\s+)?function/g) || []).length
  } else {
    exportsCount = (text.match(/export\s+(default\s+)?(async\s+)?(function|const|class|let)/g) || []).length
  }
  const rows = [
    { items: ['Properti', 'Nilai'], isHeading: true },
    { items: ['Path', rel], isHeading: false },
    { items: ['Bahasa', LANGS[path.extname(rel).slice(1).toLowerCase()] || path.extname(rel).slice(1).toUpperCase() || 'Text'], isHeading: false },
    { items: ['Baris', String(lines)], isHeading: false },
    { items: ['Ukuran', `${(bytes / 1024).toFixed(1)} KB`], isHeading: false },
    { items: ['Karakter', String(chars)], isHeading: false },
  ]
  if (isFeature) {
    rows.push({ items: ['Default export', hasDefault ? 'ada' : 'tidak'], isHeading: false })
    rows.push({ items: ['Kategori', tags || '-'], isHeading: false })
    rows.push({ items: ['Owner-only', ownerFlag ? 'ya' : 'tidak'], isHeading: false })
  } else {
    rows.push({ items: ['Export', String(exportsCount)], isHeading: false })
  }
  return rows.slice(0, MAX_TABLE_ROWS)
}

function buildRichMessage({ text, table, code }) {
  const submessages = []
  if (text) submessages.push({ messageType: 2, messageText: text })
  if (table) submessages.push({ messageType: 4, tableMetadata: table })
  if (code) {
    submessages.push({
      messageType: 5,
      codeMetadata: { codeLanguage: code.language, codeBlocks: code.blocks },
    })
  }
  return {
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          submessages,
          contextInfo: {
            forwardingScore: 999,
            isForwarded: true,
            forwardedAiBotMessageInfo: { botJid: BOT_JID },
            forwardOrigin: 4,
          },
        },
      },
    },
  }
}
const HELP =
  '💻 *GET CODE* — ambil isi file sebagai rich response\n\n' +
  '`.getcode <path>` → kode + tabel\n' +
  '`.getcode <path> --code` → kode saja\n' +
  '`.getcode <path> --table` → tabel saja\n' +
  '`.getcode list` → daftar file\n\n' +
  'Contoh:\n' +
  '`.getcode game/uno`\n' +
  '`.getcode lib/urlSafety`\n' +
  '`.getcode app.js --code`'
export default {
  name: 'getcode',
  aliases: ['getcodeview', 'viewcode'],
  tags: 'owner',
  owner: true,
  description: 'Lihat kode file sebagai code block + tabel (view code)',
  async run(ctx) {
    const tokens = (ctx.text || '').trim().split(/\s+/).filter(Boolean)
    const wantTable = tokens.some((t) => t === '--table')
    const wantCode = tokens.some((t) => t === '--code')
    const input = tokens
      .filter((t) => t !== '--table' && t !== '--code')
      .join(' ')
      .trim()
    if (!input) return ctx.reply(HELP)
    if (/^list$/i.test(input)) {
      try {
        const list = await listFeatures()
        const body = list.slice(0, 100).map((f) => `• ${config.mainPrefix}${f}`).join('\n')
        const more = list.length > 100 ? `\n… +${list.length - 100} lainnya` : ''
        return ctx.reply(`📚 *FILES* (${list.length})\n\n${body}${more}`)
      } catch (e) {
        return ctx.reply('❌ Gagal baca daftar: ' + String(e.message || e).slice(0, 150))
      }
    }
    const target = resolveTarget(input)
    if (!target) {
      return ctx.reply(
        `⚠️ Path tidak valid / tidak diizinkan.\n\n${HELP}`,
      )
    }
    let filePath = target.resolved
    let text = null
    try {
      text = await fs.readFile(filePath, 'utf8')
    } catch {
      const alt = await caseFallback(filePath)
      if (alt) {
        try {
          text = await fs.readFile(alt, 'utf8')
          filePath = alt
        } catch {}
      }
    }
    if (text === null) {
      return ctx.reply(`⚠️ File tidak ditemukan: \`${target.rel}\`\nCoba \`.getcode list\`.`)
    }
    const rel = path.relative(REPO_ROOT, filePath).split(path.sep).join('/')
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const language = LANGS[ext] || ext || 'javascript'
    const table = buildFileStats(rel, text)
    
    const onlyTable = wantTable && !wantCode
    const onlyCode = wantCode && !wantTable
    const header =
      `💻 \`${rel}\`\n` +
      `${table.find((r) => r.items[0] === 'Bahasa')?.items[1] || language} • ` +
      `${text.split('\n').length} baris • ${(Buffer.byteLength(text, 'utf8') / 1024).toFixed(1)} KB`
    let codePayload = null
    if (!onlyTable) {
      let body = text
      let truncated = false
      if (body.length > MAX_CODE_CHARS) {
        body = body.slice(0, MAX_CODE_CHARS)
        truncated = true
      }
      const blocks = tokenize(body)
      if (truncated) {
        blocks.push({
          highlightType: 5,
          codeContent: `\n\n// … (terpotong — file asli ${text.length} karakter,`,
        })
        blocks.push({ highlightType: 5, codeContent: `//    tampilkan ${MAX_CODE_CHARS} karakter pertama)` })
      }
      codePayload = { language, blocks }
    }
    const footer = `\n> _${config.botName} • ${onlyCode ? 'code view' : onlyTable ? 'table view' : 'code + table'}_`
    const payload = buildRichMessage({
      text: onlyCode ? null : header,
      table: onlyCode ? null : { title: `Ringkasan — ${rel}`, rows: table },
      code: codePayload,
    })
    
    
    if (onlyCode) {
      payload.botForwardedMessage.message.richResponseMessage.submessages.push({
        messageType: 2,
        messageText: footer,
      })
    } else {
      payload.botForwardedMessage.message.richResponseMessage.submessages.push({
        messageType: 2,
        messageText: footer,
      })
    }
    try {
      await ctx.client.message.send(ctx.chat, payload, {
        additionalAttributes: { type: 'text' },
      })
      await ctx.react('💻').catch(() => {})
    } catch (e) {
      await ctx.reply(
        `❌ Gagal kirim rich: ${String(e.message || e).slice(0, 160)}\n\n` +
          `Fallback teks (${text.length} karakter):\n${text.slice(0, 1800)}`,
      )
    }
  },
}