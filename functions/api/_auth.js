const encoder = new TextEncoder()

function encode(value) {
  return btoa(String.fromCharCode(...new Uint8Array(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function decode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return encode(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
}

function equal(first, second) {
  const a = encoder.encode(first)
  const b = encoder.encode(second)
  let result = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) result |= (a[index % a.length] || 0) ^ (b[index % b.length] || 0)
  return result === 0
}

export async function validCredentials(username, password, env) {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) return false
  return equal(username, env.ADMIN_USERNAME) && equal(password, env.ADMIN_PASSWORD)
}

export async function createSession(env) {
  const payload = encode(encoder.encode(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000 })))
  return `${payload}.${await sign(payload, env.AUTH_SECRET)}`
}

export async function validSession(request, env) {
  if (!env.AUTH_SECRET) return false
  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)dana_plus_session=([^;]+)/)?.[1]
  if (!token) return false
  const [payload, signature] = token.split('.')
  if (!payload || !signature || !equal(signature, await sign(payload, env.AUTH_SECRET))) return false
  try {
    return JSON.parse(new TextDecoder().decode(decode(payload))).exp > Date.now()
  } catch {
    return false
  }
}

export function sessionCookie(token) {
  return `dana_plus_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`
}
