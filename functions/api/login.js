import { createSession, sessionCookie, validCredentials } from './_auth.js'

export async function onRequestPost({ request, env }) {
  if (!env.AUTH_SECRET || !env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    return Response.json({ error: 'Authentication is not configured.' }, { status: 503 })
  }

  let credentials
  try {
    credentials = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 })
  }

  if (typeof credentials?.username !== 'string' || typeof credentials?.password !== 'string' || !(await validCredentials(credentials.username, credentials.password, env))) {
    return Response.json({ error: 'Invalid credentials.' }, { status: 401 })
  }

  return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(await createSession(env)), 'Cache-Control': 'no-store' } })
}
