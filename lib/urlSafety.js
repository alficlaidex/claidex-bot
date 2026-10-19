/**
 * Claide Bot by Alfi
 * Helpers for validating public HTTP(S) destinations before fetching user input.
 */
import dns from 'node:dns/promises'
import net from 'node:net'

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true
  }

  const [a, b] = parts
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase().split('%')[0]
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true
  if (normalized.startsWith('ff')) return true

  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  return mapped ? isPrivateIpv4(mapped) : false
}

export function isPrivateAddress(address) {
  const family = net.isIP(address)
  return family === 4 ? isPrivateIpv4(address) : family === 6 ? isPrivateIpv6(address) : true
}

export async function assertPublicHttpUrl(input, { allowedPorts = [80, 443] } = {}) {
  let url
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(String(input))
  } catch {
    throw new Error('URL tidak valid')
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Hanya URL HTTP/HTTPS yang diizinkan')
  }
  if (url.username || url.password) {
    throw new Error('URL dengan credential tidak diizinkan')
  }

  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  if (!allowedPorts.includes(port)) {
    throw new Error(`Port ${port} tidak diizinkan`)
  }

  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Host lokal tidak diizinkan')
  }

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('Alamat privat tidak diizinkan')
    return url
  }

  let addresses
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new Error('Hostname tidak dapat diresolve')
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Hostname mengarah ke alamat privat')
  }
  return url
}

async function readLimited(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Respons melebihi batas ${maxBytes} byte`)
  }
  if (!response.body) return Buffer.alloc(0)

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new Error(`Respons melebihi batas ${maxBytes} byte`)
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, total)
}

export async function fetchPublicText(input, {
  maxBytes = 2 * 1024 * 1024,
  timeoutMs = 15_000,
  maxRedirects = 3,
  headers = {},
} = {}) {
  let current = await assertPublicHttpUrl(input)
  const signal = AbortSignal.timeout(timeoutMs)

  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const response = await fetch(current, {
      headers,
      redirect: 'manual',
      signal,
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error('Redirect tanpa tujuan')
      current = await assertPublicHttpUrl(new URL(location, current))
      continue
    }

    const body = await readLimited(response, maxBytes)
    return {
      response,
      body,
      text: body.toString('utf8'),
      finalUrl: current.href,
    }
  }

  throw new Error('Terlalu banyak redirect')
}

export async function fetchPublicBuffer(input, options = {}) {
  const result = await fetchPublicText(input, options)
  return { ...result, buffer: result.body }
}
