/**
 * richMenu.js — Rich response menu dengan table format
 * Pakai: import { sendRichMenu } from '../../lib/richMenu.js'
 */
import crypto from 'node:crypto'

const SIG = Buffer.from('JH.FionyVerseV1.0-VerificationSignature.Metadata')
const CERT = Buffer.from('JH.FionyVerseV1.0-CertificateChain.Metadata')

function genVerification() {
  const sig = Buffer.concat([SIG, crypto.randomBytes(64 - SIG.length)]).toString('base64')
  const chain = [
    Buffer.concat([CERT, crypto.randomBytes(684 - CERT.length)]).toString('base64'),
    Buffer.concat([CERT, crypto.randomBytes(892 - CERT.length)]).toString('base64')
  ]
  return { proofs: [{ version: 1, useCase: 1, signature: sig, certificateChain: chain }] }
}

/**
 * Build rich response message dengan table
 * @param {Object} opts
 * @param {string} opts.header - Text header
 * @param {string} opts.title - Table title
 * @param {Array} opts.tableRows - [{ items: string[], isHeading: boolean }]
 * @param {string} opts.footer - Text footer
 * @param {string} opts.lang - Code language (optional, for code blocks)
 * @param {string} opts.code - Code content (optional, for code blocks)
 */
export function buildRichMenu({ header, title, tableRows, footer, lang, code }) {
  const submessages = []

  if (header) {
    submessages.push({ messageType: 2, messageText: header })
  }

  if (lang && code) {
    submessages.push({
      messageType: 5,
      codeMetadata: {
        codeLanguage: lang,
        codeBlocks: [{ highlightType: 0, codeContent: code }]
      }
    })
  }

  if (tableRows?.length) {
    submessages.push({
      messageType: 4,
      tableMetadata: {
        title: title || 'Menu',
        rows: tableRows
      }
    })
  }

  if (footer) {
    submessages.push({ messageType: 2, messageText: footer })
  }

  return {
    messageContextInfo: {
      deviceListMetadata: {},
      deviceListMetadataVersion: 2,
      botMetadata: {
        messageDisclaimerText: '',
        verificationMetadata: genVerification(),
        botResponseId: crypto.randomUUID()
      }
    },
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          submessages,
          contextInfo: {
            forwardingScore: 999,
            isForwarded: true,
            forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' },
            forwardOrigin: 4
          }
        }
      }
    }
  }
}

/**
 * Kirim rich menu ke chat
 */
export async function sendRichMenu(ctx, opts) {
  const content = buildRichMenu(opts)
  const sent = await ctx.client.message.send(ctx.chat, content, {
    additionalAttributes: { type: 'text' }
  })

  // Bypass "verifikasi unduh" via edit
  const id = sent?.id || sent?.key?.id
  if (id) {
    try {
      await ctx.client.message.send(ctx.chat, {
        botForwardedMessage: {
          message: {
            protocolMessage: {
              key: { remoteJid: ctx.chat, fromMe: true, id },
              type: 14,
              editedMessage: content
            }
          }
        }
      }, { additionalAttributes: { type: 'text' } })
    } catch {}
  }

  return sent
}
