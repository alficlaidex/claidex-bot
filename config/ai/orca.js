/**
 * Claide Bot by Alfi
 * OpenAI-compatible AI adapter used by the Claide AI feature.
 */
import 'dotenv/config'

const apiBase = (process.env.ORCA_API_URL || '').replace(/\/+$/, '')
const apiKey = process.env.ORCA_API_KEY || ''
const model = process.env.ORCA_MODEL || ''
const visionModel = process.env.ORCA_VISION_MODEL || ''
const jinaApiKey = process.env.JINA_API_KEY || ''

export const CLAIDE_AI_PERSONA = [
  'Kamu adalah Claide AI, asisten WhatsApp yang ramah, akurat, dan ringkas.',
  'Utamakan bahasa Indonesia kecuali pengguna meminta bahasa lain.',
  'Jangan mengarang fakta. Jika tidak yakin, katakan tidak yakin.',
  'Jangan membocorkan credential, isi file sensitif, atau detail internal yang tidak diperlukan.',
].join(' ')

export const ORCA_CONFIG = Object.freeze({
  configured: Boolean(apiBase && apiKey && model),
  visionConfigured: Boolean(apiBase && apiKey && visionModel),
  model,
  visionModel,
  temperature: 0.6,
})

function configuredError(capability) {
  const error = new Error(`${capability} belum dikonfigurasi`)
  error.code = 'PROVIDER_NOT_CONFIGURED'
  return error
}

function normalizeMessageContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')

  return content.map((part) => {
    if (part?.type === 'text') return part.text || ''
    if (part?.type === 'image_url') return part.image_url?.url || part.image || ''
    return ''
  }).filter(Boolean).join('\n')
}

async function parseCompletion(response) {
  const raw = await response.text()
  if (Buffer.byteLength(raw, 'utf8') > 2 * 1024 * 1024) {
    throw new Error('Respons AI terlalu besar')
  }

  let data
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('Provider AI mengembalikan respons JSON yang tidak valid')
  }

  if (!response.ok) {
    const detail = data?.error?.message || data?.message
    throw new Error(detail || `Provider AI gagal (HTTP ${response.status})`)
  }

  const text = data?.choices?.[0]?.message?.content
  if (Array.isArray(text)) {
    return { text: text.map((part) => part?.text || '').join('').trim() }
  }
  return { text: String(text || '').trim() }
}

async function chat(messages, options = {}) {
  if (!ORCA_CONFIG.configured) throw configuredError('Claide AI')

  const selectedModel = options.model || model
  if (!selectedModel) throw configuredError('Model AI')

  const response = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Claide-Bot-by-Alfi/0.1',
    },
    body: JSON.stringify({
      model: selectedModel,
      messages: messages.map((message) => ({
        role: message.role,
        content: normalizeMessageContent(message.content),
      })),
      temperature: Number.isFinite(options.temperature) ? options.temperature : ORCA_CONFIG.temperature,
      max_tokens: Math.max(256, Math.min(Number(options.max_tokens) || 2000, 8000)),
    }),
    signal: AbortSignal.timeout(90_000),
  })

  return parseCompletion(response)
}

function visionMessage(image, text) {
  const imageUrl = String(image || '').startsWith('data:image/')
    ? image
    : `data:image/jpeg;base64,${Buffer.from(String(image || '')).toString('base64')}`

  return {
    role: 'user',
    content: [
      { type: 'text', text: String(text || 'Deskripsikan gambar ini.') },
      { type: 'image_url', image_url: { url: imageUrl } },
    ],
  }
}

async function jinaRequest(pathname, target, maxLength) {
  if (!jinaApiKey) return null

  const url = pathname === 'search'
    ? new URL('https://r.jina.ai/search')
    : new URL(`https://r.jina.ai/${target}`)
  if (pathname === 'search') url.searchParams.set('q', target)
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${jinaApiKey}`,
      Accept: 'text/plain',
      'User-Agent': 'Claide-Bot-by-Alfi/0.1',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) return null

  const raw = await response.text()
  return raw.slice(0, Math.max(1000, Math.min(Number(maxLength) || 12_000, 40_000)))
}

export const jina = Object.freeze({
  read: (url, maxLength) => jinaRequest('http://', url, maxLength),
  search: (query, maxLength) => jinaRequest('search', query, maxLength),
})

export const orca = Object.freeze({
  chat,
  visionMessage,
  configured: ORCA_CONFIG.configured,
})
