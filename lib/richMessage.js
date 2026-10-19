/**
 * richMessage.js — Builder & reader untuk interactive messages
 *
 * Bentuk payload mengikuti waproto InteractiveMessage:
 *  - header  : { title, subtitle, hasMediaAttachment? }
 *  - body    : { text }
 *  - footer  : { text, hasMediaAttachment? }
 *  - nativeFlowMessage : { messageVersion, buttons: [{ name, buttonParamsJson }] }
 *  - carouselMessage   : { messageVersion, carouselCardType, cards: [InteractiveMessage] }
 */

/** Header opsional buat interactive message. Null/undefined = tanpa header. */
function buildHeader(header) {
  if (!header) return undefined
  const title = String(header.title ?? '').trim()
  const subtitle = String(header.subtitle ?? '').trim()
  if (!title && !subtitle) return undefined
  return {
    title: title || undefined,
    subtitle: subtitle || undefined,
    hasMediaAttachment: Boolean(header.hasMediaAttachment),
  }
}

function quickReplyButtons(buttons = []) {
  return buttons.map((btn) => ({
    name: btn.name || 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: btn.text,
      id: btn.id,
    }),
  }))
}

/** Quick reply buttons (max ~10) */
export function richButtons({ text, footer, header, buttons }) {
  return {
    interactiveMessage: {
      header: buildHeader(header),
      body: { text },
      footer: footer ? { text: footer } : undefined,
      nativeFlowMessage: {
        messageVersion: 1,
        buttons: quickReplyButtons(buttons),
      },
    },
  }
}

/** Single-select list dropdown */
export function richList({ text, footer, header, title, buttonText, sections }) {
  return {
    interactiveMessage: {
      header: buildHeader(header),
      body: { text },
      footer: footer ? { text: footer } : undefined,
      nativeFlowMessage: {
        messageVersion: 1,
        buttons: [
          {
            name: 'single_select',
            buttonParamsJson: JSON.stringify({
              title,
              button_text: buttonText,
              sections: sections.map((section) => ({
                title: section.title,
                rows: section.rows.map((row) => ({
                  title: row.title,
                  description: row.description ?? '',
                  id: row.id,
                })),
              })),
            }),
          },
        ],
      },
    },
  }
}

/**
 * Carousel cards (native WhatsApp "carousel" surface, HSCROLL_CARDS).
 * Setiap card adalah InteractiveMessage penuh dengan header/body/footer +
 * tombol quick reply sendiri, jadi tiap kartu bisa punya aksi berbeda.
 *
 * Balasan taps kartu kembali lewat interactiveResponseMessage
 * -> nativeFlowResponseMessage.paramsJson (dibaca readRichReply).
 */
export function richCarousel({ text, footer, header, cards, cardType = 1 }) {
  return {
    interactiveMessage: {
      header: buildHeader(header),
      body: { text },
      footer: footer ? { text: footer } : undefined,
      carouselMessage: {
        messageVersion: 1,
        carouselCardType: cardType,
        cards: cards.map((card) => ({
          header: buildHeader(card.header),
          body: { text: card.body ?? '' },
          footer: card.footer ? { text: card.footer } : undefined,
          nativeFlowMessage: {
            messageVersion: 1,
            buttons: quickReplyButtons(card.buttons ?? []),
          },
        })),
      },
    },
  }
}

/**
 * Parse incoming rich reply (button/list/carousel/native flow response).
 *
 * `cardIndex` diisi kalau responsnya datang dari carousel: WhatsApp mengirim
 * index kartu terpilih di `templateButtonReplyMessage.selectedCarouselCardIndex`
 * atau di paramsJson native flow. `id` tetap sumber kebenaran utama; kalau
 * carousel tidak menyertakan id per kartu, kembalikan id kosong supaya handler
 * bisa fallback ke cardIndex.
 */
export function readRichReply(message) {
  if (!message) return undefined

  const tpl = message.templateButtonReplyMessage
  const tplCardIndex = tpl?.selectedCarouselCardIndex ?? undefined

  if (tpl?.selectedId) {
    return {
      name: 'template_button_reply',
      id: tpl.selectedId,
      cardIndex: tplCardIndex,
      raw: {
        selectedDisplayText: tpl.selectedDisplayText,
        selectedIndex: tpl.selectedIndex,
      },
    }
  }

  const flow = message.interactiveResponseMessage?.nativeFlowResponseMessage
  if (flow) {
    let params = {}
    try { params = flow.paramsJson ? JSON.parse(flow.paramsJson) : {} } catch {}
    const id = params.id ?? params.selected_row_id ?? params.row_id ?? params.card_id ?? ''
    const cardIndex = params.card_index ?? params.selected_card_index ?? tplCardIndex
    if (id || cardIndex !== undefined) {
      return { name: flow.name ?? 'native_flow', id, cardIndex, raw: params }
    }
  }

  // Kartu carousel yang dipilih tanpa id dan tanpa nativeFlowResponseMessage:
  // cuma index kartu yang bisa dipakai.
  if (tplCardIndex !== undefined) {
    return {
      name: 'carousel_card',
      id: '',
      cardIndex: tplCardIndex,
      raw: { selectedIndex: tpl.selectedIndex },
    }
  }

  const btn = message.buttonsResponseMessage
  if (btn?.selectedButtonId) {
    return { name: 'buttons_response', id: btn.selectedButtonId, raw: btn }
  }

  const rowId = message.listResponseMessage?.singleSelectReply?.selectedRowId
  if (rowId) {
    return { name: 'list_response', id: rowId, raw: message.listResponseMessage }
  }

  // Quoted quick reply
  const ext = message.extendedTextMessage
  const quoted = ext?.contextInfo?.quotedMessage
  const interactive = quoted?.interactiveMessage ?? quoted?.viewOnceMessage?.message?.interactiveMessage
  const buttons = interactive?.nativeFlowMessage?.buttons

  if (ext?.text && Array.isArray(buttons)) {
    for (const b of buttons) {
      let params = {}
      try { params = JSON.parse(b.buttonParamsJson || '{}') } catch { continue }
      if (params.id && params.display_text === ext.text) {
        return { name: 'quoted_quick_reply', id: params.id, raw: params }
      }
      for (const section of params.sections ?? []) {
        for (const row of section.rows ?? []) {
          if (row.id && (row.title === ext.text || `${row.title}\n${row.description}` === ext.text)) {
            return { name: 'quoted_single_select', id: row.id, raw: row }
          }
        }
      }
    }
  }

  return undefined
}
