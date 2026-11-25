import crypto from 'node:crypto'

// Community dog places. OpenStreetMap rarely records which bars and shops welcome
// dogs, so people add places and confirm each other's.
export const PLACE_CATEGORIES = ['park', 'bar', 'cafe', 'shop', 'vet', 'care', 'water', 'other']
export const PLACE_LIMITS = { nameMin: 2, name: 80, note: 280, rows: 300, boxDegrees: 1, eventNote: 140, website: 300, claimMessage: 500, flagAt: 3 }
// What a listing's manager keeps up to date, and what anyone can report.
export const DOG_POLICIES = ['inside', 'patio', 'off_leash', 'leashed', 'unknown']
export const AMENITIES = ['water_bowls', 'treats', 'fenced', 'shade', 'dog_menu', 'waste_bags']
export const CLAIM_ROLES = ['owner', 'steward']
export const REPORT_REASONS = ['not_dog_friendly', 'closed', 'wrong_location', 'other']
// Reports for these reasons flag a listing once PLACE_LIMITS.flagAt of them are open.
const FLAG_REASONS = ['closed', 'not_dog_friendly']
// A park is stewarded and a business is owned. Dog water and "other" can be either.
export const claimRolesFor = (category) => (category === 'park' ? ['steward'] : category === 'water' || category === 'other' ? CLAIM_ROLES : ['owner'])
// https only, a real host name, nothing hidden in the address. Returns null when it will not do.
export function httpsLink(v, max = PLACE_LIMITS.website) {
  if (typeof v !== 'string' || v.length > max || /\s/.test(v.trim())) return null
  try { const u = new URL(v.trim()); return u.protocol === 'https:' && !u.username && !u.password && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname) && u.href.length <= max ? u.href : null } catch (e) { return null }
}

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
  const ids = new Set()
  for (const p of list) {
    const name = clean(p.name, PLACE_LIMITS.name), address = clean(p.address, 200), note = clean(p.note, PLACE_LIMITS.note), src = webLink(p.source_url)
    if (name.length < PLACE_LIMITS.nameMin || !address || !PLACE_CATEGORIES.includes(p.category)) continue
    const id = curatedId(name, address)
    await db.query('INSERT INTO places (id, name, category, lat, lng, note, created_by, created_at, curated, address, source_url, last_checked_at) VALUES ($1, $2, $3, NULL, NULL, $4, NULL, $5, TRUE, $6, $7, $5) ON CONFLICT (id) DO NOTHING', [id, name, p.category, note, new Date(now).toISOString(), address, src])
    // The list's note is only the starting point: once someone maintains the listing, their note stays.
    await db.query('UPDATE places SET category = $1, source_url = $2 WHERE id = $3 AND curated = TRUE', [p.category, src, id])
    await db.query('UPDATE places SET note = $1 WHERE id = $2 AND curated = TRUE AND managed_by IS NULL', [note, id])
    // Rows seeded before listings carried a checked date count as checked when they were loaded.
    await db.query('UPDATE places SET last_checked_at = created_at WHERE id = $1 AND last_checked_at IS NULL', [id])
    kept++
    ids.add(id)
  }
  // A listing taken out of the list (closed, moved, or its address corrected) goes from the index too,
  // unless someone now maintains it.
  if (ids.size) {
    const old = await db.query('SELECT id FROM places WHERE curated = TRUE AND managed_by IS NULL')
    for (const r of old.rows) if (!ids.has(r.id)) { try { await db.query('DELETE FROM places WHERE id = $1', [r.id]) } catch (e) { await db.query('UPDATE places SET lat = NULL, lng = NULL WHERE id = $1', [r.id]).catch(() => {}) } }
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
  const { api, db, auth, admin, isUnique, email, userFor, HttpError, bad, text, number, object, newId, iso, num, firstName, ID_RE, limiter, limited, R } = kit
  const addLimit = limiter({ windowMs: R.placeWindowMs, max: R.placeMax })
  const claimLimit = limiter({ windowMs: R.claimWindowMs, max: R.claimMax })
  const reportLimit = limiter({ windowMs: R.reportWindowMs, max: R.reportMax })
  const conflict = (msg) => new HttpError(409, msg)
  const amenitiesOf = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? AMENITIES.filter((k) => a.includes(k)) : [] } catch (e) { return [] } }

  async function counts(ids, userId) {
    const n = {}, mine = {}, flags = {}, claims = {}
    if (!ids.length) return { n, mine, flags, claims, userId }
    const ph = ids.map((_, i) => `$${i + 1}`).join(', ')
    const c = await db.query(`SELECT place_id, COUNT(*) AS n FROM place_confirms WHERE place_id IN (${ph}) GROUP BY place_id`, ids)
    c.rows.forEach((r) => { n[r.place_id] = num(r.n) })
    if (userId) {
      const m = await db.query(`SELECT place_id FROM place_confirms WHERE user_id = $${ids.length + 1} AND place_id IN (${ph})`, [...ids, userId])
      m.rows.forEach((r) => { mine[r.place_id] = true })
      // The caller's newest claim on each place.
      const k = await db.query(`SELECT place_id, status FROM place_claims WHERE user_id = $${ids.length + 1} AND place_id IN (${ph}) ORDER BY created_at ASC, id ASC`, [...ids, userId])
      k.rows.forEach((r) => { claims[r.place_id] = r.status })
    }
    const f = await db.query(`SELECT place_id, COUNT(*) AS n FROM place_reports WHERE resolved_at IS NULL AND reason IN (${FLAG_REASONS.map((_, i) => `$${ids.length + i + 1}`).join(', ')}) AND place_id IN (${ph}) GROUP BY place_id`, [...ids, ...FLAG_REASONS])
    f.rows.forEach((r) => { flags[r.place_id] = num(r.n) })
    return { n, mine, flags, claims, userId }
  }
  // The one shape every place endpoint answers with. First name only for the adder.
  // A curated place has no adder and carries its address and its source.
  const out = (r, c) => ({ id: r.id, name: r.name, category: r.category, at: [num(r.lat), num(r.lng)], note: r.note, addedBy: r.curated ? null : firstName(r.user_name), confirmations: c.n[r.id] || 0, confirmed: !!c.mine[r.id], ...(r.curated ? { curated: true, address: r.address || '', sourceUrl: r.source_url || null } : {}),
    // Who maintains the listing (first name only), what they say about dogs, and how fresh it is.
    managedBy: (r.managed_by && firstName(r.manager_name)) || null, managedRole: r.managed_by && CLAIM_ROLES.includes(r.managed_role) ? r.managed_role : null, managedByYou: !!(c.userId && r.managed_by === c.userId),
    dogPolicy: DOG_POLICIES.includes(r.dog_policy) ? r.dog_policy : 'unknown', amenities: amenitiesOf(r.amenities), eventNote: r.event_note || '', website: r.website || null,
    lastCheckedAt: r.last_checked_at ? iso(r.last_checked_at) : null, flagged: (c.flags[r.id] || 0) >= PLACE_LIMITS.flagAt, myClaim: c.claims[r.id] || null })
  const SELECT = 'SELECT p.id, p.name, p.category, p.lat, p.lng, p.note, p.created_by, p.curated, p.address, p.source_url, p.managed_by, p.managed_role, p.dog_policy, p.amenities, p.event_note, p.website, p.last_checked_at, u.name AS user_name, mu.name AS manager_name FROM places p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN users mu ON mu.id = p.managed_by'
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
      await t.query('INSERT INTO places (id, name, category, lat, lng, note, created_by, created_at, last_checked_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)', [id, name, b.category, Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6, note, req.user.id, now])
      // Whoever adds a place vouches for it, so they are its first confirmation.
      await t.query('INSERT INTO place_confirms (place_id, user_id, created_at) VALUES ($1, $2, $3)', [id, req.user.id, now])
    })
    const p = await placeFor(id)
    res.status(201).json({ place: out(p, await counts([id], req.user.id)) })
  })
  api.post('/places/:id/confirm', auth, async (req, res) => {
    const p = await placeFor(req.params.id)
    await db.query('INSERT INTO place_confirms (place_id, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (place_id, user_id) DO NOTHING', [p.id, req.user.id, iso(Date.now())])
    // Any signed-in person saying "dogs welcome here" counts as the listing being checked today.
    await db.query('UPDATE places SET last_checked_at = $1 WHERE id = $2', [iso(Date.now()), p.id])
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
    if (p.managed_by && p.managed_by !== req.user.id) throw new HttpError(403, 'Someone maintains this listing now, so it cannot be removed here. Use Report a problem instead.')
    await db.tx(async (t) => {
      await t.query('DELETE FROM place_claims WHERE place_id = $1', [p.id])
      await t.query('DELETE FROM place_reports WHERE place_id = $1', [p.id])
      await t.query('DELETE FROM place_confirms WHERE place_id = $1', [p.id])
      await t.query('DELETE FROM places WHERE id = $1', [p.id])
    })
    res.json({ ok: true })
  })

  // -- the manager's edits. Only the person an admin approved for this place.
  api.patch('/places/:id', auth, async (req, res) => {
    const p = await placeFor(req.params.id)
    if (!p.managed_by || p.managed_by !== req.user.id) throw new HttpError(403, 'Only the person who maintains this listing can edit it.')
    const b = object(req.body), f = {}
    if (b.dogPolicy !== undefined) { if (!DOG_POLICIES.includes(b.dogPolicy)) throw bad(`Dog policy must be one of: ${DOG_POLICIES.join(', ')}.`); f.dog_policy = b.dogPolicy }
    if (b.note !== undefined) f.note = text(b.note, 'Note', { max: PLACE_LIMITS.note })
    if (b.amenities !== undefined) {
      if (!Array.isArray(b.amenities) || b.amenities.length > 20 || b.amenities.some((k) => !AMENITIES.includes(k))) throw bad(`Amenities must be a list from: ${AMENITIES.join(', ')}.`)
      f.amenities = JSON.stringify(AMENITIES.filter((k) => b.amenities.includes(k)))
    }
    if (b.eventNote !== undefined) f.event_note = text(b.eventNote, 'Event note', { max: PLACE_LIMITS.eventNote })
    if (b.website !== undefined) {
      // null or an empty string takes the link off.
      if (b.website === null || b.website === '') f.website = null
      else { f.website = httpsLink(b.website); if (!f.website) throw bad(`Website must be an https link of ${PLACE_LIMITS.website} characters or fewer.`) }
    }
    // Column names come from this fixed list, never from the request.
    const cols = ['dog_policy', 'note', 'amenities', 'event_note', 'website'].filter((c) => f[c] !== undefined)
    if (!cols.length) throw bad('Nothing to change.')
    await db.query(`UPDATE places SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, last_checked_at = $${cols.length + 1} WHERE id = $${cols.length + 2} AND managed_by = $${cols.length + 3}`, [...cols.map((c) => f[c]), iso(Date.now()), p.id, req.user.id])
    res.json({ place: out(await placeFor(p.id), await counts([p.id], req.user.id)) })
  })

  // -- claims. Anyone signed in can ask; an admin decides each one by hand.
  api.post('/places/:id/claim', auth, async (req, res) => {
    const p = await placeFor(req.params.id)
    const b = object(req.body), roles = claimRolesFor(p.category)
    if (!CLAIM_ROLES.includes(b.role)) throw bad(`Role must be one of: ${CLAIM_ROLES.join(', ')}.`)
    if (!roles.includes(b.role)) throw bad(roles[0] === 'steward' ? 'A park is claimed as its steward.' : 'A business is claimed as its owner.')
    const contact = email(b.contactEmail)
    const message = text(b.message, 'Message', { max: PLACE_LIMITS.claimMessage })
    if (p.managed_by) throw conflict(p.managed_by === req.user.id ? 'You already maintain this listing.' : 'Someone already maintains this listing. Use Report a problem if that looks wrong.')
    const open = await db.query('SELECT id FROM place_claims WHERE place_id = $1 AND user_id = $2 AND status = $3', [p.id, req.user.id, 'pending'])
    if (open.rows[0]) throw conflict('You already have a claim waiting on this place.')
    const r = claimLimit('user:' + req.user.id)
    if (!r.ok) return limited(res, r)
    const id = newId()
    try { await db.query('INSERT INTO place_claims (id, place_id, user_id, role, contact_email, message, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [id, p.id, req.user.id, b.role, contact, message, 'pending', iso(Date.now())]) }
    catch (e) { if (isUnique(e)) throw conflict('You already have a claim waiting on this place.'); throw e }
    res.status(201).json({ claim: { id, placeId: p.id, role: b.role, status: 'pending' } })
  })
  const CLAIM_SELECT = 'SELECT c.id, c.place_id, c.user_id, c.role, c.contact_email, c.message, c.status, c.created_at, c.decided_at, p.name AS place_name, p.category, p.address, p.managed_by, u.name AS user_name, u.email AS user_email FROM place_claims c JOIN places p ON p.id = c.place_id JOIN users u ON u.id = c.user_id'
  // Admins see the claimant's full name and both emails: they have to get in touch to check the claim.
  const claimOut = (c) => ({ id: c.id, role: c.role, status: c.status, contactEmail: c.contact_email, message: c.message, createdAt: iso(c.created_at), decidedAt: c.decided_at ? iso(c.decided_at) : null, place: { id: c.place_id, name: c.place_name, category: c.category, address: c.address || '', managed: !!c.managed_by }, by: { name: c.user_name, email: c.user_email } })
  api.get('/admin/claims', auth, admin, async (req, res) => {
    const status = req.query.status === undefined ? 'pending' : req.query.status
    if (!['pending', 'approved', 'rejected', 'all'].includes(status)) throw bad('status must be pending, approved, rejected or all.')
    const { rows } = status === 'all' ? await db.query(`${CLAIM_SELECT} ORDER BY c.created_at ASC, c.id ASC LIMIT 200`) : await db.query(`${CLAIM_SELECT} WHERE c.status = $1 ORDER BY c.created_at ASC, c.id ASC LIMIT 200`, [status])
    res.json({ claims: rows.map(claimOut) })
  })
  async function decide(req, res, status) {
    const id = req.params.id
    if (!ID_RE.test(id)) throw new HttpError(404, 'No such claim.')
    const now = iso(Date.now())
    await db.tx(async (t) => {
      const c = (await t.query('SELECT id, place_id, user_id, role, status FROM place_claims WHERE id = $1', [id])).rows[0]
      if (!c) throw new HttpError(404, 'No such claim.')
      // Decided once: the UPDATE only matches while the claim is still waiting.
      const u = await t.query('UPDATE place_claims SET status = $1, decided_at = $2 WHERE id = $3 AND status = $4 RETURNING id', [status, now, id, 'pending'])
      if (!u.rows[0]) throw conflict(`This claim was already ${c.status}.`)
      if (status === 'approved') await t.query('UPDATE places SET managed_by = $1, managed_role = $2 WHERE id = $3', [c.user_id, c.role, c.place_id])
    })
    res.json({ claim: claimOut((await db.query(`${CLAIM_SELECT} WHERE c.id = $1`, [id])).rows[0]) })
  }
  // Approving makes the claimant the place's manager. An earlier manager, if any, is replaced.
  api.post('/admin/claims/:id/approve', auth, admin, (req, res) => decide(req, res, 'approved'))
  api.post('/admin/claims/:id/reject', auth, admin, (req, res) => decide(req, res, 'rejected'))

  // -- reports. One open report per person per place.
  api.post('/places/:id/report', auth, async (req, res) => {
    const p = await placeFor(req.params.id)
    const b = object(req.body)
    if (!REPORT_REASONS.includes(b.reason)) throw bad(`Reason must be one of: ${REPORT_REASONS.join(', ')}.`)
    const note = text(b.note, 'Note', { max: PLACE_LIMITS.note })
    const open = await db.query('SELECT id FROM place_reports WHERE place_id = $1 AND user_id = $2 AND resolved_at IS NULL', [p.id, req.user.id])
    if (open.rows[0]) throw conflict('You already reported this place. We are looking at it.')
    const r = reportLimit('user:' + req.user.id)
    if (!r.ok) return limited(res, r)
    const id = newId()
    try { await db.query('INSERT INTO place_reports (id, place_id, user_id, reason, note, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [id, p.id, req.user.id, b.reason, note, iso(Date.now())]) }
    catch (e) { if (isUnique(e)) throw conflict('You already reported this place. We are looking at it.'); throw e }
    res.status(201).json({ report: { id, placeId: p.id, reason: b.reason }, flagged: ((await counts([p.id], null)).flags[p.id] || 0) >= PLACE_LIMITS.flagAt })
  })
  const REPORT_SELECT = 'SELECT r.id, r.place_id, r.reason, r.note, r.created_at, r.resolved_at, p.name AS place_name, p.category, p.address, u.name AS user_name FROM place_reports r JOIN places p ON p.id = r.place_id JOIN users u ON u.id = r.user_id'
  api.get('/admin/reports', auth, admin, async (req, res) => {
    const status = req.query.status === undefined ? 'open' : req.query.status
    if (!['open', 'resolved'].includes(status)) throw bad('status must be open or resolved.')
    const { rows } = await db.query(`${REPORT_SELECT} WHERE r.resolved_at IS ${status === 'open' ? '' : 'NOT '}NULL ORDER BY r.created_at ASC, r.id ASC LIMIT 200`)
    const c = await counts([...new Set(rows.map((r) => r.place_id))], null)
    res.json({ reports: rows.map((r) => ({ id: r.id, reason: r.reason, note: r.note, createdAt: iso(r.created_at), resolvedAt: r.resolved_at ? iso(r.resolved_at) : null, place: { id: r.place_id, name: r.place_name, category: r.category, address: r.address || '', flagged: (c.flags[r.place_id] || 0) >= PLACE_LIMITS.flagAt }, by: firstName(r.user_name) })) })
  })
  api.post('/admin/reports/:id/resolve', auth, admin, async (req, res) => {
    const id = req.params.id
    const u = ID_RE.test(id) ? await db.query('UPDATE place_reports SET resolved_at = $1 WHERE id = $2 AND resolved_at IS NULL RETURNING id', [iso(Date.now()), id]) : { rows: [] }
    if (!u.rows[0]) throw new HttpError(404, 'No open report like that.')
    res.json({ ok: true })
  })
}
