/**
 * Claide Bot by Alfi
 * Adapted from JHZ-Bot © Fathur. Upstream attribution is preserved.
 * lib/converter.js — Media conversion using the system FFmpeg binary.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MAX_INPUT_BYTES = 100 * 1024 * 1024
const MAX_STDERR_CHARS = 16 * 1024

async function runFfmpeg(inputBuffer, args, outputExt, { timeoutMs = 120_000 } = {}) {
  if (!Buffer.isBuffer(inputBuffer) || !inputBuffer.length) throw new Error('Input media kosong')
  if (inputBuffer.length > MAX_INPUT_BYTES) throw new Error('Input media melebihi batas 100 MB')

  const directory = await mkdtemp(join(tmpdir(), 'claide-convert-'))
  const inputPath = join(directory, 'input.tmp')
  const outputPath = join(directory, `output.${outputExt}`)

  try {
    await writeFile(inputPath, inputBuffer, { mode: 0o600 })

    await new Promise((resolve, reject) => {
      const process = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath, ...args, outputPath], {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      })
      let stderr = ''
      let settled = false

      const finish = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolve()
      }
      const timer = setTimeout(() => {
        process.kill('SIGKILL')
        finish(new Error(`FFmpeg timeout setelah ${Math.round(timeoutMs / 1000)} detik`))
      }, timeoutMs)

      process.stderr.on('data', (chunk) => {
        if (stderr.length < MAX_STDERR_CHARS) stderr += chunk.toString().slice(0, MAX_STDERR_CHARS - stderr.length)
      })
      process.on('error', (error) => finish(new Error(`Tidak bisa menjalankan FFmpeg: ${error.message}`)))
      process.on('close', (code) => {
        if (code === 0) finish()
        else finish(new Error(`FFmpeg error (code ${code}): ${stderr.slice(-1000)}`))
      })
    })

    return await readFile(outputPath)
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}

export async function toAudio(buffer) {
  return runFfmpeg(buffer, ['-vn', '-ac', '2', '-b:a', '128k', '-ar', '44100', '-f', 'mp3'], 'mp3')
}

export async function toCompactAudio(buffer, { bitrate = 24, format = 'webm', sampleRate, channels = 1 } = {}) {
  const normalizedBitrate = Math.max(8, Math.min(320, Number(bitrate) || 24))
  const base = ['-vn', '-ac', String(Math.max(1, Math.min(2, Number(channels) || 1)))]

  if (format === 'webm' || format === 'ogg') {
    return runFfmpeg(buffer, [...base, '-c:a', 'libopus', '-b:a', `${normalizedBitrate}k`, '-vbr', 'on', '-f', format], format, {
      timeoutMs: 180_000,
    })
  }

  const rate = sampleRate ?? (normalizedBitrate <= 24 ? 24_000 : 32_000)
  return runFfmpeg(buffer, [...base, '-ar', String(rate), '-b:a', `${normalizedBitrate}k`, '-f', 'mp3'], 'mp3', {
    timeoutMs: 180_000,
  })
}

export async function toPTT(buffer) {
  return runFfmpeg(
    buffer,
    ['-vn', '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'on', '-compression_level', '10'],
    'opus',
    { timeoutMs: 180_000 }
  )
}
