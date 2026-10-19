/**
 * Claide Bot by Alfi
 * Based on Fiony Bot © JamvanHax0r. Upstream attribution is preserved.
 * config.js — Centralized configuration. Secrets are loaded from environment variables.
 */
import 'dotenv/config'

const envString = (key, fallback = '') => {
  const value = process.env[key]
  return value === undefined || value === '' ? fallback : value
}

const envNumber = (key, fallback) => {
  const value = Number(process.env[key])
  return Number.isFinite(value) ? value : fallback
}

const envBoolean = (key, fallback = false) => {
  const value = process.env[key]
  if (value === undefined || value === '') return fallback
  return /^(1|true|yes|on)$/i.test(value)
}

const envList = (key) => envString(key)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const customPairingCode = envString('PAIRING_CUSTOM_CODE')
const ownerNumbers = envList('OWNER_NUMBERS')

export default {
  botName: envString('BOT_NAME', 'Claide Bot by Alfi'),

  auth: {
    method: envString('AUTH_METHOD', 'auto'),
    customCode: customPairingCode,
    useCustomCode: envBoolean('PAIRING_USE_CUSTOM_CODE', Boolean(customPairingCode)),
    pairingNumber: envString('PAIRING_NUMBER'),
  },

  prefixes: ['.', '!', '/', '#', ',', '😁', '🦅'],
  mainPrefix: '.',

  staff: ownerNumbers.map((number) => ({
    number,
    role: 'owner',
    label: 'Alfi • Developer',
  })),

  // Fitur grup yang butuh on/off (permission admin/staff)
  toggleable: ['welcome', 'bye', 'antilink', 'game'],

  // BLACKLIST domain antilink (default; bisa di-override per grup).
  // Selain daftar ini = boleh. Yang di daftar = dihapus.
  antilink: {
    defaultBlacklist: 'wa.me,chat.whatsapp.com,t.me,telegram.me',
  },

  sticker: {
    packName: envString('STICKER_PACK_NAME', 'Made with'),
    author: envString('STICKER_AUTHOR', 'Alfi'),
    withExif: true,
    maxVideoSeconds: envNumber('STICKER_MAX_VIDEO_SECONDS', 10),
  },

  wsWorkerUrl: envString('WS_WORKER_URL', 'wss://audio.jhx.my.id/wss/audio'),
  wsPort: envNumber('WS_PORT', 8090),
  wsPath: envString('WS_PATH', '/wss/audio'),
  // Media proxy: loopback + token by default. Set MEDIA_WS_HOST=0.0.0.0 hanya
  // kalau MEMERLUKAN akses dari luar (mis. lewat tunnel), dan WAJIB isi
  // MEDIA_WS_TOKEN — tanpa itu endpoint ini jadi open proxy.
  wsHost: envString('MEDIA_WS_HOST', '127.0.0.1'),
  wsToken: envString('MEDIA_WS_TOKEN'),

  // Endpoint video menempel di port yang sama dengan audio (path /wss/video),
  // karena tunnel cuma mem-forward SATU port. Link video di-resolve per koneksi
  // (token upstream berumur detik) lalu di-transcode sebelum dikirim. Lihat
  // src/ws/videoServer.js. wsVideoUrl WAJIB wss:// — webview WA menolaknya.
  wsVideoUrl: envString('WS_VIDEO_URL', 'wss://audio.jhx.my.id/wss/video'),
  wsVideoPath: envString('WS_VIDEO_PATH', '/wss/video'),
  wsVideoToken: envString('MEDIA_WS_VIDEO_TOKEN'),

  proxy: {
    enabled: envBoolean('PROXY_ENABLED', false),
    type: envString('PROXY_TYPE', 'http'),
    host: envString('PROXY_HOST'),
    port: envNumber('PROXY_PORT', 0),
    username: envString('PROXY_USERNAME'),
    password: envString('PROXY_PASSWORD'),
  },

  antiSpam: {
    enabled: envBoolean('ANTI_SPAM_ENABLED', true),
    max: envNumber('ANTI_SPAM_MAX', 5),
    windowMs: envNumber('ANTI_SPAM_WINDOW_MS', 10_000),
    muteMs: envNumber('ANTI_SPAM_MUTE_MS', 30_000),
  },
  cooldown: envNumber('COMMAND_COOLDOWN_MS', 3000),

  autoRead: envBoolean('AUTO_READ', true),
  typingPresence: envBoolean('TYPING_PRESENCE', true),

  hotReload: {
    enabled: envBoolean('HOT_RELOAD_ENABLED', false),
    debounceMs: envNumber('HOT_RELOAD_DEBOUNCE_MS', 400),
    notifyOwner: envBoolean('HOT_RELOAD_NOTIFY_OWNER', true),
  },

  // React Channel — auto-react postingan baru di channel khusus bot,
  // + command .rch buat react manual ke postingan channel manapun.
  reactChannel: {
    enabled: envBoolean('REACT_CHANNEL_ENABLED', false),
    dedicatedChannelUrl: envString('REACT_CHANNEL_URL', 'https://whatsapp.com/channel/0029VbCOLKRKrWQtIO1vzN0E'),
    emojis: ['🔥', '❤️', '😍', '👍', '😂', '🥳', '💯', '✨'],
  },

  messages: {
    wait: '⏳ Tunggu sebentar ya, Kak...',
    error: '😵 Terjadi kesalahan, harap coba kembali nanti',
    ownerOnly: '🚫 Fitur ini khusus OWNER!',
    adminOnly: '🚫 Fitur ini khusus ADMIN!',
    groupOnly: '🚫 Fitur ini khusus GRUP!',
  },

  logLevel: envString('LOG_LEVEL', 'info'),
  libraryLogLevel: envString('LIBRARY_LOG_LEVEL', 'error'),
}
