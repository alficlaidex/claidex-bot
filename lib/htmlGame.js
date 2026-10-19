/**
 * Claide Bot by Alfi
 * Adapted from JHZ-Bot © Fathur. Upstream attribution is preserved.
 * lib/htmlGame.js — Send a self-contained HTML primitive to WhatsApp.
 */
import crypto from 'node:crypto'

export async function sendHtmlGame(ctx, { html, title = 'Interactive', trustedSources = [] }) {
  if (!html || Buffer.byteLength(html, 'utf8') > 1_100_000) {
    throw new Error('Payload HTML terlalu besar atau kosong')
  }
  const botJid = ctx.client.getCredentials?.()?.meJid || '867051314767696@bot'
  const unifiedPayload = {
    __typename: 'GenAIUnifiedResponse',
    response_id: crypto.randomUUID(),
    sections: [
      {
        __typename: 'GenAIUnifiedResponseSection',
        view_model: {
          __typename: 'GenAISingleLayoutViewModel',
          primitive: {
            __typename: 'GenAIaeacdsnwHtmlPrimitive',
            payload: html,
            trusted_sources: trustedSources
          }
        }
      }
    ]
  }

  const payload = {
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          submessages: [],
          unifiedResponse: {
            data: Buffer.from(JSON.stringify(unifiedPayload)).toString('base64')
          },
          contextInfo: {
            isForwarded: true,
            forwardOrigin: 4,
            forwardedAiBotMessageInfo: {
              botJid
            }
          }
        }
      }
    }
  }

  return ctx.client.message.send(ctx.chat, payload, {
    additionalAttributes: { type: 'text' },
    customNodes: [
      {
        tag: 'biz',
        attrs: {},
        content: [
          {
            tag: 'interactive',
            attrs: { type: 'native_flow', v: '1' },
            content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
          }
        ]
      }
    ]
  })
}
