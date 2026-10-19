/**
 * Claide Bot by Alfi
 * Generic HTTP Face Swap provider adapter.
 */
import 'dotenv/config'

const apiUrl = process.env.FACESWAP_API_URL || ''
const apiKey = process.env.FACESWAP_API_KEY || ''

function toPayload(value) {
  if (Buffer.isBuffer(value)) return `data:image/jpeg;base64,${value.toString('base64')}`
  return String(value)
}

export async function faceSwap(source, target) {
  if (!apiUrl || !apiKey) {
    const error = new Error('Provider Face Swap belum dikonfigurasi')
    error.code = 'PROVIDER_NOT_CONFIGURED'
    throw error
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Claide-Bot-by-Alfi/0.1',
    },
    body: JSON.stringify({ source: toPayload(source), target: toPayload(target) }),
    signal: AbortSignal.timeout(90_000),
  })

  const raw = await response.text()
  if (Buffer.byteLength(raw, 'utf8') > 1024 * 1024) throw new Error('Respons Face Swap terlalu besar')
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('Respons provider Face Swap tidak valid')
  }
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `Provider Face Swap gagal (HTTP ${response.status})`)
  }

  const resultUrl = data?.resultUrl || data?.url || data?.data?.url
  if (!resultUrl) throw new Error('Provider Face Swap tidak mengembalikan URL hasil')
  return { resultUrl: String(resultUrl) }
}
