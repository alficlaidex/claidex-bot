# Claide Bot by Alfi

WhatsApp bot custom berbasis [`zapo-js`](https://www.npmjs.com/package/zapo-js).

## Fitur

- Routing command multi-prefix dan permission admin/staff.
- Menu Rich Message/nativeFlow dengan kategori dan detail command.
- Sistem RPG: karakter, combat, quest, crafting, shop, travel, dan equipment.
- Tool media: stiker, konversi, dan player musik.
- Integrasi AI dan downloader yang dapat dikonfigurasi terpisah.
- Manajemen grup: welcome, hidetag, antilink, kick, promote, dan toggle fitur.
- Owner tools dengan akses owner-only dan jalur output DM.
- Hot reload atomik saat diaktifkan melalui environment.
- Penyimpanan state WhatsApp dan mailbox lokal memakai SQLite.
- Fake-server/E2E readiness melalui kontrak `zapo-js`.

## Kebutuhan

- Node.js `20.9+` (direkomendasikan Node.js 22/26).
- FFmpeg dan FFprobe untuk fitur audio/media.
- `zip` hanya diperlukan oleh command backup owner.
- Credential/API eksternal harus dikonfigurasi sendiri; adapter yang belum dikonfigurasi akan/report tidak aktif, bukan diam-diam gagal.

## Instalasi

```bash
cp .env.example .env
npm ci
npm start
```

Edit `.env` terlebih dahulu, terutama `OWNER_NUMBERS`, `PAIRING_NUMBER`, dan credential proxy bila diperlukan.

## Validasi

```bash
npm test
```

Perintah tersebut memeriksa sintaks seluruh file JavaScript first-party tanpa menjalankan koneksi WhatsApp.

## Konfigurasi utama

- `BOT_NAME` — nama tampilan, default `Claide Bot by Alfi`.
- `OWNER_NUMBERS` — nomor owner, dipisahkan koma dan menggunakan kode negara tanpa simbol.
- `AUTH_METHOD` — `auto`, `qr`, atau `pairing`.
- `PAIRING_NUMBER` — nomor target untuk pairing code.
- `PROXY_*` — proxy WebSocket/media opsional.
- `HOT_RELOAD_ENABLED` — default `false`;aktifkan hanya untuk development.
- `YOUTUBE_API_KEY` sudah tidak diperlukan — pencarian (`yt-search`) dan unduh (`j2download`) jalan tanpa API key.

Jangan commit `.env`, folder `session/`, database, credential, atau backup.

## Struktur

- `auth/` — pairing, QR, dan reconnect.
- `core/` — konfigurasi internal, database, permission, dan utilitas.
- `feat/` — command dan fitur yang dimuat dinamis.
- `handlers/` — routing pesan, grup, error, dan game handler.
- `lib/` — helper media, rich message, dan konverter.
- `src/` — adapter AI, reward, dan media service.
- `scripts/` — pemeriksaan offline repository.

## Catatan keamanan

- Jalankan eval/exec/file tools hanya pada akun yang dikontrol.
- Jangan mengekspos media service ke internet tanpa autentikasi dan allowlist.
- Credential device dari `session/state.sqlite` sangat sensitif; backup dan bagikan hanya melalui jalur terenkripsi.
- Jangan mengaktifkan opsi `dangerous.*` dari `zapo-js` di produksi.

## Credits

Proyek ini merupakan adaptasi dan rebranding dari basis Fiony Bot © JamvanHax0r. Atribusi upstream dipertahankan.
