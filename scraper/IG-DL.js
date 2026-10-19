/**
 * Claide Bot by Alfi
 * Generic Instagram downloader provider adapter.
 */
import 'dotenv/config'
import { assertPublicHttpUrl } from '../lib/urlSafety.js'

const apiUrl = process.env.IG_DOWNLOADER_API_URL || ''
const apiKey = process.env.IG_DOWNLOADER_API_KEY || ''

function parseInstagramUrl(input) {
  const url = new URL(String(input))
  const host = url.hostname.toLowerCase()
  if (!['instagram.com', 'www.instagram.com', 'instagr.am', 'www.instagr.am'].includes(host)) {
    throw new Error('URL harus menunjuk ke Instagram')
  }
  return url.href
}

function normalizeMedia(item) {
  if (typeof item === 'string') return { type: 'video', url: item }
  const mediaUrl = item?.url || item?.downloadUrl || item?.download_url
  if (!mediaUrl) return null
  const parsed = new URL(String(mediaUrl))
  if (parsed.protocol !== 'https:') return null
  const declaredType = String(item.type || item.media_type || '').toLowerCase()
  return {
    type: declaredType.includes('image') ? 'image' : 'video',
    url: parsed.href,
  }
}

export async function downloadInstagram(input) {
  const url = parseInstagramUrl(input)
  await assertPublicHttpUrl(url)

  if (!apiUrl || !apiKey) {
    const error = new Error('Provider Instagram downloader belum dikonfigurasi')
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
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(60_000),
  })

  const raw = await response.text()
  if (Buffer.byteLength(raw, 'utf8') > 2 * 1024 * 1024) throw new Error('Respons provider terlalu besar')
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new Error('Respons provider Instagram tidak valid')
  }
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Provider gagal (HTTP ${response.status})`)
  }

  const source = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.data?.data) ? payload.data.data : []
  const data = source.map(normalizeMedia).filter(Boolean)
  if (!data.length) throw new Error('Tidak ada media yang bisa diunduh')
  return { success: true, data }
}

export const JHIGDL = downloadInstagram
