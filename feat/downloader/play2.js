import sharp from 'sharp'
import { spawn } from 'node:child_process'
import config from '../../config.js'
import { searchYouTube, downloadYouTube, getYouTubeBuffer, ensureAudioFile } from '../../lib/youtube.js'
import { toCompactAudio } from '../../lib/converter.js'
import { sendHtmlGame } from '../../lib/htmlGame.js'
import { toPTT } from '../../lib/converter.js'
import { assertPublicHttpUrl, fetchPublicBuffer } from '../../lib/urlSafety.js'





const PAYLOAD_BUDGET_BYTES = 1_000_000
const PAYLOAD_SAFETY_MARGIN = 40_000
const AUDIO_MIN_KBPS = 12
const AUDIO_MAX_KBPS = 96

const AUDIO_FORMAT = 'webm'
const AUDIO_MIME = 'audio/webm'
const AUDIO_SAFETY_RATIO = 0.92

const LRCLIB_API = 'https://lrclib.net/api'
const LRCLIB_USER_AGENT = 'Claide-Bot-by-Alfi/0.1 (play2)'
const MAX_AUDIO_SECONDS = 10 * 60
const MAX_QUERY_LENGTH = 250



function cleanTitleForLyrics(raw = '') {
  return String(raw || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^\)]*(?:official|video|audio|lyrics?|mv|visualizer|remaster|hd|4k)[^\)]*\)/gi, ' ')
    .replace(/\b(?:official\s*(?:video|audio|music\s*video)|lyrics?|mv|hd|4k|m\/v|visualizer)\b/gi, ' ')
    .replace(/['"‘’“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
function extractArtistAndTitle(rawTitle = '', author = '') {
  const cleaned = cleanTitleForLyrics(rawTitle)
  let artist = ''
  let title = cleaned
  if (cleaned.includes(' - ')) {
    const parts = cleaned.split(' - ')
    artist = parts[0].trim()
    title = parts.slice(1).join(' - ').replace(/\bfeat\..*$/i, '').trim()
  } else if (author && author !== 'YouTube' && !author.includes('and ') && !author.includes('more')) {
    artist = author.replace(/ - Topic$/i, '').trim()
  }
  return { artist, title, cleaned }
}
async function getLRCLyrics({ userQuery = '', rawTitle = '', author = '', duration = 0 }) {
  const { artist, title, cleaned } = extractArtistAndTitle(rawTitle, author)
  if (title && artist) {
    try {
      const p = new URLSearchParams({ track_name: title, artist_name: artist })
      if (duration && duration > 0) p.set('duration', String(Math.round(duration)))
      const res = await fetch(`${LRCLIB_API}/get?${p.toString()}`, {
        headers: { Accept: 'application/json', 'User-Agent': LRCLIB_USER_AGENT },
        signal: AbortSignal.timeout(4500)
      })
      if (res.ok) {
        const d = await res.json()
        if (d?.syncedLyrics || d?.plainLyrics) {
          return {
            trackName: d.trackName || title,
            artistName: d.artistName || artist,
            duration: Number(d.duration || duration || 0),
            plainLyrics: d.plainLyrics || '',
            syncedLyrics: d.syncedLyrics || ''
          }
        }
      }
    } catch {}
  }
  const queries = []
  if (userQuery) queries.push(userQuery.trim())
  if (title && artist && `${title} ${artist}` !== userQuery) queries.push(`${title} ${artist}`)
  if (userQuery && artist && !userQuery.toLowerCase().includes(artist.toLowerCase())) {
    queries.push(`${userQuery} ${artist}`)
  }
  if (cleaned && cleaned !== userQuery) queries.push(cleaned)
  for (const q of queries) {
    try {
      const res = await fetch(`${LRCLIB_API}/search?q=${encodeURIComponent(q)}`, {
        headers: { Accept: 'application/json', 'User-Agent': LRCLIB_USER_AGENT },
        signal: AbortSignal.timeout(4500)
      })
      if (res.ok) {
        const list = await res.json()
        if (Array.isArray(list) && list.length > 0) {
          let best = list.find((item) => item.syncedLyrics && Math.abs(Number(item.duration || 0) - duration) < 15)
          if (!best) best = list.find((item) => item.syncedLyrics)
          if (!best) best = list[0]
          return {
            trackName: best.trackName || title || q,
            artistName: best.artistName || artist || '',
            duration: Number(best.duration || duration || 0),
            plainLyrics: best.plainLyrics || '',
            syncedLyrics: best.syncedLyrics || ''
          }
        }
      }
    } catch {}
  }
  return null
}
function parseClock(value) {
  if (!value) return 0
  const parts = String(value).trim().replace(',', '.').split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return 0
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return parts[0] || 0
}
function decodeXml(value = '') {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
function readAttribute(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(attributes).match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, 'i'))
  return match?.[2] || ''
}
export function parseTTML(ttml = '') {
  if (!ttml) return []
  const lines = []
  const paragraph = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi
  const word = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi
  let paragraphMatch
  while ((paragraphMatch = paragraph.exec(ttml)) !== null) {
    const start = parseClock(readAttribute(paragraphMatch[1], 'begin'))
    const body = paragraphMatch[2]
    const words = []
    let wordMatch
    while ((wordMatch = word.exec(body)) !== null) {
      const wordStart = parseClock(readAttribute(wordMatch[1], 'begin'))
      const wordEnd = parseClock(readAttribute(wordMatch[1], 'end'))
      const text = decodeXml(wordMatch[2])
      if (text && wordEnd >= wordStart) words.push({ text, start: wordStart, end: wordEnd })
    }
    const text = words.length ? words.map((item) => item.text).join(' ') : decodeXml(body)
    if (text) {
      const entry = { time: start, text }
      if (words.length) entry.words = words
      lines.push(entry)
    }
  }
  return lines.sort((a, b) => a.time - b.time)
}
async function getBetterLyrics(title = '', artist = '', duration = 0) {
  if (!title) return null
  try {
    const p = new URLSearchParams({ s: title })
    if (artist) p.set('a', artist)
    if (duration > 0) p.set('d', String(Math.round(duration)))
    const res = await fetch(`https://lyrics-api.boidu.dev/getLyrics?${p.toString()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data?.ttml) {
      const parsed = parseTTML(data.ttml)
      if (parsed.length > 0) return parsed
    }
  } catch {}
  return null
}
async function getLyricsPlusLyrics(title = '', artist = '') {
  if (!title) return null
  const mirrors = ['https://lyricsplus.binimum.org', 'https://lyricsplus.prjktla.my.id']
  for (const base of mirrors) {
    try {
      const p = new URLSearchParams({ title })
      if (artist) p.set('artist', artist)
      const res = await fetch(`${base}/v1/lyrics/get?${p.toString()}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(6000)
      })
      if (!res.ok) continue
      const data = await res.json()
      if (data?.type === 'syllable' && Array.isArray(data.lyrics) && data.lyrics.length > 0) {
        const currentWords = []
        const lines = []
        for (const item of data.lyrics) {
          currentWords.push({
            text: item.text,
            start: (item.time || 0) / 1000,
            end: ((item.time || 0) + (item.duration || 0)) / 1000
          })
          if (item.isLineEnding === 1) {
            if (currentWords.length) {
              lines.push({
                time: currentWords[0].start,
                text: currentWords.map((w) => w.text).join('').trim(),
                words: currentWords.map((w) => ({ text: w.text.trim(), start: w.start, end: w.end })).filter((w) => w.text)
              })
            }
            currentWords.length = 0
          }
        }
        if (currentWords.length) {
          lines.push({
            time: currentWords[0].start,
            text: currentWords.map((w) => w.text).join('').trim(),
            words: currentWords.map((w) => ({ text: w.text.trim(), start: w.start, end: w.end })).filter((w) => w.text)
          })
        }
        if (lines.length) return lines
      } else if (data?.type === 'line' && Array.isArray(data.lyrics)) {
        const lines = data.lyrics.map((l) => ({
          time: (l.time || 0) / 1000,
          text: l.text?.trim() || ''
        })).filter((l) => l.text)
        if (lines.length) return lines
      }
    } catch {}
  }
  return null
}
async function getKuGouLyrics(query = '') {
  if (!query) return null
  try {
    const sUrl = `https://mobileservice.kugou.com/api/v3/search/song?version=9108&highlight=em&keyword=${encodeURIComponent(query)}&page=1&pagesize=3`
    const sRes = await fetch(sUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) })
    if (!sRes.ok) return null
    const sData = await sRes.json()
    const song = sData?.data?.info?.[0]
    if (!song?.hash) return null
    const lUrl = `https://lyrics.kugou.com/search?ver=1&man=yes&client=mobi&keyword=${encodeURIComponent(query)}&hash=${song.hash}`
    const lRes = await fetch(lUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) })
    if (!lRes.ok) return null
    const lData = await lRes.json()
    const cand = lData?.candidates?.[0]
    if (!cand?.id || !cand?.accesskey) return null
    const dUrl = `https://lyrics.kugou.com/download?ver=1&client=mobi&id=${cand.id}&accesskey=${cand.accesskey}&fmt=lrc&charset=utf8`
    const dRes = await fetch(dUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) })
    if (!dRes.ok) return null
    const dData = await dRes.json()
    if (!dData?.content) return null
    return Buffer.from(dData.content, 'base64').toString('utf8')
  } catch {
    return null
  }
}
function parseLrcTimestamp(match) {
  if (!match) return null
  const minutes = Number(match[1])
  const seconds = Number(match[2])
  const fractionText = match[3] || ''
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null
  let milliseconds = 0
  if (fractionText) {
    milliseconds = fractionText.length === 1
      ? Number(fractionText) * 100
      : fractionText.length === 2
      ? Number(fractionText) * 10
      : Number(fractionText.slice(0, 3))
  }
  return minutes * 60 + seconds + milliseconds / 1000
}
function parseSyncedLyrics(lrc = '') {
  if (!lrc) return []
  const result = []
  const lines = lrc.split(/\r?\n/)
  const timestampRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g
  let currentEntry = null
  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('<') && trimmed.endsWith('>') && trimmed.includes(':')) {
      if (currentEntry) {
        const inner = trimmed.slice(1, -1)
        const parts = inner.split('|')
        const words = []
        for (const part of parts) {
          const colonIdx1 = part.indexOf(':')
          const colonIdx2 = part.lastIndexOf(':')
          if (colonIdx1 !== -1 && colonIdx2 !== -1 && colonIdx1 !== colonIdx2) {
            const wordText = part.slice(0, colonIdx1)
            const start = Number(part.slice(colonIdx1 + 1, colonIdx2))
            const end = Number(part.slice(colonIdx2 + 1))
            if (Number.isFinite(start) && Number.isFinite(end)) {
              words.push({ text: wordText, start, end })
            }
          }
        }
        if (words.length) currentEntry.words = words
      }
      continue
    }
    const matches = [...trimmed.matchAll(timestampRegex)]
    if (!matches.length) continue
    const text = trimmed.replace(timestampRegex, '').trim()
    if (!text) continue
    for (const match of matches) {
      const time = parseLrcTimestamp(match)
      if (time !== null) {
        currentEntry = { time, text }
        result.push(currentEntry)
      }
    }
  }
  return result.sort((a, b) => a.time - b.time)
}
function plainLyricsToSynced(lyrics = '', duration = 0) {
  if (!lyrics) return []
  const lines = lyrics.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const totalDuration = Number(duration)
  const interval = totalDuration > 0 && lines.length > 1 ? Math.max(2, Math.min(8, totalDuration / lines.length)) : 5
  return lines.map((text, index) => ({ time: index * interval, text }))
}
function normalizeLyrics(lyrics = []) {
  if (!Array.isArray(lyrics)) return []
  return lyrics
    .filter((item) => Number.isFinite(Number(item.time)) && item.text)
    .map((item) => {
      const res = { time: Number(item.time), text: String(item.text).trim() }
      if (Array.isArray(item.words) && item.words.length > 0) {
        res.words = item.words
          .filter((w) => w && w.text && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end)))
          .map((w) => ({ text: String(w.text).trim(), start: Number(w.start), end: Number(w.end) }))
      }
      return res
    })
    .sort((a, b) => a.time - b.time)
}
function hasWordTiming(lines) {
  return Array.isArray(lines) && lines.some((line) => Array.isArray(line.words) && line.words.length > 0)
}
async function collectLyrics({ userQuery, rawTitle, rawArtist, durationSec }) {
  const extracted = extractArtistAndTitle(rawTitle, rawArtist)
  const title = extracted.title || extracted.cleaned || userQuery
  const artist = extracted.artist
  const duration = Number(durationSec) || 0
  const query = [title, artist].filter(Boolean).join(' ')
  const providers = [
    {
      name: 'BetterLyrics',
      run: async () => ({ lines: await getBetterLyrics(title, artist, duration) }),
    },
    {
      name: 'LyricsPlus',
      run: async () => ({ lines: await getLyricsPlusLyrics(title, artist) }),
    },
    {
      name: 'LRCLIB',
      run: async () => {
        const result = await getLRCLyrics({ userQuery, rawTitle, author: rawArtist, duration })
        if (!result) return null
        const lines = result.syncedLyrics
          ? parseSyncedLyrics(result.syncedLyrics)
          : plainLyricsToSynced(result.plainLyrics, result.duration || duration)
        return {
          lines,
          metadata: {
            title: result.trackName || rawTitle,
            artist: result.artistName || rawArtist,
          },
        }
      },
    },
    {
      name: 'KuGou',
      run: async () => {
        const lrc = await getKuGouLyrics(query || userQuery)
        return { lines: lrc ? parseSyncedLyrics(lrc) : null }
      },
    },
  ]
  const settled = await Promise.allSettled(providers.map((provider) => provider.run()))
    const successful = settled
      .map((result, index) => result.status === 'fulfilled' && result.value?.lines?.length
        ? { ...result.value, name: providers[index].name }
        : null)
      .filter(Boolean)
    const wordTimed = successful.find((result) => hasWordTiming(result.lines))
    const selected = wordTimed || successful[0]
    return {
      lines: normalizeLyrics(selected?.lines || []),
      provider: selected?.name || '',
      title: selected?.metadata?.title || rawTitle,
      artist: selected?.metadata?.artist || rawArtist,
    }
  }
function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
function escapeAttr(text = '') {
  return escapeHtml(text)
}
async function getThumb(url) {
  if (!url) return Buffer.alloc(0)
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const allowedHosts = new Set([
      'i.ytimg.com',
      'img.youtube.com',
      'yt3.ggpht.com',
      'lh3.googleusercontent.com',
    ])
    if (parsed.protocol !== 'https:' || !allowedHosts.has(host)) return Buffer.alloc(0)
    const safeUrl = await assertPublicHttpUrl(parsed)
    const result = await fetchPublicBuffer(safeUrl, {
      maxBytes: 2 * 1024 * 1024,
      timeoutMs: 10_000,
      headers: { Accept: 'image/*' },
    })
    if (!result.response.ok || !result.buffer.length) return Buffer.alloc(0)
    return await sharp(result.buffer)
      .rotate()
      .resize(208, 208, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 50 })
      .toBuffer()
  } catch {
    return Buffer.alloc(0)
  }
}



function probeDurationSec(buffer) {
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    let ff
    try {
      ff = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 'pipe:0'])
    } catch {
      return done(0)
    }
    const timer = setTimeout(() => {
      try { ff.kill('SIGKILL') } catch {}
      done(0)
    }, 15_000)
    ff.stdout.on('data', (chunk) => { out += chunk })
    ff.on('error', () => { clearTimeout(timer); done(0) })
    ff.on('close', () => {
      clearTimeout(timer)
      const value = Number.parseFloat(out.trim())
      done(Number.isFinite(value) && value > 0 ? value : 0)
    })
    ff.stdin.on('error', () => {})
    ff.stdin.end(buffer)
  })
}

async function encodeInlineAudio(rawBuffer, durationSec, budgetBytes) {
  if (!rawBuffer?.length) return { buffer: null, durationSec: Number(durationSec) || 0, reason: 'empty' }
  if (!(budgetBytes > 0)) return { buffer: null, durationSec: Number(durationSec) || 0, reason: 'no-budget' }
  const seconds = (await probeDurationSec(rawBuffer)) || (Number(durationSec) > 0 ? Number(durationSec) : 210)
  const audioByteBudget = Math.floor((budgetBytes * 3) / 4)
  const maxSeconds = Math.floor((audioByteBudget * 8) / AUDIO_MIN_KBPS / 1000)
  
  const fitKbps = Math.floor((audioByteBudget * 8 * AUDIO_SAFETY_RATIO) / seconds / 1000)
  if (fitKbps < AUDIO_MIN_KBPS) {
    return { buffer: null, durationSec: seconds, reason: 'too-long', maxSeconds }
  }
  const startKbps = Math.max(AUDIO_MIN_KBPS, Math.min(AUDIO_MAX_KBPS, fitKbps))
  const ladder = [...new Set([
    startKbps,
    Math.max(AUDIO_MIN_KBPS, Math.floor(startKbps * 0.7)),
    AUDIO_MIN_KBPS,
  ])].sort((a, b) => b - a)
  let lastEncoded = null
  for (const kbps of ladder) {
    const encoded = await toCompactAudio(rawBuffer, { bitrate: kbps, format: AUDIO_FORMAT })
    lastEncoded = encoded
    if (encoded.length <= audioByteBudget) {
      return { buffer: encoded, durationSec: seconds, bitrate: kbps }
    }
    if (kbps === AUDIO_MIN_KBPS) break
  }
  return {
    buffer: null,
    durationSec: seconds,
    reason: 'too-big',
    bytes: lastEncoded?.length ?? 0,
    budget: audioByteBudget,
  }
}

function compactLyrics(lines) {
  if (!Array.isArray(lines)) return []
  const round = (value) => Math.round(Number(value) * 100) / 100
  return lines.map((line) => {
    const out = { time: round(line.time) }
    if (Array.isArray(line.words) && line.words.length > 0) {
      out.words = line.words.map((word) => ({
        text: word.text,
        start: round(word.start),
        end: round(word.end),
      }))
    } else {
      out.text = String(line.text ?? '♪')
    }
    return out
  })
}


const LYRICS_MAX_CHARS = 80_000
function encodeLyricsPayload(lines) {
  const encode = (list) => Buffer.from(JSON.stringify(list), 'utf8').toString('base64')
  const compact = compactLyrics(Array.isArray(lines) ? lines : [])
  const full = encode(compact)
  if (full.length <= LYRICS_MAX_CHARS) return full
  return encode(
    compact.map((line) => ({
      time: line.time,
      text: line.text ?? (line.words || []).map((word) => word.text).join(' '),
    }))
  )
}
// Tema didefinisikan di modul level supaya bisa dipakai di balik layar bantuan DAN
// dipilih ulang tiap lagu. Putar tema membuat player terasa tidak statis;
// kunci tema lewat `theme <nama>` kalau mau stabil.
const PLAY2_THEMES = {
  aurora: {
    accent: '#ff5c8a', accent2: '#ff9ec4', chip: 'rgba(255,255,255,.1)',
    maxW: '266px', radius: '14px', bg: '#170b10', veil: 'linear-gradient(180deg, rgba(20,8,12,.62) 0%, rgba(20,8,12,.8) 45%, rgba(11,4,7,.96) 100%)',
    blur: '34px', poster: '112px', posterR: '10px', posterBg: 'rgba(255,255,255,.06)', playBg: '#fff', sheet: 'rgba(16,6,10,.98)', lyricH: '58px', eq: 'mini',
  },
  neon: {
    accent: '#22e0ff', accent2: '#ff3df0', chip: 'rgba(34,224,255,.14)',
    maxW: '300px', radius: '10px', bg: '#05060f', veil: 'linear-gradient(180deg, rgba(5,6,15,.55) 0%, rgba(5,6,15,.86) 50%, rgba(2,3,10,.98) 100%)',
    blur: '26px', poster: '132px', posterR: '10px', posterBg: 'rgba(34,224,255,.08)', playBg: 'var(--accent)', sheet: 'rgba(4,10,20,.99)', lyricH: '76px', eq: 'wide',
  },
  minimal: {
    accent: '#7c8794', accent2: '#c3ccd6', chip: 'rgba(0,0,0,.06)',
    maxW: '250px', radius: '6px', bg: '#f7f8fa', veil: 'none', inkLight: true,
    blur: '0px', poster: '104px', posterR: '6px', posterBg: 'rgba(0,0,0,.05)', playBg: '#15181c', sheet: '#ffffff', lyricH: '64px', eq: 'none',
  },
  sunset: {
    accent: '#ff8a3d', accent2: '#ffd166', chip: 'rgba(255,138,61,.16)',
    maxW: '290px', radius: '20px', bg: '#241208', veil: 'linear-gradient(200deg, rgba(255,138,61,.24) 0%, rgba(36,18,8,.9) 48%, rgba(15,8,4,.99) 100%)',
    blur: '40px', poster: '150px', posterR: '20px', posterBg: 'rgba(255,138,61,.12)', playBg: '#fff', sheet: 'rgba(32,16,8,.99)', lyricH: '70px', eq: 'wide',
  },
  midnight: {
    accent: '#7c5cff', accent2: '#3ddc97', chip: 'rgba(124,92,255,.18)',
    maxW: '280px', radius: '16px', bg: '#0b0a1a', veil: 'linear-gradient(165deg, rgba(124,92,255,.22) 0%, rgba(11,10,26,.9) 50%, rgba(5,4,14,.99) 100%)',
    blur: '38px', poster: '128px', posterR: '14px', posterBg: 'rgba(124,92,255,.12)', playBg: '#fff', sheet: 'rgba(10,9,24,.99)', lyricH: '66px', eq: 'wide',
  },
  forest: {
    accent: '#5fd68a', accent2: '#d9f99d', chip: 'rgba(95,214,138,.15)',
    maxW: '272px', radius: '18px', bg: '#0a1610', veil: 'linear-gradient(170deg, rgba(95,214,138,.18) 0%, rgba(10,22,16,.9) 55%, rgba(4,12,8,.99) 100%)',
    blur: '30px', poster: '120px', posterR: '16px', posterBg: 'rgba(95,214,138,.1)', playBg: '#fff', sheet: 'rgba(8,20,14,.99)', lyricH: '62px', eq: 'mini',
  },
  mono: {
    accent: '#f5f5f5', accent2: '#a3a3a3', chip: 'rgba(255,255,255,.09)',
    maxW: '244px', radius: '4px', bg: '#101010', veil: 'linear-gradient(180deg, rgba(16,16,16,.72) 0%, rgba(10,10,10,.92) 55%, rgba(0,0,0,.99) 100%)',
    blur: '18px', poster: '96px', posterR: '4px', posterBg: 'rgba(255,255,255,.05)', playBg: '#fff', sheet: 'rgba(14,14,14,.99)', lyricH: '56px', eq: 'none',
  },
  candy: {
    accent: '#ff77e1', accent2: '#7ad7ff', chip: 'rgba(255,119,225,.16)',
    maxW: '286px', radius: '22px', bg: '#1c0c1e', veil: 'linear-gradient(140deg, rgba(255,119,225,.26) 0%, rgba(122,215,255,.16) 45%, rgba(20,8,24,.96) 100%)',
    blur: '44px', poster: '136px', posterR: '22px', posterBg: 'rgba(255,119,225,.12)', playBg: '#fff', sheet: 'rgba(26,10,28,.99)', lyricH: '72px', eq: 'wide',
  },
  ember: {
    accent: '#ff4d4d', accent2: '#ffb703', chip: 'rgba(255,77,77,.15)',
    maxW: '274px', radius: '16px', bg: '#1a0a0a', veil: 'linear-gradient(190deg, rgba(255,77,77,.22) 0%, rgba(26,10,10,.92) 52%, rgba(12,4,4,.99) 100%)',
    blur: '32px', poster: '124px', posterR: '16px', posterBg: 'rgba(255,77,77,.1)', playBg: '#fff', sheet: 'rgba(22,8,8,.99)', lyricH: '64px', eq: 'mini',
  },
}
const THEME_NAMES = Object.keys(PLAY2_THEMES)

// Tema terakhir yang dipakai, disimpan di globalThis supaya hot-reload tidak
// mengulang tema yang sama terus-terusan. `randtheme` menimpanya dengan acak.
const THEME_STATE = globalThis.CLAIDE_PLAY2_THEME ??= { last: '' }

/** Tema berikutnya untuk rotasi (dengan avoid supaya tidak sama dua kali). */
function nextTheme(current) {
  const pinned = String(process.env.PLAY2_THEME || '').toLowerCase()
  if (pinned && PLAY2_THEMES[pinned]) return pinned
  const pool = THEME_NAMES.filter((name) => name !== current)
  return pool[Math.floor(Math.random() * pool.length)] || THEME_NAMES[0]
}

/** Tema benar-benar acak, termasuk mungkin sama dengan tema terakhir. */
function pickRandomTheme() {
  const pinned = String(process.env.PLAY2_THEME || '').toLowerCase()
  if (pinned && PLAY2_THEMES[pinned]) return pinned
  return THEME_NAMES[Math.floor(Math.random() * THEME_NAMES.length)] || 'aurora'
}

function createMusicPlayer({ title, artist, duration, imageSrc, lyrics, provider, audioDataUri = '', theme }) {
  const safeTitle = escapeHtml(title)
  const safeArtist = escapeHtml(artist)
  const safeDuration = escapeHtml(duration || '0:00')
  const safeProvider = escapeHtml(provider || '')
  const safeAudio = String(audioDataUri || '')
  const safeImage = imageSrc || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iNDAwIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgZmlsbD0iIzFhMGQxMiIvPjx0ZXh0IHg9IjIwMCIgeT0iMjEwIiBmb250LXNpemU9IjM0IiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZmlsbD0iI2ZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iNDAwIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgZmlsbD0iIzFhMGQxMiIvPjxjaXJjbGUgY3g9IjIwMCIgY3k9IjE1MCIgcj0iNjIiIGZpbGw9IiMyYTE1MjAiLz48Y2lyY2xlIGN4PSIyMDAiIGN5PSIxNTAiIHI9IjE2IiBmaWxsPSIjZmY1YzhhIi8+PHRleHQgeD0iMjAwIiB5PSIyNzIiIGZvbnQtc2l6ZT0iMjYiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmaWxsPSIjZjVlZWYxIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBsZXR0ZXItc3BhY2luZz0iNCI+Tk9XIFBMQVlJTkc8L3RleHQ+PC9zdmc+'
  const lyricsJson = encodeLyricsPayload(lyrics)
  const timeParts = safeDuration.split(':').map(Number)
  let fallbackSecs = 0
  if (timeParts.length === 2) fallbackSecs = timeParts[0] * 60 + timeParts[1]
  else if (timeParts.length === 3) fallbackSecs = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2]
  if (!fallbackSecs) fallbackSecs = 200
  
  
  
  
  
  
  
  const themeName = String(theme || process.env.PLAY2_THEME || 'aurora').toLowerCase()
  const T = PLAY2_THEMES[themeName] || PLAY2_THEMES.aurora
  const light = Boolean(T.inkLight)
  const ink = light ? '#15181c' : '#ffffff'
  const muted = light ? '#5c646e' : '#b9b1b6'
  const eqBlock = T.eq === 'wide' ? `
  .eqrow { display:flex; align-items:flex-end; justify-content:center; gap:2px; height:30px; margin:0 0 7px; padding:0 4px; opacity:.9; }
  .eqrow i { flex:1; max-width:4px; min-width:2px; height:30%; border-radius:3px; background:linear-gradient(180deg, var(--accent), var(--accent2)); transform-origin:bottom; }
  .eqrow.is-on i { animation: eqgrow .82s ease-in-out infinite alternate; }
  .eqrow.is-on i:nth-child(2) { animation-delay:.1s; } .eqrow.is-on i:nth-child(3) { animation-delay:.2s; }
  .eqrow.is-on i:nth-child(4) { animation-delay:.3s; } .eqrow.is-on i:nth-child(5) { animation-delay:.4s; }
  .eqrow.is-on i:nth-child(6) { animation-delay:.5s; } .eqrow.is-on i:nth-child(7) { animation-delay:.6s; }
  @keyframes eqgrow { from { height:16%; } to { height:100%; } }` : ''
  return `
<style>
  :root {
    --ink: ${ink};
    --muted: ${muted};
    --sys: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    --pink: ${T.accent};
    --accent: ${T.accent};
    --accent2: ${T.accent2};
    --chip: ${T.chip};
    --radius: ${T.radius};
  }
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { background: transparent; color: var(--ink); font-family: var(--sys); -webkit-font-smoothing: antialiased; }
  .wrap { display: flex; align-items: center; justify-content: center; padding: 6px; width: 100%; }
  .player { position: relative; width: 100%; max-width: ${T.maxW}; border-radius: var(--radius); overflow: hidden; background: ${T.bg}; box-shadow: 0 14px 30px rgba(0,0,0,${light ? '.18' : '.48'}); }
  .bg { position: absolute; inset: -30%; width: 160%; height: 160%; object-fit: cover; filter: blur(${T.blur}) saturate(1.5); opacity: ${light ? '.28' : '.85'}; z-index: 0; }
  .veil { position: absolute; inset: 0; z-index: 1; background: ${T.veil}; }
  .content { position: relative; z-index: 2; padding: 9px 11px 11px; }
${eqBlock}
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .head__icon { width: 14px; height: 14px; color: var(--ink); opacity: .8; flex: none; }
  .head__mid { text-align: center; flex: 1; min-width: 0; }
  .head__from { font-size: 7.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
  .head__album { font-size: 10px; font-weight: 600; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .poster { width: ${T.poster}; max-width: 44%; aspect-ratio: 1; margin: 0 auto 8px; border-radius: ${T.posterR}; overflow: hidden; background: ${T.posterBg}; box-shadow: 0 10px 22px rgba(0,0,0,${light ? '.14' : '.45'}); }
  .poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .info { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .info__names { min-width: 0; }
  .info__title { font-size: 13px; font-weight: 600; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .info__artist { font-size: 10px; color: var(--muted); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mini-lyrics { position: relative; height: ${T.lyricH}; overflow-x: hidden; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; margin-bottom: 6px; overscroll-behavior: contain; mask-image: linear-gradient(180deg, transparent 0%, rgba(0,0,0,1) 18%, rgba(0,0,0,1) 78%, transparent 100%); -webkit-mask-image: linear-gradient(180deg, transparent 0%, rgba(0,0,0,1) 18%, rgba(0,0,0,1) 78%, transparent 100%); }
  .mini-lyrics::-webkit-scrollbar { display: none; }
  .lyrics-text { width: 100%; padding: 21px 0; display: flex; flex-direction: column; gap: 5px; }
  .lyric-line { font-size: 11.5px; color: rgba(255,255,255,.26); line-height: 1.42; opacity: .3; transform-origin: left center; transition: opacity .35s ease, color .35s ease, transform .4s cubic-bezier(0.2, 0.8, 0.2, 1); text-align: left; white-space: normal; word-wrap: break-word; overflow-wrap: anywhere; font-weight: 600; padding: 1px 0; }
  .lyric-line.is-near { opacity: .55; color: rgba(255,255,255,.6); }
  .lyric-line.is-active { color: #fff; opacity: 1; transform: translateX(3px); text-shadow: 0 0 12px rgba(255,255,255,.35); }
  .lyric-line.has-words.is-active { text-shadow: none; }
  .word-span { display: inline-block; margin-right: 3px; transition: color .18s ease, opacity .18s ease; }
  .word-span.is-pending { color: rgba(255,255,255,.42); opacity: .72; }
  .word-span.is-singing { opacity: 1; font-weight: 800; -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .word-span.is-passed { color: #ffffff; opacity: .96; font-weight: 700; }
  .lyrics-none { display: none; align-items: center; justify-content: center; gap: 6px; font-size: 10.5px; font-weight: 600; color: var(--muted); padding: 3px 0 8px; letter-spacing: .02em; }
  /* Intro loading: gelombang kanvas ½ lebar kotak lirik, gaya senada lirik (adaptasi loading_metter_ref.html) */
  .lyric-intro { display: flex; align-items: center; padding: 2px 0; height: 20px; opacity: 1; transform: scaleY(1); transform-origin: top; transition: height .35s cubic-bezier(0.2, 0.8, 0.2, 1), opacity .28s ease, padding .3s ease, transform .3s ease; overflow: hidden; margin-bottom: 3px; }
  .lyric-intro.is-collapsed { height: 0 !important; opacity: 0 !important; margin: 0 !important; padding: 0 !important; transform: scaleY(0) !important; pointer-events: none; }
  .intro-canvas { display: block; width: 50%; height: 16px; }
  .bar { position: relative; height: 3.5px; border-radius: 4px; background: rgba(255,255,255,.22); cursor: pointer; margin-bottom: 4px; touch-action: none; }
  .bar__fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; border-radius: 4px; background: #fff; pointer-events: none; }
  .bar__dot { position: absolute; top: 50%; left: 0; width: 8px; height: 8px; border-radius: 50%; background: #fff; transform: translate(-50%,-50%); pointer-events: none; }
  .time { display: flex; align-items: center; justify-content: space-between; font-size: 9.5px; color: var(--muted); margin-bottom: 6px; font-variant-numeric: tabular-nums; }
  .info__menu { width: 26px; height: 26px; flex: none; display: flex; align-items: center; justify-content: center; background: none; border: none; color: var(--muted); cursor: pointer; padding: 0; border-radius: 8px; transition: background .2s ease, color .2s ease; }
  .info__menu.is-on { color: #fff; background: rgba(255,255,255,.1); }
  .scrim { position: absolute; inset: 0; z-index: 6; background: rgba(6,2,4,.58); opacity: 0; pointer-events: none; transition: opacity .26s ease; }
  .scrim.is-open { opacity: 1; pointer-events: auto; }
  .sheet { position: absolute; left: 0; right: 0; bottom: 0; z-index: 7; padding: 11px 13px 13px; border-radius: var(--radius) var(--radius) 0 0; background: ${T.sheet}; border-top: 1px solid rgba(255,255,255,${light ? '.5' : '.08'}); box-shadow: 0 -12px 28px rgba(0,0,0,.5); transform: translateY(104%); opacity: 0; pointer-events: none; transition: transform .3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity .24s ease; }
  .sheet.is-open { transform: translateY(0); opacity: 1; pointer-events: auto; }
  .sheet__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .sheet__title { font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
  .sheet__reset { border: 0; background: none; color: var(--muted); font-size: 10.5px; font-weight: 700; cursor: pointer; padding: 3px 7px; border-radius: 7px; transition: background .2s ease, color .2s ease; }
  .sheet__reset:active { background: rgba(255,255,255,.12); color: #fff; }
  .tune { display: flex; align-items: center; gap: 9px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.07); border-radius: 11px; padding: 6px; }
  .tune__btn { min-width: 30px; height: 30px; flex: none; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 9px; background: rgba(255,255,255,.1); color: #fff; font-size: 11px; font-weight: 700; line-height: 1; cursor: pointer; padding: 0 6px; transition: background .18s ease, transform .12s ease; }
  .tune__btn:active { background: rgba(255,255,255,.24); transform: scale(.94); }
  .tune__mid { flex: 1; min-width: 0; text-align: center; }
  .tune__val { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .tune__val.is-set { color: var(--pink); }
  .tune__hint { font-size: 9.5px; color: var(--muted); margin-top: 1px; }
  .sheet__note { margin-top: 8px; font-size: 9.5px; color: var(--muted); text-align: center; line-height: 1.5; }
  .controls { display: flex; align-items: center; justify-content: space-between; }
  .ctrl { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; color: var(--ink); background: none; border: none; cursor: pointer; padding: 0; transition: opacity .2s ease, transform .15s ease; }
  .ctrl svg { width: 16px; height: 16px; }
  .ctrl:active { opacity: .6; transform: scale(.92); }
  .ctrl { position: relative; }
  .head__icon--btn { background: none; border: none; padding: 0; cursor: pointer; color: var(--ink); }
  .head__icon--btn:active { transform: scale(.88); }
  #btn-loop.is-on::after { content: '1'; position: absolute; right: -3px; bottom: -5px; font-size: 8px; font-weight: 800; line-height: 1; color: var(--pink); background: #12070b; border: 1px solid rgba(255,92,138,.55); border-radius: 4px; padding: 1px 2px; }
  .play { width: 40px; height: 40px; border-radius: 50%; background: ${T.playBg}; color: ${light ? '#ffffff' : '#12070b'}; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex: none; padding: 0; box-shadow: 0 5px 14px rgba(0,0,0,.42); transition: transform .15s ease; }
  .play svg { width: 19px; height: 19px; }
  .play:active { transform: scale(.93); }
  .note { margin-top: 6px; text-align: center; font-size: 9px; color: var(--muted); line-height: 1.5; }
  /* — Pro polish — */
  .poster { position: relative; }
  .poster__eq { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: flex-end; justify-content: center; gap: 3px; height: 30px; padding-bottom: 8px; background: linear-gradient(180deg, rgba(6,2,4,0) 0%, rgba(6,2,4,.78) 100%); opacity: 0; transition: opacity .3s ease; pointer-events: none; }
  .poster__eq.is-on { opacity: 1; }
  .poster__eq i { display: block; width: 3px; height: 5px; border-radius: 3px; background: linear-gradient(180deg, #fff, var(--pink)); box-shadow: 0 0 6px rgba(255,92,138,.55); animation: eqbounce .95s ease-in-out infinite; }
  .poster__eq i:nth-child(2) { animation-delay: .16s; }
  .poster__eq i:nth-child(3) { animation-delay: .32s; }
  .poster__eq i:nth-child(4) { animation-delay: .48s; }
  @keyframes eqbounce { 0%, 100% { height: 5px; } 50% { height: 19px; } }
  @media (prefers-reduced-motion: reduce) { .poster__eq i { animation: none; height: 12px; } }
  .head__from { display: flex; align-items: center; justify-content: center; gap: 5px; }
  .head__from::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: #5ee08a; opacity: 0; transform: scale(.6); transition: opacity .25s ease, transform .25s ease; }
  .head__from.is-live::before { opacity: 1; transform: scale(1); animation: livedot 1.5s ease-in-out infinite; }
  @keyframes livedot { 0%, 100% { box-shadow: 0 0 0 0 rgba(94,224,138,.55); } 50% { box-shadow: 0 0 0 4px rgba(94,224,138,0); } }
  .bar { touch-action: none; }
  .bar__fill { background: linear-gradient(90deg, var(--pink) 0%, #ff9db8 100%); box-shadow: 0 0 7px rgba(255,92,138,.45); }
  .bar__dot { background: #fff; box-shadow: 0 0 0 3px rgba(255,92,138,.22), 0 2px 6px rgba(0,0,0,.5); transition: transform .12s ease; }
  .bar.is-scrubbing .bar__dot { transform: translate(-50%,-50%) scale(1.35); }
  .bar.is-scrubbing .bar__fill { background: linear-gradient(90deg, #fff 0%, var(--pink) 100%); }
  .ctrl.is-on { color: var(--pink); opacity: 1; }
  .ctrl.is-on svg { filter: drop-shadow(0 0 6px rgba(255,92,138,.55)); }
  .ctrl.is-on:active { transform: scale(.88); }
</style>
<div class="wrap">
  <div class="player">
    <img class="bg" src="${escapeAttr(safeImage)}" alt="">
    <div class="veil"></div>
    <div class="content">
      ${eqBlock ? '<div class="eqrow" id="eq-row" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>' : ''}
      <div class="head">
        <svg class="head__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        <div class="head__mid">
          <div class="head__from" id="stream-status">Siap Diputar</div>
          <div class="head__album">${safeArtist}</div>
        </div>
        <button class="head__icon head__icon--btn" id="menu-btn-top" aria-label="Pengaturan lirik">
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
        </button>
      </div>
      <div class="poster">
        <img src="${escapeAttr(safeImage)}" alt="${escapeAttr(safeTitle)}">
        <div class="poster__eq" id="poster-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      </div>
      <div class="info">
        <div class="info__names">
          <div class="info__title">${safeTitle}</div>
          <div class="info__artist">${safeArtist}</div>
        </div>
        <button class="info__menu" id="menu-btn" aria-label="Pengaturan">
          <svg viewBox="0 0 24 24" fill="currentColor" width="17" height="17"><circle cx="12" cy="5.2" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="18.8" r="1.7"/></svg>
        </button>
      </div>
      <div class="mini-lyrics" id="mini-lyrics">
        <div class="lyrics-text" id="lyrics-text"></div>
      </div>
      <div class="lyrics-none" id="lyrics-none">
        <span style="color:var(--pink); font-size:12px;">♪</span> Lirik tidak tersedia
      </div>
      <div class="bar" id="bar">
        <div class="bar__fill" id="fill"></div>
        <div class="bar__dot" id="dot"></div>
      </div>
      <div class="time">
        <span id="cur">0:00</span>
        <span id="dur">${safeDuration}</span>
      </div>
      <div class="controls">
        <button class="ctrl" id="btn-restart" aria-label="Ulang dari awal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M5 5v14"/><path d="M19 5 9 12l10 7z"/></svg>
        </button>
        <button class="ctrl" id="btn-rw" aria-label="Mundur 10 detik">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><text x="12" y="16.5" font-size="7.5" font-family="sans-serif" font-weight="bold" stroke="none" fill="currentColor" text-anchor="middle">10</text></svg>
        </button>
        <button class="play" id="play" aria-label="Play">
          <svg id="icon-play" viewBox="0 0 24 24" fill="currentColor" width="26" height="26"><path d="M8 5.6 v12.8 a.6.6 0 0 0 .92.5 l10-6.4 a.6.6 0 0 0 0-1 l-10-6.4 a.6.6 0 0 0-.92.5z"/></svg>
          <svg id="icon-pause" viewBox="0 0 24 24" fill="currentColor" width="26" height="26" style="display:none"><rect x="6.5" y="5" width="3.8" height="14" rx="1"/><rect x="13.7" y="5" width="3.8" height="14" rx="1"/></svg>
        </button>
        <button class="ctrl" id="btn-fw" aria-label="Maju 10 detik">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><text x="12" y="16.5" font-size="7.5" font-family="sans-serif" font-weight="bold" stroke="none" fill="currentColor" text-anchor="middle">10</text></svg>
        </button>
        <button class="ctrl" id="btn-loop" aria-label="Ulang lagu" aria-pressed="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1 a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1 a4 4 0 0 1-4 4H3"/></svg>
        </button>
      </div>
      <div class="note">${safeProvider ? `${safeProvider} • ` : ''}${escapeHtml(config.botName)} • Music Player</div>
    </div>
    <div class="scrim" id="scrim"></div>
    <div class="sheet" id="tune-sheet">
      <div class="sheet__head">
        <span class="sheet__title">Sinkron Lirik</span>
        <button class="sheet__reset" id="tune-reset">Reset</button>
      </div>
      <div class="tune">
        <button class="tune__btn" data-step="-30" aria-label="Mundur 30ms">−30</button>
        <button class="tune__btn" data-step="-5" aria-label="Mundur 5ms">−5</button>
        <div class="tune__mid">
          <div class="tune__val" id="tune-val">0.00s</div>
          <div class="tune__hint">ms tiap tekan</div>
        </div>
        <button class="tune__btn" data-step="5" aria-label="Maju 5ms">+5</button>
        <button class="tune__btn" data-step="30" aria-label="Maju 30ms">+30</button>
      </div>
      <div class="sheet__note">Lirik telat? tekan <b>+</b>. Lirik keduluan? tekan <b>−</b>.</div>
    </div>
  </div>
</div>
<script>
(function() {
  'use strict';
  let TOTAL_SECONDS = ${fallbackSecs};
  const play = document.getElementById('play');
  const bar = document.getElementById('bar');
  const fill = document.getElementById('fill');
  const dot = document.getElementById('dot');
  const cur = document.getElementById('cur');
  const dur = document.getElementById('dur');
  const menuBtn = document.getElementById('menu-btn');
  const scrim = document.getElementById('scrim');
  const sheet = document.getElementById('tune-sheet');
  const tuneVal = document.getElementById('tune-val');
  const tuneReset = document.getElementById('tune-reset');
  const iconPlay = document.getElementById('icon-play');
  const iconPause = document.getElementById('icon-pause');
  const lyricsContainer = document.getElementById('mini-lyrics');
  const lyricsText = document.getElementById('lyrics-text');
  const btnRw = document.getElementById('btn-rw');
  const btnFw = document.getElementById('btn-fw');
  const statusFrom = document.getElementById('stream-status');
  const btnRestart = document.getElementById('btn-restart');
  const btnLoop = document.getElementById('btn-loop');
  const menuBtnTop = document.getElementById('menu-btn-top');
  const posterEq = document.getElementById('poster-eq');
  const eqRow = document.getElementById('eq-row');
  // Web Audio API Engine (Bit-Perfect Studio Quality — 44.1kHz Stereo)
  let audioCtx = null;
  let audioBuffer = null;
  let sourceNode = null;
  let startedAt = 0;
  let pausedAt = 0;
  let isPlaying = false;
  let isReady = false;
  let userWantsPlay = false;
  function getAudioContext() {
    if (!audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtx();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }
  function decodeAudioDataSafe(ctx, arrayBuffer) {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const res = ctx.decodeAudioData(
        arrayBuffer,
        (buf) => { if (!resolved) { resolved = true; resolve(buf); } },
        (err) => { if (!resolved) { resolved = true; reject(err); } }
      );
      if (res && typeof res.then === 'function') {
        res.then(
          (buf) => { if (!resolved) { resolved = true; resolve(buf); } },
          (err) => { if (!resolved) { resolved = true; reject(err); } }
        );
      }
    });
  }
  function getCurrentTime() {
    if (!isPlaying) return pausedAt;
    const ctx = getAudioContext();
    return Math.max(0, pausedAt + (ctx.currentTime - startedAt));
  }
  function getDuration() {
    if (audioBuffer && audioBuffer.duration > 0) return audioBuffer.duration;
    return TOTAL_SECONDS;
  }
  // — State pemutar —
  // baseStatus selalu menyimpan state asli (Siap/Memutar/Dijeda/Selesai);
  // flashStatus cuma numpang lewat biar pesan sementara nggak nempel selamanya.
  let baseStatus = 'Siap Diputar';
  let loopMode = false;
  let scrubTime = null; // posisi saat menyeret bar, null = nggak sedang menyeret
  function setStatus(text) {
    baseStatus = text;
    statusFrom.innerText = text;
  }
  function setPlayingUi(on) {
    iconPlay.style.display = on ? 'none' : 'block';
    iconPause.style.display = on ? 'block' : 'none';
    statusFrom.classList.toggle('is-live', on);
    if (posterEq) posterEq.classList.toggle('is-on', on);
    if (eqRow) eqRow.classList.toggle('is-on', on);
  }
  async function playAudio() {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (e) {}
    }
    if (!isReady || !audioBuffer) {
      userWantsPlay = true;
      setStatus("Mengunduh HD...");
      return;
    }
    if (isPlaying) return;
    const trackDur = getDuration();
    // Duduk terlalu dekat ujung (<0,8 detik sisa) → putar ulang dari awal. Kalau tetap
    // di-offset itu, buffer source langsung ended dan status nyangkut "Selesai"
    // padahal tombol play barusan ditekan.
    if (pausedAt >= trackDur - 0.8) pausedAt = 0;
    sourceNode = ctx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(ctx.destination);
    sourceNode.onended = function() {
      if (!isPlaying) return;
      if (getCurrentTime() >= (trackDur - 0.6)) finishTrack(loopMode);
    };
    sourceNode.start(0, pausedAt);
    startedAt = ctx.currentTime;
    isPlaying = true;
    userWantsPlay = false;
    setPlayingUi(true);
    setStatus("Memutar");
  }
  function stopSource() {
    if (!sourceNode) return;
    try {
      sourceNode.onended = null;
      sourceNode.stop(0);
      sourceNode.disconnect();
    } catch (e) {}
    sourceNode = null;
  }
  // Lagu berakhir. restart=true (mode ulang aktif) → langsung putar lagi dari 0.
  let lastLoopAt = 0;
  function finishTrack(restart) {
    stopSource();
    isPlaying = false;
    pausedAt = 0;
    updateProgressUI(0);
    updateLyrics(0);
    if (restart) {
      const now = Date.now();
      // jaring pengaman: kalau langsung ended lagi (<800ms) berarti buffer bermasalah,
      // jangan diulang terus-menerus sampai browser nggak responsif
      if (now - lastLoopAt >= 800) {
        lastLoopAt = now;
        playAudio();
        return;
      }
    }
    setPlayingUi(false);
    setStatus("Selesai");
  }
  function pausePlayback() {
    if (!isPlaying) return;
    const ctx = getAudioContext();
    pausedAt = Math.max(0, pausedAt + (ctx.currentTime - startedAt));
    stopSource();
    isPlaying = false;
    userWantsPlay = false;
    setPlayingUi(false);
    setStatus("Dijeda");
  }
  function seekPlayback(targetSecs) {
    const trackDur = getDuration();
    const clamped = Math.max(0, Math.min(trackDur, targetSecs));
    // Ke ujung = berhenti rapi di detik terakhir, bukan start lalu langsung ended
    // yang bikin status kedip "Selesai" padahal lagu belum sempat diputar.
    const atEnd = clamped >= trackDur - 0.05;
    const wasPlaying = isPlaying;
    if (isPlaying) pausePlayback();
    pausedAt = atEnd ? trackDur : clamped;
    updateProgressUI(pausedAt);
    updateLyrics(pausedAt);
    if (atEnd) {
      setPlayingUi(false);
      setStatus("Selesai");
      return;
    }
    if (wasPlaying) playAudio();
  }
  function unlockCtx() {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }
  document.addEventListener('touchstart', unlockCtx, { passive: true });
  document.addEventListener('click', unlockCtx, { passive: true });
  const AUDIO_DATA_URI = '${safeAudio}';
  function base64ToArrayBuffer(dataUri) {
    const comma = dataUri.indexOf(',');
    const binary = atob(comma === -1 ? dataUri : dataUri.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  function initInlineAudio() {
    if (!AUDIO_DATA_URI) {
      setStatus("Audio tidak tersedia");
      return;
    }
    setStatus("Menyiapkan audio...");
    try {
      const ctx = getAudioContext();
      const raw = base64ToArrayBuffer(AUDIO_DATA_URI);
      decodeAudioDataSafe(ctx, raw).then(function (decoded) {
        audioBuffer = decoded;
        isReady = true;
        if (audioBuffer && audioBuffer.duration > 0) {
          TOTAL_SECONDS = audioBuffer.duration;
          dur.textContent = formatTime(TOTAL_SECONDS);
          updateProgressUI(pausedAt);
          updateLyrics(pausedAt);
        }
        setStatus("Siap Diputar");
        if (userWantsPlay) {
          playAudio();
        }
      }).catch(function () {
        userWantsPlay = false;
        setStatus("Gagal memproses");
      });
    } catch (e) {
      setStatus("Gagal memproses");
    }
  }
  // Parse lyrics
  let lyrics = [];
  try {
    const encoded = '${lyricsJson}';
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder('utf-8').decode(bytes);
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      lyrics = parsed.filter(item => item && Number.isFinite(Number(item.time)))
                     .map(item => {
                       // teks baris bisa saja tidak ikut terkirim saat payload dikompak
                       // (cuma ada word-timing) → susun ulang dari kata-katanya
                       const fromWords = Array.isArray(item.words)
                         ? item.words.map(w => (w && w.text) || '').filter(Boolean).join(' ')
                         : '';
                       const obj = { time: Number(item.time), text: String(item.text || fromWords || '♪') };
                       if (Array.isArray(item.words) && item.words.length > 0) {
                         obj.words = item.words
                           .filter(w => w && w.text && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end)))
                           .map(w => {
                             const start = Number(w.start);
                             const end = Number(w.end);
                             // durasi minimum biar transisi tiap kata nggak "kedip"
                             return { text: String(w.text), start, end: end > start + 0.08 ? end : start + 0.15 };
                           });
                       }
                       return obj;
                     })
                     .sort((a, b) => a.time - b.time);
    }
  } catch { lyrics = []; }
  function escapeWordText(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function formatTime(sec) {
    sec = Number(sec);
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }
  const firstLyricTime = (lyrics.length && lyrics[0].time > 1.2) ? lyrics[0].time : 0;
  const LYRIC_OFFSET_LIMIT_MS = 6000;
  // Gelombang loading — adaptasi loading_metter_ref.html (½ lebar kotak lirik, gaya senada lirik)
  const WAVE_CFG = { amp: 4.5, freq: 0.09, speed: 0.07, damping: 16 };
  const GAP_WAVE_LEAD = 4.5;
  // titik waktu baris yang jeda dari baris sebelumnya > 5 detik
  const gapLineTimes = [];
  for (let i = 1; i < lyrics.length; i++) {
    if (lyrics[i].time - lyrics[i - 1].time > 5) gapLineTimes.push(lyrics[i].time);
  }
  let lyricOffsetMs = 0;
  let introEl = null;
  let introCanvas = null;
  let introCtx = null;
  let wavePhase = 0;
  let waveProgress = 0;
  let waveTarget = 0;
  let waveW = 140;
  let waveH = 16;
  let introTimer = null;
  let didCenterFirst = false;
  const lyricElements = [];
  function renderLyrics() {
    lyricsText.innerHTML = '';
    lyricElements.length = 0;
    const noneEl = document.getElementById('lyrics-none');
    if (!lyrics.length) {
      if (lyricsContainer) lyricsContainer.style.display = 'none';
      if (noneEl) noneEl.style.display = 'flex';
      return;
    }
    if (lyricsContainer) lyricsContainer.style.display = 'block';
    if (noneEl) noneEl.style.display = 'none';
    const fragment = document.createDocumentFragment();
    if (firstLyricTime > 0) {
      introEl = document.createElement('div');
      introEl.className = 'lyric-line lyric-intro';
      introEl.innerHTML = '<canvas class="intro-canvas" id="intro-canvas"></canvas>';
      fragment.appendChild(introEl);
      introCanvas = introEl.querySelector('#intro-canvas');
      introCtx = introCanvas ? introCanvas.getContext('2d') : null;
      wavePhase = 0;
      waveProgress = 0;
    }
    lyrics.forEach((line) => {
      const el = document.createElement('div');
      el.className = 'lyric-line';
      if (Array.isArray(line.words) && line.words.length > 0) {
        el.className = 'lyric-line has-words';
        el.dataset.hasWords = 'true';
        let html = '';
        line.words.forEach((w, wi) => {
          html += '<span class="word-span is-pending" data-start="' + w.start + '" data-end="' + w.end + '">' + escapeWordText(w.text) + '</span>';
          if (wi < line.words.length - 1) html += ' ';
        });
        el.innerHTML = html;
      } else {
        el.textContent = line.text;
      }
      fragment.appendChild(el);
      lyricElements.push(el);
    });
    lyricsText.appendChild(fragment);
    // Canvas wave diukur setelah masuk DOM (½ lebar kotak lirik); resolusi pakai DPR biar tajam
    if (introCanvas && introCtx) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssW = Math.max(60, Math.round(introCanvas.clientWidth || 140));
      introCanvas.width = Math.round(cssW * dpr);
      introCanvas.height = Math.round(16 * dpr);
      introCtx.scale(dpr, dpr);
      waveW = cssW;
      waveH = 16;
      drawIntroWave();
    }
  }
  renderLyrics();
  let activeLyricIndex = -99;
  // Adaptasi loading_metter_ref.html: gelombang sinus mengisi dari kiri dengan redaman
  // di ujung progress; warna & ketebalan senada dengan teks lirik, tanpa titik di ujung.
  function drawIntroWave() {
    if (!introCtx) return;
    const w = waveW;
    const h = waveH;
    const cy = h / 2;
    const progressX = w * waveProgress;
    const g = introCtx;
    g.clearRect(0, 0, w, h);
    if (progressX < w) {
      g.beginPath();
      g.moveTo(progressX, cy);
      g.lineTo(w, cy);
      g.strokeStyle = 'rgba(255,255,255,.22)';
      g.lineWidth = 2;
      g.lineCap = 'round';
      g.stroke();
    }
    if (progressX > 0.5) {
      g.beginPath();
      for (let x = 0; x <= progressX; x++) {
        const distToEnd = progressX - x;
        let amp = WAVE_CFG.amp;
        if (distToEnd < WAVE_CFG.damping) amp *= distToEnd / WAVE_CFG.damping;
        const y = cy + Math.sin(x * WAVE_CFG.freq - wavePhase) * amp;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokeStyle = 'rgba(255,255,255,.92)';
      g.lineWidth = 2;
      g.lineCap = 'round';
      g.stroke();
    }
  }
  function updateLyrics(rawTime) {
    if (!lyrics.length) return;
    // offset manual dari panel "⋮" (lirik bisa dimajukan / dimundurkan)
    const currentTime = Math.max(0, rawTime + lyricOffsetMs / 1000);
    // Gelombang loading: intro pembuka + muncul lagi saat jeda antar baris > 5 detik
    if (introEl && introCtx) {
      let winStart = 0;
      let winEnd = -1;
      if (currentTime < firstLyricTime) {
        winEnd = firstLyricTime;
      } else {
        for (let gi = 0; gi < gapLineTimes.length; gi++) {
          const t = gapLineTimes[gi];
          if (t <= currentTime + 0.12) continue;
          if (t - currentTime <= GAP_WAVE_LEAD) { winStart = t - GAP_WAVE_LEAD; winEnd = t; }
          break;
        }
      }
      if (winEnd > 0) {
        introEl.classList.remove('is-collapsed');
        if (introTimer) { clearTimeout(introTimer); introTimer = null; }
        if (winEnd !== waveTarget) {
          waveTarget = winEnd;
          waveProgress = 0;
        }
        // gelombang mengejar progress (lerp biar halus)
        const target = Math.min(1, Math.max(0, (currentTime - winStart) / (winEnd - winStart)));
        waveProgress += (target - waveProgress) * 0.14;
        if (Math.abs(target - waveProgress) < 0.0012) waveProgress = target;
      } else if (!introEl.classList.contains('is-collapsed')) {
        // selesai: gelombang penuh mengalir sebentar, lalu hilang + lirik pertama ke tengah
        waveProgress += (1 - waveProgress) * 0.18;
        if (!introTimer) {
          introTimer = setTimeout(function () {
            introTimer = null;
            introEl.classList.add('is-collapsed');
            waveProgress = 0;
            waveTarget = 0;
            if (!didCenterFirst && lyricElements.length && lyricsContainer) {
              didCenterFirst = true;
              const first = lyricElements[0];
              lyricsContainer.scrollTo({
                top: Math.max(0, first.offsetTop - lyricsContainer.clientHeight / 2 + first.clientHeight / 2),
                behavior: 'auto'
              });
            }
          }, 1400);
        }
      }
    }
    if (activeLyricIndex >= 0 && lyricElements[activeLyricIndex]) {
      const activeEl = lyricElements[activeLyricIndex];
      if (activeEl.dataset.hasWords === 'true') {
        const spans = activeEl.children;
        for (let j = 0; j < spans.length; j++) {
          const sp = spans[j];
          const wStart = parseFloat(sp.dataset.start);
          const wEnd = parseFloat(sp.dataset.end);
          if (currentTime >= wEnd) {
            if (sp.className !== 'word-span is-passed') {
              sp.className = 'word-span is-passed';
              sp.dataset.pct = '';
              sp.style.background = '';
              sp.style.webkitBackgroundClip = '';
              sp.style.webkitTextFillColor = '';
            }
          } else if (currentTime >= wStart) {
            if (sp.className !== 'word-span is-singing') sp.className = 'word-span is-singing';
            // Cuma tulis gradient waktu persentasenya berubah — hemat repaint,
            // jadi gerakan karaokenya ngalir tanpa efek glow/scale per-frame.
            const dur = Math.max(0.08, wEnd - wStart);
            const pct = Math.min(100, Math.max(0, Math.round(((currentTime - wStart) / dur) * 100)));
            if (sp.dataset.pct !== String(pct)) {
              sp.dataset.pct = String(pct);
              const softEdge = Math.min(100, pct + 10);
              sp.style.background = 'linear-gradient(90deg, #ffffff 0%, #ffffff ' + pct + '%, rgba(255,255,255,0.34) ' + softEdge + '%, rgba(255,255,255,0.34) 100%)';
              sp.style.webkitBackgroundClip = 'text';
              sp.style.webkitTextFillColor = 'transparent';
            }
          } else {
            if (sp.className !== 'word-span is-pending') {
              sp.className = 'word-span is-pending';
              sp.dataset.pct = '';
              sp.style.background = '';
              sp.style.webkitBackgroundClip = '';
              sp.style.webkitTextFillColor = '';
            }
          }
        }
      }
    }
    let activeIdx = -1;
    for (let i = lyrics.length - 1; i >= 0; i--) {
      if (currentTime >= lyrics[i].time) {
        activeIdx = i;
        break;
      }
    }
    if (activeIdx === activeLyricIndex) return;
    activeLyricIndex = activeIdx;
    lyricElements.forEach((el, i) => {
      const distance = Math.abs(i - activeIdx);
      const isActive = (i === activeIdx);
      const isNear = (distance === 1);
      el.classList.toggle('is-active', isActive);
      el.classList.toggle('is-near', isNear);
      const delay = distance <= 2 ? (distance * 30) + 'ms' : '0ms';
      if (el.style.transitionDelay !== delay) el.style.transitionDelay = delay;
      if (!isActive && el.dataset.hasWords === 'true') {
        const spans = el.children;
        const shouldBePassed = i < activeIdx;
        for (let j = 0; j < spans.length; j++) {
          const sp = spans[j];
          sp.style.background = '';
          sp.style.webkitBackgroundClip = '';
          sp.style.webkitTextFillColor = '';
          sp.dataset.pct = '';
          sp.className = shouldBePassed ? 'word-span is-passed' : 'word-span is-pending';
        }
      }
      if (isActive && lyricsContainer) {
        const containerHeight = lyricsContainer.clientHeight;
        const targetScroll = Math.max(0, el.offsetTop - (containerHeight / 2) + (el.clientHeight / 2));
        if (Math.abs(lyricsContainer.scrollTop - targetScroll) > 4) {
          lyricsContainer.scrollTo({ top: targetScroll, behavior: 'smooth' });
        }
      }
    });
    if (activeIdx === -1 && lyricsContainer) {
      lyricsContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
  function updateProgressUI(current) {
    const duration = TOTAL_SECONDS > 0 ? TOTAL_SECONDS : 1;
    const bounded = Math.max(0, Math.min(duration, current));
    const percent = (bounded / duration) * 100;
    fill.style.width = percent + '%';
    dot.style.left = percent + '%';
    cur.textContent = formatTime(bounded);
  }
  function ticker() {
    if (scrubTime !== null) {
      // saat menyeret bar, tampilan ikut posisi seretan, bukan audio yang masih jalan
      updateProgressUI(scrubTime);
      updateLyrics(scrubTime);
    } else if (isPlaying) {
      const current = getCurrentTime();
      updateProgressUI(current);
      updateLyrics(current);
    }
    // riak gelombang loading terus bergerak walau pause, sesuai referensi
    if (introEl && introCtx && !introEl.classList.contains('is-collapsed')) {
      wavePhase += WAVE_CFG.speed;
      drawIntroWave();
    }
    requestAnimationFrame(ticker);
  }
  requestAnimationFrame(ticker);
  play.addEventListener('click', () => {
    if (isPlaying) {
      pausePlayback();
    } else {
      playAudio();
    }
  });
  let statusRestoreTimer = null;
  function flashStatus(text) {
    statusFrom.innerText = text;
    clearTimeout(statusRestoreTimer);
    statusRestoreTimer = setTimeout(function () {
      statusFrom.innerText = baseStatus;
    }, 1500);
  }
  function renderTuneValue() {
    const abs = (Math.abs(lyricOffsetMs) / 1000).toFixed(2);
    const sign = lyricOffsetMs > 0 ? '+' : lyricOffsetMs < 0 ? '−' : '';
    tuneVal.textContent = sign + abs + 's';
    tuneVal.classList.toggle('is-set', lyricOffsetMs !== 0);
  }
  function setSheet(open) {
    sheet.classList.toggle('is-open', open);
    scrim.classList.toggle('is-open', open);
    menuBtn.classList.toggle('is-on', open);
  }
  function nudgeLyrics(ms) {
    lyricOffsetMs = Math.max(-LYRIC_OFFSET_LIMIT_MS, Math.min(LYRIC_OFFSET_LIMIT_MS, lyricOffsetMs + ms));
    activeLyricIndex = -99;
    renderTuneValue();
    updateLyrics(getCurrentTime());
    const abs = (Math.abs(lyricOffsetMs) / 1000).toFixed(2);
    flashStatus('Lirik ' + (lyricOffsetMs > 0 ? '+' : lyricOffsetMs < 0 ? '−' : '') + abs + 's');
  }
  menuBtn.addEventListener('click', function () { setSheet(!sheet.classList.contains('is-open')); });
  scrim.addEventListener('click', function () { setSheet(false); });
  tuneReset.addEventListener('click', function () {
    lyricOffsetMs = 0;
    activeLyricIndex = -99;
    renderTuneValue();
    updateLyrics(getCurrentTime());
    flashStatus('Lirik 0.00s');
  });
  sheet.querySelectorAll('.tune__btn').forEach(function (btn) {
    btn.addEventListener('click', function () { nudgeLyrics(parseInt(btn.dataset.step, 10)); });
  });
  renderTuneValue();
  btnRw.addEventListener('click', () => {
    seekPlayback(getCurrentTime() - 10);
  });
  btnFw.addEventListener('click', () => {
    seekPlayback(getCurrentTime() + 10);
  });
  // Ulang dari awal
  btnRestart.addEventListener('click', () => {
    seekPlayback(0);
    if (!isPlaying) playAudio();
  });
  // Mode ulang (loop) — dulu tombolnya cuma hiasan, sekarang beneran ngulang
  btnLoop.addEventListener('click', () => {
    loopMode = !loopMode;
    btnLoop.classList.toggle('is-on', loopMode);
    btnLoop.setAttribute('aria-pressed', loopMode ? 'true' : 'false');
    flashStatus(loopMode ? 'Ulang: ON' : 'Ulang: OFF');
  });
  menuBtnTop.addEventListener('click', function () {
    setSheet(!sheet.classList.contains('is-open'));
  });
  function barTargetFromEvent(event) {
    const rect = bar.getBoundingClientRect();
    if (!rect.width) return null;
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    return (x / rect.width) * getDuration();
  }
  // Seret bar = scrubbing: tampilan ikut jari, seek asli baru dipakai saat dilepas
  // (biar lagu nggak di-restart puluhan kali saat digeser).
  bar.addEventListener('pointerdown', (event) => {
    const target = barTargetFromEvent(event);
    if (target === null) return;
    scrubTime = Math.max(0, Math.min(getDuration(), target));
    bar.classList.add('is-scrubbing');
    try { bar.setPointerCapture(event.pointerId); } catch (e) {}
    updateProgressUI(scrubTime);
    updateLyrics(scrubTime);
  });
  bar.addEventListener('pointermove', (event) => {
    if (scrubTime === null) return;
    const target = barTargetFromEvent(event);
    if (target === null) return;
    scrubTime = Math.max(0, Math.min(getDuration(), target));
    updateProgressUI(scrubTime);
    updateLyrics(scrubTime);
  });
  function endScrub(event) {
    if (scrubTime === null) return;
    const target = scrubTime;
    scrubTime = null;
    bar.classList.remove('is-scrubbing');
    try { bar.releasePointerCapture(event.pointerId); } catch (e) {}
    seekPlayback(target);
  }
  bar.addEventListener('pointerup', endScrub);
  bar.addEventListener('pointercancel', endScrub);
  window.addEventListener('beforeunload', () => {
    try {
      if (sourceNode) sourceNode.stop(0);
      if (audioCtx) audioCtx.close();
    } catch (e) {}
  });
  initInlineAudio();
})();
</script>
`
}
const escapeHtmlJs = (value) =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .replace(/</g, '\\x3C');
function parseYouTubeInput(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  let id = null
  if (host === 'youtu.be') {
    id = url.pathname.split('/').filter(Boolean)[0]
  } else if (host === 'youtube.com' || host === 'm.youtube.com') {
    id = url.searchParams.get('v')
    if (!id) id = url.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1]
  }
  if (!/^[\w-]{11}$/.test(id || '')) return null
  return { id, url: `https://www.youtube.com/watch?v=${id}` }
}
function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = total % 60
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`
}
function safeFileName(value = 'music') {
  return String(value)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'music'
}
function adjustLikelyIntro(lines, durationSec) {
  if (!lines.length || durationSec <= 0) return lines
  const lastTime = lines[lines.length - 1].time
  const span = lastTime - lines[0].time
  if (durationSec - lastTime <= 20 || durationSec <= span + 20) return lines
  const intro = Math.round(durationSec - (span + 20))
  if (intro < 8 || intro > 90) return lines
  return lines.map((line) => ({
    ...line,
    time: line.time + intro,
    words: line.words?.map((word) => ({
      ...word,
      start: word.start + intro,
      end: word.end + intro,
    })),
  }))
}

export { cleanTitleForLyrics, extractArtistAndTitle, normalizeLyrics, parseSyncedLyrics, plainLyricsToSynced, encodeInlineAudio, createMusicPlayer }
export default {
  name: 'play2',
  aliases: ['ytplay2', 'music2', 'karaoke'],
  tags: 'downloader',
  description: 'Player musik Webview dengan lirik karaoke dan audio inline',
  async run(ctx) {
    const input = (ctx.text || '').trim().slice(0, MAX_QUERY_LENGTH)
    if (!input) {
      await ctx.reply(
        `🎵 *${config.botName} — Karaoke Player* (audio)\n\n` +
        `Gunakan \`${ctx.prefix}${ctx.command} <judul>\` atau URL YouTube.\n` +
        'Contoh: `.play2 Indonesian Rain`\n' +
        `\n*Opsi*\n` +
        `• \`novn\` — skip voice note\n` +
        `• \`vnonly\` — hanya voice note\n` +
        `• \`theme <nama>\` — kunci tema: ${Object.keys(PLAY2_THEMES).join(', ')}\n` +
        `• \`randtheme\` — tema acak\n\n` +
        'Tanpa opsi tema, tema berganti tiap lagu.'
      )
      return
    }

    const wantsVnOnly = /\bvnonly\b/i.test(input)
    const wantsNoVn = /\bnovn\b/i.test(input)
    const sendVoiceNote = wantsVnOnly || (!wantsNoVn && process.env.PLAY2_VOICE_NOTE !== 'off')
    // Tema: `theme neon` mengunci tema untuk pemanggilan ini, `randtheme`
    // memaksa acak penuh. Tanpa keduanya tema berganti tiap lagu.
    const wantRandomTheme = /\brandtheme\b/i.test(input)
    const pinnedTheme = (input.match(/\btheme[:\s]+([a-z]+)/i)?.[1] ?? '').toLowerCase()
    if (pinnedTheme && !PLAY2_THEMES[pinnedTheme]) {
      await ctx.reply(`❌ Tema *${pinnedTheme}* tidak ada. Pilihan: ${THEME_NAMES.join(', ')}`)
      return
    }
    // `video` sengaja DIHAPUS dari command ini: alur video butuh resolve +
    // unduh + ffmpeg 30-150 detik dan sering gagal diam-diam, sementara
    // play2 sekarang murni audio. Kata "video" di query tetap diteruskan ke
    // pencarian YouTube (mis. "video game soundtrack") — hanya token
    // `videoNNN` yang dibuang.
    const searchInput = input
      .replace(/\b(vnonly|novn|randtheme)\b/gi, '')
      .replace(/\btheme[:\s]+[a-z]+\b/gi, '')
      .replace(/\bvideo\d{0,4}\b/gi, '')
      .trim() || input;
    await ctx.react('🕒').catch(() => {})
    try {
      const direct = parseYouTubeInput(searchInput)
      let youtubeUrl = direct?.url
      let rawTitle = 'Unknown'
      let rawArtist = 'Unknown Artist'
      let durationSec = 0
      let thumbnailUrl = ''
      if (!youtubeUrl) {
        const results = await searchYouTube(searchInput, 5)
        if (!results.length) {
          throw new Error('Lagu tidak ditemukan di YouTube.')
        }
        const track = results.find((item) => (item.seconds >= 30 && item.seconds <= MAX_AUDIO_SECONDS) || !item.seconds) || results[0]
        youtubeUrl = parseYouTubeInput(track.url)?.url || track.url
        rawTitle = track.title || 'Unknown'
        rawArtist = track.author || 'YouTube'
        durationSec = Number(track.seconds) || 0
        thumbnailUrl = track.thumbnail || ''
      }
      const audioData = await downloadYouTube(youtubeUrl, 'mp3')
      if (!audioData?.downloadUrl) throw new Error('URL audio tidak tersedia dari provider YouTube')
      rawTitle = audioData.rawTitle || audioData.title || rawTitle
      durationSec = Number(audioData.duration) || durationSec
      thumbnailUrl = audioData.thumb || thumbnailUrl
      if (!durationSec) durationSec = 0
      const [lyricsResult, thumbnail, rawBuffer] = await Promise.all([
        collectLyrics({
          userQuery: searchInput,
          rawTitle,
          rawArtist,
          durationSec,
        }),
        getThumb(thumbnailUrl),
        getYouTubeBuffer(audioData.downloadUrl),
      ])
      const displayTitle = lyricsResult.title || rawTitle
      const displayArtist = lyricsResult.artist || rawArtist
      const duration = formatDuration(durationSec)
      const syncedLyrics = adjustLikelyIntro(lyricsResult.lines, durationSec)
      const imageSrc = thumbnail.length ? `data:image/jpeg;base64,${thumbnail.toString('base64')}` : ''
      const playerInput = {
        title: displayTitle,
        artist: displayArtist,
        duration,
        imageSrc,
        lyrics: syncedLyrics,
        provider: lyricsResult.provider,
      }
      // Tema berganti tiap lagu kecuali kalau dikunci lewat `theme <nama>`.
      const themeName = pinnedTheme || (wantRandomTheme ? pickRandomTheme() : nextTheme(THEME_STATE.last))
      THEME_STATE.last = themeName

      let html = null
      let skippedReason = ''
      try {
        if (html) throw new Error('__skip_audio_inline__')
        const shellHtml = createMusicPlayer({ ...playerInput, audioDataUri: '', theme: themeName })
        const budgetBytes = PAYLOAD_BUDGET_BYTES - PAYLOAD_SAFETY_MARGIN - Buffer.byteLength(shellHtml, 'utf8')
        const inlineAudio = await encodeInlineAudio(rawBuffer, durationSec, budgetBytes)
        if (inlineAudio.buffer) {
          html = createMusicPlayer({
            ...playerInput,
            audioDataUri: `data:${AUDIO_MIME};base64,${inlineAudio.buffer.toString('base64')}`,
            theme: themeName,
          })
          if (Buffer.byteLength(html, 'utf8') > PAYLOAD_BUDGET_BYTES) {
            html = null
            skippedReason = 'payload pemutar melebihi batas WhatsApp'
          }
        } else if (inlineAudio.reason === 'too-long') {
          const minutes = Math.round((inlineAudio.durationSec || durationSec) / 60)
          const limit = Math.max(1, Math.round((inlineAudio.maxSeconds || 0) / 60))
          skippedReason = `durasi lagu ±${minutes} menit, batas pemutar inline ±${limit} menit`
        } else if (inlineAudio.reason === 'too-big') {
          skippedReason = 'audio nggak muat di batas payload WhatsApp'
        } else {
          skippedReason = 'audio nggak tersedia dari provider'
        }
      } catch (error) {
        const reason = String(error?.message || error)
        if (reason === '__skip_audio_inline__') {
        } else {
          console.error('[PLAY2 INLINE AUDIO ERROR]', error)
          skippedReason = reason.slice(0, 160)
        }
      }
      if (!html && skippedReason) {
        await ctx.reply(
          `ℹ️ Player webview dilewati: ${skippedReason}.\n` +
          'Audio asli tetap dikirim di pesan berikutnya.'
        )
      }
      if (html) {
        try {
          await sendHtmlGame(ctx, { html, title: `${config.botName} Music Player`, trustedSources: [] })
        } catch (error) {
          console.error('[PLAY2 WEBVIEW SEND ERROR]', error)
          await ctx.reply('⚠️ Player Webview gagal dirender. Audio asli tetap dikirim.')
        }
      }

      
      if (!wantsVnOnly) {
        const sendAudio = await ensureAudioFile(rawBuffer)
        await ctx.client.message.send(ctx.chat, {
          type: 'audio',
          media: sendAudio.buffer,
          mimetype: sendAudio.mimetype,
          fileName: `${safeFileName(displayTitle)}.${sendAudio.ext}`,
          caption: `🎵 *${config.botName}*\n${String(displayTitle).slice(0, 700)}\n${String(displayArtist).slice(0, 100)}`,
        })
      }
      
      
      if (sendVoiceNote) {
        try {
          const opus = await toPTT(rawBuffer)
          if (opus?.length) {
            await ctx.client.message.send(ctx.chat, {
              type: 'audio',
              media: opus,
              mimetype: 'audio/ogg; codecs=opus',
              ptt: true,
              fileName: `${safeFileName(displayTitle)}.opus`,
            })
          }
        } catch (vnErr) {
          console.error('[PLAY2 VN ERROR]', vnErr)
          await ctx.reply(wantsVnOnly
            ? '⚠️ Voice note gagal dibuat (ffmpeg?).'
            : '⚠️ Voice note gagal dibuat (ffmpeg?), audio biasa tetap terkirim.').catch(() => {})
        }
      }
      await ctx.react('✅').catch(() => {})
    } catch (error) {
      console.error('[PLAY2 ERROR]', error)
      await ctx.react('❌').catch(() => {})
      await ctx.reply(`❌ Gagal memuat musik: ${String(error?.message || error).slice(0, 300)}`)
    }
  },
}