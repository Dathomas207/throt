// Shared cache for map data, so only the first person to look at an area waits on Overpass.
//
//   GET /:kind/:z/:x/:y  ->  { elements, fetchedAt, stale }
//
// kind is one of KINDS and z is fixed per kind. The query text is built here from the tile numbers with
// the same builders the client uses (src/osm.js), so the two cannot drift and a client can never send
// query text or a URL: this router only ever calls the Overpass endpoints listed below.
//
// Mount it with:  import { geoRouter } from './geo.js'   then   api.use('/geo', geoRouter(db))
import express from 'express'
import { buildQuery, buildTrailQuery, tileBbox, GEO_Z, OVERPASS_ENDPOINTS } from '../src/osm.js'

export const KINDS = Object.keys(GEO_Z) // parks, more, trails
export const FRESH_MS = 7 * 24 * 60 * 60 * 1000
const UPSTREAM_TIMEOUT_MS = 20000
const OVERPASS_TIMEOUT_S = 15
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_IN_FLIGHT = 2
const MAX_QUEUE = 24
const LRU_MAX = 300
const RATE = { windowMs: 60000, max: 120 }
const USER_AGENT = 'Trot/1.0 (dog walking app; shared map data cache; contact via the site this runs on)'

export function queryFor(kind, z, x, y) {
  const b = tileBbox(z, x, y)
  return kind === 'trails' ? buildTrailQuery(b, OVERPASS_TIMEOUT_S) : buildQuery(b, kind, OVERPASS_TIMEOUT_S)
}
// Null when the path is not one this router serves, otherwise { kind, z, x, y, key }.
export function parseTile(kind, zs, xs, ys) {
  if (!KINDS.includes(kind)) return null
  if (![zs, xs, ys].every((v) => /^\d{1,6}$/.test(String(v)))) return null
  const z = Number(zs), x = Number(xs), y = Number(ys), n = 2 ** z
  if (z !== GEO_Z[kind] || x >= n || y >= n) return null
  return { kind, z, x, y, key: `${kind}/${z}/${x}/${y}` }
}

// opts are for tests: fetchImpl, now (function returning ms), endpoints, rate.
export function geoRouter(db, opts = {}) {
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a))
  const now = opts.now || (() => Date.now())
  const endpoints = opts.endpoints || OVERPASS_ENDPOINTS
  const rate = { ...RATE, ...(opts.rate || {}) }
  const lru = new Map() // key -> { body, fetchedAt }, most recently used last
  const inflight = new Map() // key -> promise, so concurrent requests for one tile share one upstream call
  const waiting = []
  const hits = new Map() // ip -> { n, reset }
  let active = 0, ready = null

  // The table is made at first use. It is looked for before it is created, so a second router on the same
  // database (and pg-mem, which does not like a repeated CREATE) finds the one that is already there.
  const CREATE = 'CREATE TABLE IF NOT EXISTS geo_cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, fetched_at TIMESTAMPTZ NOT NULL)'
  const ensure = () => ready || (ready = db.query('SELECT 1 FROM geo_cache LIMIT 1').catch(() => db.query(CREATE)).catch((e) => { ready = null; throw e }))
  const remember = (key, entry) => { lru.delete(key); lru.set(key, entry); if (lru.size > LRU_MAX) lru.delete(lru.keys().next().value) }
  async function read(key) {
    const hit = lru.get(key)
    if (hit) { remember(key, hit); return hit }
    await ensure()
    const r = await db.query('SELECT body, fetched_at FROM geo_cache WHERE key = $1', [key])
    if (!r.rows.length) return null
    const entry = { body: r.rows[0].body, fetchedAt: new Date(r.rows[0].fetched_at).getTime() }
    remember(key, entry)
    return entry
  }
  async function write(key, entry) {
    remember(key, entry)
    await ensure()
    await db.query('INSERT INTO geo_cache (key, body, fetched_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, fetched_at = EXCLUDED.fetched_at', [key, entry.body, new Date(entry.fetchedAt)])
  }
  // At most MAX_IN_FLIGHT upstream calls at once, with a short queue behind them.
  function slot() {
    if (active < MAX_IN_FLIGHT) { active++; return Promise.resolve() }
    if (waiting.length >= MAX_QUEUE) return Promise.reject(Object.assign(new Error('Map data is busy.'), { busy: true }))
    return new Promise((resolve) => waiting.push(resolve))
  }
  function release() { const next = waiting.shift(); if (next) next(); else active-- }
  async function ask(url, query) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS)
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': USER_AGENT, Accept: 'application/json' }, body: 'data=' + encodeURIComponent(query), signal: ctl.signal })
      if (!res.ok) throw new Error('Overpass HTTP ' + res.status)
      const json = await res.json()
      if (!json || !Array.isArray(json.elements)) throw new Error('Unexpected Overpass response')
      if (!json.elements.length && json.remark && /error|timed out|timeout/i.test(json.remark)) throw new Error('Overpass: ' + json.remark)
      return json.elements
    } finally { clearTimeout(timer) }
  }
  // One upstream fetch per key at a time. The second endpoint is tried when the first fails.
  function refresh(t) {
    if (inflight.has(t.key)) return inflight.get(t.key)
    const p = (async () => {
      await slot()
      try {
        const query = queryFor(t.kind, t.z, t.x, t.y)
        let elements = null, err = null
        for (const url of endpoints) { try { elements = await ask(url, query); break } catch (e) { err = e } }
        if (!elements) throw err || new Error('Overpass did not answer')
        const entry = { body: JSON.stringify(elements), fetchedAt: now() }
        // Very large answers are passed through but not stored.
        if (Buffer.byteLength(entry.body) <= MAX_BODY_BYTES) await write(t.key, entry).catch((e) => { if (opts.onError) opts.onError(e) })
        return entry
      } finally { release() }
    })()
    inflight.set(t.key, p)
    const done = () => { if (inflight.get(t.key) === p) inflight.delete(t.key) }
    p.then(done, done)
    return p
  }
  const send = (res, entry, stale) => {
    res.set('Cache-Control', 'public, max-age=3600')
    res.type('application/json').send(`{"elements":${entry.body},"fetchedAt":${JSON.stringify(new Date(entry.fetchedAt).toISOString())},"stale":${stale ? 'true' : 'false'}}`)
  }

  const router = express.Router()
  router.get('/:kind/:z/:x/:y', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const ip = req.ip || 'unknown', at = now()
    let h = hits.get(ip)
    if (!h || at > h.reset) { h = { n: 0, reset: at + rate.windowMs }; hits.set(ip, h); if (hits.size > 5000) for (const [k, v] of hits) if (at > v.reset) hits.delete(k) }
    if (++h.n > rate.max) { res.set('Retry-After', String(Math.max(1, Math.ceil((h.reset - at) / 1000)))); return res.status(429).json({ error: 'Too many requests. Wait a moment and try again.' }) }
    const t = parseTile(req.params.kind, req.params.z, req.params.x, req.params.y)
    if (!t) return res.status(400).json({ error: 'Unknown map data kind or tile.' })
    let cached = null
    try { cached = await read(t.key) } catch (e) {}
    if (cached && at - cached.fetchedAt < FRESH_MS) return send(res, cached, false)
    if (cached) {
      // Stale: answer straight away with the old copy and refresh behind it.
      refresh(t).catch(() => {})
      return send(res, cached, true)
    }
    try { send(res, await refresh(t), false) } catch (e) {
      if (e && e.busy) { res.set('Retry-After', '5'); return res.status(503).json({ error: 'Map data is busy. Try again in a moment.' }) }
      res.status(502).json({ error: 'Map data is unavailable right now.' })
    }
  })
  return router
}
