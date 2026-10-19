/**
 * © JamvanHax0r — Fiony Bot
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * jhrich.js — engine kirim rich HTML bot TANPA "verifikasi unduh".
 *
 * Pakai: import { sendRichJH } from '../../lib/jhrich.js'
 *        await sendRichJH(ctx, htmlPayload)
 */

import crypto from 'node:crypto';

const SIG_MATERIAL = Buffer.from('JH.FionyVerseV1.0-VerificationSignature.Metadata');
const CERT_MATERIAL = Buffer.from('JH.FionyVerseV1.0-CertificateChain.Metadata');

export function generateVerificationMetadata() {
  const signature = Buffer.concat([SIG_MATERIAL, crypto.randomBytes(64 - SIG_MATERIAL.length)]).toString('base64');
  const certificateChain = [
    Buffer.concat([CERT_MATERIAL, crypto.randomBytes(684 - CERT_MATERIAL.length)]).toString('base64'),
    Buffer.concat([CERT_MATERIAL, crypto.randomBytes(892 - CERT_MATERIAL.length)]).toString('base64')
  ];
  return { proofs: [{ version: 1, useCase: 1, signature, certificateChain }] };
}

export function buildRichContent(html) {
  return {
    messageContextInfo: {
      deviceListMetadata: {},
      deviceListMetadataVersion: 2,
      botMetadata: {
        messageDisclaimerText: '',
        verificationMetadata: generateVerificationMetadata(),
        botResponseId: crypto.randomUUID()
      }
    },
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          unifiedResponse: {
            data: Buffer.from(JSON.stringify({
              __typename: 'GenAIUnifiedResponse',
              response_id: crypto.randomUUID(),
              sections: [{
                __typename: 'GenAIUnifiedResponseSection',
                view_model: {
                  __typename: 'GenAISingleLayoutViewModel',
                  primitive: {
                    __typename: 'FOAHtmlPrimitiveDemoDONOTUSE',
                    trusted_sources: [],
                    payload: html
                  }
                }
              }]
            })).toString('base64')
          },
          contextInfo: {
            forwardingScore: 1,
            isForwarded: true,
            forwardedAiBotMessageInfo: { botJid: '236911050403982@bot' },
            forwardOrigin: 4
          }
        }
      }
    }
  };
}

export async function sendRichJH(ctx, html, opts = {}) {
  const withEdit = opts.withEdit !== false;
  const content = buildRichContent(html);

  const sent = await ctx.client.message.send(ctx.chat, content, {
    additionalAttributes: { type: 'text' }
  });
  const id = sent?.id || sent?.key?.id || null;
  console.log('[JHRich] sent | id=' + (id || '?'));

  if (!id || !withEdit) return sent;

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
    }, { additionalAttributes: { type: 'text' } });
    console.log('[JHRich] bypass-edit OK | target=' + id);
  } catch (e) {
    console.log('[JHRich] bypass-edit fail:', String(e?.message || e).slice(0, 120));
  }

  return sent;
}
