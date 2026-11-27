// Usage events, admin metrics, client error masking and the in-app notification center.
// Loaded by server/index.js under `node --test server/`. Uses its own pg-mem database.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createDb } from './db.js'
import { createApp } from './app.js'
import { USAGE_EVENTS, USAGE_LIMITS, maskText, pathPattern, cleanProps } from './routesUsage.js'
import { notify, NOTIFY_KINDS, NOTIFY_GROUPS } from './routesNotifications.js'
import { seedDemo } from './seedDemo.js'

let db, server, base
const tag = crypto.randomBytes(4).toString('hex')
const mail = (n) => `${n}-${tag}@example.com`
const RATE = { sessionMax: 100000, writeMax: 100000, readMax: 100000, searchMax: 100000, usageMax: 100000, foundMax: 100000, placeMax: 100000, eventMax: 100000, claimMax: 100000 }
const DAY = 864e5

async function listen(app) {
  const s = app.listen(0)
  await new Promise((r) => s.once('listening', r))
  return { s, url: `http://127.0.0.1:${s.address().port}` }
}
before(async () => {
  db = await createDb()
  const l = await listen(createApp({ db, rate: RATE, adminEmails: mail('boss') }))
  server = l.s; base = l.url
})
after(async () => {
  await new Promise((r) => server.close(r))
  await db.close()
})
async function call(method, p, { token, body, headers: extra, raw, from = base } = {}) {
  const headers = { ...(extra || {}) }
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json'
  const res = await fetch(from + p, { method, headers, redirect: 'manual', body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined })
  const txt = await res.text()
  let json = null
  try { json = JSON.parse(txt) } catch (e) {}
  return { status: res.status, json, text: txt, headers: res.headers }
}
const signIn = async (name, n) => {
  const r = await call('POST', '/api/session', { body: { name, email: mail(n) } })
  assert.ok(r.status === 200 || r.status === 201, r.text)
  return { token: r.json.token, id: r.json.user.id, created: r.json.created }
}
const makeDog = async (token, name, extra = {}) => {
  const r = await call('POST', '/api/dogs', { token, body: { name, breed: 'Mixed', weight: 40, bio: '', ...extra } })
  assert.equal(r.status, 201, r.text)
  return r.json.dog
}
const join = async (ownerToken, slug, role, name, n) => {
  const inv = await call('POST', `/api/dogs/${slug}/invites`, { token: ownerToken, body: { role } })
  assert.equal(inv.status, 201, inv.text)
  const u = await signIn(name, n)
  assert.equal((await call('POST', `/api/invites/${inv.json.token}/accept`, { token: u.token })).status, 200)
  return u
}
const walk = async (token, slug, extra = {}) => {
  const r = await call('POST', `/api/dogs/${slug}/walks`, { token, body: { type: 'Walk', title: 'Loop', note: '', place: '', miles: 1.2, minutes: 24, ...extra } })
  assert.equal(r.status, 201, r.text)
  return r.json.walk
}
const follow = (token, slug, other) => call('PUT', `/api/dogs/${slug}/friends/${other}`, { token, body: {} })
const inbox = async (u, q = '') => { const r = await call('GET', `/api/notifications${q}`, { token: u.token }); assert.equal(r.status, 200, r.text); return r.json }
const kinds = async (u) => (await inbox(u)).items.map((i) => i.kind)
const usage = (body, opts = {}) => call('POST', '/api/usage', { body, ...opts })
const events = async (where = '', params = []) => (await db.query(`SELECT * FROM usage_events ${where}`, params)).rows
const anon = () => 'a' + crypto.randomBytes(8).toString('hex')

// ---- usage endpoint -------------------------------------------------------------
test('usage: anonymous and signed-in batches are stored with no IP and no user agent string', async () => {
  const a = anon(), UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
  const r = await usage({ anon: a, v: 'abc1234', events: [{ name: 'app_open', props: { mode: 'demo', standalone: true } }, { name: 'tab_view', props: { tab: 'explore' } }] }, { headers: { 'user-agent': UA, 'x-forwarded-for': '203.0.113.9' } })
  assert.equal(r.status, 204); assert.equal(r.text, '')
  const rows = await events('WHERE anon_id = $1 ORDER BY name', [a])
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((x) => x.name), ['app_open', 'tab_view'])
  assert.equal(rows[0].user_id, null)
  assert.deepEqual(JSON.parse(rows[0].props), { mode: 'demo', standalone: true })
  assert.equal(rows[0].ua, 'Safari on iPhone or iPad'); assert.equal(rows[0].app_version, 'abc1234')
  // Nothing in any column carries an address or the browser's own string.
  const cols = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'usage_events'")).rows.map((c) => c.column_name).sort()
  assert.deepEqual(cols, ['anon_id', 'app_version', 'at', 'dog_id', 'id', 'name', 'props', 'ua', 'user_id'])
  for (const row of rows) { const all = JSON.stringify(row); assert.ok(!/203\.0\.113|127\.0\.0\.1|::1|Mozilla|AppleWebKit/.test(all), all) }

  // Signed in: by header, and by the token in the body (sendBeacon cannot set headers). The browser id is dropped.
  const u = await signIn('Usage Una', 'us-una'), d = await makeDog(u.token, 'Usagedog')
  assert.equal((await usage({ anon: a, events: [{ name: 'walk_saved', dog: d.slug, props: { type: 'Walk', minutes: '10_30', miles: '1_3', photos: 2, had_gps: true } }] }, { token: u.token })).status, 204)
  assert.equal((await call('POST', '/api/usage', { raw: JSON.stringify({ auth: u.token, events: [{ name: 'sign_in' }] }), headers: { 'content-type': 'text/plain;charset=UTF-8' } })).status, 204)
  const mine = await events('WHERE user_id = $1 ORDER BY name', [u.id])
  assert.deepEqual(mine.map((x) => x.name), ['sign_in', 'walk_saved'])
  assert.equal(mine[1].anon_id, null)
  assert.equal(mine[1].dog_id, (await db.query('SELECT id FROM dogs WHERE slug = $1', [d.slug])).rows[0].id)
  assert.ok(!JSON.stringify(mine).includes(u.token), 'the token is never stored')
  // A dog the person is not on the team of is not recorded against the event.
  const other = await signIn('Usage Otto', 'us-otto')
  await usage({ events: [{ name: 'tab_view', dog: d.slug, props: { tab: 'dog' } }] }, { token: other.token })
  assert.equal((await events('WHERE user_id = $1', [other.id]))[0].dog_id, null)
  // No user and no browser id: nothing to count, nothing stored, still 204.
  const n0 = (await events()).length
  assert.equal((await usage({ events: [{ name: 'app_open' }] })).status, 204)
  assert.equal((await usage({ anon: 'x', events: [{ name: 'app_open' }] })).status, 204)
  assert.equal((await events()).length, n0)
})

test('usage: whitelist, batch limit, body limit, props cap and rate limit all answer 204 and store nothing extra', async () => {
  const a = anon()
  await usage({ anon: a, events: [{ name: 'made_up' }, { name: 'constructor' }, { name: 'tab_view', props: { tab: 'home', email: 'x@example.com', note: 'free text from a person' } }, { name: 'place_opened', props: { category: 'what a <b>long</b> piece of free text that is not a token', curated: 'yes' } }, 'junk', null] })
  let rows = await events('WHERE anon_id = $1 ORDER BY name', [a])
  assert.deepEqual(rows.map((r) => [r.name, r.props]), [['place_opened', '{}'], ['tab_view', '{"tab":"home"}']])
  // 21 events: the whole batch is refused.
  const b = anon()
  assert.equal((await usage({ anon: b, events: Array.from({ length: USAGE_LIMITS.batch + 1 }, () => ({ name: 'tab_view', props: { tab: 'home' } })) })).status, 204)
  assert.equal((await events('WHERE anon_id = $1', [b])).length, 0)
  assert.equal((await usage({ anon: b, events: Array.from({ length: USAGE_LIMITS.batch }, () => ({ name: 'tab_view', props: { tab: 'home' } })) })).status, 204)
  assert.equal((await events('WHERE anon_id = $1', [b])).length, USAGE_LIMITS.batch)
  // Over 4 KB: refused before it is parsed.
  const c = anon()
  const big = await usage({ anon: c, pad: 'x'.repeat(5000), events: [{ name: 'app_open' }] })
  assert.equal(big.status, 204)
  assert.equal((await events('WHERE anon_id = $1', [c])).length, 0)
  // Bad JSON, a list, and a GET.
  assert.equal((await call('POST', '/api/usage', { raw: '{nope', headers: { 'content-type': 'application/json' } })).status, 204)
  assert.equal((await usage([1, 2])).status, 204)
  assert.equal((await call('GET', '/api/usage')).status, 404)
  // Props never pass 300 bytes, and every stored name is on the list.
  await usage({ anon: c, events: [{ name: 'client_error', props: { message: 'y'.repeat(900), kind: 'window', screen: 'home', method: 'POST', path: '/dogs/biscuit/walks', status: 500 } }] })
  rows = await events('WHERE anon_id = $1', [c])
  assert.equal(rows.length, 1)
  assert.ok(Buffer.byteLength(rows[0].props) <= USAGE_LIMITS.propsBytes, rows[0].props)
  assert.equal(JSON.parse(rows[0].props).path, '/dogs/:id/walks')
  for (const r of await events()) assert.ok(Object.keys(USAGE_EVENTS).includes(r.name), r.name)
  // "ago" moves the time back, but never into the future and never more than a day.
  const d = anon()
  await usage({ anon: d, events: [{ name: 'app_open', ago: 60000 }, { name: 'sign_in', ago: -5e9 }, { name: 'sign_up', ago: 9e12 }] })
  const now = Date.now()
  for (const r of await events('WHERE anon_id = $1', [d])) { const t = new Date(r.at).getTime(); assert.ok(t <= now + 1000 && t >= now - DAY - 5000, r.name) }
  // The limiter drops quietly.
  const mem = await createDb()
  const l = await listen(createApp({ db: mem, rate: { ...RATE, usageMax: 2 } }))
  try {
    for (let i = 0; i < 4; i++) assert.equal((await usage({ anon: a, events: [{ name: 'app_open' }] }, { from: l.url })).status, 204)
    assert.equal((await mem.query('SELECT COUNT(*) AS n FROM usage_events')).rows[0].n, 2)
  } finally { await new Promise((r) => l.s.close(r)); await mem.close() }
})

test('usage: the browser and the server agree on the event list', () => {
  const src = fs.readFileSync(new URL('../src/usage.js', import.meta.url), 'utf8')
  const m = /export const EVENTS = \[([^\]]+)\]/.exec(src)
  assert.ok(m, 'src/usage.js exports EVENTS')
  assert.deepEqual(m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean).sort(), Object.keys(USAGE_EVENTS).sort())
  assert.ok(!/sendBeacon[\s\S]{0,400}google|segment|mixpanel|amplitude|posthog/i.test(src), 'no third-party tracker')
})

test('error masking: emails, tokens, ids, coordinates and long digit runs never survive', async () => {
  const dirty = 'Could not save for dale@example.com with Bearer abc.def-123 and tok_9f8a7b6c5d4e3f2a1b0c9d8e at 35.186432,-80.812345 chip 985112345678903 walk 0b6d5a52-3c1e-4f43-9a55-0d0f6f2b7c11'
  const m = maskText(dirty)
  for (const bad of ['dale@example.com', 'abc.def-123', 'tok_9f8a7b6c5d4e3f2a1b0c9d8e', '35.186432', '80.812345', '985112345678903', '0b6d5a52']) assert.ok(!m.includes(bad), `${bad} in ${m}`)
  assert.ok(m.includes('[email]') && m.includes('[token]') && m.includes('[digits]') && m.includes('[id]'), m)
  assert.equal(maskText('x'.repeat(500)).length, USAGE_LIMITS.message)
  assert.equal(maskText('TypeError: Cannot read properties of undefined'), 'TypeError: Cannot read properties of undefined')
  assert.equal(pathPattern('/api/dogs/biscuit-2/walks?secret=1'), '/api/dogs/:id/walks')
  assert.equal(pathPattern('/walks/0b6d5a52-3c1e-4f43-9a55-0d0f6f2b7c11/photos/77'), '/walks/:id/photos/:id')
  assert.equal(pathPattern('/dogs/search?q=bis'), '/dogs/search')
  assert.deepEqual(cleanProps('client_error', { message: 'boom', kind: 'api', method: 'DROP', path: '/dogs/rex', body: '{"note":"private"}', lat: 35.1, n: 3 }), { message: 'boom', kind: 'api', path: '/dogs/:id', n: 3 })
  // The server masks again whatever the browser sent.
  const a = anon()
  await usage({ anon: a, events: [{ name: 'client_error', props: { message: dirty, kind: 'api', method: 'POST', path: '/dogs/secret-dog/walks/0b6d5a52-3c1e-4f43-9a55-0d0f6f2b7c11', status: 500 } }] })
  const row = (await events('WHERE anon_id = $1', [a]))[0]
  for (const bad of ['dale@example.com', 'secret-dog', '985112345678903', '35.186432', '0b6d5a52']) assert.ok(!row.props.includes(bad), row.props)
})

// ---- admin metrics ----------------------------------------------------------------
test('metrics: admins only, and the funnel, week-two cohort, tabs and errors add up on seeded events', async () => {
  const mem = await createDb()
  const l = await listen(createApp({ db: mem, rate: RATE, adminEmails: 'boss@example.com' }))
  const c = (m, p, o = {}) => call(m, p, { ...o, from: l.url })
  try {
    const boss = (await c('POST', '/api/session', { body: { name: 'Boss', email: 'boss@example.com' } })).json
    const pat = (await c('POST', '/api/session', { body: { name: 'Pat', email: 'pat@example.com' } })).json
    assert.equal((await c('GET', '/api/admin/metrics')).status, 401)
    assert.equal((await c('GET', '/api/admin/metrics', { token: pat.token })).status, 403)
    const empty = await c('GET', '/api/admin/metrics', { token: boss.token })
    assert.equal(empty.status, 200, empty.text)
    assert.equal(empty.json.days, 14); assert.equal(empty.json.daily.length, 14)
    assert.equal(empty.json.totals.people, 0); assert.equal(empty.json.weekTwo.rate, null); assert.equal(empty.json.weekTwo.note, 'not enough data')
    assert.deepEqual(empty.json.funnel.map((f) => f.count), [0, 0, 0, 0, 0, 0])

    const now = Date.now()
    let n = 0
    const ev = (user, name, daysAgo, props = {}, extra = {}) => mem.query('INSERT INTO usage_events (id, at, user_id, anon_id, name, dog_id, props, ua, app_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [`e${++n}`, new Date(now - daysAgo * DAY).toISOString(), extra.anon ? null : user, extra.anon || null, name, extra.dog || null, JSON.stringify(props), 'Chrome on Mac', 'test'])
    // Six people signed up 10 days ago. u1 to u3 came back in their second week, u4 only in week one, u5 and u6 never.
    for (let i = 1; i <= 6; i++) await ev(`u${i}`, 'sign_up', 10)
    await ev('u1', 'dog_created', 10); await ev('u1', 'walk_saved', 9.5); await ev('u1', 'walk_saved', 2); await ev('u1', 'care_invite_sent', 2); await ev('u1', 'friend_added', 1)
    await ev('u2', 'dog_created', 10); await ev('u2', 'walk_saved', 1.5)
    await ev('u3', 'dog_created', 9); await ev('u3', 'tab_view', 0.5, { tab: 'explore' })
    await ev('u4', 'tab_view', 8, { tab: 'home' }); await ev('u4', 'tab_view', 7.5, { tab: 'home' })
    // Two people today, one of them twice, plus a signed-out visitor and the same visitor again.
    await ev('u7', 'sign_up', 0.1); await ev('u7', 'dog_created', 0.1); await ev('u7', 'tab_view', 0.05, { tab: 'home' })
    await ev(null, 'app_open', 0.2, { mode: 'demo' }, { anon: 'anon-one-1234' }); await ev(null, 'tab_view', 0.2, { tab: 'explore' }, { anon: 'anon-one-1234' })
    // Errors: one message three times (one of them a pagehide summary worth 4), another once.
    await ev('u2', 'client_error', 3, { message: 'TypeError: x is undefined', kind: 'window', screen: 'home' })
    await ev('u3', 'client_error', 1, { message: 'TypeError: x is undefined', kind: 'window', screen: 'explore', n: 4 })
    await ev('u7', 'client_error', 0.05, { message: 'Render failed', kind: 'render', screen: 'settings' })
    // Outside the 14-day window, the admin's own activity, and a demo dog's events: none of these count.
    await ev('u8', 'sign_up', 20); await ev('u8', 'walk_saved', 19)
    await ev(boss.user.id, 'tab_view', 0.3, { tab: 'home' }); await ev(boss.user.id, 'walk_saved', 0.3)
    await seedDemo(mem)
    const demoDog = (await mem.query('SELECT id FROM dogs WHERE is_demo = TRUE LIMIT 1')).rows[0].id
    await ev('u9', 'walk_saved', 0.4, {}, { dog: demoDog })

    const r = await c('GET', '/api/admin/metrics?days=14', { token: boss.token })
    assert.equal(r.status, 200, r.text)
    const m = r.json
    assert.deepEqual(m.funnel.map((f) => [f.key, f.count]), [['signed_up', 7], ['dog_created', 4], ['first_walk', 2], ['second_walk', 1], ['care_invite', 1], ['friend_added', 1]])
    assert.deepEqual(m.weekTwo, { cohort: 6, returned: 3, rate: 0.5, note: '' })
    assert.equal(m.totals.people, 8, 'u1..u7 and one signed-out browser')
    assert.equal(m.totals.signups, 7); assert.equal(m.totals.walksSaved, 3)
    const today = m.daily[m.daily.length - 1]
    assert.equal(today.day, new Date(now).toISOString().slice(0, 10))
    assert.equal(m.daily.reduce((s, d) => s + d.signups, 0), 7)
    assert.equal(m.daily.reduce((s, d) => s + d.walksSaved, 0), 3)
    assert.ok(m.daily.every((d) => d.active <= 8))
    assert.equal(m.daily.find((d) => d.day === new Date(now - 10 * DAY).toISOString().slice(0, 10)).signups + m.daily.find((d) => d.day === new Date(now - 0.1 * DAY).toISOString().slice(0, 10)).signups, 7)
    assert.deepEqual(m.topTabs, [{ name: 'home', count: 3 }, { name: 'explore', count: 2 }])
    assert.equal(m.topEvents[0].name, 'sign_up'); assert.equal(m.topEvents[0].count, 7)
    assert.deepEqual(m.clientErrors.map((e) => [e.message, e.count, e.screen]), [['TypeError: x is undefined', 5, 'explore'], ['Render failed', 1, 'settings']])
    assert.equal(m.clientErrors[0].lastSeen, new Date(now - 1 * DAY).toISOString())
    assert.equal(m.totals.errors, 6)

    // The admin's own activity is in only when asked for.
    const inc = (await c('GET', '/api/admin/metrics?days=14&includeAdmins=1', { token: boss.token })).json
    assert.equal(inc.includeAdmins, true); assert.equal(inc.totals.people, 9); assert.equal(inc.totals.walksSaved, 4)
    // A shorter window narrows the daily numbers but the week-two cohort is still read in full.
    const wk = (await c('GET', '/api/admin/metrics?days=7', { token: boss.token })).json
    assert.equal(wk.daily.length, 7); assert.equal(wk.funnel[0].count, 1); assert.deepEqual(wk.weekTwo, { cohort: 6, returned: 3, rate: 0.5, note: '' })
    assert.equal((await c('GET', '/api/admin/metrics?days=9999', { token: boss.token })).json.days, 14)
    // Under five people in the cohort: no rate.
    await mem.query("DELETE FROM usage_events WHERE user_id IN ('u5', 'u6')")
    const few = (await c('GET', '/api/admin/metrics', { token: boss.token })).json.weekTwo
    assert.deepEqual(few, { cohort: 4, returned: 3, rate: null, note: 'not enough data' })
  } finally { await new Promise((r) => l.s.close(r)); await mem.close() }
})

// ---- notifications ------------------------------------------------------------------
test('notifications: welcome once, unread on /api/me, read, read all, delete, and nobody else can touch them', async () => {
  const a = await signIn('Nora North', 'n-nora')
  assert.equal(a.created, true)
  let me = await call('GET', '/api/me', { token: a.token })
  assert.equal(me.json.unread, 1)
  let box = await inbox(a)
  assert.equal(box.unread, 1); assert.equal(box.items.length, 1)
  const w = box.items[0]
  assert.equal(w.kind, 'welcome'); assert.equal(w.read, false); assert.equal(w.priority, 'normal'); assert.deepEqual(w.link, { to: 'today' })
  assert.ok(!/—/.test(w.title + w.body))
  // Signing in again does not write a second one.
  await signIn('Nora North', 'n-nora')
  assert.equal((await inbox(a)).items.length, 1)

  const b = await signIn('Ben Bystander', 'n-ben')
  assert.equal((await call('POST', '/api/notifications/read', { token: b.token, body: { ids: [w.id] } })).json.unread, 1, 'own welcome is still unread')
  assert.equal((await inbox(a)).unread, 1, 'someone else cannot mark it')
  assert.equal((await call('DELETE', `/api/notifications/${w.id}`, { token: b.token })).status, 404)
  assert.equal((await call('GET', '/api/notifications')).status, 401)
  assert.equal((await call('POST', '/api/notifications/read', { token: a.token, body: {} })).status, 400)
  assert.equal((await call('POST', '/api/notifications/read', { token: a.token, body: { ids: ['nope'] } })).status, 400)
  assert.equal((await call('GET', '/api/notifications?limit=0', { token: a.token })).status, 400)
  assert.equal((await call('GET', '/api/notifications?before=garbage', { token: a.token })).status, 400)

  const r = await call('POST', '/api/notifications/read', { token: a.token, body: { ids: [w.id] } })
  assert.equal(r.status, 200); assert.equal(r.json.unread, 0)
  assert.equal((await inbox(a)).items[0].read, true)
  assert.equal((await call('GET', '/api/me', { token: a.token })).json.unread, 0)

  // Three more straight from the helper, then paging, read all and delete.
  for (let i = 0; i < 3; i++) { assert.equal(await notify(db, a.id, { kind: 'claim_approved', title: `Claim ${i}`, body: '', link: { to: 'place', id: 'x' } }), true); await new Promise((r2) => setTimeout(r2, 5)) }
  box = await inbox(a, '?limit=2')
  assert.deepEqual(box.items.map((i) => i.title), ['Claim 2', 'Claim 1']); assert.equal(box.unread, 3); assert.ok(box.nextBefore)
  const page2 = await inbox(a, `?limit=2&before=${encodeURIComponent(box.nextBefore)}`)
  assert.deepEqual(page2.items.map((i) => i.title), ['Claim 0', 'Welcome to Trot']); assert.equal(page2.nextBefore, null)
  assert.equal((await call('POST', '/api/notifications/read', { token: a.token, body: { all: true } })).json.unread, 0)
  assert.ok((await inbox(a)).items.every((i) => i.read))
  const del = await call('DELETE', `/api/notifications/${box.items[0].id}`, { token: a.token })
  assert.equal(del.status, 200)
  assert.equal((await inbox(a)).items.length, 3)
  assert.equal((await call('DELETE', `/api/notifications/${box.items[0].id}`, { token: a.token })).status, 404)

  // The helper never throws into its caller, whatever it is given.
  assert.equal(await notify(db, 'no-such-user', { kind: 'welcome', title: 'x' }), false)
  assert.equal(await notify(db, a.id, { kind: 'not_a_kind', title: 'x' }), false)
  assert.equal(await notify(db, a.id, { kind: 'welcome', title: '' }), false)
  assert.equal(await notify(db, a.id, { kind: 'paw', title: 'x', actorId: a.id }), false, 'never about your own action')
  assert.equal(await notify({ query: async () => { throw new Error('db is down') } }, a.id, { kind: 'welcome', title: 'x' }), false)
  assert.equal(await notify(db, null), false)
  assert.equal(NOTIFY_KINDS.length, 12)
})

test('notifications: friend added goes to the other dog\'s owner and family with Add back, mutual closes the loop, the actor hears nothing', async () => {
  const ann = await signIn('Ann Adder', 'f-ann'), bob = await signIn('Bob Befriended', 'f-bob')
  const a = await makeDog(ann.token, 'Adderdog'), b = await makeDog(bob.token, 'Befriendog')
  const fam = await join(bob.token, b.slug, 'family', 'Fay Family', 'f-fay'), wal = await join(bob.token, b.slug, 'walker', 'Wes Walker', 'f-wes')
  const annFam = await join(ann.token, a.slug, 'family', 'Ana Adderfam', 'f-ana')
  const start = { ann: (await inbox(ann)).items.length, bob: (await inbox(bob)).items.length }

  assert.equal((await follow(ann.token, a.slug, b.slug)).status, 200)
  for (const u of [bob, fam]) {
    const top = (await inbox(u)).items[0]
    assert.equal(top.kind, 'friend_added')
    assert.equal(top.title, 'Adderdog added Befriendog as a friend')
    assert.deepEqual(top.dog, { slug: b.slug, name: 'Befriendog' })
    assert.equal(top.link.to, 'friends'); assert.equal(top.link.dog, b.slug)
    assert.deepEqual(top.action, { type: 'add_back', dog: b.slug, other: a.slug, otherName: 'Adderdog', done: false })
  }
  assert.ok(!(await kinds(wal)).includes('friend_added'), 'walkers are not told')
  assert.equal((await inbox(ann)).items.length, start.ann, 'the actor hears nothing')
  assert.ok(!(await kinds(annFam)).includes('friend_added'), 'the adding dog\'s family hears nothing')
  // Adding again, or removing and adding again, stays quiet.
  await follow(ann.token, a.slug, b.slug)
  await call('DELETE', `/api/dogs/${a.slug}/friends/${b.slug}`, { token: ann.token }); await follow(ann.token, a.slug, b.slug)
  assert.equal((await inbox(bob)).items.filter((i) => i.kind === 'friend_added').length, 1)

  // Bob adds back: Ann and her family get friend_mutual, Bob gets nothing new, and Bob's Add back shows as done.
  assert.equal((await follow(bob.token, b.slug, a.slug)).json.friend.mutual, true)
  for (const u of [ann, annFam]) { const top = (await inbox(u)).items[0]; assert.equal(top.kind, 'friend_mutual'); assert.equal(top.title, 'Befriendog and Adderdog are now friends with each other'); assert.equal(top.action, undefined) }
  assert.ok(!(await kinds(bob)).includes('friend_mutual'))
  assert.equal((await inbox(bob)).items.find((i) => i.kind === 'friend_added').action.done, true)
  assert.equal((await inbox(bob)).items.length, start.bob + 1, 'one friend_added and nothing else')

  // A person on both teams is never told about their own action, and demo dogs' made-up owners never get rows.
  const mem = await createDb()
  try {
    await seedDemo(mem)
    assert.equal((await mem.query('SELECT COUNT(*) AS n FROM notifications')).rows[0].n, 0, 'seeding writes no notifications')
    const demoUser = (await mem.query('SELECT id FROM users WHERE is_demo = TRUE LIMIT 1')).rows[0].id
    assert.equal(await notify(mem, demoUser, { kind: 'welcome', title: 'x' }), false)
  } finally { await mem.close() }
})

test('notifications: a real person adding a demo dog makes no noise, and a private adder offers no Add back', async () => {
  const mem = await createDb()
  const l = await listen(createApp({ db: mem, rate: RATE }))
  const c = (m, p, o = {}) => call(m, p, { ...o, from: l.url })
  try {
    await seedDemo(mem)
    const u = (await c('POST', '/api/session', { body: { name: 'Real Rae', email: 'rae@example.com' } })).json
    const d = (await c('POST', '/api/dogs', { token: u.token, body: { name: 'Raedog', breed: '', weight: 30, bio: '' } })).json.dog
    const demo = (await mem.query('SELECT slug FROM dogs WHERE is_demo = TRUE AND is_public = TRUE LIMIT 1')).rows[0].slug
    assert.equal((await c('PUT', `/api/dogs/${d.slug}/friends/${demo}`, { token: u.token, body: {} })).status, 200)
    assert.deepEqual((await mem.query('SELECT kind FROM notifications')).rows.map((r) => r.kind), ['welcome'])
    // A private dog can follow a public one. The owner is told, but there is no page to add back.
    const v = (await c('POST', '/api/session', { body: { name: 'Shy Sam', email: 'sam@example.com' } })).json
    const s = (await c('POST', '/api/dogs', { token: v.token, body: { name: 'Shydog', breed: '', weight: 30, bio: '' } })).json.dog
    await c('PATCH', `/api/dogs/${s.slug}`, { token: v.token, body: { public: false } })
    await c('PUT', `/api/dogs/${s.slug}/friends/${d.slug}`, { token: v.token, body: {} })
    const top = (await c('GET', '/api/notifications', { token: u.token })).json.items[0]
    assert.equal(top.kind, 'friend_added'); assert.equal(top.action, undefined); assert.equal(top.link.other, undefined)
  } finally { await new Promise((r) => l.s.close(r)); await mem.close() }
})

test('notifications: paws collapse into one per outing, care team events reach the right people', async () => {
  const own = await signIn('Olive Owner', 'p-own')
  const d = await makeDog(own.token, 'Pawdog')
  const before = (await inbox(own)).items.length
  const fam = await join(own.token, d.slug, 'family', 'Finn Family', 'p-fam')
  // care_invite_accepted goes to the inviter only.
  let top = (await inbox(own)).items[0]
  assert.equal(top.kind, 'care_invite_accepted'); assert.equal(top.title, "Finn joined Pawdog's care team"); assert.deepEqual(top.link, { to: 'people', dog: d.slug })
  assert.ok(!(await kinds(fam)).includes('care_invite_accepted'))
  const wal = await join(own.token, d.slug, 'walker', 'Wren Walker', 'p-wal'), day = await join(own.token, d.slug, 'daycare', 'Happy Tails Daycare', 'p-day')
  assert.equal((await inbox(own)).items.length, before + 3)
  // Accepting twice does not notify twice.
  const inv = await call('POST', `/api/dogs/${d.slug}/invites`, { token: own.token, body: { role: 'walker' } })
  await call('POST', `/api/invites/${inv.json.token}/accept`, { token: wal.token })
  assert.equal((await inbox(own)).items.length, before + 3)

  // care_walk_logged: a walker's outing reaches owner and family, not the walker, not the daycare.
  const w = await walk(wal.token, d.slug, { title: 'Midday loop' })
  for (const u of [own, fam]) {
    top = (await inbox(u)).items[0]
    assert.equal(top.kind, 'care_walk_logged'); assert.equal(top.title, 'Wren logged a walk for Pawdog'); assert.deepEqual(top.link, { to: 'outing', id: w.id, dog: d.slug })
    assert.ok(top.body.startsWith('Midday loop'))
  }
  for (const u of [wal, day]) assert.ok(!(await kinds(u)).includes('care_walk_logged'))
  await walk(day.token, d.slug, { type: 'Daycare', title: 'Day at daycare', miles: 0, minutes: 300 })
  assert.equal((await inbox(own)).items[0].title, 'Happy Tails Daycare logged a daycare day for Pawdog')
  // The owner's and family's own outings notify nobody.
  const n0 = (await db.query('SELECT COUNT(*) AS n FROM notifications')).rows[0].n
  const mine = await walk(own.token, d.slug, { title: 'Evening stroll' }); await walk(fam.token, d.slug)
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM notifications')).rows[0].n, n0)

  // Paws on the owner's outing: the walker paws, then family, then daycare. The owner keeps one row that is rewritten.
  const paws = async (u) => (await inbox(u)).items.filter((i) => i.kind === 'paw')
  assert.equal((await call('POST', `/api/walks/${mine.id}/paw`, { token: wal.token })).json.paws, 1)
  let p = await paws(own)
  assert.equal(p.length, 1); assert.equal(p[0].title, "Wren pawed Pawdog's outing"); assert.equal(p[0].body, 'Evening stroll'); assert.deepEqual(p[0].link, { to: 'outing', id: mine.id, dog: d.slug })
  assert.equal((await paws(wal)).length, 0, 'the one who pawed is not told')
  assert.equal((await paws(fam)).length, 1, 'family is told too')
  await call('POST', '/api/notifications/read', { token: own.token, body: { all: true } })
  await call('POST', `/api/walks/${mine.id}/paw`, { token: fam.token })
  await call('POST', `/api/walks/${mine.id}/paw`, { token: day.token })
  p = await paws(own)
  assert.equal(p.length, 1, 'still one row for this outing')
  assert.equal(p[0].title, "Happy and 2 others pawed Pawdog's outing"); assert.equal(p[0].read, false, 'a new paw makes it unread again')
  assert.equal((await inbox(own)).items[0].kind, 'paw', 'and moves it to the top')
  assert.equal((await paws(fam)).length, 1); assert.equal((await paws(fam))[0].title, "Happy and 1 other pawed Pawdog's outing")
  // Pawing twice, or your own outing, adds nothing. A second outing gets its own row.
  await call('POST', `/api/walks/${mine.id}/paw`, { token: day.token })
  assert.equal((await paws(own))[0].title, "Happy and 2 others pawed Pawdog's outing")
  await call('POST', `/api/walks/${mine.id}/paw`, { token: own.token })
  assert.equal((await paws(own)).length, 1)
  await call('POST', `/api/walks/${w.id}/paw`, { token: own.token })
  assert.equal((await paws(wal)).length, 1, 'the walker who logged it hears about a paw on their outing')
  assert.equal((await paws(own)).length, 1, 'the owner pawed, so nothing new for the owner')
  assert.equal((await paws(fam)).length, 2)
})

test('notifications: a found report is high priority for owner and family and cannot be turned off; claims reach the claimant', async () => {
  const own = await signIn('Lena Lost', 'l-own')
  const d = await makeDog(own.token, 'Lostdog')
  const fam = await join(own.token, d.slug, 'family', 'Fred Family', 'l-fam'), wal = await join(own.token, d.slug, 'walker', 'Will Walker', 'l-wal')
  // Everything that can be turned off is turned off.
  const off = await call('PUT', '/api/notifications/prefs', { token: own.token, body: { friends: false, paws: false, care: false, reminders: false } })
  assert.equal(off.status, 200); assert.deepEqual(off.json.prefs, { friends: false, paws: false, care: false, reminders: false }); assert.deepEqual(off.json.always, ['found_report'])
  assert.deepEqual(off.json.channels, { inApp: true, push: false, email: false, text: false })
  assert.equal((await call('PUT', '/api/notifications/prefs', { token: own.token, body: { found_report: false } })).status, 400)
  assert.equal((await call('PUT', `/api/dogs/${d.slug}/lost`, { token: own.token, body: { lost: true, note: '' } })).status, 200)
  const code = (await call('GET', `/api/dogs/${d.slug}/tags`, { token: own.token })).json.tags[0].code
  const sent = await call('POST', `/t/${code}/found`, { body: { name: 'Gus', message: 'Found by the creek', contact: '704 555 0100', lat: 35.2, lng: -80.8 } })
  assert.equal(sent.status, 201, sent.text)
  for (const u of [own, fam]) {
    const top = (await inbox(u)).items[0]
    assert.equal(top.kind, 'found_report'); assert.equal(top.priority, 'high'); assert.equal(top.title, 'Someone found Lostdog'); assert.deepEqual(top.link, { to: 'tag', dog: d.slug })
    // The finder's message, phone and location stay in tag activity.
    assert.ok(!/creek|555|35\.2|80\.8/.test(JSON.stringify([top.title, top.body, top.link])), JSON.stringify(top)) // not the id or time, which are random
  }
  assert.ok(!(await kinds(wal)).includes('found_report'))
  // The red banner's data is untouched.
  assert.equal((await call('GET', `/api/dogs/${d.slug}/tags/scans`, { token: own.token })).json.unread, 1)

  // Claims: the claimant hears the decision, the admin who decided does not.
  const boss = await signIn('Boss', 'boss')
  const place = (await call('POST', '/api/places', { token: boss.token, body: { name: 'Claim Cafe', category: 'cafe', lat: 35.2, lng: -80.84, note: '' } })).json.place
  const place2 = (await call('POST', '/api/places', { token: boss.token, body: { name: 'Second Cafe', category: 'cafe', lat: 35.21, lng: -80.84, note: '' } })).json.place
  const mk = async (u, p) => { const r = await call('POST', `/api/places/${p.id}/claim`, { token: u.token, body: { role: 'owner', contactEmail: 'shop@example.com', message: '' } }); assert.equal(r.status, 201, r.text); return r.json.claim.id }
  const c1 = await mk(wal, place), c2 = await mk(wal, place2), c3 = await mk(boss, place2)
  assert.equal((await call('POST', `/api/admin/claims/${c1}/approve`, { token: boss.token })).status, 200)
  let top = (await inbox(wal)).items[0]
  assert.equal(top.kind, 'claim_approved'); assert.equal(top.title, 'You now maintain Claim Cafe'); assert.equal(top.link.to, 'place'); assert.equal(top.link.id, place.id); assert.deepEqual(top.link.at, [35.2, -80.84])
  assert.equal((await call('POST', `/api/admin/claims/${c2}/reject`, { token: boss.token })).status, 200)
  top = (await inbox(wal)).items[0]
  assert.equal(top.kind, 'claim_rejected'); assert.equal(top.title, 'Your request to maintain Second Cafe was not approved')
  const bossBefore = (await inbox(boss)).items.length
  assert.equal((await call('POST', `/api/admin/claims/${c3}/approve`, { token: boss.token })).status, 200)
  assert.equal((await inbox(boss)).items.length, bossBefore, 'deciding your own claim tells you nothing new')
})

test('notifications: reminders are made when the list is read, once per item and date, and preferences are respected', async () => {
  const own = await signIn('Rita Reminder', 'r-own')
  const d = await makeDog(own.token, 'Duedog')
  const wal = await join(own.token, d.slug, 'walker', 'Walt Walker', 'r-wal')
  await call('POST', '/api/notifications/read', { token: own.token, body: { all: true } })
  const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10)
  assert.equal((await call('PUT', `/api/dogs/${d.slug}/registration`, { token: own.token, body: { licenseNumber: 'L-1', licenseExpiresOn: day(12), rabiesTag: 'R-1', rabiesDueOn: day(-3) } })).status, 200)
  // The unread count on /api/me already includes them.
  assert.equal((await call('GET', '/api/me', { token: own.token })).json.unread, 2)
  let due = (await inbox(own)).items.filter((i) => i.kind === 'registration_due')
  assert.deepEqual(due.map((i) => i.title).sort(), [`Duedog's license expires on ${day(12)}`, `Duedog's rabies vaccine was due on ${day(-3)}`])
  assert.deepEqual(due[0].link, { to: 'registration', dog: d.slug })
  // Reading the list again, any number of times, adds nothing. Not even after they are read or deleted.
  await inbox(own); await call('GET', '/api/me', { token: own.token })
  await call('POST', '/api/notifications/read', { token: own.token, body: { all: true } })
  assert.equal((await inbox(own)).items.filter((i) => i.kind === 'registration_due').length, 2)
  assert.equal((await inbox(own)).unread, 0)
  // A walker is not reminded about someone else's paperwork.
  assert.ok(!(await kinds(wal)).includes('registration_due'))
  // A date far away makes nothing, and a new date makes one new reminder.
  await call('PUT', `/api/dogs/${d.slug}/registration`, { token: own.token, body: { licenseExpiresOn: day(200) } })
  assert.equal((await inbox(own)).items.filter((i) => i.kind === 'registration_due').length, 2)
  await call('PUT', `/api/dogs/${d.slug}/registration`, { token: own.token, body: { licenseExpiresOn: day(5) } })
  due = (await inbox(own)).items.filter((i) => i.kind === 'registration_due')
  assert.equal(due.length, 3); assert.equal(due[0].read, false)

  // Events: going within three days reminds once. Further out, or not going, does not.
  const mkEvent = async (name, n) => { const r = await call('POST', '/api/events', { token: own.token, body: { name, kind: (await import('./routesShows.js')).EVENT_KINDS[0], startsOn: day(n), city: 'Charlotte', venue: 'Freedom Park' } }); assert.equal(r.status, 201, r.text); return r.json.event.id }
  const soon = await mkEvent('Bark in the Park', 2), far = await mkEvent('Far Away Show', 20), skip = await mkEvent('Not Going Meetup', 1)
  await call('PUT', `/api/events/${soon}/entries/${d.slug}`, { token: own.token, body: { status: 'going' } })
  await call('PUT', `/api/events/${far}/entries/${d.slug}`, { token: own.token, body: { status: 'going' } })
  let ev = (await inbox(own)).items.filter((i) => i.kind === 'event_reminder')
  assert.equal(ev.length, 1); assert.equal(ev[0].title, `Bark in the Park is on ${day(2)}`); assert.deepEqual(ev[0].link, { to: 'events', dog: d.slug }); assert.ok(ev[0].body.includes('Freedom Park'))
  await inbox(own); await inbox(own)
  assert.equal((await inbox(own)).items.filter((i) => i.kind === 'event_reminder').length, 1)
  assert.ok(skip)

  // Preferences: each switch stops its own kinds at the source, for that person only.
  const pre = await call('GET', '/api/notifications/prefs', { token: own.token })
  assert.deepEqual(pre.json.prefs, { friends: true, paws: true, care: true, reminders: true })
  assert.deepEqual(Object.keys(NOTIFY_GROUPS), ['friends', 'paws', 'care', 'reminders'])
  assert.equal((await call('PUT', '/api/notifications/prefs', { token: own.token, body: {} })).status, 400)
  assert.equal((await call('PUT', '/api/notifications/prefs', { token: own.token, body: { paws: 'no' } })).status, 400)
  assert.deepEqual((await call('PUT', '/api/notifications/prefs', { token: own.token, body: { reminders: false, paws: false } })).json.prefs, { friends: true, paws: false, care: true, reminders: false })
  await call('PUT', `/api/dogs/${d.slug}/registration`, { token: own.token, body: { licenseExpiresOn: day(9) } })
  await call('PUT', `/api/events/${skip}/entries/${d.slug}`, { token: own.token, body: { status: 'going' } })
  const count = async (k) => (await inbox(own)).items.filter((i) => i.kind === k).length
  assert.equal(await count('registration_due'), 3); assert.equal(await count('event_reminder'), 1)
  const w = await walk(own.token, d.slug)
  await call('POST', `/api/walks/${w.id}/paw`, { token: wal.token })
  assert.equal(await count('paw'), 0, 'paws are off')
  const w2 = await walk(wal.token, d.slug)
  assert.equal(await count('care_walk_logged'), 1, 'care team is still on')
  // Back on: the next ones arrive, and the pending reminders are written on the next read.
  assert.deepEqual((await call('PUT', '/api/notifications/prefs', { token: own.token, body: { reminders: true, paws: true } })).json.prefs, { friends: true, paws: true, care: true, reminders: true })
  await call('POST', `/api/walks/${w2.id}/paw`, { token: wal.token })
  assert.equal(await count('paw'), 1, 'paws are back on')
  assert.equal(await count('registration_due'), 4); assert.equal(await count('event_reminder'), 2)
})
