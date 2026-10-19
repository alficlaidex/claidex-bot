
/**
 * Claide Bot by Alfi
 * Adapted from JHZ-Bot © Fathur. Upstream attribution is preserved.
 * lib/youtube.js — YouTube search (yt-search, no API key; Innertube fallback)
 * and downloader (j2download engine, no API key).
 */
import axios from 'axios'
import yts from 'yt-search'
import { toAudio } from './converter.js'
import { resolveDownload } from './j2download.js'

const INNERTUBE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024
const YT_ID_RE = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/

export function extractVideoId(value = '') {
  return String(value).match(YT_ID_RE)?.[1] || ''
}

// ============ SEARCH ============

function findVideoRenderer(node, out) {
  if (!node || typeof node !== 'object') return
  if (node.videoRenderer?.videoId) {
    out.push(node.videoRenderer)
    return
  }
  for (const key in node) findVideoRenderer(node[key], out)
}

function innerTubeDurationToSeconds(timeStr = '0:00') {
  const parts = String(timeStr).split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] || 0
}

// Fallback: Innertube search endpoint works without any API key.
async function searchInnerTube(query, limit = 10) {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': INNERTUBE_UA,
        'X-Youtube-Client-Name': '1',
        'X-Youtube-Client-Version': '2.20260901.00.00'
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20260901.00.00', hl: 'en', gl: 'US' } },
        query
      }),
      signal: AbortSignal.timeout(10000)
    })
    if (!res.ok) return []
    const json = await res.json()
    const found = []
    findVideoRenderer(json.contents, found)
    return found.slice(0, Math.max(1, Math.min(Number(limit) || 10, 25))).map((v) => {
      const timeStr = v.lengthText?.simpleText || '0:00'
      return {
        id: v.videoId,
        url: `https://youtube.com/watch?v=${v.videoId}`,
        title: v.title?.runs?.[0]?.text || v.title?.simpleText || 'Unknown',
        duration: timeStr,
        seconds: innerTubeDurationToSeconds(timeStr),
        author: v.ownerText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || 'Unknown',
        ago: '',
        views: 0,
        thumbnail: v.thumbnail?.thumbnails?.slice(-1)[0]?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
      }
    })
  } catch {
    return []
  }
}

function mapYtSearchVideos(videos, limit) {
  if (!Array.isArray(videos)) return []
  return videos
    .filter((v) => v && v.videoId)
    .slice(0, limit)
    .map((v) => ({
      id: v.videoId,
      url: v.url || `https://youtube.com/watch?v=${v.videoId}`,
      title: v.title || 'Unknown',
      duration: v.timestamp || v.duration || '0:00',
      seconds: Number(v.seconds) || innerTubeDurationToSeconds(v.timestamp || v.duration),
      author: v.author?.name || v.author?.url || 'YouTube',
      ago: v.ago || '',
      views: Number(v.views) || 0,
      thumbnail:
        v.thumbnail || v.image || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
    }))
}

export async function searchYouTube(query, limit = 10) {
  const normalizedQuery = String(query || '').trim().slice(0, 200)
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 10, 25))
  if (!normalizedQuery) return []

  // Primary: yt-search module (scrapes YouTube, no API key required).
  try {
    const res = await yts(normalizedQuery)
    const list = mapYtSearchVideos(res?.videos, normalizedLimit)
    if (list.length) return list
  } catch {}

  // Fallback: Innertube search endpoint (also no API key).
  const fallback = await searchInnerTube(normalizedQuery, normalizedLimit)
  return fallback.slice(0, normalizedLimit)
}

// ============ DOWNLOAD ============

/**
 * Resolve a YouTube URL to a direct download URL plus metadata.
 * Uses the j2download engine — no API key required.
 * @returns {Promise<{id: string, url: string, title: string, rawTitle: string,
 *   author: string, duration: number, format: string, downloadUrl: string,
 *   thumb: string, ext: string, quality: string}>}
 */
export async function downloadYouTube(url, format = 'mp3') {
  const cleanFmt = String(format || 'mp3').toLowerCase()
  const targetFmt = cleanFmt === 'audio' ? 'mp3' : cleanFmt
  const info = await resolveDownload(url, targetFmt)
  const id = extractVideoId(url)
  return {
    id,
    url,
    title: info.title,
    rawTitle: info.rawTitle,
    author: info.author,
    duration: info.duration,
    format: targetFmt,
    downloadUrl: info.downloadUrl,
    thumb: (id && `https://i.ytimg.com/vi/${id}/hqdefault.jpg`) || info.thumb || '',
    ext: info.ext,
    quality: info.quality
  }
}

export async function getYouTubeBuffer(downloadUrl) {
  const parsed = new URL(downloadUrl)
  if (parsed.protocol !== 'https:') throw new Error('URL media YouTube harus memakai HTTPS')

  const res = await axios.get(parsed, {
    responseType: 'arraybuffer',
    timeout: 120_000,
    maxContentLength: MAX_DOWNLOAD_BYTES,
    maxBodyLength: MAX_DOWNLOAD_BYTES,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  })
  return Buffer.from(res.data)
}

export function isMp3Buffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return false
  if (buf.subarray(0, 3).toString('latin1') === 'ID3') return true
  return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0
}

/**
 * Normalize a downloaded buffer into something safe to send as an MP3 audio
 * message. Returns the original buffer with the right mimetype/extension when
 * it is already MP3; otherwise transcodes it (or degrades gracefully).
 * @returns {Promise<{buffer: Buffer, mimetype: string, ext: string}>}
 */
export async function ensureAudioFile(buffer) {
  if (isMp3Buffer(buffer)) return { buffer, mimetype: 'audio/mpeg', ext: 'mp3' }
  try {
    return { buffer: await toAudio(buffer), mimetype: 'audio/mpeg', ext: 'mp3' }
  } catch (error) {
    console.error('[YOUTUBE AUDIO CONVERT]', error?.message || error)
    return { buffer, mimetype: 'audio/mp4', ext: 'm4a' }
  }
}
