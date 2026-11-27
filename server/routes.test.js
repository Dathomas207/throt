// Saved routes (favorites, the usual walk, recents, saving the route of an outing) and the pure editing
// functions behind the route builder. Loaded by server/index.js under `node --test server/`.
// Uses its own pg-mem database. Nothing here touches the network: the editor's router is a fake.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createDb } from './db.js'
import { createApp } from './app.js'
import { ROUTE_LIMITS, similarRoutes, distinctRecents, sampleLine, lineMiles as serverMiles } from './routesSavedRoutes.js'
import * as E from '../src/routeEdit.js'
import { parseLegs, routeLegs, routeLeg, suggestRoute, osrmLegsUrl, legKey, cleanSaved, addSaved } from '../src/routing.js'

let db, server, base
const tag = crypto.randomBytes(4).toString('hex')
const mail = (n) => `${n}-${tag}@example.com`
const RATE = { sessionMax: 100000, writeMax: 100000, readMax: 100000, searchMax: 100000 }
before(async () => {
  db = await createDb()
  server = createApp({ db, rate: RATE }).listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => { await new Promise((r) => server.close(r)); await db.close() })

async function call(method, p, { token, body } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const txt = await res.text()
  let json = null
  try { json = JSON.parse(txt) } catch (e) {}
  return { status: res.status, json, text: txt }
}
const signIn = async (name, n) => { const r = await call('POST', '/api/session', { body: { name, email: mail(n) } }); assert.ok(r.status === 200 || r.status === 201, r.text); return { token: r.json.token, id: r.json.user.id } }
const makeDog = async (token, name) => { const r = await call('POST', '/api/dogs', { token, body: { name, breed: 'Mixed', weight: 40, bio: '' } }); assert.equal(r.status, 201, r.text); return r.json.dog }
const join = async (ownerToken, slug, role, name, n) => {
  const inv = await call('POST', `/api/dogs/${slug}/invites`, { token: ownerToken, body: { role } })
  assert.equal(inv.status, 201, inv.text)
  const u = await signIn(name, n)
  assert.equal((await call('POST', `/api/invites/${inv.json.token}/accept`, { token: u.token })).status, 200)
  return u
}
// A square loop of about `side` degrees from a corner, with points every few meters like a recording.
const square = (lat, lng, side = 0.004, per = 12) => {
  const c = [[lat, lng], [lat + side, lng], [lat + side, lng + side], [lat, lng + side], [lat, lng]], out = []
  for (let i = 1; i < c.length; i++) for (let k = i === 1 ? 0 : 1; k <= per; k++) out.push([c[i - 1][0] + ((c[i][0] - c[i - 1][0]) * k) / per, c[i - 1][1] + ((c[i][1] - c[i - 1][1]) * k) / per])
  return out
}
const shift = (pts, dLat, dLng = 0) => pts.map((p) => [p[0] + dLat, p[1] + dLng])
const LOOP = square(35.19, -80.84)
const walk = async (token, slug, extra = {}) => {
  const r = await call('POST', `/api/dogs/${slug}/walks`, { token, body: { type: 'Walk', title: 'Morning loop', minutes: 30, miles: 1.1, route: LOOP, ...extra } })
  assert.equal(r.status, 201, r.text)
  return r.json.walk
}
const save = async (token, extra = {}) => call('POST', '/api/routes', { token, body: { name: 'Park loop', points: LOOP, ...extra } })

// ---- the API ----------------------------------------------------------------
test('routes: sign-in is needed, and a saved route comes back with its line, length and time', async () => {
  for (const [m, p] of [['GET', '/api/routes'], ['POST', '/api/routes'], ['PATCH', `/api/routes/${crypto.randomUUID()}`], ['DELETE', `/api/routes/${crypto.randomUUID()}`], ['POST', `/api/walks/${crypto.randomUUID()}/route`]]) assert.equal((await call(m, p, { body: m === 'GET' || m === 'DELETE' ? undefined : {} })).status, 401, `${m} ${p}`)
  const a = await signIn('Ada', 'r-ada')
  const control = { points: [LOOP[0], LOOP[12], LOOP[24], LOOP[36], LOOP[0]], modes: ['path', 'straight', 'path', 'path'] }
  const r = await save(a.token, { control, name: '  Park   loop ' })
  assert.equal(r.status, 201, r.text)
  const rt = r.json.route
  assert.equal(rt.name, 'Park loop')
  assert.equal(rt.kind, 'built')
  assert.equal(rt.favorite, false)
  assert.equal(rt.usual, false)
  assert.equal(rt.timesWalked, 0)
  assert.equal(rt.lastWalkedAt, null)
  assert.equal(rt.points.length, LOOP.length)
  assert.deepEqual(rt.control, { points: control.points.map((p) => p.map((v) => Math.round(v * 1e5) / 1e5)), modes: control.modes })
  // Length is measured from the line by the server, and the time is 20 minutes a mile.
  assert.ok(Math.abs(rt.miles - serverMiles(LOOP)) < 0.01, String(rt.miles))
  assert.equal(rt.minutes, Math.max(1, Math.round(rt.miles * 20)))
  // The start is kept rounded to four places, about 10 m.
  assert.deepEqual(rt.start, [35.19, -80.84])
  const list = await call('GET', '/api/routes', { token: a.token })
  assert.equal(list.status, 200)
  assert.equal(list.json.routes.length, 1)
  assert.equal(list.json.max, ROUTE_LIMITS.perUser)
  assert.equal(list.json.routes[0].editable, true)
  assert.equal(list.json.routes[0].control, undefined, 'lists do not carry control points')
  assert.equal((await call('GET', `/api/routes/${rt.id}`, { token: a.token })).json.route.control.modes[1], 'straight')
})

test('routes: private to the person who saved them, care team included', async () => {
  const owner = await signIn('Owner', 'r-own'), dog = await makeDog(owner.token, 'Maple')
  const fam = await join(owner.token, dog.slug, 'family', 'Fam', 'r-fam')
  const stranger = await signIn('Stranger', 'r-str')
  const id = (await save(owner.token, { dog: dog.slug, favorite: true })).json.route.id
  for (const u of [fam, stranger]) {
    assert.equal((await call('GET', '/api/routes', { token: u.token })).json.routes.length, 0)
    assert.equal((await call('GET', `/api/routes/${id}`, { token: u.token })).status, 404)
    assert.equal((await call('PATCH', `/api/routes/${id}`, { token: u.token, body: { name: 'Mine now' } })).status, 404)
    assert.equal((await call('DELETE', `/api/routes/${id}`, { token: u.token })).status, 404)
  }
  assert.equal((await call('GET', `/api/routes/${id}`, { token: owner.token })).json.route.name, 'Park loop')
  // A dog you are not on the team of cannot be attached to a route.
  assert.equal((await save(stranger.token, { dog: dog.slug })).status, 403)
  // Nothing about saved routes shows on the dog or its feed for the rest of the team.
  const d = await call('GET', `/api/dogs/${dog.slug}`, { token: fam.token })
  assert.ok(!JSON.stringify(d.json).includes(id))
  assert.equal((await call('GET', '/api/routes/not-an-id', { token: owner.token })).status, 404)
})

test('routes: points and control points are validated', async () => {
  const a = await signIn('Val', 'r-val')
  const bad = async (body, re) => { const r = await call('POST', '/api/routes', { token: a.token, body }); assert.equal(r.status, 400, r.text); if (re) assert.match(r.json.error, re) }
  await bad({ name: 'x' }, /list/)
  await bad({ points: [[35, -80]] }, /two points/)
  await bad({ points: [[35, -80], [91, -80]] }, /valid coordinate/)
  await bad({ points: [[35, -80], ['35', -80]] }, /valid coordinate/)
  await bad({ points: [[35, -80], [35, -80, 1]] }, /pairs/)
  await bad({ points: [[35, -80], [35, -80]] }, /no length/)
  await bad({ points: Array.from({ length: ROUTE_LIMITS.points + 1 }, (_, i) => [35 + i * 1e-5, -80]) }, /2000/)
  await bad({ points: LOOP, kind: 'stolen' }, /built or walked/)
  await bad({ points: LOOP, favorite: 'yes' }, /true or false/)
  await bad({ points: LOOP, name: 'n'.repeat(61) }, /60/)
  await bad({ points: LOOP, control: { points: [LOOP[0], LOOP[5]], modes: [] } }, /mode/)
  await bad({ points: LOOP, control: { points: [LOOP[0], LOOP[5]], modes: ['fly'] } }, /mode/)
  await bad({ points: LOOP, control: { points: [LOOP[0]], modes: [] } }, /Control points/)
  await bad({ points: LOOP, control: { points: Array.from({ length: 27 }, (_, i) => [35 + i * 1e-4, -80]), modes: Array(26).fill('path') } }, /Control points/)
  await bad({ points: LOOP, clientId: 'has spaces' }, /clientId/)
  // Exactly the cap is fine, and a route with no name gets one from its length.
  const ok = await call('POST', '/api/routes', { token: a.token, body: { points: Array.from({ length: ROUTE_LIMITS.points }, (_, i) => [35 + i * 1e-5, -80]) } })
  assert.equal(ok.status, 201, ok.text)
  assert.match(ok.json.route.name, /^\d+\.\d mi route$/)
  assert.equal(ok.json.route.pointCount, ROUTE_LIMITS.points)
  assert.equal((await call('GET', '/api/routes', { token: a.token })).json.routes[0].points.length, ROUTE_LIMITS.listPoints)
  for (const q of ['filter=mine', 'near=here', 'near=95,10']) assert.equal((await call('GET', `/api/routes?${q}`, { token: a.token })).status, 400, q)
})

test('routes: rename, re-edit, favorite and delete', async () => {
  const a = await signIn('Edie', 'r-edit')
  const id = (await save(a.token, { control: { points: [LOOP[0], LOOP[24], LOOP[0]], modes: ['path', 'path'] } })).json.route.id
  const p = (body) => call('PATCH', `/api/routes/${id}`, { token: a.token, body })
  assert.equal((await p({})).status, 400)
  assert.equal((await p({ name: '' })).status, 400)
  assert.equal((await p({ name: 'Creek loop' })).json.route.name, 'Creek loop')
  assert.equal((await p({ favorite: true })).json.route.favorite, true)
  assert.equal((await call('GET', '/api/routes?filter=favorites', { token: a.token })).json.routes.length, 1)
  // New points replace the line and its length. Without control points the old ones are dropped.
  const longer = square(35.19, -80.84, 0.008)
  const e = await p({ points: longer })
  assert.equal(e.status, 200, e.text)
  assert.equal(e.json.route.control, null)
  assert.ok(e.json.route.miles > 2)
  assert.equal(e.json.route.favorite, true, 'editing keeps the star')
  assert.equal((await p({ control: { points: [LOOP[0], LOOP[5]], modes: ['path'] } })).status, 400)
  assert.equal((await p({ points: [[1, 2]] })).status, 400)
  assert.equal((await p({ favorite: false })).json.route.favorite, false)
  assert.equal((await call('GET', '/api/routes?filter=favorites', { token: a.token })).json.routes.length, 0)
  assert.equal((await call('DELETE', `/api/routes/${id}`, { token: a.token })).status, 200)
  assert.equal((await call('GET', `/api/routes/${id}`, { token: a.token })).status, 404)
  assert.equal((await call('DELETE', `/api/routes/${id}`, { token: a.token })).status, 404)
})

test('routes: the usual walk is one favorite per dog', async () => {
  const a = await signIn('Una', 'r-usual'), maple = await makeDog(a.token, 'Maple'), birch = await makeDog(a.token, 'Birch')
  const other = await signIn('Otto', 'r-usual2'), theirs = await makeDog(other.token, 'Rex')
  const r1 = (await save(a.token, { name: 'One' })).json.route.id, r2 = (await save(a.token, { name: 'Two', favorite: true })).json.route.id, r3 = (await save(a.token, { name: 'Three', favorite: true })).json.route.id
  const p = (id, body) => call('PATCH', `/api/routes/${id}`, { token: a.token, body })
  // Not a favorite yet, no dog named, and someone else's dog are all refused.
  assert.match((await p(r1, { usual: true, dog: maple.slug })).json.error, /favorites first/)
  assert.match((await p(r2, { usual: true })).json.error, /which dog/)
  assert.equal((await p(r2, { usual: true, dog: theirs.slug })).status, 403)
  assert.equal((await p(r2, { usual: 'yes', dog: maple.slug })).status, 400)
  // Starring and marking it usual in one request works.
  const one = await p(r1, { favorite: true, usual: true, dog: maple.slug })
  assert.equal(one.status, 200, one.text)
  assert.deepEqual([one.json.route.usual, one.json.route.favorite, one.json.route.dog.slug], [true, true, maple.slug])
  // A second usual walk for the same dog takes the first one's place.
  assert.equal((await p(r2, { usual: true, dog: maple.slug })).json.route.usual, true)
  const usualOf = async () => Object.fromEntries((await call('GET', '/api/routes', { token: a.token })).json.routes.map((r) => [r.name, r.usual ? r.dog.slug : '']))
  assert.deepEqual(await usualOf(), { One: '', Two: maple.slug, Three: '' })
  // Another dog has its own usual walk.
  assert.equal((await p(r3, { usual: true, dog: birch.slug })).status, 200)
  assert.deepEqual(await usualOf(), { One: '', Two: maple.slug, Three: birch.slug })
  // Taking the star off also stops it being the usual walk.
  const off = await p(r2, { favorite: false })
  assert.deepEqual([off.json.route.favorite, off.json.route.usual], [false, false])
  assert.equal((await p(r3, { usual: false })).json.route.usual, false)
  assert.deepEqual(await usualOf(), { One: '', Two: '', Three: '' })
})

test('routes: the cap is 200 per person', async () => {
  const a = await signIn('Cap', 'r-cap'), dog = await makeDog(a.token, 'Capper'), w = await walk(a.token, dog.slug)
  const now = new Date().toISOString(), pts = JSON.stringify([[35, -80], [35.001, -80]])
  for (let i = 0; i < ROUTE_LIMITS.perUser - 1; i++) await db.query('INSERT INTO routes (id, user_id, name, kind, points, miles, minutes, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)', [crypto.randomUUID(), a.id, `R${i}`, 'built', pts, 0.07, 1, now])
  assert.equal((await save(a.token, { clientId: 'last-one' })).status, 201)
  const over = await save(a.token)
  assert.equal(over.status, 400)
  assert.match(over.json.error, /up to 200 saved routes/)
  assert.equal((await call('POST', `/api/walks/${w.id}/route`, { token: a.token })).status, 400)
  // A route that is already there still answers, and deleting one makes room again.
  assert.equal((await save(a.token, { clientId: 'last-one' })).status, 200)
  const list = (await call('GET', '/api/routes', { token: a.token })).json.routes
  assert.equal(list.length, ROUTE_LIMITS.perUser)
  assert.equal((await call('DELETE', `/api/routes/${list[0].id}`, { token: a.token })).status, 200)
  assert.equal((await save(a.token)).status, 201)
  // Somebody else's count is their own.
  assert.equal((await save((await signIn('Cap Two', 'r-cap2')).token)).status, 201)
})

test('routes: saving the route of an outing needs a place on the care team', async () => {
  const owner = await signIn('Olive', 'r-walk-own'), dog = await makeDog(owner.token, 'Juniper')
  const walker = await join(owner.token, dog.slug, 'walker', 'Wes', 'r-walk-wes')
  const stranger = await signIn('Sam', 'r-walk-sam')
  const w = await walk(walker.token, dog.slug, { title: 'Greenway with Wes' })
  // The owner did not record it but is on the team: allowed, and the route is the owner's alone.
  const r = await call('POST', `/api/walks/${w.id}/route`, { token: owner.token, body: { favorite: true } })
  assert.equal(r.status, 201, r.text)
  assert.deepEqual([r.json.route.kind, r.json.route.favorite, r.json.route.sourceWalkId, r.json.route.timesWalked, r.json.route.name, r.json.route.dog.slug], ['walked', true, w.id, 1, 'Greenway with Wes', dog.slug])
  assert.equal(r.json.route.control, null)
  assert.equal(r.json.route.lastWalkedAt, w.startedAt)
  assert.equal((await call('GET', '/api/routes', { token: walker.token })).json.routes.length, 0)
  // Asking again gives the same route rather than a copy.
  const again = await call('POST', `/api/walks/${w.id}/route`, { token: owner.token })
  assert.deepEqual([again.status, again.json.route.id, again.json.already], [200, r.json.route.id, true])
  // The walker saves their own copy without the star, then stars it by asking again.
  const mine = await call('POST', `/api/walks/${w.id}/route`, { token: walker.token, body: {} })
  assert.deepEqual([mine.status, mine.json.route.favorite], [201, false])
  assert.notEqual(mine.json.route.id, r.json.route.id)
  assert.equal((await call('POST', `/api/walks/${w.id}/route`, { token: walker.token, body: { favorite: true } })).json.route.favorite, true)
  // Not on the team: the outing does not exist as far as they can tell.
  assert.equal((await call('POST', `/api/walks/${w.id}/route`, { token: stranger.token })).status, 404)
  assert.equal((await call('POST', '/api/walks/nope/route', { token: owner.token })).status, 404)
  assert.equal((await call('POST', `/api/walks/${w.id}/route`, { token: owner.token, body: { favorite: 1 } })).status, 400)
  // An outing with no line has nothing to save.
  const timed = await call('POST', `/api/dogs/${dog.slug}/walks`, { token: owner.token, body: { type: 'Fetch', title: 'Fetch', minutes: 10 } })
  assert.match((await call('POST', `/api/walks/${timed.json.walk.id}/route`, { token: owner.token })).json.error, /no recorded route/)
  // Deleting the outing leaves the saved route in place, no longer pointing at it.
  assert.equal((await call('DELETE', `/api/walks/${w.id}`, { token: owner.token })).status, 200)
  assert.equal((await call('GET', `/api/routes/${r.json.route.id}`, { token: owner.token })).json.route.sourceWalkId, null)
})

test('routes: an outing started from a saved route is linked to it and counted', async () => {
  const a = await signIn('Lin', 'r-link'), dog = await makeDog(a.token, 'Pepper')
  const b = await join(a.token, dog.slug, 'family', 'Bo', 'r-link-bo')
  const id = (await save(a.token)).json.route.id
  const w1 = await walk(a.token, dog.slug, { routeId: id })
  assert.equal(w1.routeId, id)
  let rt = (await call('GET', `/api/routes/${id}`, { token: a.token })).json.route
  assert.deepEqual([rt.timesWalked, rt.lastWalkedAt], [1, w1.startedAt])
  // An older outing logged afterwards counts, and does not move "last walked" backwards.
  await walk(a.token, dog.slug, { routeId: id, startedAt: new Date(Date.now() - 3 * 864e5).toISOString() })
  rt = (await call('GET', `/api/routes/${id}`, { token: a.token })).json.route
  assert.deepEqual([rt.timesWalked, rt.lastWalkedAt], [2, w1.startedAt])
  // Someone else's route id is ignored: their outing is saved, unlinked, and the count does not move.
  const w3 = await walk(b.token, dog.slug, { routeId: id })
  assert.equal(w3.routeId, undefined)
  assert.equal((await call('GET', `/api/routes/${id}`, { token: a.token })).json.route.timesWalked, 2)
  // The link is only shown to the person who walked it.
  assert.equal((await call('GET', `/api/walks/${w1.id}`, { token: b.token })).json.walk.routeId, undefined)
  assert.equal((await call('GET', `/api/walks/${w1.id}`, { token: a.token })).json.walk.routeId, id)
  assert.equal((await call('POST', `/api/dogs/${dog.slug}/walks`, { token: a.token, body: { type: 'Walk', title: 'x', minutes: 5, routeId: 'nope' } })).status, 400)
  // Deleting the route unlinks its outings and keeps them.
  assert.equal((await call('DELETE', `/api/routes/${id}`, { token: a.token })).status, 200)
  const kept = (await call('GET', `/api/walks/${w1.id}`, { token: a.token })).json.walk
  assert.equal(kept.routeId, undefined)
  assert.equal(kept.route.length, LOOP.length)
})

test('routes: recents are the distinct routes a person walked, newest first', async () => {
  const a = await signIn('Rae', 'r-recent'), dog = await makeDog(a.token, 'Sorrel')
  const b = await join(a.token, dog.slug, 'walker', 'Wyn', 'r-recent-wyn')
  const ago = (d) => new Date(Date.now() - d * 864e5).toISOString()
  const far = square(35.22, -80.80)
  await walk(a.token, dog.slug, { title: 'Old far loop', route: far, startedAt: ago(5) })
  await walk(a.token, dog.slug, { title: 'Loop, first time', startedAt: ago(4) })
  // The same loop again a few meters off, as GPS would record it.
  await walk(a.token, dog.slug, { title: 'Loop, wobbly', route: shift(LOOP, 0.00008, -0.00006), startedAt: ago(2) })
  const newest = await walk(a.token, dog.slug, { title: 'Loop again', startedAt: ago(1) })
  await walk(a.token, dog.slug, { title: 'No line', route: null, startedAt: ago(0.5) })
  await walk(b.token, dog.slug, { title: 'Walker elsewhere', route: square(35.3, -80.7), startedAt: ago(0.2) })
  const r = await call('GET', '/api/routes?filter=recent', { token: a.token })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.json.routes.map((x) => [x.name, x.timesWalked]), [['Loop again', 3], ['Old far loop', 1]])
  const top = r.json.routes[0]
  assert.deepEqual([top.kind, top.walkId, top.id, top.dog.name, top.saved, top.startedAt], ['recent', newest.id, 'walk:' + newest.id, 'Sorrel', null, newest.startedAt])
  assert.ok(top.points.length > 1 && top.miles > 0.5)
  // Recents are not saved rows until the person saves or stars one.
  assert.equal((await call('GET', '/api/routes', { token: a.token })).json.routes.length, 0)
  const starred = await call('POST', `/api/walks/${newest.id}/route`, { token: a.token, body: { favorite: true } })
  assert.equal(starred.status, 201)
  const after = (await call('GET', '/api/routes?filter=recent', { token: a.token })).json.routes
  assert.deepEqual(after[0].saved, { id: starred.json.route.id, name: 'Loop again', favorite: true, usual: false })
  assert.equal(after[1].saved, null)
  // The walker only sees what the walker walked.
  assert.deepEqual((await call('GET', '/api/routes?filter=recent', { token: b.token })).json.routes.map((x) => x.name), ['Walker elsewhere'])
  // At most ten, however many different places were walked.
  const c = await signIn('Many', 'r-recent-many'), d2 = await makeDog(c.token, 'Roamer')
  for (let i = 0; i < 12; i++) await walk(c.token, d2.slug, { title: `Place ${i}`, route: square(35 + i * 0.02, -80.9), startedAt: ago(12 - i) })
  const many = (await call('GET', '/api/routes?filter=recent', { token: c.token })).json.routes
  assert.equal(many.length, ROUTE_LIMITS.recents)
  assert.equal(many[0].name, 'Place 11')
})

test('routes: near sorts by distance from a point', async () => {
  const a = await signIn('Nia', 'r-near')
  await save(a.token, { name: 'Far', points: square(35.4, -80.84) })
  await save(a.token, { name: 'Close', points: square(35.191, -80.84) })
  await save(a.token, { name: 'Middle', points: square(35.25, -80.84) })
  const r = await call('GET', '/api/routes?near=35.19,-80.84', { token: a.token })
  assert.deepEqual(r.json.routes.map((x) => x.name), ['Close', 'Middle', 'Far'])
  assert.ok(r.json.routes[0].distance < 0.2 && r.json.routes[2].distance > 10)
  assert.equal((await call('GET', '/api/routes', { token: a.token })).json.routes[0].distance, undefined)
})

test('routes: moving local routes to the account twice makes no copies', async () => {
  const a = await signIn('Mig', 'r-mig'), other = await signIn('Mig Two', 'r-mig2')
  const local = [{ clientId: 'rabc123', name: 'Device loop', points: LOOP, favorite: true }, { clientId: 'rdef456', name: 'Device walk', points: square(35.2, -80.85), kind: 'walked' }]
  const run = async (token) => { const out = []; for (const body of local) out.push(await call('POST', '/api/routes', { token, body })); return out }
  const first = await run(a.token)
  assert.deepEqual(first.map((r) => r.status), [201, 201])
  const second = await run(a.token)
  assert.deepEqual(second.map((r) => [r.status, r.json.already]), [[200, true], [200, true]])
  assert.deepEqual(second.map((r) => r.json.route.id), first.map((r) => r.json.route.id))
  const list = (await call('GET', '/api/routes', { token: a.token })).json.routes
  assert.equal(list.length, 2)
  assert.deepEqual(list.map((r) => [r.name, r.kind, r.favorite]).sort(), [['Device loop', 'built', true], ['Device walk', 'walked', false]])
  // A change made on the account since is not overwritten by a repeat.
  await call('PATCH', `/api/routes/${first[0].json.route.id}`, { token: a.token, body: { name: 'Renamed' } })
  assert.equal((await run(a.token))[0].json.route.name, 'Renamed')
  // The same device id under another account is that account's own route.
  assert.deepEqual((await run(other.token)).map((r) => r.status), [201, 201])
  assert.equal((await call('GET', '/api/routes', { token: a.token })).json.routes.length, 2)
})

// ---- recents: the similarity rule on its own ----------------------------------
test('similarRoutes: same line with GPS wobble matches; a different start, length or line does not', () => {
  const a = square(35.19, -80.84)
  assert.equal(similarRoutes(a, a), true)
  assert.equal(similarRoutes(a, shift(a, 0.0001, 0.0001)), true, 'about 14 m off')
  assert.equal(similarRoutes(a, a.filter((_, i) => i % 3 === 0 || i === a.length - 1)), true, 'fewer points, same line')
  assert.equal(similarRoutes(a, a.slice().reverse()), true, 'a loop walked the other way round')
  assert.equal(similarRoutes(a, shift(a, 0.002)), false, 'starts 220 m away')
  assert.equal(similarRoutes(a, square(35.19, -80.84, 0.0046)), false, 'a loop 15 percent longer')
  assert.equal(similarRoutes(a, square(35.19, -80.84, 0.0041)), true, 'a loop 2.5 percent longer')
  // Same start and length, different ground: a square to the north-east against one to the south-west.
  assert.equal(similarRoutes(a, square(35.19, -80.84, -0.004)), false)
  // An out and back is not the loop it shares one side with.
  const side = a.slice(0, 13), outBack = [...side, ...side.slice().reverse().slice(1)]
  assert.equal(similarRoutes(a, outBack), false)
  assert.equal(similarRoutes(a, [a[0]]), false)
  assert.equal(similarRoutes(null, a), false)
  assert.equal(sampleLine(a, 9).length, 9)
  assert.deepEqual(sampleLine(a, 9)[8], a[a.length - 1])
})
test('distinctRecents: folds repeats into the newest and stops at the cap', () => {
  const a = square(35.19, -80.84), b = square(35.3, -80.7)
  const g = distinctRecents([{ id: 'w4', pts: a }, { id: 'w3', pts: b, routeId: 'r9' }, { id: 'w2', pts: shift(a, 0.00005) }, { id: 'w1', pts: null }, { id: 'w0', pts: b }])
  assert.deepEqual(g.map((x) => [x.walk.id, x.times, x.walkIds, x.routeIds]), [['w4', 2, ['w4', 'w2'], []], ['w3', 2, ['w3', 'w0'], ['r9']]])
  assert.equal(distinctRecents(Array.from({ length: 15 }, (_, i) => ({ id: 'w' + i, pts: square(35 + i * 0.05, -80) })), 10).length, 10)
})

// ---- the editor's pure functions, with a fake router ---------------------------
// The fake router answers with a three-point dog-leg, so a routed leg can be told from a straight one,
// and it records every pair it was asked for.
const fakeRouter = () => {
  const calls = []
  const router = async (a, b) => { calls.push([a, b]); return { pts: [a, [a[0], b[1]], b], name: `Road ${calls.length}`, roads: [`Road ${calls.length}`] } }
  return { router, calls }
}
const P = (i) => [35 + i * 0.01, -80 + (i % 2) * 0.01]
// A resolved open route through n points.
const built = async (n) => {
  const { router } = fakeRouter()
  let m = E.emptyModel()
  for (let i = 0; i < n; i++) m = E.appendPoint(m, P(i))
  return E.resolveLegs(m, router)
}
const joined = (m) => m.legs.every((l, i) => E.samePt(l.pts[0], m.points[i]) && E.samePt(l.pts[l.pts.length - 1], m.points[i + 1]))

test('routeEdit: appending points routes one new leg at a time', async () => {
  const { router, calls } = fakeRouter()
  let m = E.appendPoint(E.emptyModel(), P(0))
  assert.deepEqual([m.points.length, m.legs.length, E.totalMiles(m)], [1, 0, 0])
  assert.equal(E.appendPoint(m, P(0)), m, 'the same spot twice adds nothing')
  m = E.appendPoint(m, P(1))
  assert.equal(E.hasPending(m), true)
  assert.equal(m.legs[0].pts.length, 2, 'a straight placeholder until the router answers')
  m = await E.resolveLegs(m, router)
  assert.deepEqual([calls.length, m.legs[0].pts.length, m.legs[0].name, E.hasPending(m)], [1, 3, 'Road 1', false])
  m = await E.resolveLegs(E.appendPoint(m, P(2)), router)
  assert.equal(calls.length, 2, 'only the new leg was asked for')
  assert.deepEqual(calls[1], [P(1), P(2)])
  assert.ok(joined(m))
  assert.equal(await E.resolveLegs(m, router), m, 'nothing pending, nothing asked')
  assert.equal(calls.length, 2)
  // The line is each leg in turn with the shared points kept once, and its length is the sum of the legs.
  assert.equal(E.modelLine(m).length, 5)
  assert.ok(Math.abs(E.lineMiles(E.modelLine(m)) - E.totalMiles(m)) < 1e-9)
})

test('routeEdit: moving a point re-routes only the legs on either side of it', async () => {
  const m0 = await built(5), { router, calls } = fakeRouter()
  const moved = E.movePoint(m0, 2, [35.5, -80.5])
  assert.deepEqual(moved.legs.map((l) => !!l.pending), [false, true, true, false])
  assert.equal(moved.legs[0], m0.legs[0], 'untouched legs are the same objects')
  assert.equal(moved.legs[3], m0.legs[3])
  const m = await E.resolveLegs(moved, router)
  assert.deepEqual(calls, [[P(1), [35.5, -80.5]], [[35.5, -80.5], P(3)]])
  assert.equal(m.legs[0], m0.legs[0])
  assert.ok(joined(m))
  // The ends have one neighbour each.
  assert.deepEqual(E.movePoint(m0, 0, [35.4, -80.4]).legs.map((l) => !!l.pending), [true, false, false, false])
  assert.deepEqual(E.movePoint(m0, 4, [35.4, -80.4]).legs.map((l) => !!l.pending), [false, false, false, true])
  assert.equal(E.movePoint(m0, 9, [1, 1]), m0)
  // A loop's start is also its end: both ends move together and the two legs that touch it are re-routed.
  const { router: r2, calls: c2 } = fakeRouter()
  const loop = await E.resolveLegs(E.closeLoop(m0), r2)
  assert.equal(E.isClosed(loop), true)
  const ml = E.movePoint(loop, 0, [35.4, -80.4])
  assert.deepEqual(ml.legs.map((l) => !!l.pending), [true, false, false, false, true])
  assert.deepEqual([ml.points[0], ml.points[5]], [[35.4, -80.4], [35.4, -80.4]])
  assert.equal(c2.length, 1, 'closing the loop asked for the one leg back to the start')
  // A straight leg next to a moved point stays straight and is not sent to the router.
  const { router: r3, calls: c3 } = fakeRouter()
  const withStraight = E.setLegMode(m0, 1, 'straight')
  const ms = await E.resolveLegs(E.movePoint(withStraight, 2, [35.5, -80.5]), r3)
  assert.equal(c3.length, 1)
  assert.deepEqual([ms.legs[1].mode, ms.legs[1].pts.length, ms.legs[2].mode], ['straight', 2, 'path'])
  assert.deepEqual(ms.legs[1].pts[1], [35.5, -80.5])
})

test('routeEdit: tapping a leg inserts a via point there without asking the router', async () => {
  const m0 = await built(3), { router, calls } = fakeRouter()
  const corner = m0.legs[1].pts[1], tap = [corner[0] + 0.0001, corner[1] + 0.00005]
  const near = E.nearestOnRoute(m0, tap)
  assert.equal(near.leg, 1)
  assert.ok(near.d < 0.02)
  const { model: m, index } = E.insertVia(m0, near.leg, tap)
  assert.equal(index, 2)
  assert.deepEqual([m.points.length, m.legs.length, E.hasPending(m)], [4, 4 - 1, false])
  assert.equal(m.legs[0], m0.legs[0])
  assert.ok(joined(m), 'both halves meet at the new point')
  assert.ok(Math.abs(E.totalMiles(m) - E.totalMiles(m0)) < 0.02, 'cutting a line does not change its length')
  assert.equal(m.legs[1].name, m0.legs[1].name)
  assert.equal(calls.length, 0)
  // Dragging the new point onto another road then re-routes its two legs and nothing else.
  await E.resolveLegs(E.movePoint(m, index, [35.3, -80.3]), router)
  assert.deepEqual(calls.map((c) => [c[0], c[1]]), [[P(1), [35.3, -80.3]], [[35.3, -80.3], P(2)]])
  assert.equal(E.insertVia(m0, 7, tap), null)
})

test('routeEdit: at most 25 points', async () => {
  let m = E.emptyModel()
  for (let i = 0; i < 30; i++) m = E.appendPoint(m, [35 + i * 0.001, -80])
  assert.deepEqual([m.points.length, E.countPoints(m), E.canAdd(m)], [E.MAX_POINTS, 25, false])
  assert.equal(E.insertVia(m, 3, m.legs[3].pts[0]), null)
  assert.equal(E.closeLoop(m), m)
  // A loop's closing point is its start again, so it does not use up a place.
  let loop = E.emptyModel()
  for (let i = 0; i < 24; i++) loop = E.appendPoint(loop, [35 + i * 0.001, -80 + (i % 3) * 0.001])
  loop = E.closeLoop(loop)
  assert.deepEqual([loop.points.length, E.countPoints(loop), E.canAdd(loop)], [25, 24, true])
  loop = E.appendPoint(loop, [35.5, -80.5])
  assert.deepEqual([E.countPoints(loop), E.canAdd(loop), E.isClosed(loop)], [25, false, true])
})

test('routeEdit: a tap on a loop adds the point before the return leg', async () => {
  const { router, calls } = fakeRouter()
  const loop = await E.resolveLegs(E.closeLoop(await built(3)), router)
  calls.length = 0
  const m = await E.resolveLegs(E.appendPoint(loop, [35.2, -80.2]), router)
  assert.deepEqual(m.points, [P(0), P(1), P(2), [35.2, -80.2], P(0)])
  assert.deepEqual(calls, [[P(2), [35.2, -80.2]], [[35.2, -80.2], P(0)]])
  assert.equal(m.legs[0], loop.legs[0])
  assert.equal(E.isClosed(m), true)
})

test('routeEdit: removing a point joins its neighbours with one new leg', async () => {
  const m0 = await built(5), { router, calls } = fakeRouter()
  const m = await E.resolveLegs(E.removePoint(m0, 2), router)
  assert.deepEqual(m.points, [P(0), P(1), P(3), P(4)])
  assert.deepEqual(calls, [[P(1), P(3)]])
  assert.equal(m.legs[0], m0.legs[0])
  assert.equal(m.legs[2], m0.legs[3])
  // An end point just drops its leg: nothing to ask for.
  assert.deepEqual([E.removePoint(m0, 0).legs.length, E.hasPending(E.removePoint(m0, 0)), E.removePoint(m0, 4).points.length], [3, false, 4])
  // Two straight legs become one straight leg. A straight and a routed leg become a routed one.
  const ss = E.removePoint(E.setLegMode(E.setLegMode(m0, 1, 'straight'), 2, 'straight'), 2)
  assert.deepEqual([ss.legs[1].mode, !!ss.legs[1].pending], ['straight', false])
  assert.equal(E.removePoint(E.setLegMode(m0, 1, 'straight'), 2).legs[1].pending, true)
  // Down to nothing.
  assert.deepEqual(E.removePoint(E.removePoint(await built(2), 1), 0), E.emptyModel())
  // Removing a loop's start makes the next point the start and closes back to it.
  const loop = await E.resolveLegs(E.closeLoop(m0), router)
  const r = E.removePoint(loop, 0)
  assert.deepEqual(r.points, [P(1), P(2), P(3), P(4), P(1)])
  assert.deepEqual(r.legs.map((l) => !!l.pending), [false, false, false, true])
  assert.equal(r.legs[0], loop.legs[1])
  const tiny = await E.resolveLegs(E.closeLoop(await built(2)), router)
  // Two points closed back to the start is an out and back. Taking its far point away leaves just the start.
  assert.deepEqual([E.isClosed(tiny), tiny.points.length, E.countPoints(tiny)], [true, 3, 2])
  assert.deepEqual(E.removePoint(tiny, 1), { points: [P(0)], legs: [] })
  assert.deepEqual(E.removePoint(tiny, 0), { points: [P(1)], legs: [] })
})

test('routeEdit: reverse flips the line and asks for nothing', async () => {
  const m0 = await built(4)
  const r = E.reverse(m0)
  assert.deepEqual(r.points, [P(3), P(2), P(1), P(0)])
  assert.ok(joined(r))
  assert.equal(E.hasPending(r), false)
  assert.ok(Math.abs(E.totalMiles(r) - E.totalMiles(m0)) < 1e-9)
  assert.deepEqual(r.legs.map((l) => l.name), ['Road 3', 'Road 2', 'Road 1'])
  assert.deepEqual(E.modelLine(r), E.modelLine(m0).slice().reverse())
  assert.deepEqual(E.reverse(r), m0)
  assert.deepEqual(E.reverse(E.setLegMode(m0, 0, 'straight')).legs.map((l) => l.mode), ['path', 'path', 'straight'])
})

test('routeEdit: closing the loop and choosing a new start', async () => {
  const m0 = await built(4), { router, calls } = fakeRouter()
  const open = E.closeLoop(m0)
  assert.deepEqual([open.points.length, open.legs[3].pending, E.isClosed(open)], [5, true, true])
  const loop = await E.resolveLegs(open, router)
  assert.deepEqual(calls, [[P(3), P(0)]])
  assert.equal(E.closeLoop(loop), loop, 'already closed')
  // A loop turned to start somewhere else is the same legs in a new order.
  const turned = E.makeStart(loop, 2)
  assert.deepEqual(turned.points, [P(2), P(3), P(0), P(1), P(2)])
  assert.deepEqual(turned.legs, [loop.legs[2], loop.legs[3], loop.legs[0], loop.legs[1]])
  assert.ok(joined(turned))
  assert.equal(E.hasPending(turned), false)
  assert.ok(Math.abs(E.totalMiles(turned) - E.totalMiles(loop)) < 1e-9)
  assert.equal(E.makeStart(loop, 0), loop)
  // An open route keeps its order of visit: the old end is joined to the old start with one new leg.
  const o = E.makeStart(m0, 2)
  assert.deepEqual(o.points, [P(2), P(3), P(0), P(1)])
  assert.deepEqual(o.legs.map((l) => !!l.pending), [false, true, false])
  assert.equal(o.legs[0], m0.legs[2])
  assert.equal(o.legs[2], m0.legs[0])
})

test('routeEdit: a straight leg is a straight line and its length counts', async () => {
  const m0 = await built(3), { router, calls } = fakeRouter()
  const a = P(1), b = P(2), direct = E.miles(a, b)
  assert.ok(m0.legs[1].miles > direct * 1.2, 'the routed dog-leg is longer than the crow flies')
  const s = E.setLegMode(m0, 1, 'straight')
  assert.deepEqual([s.legs[1].mode, s.legs[1].pts, !!s.legs[1].pending], ['straight', [a, b], false])
  assert.ok(Math.abs(s.legs[1].miles - direct) < 1e-12)
  assert.ok(Math.abs(E.totalMiles(s) - (m0.legs[0].miles + direct)) < 1e-12)
  assert.equal(E.legLabel(s.legs[1]), 'Straight line')
  assert.equal(await E.resolveLegs(s, router), s)
  assert.equal(calls.length, 0, 'a straight leg never reaches the router')
  assert.equal(E.setLegMode(s, 1, 'straight'), s)
  // Back to following paths asks for that one leg.
  const p = await E.resolveLegs(E.setLegMode(s, 1, 'path'), router)
  assert.deepEqual(calls, [[a, b]])
  assert.equal(p.legs[1].pts.length, 3)
  assert.deepEqual(E.controlOf(s), { points: [P(0), P(1), P(2)], modes: ['path', 'straight'] })
  // A known distance: one hundredth of a degree of latitude is 0.691 miles.
  assert.ok(Math.abs(E.miles([35, -80], [35.01, -80]) - 0.691) < 0.001)
  assert.equal(E.legLabel({ mode: 'path', name: '' }), 'Path')
  assert.equal(E.legLabel({ mode: 'path', name: '', kind: 'road' }), 'Unnamed road')
  assert.equal(E.legLabel({ mode: 'path', name: 'Queens Rd' }), 'Queens Rd')
})

test('routeEdit: a leg the router fails on is a straight line marked approximate, and can be retried', async () => {
  const m0 = await built(2)
  const down = async () => { throw new Error('router down') }
  const m = await E.resolveLegs(E.appendPoint(m0, P(2)), down)
  assert.deepEqual([m.legs[1].approximate, m.legs[1].pts.length, E.hasPending(m), E.approximateLegs(m)], [true, 2, false, 1])
  const { router, calls } = fakeRouter()
  const again = await E.resolveLegs(E.retryApproximate(m), router)
  assert.deepEqual([calls.length, E.approximateLegs(again), again.legs[1].pts.length], [1, 0, 3])
  assert.equal(again.legs[0], m.legs[0])
  const empty = await E.resolveLegs(E.appendPoint(m0, P(2)), async () => ({ pts: [] }))
  assert.equal(empty.legs[1].approximate, true)
})

test('routeEdit: undo and redo, at least 30 steps', async () => {
  let h = E.makeHistory(E.emptyModel())
  assert.deepEqual([E.canUndo(h), E.canRedo(h)], [false, false])
  assert.equal(E.undo(h), h)
  assert.equal(E.redo(h), h)
  const steps = []
  // 34 edits: two points, then the second one moved again and again.
  for (let i = 0; i < 34; i++) { const next = i < 2 ? E.appendPoint(h.present, [35 + i * 0.001, -80]) : E.movePoint(h.present, 1, [35 + i * 0.001, -80]); steps.push(next); h = E.commit(h, next) }
  assert.ok(E.HISTORY_STEPS >= 30)
  assert.equal(E.commit(h, h.present), h, 'no change is not a step')
  // The router's answer replaces the newest step. It is not a step of its own.
  const resolved = { ...h.present, legs: h.present.legs.map((l) => ({ ...l, pending: false })) }
  const before = h.past.length
  h = E.replacePresent(h, resolved)
  assert.deepEqual([h.past.length, h.present], [before, resolved])
  for (let i = 0; i < 30; i++) { assert.equal(E.canUndo(h), true, `undo ${i + 1}`); h = E.undo(h) }
  assert.equal(h.present, steps[3])
  assert.equal(h.future.length, 30)
  for (let i = 0; i < 30; i++) h = E.redo(h)
  assert.equal(h.present, resolved)
  assert.equal(E.canRedo(h), false)
  // A new edit after an undo drops what could have been redone.
  h = E.undo(E.undo(h))
  h = E.commit(h, E.appendPoint(h.present, [36, -81]))
  assert.deepEqual([E.canRedo(h), h.present.points[h.present.points.length - 1]], [false, [36, -81]])
  // Never more than the limit kept.
  let small = E.makeHistory(E.emptyModel(), 5)
  for (let i = 0; i < 12; i++) small = E.commit(small, E.appendPoint(small.present, [35 + i * 0.001, -80]))
  assert.equal(small.past.length, 5)
})

test('routeEdit: a walked line becomes at most 12 control points by simplification', async () => {
  // A wobbly recorded loop of 400 points.
  const n = 400, line = Array.from({ length: n }, (_, i) => { const t = (i / (n - 1)) * 2 * Math.PI; return [35.19 + 0.004 * Math.sin(t) + 0.00003 * Math.sin(i * 1.7), -80.84 + 0.005 * (1 - Math.cos(t)) + 0.00003 * Math.cos(i * 2.3)] })
  line[n - 1] = line[0].slice()
  const idx = E.simplifyTo(line, 12)
  assert.ok(idx.length <= 12 && idx.length >= 8, String(idx.length))
  assert.deepEqual([idx[0], idx[idx.length - 1]], [0, n - 1])
  assert.ok(idx.every((v, i) => i === 0 || v > idx[i - 1]))
  const m = E.modelFromLine(line)
  assert.ok(m.points.length <= 12)
  assert.deepEqual([m.legs.length, E.isClosed(m), E.hasPending(m)], [m.points.length - 1, true, false])
  assert.ok(joined(m))
  // The legs are the original line cut into pieces, so the length is unchanged and nothing needs routing.
  assert.ok(Math.abs(E.totalMiles(m) - E.lineMiles(line)) < 0.01)
  assert.equal(E.modelLine(m).length, n)
  // Douglas-Peucker itself: a tolerance keeps the corner and drops the points along the straight sides.
  const L = [[35, -80], [35.001, -80], [35.002, -80.00001], [35.003, -80], [35.003, -79.999], [35.003, -79.998]]
  assert.deepEqual(E.simplify(L, 0.01), [0, 3, 5])
  assert.deepEqual(E.simplify(L, 10), [0, 5])
  assert.deepEqual(E.simplifyTo(L, 12), [0, 1, 2, 3, 4, 5], 'short lines are left alone')
  // A loop never collapses to its start twice.
  const ring = Array.from({ length: 50 }, (_, i) => [35 + 0.001 * Math.sin((i / 49) * 2 * Math.PI), -80 + 0.001 * Math.cos((i / 49) * 2 * Math.PI)])
  ring[49] = ring[0].slice()
  assert.ok(E.simplifyTo(ring, 2).length === 3)
  assert.deepEqual(E.modelFromLine([]), E.emptyModel())
  assert.deepEqual(E.modelFromLine([[35, -80]]), { points: [[35, -80]], legs: [] })
})

test('routeEdit: a saved route opens again from its control points and line', async () => {
  const m0 = E.setLegMode(await built(4), 1, 'straight')
  const control = E.controlOf(m0), line = E.modelLine(m0)
  const m = E.modelFromControl(control, line)
  assert.deepEqual(m.points, m0.points)
  assert.deepEqual(m.legs.map((l) => [l.mode, l.pts.length]), [['path', 3], ['straight', 2], ['path', 3]])
  assert.ok(joined(m))
  assert.ok(Math.abs(E.totalMiles(m) - E.totalMiles(m0)) < 1e-6)
  assert.equal(E.hasPending(m), false)
  // An out and back passes its first stretch twice: the cut is made on the right pass.
  const { router } = fakeRouter()
  const out = await E.resolveLegs(E.appendPoint(E.appendPoint(E.emptyModel(), P(0)), P(1)), router)
  const ob = { points: [P(0), P(1), P(0)], legs: [out.legs[0], { ...out.legs[0], pts: out.legs[0].pts.slice().reverse() }] }
  const again = E.modelFromControl(E.controlOf(ob), E.modelLine(ob))
  assert.deepEqual(again.legs.map((l) => l.pts), ob.legs.map((l) => l.pts))
  // With no stored line the path legs wait for the router and straight ones do not.
  const bare = E.modelFromControl(control, null)
  assert.deepEqual(bare.legs.map((l) => [l.mode, !!l.pending]), [['path', true], ['straight', false], ['path', true]])
  assert.deepEqual(E.modelFromControl(null, line), E.emptyModel())
})

// ---- the leg router and the suggested route, with a fake directions service -----
// Answers like OSRM and Mapbox do with steps=true: one leg per pair of points, each a named dog-leg.
const fakeDirections = () => {
  const urls = []
  const fetchImpl = async (url) => {
    urls.push(url)
    const c = /\/v1\/foot\/([^?]+)\?/.exec(url)[1].split(';').map((x) => x.split(',').map(Number))
    const legs = c.slice(1).map((b, i) => { const a = c[i]; return { steps: [{ name: 'Queens Rd', distance: 300, geometry: { coordinates: [a, [b[0], a[1]]] } }, { name: '', distance: 100, geometry: { coordinates: [[b[0], a[1]], b] } }] } })
    return { ok: true, json: async () => ({ code: 'Ok', routes: [{ legs }] }) }
  }
  return { urls, fetchImpl }
}
test('routing: directions with steps become one named leg per pair of points', () => {
  const step = (name, distance, coords, cls) => ({ name, distance, geometry: { coordinates: coords }, ...(cls ? { intersections: [{ mapbox_streets_v8: { class: cls } }] } : {}) })
  const json = { code: 'Ok', routes: [{ legs: [
    { steps: [step('Queens Rd', 400, [[-80.84, 35.19], [-80.84, 35.195]]), step('East Blvd', 150, [[-80.84, 35.195], [-80.835, 35.195]]), step('', 0, [[-80.835, 35.195]])] },
    { steps: [step('', 500, [[-80.835, 35.195], [-80.83, 35.2]], 'path'), step('Kings Dr', 60, [[-80.83, 35.2], [-80.83, 35.201]])] },
    { steps: [step('', 300, [[-80.83, 35.201], [-80.82, 35.201]], 'street')] },
  ] }] }
  const legs = parseLegs(json)
  assert.deepEqual(legs.map((l) => [l.name, l.kind, l.pts.length]), [['Queens Rd', '', 3], ['', 'path', 3], ['', 'road', 2]])
  assert.deepEqual(legs[0].roads, ['Queens Rd', 'East Blvd'])
  assert.deepEqual(legs[0].pts[0], [35.19, -80.84], 'points are [lat, lng]')
  assert.ok(Math.abs(legs[0].miles - E.lineMiles(legs[0].pts)) < 1e-6, 'length is measured from the line')
  assert.deepEqual(legs.map(E.legLabel), ['Queens Rd', 'Path', 'Unnamed road'])
  assert.throws(() => parseLegs({ code: 'NoRoute', message: 'Impossible route' }), /OSRM: Impossible route/)
  assert.throws(() => parseLegs({ code: 'Ok', routes: [{ legs: [{ steps: [] }] }] }), /OSRM: empty leg/)
  assert.match(osrmLegsUrl([[35.19, -80.84], [35.2, -80.83]]), /\/-80\.84000,35\.19000;-80\.83000,35\.20000\?overview=full&geometries=geojson&steps=true$/)
})
test('routing: legs are remembered by their rounded endpoints, so a known leg is not asked for again', async () => {
  const { urls, fetchImpl } = fakeDirections()
  const A = [35.61001, -80.41], B = [35.62, -80.42], C = [35.63, -80.41]
  const legs = await routeLegs([A, B, C], { fetchImpl })
  assert.deepEqual([legs.length, urls.length, legs[0].name], [2, 1, 'Queens Rd'])
  // Both legs are now known one by one, and the same place to five decimals is the same leg.
  assert.equal(await routeLeg(A, B, { fetchImpl }), legs[0])
  assert.equal(await routeLeg([35.610011, -80.410001], B, { fetchImpl }), legs[0])
  assert.equal((await routeLegs([A, B, C], { fetchImpl }))[1], legs[1])
  assert.equal(urls.length, 1)
  // The other way round is a different leg.
  await routeLeg(B, A, { fetchImpl })
  assert.equal(urls.length, 2)
  assert.notEqual(legKey(A, B), legKey(B, A))
  // A service that is down rejects, and an aborted request is not remembered.
  await assert.rejects(routeLeg([35.7, -80.5], [35.71, -80.5], { fetchImpl: async () => { throw new Error('down') } }))
  const ctl = new AbortController(); ctl.abort()
  await assert.rejects(routeLeg([35.7, -80.5], [35.71, -80.5], { fetchImpl: async (u, o) => { if (o.signal.aborted) throw new Error('aborted'); return fetchImpl(u) }, signal: ctl.signal }))
  await routeLeg([35.7, -80.5], [35.71, -80.5], { fetchImpl })
  assert.equal(urls.length, 3)
  await assert.rejects(routeLegs([A], { fetchImpl }))
})
test('routing: the suggested route is a loop or an out and back of about the asked length, ready for the editor', async () => {
  const { urls, fetchImpl } = fakeDirections()
  const start = [35.19, -80.84]
  const loop = await suggestRoute(start, 2, { fetchImpl })
  assert.deepEqual([loop.points.length, loop.legs.length, loop.approximate], [5, 4, false])
  assert.ok(E.isClosed(loop) && loop.legs.every((l) => l.mode === 'path' && l.pts.length > 1 && !l.pending))
  assert.ok(Math.abs(E.totalMiles(loop) - 2) / 2 <= 0.1, String(E.totalMiles(loop)))
  assert.ok(urls.length <= 3, 'at most three tries')
  const n = urls.length
  assert.equal(await suggestRoute(start, 2, { fetchImpl }), loop, 'the same request comes from memory')
  assert.equal(urls.length, n)
  // Shuffle is the same request with another bearing: a different loop from the same start.
  const other = await suggestRoute(start, 2, { fetchImpl, bearing: 142 })
  assert.deepEqual(other.points[0], loop.points[0])
  assert.notDeepEqual(other.points[1], loop.points[1])
  // Out and back: one leg out and the same line back, so only the way out is asked for.
  const before = urls.length
  const ob = await suggestRoute(start, 2, { fetchImpl, shape: 'out' })
  assert.deepEqual([ob.points.length, ob.legs.length], [3, 2])
  assert.deepEqual(ob.points[0], ob.points[2])
  assert.deepEqual(ob.legs[1].pts, ob.legs[0].pts.slice().reverse())
  assert.ok(urls.slice(before).every((u) => u.split(';').length === 2))
  assert.ok(Math.abs(E.totalMiles(ob) - 2) / 2 <= 0.25, String(E.totalMiles(ob)))
  // No router: straight lines between the same kind of points, marked approximate. Nothing is thrown.
  const down = await suggestRoute([35.5, -80.2], 2, { fetchImpl: async () => { throw new Error('down') } })
  assert.deepEqual([down.approximate, down.points.length, down.legs.every((l) => l.approximate && l.pts.length === 2)], [true, 5, true])
  assert.ok(E.totalMiles(down) > 0.5)
  // The model drops straight into the editor: moving a point asks for its two legs only.
  const { router, calls } = fakeRouter()
  await E.resolveLegs(E.movePoint(loop, 2, [35.2, -80.83]), router)
  assert.equal(calls.length, 2)
})
test('routing: routes saved on the device keep their control points, star and usual walk, and favorites are never the ones dropped', () => {
  const pts = LOOP.slice(0, 20), control = { points: [pts[0], pts[19]], modes: ['straight'] }
  let list = addSaved([], { pts, control, favorite: true, usualFor: 'Biscuit', kind: 'walked', sourceWalkId: 'm1', timesWalked: 2 }, 'Park loop')
  assert.deepEqual([list[0].name, list[0].kind, list[0].favorite, list[0].usualFor, list[0].control, list[0].sourceWalkId, list[0].timesWalked], ['Park loop', 'walked', true, 'Biscuit', control, 'm1', 2])
  assert.ok(list[0].miles > 0 && list[0].minutes >= 1)
  for (let i = 0; i < 30; i++) list = addSaved(list, { pts }, `Route ${i}`)
  assert.equal(list.length, 20)
  assert.ok(list.some((r) => r.name === 'Park loop'), 'the favorite outlives twenty newer routes')
  assert.equal(list[0].name, 'Route 29')
  // Routes from the first builder had none of the new fields. They load as built, unstarred routes.
  const old = cleanSaved([{ id: 'r1', name: 'Old', pts, miles: 0.5, minutes: 10, waypoints: [pts[0], pts[19]] }, { id: 'r2', pts: [[1, 2]], miles: 1 }, { id: 'r3', name: 'Bad control', pts, miles: 0.5, control: { points: [pts[0]], modes: [] }, usualFor: 'Biscuit' }])
  assert.deepEqual(old.map((r) => [r.id, r.kind, r.favorite, r.control, r.usualFor]), [['r1', 'built', false, null, ''], ['r3', 'built', false, null, '']])
})
