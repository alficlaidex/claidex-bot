/**
 * Claide Bot by Alfi
 * OpenAI-compatible DuckAI adapter.
 */
import 'dotenv/config'

const apiBase = (process.env.DUCKAI_API_URL || '').replace(/\/+$/, '')
const apiKey = process.env.DUCKAI_API_KEY || ''
export const DUCKAI_DEFAULT_MODEL = process.env.DUCKAI_MODEL || 'duckchat-v1'
const configured = Boolean(apiBase && apiKey && DUCKAI_DEFAULT_MODEL)

function notConfigured() {
  const error = new Error('DuckAI belum dikonfigurasi')
  error.code = 'PROVIDER_NOT_CONFIGURED'
  return error
}

async function readJson(response) {
  const raw = await response.text()
  if (Buffer.byteLength(raw, 'utf8') > 2 * 1024 * 1024) throw new Error('Respons DuckAI terlalu besar')
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('Respons DuckAI tidak valid')
  }
  if (!response.ok) {
    throw new Error(data?.error?.message || `DuckAI gagal (HTTP ${response.status})`)
  }
  return data
}

export async function fetchDuckAiModels() {
  if (!configured) {
    return [{
      id: DUCKAI_DEFAULT_MODEL,
      name: 'DuckAI (belum dikonfigurasi)',
      capabilities: { images: false, generation: false },
    }]
  }

  const response = await fetch(`${apiBase}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'Claide-Bot-by-Alfi/0.1',
    },
    signal: AbortSignal.timeout(20_000),
  })
  const data = await readJson(response)
  const models = Array.isArray(data?.data) ? data.data : []
  return models.map((model) => ({
    id: String(model.id || ''),
    name: String(model.name || model.id || 'DuckAI'),
    capabilities: {
      images: Boolean(model?.capabilities?.images ?? model?.vision),
      generation: Boolean(model?.capabilities?.generation ?? model?.image_generation),
    },
  })).filter((model) => model.id)
}

export async function duckAiChat(messages, options = {}) {
  if (!configured) throw notConfigured()

  const response = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Claide-Bot-by-Alfi/0.1',
    },
    body: JSON.stringify({
      model: options.model || DUCKAI_DEFAULT_MODEL,
      messages,
      temperature: Number.isFinite(options.temperature) ? options.temperature : 0.7,
      max_tokens: Math.max(256, Math.min(Number(options.max_tokens) || 2500, 8000)),
    }),
    signal: AbortSignal.timeout(90_000),
  })

  const data = await readJson(response)
  const content = data?.choices?.[0]?.message?.content
  return {
    text: Array.isArray(content)
      ? content.map((part) => part?.text || '').join('').trim()
      : String(content || '').trim(),
    images: [],
  }
}
