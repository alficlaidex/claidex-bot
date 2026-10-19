import { tokenize, LANGS } from '../../lib/highlight.js'
import { proto } from 'zapo-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const DB_PATH = path.join(REPO_ROOT, 'session', 'state.sqlite')
const MAX_CODE = 60000
function getEvent(ctx) {
  return ctx.message ?? ctx.event ?? ctx.raw ?? ctx.msg ?? null
}
function getContextInfo(message) {
  if (!message || typeof message !== 'object') return null
  for (const key of Object.keys(message)) {
    const node = message[key]
    if (node && typeof node === 'object' && node.contextInfo) return node.contextInfo
  }
  return null
}
function isBytes(v) {
  return Buffer.isBuffer(v) || v instanceof Uint8Array ||
    (v && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data))
}
function isLong(v) {
  return v && typeof v === 'object' && !isBytes(v) &&
    typeof v.low === 'number' && typeof v.high === 'number' &&
    Object.keys(v).every(k => k === 'low' || k === 'high' || k === 'unsigned')
}
function longToNumber(v) {
  try {
    const n = (BigInt(v.high) << 32n) + BigInt(v.low >>> 0)
    const num = Number(n)
    return Number.isSafeInteger(num) ? num : v
  } catch {
    return v
  }
}
function prune(node) {
  if (node === null || node === undefined) return undefined
  if (isLong(node)) return longToNumber(node)
  if (Array.isArray(node)) return node.map(prune).filter(v => v !== undefined)
  if (node && typeof node === 'object' && !isBytes(node)) {
    const out = {}
    for (const [k, v] of Object.entries(node)) {
      if (v === undefined || v === null) continue
      const p = prune(v)
      if (p === undefined) continue
      if (Array.isArray(p) && !p.length) continue
      if (p && typeof p === 'object' && !isBytes(p) && !Object.keys(p).length) continue
      out[k] = p
    }
    return out
  }
  return node
}
function toPlain(node) {
  if (isBytes(node)) return Buffer.from(node.data ?? node).toString('base64')
  if (isLong(node)) return longToNumber(node)
  if (Array.isArray(node)) return node.map(toPlain)
  if (node && typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) out[k] = toPlain(v)
    return out
  }
  return node
}
function safeKey(k) { return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k) }
function toLiteral(node, depth = 0) {
  const pad = '  '.repeat(depth)
  const padIn = '  '.repeat(depth + 1)
  if (node === undefined) return 'undefined'
  if (node === null) return 'null'
  const t = typeof node
  if (t === 'string') return JSON.stringify(node)
  if (t === 'number' || t === 'boolean') return String(node)
  if (isBytes(node)) return JSON.stringify(Buffer.from(node.data ?? node).toString('base64'))
  if (Array.isArray(node)) {
    if (!node.length) return '[]'
    return '[\n' + node.map(n => padIn + toLiteral(n, depth + 1)).join(',\n') + '\n' + pad + ']'
  }
  if (t === 'object') {
    const entries = Object.entries(node).filter(([, v]) => v !== undefined)
    if (!entries.length) return '{}'
    return '{\n' + entries.map(([k, v]) => `${padIn}${safeKey(k)}: ${toLiteral(v, depth + 1)}`).join(',\n') + '\n' + pad + '}'
  }
  return String(node)
}
function buildCode(protoObj) {
  const body = toLiteral(protoObj, 0)
    .split('\n')
    .map(l => (l.length ? '  ' + l : l))
    .join('\n')
  return (
    '// FionyVerse — CRM V3 with Zapo Reference\n' +
    '=> conn.relayMessage(\n' +
    '  m.chat,\n' +
    body + ',\n' +
    '  {}\n' +
    ')'
  )
}
async function loadFromStoreApi(client, jid, id) {
  const s = client?.store
  if (!s || !id) return null
  const tries = [
    ['store.messages.get(jid,id)', () => s.messages?.get?.(jid, id)],
    ['store.messages.get(key)', () => s.messages?.get?.({ remoteJid: jid, id })],
    ['store.messages.get(id)', () => s.messages?.get?.(id)],
    ['store.messages.load(jid,id)', () => s.messages?.load?.(jid, id)],
    ['store.messages.loadMessage(jid,id)', () => s.messages?.loadMessage?.(jid, id)],
    ['store.messages.find(jid,id)', () => s.messages?.find?.(jid, id)],
    ['store.messages.findByKey(key)', () => s.messages?.findByKey?.({ remoteJid: jid, id })],
    ['store.loadMessage(jid,id)', () => s.loadMessage?.(jid, id)],
    ['client.loadMessage(jid,id)', () => client.loadMessage?.(jid, id)],
    ['store.messages.all(jid)+filter', async () => {
      const list = await s.messages?.all?.(jid)
      return Array.isArray(list) ? list.find(m => (m.key?.id || m.id) === id) : null
    }]
  ]
  for (const [name, fn] of tries) {
    try {
      const r = await fn()
      if (r && typeof r === 'object') {
        console.log('[CRM] store API hit via: ' + name)
        return r.message ? r.message : (r.key ? r.message : r)
      }
    } catch {}
  }
  return null
}
async function loadFromSqlite(jid, id) {
  if (!id) return null
  let db = null
  let kind = ''
  try {
    const Better = (await import('better-sqlite3')).default
    db = new Better(DB_PATH, { readonly: true, fileMustExist: true })
    kind = 'better-sqlite3'
  } catch {
    try {
      const { DatabaseSync } = await import('node:sqlite')
      db = new DatabaseSync(DB_PATH, { readOnly: true })
      kind = 'node:sqlite'
    } catch {
      return null
    }
  }
  try {
    const tables = (kind === 'better-sqlite3'
      ? db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
      : db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    ).map(r => r.name)
    const tab = tables.find(t => /message/i.test(t))
    if (!tab) return null
    const cols = (kind === 'better-sqlite3'
      ? db.prepare(`PRAGMA table_info('${tab}')`).all()
      : db.prepare(`PRAGMA table_info('${tab}')`).all()
    ).map(c => c.name)
    const idCol = cols.find(c => c === 'id' || c === 'message_id' || c === 'stanza_id')
    const jidCol = cols.find(c => c === 'remote_jid' || c === 'chat_jid' || c === 'jid')
    const payCol = cols.find(c => c === 'message' || c === 'proto' || c === 'data' || c === 'content')
    if (!idCol || !payCol) return null
    const sql = jidCol
      ? `SELECT ${payCol} AS payload FROM '${tab}' WHERE ${idCol} = ? AND ${jidCol} = ? LIMIT 1`
      : `SELECT ${payCol} AS payload FROM '${tab}' WHERE ${idCol} = ? LIMIT 1`
    const row = kind === 'better-sqlite3'
      ? (jidCol ? db.prepare(sql).get(id, jid) : db.prepare(sql).get(id))
      : (jidCol ? db.prepare(sql).get(id, jid) : db.prepare(sql).get(id))
    if (!row || row.payload == null) return null
    let payload = row.payload
    if (Buffer.isBuffer(payload) || payload instanceof Uint8Array) {
      const msg = proto.Message.decode(new Uint8Array(payload))
      console.log('[CRM] sqlite hit (proto decode) | table=' + tab)
      return msg
    }
    if (typeof payload === 'string') {
      if (payload.trim().startsWith('{')) {
        console.log('[CRM] sqlite hit (json) | table=' + tab)
        return JSON.parse(payload)
      }
      try {
        const msg = proto.Message.decode(Buffer.from(payload, 'base64'))
        console.log('[CRM] sqlite hit (base64 proto) | table=' + tab)
        return msg
      } catch {}
    }
    return null
  } catch (e) {
    console.log('[CRM] sqlite read fail:', String(e.message || e).slice(0, 120))
    return null
  } finally {
    try { db?.close?.() } catch {}
  }
}
async function probeStore(client) {
  const lines = []
  const s = client?.store
  lines.push('client.store: ' + typeof s)
  if (s && typeof s === 'object') {
    lines.push('store keys: ' + Object.keys(s).join(', '))
    const m = s.messages
    lines.push('store.messages: ' + typeof m)
    if (m && typeof m === 'object') {
      const fns = Object.keys(m).filter(k => typeof m[k] === 'function')
      const protoFns = Object.getOwnPropertyNames(Object.getPrototypeOf(m) || {}).filter(k => typeof m[k] === 'function' && k !== 'constructor')
      lines.push('messages fn (own): ' + (fns.join(', ') || '-'))
      lines.push('messages fn (proto): ' + (protoFns.join(', ') || '-'))
    }
  }
  try {
    const Better = (await import('better-sqlite3')).default
    const db = new Better(DB_PATH, { readonly: true, fileMustExist: true })
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
    lines.push('sqlite tables: ' + tables.join(', '))
    const tab = tables.find(t => /message/i.test(t))
    if (tab) {
      const cols = db.prepare(`PRAGMA table_info('${tab}')`).all().map(c => c.name)
      lines.push(`cols(${tab}): ` + cols.join(', '))
    }
    db.close()
  } catch (e) {
    lines.push('sqlite probe fail: ' + String(e.message || e).slice(0, 100))
  }
  return lines.join('\n')
}
function getType(qm) {
  if (!qm || typeof qm !== 'object') return 'unknown'
  return Object.keys(qm).filter(k => k !== 'messageContextInfo')[0] || 'unknown'
}
function countChildren(qm) {
  let c = 0, q = qm
  while (q?.extendedTextMessage?.contextInfo?.quotedMessage) { c++; q = q.extendedTextMessage.contextInfo.quotedMessage }
  return c
}
function stripForward(p) {
  const out = structuredClone(p)
  for (const [k, v] of Object.entries(out)) {
    if (k === 'messageContextInfo') continue
    if (v && typeof v === 'object' && v.contextInfo) {
      delete v.contextInfo.forwardingScore
      delete v.contextInfo.isForwarded
      delete v.contextInfo.forwardOrigin
      delete v.contextInfo.forwardedAiBotMessageInfo
    }
  }
  return out
}
function addForward(p) {
  const out = structuredClone(p)
  for (const [k, v] of Object.entries(out)) {
    if (k === 'messageContextInfo') continue
    if (v && typeof v === 'object' && k.endsWith('Message')) {
      v.contextInfo = { ...(v.contextInfo || {}), isForwarded: true, forwardingScore: 1 }
      break
    }
  }
  return out
}
function collectKeys(node, p = '', out = []) {
  if (!node || typeof node !== 'object') return out
  for (const [k, v] of Object.entries(node)) {
    const cur = p ? p + '.' + k : k
    if (k === 'mediaKey' || k === 'url' || k === 'directPath' || k === 'e2EeMediaKey') {
      out.push({ field: cur, value: isBytes(v) ? Buffer.from(v.data ?? v).toString('base64').slice(0, 40) + '…' : String(v).slice(0, 60) })
    } else if (v && typeof v === 'object' && !isBytes(v)) collectKeys(v, cur, out)
  }
  return out
}
function codeSubmessage(code) {
  let src = code
  let truncated = false
  if (src.length > MAX_CODE) { src = src.slice(0, MAX_CODE); truncated = true }
  const blocks = tokenize(src)
  if (truncated) blocks.push({ highlightType: 5, codeContent: '\n// … (terpotong)' })
  return { messageType: 5, codeMetadata: { codeLanguage: LANGS.js, codeBlocks: blocks } }
}
function sendRich(ctx, submessages) {
  return ctx.client.message.send(ctx.chat, {
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          submessages,
          contextInfo: {
            forwardingScore: 999,
            isForwarded: true,
            forwardedAiBotMessageInfo: { botJid: '236911050403982@bot' },
            forwardOrigin: 4
          }
        }
      }
    }
  }, { additionalAttributes: { type: 'text' } })
}
export default {
  name: 'crm',
  aliases: ['relaymsg', 'snipmsg'],
  tags: 'owner',
  owner: true,
  description: 'CRM v3 — copy raw message (store ladder + AIRich + format reference)',
  async run(ctx) {
    const args = (ctx.text || '').trim()
    const [modeRaw, ...rest] = args.split(/\s+/)
    const mode = (modeRaw || '').toLowerCase()
    if (mode === 'store') {
      const dump = await probeStore(ctx.client)
      await sendRich(ctx, [
        { messageType: 2, messageText: ' *CRM Store Probe*' },
        codeSubmessage(dump)
      ])
      return
    }
    if (mode === 'raw') {
      const json = rest.join(' ')
      if (!json) return ctx.reply('⚠️ `.crm raw <json>` — tempel proto json-nya.')
      try {
        await ctx.client.message.send(ctx.chat, JSON.parse(json))
        return ctx.react('✅')
      } catch (e) {
        return ctx.reply('❌ JSON invalid: ' + String(e.message || e).slice(0, 200))
      }
    }
    const ci = getContextInfo(getEvent(ctx)?.message ?? getEvent(ctx))
    const quoted = ci?.quotedMessage ?? null
    if (!ci || !quoted) {
      return ctx.reply(
        '⚡ *CRM v3 — Copy Raw Message*\n\n' +
        'Balas pesan target, lalu:\n' +
        '`.crm` → kode relay (AIRich code UI)\n' +
        '`.crm snip` → kode + relay langsung\n' +
        '`.crm relay` / `.crm clone` / `.crm forward`\n' +
        '`.crm js` / `.crm json` / `.crm info` / `.crm keys`\n' +
        '`.crm store` → diagnostik store/sqlite\n' +
        '`.crm raw <json>` → relay dari json\n\n' +
        'Source ladder: store API → sqlite → quoted.'
      )
    }
    const jid = ci.remoteJid || ctx.chat
    const id = ci.stanzaId || null
    let raw = await loadFromStoreApi(ctx.client, jid, id)
    let source = raw ? 'store' : null
    if (!raw) {
      raw = await loadFromSqlite(jid, id)
      source = raw ? 'store(sqlite)' : null
    }
    if (!raw) {
      raw = quoted
      source = 'quoted(contextInfo)'
    }
    const protoObj = prune(structuredClone(raw))
    const type = getType(protoObj)
    const sender = (ci.participant || '?').split('@')[0].split(':')[0]
    const children = countChildren(quoted)
    const infoText =
      '⚡ *CRM v3 — Relay Snippet*\n' +
      '• Type     : `' + type + '`\n' +
      '• Source   : ' + source + '\n' +
      '• Chat     : ' + jid + '\n' +
      '• ID       : ' + (id || '?') + '\n' +
      '• Sender   : ' + sender + '\n' +
      '• Children : ' + children
    const code = buildCode(protoObj)
    try {
      if (mode === 'relay') {
        await ctx.client.message.send(ctx.chat, protoObj)
        return ctx.react('✅')
      }
      if (mode === 'clone') {
        await ctx.client.message.send(ctx.chat, stripForward(protoObj))
        return ctx.react('✅')
      }
      if (mode === 'forward') {
        await ctx.client.message.send(ctx.chat, addForward(protoObj))
        return ctx.react('✅')
      }
      if (mode === 'js') {
        await ctx.client.message.send(ctx.chat, {
          type: 'document',
          media: Buffer.from(code, 'utf8'),
          mimetype: 'application/javascript',
          fileName: 'crm-' + type + '.js',
          caption: infoText
        })
        return ctx.react('✅')
      }
      if (mode === 'json') {
        await ctx.client.message.send(ctx.chat, {
          type: 'document',
          media: Buffer.from(JSON.stringify(toPlain(protoObj), null, 2), 'utf8'),
          mimetype: 'application/json',
          fileName: 'crm-' + type + '.json',
          caption: infoText
        })
        return ctx.react('✅')
      }
      if (mode === 'info') {
        await sendRich(ctx, [
          { messageType: 2, messageText: infoText + '\n• TopKeys  : `' + Object.keys(protoObj).join(', ') + '`' }
        ])
        return
      }
      if (mode === 'keys') {
        const found = collectKeys(protoObj)
        const lines = found.length
          ? found.map(f => '• `' + f.field + '`\n  ' + f.value).join('\n')
          : '(gak ada mediaKey/url di pesan ini)'
        await sendRich(ctx, [{ messageType: 2, messageText: '🔑 *CRM Keys*\n' + lines }])
        return
      }
      await sendRich(ctx, [
        { messageType: 2, messageText: infoText },
        codeSubmessage(code)
      ])
      if (mode === 'snip') {
        await ctx.client.message.send(ctx.chat, protoObj)
      }
      return ctx.react('⚡')
    } catch (e) {
      await ctx.react('❎')
      return ctx.reply('❌ CRM error: ' + String(e.message || e).slice(0, 250))
    }
  }
}