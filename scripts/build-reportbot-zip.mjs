#!/usr/bin/env node
/**
 * scripts/build-reportbot-zip.mjs — paket report-bot jadi zip yang aman.
 *
 * Yang DIKECUALIKAN (nilai nyata, bukan placeholder):
 *   - data/accounts.txt   berisi api_id:api_hash:phone milik asli
 *   - config.json         berisi api_hash asli
 *   - sessions/           string sesi Telegram
 * Ganti dengan accounts.example.txt / config.example.json supaya zip bisa
 * dipakai orang lain tanpa membocorkan kredensial.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const ex = promisify(execFile)

const SRC = '/home/alfi/report-bot/report-bot'
const OUT_DIR = '/home/alfi/report-bot'
const EXCLUDES = [
  'node_modules/*',
  '.git/*',
  'sessions/*',
  'data/accounts.txt',
  'config.json',
  '*.log',
]

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

const name = `report-bot-${stamp()}.zip`
const out = path.join(OUT_DIR, name)

// 1) safety placeholders next to the real files (inside SRC, gitignored later)
await fs.mkdir(path.join(SRC, 'data'), { recursive: true })
await fs.writeFile(
  path.join(SRC, 'data', 'accounts.example.txt'),
  '# format: <api_id>:<api_hash>:<phone>\n# isi file ini dengan akun Telegram milikmu\n123456:0123456789abcdef0123456789abcdef:+6281234567890\n',
  'utf8',
)

let rawConfig = {}
try {
  rawConfig = JSON.parse(await fs.readFile(path.join(SRC, 'config.json'), 'utf8'))
} catch {}
await fs.writeFile(
  path.join(SRC, 'config.example.json'),
  JSON.stringify(
    {
      api_id: 123456,
      api_hash: '0123456789abcdef0123456789abcdef',
      phone: '+6281234567890',
      report_delay: 1,
      targets_file: 'data/targets.txt',
    },
    null,
    2,
  ) + '\n',
  'utf8',
)
console.log(`[zip] placeholder dibuat (api_id di config.example: ${rawConfig.api_id ?? 'n/a'})`)

// 2) build the zip
const excludeArgs = EXCLUDES.map((e) => `"${e}"`).join(' ')
await ex('zip', ['-rq', out, '.', '-x', ...EXCLUDES], { cwd: SRC, maxBuffer: 1024 * 1024 * 64 })

const stat = await fs.stat(out)
console.log(`[zip] ${out}`)
console.log(`[zip] ${(stat.size / 1024 / 1024).toFixed(2)} MB`)

// 3) verify the secrets really are absent
const listing = await ex('unzip', ['-l', out], { maxBuffer: 1024 * 1024 * 16 })
for (const forbidden of ['data/accounts.txt', 'config.json', 'sessions/']) {
  const present = listing.stdout.includes(forbidden)
  console.log(`[verify] ${forbidden.padEnd(22)} ${present ? 'MASIH ADA (BAHAYA)' : 'tidak ada ✓'}`)
  if (present) {
    console.error(`[zip] GAGAL: ${forbidden} bocor ke dalam zip`)
    process.exit(1)
  }
}
console.log('[zip] aman untuk dipublikasikan')
console.log(out)