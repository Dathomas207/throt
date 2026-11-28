// Sign-in with a code sent by email, through WorkOS Magic Auth, and account deletion.
// Registered from app.js with the shared `kit`.
//
// How it works: the server asks WorkOS to email a 6 digit code, the person types it, the server asks
// WorkOS whether it is right, and then Trot issues its own bearer token exactly as before. There is no
// hosted page, no redirect and no cookie, so the website and the iPhone app use the same three calls.
//
// The switch: this is on only when both WORKOS_API_KEY and WORKOS_CLIENT_ID are set. While it is off,
// POST /api/session works as it always did and the routes here that need WorkOS answer 404.
// While it is on, POST /api/session refuses, and a session made without a code is refused everywhere.
//
// Rules this file keeps:
// - The code WorkOS returns when asked to send one is never read, stored, logged or sent to anyone.
// - WorkOS's own access and refresh tokens are dropped. Trot does not use them.
// - Logs carry a status and a short error word from WorkOS. Never an email, a code, a token or the key.
// - "Send me a code" answers the same way whether or not the email has an account.
import { deleteAccount } from './deleteAccount.js'

export const AUTH_LIMITS = {
  windowMs: 15 * 60e3,
  // Codes asked for, per email and per address.
  startPerEmail: 5, startPerIp: 20,
  // Codes tried, per email and per address. Deleting an account counts as a try.
  verifyPerEmail: 8, verifyPerIp: 40,
  ticketMs: 15 * 60e3, timeoutMs: 10000,
}
const MAGIC_GRANT = 'urn:workos:oauth:grant-type:magic-auth:code'
const DEFAULT_BASE = 'https://api.workos.com'

// `opt` is for tests: { apiKey, clientId, apiBase }, or false for off. Otherwise the environment decides.
// WORKOS_API_BASE exists for tests only. Anything that is not https is ignored unless it is this machine.
export function workosConfig(opt, env = process.env) {
  if (opt === false) return { on: false }
  const o = opt || {}
  const apiKey = String(o.apiKey ?? env.WORKOS_API_KEY ?? '').trim()
  const clientId = String(o.clientId ?? env.WORKOS_CLIENT_ID ?? '').trim()
  let apiBase = DEFAULT_BASE
  const want = String(o.apiBase ?? env.WORKOS_API_BASE ?? '').trim().replace(/\/+$/, '')
  if (want) {
    try {
      const u = new URL(want)
      if (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) apiBase = want
    } catch (e) {}
  }
  return { on: !!(apiKey && clientId), apiKey, clientId, apiBase }
}

// Fixed window per key, with the clock passed in so tests can move it.
function windowLimiter({ windowMs, max, now }) {
  const hits = new Map()
  return (key) => {
    const t = now()
    if (hits.size > 20000) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k)
    let h = hits.get(key)
    if (!h || h.reset <= t) { h = { n: 0, reset: t + windowMs }; hits.set(key, h) }
    h.n += 1
    return { ok: h.n <= max, retry: Math.max(1, Math.ceil((h.reset - t) / 1000)) }
  }
}

export function registerAuth(kit, { fetchImpl, now = () => Date.now() } = {}) {
  const { api, db, auth, wos, HttpError, bad, object, text, email, sha, newToken, LIMITS, issueSession, findOrCreateUser, userOut, demoMail } = kit
  const doFetch = fetchImpl || globalThis.fetch
  const L = { ...AUTH_LIMITS, ...((kit.R && kit.R.auth) || {}) }
  const lim = (max) => windowLimiter({ windowMs: L.windowMs, max, now })
  const startEmail = lim(L.startPerEmail), startIp = lim(L.startPerIp), verifyEmail = lim(L.verifyPerEmail), verifyIp = lim(L.verifyPerIp)
  const wait = (s) => (s >= 90 ? `${Math.ceil(s / 60)} minutes` : s > 1 ? `${s} seconds` : '1 second')
  const tooMany = (res, r, what) => { res.set('Retry-After', String(r.retry)); throw new HttpError(429, `${what} Try again in ${wait(r.retry)}.`, 'slow_down') }
  const unavailable = () => new HttpError(503, 'Sign-in is unavailable right now. Try again in a few minutes.', 'auth_unavailable')
  const off = () => new HttpError(404, 'Email codes are not turned on here.', 'email_codes_off')
  const badCode = (expired) => new HttpError(400, expired ? 'That code has expired. Ask for a new one.' : 'That code is wrong or has expired. Check it, or ask for a new one.', 'bad_code')

  // ---- WorkOS ---------------------------------------------------------------------------------
  // One request. Answers { status, ok, json }. status 0 means WorkOS could not be reached.
  // With `discard`, a successful answer is thrown away unread: that is how the code in the
  // "send a code" answer never enters this process's memory as anything but unread bytes.
  async function wcall(method, path, body, { discard = false } = {}) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), L.timeoutMs)
    try {
      const res = await doFetch(wos.apiBase + path, {
        method, signal: ctl.signal,
        headers: { Authorization: `Bearer ${wos.apiKey}`, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      const ok = res.status >= 200 && res.status < 300
      if (ok && discard) { try { if (res.body && res.body.cancel) await res.body.cancel() } catch (e) {} return { status: res.status, ok, json: null } }
      let json = null
      try { json = await res.json() } catch (e) {}
      return { status: res.status, ok, json: json && typeof json === 'object' ? json : null }
    } catch (e) { return { status: 0, ok: false, json: null } } finally { clearTimeout(timer) }
  }
  // The error words WorkOS sent, joined, for matching. The exact names are not relied on.
  const words = (r) => { const j = r.json || {}; return [j.code, j.error, j.message, j.error_description].filter((v) => typeof v === 'string').join(' ').toLowerCase() }
  // What goes in the log: the status and a short machine word. Messages can carry an email, so they never do.
  const logWord = (r) => { const j = r.json || {}; const w = [j.code, j.error].find((v) => typeof v === 'string' && /^[\w.:-]{1,60}$/.test(v)); return `status ${r.status}${w ? ' ' + w : ''}` }
  // WorkOS is not usable right now: unreachable, failing, limiting us, or refusing our key.
  const refusedKey = (r) => /invalid_client|unauthori[sz]ed|api key|unsupported_grant/.test(words(r))
  const down = (r) => r.status === 0 || r.status >= 500 || r.status === 429 || r.status === 401 || r.status === 403 || refusedKey(r)
  // For a code check a 401 or 403 may simply mean a wrong code, so only the clear cases count as down.
  // WorkOS can also answer a right code with "one more step" (MFA, organisation, SSO, email verification).
  // Trot has no screen for those, so they are a setup problem and are logged as one.
  const moreSteps = (r) => /mfa_|email_verification_required|organization_|sso_required|radar_/.test(words(r))
  const downOnCheck = (r) => r.status === 0 || r.status >= 500 || r.status === 429 || refusedKey(r) || moreSteps(r)
  const noSuchUser = (r) => r.status === 404 || /not[_ ]found|no user|does not exist|user[_ ]not/.test(words(r))

  // Asks WorkOS to email a code. 'sent', 'rejected' (WorkOS will not send to this address) or 'down'.
  async function sendCode(mail) {
    let r = await wcall('POST', '/user_management/magic_auth', { email: mail }, { discard: true })
    if (!r.ok && !down(r) && noSuchUser(r)) {
      // WorkOS has no user for this email yet. Make one, then ask once more.
      const made = await wcall('POST', '/user_management/users', { email: mail }, { discard: true })
      if (made.ok || /already|exists|taken|not[_ ]available|duplicate/.test(words(made)) || made.status === 409) r = await wcall('POST', '/user_management/magic_auth', { email: mail }, { discard: true })
      else r = made
    }
    if (r.ok) return 'sent'
    console.error('auth: WorkOS did not send a code,', logWord(r))
    return down(r) || noSuchUser(r) ? 'down' : 'rejected'
  }
  // Checks a code. { ok: true, workosId } or { ok: false, why: 'bad' | 'expired' | 'down' }.
  async function checkCode(mail, code) {
    const r = await wcall('POST', '/user_management/authenticate', { client_id: wos.clientId, client_secret: wos.apiKey, grant_type: MAGIC_GRANT, code, email: mail })
    if (r.ok) {
      // Only the user's id and email are read. The access and refresh tokens are left behind.
      const u = (r.json && r.json.user) || {}
      const id = typeof u.id === 'string' && /^[\w-]{1,120}$/.test(u.id) ? u.id : null
      if (!id || (typeof u.email === 'string' && u.email.trim().toLowerCase() !== mail)) { console.error('auth: WorkOS answered for a different user'); return { ok: false, why: 'down' } }
      return { ok: true, workosId: id }
    }
    if (downOnCheck(r)) { console.error('auth: WorkOS could not check a code,', logWord(r)); return { ok: false, why: 'down' } }
    return { ok: false, why: /expired/.test(words(r)) ? 'expired' : 'bad' }
  }
  const codeOf = (v) => { const s = typeof v === 'string' ? v.replace(/[\s-]/g, '') : ''; if (!/^\d{6}$/.test(s)) throw new HttpError(400, 'Enter the 6 digit code from the email.', 'bad_code'); return s }

  // ---- routes ---------------------------------------------------------------------------------
  // Tells the app which sign-in to show. Nothing else about the setup is said.
  api.get('/auth/config', (req, res) => res.json({ emailCodes: wos.on }))

  api.post('/auth/start', async (req, res) => {
    if (!wos.on) throw off()
    const ip = startIp('ip:' + req.ip)
    if (!ip.ok) return tooMany(res, ip, 'Too many codes were asked for from here.')
    const mail = email(object(req.body).email)
    if (demoMail(mail)) throw new HttpError(403, 'That address belongs to a demo account and cannot be used to sign in.')
    const per = startEmail('mail:' + mail)
    if (!per.ok) return tooMany(res, per, 'Too many codes were asked for.')
    const sent = await sendCode(mail)
    if (sent === 'down') throw unavailable()
    if (sent === 'rejected') throw bad('We could not send a code to that address. Check it and try again.')
    // The same answer for an email with an account and one without.
    res.json({ ok: true })
  })

  // A person who proved their email but has no Trot account yet, and gave no name. The proof is held for
  // 15 minutes under a random ticket so they can add their name without asking for a second code.
  const tickets = new Map()
  const sweep = () => { const t = now(); for (const [k, v] of tickets) if (v.exp <= t) tickets.delete(k) }
  const signedIn = async (res, mail, name, workosId) => {
    const { user, created } = await findOrCreateUser(mail, name)
    if (workosId) await db.query('UPDATE users SET workos_id = $1 WHERE id = $2', [workosId, user.id])
    const token = await issueSession(user.id, true)
    res.status(created ? 201 : 200).json({ token, user: userOut(user), created })
  }

  api.post('/auth/verify', async (req, res) => {
    if (!wos.on) throw off()
    const ip = verifyIp('ip:' + req.ip)
    if (!ip.ok) return tooMany(res, ip, 'Too many tries from here.')
    const b = object(req.body)
    const mail = email(b.email)
    if (demoMail(mail)) throw new HttpError(403, 'That address belongs to a demo account and cannot be used to sign in.')
    const code = codeOf(b.code)
    // The name is checked before the code is spent, so a bad name never costs the person their code.
    const name = b.name == null || b.name === '' ? '' : text(b.name, 'Your name', { min: 1, max: LIMITS.name })
    const per = verifyEmail('mail:' + mail)
    if (!per.ok) return tooMany(res, per, 'Too many tries with this email.')
    const v = await checkCode(mail, code)
    if (!v.ok) throw v.why === 'down' ? unavailable() : badCode(v.why === 'expired')
    const have = await db.query('SELECT id FROM users WHERE email = $1', [mail])
    if (!have.rows[0] && !name) {
      sweep()
      const ticket = newToken()
      tickets.set(sha(ticket), { mail, workosId: v.workosId, exp: now() + L.ticketMs })
      return res.json({ needName: true, ticket })
    }
    await signedIn(res, mail, name, v.workosId)
  })

  // The second half of a first sign-in that came without a name.
  api.post('/auth/complete', async (req, res) => {
    if (!wos.on) throw off()
    const ip = verifyIp('ip:' + req.ip)
    if (!ip.ok) return tooMany(res, ip, 'Too many tries from here.')
    const b = object(req.body)
    const name = text(b.name, 'Your name', { min: 1, max: LIMITS.name })
    const key = typeof b.ticket === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(b.ticket) ? sha(b.ticket) : ''
    const held = key && tickets.get(key)
    if (!held || held.exp <= now()) { if (key) tickets.delete(key); throw new HttpError(400, 'That took too long. Enter your email again to get a new code.', 'ticket_expired') }
    tickets.delete(key)
    await signedIn(res, held.mail, name, held.workosId)
  })

  // ---- account deletion -----------------------------------------------------------------------
  // With email codes on, the person asks for a fresh code (POST /api/auth/start) and sends it here.
  // With them off, they type the account's email. Either way the session has to be theirs already.
  api.post('/me/delete', auth, async (req, res) => {
    const b = object(req.body)
    const mail = String(req.user.email).toLowerCase()
    const row = (await db.query('SELECT workos_id FROM users WHERE id = $1', [req.user.id])).rows[0] || {}
    let workosId = row.workos_id || null
    if (wos.on) {
      const code = codeOf(b.code)
      const per = verifyEmail('mail:' + mail)
      if (!per.ok) return tooMany(res, per, 'Too many tries with this email.')
      const v = await checkCode(mail, code)
      if (!v.ok) throw v.why === 'down' ? unavailable() : badCode(v.why === 'expired')
      workosId = v.workosId || workosId
    } else if (typeof b.email !== 'string' || b.email.trim().toLowerCase() !== mail) {
      throw new HttpError(400, 'That is not the email on this account. Type it exactly as shown to delete the account.', 'email_mismatch')
    }
    const done = await deleteAccount(db, req.user.id)
    // The WorkOS user goes too, when there is one. If WorkOS does not answer, the Trot account is still gone.
    if (wos.on && workosId) {
      const r = await wcall('DELETE', `/user_management/users/${encodeURIComponent(workosId)}`, undefined, { discard: true })
      if (!r.ok && r.status !== 404) console.error('auth: the WorkOS user was not deleted,', logWord(r))
    }
    res.json({ ok: true, ...done })
  })
}
