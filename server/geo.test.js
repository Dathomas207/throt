// Run with: node --test server/
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createDb } from './db.js'
import { geoRouter, parseTile, queryFor, KINDS, FRESH_MS } from './geo.js'
import { buildQuery, tileBbox, tileOf } from '../src/osm.js'

let db
before(async () => { db = await createDb() })
after(async () => { await db.close() })

// A fake Overpass. Counts calls, records what it was sent, and can be told to wait or fail.
function upstream() {
  const u = { calls: [], fail: false, gate: null, n: 0 }
  u.fetch = async (url, init) => {
    u.calls.push({ url, body: decodeURIComponent(String(init.body).replace(/^data=/, '')), ua: init.headers['User-Agent'] })
    if (u.gate) await u.gate
    if (u.fail) throw new Error('down')
    return { ok: true, status: 200, json: async () => ({ version: 0.6, elements: [{ type: 'node', id: ++u.n, lat: 35.2, lon: -80.8, tags: { leisure: 'dog_park' } }] }) }
  }
  return u
}
async function serve(opts) {
  const app = express()
  app.use('/api/geo', geoRouter(db, opts))
  const s = app.listen(0)
  await new Promise((r) => s.once('listening', r))
  const base = `http://127.0.0.1:${s.address().port}/api/geo`
  return { get: (p) => fetch(base + p), close: () => new Promise((r) => s.close(r)) }
}
const T = tileOf(35.2271, -80.8431, 12)
let seq = 0
const tile = () => `/parks/12/${T.x + ++seq}/${T.y}` // a fresh key for each test

test('tile and kind validation', () => {
  assert.deepEqual(KINDS, ['parks', 'more', 'trails'])
  assert.equal(parseTile('parks', '12', String(T.x), String(T.y)).key, `parks/12/${T.x}/${T.y}`)
  assert.ok(parseTile('trails', '13', '2256', '3240'))
  for (const bad of [['bars', '12', '1', '1'], ['parks', '13', '1', '1'], ['trails', '12', '1', '1'], ['parks', '12', '4096', '1'], ['parks', '12', '-1', '1'], ['parks', '12', '1.5', '1'], ['parks', '12', 'x', '1'], ['parks', '12', '1', '99999999']]) assert.equal(parseTile(...bad), null, bad.join('/'))
  // The server builds the same query text the client would for that box.
  assert.equal(queryFor('parks', 12, T.x, T.y), buildQuery(tileBbox(12, T.x, T.y), 'parks', 15))
  assert.match(queryFor('trails', 13, 2256, 3240), /route"~"\^\(hiking\|foot\)\$"/)
})

test('cold miss fetches once, warm hit does not fetch, and the row is stored', async () => {
  const errs = [], u = upstream(), s = await serve({ fetchImpl: u.fetch, onError: (e) => errs.push(String(e)) }), p = tile()
  const a = await s.get(p)
  assert.equal(a.status, 200); assert.deepEqual(errs, [])
  assert.equal(a.headers.get('cache-control'), 'public, max-age=3600')
  const ja = await a.json()
  assert.equal(ja.stale, false); assert.equal(ja.elements.length, 1); assert.ok(Date.parse(ja.fetchedAt) > 0)
  assert.equal(u.calls.length, 1)
  assert.match(u.calls[0].url, /overpass/); assert.match(u.calls[0].ua, /^Trot\//); assert.match(u.calls[0].body, /"leisure"="dog_park"/)
  const b = await (await s.get(p)).json()
  assert.equal(u.calls.length, 1); assert.deepEqual(b.elements, ja.elements)
  await s.close()
  // A new router has an empty memory cache, so this answer comes from the table.
  const u2 = upstream(), s2 = await serve({ fetchImpl: u2.fetch })
  const c = await (await s2.get(p)).json()
  assert.equal(u2.calls.length, 0); assert.deepEqual(c.elements, ja.elements)
  await s2.close()
})

test('concurrent requests for one tile share one upstream call', async () => {
  const u = upstream(); let open; u.gate = new Promise((r) => { open = r })
  const s = await serve({ fetchImpl: u.fetch }), p = tile()
  const all = [s.get(p), s.get(p), s.get(p), s.get(p)]
  await new Promise((r) => setTimeout(r, 80))
  open()
  const res = await Promise.all(all)
  assert.deepEqual(res.map((r) => r.status), [200, 200, 200, 200])
  assert.equal(u.calls.length, 1)
  await s.close()
})

test('a stale entry is served at once while one refresh runs', async () => {
  const u = upstream(); let t = Date.now()
  const s = await serve({ fetchImpl: u.fetch, now: () => t }), p = tile()
  const first = await (await s.get(p)).json()
  t += FRESH_MS + 1000
  let open; u.gate = new Promise((r) => { open = r })
  const a = await (await s.get(p)).json(), b = await (await s.get(p)).json()
  assert.equal(a.stale, true); assert.equal(b.stale, true); assert.deepEqual(a.elements, first.elements)
  assert.equal(u.calls.length, 2) // the first fetch, plus exactly one refresh for the two stale reads
  open()
  await new Promise((r) => setTimeout(r, 80))
  const c = await (await s.get(p)).json()
  assert.equal(c.stale, false); assert.notDeepEqual(c.elements, first.elements); assert.equal(u.calls.length, 2)
  await s.close()
})

test('upstream failure: the cached copy when there is one, 502 when there is not', async () => {
  const u = upstream(); let t = Date.now()
  const s = await serve({ fetchImpl: u.fetch, now: () => t }), p = tile()
  const first = await (await s.get(p)).json()
  t += FRESH_MS + 1000; u.fail = true
  const a = await s.get(p)
  assert.equal(a.status, 200); const ja = await a.json(); assert.equal(ja.stale, true); assert.deepEqual(ja.elements, first.elements)
  const before = u.calls.length
  const b = await s.get(tile())
  assert.equal(b.status, 502); assert.equal(b.headers.get('cache-control'), 'no-store')
  assert.equal(u.calls.length - before, 2 + 0) // both endpoints were tried for the miss
  await s.close()
})

test('invalid kind or tile is 400 and nothing is fetched; rate limit answers 429', async () => {
  const u = upstream(), s = await serve({ fetchImpl: u.fetch, rate: { max: 6 } })
  for (const p of ['/bars/12/1/1', '/parks/11/1/1', '/parks/12/99999/1', '/parks/12/abc/1', '/trails/12/1/1']) assert.equal((await s.get(p)).status, 400, p)
  assert.equal((await s.get('/parks/12/1/1/extra')).status, 404)
  assert.equal(u.calls.length, 0)
  assert.equal((await s.get('/parks/12/1/1')).status, 200) // the sixth request inside the window
  const r = await s.get('/parks/12/1/1')
  assert.equal(r.status, 429); assert.ok(r.headers.get('retry-after'))
  await s.close()
})
