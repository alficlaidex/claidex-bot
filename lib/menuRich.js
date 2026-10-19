/**
 * Claide Bot by Alfi
 * Based on Fiony Bot © JamvanHax0r. Upstream attribution is preserved.
 * lib/menuRich.js — Bangun rich response "unified" (GenAI) untuk menu.
 *
 * IMPORTANT — kenapa tidak pakai `carouselMessage` / `relayMessage`:
 *
 *  1. `relayMessage` tidak ada di zapo-js. API publiknya cuma
 *     `client.message.send()`. Versi lama yang pakai `ctx.client.relayMessage(...)`
 *     akan throw `is not a function` lalu diam-diam jatuh ke teks biasa.
 *
 *  2. `carouselMessage` memang ada di waproto, tapi zapo-js hanya memasang
 *     stanza addon (`biz`/`interactive`) untuk `nativeFlowMessage`
 *     (lihat resolveButtonAddonKindFrom di message/encode/content.js).
 *     Untuk carousel tidak ada addon, jadi stanza dikirim sebagai `type=interactiveMessage`
 *     polos tanpa companion `<biz>` — WhatsApp mengabaikannya. Gejalanya persis
 *     yang terjadi: reaction masuk, pesan tidak pernah sampai.
 *
 * Yang WORKS di codebase ini dan sudah dipakai Aurora/Uno: `botForwardedMessage`
 * + `richResponseMessage.unifiedResponse` (GenAI), dikirim lewat `message.send`
 * dengan `additionalAttributes: { type: 'text' }`. Menu memakai jalur itu.
 */
import crypto from 'node:crypto'
import { generateVerificationMetadata } from './jhrich.js'

/** Base64 payload GenAI unified response. */
export function buildUnifiedData(sections) {
  const payload = {
    __typename: 'GenAIUnifiedResponse',
    response_id: crypto.randomUUID(),
    sections,
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64')
}

/**
 * Bungkus object content menjadi pesan rich yang siap dikirim.
 * @param {object} opts
 * @param {Array}  opts.sections  - section view_model (lihat buildMenuSections)
 * @param {string} opts.botJid    - jid bot untuk contextInfo forwardedAiBotMessageInfo
 */
export function buildRichMessage({ sections, botJid, disclaimers = '' }) {
  return {
    messageContextInfo: {
      deviceListMetadata: {},
      deviceListMetadataVersion: 2,
      botMetadata: {
        messageDisclaimerText: disclaimers,
        // Aurora/Uno mengirim ini dan itu works; WhatsApp butuh signature
        // utk render unifiedResponse tanpa banner "unverified".
        verificationMetadata: generateVerificationMetadata(),
        botResponseId: crypto.randomUUID(),
      },
    },
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          // submessages dikosongkan: kalau diisi, WhatsApp ANGPAK ada teks quotable
          // di dalam rich card dan banner/tree akan terpotong.
          submessages: [],
          unifiedResponse: { data: buildUnifiedData(sections) },
          contextInfo: {
            forwardingScore: 1,
            isForwarded: true,
            forwardedAiBotMessageInfo: { botJid },
            forwardOrigin: 4,
          },
        },
      },
    },
  }
}

/** Section banner gambar di atas card. */
export function imageSection(url, mimeType = 'image/jpeg') {
  return {
    __typename: 'GenAIUnifiedResponseSection',
    view_model: {
      __typename: 'GenAISingleLayoutViewModel',
      primitive: {
        __typename: 'GenAIImaginePrimitive',
        media: { url, mime_type: mimeType, width: 16, height: 9 },
        imagine_type: 'IMAGE',
        status: { status: 'READY' },
      },
    },
  }
}

/** Section card teks (hscroll 1 kolom) — dipakai untuk isi menu. */
export function textCardSection(title) {
  return {
    __typename: 'GenAIUnifiedResponseSection',
    view_model: {
      __typename: 'GenAIHScrollLayoutViewModel',
      primitives: [
        {
          __typename: 'GenAI3PExtWidgetPrimitive',
          header: {
            __typename: 'GenAI3PExtWidgetStandardHeader',
            title,
          },
          body: {
            __typename: 'GenAI3PExtCalendarEventList',
            sections: [],
          },
        },
      ],
    },
  }
}

/** Kirim rich menu. Return id pesan kalau berhasil. */
export async function sendRichMenu(ctx, sections, { disclaimers = '' } = {}) {
  const botJid = ctx.client.getCredentials?.()?.meJid || '867051314767696@bot'
  const content = buildRichMessage({ sections, botJid, disclaimers })
  const sent = await ctx.client.message.send(ctx.chat, content, {
    additionalAttributes: { type: 'text' },
  })
  return sent?.id || sent?.key?.id || null
}