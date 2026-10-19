#!/usr/bin/env node
/**
 * scripts/verify-menu.mjs — smoke test menu tanpa koneksi WhatsApp.
 *
 * Menu dikirim sebagai `botForwardedMessage` + `richResponseMessage.unifiedResponse`
 * (GenAI), sama seperti Aurora/Uno. Test ini memverifikasi:
 *  - payload rich terbentuk benar dan bisa di-encode/decode lewat waproto
 *  - sections (banner + card teks) berisi isi menu yang benar
 *  - Rich yang GAGAL tidak menelan pesan (ada fallback teks)
 *  - list/button native-flow tetap valid untuk subsurface interaktif
 */
import assert from 'node:assert/strict'
import { proto } from 'zapo-js'

const { loadFeatures, listFeatures } = await import('../feat/loader.js')
const loaded = await loadFeatures()
console.log(`registry: ${loaded.count}/${loaded.total} feature, ${listFeatures().length} command key`)
if (loaded.failed.length) {
  console.log('gagal dimuat:', loaded.failed.map((f) => `${f.file} (${f.stage})`).join(', '))
}

const { readRichReply, richButtons, richList } = await import('../lib/richMessage.js')

const sent = []
/** 'ok' | 'rich-fails' | 'all-fails' */
let sendMode = 'ok'

const client = {
  getCredentials: () => ({ meJid: '628999:12@s.whatsapp.net' }),
  message: {
    async send(jid, content, opts) {
      const isRich = typeof content === 'object' && content !== null
      if (sendMode === 'all-fails') throw new Error('socket hang up (semua gagal)')
      if (sendMode === 'rich-fails' && isRich) throw new Error('SMAX_INVALID (479)')
      sent.push({ jid, content, opts })
      return { id: `FAKE${sent.length}`, key: { id: `FAKE${sent.length}` } }
    },
  },
}

function makeCtx(extra = {}) {
  return {
    client,
    chat: '628123@s.whatsapp.net',
    sender: '628999@s.whatsapp.net',
    senderNumber: '628999',
    pushName: 'Alfi',
    isGroup: false,
    isOwner: true,
    isAdmin: true,
    isStaff: true,
    args: [],
    text: '',
    prefix: '.',
    command: 'menu',
    async reply(t) { return client.message.send(this.chat, t) },
    async replyButtons(o) { return client.message.send(this.chat, richButtons(o)) },
    async replyList(o) { return client.message.send(this.chat, richList(o)) },
    async replyCarousel(o) {
      return client.message.send(this.chat, (await import('../lib/richMessage.js')).richCarousel(o))
    },
    async react() { return { ok: true } },
    ...extra,
  }
}

const menu = (await import('../feat/general/menu.js')).default

let failures = 0
function check(label, fn) {
  try { fn(); console.log(`  ok    ${label}`) }
  catch (e) { failures++; console.log(`  FAIL  ${label}\n          ${e.message.split('\n').join('\n          ')}`) }
}

/** Decode unifiedResponse.data base64 → object. */
function decodeUnified(content) {
  const rrm = content?.botForwardedMessage?.message?.richResponseMessage
  assert.ok(rrm, 'tidak ada richResponseMessage')
  assert.equal(rrm.messageType, 1)
  const data = rrm.unifiedResponse?.data
  assert.ok(data, 'tidak ada unifiedResponse.data')
  const json = Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data, 'base64').toString('utf8')
  return JSON.parse(json)
}

const cardTitle = (unified) => {
  for (const s of unified.sections ?? []) {
    const prims = s.view_model?.primitives
    if (Array.isArray(prims)) return prims[0]?.header?.title ?? ''
  }
  return ''
}

/* ---------- 1. .menu → rich card ---------- */
console.log('\n[1] .menu → rich card (banner + tree)')
sent.length = 0
await menu.run(makeCtx())

check('mengirim 1 pesan rich', () => assert.equal(sent.length, 1))
check('kirim lewat additionalAttributes type=text', () => {
  assert.deepEqual(sent[0].opts?.additionalAttributes, { type: 'text' })
})
check('punya messageContextInfo.botMetadata', () => {
  const mci = sent[0].content.messageContextInfo
  assert.ok(mci?.botMetadata?.botResponseId, 'tidak ada botResponseId')
  assert.ok(mci.botMetadata.verificationMetadata?.proofs?.length, 'tidak ada verificationMetadata.proofs')
})
check('contextInfo ditandai forwarded + botJid', () => {
  const ci = sent[0].content.botForwardedMessage.message.richResponseMessage.contextInfo
  assert.equal(ci.isForwarded, true)
  assert.equal(ci.forwardOrigin, 4)
  assert.equal(ci.forwardedAiBotMessageInfo.botJid, '628999:12@s.whatsapp.net')
})
check('submessages kosong (teks tidak terpotong quotable)', () => {
  const rrm = sent[0].content.botForwardedMessage.message.richResponseMessage
  assert.deepEqual(rrm.submessages, [])
})

check('payload survive encode/decode waproto', () => {
  const bytes = proto.Message.encode(sent[0].content).finish()
  const dec = proto.Message.decode(bytes)
  assert.ok(dec.botForwardedMessage, 'botForwardedMessage hilang')
  assert.ok(dec.botForwardedMessage.message.richResponseMessage?.unifiedResponse?.data,
    'unifiedResponse.data hilang setelah decode')
})

const unified = decodeUnified(sent[0].content)
check('unified ada 2 section (banner + card)', () => {
  assert.equal(unified.sections.length, 2)
  assert.equal(unified.__typename, 'GenAIUnifiedResponse')
})
check('section 1 = GenAIImaginePrimitive dengan URL banner', () => {
  const prim = unified.sections[0].view_model.primitive
  assert.equal(prim.__typename, 'GenAIImaginePrimitive')
  assert.equal(prim.imagine_type, 'IMAGE')
  assert.match(prim.media.url, /^https:\/\//)
  assert.equal(prim.status.status, 'READY')
})
check('section 2 = hscroll card berisi tree', () => {
  const vm = unified.sections[1].view_model
  assert.equal(vm.__typename, 'GenAIHScrollLayoutViewModel')
  const prim = vm.primitives[0]
  assert.equal(prim.__typename, 'GenAI3PExtWidgetPrimitive')
  assert.equal(prim.header.__typename, 'GenAI3PExtWidgetStandardHeader')
  assert.equal(prim.body.__typename, 'GenAI3PExtCalendarEventList')
})

const title = cardTitle(unified)
check('judul memuat blok INFO', () => assert.match(title, /╭\s+\*INFO\*/))
check('judul memuat rt/user/cmd', () => {
  assert.match(title, /rt \(/)
  assert.match(title, /user \(Alfi\)/)
  assert.match(title, /cmd \(\d+ • \d+ user\)/)
})
check('judul memuat kategori uppercase', () => {
  assert.match(title, /╭\s+\*GENERAL\*/)
  assert.match(title, /╭\s+\*OWNER\*/)
})
check('judul memuat command dengan prefix', () => {
  assert.match(title, /∘ `\.menu`/)
})
check('judul ditutup footer bot', () => assert.match(title, /Made|_\*Claide Bot by Alfi\*_/))
check('judul tidak melebihi batas', () => assert.ok(title.length <= 3800, `${title.length} chars`))

/* ---------- 2. fallback saat rich ditolak ---------- */
console.log('\n[2] rich ditolak server → fallback teks (tidak diam)')
sent.length = 0
sendMode = 'rich-fails'
await menu.run(makeCtx())
sendMode = 'ok'
check('fallback terkirim sebagai pesan biasa', () => {
  assert.equal(sent.length, 1)
  assert.equal(typeof sent[0].content, 'string')
  assert.match(sent[0].content, /Rich card gagal/)
  assert.match(sent[0].content, /╭\s+\*INFO\*/, 'isi menu ikut terkirim di fallback')
})
sendMode = 'rich-fails'
await menu.run(makeCtx())
sendMode = 'ok'
console.log('  ok    tidak lempar error ke caller saat rich ditolak')

sendMode = 'all-fails'
await menu.run(makeCtx())
sendMode = 'ok'
console.log('  ok    rich + fallback sama-sama gagal → tidak crash')

/* ---------- 3. .menu <kategori> ---------- */
console.log('\n[3] .menu <kategori> → card + list')
sent.length = 0
await menu.run(makeCtx({ args: ['ai'] }))
check('kirim 2 pesan (rich + list)', () => assert.equal(sent.length, 2))
check('card cuma berisi kategori itu', () => {
  const u = decodeUnified(sent[0].content)
  const t = cardTitle(u)
  assert.match(t, /╭\s+\*AI\*/)
  assert.doesNotMatch(t, /╭\s+\*OWNER\*/, 'kategori lain ikut masuk')
})
check('list punya header + single_select', () => {
  const im = sent[1].content.interactiveMessage
  assert.ok(im?.header?.title)
  const btn = im.nativeFlowMessage.buttons.find((b) => b.name === 'single_select')
  assert.ok(btn, 'tidak ada single_select')
  const params = JSON.parse(btn.buttonParamsJson)
  assert.ok(params.sections[0].rows.length >= 1)
  assert.match(params.sections[0].rows[0].id, /^menu:command:ai:/)
})

/* ---------- 4. .menu all ---------- */
console.log('\n[4] .menu all → card + list + navigasi')
sent.length = 0
await menu.run(makeCtx({ args: ['all'] }))
check('kirim >= 3 pesan', () => assert.ok(sent.length >= 3, `hanya ${sent.length}`))
check('list <= 20 baris per halaman', () => {
  const listMsg = sent.find((m) => m.content?.interactiveMessage?.nativeFlowMessage?.buttons
    ?.some((b) => b.name === 'single_select'))
  const params = JSON.parse(listMsg.content.interactiveMessage.nativeFlowMessage.buttons
    .find((b) => b.name === 'single_select').buttonParamsJson)
  const rows = params.sections.flatMap((s) => s.rows)
  assert.ok(rows.length <= 20, `ada ${rows.length} baris`)
})
check('ada tombol navigasi halaman', () => {
  const nav = sent.find((m) => m.content?.interactiveMessage?.nativeFlowMessage?.buttons
    ?.some((b) => JSON.parse(b.buttonParamsJson).id?.startsWith('menu:page:')))
  assert.ok(nav, 'tidak ada navigasi halaman')
})

/* ---------- 5. kategori ngawur ---------- */
console.log('\n[5] kategori ngawur → pesan error')
sent.length = 0
await menu.run(makeCtx({ args: ['ngawur'] }))
check('balas teks error', () => assert.match(sent[0].content, /tidak ada/))

/* ---------- 6. readRichReply tombol ---------- */
console.log('\n[6] readRichReply dari tombol native-flow')
sent.length = 0
await menu.run(makeCtx({ args: ['ai'] }))
const rowId = JSON.parse(sent[1].content.interactiveMessage.nativeFlowMessage.buttons
  .find((b) => b.name === 'single_select').buttonParamsJson).sections[0].rows[0].id
check('baca id baris list', () => {
  const reply = readRichReply({
    interactiveResponseMessage: {
      nativeFlowResponseMessage: { name: 'single_select', paramsJson: JSON.stringify({ id: rowId }) },
    },
  })
  assert.equal(reply.id, rowId)
})

/* ---------- 7. kompatibilitas ---------- */
console.log('\n[7] kompatibilitas builder')
check('richButtons tanpa header tetap valid', () => {
  const im = richButtons({ text: 'hi', footer: 'f', buttons: [{ id: 'a', text: 'A' }] }).interactiveMessage
  assert.equal(im.header, undefined)
  assert.equal(im.body.text, 'hi')
})
check('header kosong diabaikan', () => {
  const im = richButtons({ text: 'hi', header: { title: '  ' }, buttons: [] }).interactiveMessage
  assert.equal(im.header, undefined)
})
check('readRichReply pesan biasa → undefined', () => {
  assert.equal(readRichReply({ conversation: 'halo' }), undefined)
})

/* ---------- 8. play2: tema UI ---------- */
console.log('\n[8] play2 — tema player')
const play2 = await import('../feat/downloader/play2.js')
const lyr = play2.normalizeLyrics(play2.parseSyncedLyrics('[00:01.00]satu\n[00:03.00]dua'))
const basePlayer = { title: 'T', artist: 'A', duration: '1:00', imageSrc: '', lyrics: lyr, provider: 'LRCLIB', audioDataUri: '' }

const rendered = {}
for (const th of ['aurora', 'neon', 'minimal', 'sunset']) {
  process.env.PLAY2_THEME = th
  rendered[th] = play2.createMusicPlayer(basePlayer)
}
process.env.PLAY2_THEME = 'aurora'

check('4 tema menghasilkan HTML berbeda satu sama lain', () => {
  const uniq = new Set(Object.values(rendered))
  assert.equal(uniq.size, 4, `cuma ${uniq.size} output unik`)
})
check('tidak ada placeholder template yang tak ter-expand', () => {
  for (const [th, html] of Object.entries(rendered)) {
    assert.ok(!html.includes('${'), `tema ${th} punya ${'${'} belum ter-expand`)
  }
})
check('setiap tema punya accent + max-width sendiri', () => {
  const acc = Object.values(rendered).map((h) => (h.match(/--pink: (\S+?);/) || [])[1])
  const wid = Object.values(rendered).map((h) => (h.match(/max-width: (\S+?);/) || [])[1])
  assert.equal(new Set(acc).size, 4, `accent: ${acc.join(',')}`)
  assert.equal(new Set(wid).size, 4, `width: ${wid.join(',')}`)
})
check('tema wide punya equalizer bar, mini tidak', () => {
  assert.ok(rendered.neon.includes('id="eq-row"'), 'neon harus punya eqrow')
  assert.ok(rendered.sunset.includes('id="eq-row"'), 'sunset harus punya eqrow')
  assert.ok(!rendered.aurora.includes('id="eq-row"'), 'aurora (default) tidak boleh punya eqrow')
})
check('eqrow ter-toggle sama status playback', () => {
  assert.ok(rendered.neon.includes("getElementById('eq-row')"), 'eqrow tidak di-hook ke JS')
  assert.ok(rendered.neon.includes("eqRow.classList.toggle('is-on'"), 'eqrow tidak ikut state playing')
})
check('tema minimal terang (ink gelap) vs lainnya terang', () => {
  assert.ok(rendered.minimal.includes('--ink: #15181c;'), 'minimal harus ink gelap')
  assert.ok(rendered.aurora.includes('--ink: #ffffff;'), 'aurora harus ink putih')
})

/* ---------- 9. getcode: code view + table ---------- */
console.log('\n[9] getcode — rich code + table')
const gc = (await import('../feat/tools/getcode.js')).default
const gcSent = []
const gcCtx = {
  chat: '628123@s.whatsapp.net', sender: '628999@s.whatsapp.net', senderNumber: '628999',
  pushName: 'Alfi', args: [], text: '', prefix: '.', command: 'getcode',
  client: { message: { async send(_j, c, o) { gcSent.push({ c, o }); return { id: 'X' } } } },
  async reply(t) { gcSent.push({ c: t }); return undefined },
  async react() { return undefined },
}
async function runGetcode(text) {
  gcSent.length = 0
  gcCtx.text = text
  await gc.run(gcCtx)
  return gcSent[0]
}
const subsOf = (r) => r.c?.botForwardedMessage?.message?.richResponseMessage?.submessages ?? []

let r = await runGetcode('game/uno')
check('code + table terkirim', () => {
  const types = subsOf(r).map((s) => s.messageType)
  assert.ok(types.includes(5), 'tidak ada codeMetadata')
  assert.ok(types.includes(4), 'tidak ada tableMetadata')
  assert.ok(types.includes(2), 'tidak ada messageText')
})
check('table punya title + rows', () => {
  const t = subsOf(r).find((s) => s.messageType === 4).tableMetadata
  assert.match(t.title, /Ringkasan/)
  assert.ok(t.rows.length >= 5)
  assert.deepEqual(t.rows[0], { items: ['Properti', 'Nilai'], isHeading: true })
})
check('kode di-highlight jadi banyak blok', () => {
  const c = subsOf(r).find((s) => s.messageType === 5).codeMetadata
  assert.ok(c.codeBlocks.length > 20, `cuma ${c.codeBlocks.length} blok`)
  assert.ok(c.codeLanguage)
})
check('payload survive encode/decode waproto (termasuk table)', () => {
  const bytes = proto.Message.encode(r.c).finish()
  const bfm = proto.Message.decode(bytes).botForwardedMessage.message.richResponseMessage
  assert.equal(bfm.messageType, 1)
  const types = bfm.submessages.map((s) => s.messageType)
  assert.ok(types.includes(4), 'table hilang setelah decode')
  assert.ok(types.includes(5), 'code hilang setelah decode')
})
r = await runGetcode('lib/urlSafety --code')
check('--code tidak mengirim table', () => {
  assert.ok(!subsOf(r).some((s) => s.messageType === 4))
  assert.ok(subsOf(r).some((s) => s.messageType === 5))
})
r = await runGetcode('app.js --table')
check('--table tidak mengirim code', () => {
  assert.ok(!subsOf(r).some((s) => s.messageType === 5))
  assert.ok(subsOf(r).some((s) => s.messageType === 4))
})
r = await runGetcode('downloader/play2')
check('file besar dipotong pada batas aman', () => {
  const c = subsOf(r).find((s) => s.messageType === 5).codeMetadata
  const total = c.codeBlocks.reduce((a, x) => a + x.codeContent.length, 0)
  assert.ok(total <= 5600, `${total} karakter, melebihi batas`)
})
r = await runGetcode('.env')
check('.env ditolak', () => assert.match(String(r.c), /tidak valid|tidak diizinkan/))
r = await runGetcode('../../etc/passwd')
check('path traversal ditolak', () => assert.match(String(r.c), /tidak valid|tidak diizinkan/))
r = await runGetcode('list')
check('list menampilkan daftar file', () => assert.match(String(r.c), /FILES/))

console.log(failures ? `\n✖ ${failures} check gagal` : '\n✓ Semua check lulus')
process.exit(failures ? 1 : 0)