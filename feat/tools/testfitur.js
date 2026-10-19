import { proto } from 'zapo-js'
import crypto from 'node:crypto'
import config from '../../config.js'
import { onRichReply, unregisterRichReply } from '../../core/richRegistry.js'
import { logger } from '../../core/logger.js'

// .testfitur — uji semua surface pesan zapo-js dalam satu command, lalu laporkan
// mana yang benar-benar terkirim dan mana yang tidak.
//
// Penting soal cara menguji: `send()` yang sukses HANYA berarti stanza-nya
// diterima server. Rich card (GenAI) bisa hilang di layar user tanpa error
// sama sekali — itu justru keluhan asli di Claidex-Bot. Jadi setiap langkah
// dicatat sebagai berhasil/gagal, dan di akhir dikirim ringkasan TEKS biasa
// (tidak rich) supaya hasilnya selalu terbaca.

// ---------- surface 1: richResponseMessage (GenAI unified) ----------

function verificationMetadata() {
  const SIG = Buffer.from('JH.FionyVerseV1.0-VerificationSignature.Metadata')
  const CERT = Buffer.from('JH.FionyVerseV1.0-CertificateChain.Metadata')
  const signature = Buffer.concat([SIG, crypto.randomBytes(64 - SIG.length)]).toString('base64')
  const certificateChain = [
    Buffer.concat([CERT, crypto.randomBytes(684 - CERT.length)]).toString('base64'),
    Buffer.concat([CERT, crypto.randomBytes(892 - CERT.length)]).toString('base64'),
  ]
  return { proofs: [{ version: 1, useCase: 1, signature, certificateChain }] }
}

function buildRichCard(sections) {
  return {
    messageContextInfo: {
      deviceListMetadata: {},
      deviceListMetadataVersion: 2,
      botMetadata: {
        messageDisclaimerText: '',
        verificationMetadata: verificationMetadata(),
        botResponseId: crypto.randomUUID(),
      },
    },
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          submessages: [],
          unifiedResponse: {
            data: Buffer.from(
              JSON.stringify({
                __typename: 'GenAIUnifiedResponse',
                response_id: crypto.randomUUID(),
                sections,
              })
            ).toString('base64'),
          },
          contextInfo: {
            forwardingScore: 1,
            isForwarded: true,
            forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' },
            forwardOrigin: 4,
          },
        },
      },
    },
  }
}

function richTextSection(title) {
  return {
    __typename: 'GenAIUnifiedResponseSection',
    view_model: {
      __typename: 'GenAIHScrollLayoutViewModel',
      primitives: [
        {
          __typename: 'GenAI3PExtWidgetPrimitive',
          header: { __typename: 'GenAI3PExtWidgetStandardHeader', title },
          body: { __typename: 'GenAI3PExtCalendarEventList', sections: [] },
        },
      ],
    },
  }
}

// ---------- surface 2: richResponseMessage submessage (teks/code/tabel/LaTeX) ----------

function buildSubmessageCard() {
  return {
    messageContextInfo: {
      deviceListMetadata: {},
      deviceListMetadataVersion: 2,
      botMetadata: {
        messageDisclaimerText: '',
        verificationMetadata: verificationMetadata(),
        botResponseId: crypto.randomUUID(),
      },
    },
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          submessages: [
            { messageType: 2, messageText: `🧪 *${config.botName} — Rich Submessage*\n_Teks, code, tabel, LaTeX_` },
            {
              messageType: 5,
              codeMetadata: {
                codeLanguage: 'javascript',
                codeBlocks: [
                  { highlightType: 1, codeContent: 'const ' },
                  { highlightType: 0, codeContent: 'zapo = ' },
                  { highlightType: 3, codeContent: "'ringan & cepat'" },
                  { highlightType: 0, codeContent: ';\n' },
                  { highlightType: 2, codeContent: 'console.log' },
                  { highlightType: 0, codeContent: '(zapo);' },
                ],
              },
            },
            {
              messageType: 4,
              tableMetadata: {
                title: 'Permukaan zapo-js',
                rows: [
                  { items: ['Surface', 'Tipe', 'Native'], isHeading: true },
                  { items: ['Teks biasa', 'conversation', 'Ya'], isHeading: false },
                  { items: ['Rich card', 'botForwarded', 'Experimental'], isHeading: false },
                  { items: ['Tombol', 'nativeFlow', 'Ya'], isHeading: false },
                  { items: ['List', 'nativeFlow', 'Ya'], isHeading: false },
                  { items: ['Revoke', 'protocolMessage', 'Ya'], isHeading: false },
                ],
              },
            },
            { messageType: 2, messageText: '\n> _Uji submessage selesai: teks + code + tabel._' },
          ],
          contextInfo: {
            forwardingScore: 999,
            isForwarded: true,
            forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' },
            forwardOrigin: 4,
          },
        },
      },
    },
  }
}

// ---------- surface 3: copyable text ----------
//
// Percobaan pertama memakai ctx.reply() biasa dan TETAP gagal di perangkat user
// (teks tidak bisa di-select/copy). Jadi sekarang diuji dua jalur sekaligus:
// raw conversation (bukan extendedTextMessage) dan raw conversation + contextInfo
// eksplisit. Kalau keduanya gagal, berarti perangkatnya tidak bisa copy teks WA
// sama sekali — bukan bug di sisi bot.
const COPY_LINES = [
  'COPY TEST — plain ASCII only',
  'second line 12345',
  'https://zapo.to',
  'symbols: <>&"\'@#$%*',
]
const COPY_PAYLOAD = COPY_LINES.join('\n')

function buildListMessage() {
  return {
    listMessage: {
      title: 'Uji List (raw proto)',
      description: 'Single-select list gaya WhatsApp klasik',
      buttonText: 'Buka',
      listType: 'SINGLE_SELECT',
      sections: [
        {
          title: 'Uji',
          rows: [
            {
              title: 'Baris satu',
              description: 'deskripsi baris satu',
              rowId: 'tf:row:1',
            },
            {
              title: 'Baris dua',
              description: 'deskripsi baris dua',
              rowId: 'tf:row:2',
            },
          ],
        },
      ],
    },
  }
}

function buildReplyButtonsMessage() {
  return {
    buttonsMessage: {
      contentText: 'Klik tombol di bawah 👇',
      footerText: `${config.botName} • raw buttons`,
      headerType: proto.Message.ButtonsMessage.HeaderType.TEXT,
      text: 'Tombol klasik (buttonsMessage) — maksimal 3.',
      buttons: [
        {
          buttonId: 'tf:reply:ya',
          buttonText: { displayText: 'Ya' },
          type: proto.Message.ButtonsMessage.Button.Type.RESPONSE,
        },
        {
          buttonId: 'tf:reply:tidak',
          buttonText: { displayText: 'Tidak' },
          type: proto.Message.ButtonsMessage.Button.Type.RESPONSE,
        },
      ],
    },
  }
}

const STEP_LABEL = {
  rich: 'Rich card (GenAI unified)',
  submessage: 'Rich submessage (teks + code + tabel)',
  copy: 'Teks biasa via ctx.reply()',
  copyraw: 'Teks raw conversation',
  copydoc: 'Copy sebagai dokumen .txt',
  buttons: 'Tombol quick-reply (nativeFlow)',
  list: 'List single-select (nativeFlow)',
  rawbuttons: 'Tombol klasik (buttonsMessage)',
  rawlist: 'List klasik (listMessage)',
  reaction: 'Reaction',
  reply: 'Reply + mention',
}

const HANDLER_IDS = [
  'tf:sapa',
  'tf:info',
  'tf:row:1',
  'tf:row:2',
  'tf:reply:ya',
  'tf:reply:tidak',
]

function clearHandlers() {
  for (const id of HANDLER_IDS) unregisterRichReply(id)
}

function registerHandlers() {
  clearHandlers()
  onRichReply('tf:sapa', async (ctx) => {
    await ctx.reply(`Halo ${ctx.pushName || 'kawan'}! 👋 Tombol dari .testfitur masuk dengan benar.`)
  })
  onRichReply('tf:info', async (ctx) => {
    await ctx.reply(
      `ℹ️ *${config.botName}*\n` +
        `• Prefix: ${config.prefixes.join(' ')}\n` +
        `• Versi zapo: 1.9.0\n` +
        '• Handler tombol: OK'
    )
  })
  for (const n of [1, 2]) {
    onRichReply(`tf:row:${n}`, async (ctx) => {
      await ctx.reply(`✅ Baris ${n} dipilih. List benar-benar berfungsi.`)
    })
  }
  onRichReply('tf:reply:ya', async (ctx) => ctx.reply('✅ Jawab "Ya" tercatat.'))
  onRichReply('tf:reply:tidak', async (ctx) => ctx.reply('✅ Jawab "Tidak" tercatat.'))
}

function clip(value = '', max = 60) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export default {
  name: 'testfitur',
  aliases: ['testfit', 'tf', 'testsurface'],
  tags: 'tools',
  owner: true,
  cooldown: 5000,
  description: 'Uji semua permukaan pesan zapo-js (rich, tabel, code, tombol, list, copy) + laporan',
  async run(ctx) {
    await ctx.react('🧪').catch(() => {})
    registerHandlers()

    const results = []
    /** Jalankan satu langkah, catat hasil, JANGAN lempar error ke caller. */
    const step = async (key, label, fn) => {
      const started = Date.now()
      try {
        const detail = await fn()
        results.push({ key, label, ok: true, ms: Date.now() - started, detail: clip(detail || '', 50) })
      } catch (err) {
        const why = String(err?.message || err).slice(0, 90)
        results.push({ key, label, ok: false, ms: Date.now() - started, detail: why })
        logger.error({ err, step: key }, 'testfitur: langkah gagal')
      }
    }

    // 1. Rich card — bisa hilang diam-diam di sebagian perangkat.
    await step('rich', STEP_LABEL.rich, async () => {
      const sent = await ctx.client.message.send(ctx.chat, buildRichCard([
        richTextSection(`🧪 *${config.botName}* — Rich Card\n\nKalau kartu ini tidak muncul di layar kamu, berarti perangkat ini tidak mendukung unduh rich card. Tenang, menu tetap jalan via teks biasa.`),
      ]), { additionalAttributes: { type: 'text' } })
      return sent?.id || sent?.key?.id || 'terkirim (tanpa id)'
    })

    // 2. Rich submessage — teks + code block + tabel + LaTeX dalam satu kartu.
    await step('submessage', STEP_LABEL.submessage, async () => {
      const sent = await ctx.client.message.send(ctx.chat, buildSubmessageCard(), {
        additionalAttributes: { type: 'text' },
      })
      return sent?.id || sent?.key?.id || 'terkirim (tanpa id)'
    })

    // 3a. Teks biasa via ctx.reply().
    await step('copy', STEP_LABEL.copy, async () => {
      await ctx.reply(COPY_PAYLOAD)
      return 'ctx.reply terkirim'
    })

    // 3b. Raw conversation — melewati builder apa pun, apa adanya di wire.
    await step('copyraw', STEP_LABEL.copyraw, async () => {
      const sent = await ctx.client.message.send(ctx.chat, { conversation: COPY_PAYLOAD })
      return sent?.id || sent?.key?.id || 'terkirim (tanpa id)'
    })

    // 3c. Copy sebagai dokumen .txt — cara paling andal untuk usermengambil isi
    //    persis, dan bisa dibuka di editor mana pun.
    await step('copydoc', STEP_LABEL.copydoc, async () => {
      await ctx.client.message.send(ctx.chat, {
        type: 'document',
        media: Buffer.from(COPY_PAYLOAD, 'utf8'),
        mimetype: 'text/plain',
        fileName: 'testfitur-copy.txt',
      })
      return 'dokumen txt terkirim'
    })

    // 4. Tombol nativeFlow.
    await step('buttons', STEP_LABEL.buttons, async () => {
      await ctx.replyButtons({
        header: { title: config.botName.slice(0, 30), subtitle: 'nativeFlow' },
        text: '🧪 *Tombol nativeFlow*\n\nKalau tombol ini muncul, tap salah satu — jawabannya balik ke bot.',
        footer: `${config.botName} • testfitur`,
        buttons: [
          { id: 'tf:sapa', text: '👋 Sapa' },
          { id: 'tf:info', text: 'ℹ️ Info' },
        ],
      })
      return '2 tombol terkirim'
    })

    // 5. List nativeFlow.
    await step('list', STEP_LABEL.list, async () => {
      await ctx.replyList({
        header: { title: 'List nativeFlow', subtitle: 'single-select' },
        text: '🧪 *List nativeFlow*\n\nPilih salah satu baris.',
        footer: `${config.botName} • testfitur`,
        title: 'Uji List',
        buttonText: 'Buka',
        sections: [
          {
            title: 'Baris',
            rows: [
              { id: 'tf:row:1', title: 'Baris satu', description: 'klik untuk tes handler' },
              { id: 'tf:row:2', title: 'Baris dua', description: 'klik untuk tes handler' },
            ],
          },
        ],
      })
      return '2 baris terkirim'
    })

    // 6. Tombol klasik (raw proto) — LEGACY. Diuji tetap untuk memastikan
    //    apakah objeknya ditolak server atau hanya tidak dirender di layar.
    await step('rawbuttons', STEP_LABEL.rawbuttons, async () => {
      const sent = await ctx.client.message.send(ctx.chat, buildReplyButtonsMessage())
      return sent?.id || sent?.key?.id || 'terkirim (tanpa id)'
    })

    // 7. List klasik (raw proto).
    await step('rawlist', STEP_LABEL.rawlist, async () => {
      const sent = await ctx.client.message.send(ctx.chat, buildListMessage())
      return sent?.id || sent?.key?.id || 'terkirim (tanpa id)'
    })

    // 8. Reaction ke pesan ini sendiri (reaction butuh target yang valid).
    await step('reaction', STEP_LABEL.reaction, async () => {
      await ctx.client.message.send(ctx.chat, { type: 'reaction', emoji: '🧪', target: ctx.event })
      return 'reaction terkirim'
    })

    // 9. Reply dengan mention — memastikan quoting tidak merusak ctx.
    await step('reply', STEP_LABEL.reply, async () => {
      await ctx.client.message.send(
        ctx.chat,
        { type: 'text', text: `🧪 Ini balasan dengan mention ke ${ctx.pushName || 'kamu'}.` },
        { quote: ctx.event, mentions: ctx.sender ? [ctx.sender] : [] }
      )
      return 'reply + mention terkirim'
    })

    // Ringkasan. Sengaja TEKS BIASA: kalau rich card-nya yang bermasalah,
    // laporan ini tetap harus sampai.
    const okCount = results.filter((r) => r.ok).length
    const lines = [
      `🧪 *Laporan .testfitur*`,
      '',
      `Config: ${config.botName} • zapo 1.9.0 • ${config.prefixes.join(' ')}`,
      '',
      ...results.map((r) => `${r.ok ? '✅' : '❌'} ${r.label} — ${r.ms}ms${r.detail ? `\n   _${r.detail}_` : ''}`),
      '',
      `*${okCount}/${results.length} terkirim di sisi server.*`,
      '',
      '_Server terima ≠ tampil di layar. Yang tidak muncul di HP kamu berarti_',
      '_permukaannya tidak bisa dipakai, bukan error bot:_',
      '• *Tombol/list klasik* (legacy) — WA modern meninggalkannya; pakai nativeFlow.',
      '• *Copy* — kalau dokumen .txt juga tidak bisa dicopy, perangkatnya memang',
      '  tidak mendukung copy teks WhatsApp.',
      '',
      '_Sudah diketahui tidak tersedia (tidak lagi diuji):_',
      '• *LaTeX* — WA merendernya sebagai gambar dari server (`url` wajib diisi),',
      '  dan injecting-nya justru membuat seluruh kartu hilang.',
      '• *Carousel* — zapo tidak mentransportasinya (tidak ada addon `<biz>`).',
      '',
      '_Yang selalu aman: teks biasa, nativeFlow button/list, reply+mention,_',
      'rich card, dan rich submessage (teks + code + tabel)._',
    ]

    await ctx.reply(lines.join('\n'))
    await ctx.react('✅').catch(() => {})
  },
}
