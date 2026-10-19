/**
 * Claide Bot by Alfi
 * src/ws/wsRoutes.js — Dispatcher upgrade WebSocket untuk satu HTTP server.
 *
 * Kenapa file ini ada:
 *   Dua `new WebSocketServer({ server, path })` pada HTTP server yang sama itu
 *   SALAH. Setiap instance memasang listener 'upgrade' sendiri, dan keduanya
 *   berebut upgrade yang sama. Instance yang path-nya tidak cocok memanggil
 *   `abortHandshake(socket, 400)` — socket dibakar dua kali dan yang zalim
 *   balas 400 duluan. Gejalanya: `/wss/video` selalu 400, dan `/wss/audio`
 *   kadang rusak frame ("RSV1 must be clear").
 *
 * Solusinya: semua path WS dilayani `WebSocketServer({ noServer: true })`,
 * dan HANYA satu listener 'upgrade' di HTTP server yang meneruskan ke instance
 *   yang cocok. `registerWsRoute` idempotent per server.
 */
import { WebSocketServer } from 'ws'

const ROUTES = Symbol.for('claide.wsRoutes')

function routesFor(server) {
  if (!server[ROUTES]) {
    const routes = []
    Object.defineProperty(server, ROUTES, { value: routes, enumerable: false })

    server.on('upgrade', (req, socket, head) => {
      const index = req.url.indexOf('?')
      const pathname = index !== -1 ? req.url.slice(0, index) : req.url

      for (const route of routes) {
        if (route.path === pathname) {
          try {
            route.wss.handleUpgrade(req, socket, head, (ws) => {
              route.wss.emit('connection', ws, req)
            })
          } catch (error) {
            try { socket.destroy() } catch {}
            console.log(`[WSRoute] upgrade gagal di ${pathname}: ${error?.message || error}`)
          }
          return
        }
      }

      // Tidak ada route yang cocok: tolak dengan benar. Jangan `socket.destroy()`
      // tanpa handshake karena klien cuma lihat "Unexpected server response".
      try {
        socket.write(
          'HTTP/1.1 404 Not Found\r\n' +
          'Connection: close\r\n' +
          'Content-Length: 0\r\n' +
          '\r\n'
        )
        socket.destroy()
      } catch {}
    })
  }

  return server[ROUTES]
}

/**
 * Daftarkan satu path WS ke HTTP server yang sudah ada.
 * Memakai noServer supaya tidak ada listener 'upgrade' parsial dari ws.
 */
export function registerWsRoute(server, { path, wss }) {
  const target = wss ?? new WebSocketServer({ noServer: true })
  routesFor(server).push({ path, wss: target })
  return { wss: target }
}

export function createRoutedWsServer(server, { path, wss } = {}) {
  return registerWsRoute(server, { path, wss })
}

export function closeWsRoutes(server) {
  for (const route of routesFor(server)) {
    try { route.wss.close() } catch {}
  }
}