import { validSession } from './_auth.js'

export async function onRequestGet({ request, env }) {
  if (!(await validSession(request, env))) return Response.json({ authenticated: false }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  return Response.json({ authenticated: true }, { headers: { 'Cache-Control': 'no-store' } })
}
