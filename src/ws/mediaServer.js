/**
 * © JamvanHax0r — Fiony Bot
 * Hapus credit gak bikin u jago dumbass.
 * Hargai sebagaimana u mau dihargai.
 * mediaServer.js — WebSocket media proxy stateless
 *
 * [UPDATE AND FIX BELOW]
 * Client connect: wss://audio.jhx.my.id/wss/audio?url=<ENCODED>&mime=<MIME>
 *
 * Protocol (persis yang dibaca player Aurora):
 *  S→C JSON {type:'start', mime, contentLength}
 *  S→C binary chunks
 *  S→C JSON {type:'end'} | {type:'error', message}
 *
 * Stateless: gak ada token, gak ada session, gak ada cache.
 * Tiap koneksi = fresh fetch upstream. Simple, smooth, ringan.
 */

import { registerWsRoute } from './wsRoutes.js'
import { Readable } from 'node:stream';
import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { assertPublicHttpUrl } from '../../lib/urlSafety.js';

// Batas ukuran stream per koneksi (default 96 MB) supaya endpoint ini
// nggak jadi amplifier buat whoever nembak port publik ini.
const MAX_STREAM_BYTES = Number(process.env.MEDIA_WS_MAX_BYTES || 96 * 1024 * 1024);

export function createMediaWsServer({ port = 8090, path = '/wss/audio', host, token } = {}) {
  // Token opsional: kalau di-set, WAJIB ada sebagai ?token=<...> atau header
  // x-media-token. Kosong = hanya untuk network internal /localhost.
  const expectedToken = token || process.env.MEDIA_WS_TOKEN || '';
  // Default bind loopback. Dulunya bind ke semua interface tanpa auth, jadi
  // siapa pun yang bisa tcp/8090 bisa dipakai sebagai proxy SSRF.
  const bindHost = host || process.env.MEDIA_WS_HOST || '127.0.0.1';

  const server = http.createServer((req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('Upgrade required');
  });

  const wss = registerWsRoute(server, { path }).wss;

  wss.on('connection', (ws, req) => {
    const u = new URL(req.url, 'http://localhost');

    // Auth token dicek SEBELUM apa pun. Without this the endpoint is an open
    // proxy on every interface.
    if (expectedToken) {
      const given = u.searchParams.get('token') || req.headers['x-media-token'];
      const a = Buffer.from(String(given ?? ''));
      const b = Buffer.from(expectedToken);
      const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!ok) {
        console.log('[MediaWS] reject: bad/missing token');
        ws.close(4003, 'unauthorized');
        return;
      }
    }

    const sourceUrl = u.searchParams.get('url');
    const mime = u.searchParams.get('mime') || 'video/mp4';

    if (!sourceUrl) {
      console.log('[MediaWS] reject: missing url param');
      ws.close(4001, 'missing url param');
      return;
    }

    console.log('[MediaWS] connect | mime=' + mime + ' | url=' + sourceUrl.slice(0, 80));

    let cancelled = false;
    ws.on('close', () => { cancelled = true; });
    ws.on('error', () => { cancelled = true; });

    (async () => {
      let stream = null;
      try {
        // SSRF guard: hanya http/https publik, port 80/443, bukan loopback/
        // link-local/RFC1918, dan tiap hop redirect divalidasi ulang.
        // Default fetch() + redirect:'follow' di sini dulu berarti endpoint
        // ini bebas dipakai fetch apa pun di jaringan internal bot.
        let current = await assertPublicHttpUrl(sourceUrl);
        let res = null;
        for (let hop = 0; hop <= 3; hop++) {
          res = await fetch(current, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            redirect: 'manual',
            signal: AbortSignal.timeout(20_000)
          });
          if (res.status < 300 || res.status >= 400) break;
          const location = res.headers.get('location');
          if (!location) throw new Error('redirect tanpa tujuan');
          current = await assertPublicHttpUrl(new URL(location, current));
        }

        if (!res || !res.ok || !res.body) {
          ws.send(JSON.stringify({ type: 'error', message: 'source fetch failed: ' + (res?.status ?? 'unknown') }));
          try { ws.close(); } catch {}
          return;
        }

        const total = Number(res.headers.get('content-length') || 0);
        ws.send(JSON.stringify({ type: 'start', mime, contentLength: total }));

        stream = Readable.fromWeb(res.body);
        let sent = 0;
        for await (const piece of stream) {
          sent += piece.length ?? piece.byteLength ?? 0;
          if (sent > MAX_STREAM_BYTES) {
            try { ws.send(JSON.stringify({ type: 'error', message: 'stream melebihi batas ukuran' })); } catch {}
            cancelled = true;
            break;
          }
          if (cancelled || ws.readyState !== 1) { cancelled = true; break; }
          ws.send(Buffer.isBuffer(piece) ? piece : Buffer.from(piece));
        }

        try { stream.destroy?.(); } catch {}
        if (!cancelled) ws.send(JSON.stringify({ type: 'end' }));
        try { if (!cancelled) ws.close(); } catch {}
      } catch (e) {
        console.log('[MediaWS] stream error:', e.message || e);
        try { stream?.destroy?.(); } catch {}
        try { ws.send(JSON.stringify({ type: 'error', message: String(e.message || e) })); } catch {}
        try { ws.close(); } catch {}
      }
    })();
  });

  server.listen(port, bindHost, () => {
    console.log(`[MediaWS] server aktif di ${bindHost}:${port}${path}` +
      (expectedToken ? ' (token wajib)' : ' (TANPA token — pastikan tidak terekspos publik)'));
  });
  return { server, wss };
}
