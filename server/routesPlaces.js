import crypto from 'node:crypto'

// Community dog places. OpenStreetMap rarely records which bars and shops welcome
// dogs, so people add places and confirm each other's.
export const PLACE_CATEGORIES = ['park', 'bar', 'cafe', 'shop', 'vet', 'care', 'water', 'other']
export const PLACE_LIMITS = { nameMin: 2, name: 80, note: 280, rows: 300, boxDegrees: 1 }

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const PLACE_AGENT = 'Trot/1.0 (dog walking app; one-time geocoding of a short curated place list; contact via the site this runs on)'
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const webLink = (v) => { try { const u = new URL(String(v)); return (u.protocol === 'https:' || u.protocol === 'http:') && String(v).length <= 300 ? u.href : null } catch (e) { return null } }
const curatedId = (name, address) => { const h = crypto.createHash('sha256').update(`trot-place:${name}|${address}`).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}` }

// Loads the curated list. Keyed on name plus address: the id is made from the two,
// so a restart, or two instances starting together, can never add a second row.
// A row keeps the coordinates it already has.
export async function seedPlaces(db, data, now = Date.now()) {
  const list = data && Array.isArray(data.places) ? data.places : []
  let kept = 0
  for (const p of list) {
    const name = clean(p.name, PLACE_LIMITS.name), address = clean(p.address, 200), note = clean(p.note, PLACE_LIMITS.note), src = webLink(p.source_url)
    if (name.length < PLACE_LIMITS.nameMin || !address || !PLACE_CATEGORIES.includes(p.category)) continue
    const id = curatedId(name, address)
    await db.query('INSERT INTO places (id, name, category, lat, lng, note, created_by, created_at, curated, address, source_url) VALUES ($1, $2, $3, NULL, NULL, $4, NULL, $5, TRUE, $6, $7) ON CONFLICT (id) DO NOTHING', [id, name, p.category, note, new Date(now).toISOString(), address, src])
    await db.query('UPDATE places SET category = $1, note = $2, source_url = $3 WHERE id = $4 AND curated = TRUE', [p.category, note, src, id])
    kept++
  }
  return kept
}

// Gives each curated place its coordinates with one Nominatim lookup, at most one
// request a second. A row that already has coordinates is never looked up again.
// A failed lookup leaves the row without coordinates, so it stays off the map and
// is tried again at the next startup. `fetchImpl` is injected so tests never touch the network.
export async function geocodePlaces(db, { fetchImpl = (...a) => fetch(...a), delayMs = 1100, timeoutMs = 10000, userAgent = PLACE_AGENT, now = () => Date.now() } = {}) {
  const todo = (await db.query('SELECT id, address FROM places WHERE curated = TRUE AND (lat IS NULL OR lng IS NULL) ORDER BY name ASC LIMIT 200')).rows
  const out = { found: 0, failed: 0, skipped: 0 }
  let first = true
  for (const row of todo) {
    // Another instance may have filled this row in while we were waiting.
    const cur = (await db.query('SELECT lat, lng FROM places WHERE id = $1', [row.id])).rows[0]
    if (!cur || (cur.lat != null && cur.lng != null)) { out.skipped++; continue }
    if (!first && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
    first = false
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs)
    let hit = null
    try {
      const res = await fetchImpl(`${NOMINATIM}?format=jsonv2&limit=1&q=${encodeURIComponent(row.address)}`, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: ctl.signal })
      if (res && res.ok) {
        const j = await res.json()
        const lat = Array.isArray(j) && j[0] ? Number(j[0].lat) : NaN, lng = Array.isArray(j) && j[0] ? Number(j[0].lon) : NaN
        if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) hit = [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6]
      }
    } catch (e) {} finally { clearTimeout(timer) }
    if (!hit) { out.failed++; continue }
    await db.query('UPDATE places SET lat = $1, lng = $2, geocoded_at = $3 WHERE id = $4 AND lat IS NULL', [hit[0], hit[1], new Date(now()).toISOString(), row.id])
    out.found++
  }
  return out
}

export function registerPlaces(kit) {
  const { api, db, auth, userFor, HttpError, bad, text, number, object, newId, iso, num, firstName, ID_RE, limiter, limited, R } = kit
  const addLimit = limiter({ windowMs: R.placeWindowMs, max: R.placeMax })

  async function counts(ids, userId) {
    const n = {}, mine = {}
    if (!ids.length) return { n, mine }
    const ph = ids.map((_, i) => `$${i + 1}`).join(', ')
    const c = await db.query(`SELECT place_id, COUNT(*) AS n FROM place_confirms WHERE place_id IN (${ph}) GROUP BY place_id`, ids)
    c.rows.forEach((r) => { n[r.place_id] = num(r.n) })
    if (userId) {
      const m = await db.query(`SELECT place_id FROM place_confirms WHERE user_id = $${ids.length + 1} AND place_id IN (${ph})`, [...ids, userId])
      m.rows.forEach((r) => { mine[r.place_id] = true })
    }
    return { n, mine }
  }
  // The one shape every place endpoint answers with. First name only for the adder.
  // A curated place has no adder and carries its address and its source.
  const out = (r, c) => ({ id: r.id, name: r.name, category: r.category, at: [num(r.lat), num(r.lng)], note: r.note, addedBy: r.curated ? null : firstName(r.user_name), confirmations: c.n[r.id] || 0, confirmed: !!c.mine[r.id], ...(r.curated ? { curated: true, address: r.address || '', sourceUrl: r.source_url || null } : {}) })
  const SELECT = 'SELECT p.id, p.name, p.category, p.lat, p.lng, p.note, p.created_by, p.curated, p.address, p.source_url, u.name AS user_name FROM places p LEFT JOIN users u ON u.id = p.created_by'
  async function placeFor(id) {
    if (!ID_RE.test(id)) throw new HttpError(404, 'No such place.')
    const { rows } = await db.query(`${SELECT} WHERE p.id = $1`, [id])
    // A curated place that has no coordinates yet is not on the map, so it is not there to act on either.
    if (!rows[0] || rows[0].lat == null || rows[0].lng == null) throw new HttpError(404, 'No such place.')
    return rows[0]
  }
  const state = async (id, userId) => { const c = await counts([id], userId); return { confirmations: c.n[id] || 0, confirmed: !!c.mine[id] } }

  // No sign-in needed. A signed-in caller also learns which places they confirmed.
  api.get('/places', async (req, res) => {
    const q = (k, lo, hi) => {
      const raw = req.query[k], v = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
      if (!Number.isFinite(v) || v < lo || v > hi) throw bad(`Send s, w, n and e as numbers. ${k} is missing or out of range.`)
      return v
    }
    let s = q('s', -90, 90), w = q('w', -180, 180), n = q('n', -90, 90), e = q('e', -180, 180)
    if (s > n || w > e) throw bad('The box is upside down: s must be below n and w must be left of e.')
    // A big box is shrunk around its centre rather than refused.
    const half = PLACE_LIMITS.boxDegrees / 2
    if (n - s > PLACE_LIMITS.boxDegrees) { const c = (n + s) / 2; s = c - half; n = c + half }
    if (e - w > PLACE_LIMITS.boxDegrees) { const c = (e + w) / 2; w = c - half; e = c + half }
    const user = await userFor(req)
    const { rows } = await db.query(`${SELECT} WHERE p.lat IS NOT NULL AND p.lng IS NOT NULL AND p.lat >= $1 AND p.lat <= $2 AND p.lng >= $3 AND p.lng <= $4 ORDER BY p.created_at DESC, p.id DESC LIMIT ${PLACE_LIMITS.rows}`, [s, n, w, e])
    const c = await counts(rows.map((r) => r.id), user && user.id)
    res.json({ places: rows.map((r) => out(r, c)) })
  })
  api.post('/places', auth, async (req, res) => {
    const b = object(req.body)
    const name = text(b.name, 'Name', { min: 1, max: PLACE_LIMITS.name })
    if (name.length < PLACE_LIMITS.nameMin) throw bad(`Name must be at least ${PLACE_LIMITS.nameMin} characters.`)
    if (!PLACE_CATEGORIES.includes(b.category)) throw bad(`Category must be one of: ${PLACE_CATEGORIES.join(', ')}.`)
    const lat = number(b.lat, 'lat', { min: -90, max: 90 }), lng = number(b.lng, 'lng', { min: -180, max: 180 })
    const note = text(b.note, 'Note', { max: PLACE_LIMITS.note })
    const r = addLimit('user:' + req.user.id)
    if (!r.ok) return limited(res, r)
    const id = newId(), now = iso(Date.now())
    await db.tx(async (t) => {
      await t.query('INSERT INTO places (id, name, category, lat, lng, note, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [id, name, b.category, Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6, note, req.user.id, now])
      // Whoever adds a place vouches for it, so they are its first confirmation.
      await t.query('INSERT INTO place_confirms (place_id, user_id, created_at) VALUES ($1, $2, $3)', [id, req.user.id, now])
    })
    const p = await placeFor(id)
    res.status(201).json({ place: out(p, await counts([id], req.user.id)) })
  })
  api.post('/places/:id/confirm', auth, async (req, res) => {
    const p = await placeFor(req.params.id)
    await db.query('INSERT INTO place_confirms (place_id, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (place_id, user_id) DO NOTHING', [p.id, req.user.id, iso(Date.now())])
    res.json(await state(p.id, req.user.id))
  })
  api.delete('/places/:id/confirm', auth, async (req, res) => {
    const p = await placeFor(req.params.id)
    await db.query('DELETE FROM place_confirms WHERE place_id = $1 AND user_id = $2', [p.id, req.user.id])
    res.json(await state(p.id, req.user.id))
  })
  api.delete('/places/:id', auth, async (req, res) => {
    const p = await placeFor(req.params.id)
    if (p.curated) throw new HttpError(403, 'This place comes from public listings and cannot be removed here.')
    if (p.created_by !== req.user.id) throw new HttpError(403, 'Only the person who added this place can remove it.')
    await db.tx(async (t) => {
      await t.query('DELETE FROM place_confirms WHERE place_id = $1', [p.id])
      await t.query('DELETE FROM places WHERE id = $1', [p.id])
    })
    res.json({ ok: true })
  })
}
