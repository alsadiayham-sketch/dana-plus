export async function onRequestPost() {
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': 'dana_plus_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' } })
}
