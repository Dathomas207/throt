// Email codes through WorkOS, the switch between the two sign-ins, and account deletion.
// WorkOS is a fake `fetch` passed into createApp. It records every call, so the tests can check
// exactly what would be sent. Nothing here reaches the network.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createDb } from './db.js'
import { createApp } from './app.js'
import { workosConfig, AUTH_LIMITS } from './routesAuth.js'
import { FORMER_MEMBER } from './deleteAccount.js'

const KEY = 'sk_test_FAKEKEYdoNotLeak0123456789', CLIENT = 'client_FAKE0123456789'
const tag = crypto.randomBytes(4).toString('hex')
const mail = (n) => `${n}-${tag}@example.com`
let db, off, on, strict
const clock = { t: Date.now() }
const servers = []
// Everything the server said, and everything it logged, for the leak check at the end.
const said = [], logged = []
const realConsole = { error: console.error, warn: console.warn, log: console.log }

// ---- the fake WorkOS -------------------------------------------------------------------------
const wk = {
  calls: [], users: new Map(), codes: new Map(), issued: [], n: 0,
  mode: 'ok', autoCreate: true, deleteStatus: 204,
  reset() { this.calls.length = 0; this.mode = 'ok'; this.autoCreate = true; this.deleteStatus = 204 },
  code(email) { return this.codes.get(email) },
}
const answer = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
async function fakeFetch(url, init = {}) {
  const body = init.body ? JSON.parse(init.body) : undefined
  wk.calls.push({ url: String(url), method: init.method, headers: { ...init.headers }, body })
  if (wk.mode === 'network') throw new TypeError('fetch failed')
  if (wk.mode === '500') return answer(500, { message: 'Internal error' })
  if (wk.mode === 'badkey') return answer(401, { message: 'Unauthorized' })
  const u = new URL(url), p = u.pathname
  if (init.method === 'POST' && p === '/user_management/magic_auth') {
    if (!wk.users.has(body.email)) {
      if (!wk.autoCreate) return answer(404, { code: 'entity_not_found', message: `User not found: ${body.email}` })
      wk.users.set(body.email, `user_${crypto.randomBytes(8).toString('hex')}`)
    }
    // Codes are easy to spot: 9110 and two more digits. The leak check looks for every one of them.
    const code = `9110${String(10 + (wk.n++ % 90))}`
    wk.codes.set(body.email, code); wk.issued.push(code)
    return answer(201, { object: 'magic_auth', id: 'magic_auth_01', user_id: wk.users.get(body.email), email: body.email, expires_at: new Date(Date.now() + 6e5).toISOString(), code })
  }
  if (init.method === 'POST' && p === '/user_management/users') {
    if (wk.users.has(body.email)) return answer(422, { code: 'user_creation_error', message: 'Email already exists.' })
    wk.users.set(body.email, `user_${crypto.randomBytes(8).toString('hex')}`)
    return answer(201, { object: 'user', id: wk.users.get(body.email), email: body.email })
  }
  if (init.method === 'POST' && p === '/user_management/authenticate') {
    if (wk.mode === 'expired') return answer(400, { error: 'invalid_grant', error_description: 'The code has expired.' })
    if (wk.mode === 'mfa') return answer(403, { code: 'mfa_enrollment', message: 'The user must enroll in MFA to finish authenticating.' })
    if (!wk.codes.has(body.email) || wk.codes.get(body.email) !== body.code) return answer(400, { error: 'invalid_grant', error_description: 'Invalid one-time code.' })
    wk.codes.delete(body.email)
    return answer(200, { user: { object: 'user', id: wk.users.get(body.email), email: body.email, email_verified: true, first_name: null }, access_token: 'WORKOS_ACCESS_TOKEN_never_kept', refresh_token: 'WORKOS_REFRESH_TOKEN_never_kept', authentication_method: 'MagicAuth' })
  }
  if (init.method === 'DELETE' && p.startsWith('/user_management/users/')) {
    if (wk.deleteStatus >= 400) return answer(wk.deleteStatus, { message: 'Could not delete.' })
    const id = decodeURIComponent(p.split('/').pop())
    for (const [e, v] of wk.users) if (v === id) wk.users.delete(e)
    return answer(wk.deleteStatus)
  }
  return answer(404, { message: 'Not found' })
}

async function listen(app) {
  const s = app.listen(0)
  await new Promise((r) => s.once('listening', r))
  servers.push(s)
  return `http://127.0.0.1:${s.address().port}`
}
before(async () => {
  for (const k of Object.keys(realConsole)) console[k] = (...a) => { logged.push(a.map((x) => (x && x.stack) || (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }
  db = await createDb()
  const rate = { sessionMax: 1000, writeMax: 100000, readMax: 100000 }
  const workos = { apiKey: KEY, clientId: CLIENT }
  off = await listen(createApp({ db, workos: false, rate }))
  // Roomy per-address limits, since every test calls from the same address.
  on = await listen(createApp({ db, workos, authFetch: fakeFetch, authNow: () => clock.t, rate: { ...rate, auth: { startPerIp: 1000, verifyPerIp: 1000 } } }))
  // The limits as shipped.
  strict = await listen(createApp({ db, workos, authFetch: fakeFetch, authNow: () => clock.t, rate }))
})
after(async () => {
  Object.assign(console, realConsole)
  for (const s of servers) await new Promise((r) => s.close(r))
  await db.close()
})

async function call(from, method, p, { token, body } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(from + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const txt = await res.text()
  said.push(`${method} ${p} ${res.status} ${JSON.stringify([...res.headers])} ${txt}`)
  let json = null
  try { json = JSON.parse(txt) } catch (e) {}
  return { status: res.status, json, text: txt, headers: res.headers }
}
// Sign in the old way (off) or with a code (on).
const oldSignIn = async (name, n) => { const r = await call(off, 'POST', '/api/session', { body: { name, email: mail(n) } }); assert.ok(r.status === 200 || r.status === 201, r.text); return { token: r.json.token, id: r.json.user.id } }
const codeSignIn = async (name, n, from = on) => {
  const s = await call(from, 'POST', '/api/auth/start', { body: { email: mail(n) } })
  assert.equal(s.status, 200, s.text)
  const r = await call(from, 'POST', '/api/auth/verify', { body: { email: mail(n), code: wk.code(mail(n)), name } })
  assert.ok(r.status === 200 || r.status === 201, r.text)
  return { token: r.json.token, id: r.json.user.id, status: r.status, created: r.json.created }
}
const makeDog = async (from, token, name) => { const r = await call(from, 'POST', '/api/dogs', { token, body: { name, breed: 'Mutt', weight: 30, bio: '' } }); assert.equal(r.status, 201, r.text); return r.json.dog }
const walk = (over = {}) => ({ type: 'Walk', title: 'Morning loop', note: '', place: 'Fresh Pond', miles: 1.5, minutes: 30, sniffs: 2, route: [[42.385, -71.149], [42.386, -71.148], [42.387, -71.147]], ...over })
const addWalk = async (from, token, slug) => { const r = await call(from, 'POST', `/api/dogs/${slug}/walks`, { token, body: walk() }); assert.equal(r.status, 201, r.text); return r.json.walk }
const invite = async (from, ownerToken, slug, role, joinerToken) => {
  const i = await call(from, 'POST', `/api/dogs/${slug}/invites`, { token: ownerToken, body: { role } })
  assert.equal(i.status, 201, i.text)
  const a = await call(from, 'POST', `/api/invites/${i.json.token}/accept`, { token: joinerToken })
  assert.equal(a.status, 200, a.text)
}
const count = async (sql, params) => Number((await db.query(sql, params)).rows[0].n)

// ---- the switch ------------------------------------------------------------------------------
test('the switch needs both values, and the test-only base address is checked', () => {
  assert.equal(workosConfig(undefined, {}).on, false)
  assert.equal(workosConfig(undefined, { WORKOS_API_KEY: 'k' }).on, false)
  assert.equal(workosConfig(undefined, { WORKOS_CLIENT_ID: 'c' }).on, false)
  const c = workosConfig(undefined, { WORKOS_API_KEY: ' k ', WORKOS_CLIENT_ID: 'c' })
  assert.deepEqual(c, { on: true, apiKey: 'k', clientId: 'c', apiBase: 'https://api.workos.com' })
  assert.equal(workosConfig(undefined, { WORKOS_API_KEY: 'k', WORKOS_CLIENT_ID: 'c', WORKOS_API_BASE: 'http://127.0.0.1:4631/' }).apiBase, 'http://127.0.0.1:4631')
  // A plain http address anywhere else would send the key in the clear, so it is ignored.
  assert.equal(workosConfig(undefined, { WORKOS_API_KEY: 'k', WORKOS_CLIENT_ID: 'c', WORKOS_API_BASE: 'http://evil.example' }).apiBase, 'https://api.workos.com')
  assert.equal(workosConfig(false, { WORKOS_API_KEY: 'k', WORKOS_CLIENT_ID: 'c' }).on, false)
})

test('switch off: sign-in works as before, the code routes answer 404 and WorkOS is never called', async () => {
  wk.reset()
  assert.deepEqual((await call(off, 'GET', '/api/auth/config')).json, { emailCodes: false })
  const a = await call(off, 'POST', '/api/session', { body: { name: 'Olive Off', email: mail('olive') } })
  assert.equal(a.status, 201)
  assert.equal(a.json.created, true)
  const again = await call(off, 'POST', '/api/session', { body: { name: 'Olive Off', email: mail('olive') } })
  assert.equal(again.status, 200)
  assert.equal(again.json.user.id, a.json.user.id)
  const me = await call(off, 'GET', '/api/me', { token: a.json.token })
  assert.equal(me.status, 200)
  assert.equal(me.json.user.email, mail('olive'))
  for (const [p, body] of [['/api/auth/start', { email: mail('olive') }], ['/api/auth/verify', { email: mail('olive'), code: '123456' }], ['/api/auth/complete', { ticket: 'x'.repeat(30), name: 'Olive' }]]) {
    const r = await call(off, 'POST', p, { body })
    assert.equal(r.status, 404, p)
    assert.equal(r.json.code, 'email_codes_off')
  }
  assert.equal(wk.calls.length, 0)
  assert.equal(await count('SELECT COUNT(*) AS n FROM sessions WHERE verified = TRUE AND user_id = $1', [a.json.user.id]), 0)
})

// ---- asking for a code -----------------------------------------------------------------------
test('switch on: the config says so and gives nothing else away', async () => {
  const r = await call(on, 'GET', '/api/auth/config')
  assert.deepEqual(r.json, { emailCodes: true })
  const c = await call(on, 'GET', '/api/config')
  assert.ok(!/workos|sk_test|client_/i.test(c.text))
})

test('start sends exactly one request to WorkOS and answers the same for a known and an unknown email', async () => {
  wk.reset()
  await oldSignIn('Known Kim', 'kim')
  const known = await call(on, 'POST', '/api/auth/start', { body: { email: `  ${mail('kim').toUpperCase()} ` } })
  const unknown = await call(on, 'POST', '/api/auth/start', { body: { email: mail('nobody') } })
  assert.equal(known.status, 200)
  assert.equal(unknown.status, 200)
  assert.equal(known.text, '{"ok":true}')
  assert.equal(unknown.text, known.text)
  assert.equal(wk.calls.length, 2)
  assert.deepEqual(wk.calls[0], {
    url: 'https://api.workos.com/user_management/magic_auth', method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: { email: mail('kim') },
  })
  assert.deepEqual(wk.calls[1].body, { email: mail('nobody') })
  // Asking for a code makes no Trot account.
  assert.equal(await count('SELECT COUNT(*) AS n FROM users WHERE email = $1', [mail('nobody')]), 0)
})

test('start refuses a bad email and a demo address without calling WorkOS', async () => {
  wk.reset()
  assert.equal((await call(on, 'POST', '/api/auth/start', { body: { email: 'not an email' } })).status, 400)
  assert.equal((await call(on, 'POST', '/api/auth/start', { body: {} })).status, 400)
  assert.equal((await call(on, 'POST', '/api/auth/start', { body: { email: 'pat@example.invalid' } })).status, 403)
  assert.equal((await call(on, 'POST', '/api/auth/start', { body: { email: FORMER_MEMBER.email } })).status, 403)
  assert.equal(wk.calls.length, 0)
})

test('start makes the WorkOS user and asks once more when WorkOS says there is no such user', async () => {
  wk.reset(); wk.autoCreate = false
  const r = await call(on, 'POST', '/api/auth/start', { body: { email: mail('fresh') } })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(wk.calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.workos.com/user_management/magic_auth',
    'POST https://api.workos.com/user_management/users',
    'POST https://api.workos.com/user_management/magic_auth',
  ])
  assert.deepEqual(wk.calls[1].body, { email: mail('fresh') })
  assert.equal(wk.calls[1].headers.Authorization, `Bearer ${KEY}`)
  assert.ok(wk.code(mail('fresh')))
})

test('start is limited per email, with Retry-After, and the limit lifts when the window ends', async () => {
  wk.reset()
  for (let i = 0; i < AUTH_LIMITS.startPerEmail; i++) assert.equal((await call(on, 'POST', '/api/auth/start', { body: { email: mail('eager') } })).status, 200)
  const r = await call(on, 'POST', '/api/auth/start', { body: { email: mail('eager') } })
  assert.equal(r.status, 429)
  assert.equal(r.json.code, 'slow_down')
  const wait = Number(r.headers.get('retry-after'))
  assert.ok(wait > 0 && wait <= 900, String(wait))
  assert.equal(wk.calls.length, AUTH_LIMITS.startPerEmail, 'the refused request never reached WorkOS')
  // Someone else is not held up by it.
  assert.equal((await call(on, 'POST', '/api/auth/start', { body: { email: mail('patient') } })).status, 200)
  clock.t += AUTH_LIMITS.windowMs + 1000
  assert.equal((await call(on, 'POST', '/api/auth/start', { body: { email: mail('eager') } })).status, 200)
})

test('start is limited per address', async () => {
  wk.reset()
  clock.t += AUTH_LIMITS.windowMs + 1000
  for (let i = 0; i < AUTH_LIMITS.startPerIp; i++) assert.equal((await call(strict, 'POST', '/api/auth/start', { body: { email: mail('ip' + i) } })).status, 200)
  const r = await call(strict, 'POST', '/api/auth/start', { body: { email: mail('ip-last') } })
  assert.equal(r.status, 429)
  assert.ok(Number(r.headers.get('retry-after')) > 0)
  assert.equal(wk.calls.length, AUTH_LIMITS.startPerIp)
})

test('when WorkOS is down, unreachable or refuses the key, start says sign-in is unavailable and nothing more', async () => {
  for (const mode of ['500', 'network', 'badkey']) {
    wk.reset(); wk.mode = mode
    const r = await call(on, 'POST', '/api/auth/start', { body: { email: mail('down-' + mode) } })
    assert.equal(r.status, 503, mode)
    assert.deepEqual(r.json, { error: 'Sign-in is unavailable right now. Try again in a few minutes.', code: 'auth_unavailable' })
  }
  wk.reset()
})

// ---- checking a code -------------------------------------------------------------------------
test('verify with a name makes a new account, a verified session, and sends WorkOS exactly the documented body', async () => {
  wk.reset()
  await call(on, 'POST', '/api/auth/start', { body: { email: mail('nova') } })
  const code = wk.code(mail('nova'))
  const r = await call(on, 'POST', '/api/auth/verify', { body: { email: ` ${mail('nova').toUpperCase()}`, code: ` ${code.slice(0, 3)} ${code.slice(3)} `, name: '  Nova   New ' } })
  assert.equal(r.status, 201, r.text)
  assert.equal(r.json.created, true)
  assert.deepEqual(Object.keys(r.json).sort(), ['created', 'token', 'user'])
  assert.deepEqual(r.json.user, { id: r.json.user.id, name: 'Nova New', email: mail('nova'), isAdmin: false })
  assert.deepEqual(wk.calls[1], {
    url: 'https://api.workos.com/user_management/authenticate', method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: { client_id: CLIENT, client_secret: KEY, grant_type: 'urn:workos:oauth:grant-type:magic-auth:code', code, email: mail('nova') },
  })
  const me = await call(on, 'GET', '/api/me', { token: r.json.token })
  assert.equal(me.status, 200)
  const u = (await db.query('SELECT workos_id FROM users WHERE id = $1', [r.json.user.id])).rows[0]
  assert.equal(u.workos_id, wk.users.get(mail('nova')))
  const s = (await db.query('SELECT token_hash, verified FROM sessions WHERE user_id = $1', [r.json.user.id])).rows
  assert.equal(s.length, 1)
  assert.equal(s[0].verified, true)
  assert.equal(s[0].token_hash, crypto.createHash('sha256').update(r.json.token).digest('hex'), 'only a hash of the token is stored')
  // The code is spent.
  const again = await call(on, 'POST', '/api/auth/verify', { body: { email: mail('nova'), code, name: 'Nova' } })
  assert.equal(again.status, 400)
  assert.equal(again.json.code, 'bad_code')
})

test('verify for an email that already has an account signs into that account with everything intact', async () => {
  wk.reset()
  const old = await oldSignIn('Erin Existing', 'erin')
  const dog = await makeDog(off, old.token, `Echo ${tag}`)
  const w = await addWalk(off, old.token, dog.slug)
  const route = await call(off, 'POST', '/api/routes', { token: old.token, body: { name: 'Pond loop', points: [[42.385, -71.149], [42.386, -71.148], [42.387, -71.147]] } })
  assert.equal(route.status, 201, route.text)
  // No name is needed, and a name that is sent does not rename the account.
  const s = await codeSignIn('Somebody Else', 'erin')
  assert.equal(s.status, 200)
  assert.equal(s.created, false)
  assert.equal(s.id, old.id)
  const me = await call(on, 'GET', '/api/me', { token: s.token })
  assert.equal(me.json.user.name, 'Erin Existing')
  assert.deepEqual(me.json.dogs.map((d) => d.slug), [dog.slug])
  assert.equal((await call(on, 'GET', `/api/walks/${w.id}`, { token: s.token })).status, 200)
  assert.equal((await call(on, 'GET', '/api/routes', { token: s.token })).json.routes.length, 1)
  assert.equal((await db.query('SELECT workos_id FROM users WHERE id = $1', [old.id])).rows[0].workos_id, wk.users.get(mail('erin')))
  assert.equal(await count('SELECT COUNT(*) AS n FROM users WHERE email = $1', [mail('erin')]), 1)
})

test('verify without a name for a new email hands back a ticket, and the ticket works once', async () => {
  wk.reset()
  await call(on, 'POST', '/api/auth/start', { body: { email: mail('tess') } })
  const v = await call(on, 'POST', '/api/auth/verify', { body: { email: mail('tess'), code: wk.code(mail('tess')) } })
  assert.equal(v.status, 200, v.text)
  assert.deepEqual(Object.keys(v.json).sort(), ['needName', 'ticket'])
  assert.equal(await count('SELECT COUNT(*) AS n FROM users WHERE email = $1', [mail('tess')]), 0)
  assert.equal((await call(on, 'POST', '/api/auth/complete', { body: { ticket: v.json.ticket, name: '' } })).status, 400, 'a missing name does not use the ticket up')
  const c = await call(on, 'POST', '/api/auth/complete', { body: { ticket: v.json.ticket, name: 'Tess Ticket' } })
  assert.equal(c.status, 201, c.text)
  assert.equal(c.json.user.email, mail('tess'))
  assert.equal((await call(on, 'GET', '/api/me', { token: c.json.token })).status, 200)
  assert.equal((await db.query('SELECT workos_id FROM users WHERE id = $1', [c.json.user.id])).rows[0].workos_id, wk.users.get(mail('tess')))
  const twice = await call(on, 'POST', '/api/auth/complete', { body: { ticket: v.json.ticket, name: 'Tess Again' } })
  assert.equal(twice.status, 400)
  assert.equal(twice.json.code, 'ticket_expired')
  // A made-up ticket, and one that has waited too long.
  assert.equal((await call(on, 'POST', '/api/auth/complete', { body: { ticket: crypto.randomBytes(32).toString('base64url'), name: 'Mallory' } })).status, 400)
  await call(on, 'POST', '/api/auth/start', { body: { email: mail('slow') } })
  const late = await call(on, 'POST', '/api/auth/verify', { body: { email: mail('slow'), code: wk.code(mail('slow')) } })
  clock.t += AUTH_LIMITS.ticketMs + 1000
  assert.equal((await call(on, 'POST', '/api/auth/complete', { body: { ticket: late.json.ticket, name: 'Slow Sam' } })).status, 400)
  assert.equal(await count('SELECT COUNT(*) AS n FROM users WHERE email = $1', [mail('slow')]), 0)
})

test('a wrong code, an expired code and a code for another email are all refused, with no session', async () => {
  wk.reset()
  await call(on, 'POST', '/api/auth/start', { body: { email: mail('wanda') } })
  await call(on, 'POST', '/api/auth/start', { body: { email: mail('other') } })
  const before = await count('SELECT COUNT(*) AS n FROM sessions')
  const wrong = await call(on, 'POST', '/api/auth/verify', { body: { email: mail('wanda'), code: '000000', name: 'Wanda' } })
  assert.equal(wrong.status, 400)
  assert.deepEqual(wrong.json, { error: 'That code is wrong or has expired. Check it, or ask for a new one.', code: 'bad_code' })
  const swapped = await call(on, 'POST', '/api/auth/verify', { body: { email: mail('wanda'), code: wk.code(mail('other')), name: 'Wanda' } })
  assert.equal(swapped.status, 400)
  wk.mode = 'expired'
  const expired = await call(on, 'POST', '/api/auth/verify', { body: { email: mail('wanda'), code: wk.code(mail('wanda')), name: 'Wanda' } })
  assert.equal(expired.status, 400)
  assert.equal(expired.json.error, 'That code has expired. Ask for a new one.')
  wk.mode = 'ok'
  // Codes that are not 6 digits never reach WorkOS.
  const n = wk.calls.length
  for (const code of ['12345', '1234567', 'abcdef', '', null, 123456]) assert.equal((await call(on, 'POST', '/api/auth/verify', { body: { email: mail('wanda'), code, name: 'Wanda' } })).status, 400)
  assert.equal(wk.calls.length, n)
  assert.equal(await count('SELECT COUNT(*) AS n FROM sessions'), before)
  assert.equal(await count('SELECT COUNT(*) AS n FROM users WHERE email = $1', [mail('wanda')]), 0)
})

test('verify stops after 8 tries per email, even with the right code, until the window ends', async () => {
  wk.reset()
  await call(on, 'POST', '/api/auth/start', { body: { email: mail('guess') } })
  for (let i = 0; i < AUTH_LIMITS.verifyPerEmail; i++) assert.equal((await call(on, 'POST', '/api/auth/verify', { body: { email: mail('guess'), code: '000000', name: 'G' } })).status, 400)
  const calls = wk.calls.length
  const r = await call(on, 'POST', '/api/auth/verify', { body: { email: mail('guess'), code: wk.code(mail('guess')), name: 'G' } })
  assert.equal(r.status, 429)
  assert.ok(Number(r.headers.get('retry-after')) > 0)
  assert.equal(wk.calls.length, calls, 'the refused try never reached WorkOS')
  clock.t += AUTH_LIMITS.windowMs + 1000
  assert.equal((await call(on, 'POST', '/api/auth/verify', { body: { email: mail('guess'), code: wk.code(mail('guess')), name: 'Gus Guess' } })).status, 201)
})

test('when WorkOS is down or wants a step Trot has no screen for, verify says sign-in is unavailable', async () => {
  wk.reset()
  await call(on, 'POST', '/api/auth/start', { body: { email: mail('vera') } })
  for (const mode of ['500', 'network', 'mfa']) {
    wk.mode = mode
    const r = await call(on, 'POST', '/api/auth/verify', { body: { email: mail('vera'), code: wk.code(mail('vera')), name: 'Vera' } })
    assert.equal(r.status, 503, mode)
    assert.equal(r.json.code, 'auth_unavailable')
  }
  wk.reset()
  assert.equal(await count('SELECT COUNT(*) AS n FROM users WHERE email = $1', [mail('vera')]), 0)
})

// ---- the old ways in are closed --------------------------------------------------------------
test('switch on: the old sign-in refuses, for a new email and for an existing one', async () => {
  wk.reset()
  await oldSignIn('Victor Victim', 'victor')
  const before = await count('SELECT COUNT(*) AS n FROM sessions')
  for (const n of ['victor', 'brand-new']) {
    const r = await call(on, 'POST', '/api/session', { body: { name: 'Mallory', email: mail(n) } })
    assert.equal(r.status, 403)
    assert.equal(r.json.code, 'email_code_required')
    assert.ok(!r.json.token)
  }
  assert.equal(await count('SELECT COUNT(*) AS n FROM sessions'), before)
  assert.equal(await count('SELECT COUNT(*) AS n FROM users WHERE email = $1', [mail('brand-new')]), 0)
  assert.equal(wk.calls.length, 0)
})

test('a session made without a code works while the switch is off and is refused everywhere once it is on', async () => {
  wk.reset()
  const old = await oldSignIn('Uma Unverified', 'uma')
  const dog = await makeDog(off, old.token, `Umber ${tag}`)
  const w = await addWalk(off, old.token, dog.slug)
  assert.equal((await call(off, 'GET', '/api/me', { token: old.token })).status, 200)
  const refused = [
    ['GET', '/api/me'], ['PATCH', '/api/me', { name: 'Mallory' }], ['GET', `/api/dogs/${dog.slug}`], ['GET', '/api/feed'], ['GET', `/api/walks/${w.id}`],
    ['GET', '/api/live/friends'], ['GET', '/api/routes'], ['GET', '/api/notifications'], ['POST', `/api/dogs/${dog.slug}/walks`, walk()], ['POST', `/api/dogs/${dog.slug}/invites`, {}],
    ['POST', `/api/dogs/${dog.slug}/documents`, { name: 'x', category: 'other', file: 'data:application/pdf;base64,AAAA' }], ['POST', `/api/walks/${w.id}/photos`, { photo: 'data:image/jpeg;base64,AAAA' }],
    ['POST', '/api/me/delete', { email: mail('uma') }], ['DELETE', '/api/session'],
  ]
  for (const [method, p, body] of refused) {
    const r = await call(on, method, p, { token: old.token, body })
    assert.equal(r.status, 401, `${method} ${p}`)
    assert.deepEqual(r.json, { error: 'Sign-in got more secure. Enter your email to get a code.', code: 'verify_required' }, `${method} ${p}`)
  }
  assert.equal((await db.query('SELECT name FROM users WHERE id = $1', [old.id])).rows[0].name, 'Uma Unverified')
  // A token nobody ever issued gets the plain answer.
  const none = await call(on, 'GET', '/api/me', { token: crypto.randomBytes(32).toString('base64url') })
  assert.equal(none.status, 401)
  assert.equal(none.json.code, undefined)
  // Places where a session is optional treat the old one as signed out.
  const usageBefore = await count('SELECT COUNT(*) AS n FROM usage_events WHERE user_id = $1', [old.id])
  await call(on, 'POST', '/api/usage', { token: old.token, body: { events: [{ name: 'app_open', props: { mode: 'signed_in' } }] } })
  assert.equal(await count('SELECT COUNT(*) AS n FROM usage_events WHERE user_id = $1', [old.id]), usageBefore)
  // The same person signs in with a code and has everything. The old token still does nothing.
  const s = await codeSignIn('', 'uma')
  assert.equal(s.id, old.id)
  assert.deepEqual((await call(on, 'GET', '/api/me', { token: s.token })).json.dogs.map((d) => d.slug), [dog.slug])
  assert.equal((await call(on, 'GET', '/api/me', { token: old.token })).status, 401)
  // Turned off again, both tokens work, as before.
  assert.equal((await call(off, 'GET', '/api/me', { token: old.token })).status, 200)
  assert.equal((await call(off, 'GET', '/api/me', { token: s.token })).status, 200)
})

test('switch on: invites, friend links and the public pages give nobody a session', async () => {
  wk.reset()
  const owner = await codeSignIn('Ina Inviter', 'ina')
  const dog = await makeDog(on, owner.token, `Indy ${tag}`)
  const inv = await call(on, 'POST', `/api/dogs/${dog.slug}/invites`, { token: owner.token, body: { role: 'walker' } })
  assert.equal(inv.status, 201)
  // Reading an invite needs no sign-in and gives the dog's name and role only.
  const look = await call(on, 'GET', `/api/invites/${inv.json.token}`)
  assert.deepEqual(look.json, { dogName: dog.name, role: 'walker', open: true })
  // Accepting needs a verified session: none, and an old unverified one, are both refused.
  assert.equal((await call(on, 'POST', `/api/invites/${inv.json.token}/accept`)).status, 401)
  const old = await oldSignIn('Wes Walker', 'wes')
  const stale = await call(on, 'POST', `/api/invites/${inv.json.token}/accept`, { token: old.token })
  assert.equal(stale.status, 401)
  assert.equal(stale.json.code, 'verify_required')
  assert.equal(await count('SELECT COUNT(*) AS n FROM memberships WHERE dog_id = (SELECT id FROM dogs WHERE slug = $1)', [dog.slug]), 1)
  // With a code, the same person joins.
  const wes = await codeSignIn('', 'wes')
  assert.equal((await call(on, 'POST', `/api/invites/${inv.json.token}/accept`, { token: wes.token })).status, 200)
  // The friend link and the public page are read-only and carry no token.
  const page = await fetch(`${on}/d/${dog.slug}?add=1`)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.ok(html.includes(`/?friend=${dog.slug}`))
  assert.equal((await call(on, 'PUT', `/api/dogs/${dog.slug}/friends/${dog.slug}`, { body: {} })).status, 401)
  assert.equal((await call(on, 'GET', `/api/public/dogs/${dog.slug}`)).status, 200)
})

// ---- account deletion ------------------------------------------------------------------------
test('switch off: deleting needs the account email typed, and only ever deletes the caller', async () => {
  wk.reset()
  const a = await oldSignIn('Ada Leaving', 'ada')
  const b = await oldSignIn('Ben Staying', 'ben')
  const bDog = await makeDog(off, b.token, `Benji ${tag}`)
  const bWalk = await addWalk(off, b.token, bDog.slug)
  assert.equal((await call(off, 'POST', '/api/me/delete', { body: { email: mail('ada') } })).status, 401, 'signed out')
  for (const body of [{}, { email: '' }, { email: mail('ben') }, { email: mail('ada') + 'x' }, { code: '123456' }, { email: 42 }]) {
    const r = await call(off, 'POST', '/api/me/delete', { token: a.token, body })
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.equal(r.json.code, 'email_mismatch')
  }
  // Ben typing Ada's email, with Ben's session, deletes nobody.
  assert.equal((await call(off, 'POST', '/api/me/delete', { token: b.token, body: { email: mail('ada') } })).status, 400)
  assert.equal(await count('SELECT COUNT(*) AS n FROM users WHERE id IN ($1, $2)', [a.id, b.id]), 2)
  const r = await call(off, 'POST', '/api/me/delete', { token: a.token, body: { email: `  ${mail('ada').toUpperCase()} ` } })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.json, { ok: true, dogsDeleted: 0, dogsKept: 0, dogsHandedOn: 0 })
  assert.equal(await count('SELECT COUNT(*) AS n FROM users WHERE id = $1', [a.id]), 0)
  assert.equal((await call(off, 'GET', '/api/me', { token: a.token })).status, 401)
  // Ben is untouched.
  assert.equal((await call(off, 'GET', '/api/me', { token: b.token })).json.dogs.length, 1)
  assert.equal((await call(off, 'GET', `/api/walks/${bWalk.id}`, { token: b.token })).status, 200)
  assert.equal(wk.calls.length, 0)
  // The address is free again and starts from nothing.
  const fresh = await oldSignIn('Ada Again', 'ada')
  assert.notEqual(fresh.id, a.id)
  assert.deepEqual((await call(off, 'GET', '/api/me', { token: fresh.token })).json.dogs, [])
})

test('deleting an account: a dog of their own goes with everything on it, shared dogs stay, and what is only theirs goes', async () => {
  wk.reset()
  const del = await oldSignIn('Dana Deleting', 'dana')
  const co = await oldSignIn('Cole Coowner', 'cole')
  const fam = await oldSignIn('Fay Family', 'fay')
  const wkr = await oldSignIn('Will Walker', 'will')
  const other = await oldSignIn('Otis Other', 'otis')
  const id = async (slug) => (await db.query('SELECT id FROM dogs WHERE slug = $1', [slug])).rows[0].id

  // 1. Dana is the only owner, with a walker on the team: the dog is deleted.
  const solo = await makeDog(off, del.token, `Solo ${tag}`)
  await invite(off, del.token, solo.slug, 'walker', wkr.token)
  const soloWalk = await addWalk(off, del.token, solo.slug)
  const walkerWalk = await addWalk(off, wkr.token, solo.slug)
  await call(off, 'POST', `/api/walks/${soloWalk.id}/paw`, { token: wkr.token })
  // The walker saved a route from their walk with Solo. The route is theirs and stays.
  const kept = await call(off, 'POST', `/api/walks/${walkerWalk.id}/route`, { token: wkr.token, body: { favorite: true } })
  assert.ok(kept.status === 200 || kept.status === 201, kept.text)
  // 2. Dana is the only owner, with a family member: the dog stays and the family member becomes owner.
  const heirloom = await makeDog(off, del.token, `Heirloom ${tag}`)
  await invite(off, del.token, heirloom.slug, 'family', fam.token)
  await invite(off, del.token, heirloom.slug, 'walker', wkr.token)
  const danaOnHeirloom = await addWalk(off, del.token, heirloom.slug)
  const health = await call(off, 'POST', `/api/dogs/${heirloom.slug}/health`, { token: del.token, body: { kind: 'weight', value: 30, unit: 'lb', occurredOn: '2026-01-05' } })
  assert.equal(health.status, 201, health.text)
  const vet = await call(off, 'POST', `/api/dogs/${heirloom.slug}/health/shares`, { token: del.token, body: {} })
  assert.equal(vet.status, 201, vet.text)
  await call(off, 'POST', `/api/dogs/${heirloom.slug}/invites`, { token: del.token, body: { role: 'walker' } })
  // 3. Dana is on Cole's dog as family: the dog stays, Dana leaves the team.
  const coles = await makeDog(off, co.token, `Comet ${tag}`)
  await invite(off, co.token, coles.slug, 'family', del.token)
  const danaOnComet = await addWalk(off, del.token, coles.slug)
  await call(off, 'POST', `/api/walks/${danaOnComet.id}/paw`, { token: co.token })
  // 4. Otis has nothing to do with Dana, apart from being followed by Solo and pawed by nobody.
  const otisDog = await makeDog(off, other.token, `Onyx ${tag}`)
  const otisWalk = await addWalk(off, other.token, otisDog.slug)
  assert.equal((await call(off, 'PUT', `/api/dogs/${solo.slug}/friends/${otisDog.slug}`, { token: del.token, body: {} })).status, 200)
  assert.equal((await call(off, 'PUT', `/api/dogs/${otisDog.slug}/friends/${solo.slug}`, { token: other.token, body: {} })).status, 200)
  // Things that are only Dana's.
  const route = await call(off, 'POST', '/api/routes', { token: del.token, body: { name: 'Dana loop', points: [[42.385, -71.149], [42.386, -71.148], [42.387, -71.147]] } })
  assert.equal(route.status, 201)
  const place = await call(off, 'POST', '/api/places', { token: del.token, body: { name: `Dana's bar ${tag}`, category: 'bar', lat: 42.4, lng: -71.1, note: '' } })
  assert.equal(place.status, 201, place.text)
  const shared = await call(off, 'POST', '/api/places', { token: del.token, body: { name: `Shared park ${tag}`, category: 'park', lat: 42.41, lng: -71.11, note: '' } })
  assert.equal(shared.status, 201, shared.text)
  assert.equal((await call(off, 'POST', `/api/places/${shared.json.place.id}/confirm`, { token: other.token, body: {} })).status, 200)
  await call(off, 'POST', '/api/usage', { token: del.token, body: { events: [{ name: 'app_open', props: { mode: 'signed_in' } }] } })
  await call(off, 'PUT', '/api/live/settings', { token: del.token, body: { shareByDefault: true } })
  const [soloId, heirloomId, cometId, onyxId] = [await id(solo.slug), await id(heirloom.slug), await id(coles.slug), await id(otisDog.slug)]
  assert.ok(await count('SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1', [del.id]) > 0)
  assert.ok(await count('SELECT COUNT(*) AS n FROM usage_events WHERE user_id = $1', [del.id]) > 0)

  const r = await call(off, 'POST', '/api/me/delete', { token: del.token, body: { email: mail('dana') } })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.json, { ok: true, dogsDeleted: 1, dogsKept: 2, dogsHandedOn: 1 })

  // The account and everything keyed to it.
  assert.equal(await count('SELECT COUNT(*) AS n FROM users WHERE id = $1', [del.id]), 0)
  for (const [table, column] of [['sessions', 'user_id'], ['memberships', 'user_id'], ['notifications', 'user_id'], ['notification_prefs', 'user_id'], ['routes', 'user_id'], ['live_walks', 'user_id'], ['paws', 'user_id'], ['place_confirms', 'user_id'], ['place_claims', 'user_id'], ['place_reports', 'user_id'], ['usage_events', 'user_id'],
    ['walks', 'user_id'], ['walk_photos', 'added_by'], ['health_entries', 'created_by'], ['health_shares', 'created_by'], ['documents', 'uploaded_by'], ['awards', 'created_by'], ['dog_tags', 'created_by'], ['dog_follows', 'created_by'], ['training_sessions', 'user_id'], ['dogs', 'created_by'], ['invites', 'created_by'], ['invites', 'used_by'], ['events', 'created_by'], ['places', 'created_by'], ['places', 'managed_by'], ['dog_registrations', 'updated_by'], ['training_progress', 'passed_by']]) {
    assert.equal(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = $1`, [del.id]), 0, `${table}.${column}`)
  }
  assert.equal((await call(off, 'GET', '/api/me', { token: del.token })).status, 401)

  // 1. Solo is gone, with its walks (the walker's too), paws, follows and team.
  assert.equal(await count('SELECT COUNT(*) AS n FROM dogs WHERE id = $1', [soloId]), 0)
  for (const table of ['walks', 'memberships', 'invites', 'dog_tags', 'dog_registrations', 'health_entries', 'documents', 'awards']) assert.equal(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE dog_id = $1`, [soloId]), 0, table)
  assert.equal(await count('SELECT COUNT(*) AS n FROM paws WHERE walk_id IN ($1, $2)', [soloWalk.id, walkerWalk.id]), 0)
  assert.equal(await count('SELECT COUNT(*) AS n FROM dog_follows WHERE follower_dog_id = $1 OR followed_dog_id = $1', [soloId]), 0)
  assert.equal((await call(off, 'GET', `/d/${solo.slug}`)).status, 404)
  assert.equal((await call(off, 'GET', `/api/dogs/${solo.slug}`, { token: wkr.token })).status, 404)
  // The walker's own saved route survives, no longer tied to the dog or the walk that are gone.
  const wr = (await db.query('SELECT dog_id, source_walk_id, usual FROM routes WHERE user_id = $1', [wkr.id])).rows
  assert.equal(wr.length, 1)
  assert.deepEqual([wr[0].dog_id, wr[0].source_walk_id, wr[0].usual], [null, null, false])
  assert.equal((await call(off, 'GET', '/api/routes', { token: wkr.token })).status, 200)

  // 2. Heirloom stays, Fay is now the owner, the walker is still a walker.
  const team = (await call(off, 'GET', `/api/dogs/${heirloom.slug}`, { token: fam.token })).json
  assert.equal(team.dog.role, 'owner')
  assert.deepEqual(team.team.map((m) => [m.name, m.role]).sort(), [['Fay Family', 'owner'], ['Will Walker', 'walker']])
  // Dana's walk is still in the dog's history, under the placeholder's name.
  const hw = (await call(off, 'GET', `/api/walks/${danaOnHeirloom.id}`, { token: fam.token })).json.walk
  assert.deepEqual(hw.by, { id: FORMER_MEMBER.id, name: 'Former member', you: false })
  assert.equal(await count('SELECT COUNT(*) AS n FROM health_entries WHERE dog_id = $1 AND created_by = $2', [heirloomId, FORMER_MEMBER.id]), 1)
  assert.equal((await db.query('SELECT created_by FROM dogs WHERE id = $1', [heirloomId])).rows[0].created_by, FORMER_MEMBER.id)
  // The vet link Dana made no longer opens, and the unused invite is gone.
  assert.equal((await fetch(`${off}${new URL(vet.json.url || `http://x/vet/${vet.json.token}`).pathname}`)).status, 404)
  assert.equal(await count('SELECT COUNT(*) AS n FROM invites WHERE dog_id = $1 AND used_by IS NULL', [heirloomId]), 0)
  // The new owner can do owner things.
  assert.equal((await call(off, 'PATCH', `/api/dogs/${heirloom.slug}`, { token: fam.token, body: { bio: 'Now with Fay.' } })).status, 200)

  // 3. Comet stays with Cole, without Dana on the team. Cole's paw on the kept walk stays.
  const comet = (await call(off, 'GET', `/api/dogs/${coles.slug}`, { token: co.token })).json
  assert.deepEqual(comet.team.map((m) => m.name), ['Cole Coowner'])
  assert.equal(comet.walks.find((w) => w.id === danaOnComet.id).by.name, 'Former member')
  assert.equal(comet.walks.find((w) => w.id === danaOnComet.id).paws, 1)
  assert.equal(await count('SELECT COUNT(*) AS n FROM memberships WHERE dog_id = $1', [cometId]), 1)

  // 4. Otis, his dog and his walk are as they were.
  const onyx = (await call(off, 'GET', `/api/dogs/${otisDog.slug}`, { token: other.token })).json
  assert.equal(onyx.walks[0].id, otisWalk.id)
  assert.equal(await count('SELECT COUNT(*) AS n FROM memberships WHERE dog_id = $1', [onyxId]), 1)
  assert.equal((await call(off, 'GET', `/api/dogs/${otisDog.slug}/friends`, { token: other.token })).json.friends.length, 0)

  // Places: the one nobody else confirmed is gone, the one Otis confirmed stays with no adder.
  assert.equal(await count('SELECT COUNT(*) AS n FROM places WHERE id = $1', [place.json.place.id]), 0)
  assert.deepEqual((await db.query('SELECT created_by FROM places WHERE id = $1', [shared.json.place.id])).rows, [{ created_by: null }])

  // The placeholder cannot be signed into, by either sign-in.
  assert.equal((await call(off, 'POST', '/api/session', { body: { name: 'Mallory', email: FORMER_MEMBER.email } })).status, 403)
  assert.equal((await call(on, 'POST', '/api/auth/verify', { body: { email: FORMER_MEMBER.email, code: '123456' } })).status, 403)
})

test('a dog with a second owner stays with that owner', async () => {
  const a = await oldSignIn('Abe Owner', 'abe')
  const b = await oldSignIn('Bea Owner', 'bea')
  const dog = await makeDog(off, a.token, `Duo ${tag}`)
  await invite(off, a.token, dog.slug, 'family', b.token)
  // There is no route that makes a second owner, so the test writes the row the way a hand edit would.
  await db.query("UPDATE memberships SET role = 'owner' WHERE user_id = $1", [b.id])
  const r = await call(off, 'POST', '/api/me/delete', { token: a.token, body: { email: mail('abe') } })
  assert.deepEqual(r.json, { ok: true, dogsDeleted: 0, dogsKept: 1, dogsHandedOn: 0 })
  const d = (await call(off, 'GET', `/api/dogs/${dog.slug}`, { token: b.token })).json
  assert.deepEqual(d.team.map((m) => [m.name, m.role]), [['Bea Owner', 'owner']])
})

test('switch on: deleting needs a fresh code, and the WorkOS user is deleted too', async () => {
  wk.reset()
  const u = await codeSignIn('Zoe Zapped', 'zoe')
  const dog = await makeDog(on, u.token, `Zed ${tag}`)
  const wid = wk.users.get(mail('zoe'))
  // Typing the email is not enough once codes are on.
  for (const body of [{}, { email: mail('zoe') }, { code: '12' }]) {
    const r = await call(on, 'POST', '/api/me/delete', { token: u.token, body })
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.equal(r.json.code, 'bad_code')
  }
  const wrong = await call(on, 'POST', '/api/me/delete', { token: u.token, body: { code: '000000' } })
  assert.equal(wrong.status, 400)
  assert.equal(await count('SELECT COUNT(*) AS n FROM users WHERE id = $1', [u.id]), 1)
  // A code sent to someone else does not delete this account.
  await call(on, 'POST', '/api/auth/start', { body: { email: mail('zach') } })
  assert.equal((await call(on, 'POST', '/api/me/delete', { token: u.token, body: { code: wk.code(mail('zach')) } })).status, 400)
  // WorkOS down: nothing is deleted.
  await call(on, 'POST', '/api/auth/start', { body: { email: mail('zoe') } })
  wk.mode = '500'
  assert.equal((await call(on, 'POST', '/api/me/delete', { token: u.token, body: { code: wk.code(mail('zoe')) } })).status, 503)
  wk.mode = 'ok'
  assert.equal(await count('SELECT COUNT(*) AS n FROM users WHERE id = $1', [u.id]), 1)
  wk.calls.length = 0
  const r = await call(on, 'POST', '/api/me/delete', { token: u.token, body: { code: wk.code(mail('zoe')) } })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.json, { ok: true, dogsDeleted: 1, dogsKept: 0, dogsHandedOn: 0 })
  assert.deepEqual(wk.calls.map((c) => `${c.method} ${c.url}`), ['POST https://api.workos.com/user_management/authenticate', `DELETE https://api.workos.com/user_management/users/${wid}`])
  assert.deepEqual(wk.calls[0].body, { client_id: CLIENT, client_secret: KEY, grant_type: 'urn:workos:oauth:grant-type:magic-auth:code', code: wk.calls[0].body.code, email: mail('zoe') })
  assert.deepEqual(wk.calls[1].headers, { Authorization: `Bearer ${KEY}`, Accept: 'application/json' })
  assert.equal(wk.calls[1].body, undefined)
  assert.equal(await count('SELECT COUNT(*) AS n FROM users WHERE id = $1', [u.id]), 0)
  assert.equal((await call(on, 'GET', '/api/me', { token: u.token })).status, 401)
  assert.equal((await call(on, 'GET', `/d/${dog.slug}`)).status, 404)
  assert.ok(!wk.users.has(mail('zoe')))
})

test('switch on: the account is still deleted when WorkOS will not delete its user', async () => {
  for (const [n, how] of [['yara', () => { wk.deleteStatus = 500 }], ['yuri', () => { wk.deleteStatus = 403 }]]) {
    wk.reset()
    const u = await codeSignIn('Y Person', n)
    await call(on, 'POST', '/api/auth/start', { body: { email: mail(n) } })
    how()
    const r = await call(on, 'POST', '/api/me/delete', { token: u.token, body: { code: wk.code(mail(n)) } })
    assert.equal(r.status, 200, r.text)
    assert.equal(await count('SELECT COUNT(*) AS n FROM users WHERE id = $1', [u.id]), 0)
    assert.ok(wk.calls.some((c) => c.method === 'DELETE'))
  }
  wk.reset()
})

// ---- nothing leaks ---------------------------------------------------------------------------
test('no response and no log line carries a code, the key, the client id or a WorkOS token', () => {
  assert.ok(wk.issued.length > 20 && said.length > 150, 'the tests above ran')
  const secrets = [KEY, CLIENT, 'WORKOS_ACCESS_TOKEN', 'WORKOS_REFRESH_TOKEN', 'magic_auth_01']
  const codes = new RegExp(`(?<![0-9A-Za-z])(?:${[...new Set(wk.issued)].join('|')})(?![0-9A-Za-z])`)
  for (const line of said) {
    for (const s of secrets) assert.ok(!line.includes(s), `a response carried ${s}: ${line.slice(0, 200)}`)
    assert.ok(!codes.test(line), `a response carried a code: ${line.slice(0, 200)}`)
  }
  // WorkOS failures were logged, so there is something to check, and none of it is personal.
  assert.ok(logged.some((l) => l.startsWith('auth:')), 'failures are logged')
  for (const line of logged) {
    for (const s of secrets) assert.ok(!line.includes(s), `a log line carried ${s}`)
    assert.ok(!codes.test(line), `a log line carried a code: ${line.slice(0, 200)}`)
    assert.ok(!line.includes('@example.com'), `a log line carried an email: ${line.slice(0, 200)}`)
    assert.ok(!/Bearer /.test(line), 'a log line carried a token')
  }
})
