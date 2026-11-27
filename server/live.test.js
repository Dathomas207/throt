// Live walks for mutual friends. Every privacy rule at the top of server/routesLive.js has a test here.
// Loaded by server/index.js under `node --test server/`. Uses its own pg-mem database and its own clock.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createDb } from './db.js'
import { createApp } from './app.js'
import { LIVE, usualStart, inZone, metres } from './routesLive.js'
import { USAGE_EVENTS } from './routesUsage.js'
import { canShareLive, todayLine, lastSeenText, SHARE_RULES, shareHelp, DEMO_SHARE_NOTE, metresToLine, noGpsText, OFF_ROUTE_M } from '../src/live.js'

let db, server, base
let clock = Date.now()
const tick = (ms) => { clock += ms }
const tag = crypto.randomBytes(4).toString('hex')
const mail = (n) => `${n}-${tag}@example.com`
const RATE = { sessionMax: 100000, writeMax: 100000, readMax: 100000, searchMax: 100000 }
// Everything the server prints while the tests run, to prove no coordinate is ever logged.
const logged = []
const real = { log: console.log, error: console.error, warn: console.warn, info: console.info }

before(async () => {
  for (const k of Object.keys(real)) console[k] = (...a) => { logged.push(a.map((x) => (x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }
  db = await createDb()
  const s = createApp({ db, rate: RATE, liveNow: () => clock }).listen(0)
  await new Promise((r) => s.once('listening', r))
  server = s; base = `http://127.0.0.1:${s.address().port}`
})
after(async () => {
  for (const k of Object.keys(real)) console[k] = real[k]
  await new Promise((r) => server.close(r))
  await db.close()
})

async function call(method, p, { token, body } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(base + p, { method, headers, redirect: 'manual', body: body !== undefined ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch (e) {}
  return { status: res.status, json, text }
}
let seq = 0
const signIn = async (name) => {
  const r = await call('POST', '/api/session', { body: { name, email: mail(`u${++seq}`) } })
  assert.ok(r.status === 200 || r.status === 201, r.text)
  return { token: r.json.token, id: r.json.user.id }
}
const makeDog = async (token, name) => {
  const r = await call('POST', '/api/dogs', { token, body: { name, breed: 'Mixed', weight: 40, bio: '' } })
  assert.equal(r.status, 201, r.text)
  return r.json.dog
}
const follow = async (token, from, to) => assert.equal((await call('PUT', `/api/dogs/${from}/friends/${to}`, { token })).status, 200)
const join = async (ownerToken, slug, role, name) => {
  const inv = await call('POST', `/api/dogs/${slug}/invites`, { token: ownerToken, body: { role } })
  assert.equal(inv.status, 201, inv.text)
  const u = await signIn(name)
  assert.equal((await call('POST', `/api/invites/${inv.json.token}/accept`, { token: u.token })).status, 200)
  return u
}
// A person with a dog, and a second person whose dog is a mutual friend of it.
const pair = async () => {
  const a = await signIn('Ana Walker'), b = await signIn('Ben Viewer')
  const ada = await makeDog(a.token, 'Ada'), bo = await makeDog(b.token, 'Bo')
  await follow(a.token, ada.slug, bo.slug); await follow(b.token, bo.slug, ada.slug)
  return { a, b, ada, bo }
}
const START = { lat: 35.2, lng: -80.84 }
const FAR = { lat: 35.20312, lng: -80.84068 } // about 350 m from START
const NEAR = { lat: 35.201, lng: -80.84 } // about 111 m from START
const start = (u, dog, extra = {}) => call('POST', '/api/live/start', { token: u.token, body: { dog: dog.slug, activity: 'Walk', source: 'gps', ...START, ...extra } })
const ping = (u, at) => call('POST', '/api/live/ping', { token: u.token, body: at })
const friends = async (u) => { const r = await call('GET', '/api/live/friends', { token: u.token }); assert.equal(r.status, 200, r.text); return r.json.friends }
const rowsOf = async (u) => (await db.query('SELECT * FROM live_walks WHERE user_id = $1', [u.id])).rows

test('live: every endpoint needs sign-in', async () => {
  for (const [m, p, body] of [['POST', '/api/live/start', { dog: 'x', ...START, source: 'gps' }], ['POST', '/api/live/ping', FAR], ['POST', '/api/live/stop', {}], ['GET', '/api/live/friends'], ['GET', '/api/live/settings'], ['PUT', '/api/live/settings', { shareByDefault: true }]]) {
    const r = await call(m, p, { body })
    assert.equal(r.status, 401, `${m} ${p}`)
    assert.ok(!/position|lat|lng/.test(r.text))
    assert.equal((await call(m, p, { body, token: 'x'.repeat(43) })).status, 401, `${m} ${p} with a made-up token`)
  }
})

test('live: sharing is off by default, and the account setting starts off', async () => {
  const { a, b } = await pair()
  assert.deepEqual((await call('GET', '/api/live/settings', { token: a.token })).json, { shareByDefault: false })
  // Nobody started anything, so there is nothing to see and no row.
  assert.deepEqual(await friends(b), [])
  assert.equal((await rowsOf(a)).length, 0)
  // A ping with no walk being shared stores nothing.
  assert.equal((await ping(a, FAR)).status, 404)
  assert.equal((await rowsOf(a)).length, 0)
  for (const bad of [{}, { shareByDefault: 'yes' }, { shareByDefault: 1 }]) assert.equal((await call('PUT', '/api/live/settings', { token: a.token, body: bad })).status, 400)
  assert.deepEqual((await call('PUT', '/api/live/settings', { token: a.token, body: { shareByDefault: true } })).json, { shareByDefault: true })
  assert.deepEqual((await call('GET', '/api/live/settings', { token: a.token })).json, { shareByDefault: true })
  // One person's setting is theirs alone, and the setting on its own shares nothing.
  assert.deepEqual((await call('GET', '/api/live/settings', { token: b.token })).json, { shareByDefault: false })
  assert.deepEqual(await friends(b), [])
})

test('live: a mutual friend sees the walk, a one-way follower in either direction does not', async () => {
  const { a, b, ada } = await pair()
  const c = await signIn('Cy Oneway'), cy = await makeDog(c.token, 'Cy')
  const d = await signIn('Dee Followed'), dee = await makeDog(d.token, 'Dee')
  const e = await signIn('Eve Stranger'); await makeDog(e.token, 'Eve')
  await follow(c.token, cy.slug, ada.slug) // Cy follows Ada, Ada does not follow back
  await follow(a.token, ada.slug, dee.slug) // Ada follows Dee, Dee does not follow back
  const s = await start(a, ada)
  assert.equal(s.status, 201, s.text)
  assert.equal(s.json.visible, false)
  tick(6000)
  assert.deepEqual((await ping(a, FAR)).json, { ok: true, visible: true })
  const seen = await friends(b)
  assert.equal(seen.length, 1)
  assert.deepEqual(Object.keys(seen[0]).sort(), ['activity', 'lastSeenSeconds', 'minutesOut', 'name', 'photoUrl', 'place', 'position', 'slug', 'with'])
  assert.equal(seen[0].name, 'Ada'); assert.equal(seen[0].slug, ada.slug); assert.equal(seen[0].with, 'Ana'); assert.equal(seen[0].activity, 'Walk')
  assert.deepEqual(seen[0].position, { lat: 35.2031, lng: -80.8407 })
  for (const u of [c, d, e]) assert.deepEqual(await friends(u), [], 'not a mutual friend')
  // The walker does not see themselves.
  assert.deepEqual(await friends(a), [])
  // Mutual again the moment Cy is followed back, and gone again when either side unfollows.
  await follow(a.token, ada.slug, cy.slug)
  assert.equal((await friends(c)).length, 1)
  assert.equal((await call('DELETE', `/api/dogs/${cy.slug}/friends/${ada.slug}`, { token: c.token })).status, 200)
  assert.deepEqual(await friends(c), [])
  await call('POST', '/api/live/stop', { token: a.token })
})

test('live: only the owner and family of the friend dog see it, and a private dog shares nothing', async () => {
  const { a, b, ada, bo } = await pair()
  const fam = await join(b.token, bo.slug, 'family', 'Fay Family')
  const walker = await join(b.token, bo.slug, 'walker', 'Will Walker')
  const day = await join(b.token, bo.slug, 'daycare', 'Day Care')
  assert.equal((await start(a, ada)).status, 201)
  tick(6000); await ping(a, FAR)
  assert.equal((await friends(b)).length, 1)
  assert.equal((await friends(fam)).length, 1)
  assert.deepEqual(await friends(walker), [])
  assert.deepEqual(await friends(day), [])
  // Ada's page goes private in the middle of the walk: friends stop seeing it at once.
  assert.equal((await call('PATCH', `/api/dogs/${ada.slug}`, { token: a.token, body: { public: false } })).status, 200)
  assert.deepEqual(await friends(b), [])
  // And a private dog cannot start sharing.
  const again = await start(a, ada)
  assert.equal(again.status, 400)
  assert.match(again.json.error, /private/)
  await call('POST', '/api/live/stop', { token: a.token })
})

test('live: no position within 150 m of the start, and none is stored there', async () => {
  const { a, b, ada } = await pair()
  await start(a, ada)
  // Straight after the start there is no position at all.
  let f = (await friends(b))[0]
  assert.equal(f.position, null); assert.equal(f.place, null)
  assert.equal((await rowsOf(a))[0].lat, null)
  tick(6000)
  assert.deepEqual((await ping(a, NEAR)).json, { ok: true, visible: false })
  f = (await friends(b))[0]
  assert.equal(f.position, null)
  let row = (await rowsOf(a))[0]
  assert.equal(row.lat, null); assert.equal(row.lng, null)
  // Out of the zone: shown. Back inside: the stored position is wiped, not kept from before.
  tick(6000); await ping(a, FAR)
  assert.ok((await friends(b))[0].position)
  tick(6000); await ping(a, { lat: START.lat + 0.0002, lng: START.lng })
  assert.equal((await friends(b))[0].position, null)
  row = (await rowsOf(a))[0]
  assert.equal(row.lat, null); assert.equal(row.lng, null)
  // Even a position that somehow got stored inside the zone is filtered on the way out.
  await db.query('UPDATE live_walks SET lat = $1, lng = $2, place = $3 WHERE user_id = $4', [NEAR.lat, NEAR.lng, 'Somewhere', a.id])
  f = (await friends(b))[0]
  assert.equal(f.position, null); assert.equal(f.place, null)
  assert.ok(!JSON.stringify(f).includes('35.201'))
  await call('POST', '/api/live/stop', { token: a.token })
})

test('live: the usual start from past walks is hidden too', async () => {
  const { a, b, ada } = await pair()
  const HOME = [35.21, -80.85], PARK = [35.23, -80.81]
  const save = (from) => call('POST', `/api/dogs/${ada.slug}/walks`, { token: a.token, body: { title: 'Walk', minutes: 20, miles: 1, route: [from, [from[0] + 0.003, from[1]], from] } })
  // Three walks from home (a few metres apart, as GPS gives) and one from a park.
  for (const p of [HOME, [HOME[0] + 0.0001, HOME[1]], [HOME[0], HOME[1] + 0.0001], PARK]) assert.equal((await save(p)).status, 201)
  // Today's walk starts somewhere else, then passes home.
  await start(a, ada)
  const row = (await rowsOf(a))[0]
  assert.ok(metres([row.home_lat, row.home_lng], HOME) < 20, 'the usual start is the home cluster')
  tick(6000)
  assert.equal((await ping(a, { lat: HOME[0] + 0.0008, lng: HOME[1] })).json.visible, false) // about 89 m from home
  assert.equal((await friends(b))[0].position, null)
  assert.equal((await rowsOf(a))[0].lat, null)
  // The park was only a start once, so it is not treated as home.
  tick(6000)
  assert.equal((await ping(a, { lat: PARK[0], lng: PARK[1] })).json.visible, true)
  assert.deepEqual((await friends(b))[0].position, { lat: 35.23, lng: -80.81 })
  await call('POST', '/api/live/stop', { token: a.token })
  // Unit: the largest cluster wins, a tie goes to the most recent, and no history gives nothing.
  assert.equal(usualStart([]), null)
  assert.deepEqual(usualStart([PARK, HOME]), PARK)
  assert.ok(metres(usualStart([PARK, HOME, [HOME[0] + 0.0002, HOME[1]]]), HOME) < 20)
})

test('live: a walk with no update for 10 minutes has ended, is never returned and is deleted', async () => {
  const { a, b, ada } = await pair()
  await start(a, ada)
  tick(6000); await ping(a, FAR)
  tick(LIVE.staleMs - 1000)
  const f = (await friends(b))[0]
  assert.ok(f, 'still there just inside 10 minutes')
  assert.equal(f.lastSeenSeconds, 599)
  assert.deepEqual(f.position, { lat: 35.2031, lng: -80.8407 })
  tick(2000)
  assert.deepEqual(await friends(b), [])
  // Reading it was enough to delete it.
  assert.equal((await rowsOf(a)).length, 0)
  // A late ping does not bring it back.
  assert.equal((await ping(a, FAR)).status, 404)
  assert.equal((await rowsOf(a)).length, 0)
  // Also true when nobody read in between: the stale row is refused and removed by the ping itself.
  await start(a, ada)
  tick(LIVE.staleMs + 1000)
  assert.equal((await ping(a, FAR)).status, 404)
  assert.equal((await rowsOf(a)).length, 0)
  // A walk that keeps sending still ends after 12 hours.
  await start(a, ada)
  for (let i = 0; i < 73; i++) { tick(LIVE.staleMs - 1000); await ping(a, FAR) }
  assert.deepEqual(await friends(b), [])
  assert.equal((await rowsOf(a)).length, 0)
})

test('live: stop deletes the row, and so does saving an outing', async () => {
  const { a, b, ada } = await pair()
  await start(a, ada)
  tick(6000); await ping(a, FAR)
  assert.equal((await friends(b)).length, 1)
  assert.deepEqual((await call('POST', '/api/live/stop', { token: a.token })).json, { ok: true, sharing: false })
  assert.equal((await rowsOf(a)).length, 0)
  assert.deepEqual(await friends(b), [])
  // Stopping twice is fine.
  assert.equal((await call('POST', '/api/live/stop', { token: a.token })).status, 200)
  // Finishing and saving the walk ends sharing without a separate stop.
  await start(a, ada)
  tick(6000); await ping(a, FAR)
  assert.equal((await rowsOf(a)).length, 1)
  assert.equal((await call('POST', `/api/dogs/${ada.slug}/walks`, { token: a.token, body: { title: 'Walk', minutes: 10, miles: 0.4 } })).status, 201)
  assert.equal((await rowsOf(a)).length, 0)
  assert.deepEqual(await friends(b), [])
  // Somebody else stopping does not touch this person's walk.
  await start(a, ada)
  await call('POST', '/api/live/stop', { token: b.token })
  assert.equal((await rowsOf(a)).length, 1)
  await call('POST', '/api/live/stop', { token: a.token })
})

test('live: only the latest position is kept, rounded to 5 decimals stored and 4 returned', async () => {
  const { a, b, ada } = await pair()
  await start(a, ada)
  const spots = [{ lat: 35.203123456, lng: -80.840687654 }, { lat: 35.204567891, lng: -80.841234567 }, { lat: 35.205555555, lng: -80.842222222 }]
  for (const s of spots) { tick(6000); assert.equal((await ping(a, s)).json.visible, true) }
  const all = (await db.query('SELECT * FROM live_walks')).rows.filter((r) => r.user_id === a.id)
  assert.equal(all.length, 1, 'one row per walker')
  assert.equal(all[0].lat, 35.20556); assert.equal(all[0].lng, -80.84222)
  // The start is stored rounded as well.
  await start(a, ada, { lat: 35.200004444, lng: -80.839995555 })
  const again = await rowsOf(a)
  assert.equal(again.length, 1, 'starting again replaces the row')
  assert.equal(again[0].start_lat, 35.2); assert.equal(again[0].start_lng, -80.84); assert.equal(again[0].lat, null)
  tick(6000); await ping(a, spots[2])
  const f = (await friends(b))[0]
  assert.deepEqual(f.position, { lat: 35.2056, lng: -80.8422 })
  // No earlier position is anywhere in the answer or in the table.
  const dump = JSON.stringify(await friends(b)) + JSON.stringify((await db.query('SELECT * FROM live_walks')).rows)
  for (const gone of ['35.2031', '35.2045', '35.2046', '80.8407', '80.8412']) assert.ok(!dump.includes(gone), gone)
  // Rounding never moves a point back into the hidden zone: this one is 150.1 m away as stored and 145.7 m as rounded.
  assert.ok(metres([35.20134, -80.8402], [START.lat, START.lng]) > 150)
  assert.equal(inZone(35.20134, -80.8402, [[START.lat, START.lng]]), true)
  tick(6000)
  assert.equal((await ping(a, { lat: 35.20134, lng: -80.8402 })).json.visible, false)
  assert.equal((await friends(b))[0].position, null)
  await call('POST', '/api/live/stop', { token: a.token })
})

test('live: pings under 5 seconds apart are ignored', async () => {
  const { a, b, ada } = await pair()
  await start(a, ada)
  assert.equal((await ping(a, FAR)).json.ignored, undefined, 'the first ping after a start counts')
  tick(2000)
  assert.deepEqual((await ping(a, { lat: 35.21, lng: -80.85 })).json, { ok: true, ignored: true, visible: true })
  assert.deepEqual((await friends(b))[0].position, { lat: 35.2031, lng: -80.8407 })
  tick(3500)
  assert.equal((await ping(a, { lat: 35.21, lng: -80.85 })).json.ignored, undefined)
  assert.deepEqual((await friends(b))[0].position, { lat: 35.21, lng: -80.85 })
  await call('POST', '/api/live/stop', { token: a.token })
})

test('live: bad input is rejected and stores nothing', async () => {
  const { a, b, ada, bo } = await pair()
  const tryStart = (body) => call('POST', '/api/live/start', { token: a.token, body })
  const ok = { dog: ada.slug, activity: 'Walk', source: 'gps', ...START }
  for (const bad of [
    { ...ok, lat: 91 }, { ...ok, lat: -90.5 }, { ...ok, lng: 181 }, { ...ok, lng: -180.01 }, { ...ok, lat: '35.2' }, { ...ok, lng: null }, { ...ok, lat: undefined },
    { ...ok, lat: NaN }, { ...ok, activity: 'Daycare' }, { ...ok, activity: 'Teleport' }, { ...ok, dog: 42 }, { ...ok, dog: undefined }, { ...ok, elapsedSeconds: -5 }, { ...ok, elapsedSeconds: 1e9 },
    // Rule 8: anything that does not say it is real GPS cannot be shared, demo playback included.
    { ...ok, source: 'demo' }, { ...ok, source: 'playback' }, { ...ok, source: undefined },
  ]) assert.equal((await tryStart(bad)).status, 400, JSON.stringify(bad))
  assert.equal((await call('POST', '/api/live/start', { token: a.token, body: [1, 2] })).status, 400)
  assert.equal((await tryStart({ ...ok, dog: 'no-such-dog-here' })).status, 404)
  // Somebody else's dog cannot be shared.
  assert.equal((await tryStart({ ...ok, dog: bo.slug })).status, 403)
  assert.equal((await rowsOf(a)).length, 0)
  assert.deepEqual(await friends(b), [])
  assert.equal((await tryStart(ok)).status, 201)
  tick(6000); await ping(a, FAR)
  for (const bad of [{ lat: 91, lng: 0 }, { lat: 0, lng: 200 }, { lat: '35.2031', lng: -80.84 }, { lat: 35.2 }, {}, { lat: null, lng: null }, { lat: [35.2], lng: -80.84 }]) {
    tick(6000)
    assert.equal((await ping(a, bad)).status, 400, JSON.stringify(bad))
  }
  assert.equal((await call('POST', '/api/live/ping', { token: a.token, body: 'nope' })).status, 400)
  // The last good position is untouched.
  assert.deepEqual((await friends(b))[0].position, { lat: 35.2031, lng: -80.8407 })
  // The elapsed time is used for "minutes out".
  assert.equal((await tryStart({ ...ok, elapsedSeconds: 600 })).status, 201)
  assert.equal((await friends(b))[0].minutesOut, 10)
  await call('POST', '/api/live/stop', { token: a.token })
})

test('live: the nearest listed place is named within 75 m, by name only, and never near home', async () => {
  const { a, b, ada } = await pair()
  const add = (id, name, lat, lng) => db.query('INSERT INTO places (id, name, category, lat, lng, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, name, 'park', lat, lng, 'secret note', new Date().toISOString()])
  const k = crypto.randomUUID()
  await add(k + '1', 'Freedom Park', 35.2035, -80.8407) // about 42 m from FAR
  await add(k + '2', 'Far Cafe', 35.2045, -80.8407) // about 150 m from FAR
  await add(k + '3', 'Home Bakery', NEAR.lat, NEAR.lng) // inside the hidden zone
  await start(a, ada)
  tick(6000); await ping(a, FAR)
  let f = (await friends(b))[0]
  assert.equal(f.place, 'Freedom Park')
  assert.ok(!JSON.stringify(f).includes('secret note'))
  tick(6000); await ping(a, { lat: 35.2075, lng: -80.8407 })
  assert.equal((await friends(b))[0].place, null)
  tick(6000); await ping(a, NEAR)
  f = (await friends(b))[0]
  assert.equal(f.position, null); assert.equal(f.place, null)
  await call('POST', '/api/live/stop', { token: a.token })
})

test('live: positions never reach public pages, the heatmap, notifications, usage events or the logs', async () => {
  const { a, b, ada } = await pair()
  const before = { n: (await db.query('SELECT id FROM notifications')).rows.length, u: (await db.query('SELECT id FROM usage_events')).rows.length }
  const at = { lat: 35.20777, lng: -80.84333 }
  await start(a, ada, { lat: 35.19999, lng: -80.83999 })
  tick(6000); await ping(a, at)
  assert.deepEqual((await friends(b))[0].position, { lat: 35.2078, lng: -80.8433 })
  const marks = ['35.2077', '35.2078', '80.8433', '35.1999', '80.8399', 'lastSeenSeconds', 'minutesOut']
  for (const p of ['/api/heat', `/d/${ada.slug}`, `/d/${ada.slug}?add=1`, `/api/public/dogs/${ada.slug}`, '/api/pack', '/api/leaderboards', '/api/places?s=35.1&w=-80.9&n=35.3&e=-80.8', '/api/health', '/api/config']) {
    const r = await call('GET', p)
    assert.ok(r.status === 200, `${p} ${r.status}`)
    for (const m of marks) assert.ok(!r.text.includes(m), `${p} leaks ${m}`)
  }
  // Signed in, the walker's own dog, feed and friends list say nothing about it either, and neither does the friend's.
  for (const [u, p] of [[a, `/api/dogs/${ada.slug}`], [a, '/api/feed'], [a, '/api/me'], [b, `/api/dogs/${(await call('GET', '/api/me', { token: b.token })).json.dogs[0].slug}/friends`], [b, '/api/notifications']]) {
    const r = await call('GET', p, { token: u.token })
    assert.equal(r.status, 200, p)
    for (const m of marks.slice(0, 5)) assert.ok(!r.text.includes(m), `${p} leaks ${m}`)
  }
  // No notification and no usage row was written by starting, pinging or reading.
  assert.equal((await db.query('SELECT id FROM notifications')).rows.length, before.n)
  assert.equal((await db.query('SELECT id FROM usage_events')).rows.length, before.u)
  // The usage list has the two names and neither keeps any property, so a coordinate has nowhere to go.
  assert.deepEqual(USAGE_EVENTS.live_share_started, {}); assert.deepEqual(USAGE_EVENTS.live_share_stopped, {}); assert.deepEqual(USAGE_EVENTS.live_friend_opened, {})
  const u = await call('POST', '/api/usage', { body: { v: 'test', auth: a.token, events: [{ name: 'live_share_started', props: { lat: at.lat, lng: at.lng, at: '35.20777,-80.84333' } }] } })
  assert.equal(u.status, 204)
  const ev = (await db.query("SELECT props FROM usage_events WHERE name = 'live_share_started'")).rows
  assert.ok(ev.length >= 1)
  for (const e of ev) assert.ok(!/35\.2|80\.8|lat|lng/.test(String(e.props)), String(e.props))
  // A request the server rejects is not logged with its body either.
  tick(6000); await ping(a, { lat: 35.20777, lng: 999 })
  await call('POST', '/api/live/stop', { token: a.token })
  const out = logged.join('\n')
  for (const m of ['35.20', '80.84', '35.19', '80.83']) assert.ok(!out.includes(m), `a log line carries ${m}`)
})

test('live: the app only offers sharing for real Live GPS on an account', () => {
  assert.equal(canShareLive({ account: true, live: true, timed: false }), true)
  // Demo playback of a planned or sample route, a timed session, and the no-account demo.
  assert.equal(canShareLive({ account: true, live: false, timed: false }), false)
  assert.equal(canShareLive({ account: true, live: true, timed: true }), false)
  assert.equal(canShareLive({ account: false, live: true, timed: false }), false)
  assert.equal(canShareLive(), false)
  // The Today line stays empty when nobody is out.
  assert.equal(todayLine([]), '')
  assert.equal(todayLine([{ name: 'Moose', position: { lat: 1, lng: 2 }, place: 'Freedom Park', lastSeenSeconds: 10 }]), 'Moose is at Freedom Park now')
  assert.equal(todayLine([{ name: 'Moose', position: null, place: null, lastSeenSeconds: 10 }]), 'Moose is out on a walk now')
  assert.equal(todayLine([{ name: 'Moose', position: null }, { name: 'Juno', position: null }]), '2 friends are out now')
  assert.equal(lastSeenText({ lastSeenSeconds: 90 }), '')
  assert.equal(lastSeenText({ lastSeenSeconds: 200 }), 'Last seen 3 min ago')
  // Copy rules: three short lines, no em dashes, none of the banned words.
  assert.equal(SHARE_RULES.length, 3)
  for (const s of [...SHARE_RULES, shareHelp('Ada'), DEMO_SHARE_NOTE]) { assert.ok(!/\u2014|seamless|leverage|unlock/i.test(s), s); assert.ok(s.length < 130, s) }
})

test('guided walk: an outing started from a saved route keeps its own recorded track and counts on the route', async () => {
  const a = await signIn('Gus Guide'), dog = await makeDog(a.token, 'Gia')
  const planned = [[35.2, -80.84], [35.201, -80.84], [35.202, -80.84], [35.203, -80.84]]
  const made = await call('POST', '/api/routes', { token: a.token, body: { name: 'Planned line', points: planned, favorite: true, dog: dog.slug, kind: 'built' } })
  assert.equal(made.status, 201, made.text)
  const id = made.json.route.id
  assert.equal(made.json.route.timesWalked, 0)
  // What the phone actually recorded: near the plan, but not the plan.
  const walkedPts = [[35.20002, -80.84011], [35.20098, -80.84032], [35.20201, -80.83975], [35.20305, -80.84019]]
  const w = await call('POST', `/api/dogs/${dog.slug}/walks`, { token: a.token, body: { title: 'Planned line', place: 'Planned line', minutes: 12, miles: 0.21, route: walkedPts, routeId: id } })
  assert.equal(w.status, 201, w.text)
  assert.equal(w.json.walk.routeId, id)
  const got = await call('GET', `/api/walks/${w.json.walk.id}`, { token: a.token })
  assert.deepEqual(got.json.walk.route, walkedPts, 'the saved line is the one that was walked')
  assert.notDeepEqual(got.json.walk.route, planned)
  const rt = await call('GET', `/api/routes/${id}`, { token: a.token })
  assert.equal(rt.json.route.timesWalked, 1)
  assert.deepEqual(rt.json.route.points, planned, 'the planned route is unchanged')
  // Recorded without GPS: no line at all, the planned distance, and the route still counts.
  const m = await call('POST', `/api/dogs/${dog.slug}/walks`, { token: a.token, body: { title: 'Planned line', minutes: 15, miles: 0.21, route: null, routeId: id } })
  assert.equal(m.status, 201, m.text)
  assert.equal((await call('GET', `/api/walks/${m.json.walk.id}`, { token: a.token })).json.walk.route, null)
  assert.equal((await call('GET', `/api/routes/${id}`, { token: a.token })).json.route.timesWalked, 2)
})

test('guided walk: distance from the planned line, and plain words when there is no GPS', () => {
  const line = [[35.2, -80.84], [35.21, -80.84]]
  assert.ok(metresToLine([35.205, -80.84], line) < 1)
  const d = metresToLine([35.205, -80.8389], line) // about 100 m east of the line
  assert.ok(d > 95 && d < 105, String(d))
  assert.ok(d > OFF_ROUTE_M)
  assert.ok(metresToLine([35.205, -80.8395], line) < OFF_ROUTE_M) // about 45 m
  // Past the end of the line the distance is to the end point, not to the line carried on.
  const e = metresToLine([35.211, -80.84], line)
  assert.ok(e > 105 && e < 117, String(e))
  assert.equal(metresToLine([35.2, -80.84], []), Infinity)
  for (const why of ['denied', 'timeout', 'unsupported', 'unavailable']) { const t = noGpsText(why); assert.match(t, /without GPS/); assert.ok(!/\u2014|seamless|leverage|unlock/i.test(t)) }
  assert.match(noGpsText('denied'), /turned off/)
})
