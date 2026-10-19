/**
 * Claide Bot by Alfi
 * Based on Fiony Bot © JamvanHax0r. Upstream attribution is preserved.
 * lib/media.js — Bounded incoming media download helper.
 */
import { resolveMediaPayload, unwrapMessage } from 'zapo-js'
import { logger } from '../core/logger.js'

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000

function findContainer(message) {
  if (!message) return null
  if (resolveMediaPayload(message)) return message

  const quoted = message.extendedTextMessage?.contextInfo?.quotedMessage
  return quoted && resolveMediaPayload(quoted) ? quoted : null
}

export async function downloadMedia(client, event, {
  maxBytes = DEFAULT_MAX_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const container = findContainer(event?.message)
  if (!container) return undefined

  const payload = resolveMediaPayload(container)
  try {
    const bytes = await client.message.downloadBytes(container, {
      maxBytes,
      timeoutMs,
      signal: AbortSignal.timeout(timeoutMs + 5_000),
    })
    return {
      buffer: Buffer.from(bytes),
      mimetype: payload?.mimetype || 'application/octet-stream',
      kind: payload?.mediaType || 'document',
      fileName: unwrapMessage(container)?.documentMessage?.fileName,
    }
  } catch (error) {
    logger.warn({ err: error.message, kind: payload?.mediaType }, 'Gagal/timeout unduh media')
    return undefined
  }
}
