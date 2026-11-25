// Awards a dog's people record, and the community calendar of shows and events.
// There is no open public feed of dog shows, so events are added by people, plus a
// short curated list loaded from server/seed-events.json.
import crypto from 'node:crypto'

export const AWARD_KINDS = ['title', 'ribbon', 'certificate', 'trick', 'other']
export const EVENT_KINDS = ['conformation', 'agility', 'obedience', 'rally', 'fun_match', 'meetup', 'class', 'other']
export const ENTRY_STATUSES = ['going', 'entered', 'attended']
export const SHOW_LIMITS = { title: 80, eventName: 100, placement: 60, notes: 500, awardsPerDog: 200, name: 100, venue: 100, city: 60, region: 40, url: 300, description: 600, result: 120, rows: 100, nearMiles: 60 }
const DAY = 864e5
const today = () => new Date().toISOString().slice(0, 10)
const milesBetween = (a, b) => { const R = 3958.8, r = Math.PI / 180, x = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)) }
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v
// Only plain web links. Anything else, such as javascript: or data:, is refused.
export function httpUrl(v) {
  if (typeof v !== 'string' || v.length > SHOW_LIMITS.url || /[\s<>"'`\\]/.test(v)) return null
  let u
  try { u = new URL(v) } catch (e) { return null }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname.includes('.') || u.username || u.password) return null
  return u.href
}

// Loads the curated list. Keyed on name plus start date, so a restart never
// duplicates a row and an edit to the file updates it. Past events are skipped.
export async function seedEvents(db, data, now = Date.now()) {
  const list = data && Array.isArray(data.events) ? data.events : []
  const day = new Date(now).toISOString().slice(0, 10)
  const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
  let kept = 0
  for (const e of list) {
    const name = str(e.name, SHOW_LIMITS.name), url = httpUrl(e.url)
    const ends = isDate(e.ends_on) ? e.ends_on : null
    if (name.length < 2 || !isDate(e.starts_on) || !EVENT_KINDS.includes(e.kind) || !url) continue
    if ((ends || e.starts_on) < day) continue
    const geo = typeof e.lat === 'number' && typeof e.lng === 'number' && Math.abs(e.lat) <= 90 && Math.abs(e.lng) <= 180
    const vals = [e.kind, ends, str(e.venue, SHOW_LIMITS.venue), str(e.city, SHOW_LIMITS.city), str(e.region, SHOW_LIMITS.region), geo ? e.lat : null, geo ? e.lng : null, url, str(e.description, SHOW_LIMITS.description), url]
    const u = await db.query('UPDATE events SET kind = $1, ends_on = $2, venue = $3, city = $4, region = $5, lat = $6, lng = $7, url = $8, description = $9, source_url = $10 WHERE curated = TRUE AND name = $11 AND starts_on = $12 RETURNING id', [...vals, name, e.starts_on])
    if (!u.rows[0]) await db.query('INSERT INTO events (id, kind, ends_on, venue, city, region, lat, lng, url, description, source_url, name, starts_on, curated, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE, NULL, $14)', [crypto.randomUUID(), ...vals, name, e.starts_on, new Date(now).toISOString()])
    kept++
  }
  return kept
}

export function registerShows(kit) {
  const { api, db, auth, userFor, dogFor, memberItem, HttpError, bad, text, number, bool, object, newId, iso, num, firstName, ID_RE, limiter, limited, R, tzOf } = kit
  const L = SHOW_LIMITS
  const addLimit = limiter({ windowMs: R.eventWindowMs, max: R.eventMax })
  function date(v, label, { optional = false } = {}) {
    if (v == null || v === '') { if (optional) return null; throw bad(`${label} is required.`) }
    if (!isDate(v)) throw bad(`${label} must be a real date that looks like 2026-05-30.`)
    return v
  }

  // ---- awards -----------------------------------------------------------------
  const A_SELECT = 'SELECT a.id, a.dog_id, a.title, a.kind, a.event_name, a.placement, a.awarded_on, a.notes, a.document_id, a.is_public, a.created_by, a.created_at, u.name AS user_name, dc.name AS document_name FROM awards a JOIN users u ON u.id = a.created_by LEFT JOIN documents dc ON dc.id = a.document_id'
  const awardOut = (r, userId, role) => ({
    id: r.id, title: r.title, kind: r.kind, eventName: r.event_name, placement: r.placement, awardedOn: r.awarded_on || null, notes: r.notes, public: !!r.is_public,
    document: r.document_id && r.document_name != null ? { id: r.document_id, name: r.document_name } : null, addedBy: firstName(r.user_name), createdAt: iso(r.created_at), canEdit: r.created_by === userId || role === 'owner',
  })
  async function awardFields(b, cur, dogId, role) {
    const f = { ...cur }
    if (b.title !== undefined) f.title = text(b.title, 'Title', { min: 1, max: L.title })
    if (b.kind !== undefined) { if (!AWARD_KINDS.includes(b.kind)) throw bad(`Kind must be one of: ${AWARD_KINDS.join(', ')}.`); f.kind = b.kind }
    if (b.eventName !== undefined) f.event_name = text(b.eventName, 'Event', { max: L.eventName })
    if (b.placement !== undefined) f.placement = text(b.placement, 'Placement', { max: L.placement })
    if (b.notes !== undefined) f.notes = text(b.notes, 'Notes', { max: L.notes })
    if (b.awardedOn !== undefined) {
      f.awarded_on = date(b.awardedOn, 'Date', { optional: true })
      if (f.awarded_on && (f.awarded_on < '1990-01-01' || Date.parse(f.awarded_on + 'T00:00:00Z') > Date.now() + 1.6 * DAY)) throw bad('The date cannot be in the future or before 1990.')
    }
    if (b.documentId !== undefined) {
      f.document_id = null
      if (b.documentId != null && b.documentId !== '') {
        const ok = typeof b.documentId === 'string' && ID_RE.test(b.documentId) && (await db.query('SELECT id FROM documents WHERE id = $1 AND dog_id = $2', [b.documentId, dogId])).rows[0]
        if (!ok) throw bad('That document does not belong to this dog.')
        f.document_id = b.documentId
      }
    }
    if (b.public !== undefined) {
      const v = bool(b.public, 'public')
      // The owner decides what the public page shows.
      if (v !== !!f.is_public && role !== 'owner') throw new HttpError(403, 'Only the owner can choose what shows on the public page.')
      f.is_public = v
    }
    return f
  }
  api.get('/dogs/:slug/awards', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    const { rows } = await db.query(`${A_SELECT} WHERE a.dog_id = $1 ORDER BY a.awarded_on DESC, a.created_at DESC LIMIT ${L.awardsPerDog}`, [dog.id])
    res.json({ awards: rows.map((r) => awardOut(r, req.user.id, role)), badges: await kit.badgesFor(dog.id, tzOf(req.query.tz)) })
  })
  api.post('/dogs/:slug/awards', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    const b = object(req.body)
    const f = await awardFields({ title: b.title ?? '', kind: b.kind === undefined ? 'other' : b.kind, ...b }, { title: '', kind: 'other', event_name: '', placement: '', awarded_on: null, notes: '', document_id: null, is_public: false }, dog.id, role)
    const n = await db.query('SELECT COUNT(*) AS n FROM awards WHERE dog_id = $1', [dog.id])
    if (num(n.rows[0].n) >= L.awardsPerDog) throw bad(`A dog can have up to ${L.awardsPerDog} awards in this trial.`)
    const id = newId()
    await db.query('INSERT INTO awards (id, dog_id, title, kind, event_name, placement, awarded_on, notes, document_id, is_public, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
      [id, dog.id, f.title, f.kind, f.event_name, f.placement, f.awarded_on, f.notes, f.document_id, f.is_public, req.user.id, iso(Date.now())])
    res.status(201).json({ award: awardOut((await db.query(`${A_SELECT} WHERE a.id = $1`, [id])).rows[0], req.user.id, role) })
  })
  const awardFor = async (req) => {
    const a = await memberItem('awards', 'id, dog_id, title, kind, event_name, placement, awarded_on, notes, document_id, is_public, created_by', req.params.id, req.user.id, 'No such award.')
    if (a.created_by !== req.user.id && a.role !== 'owner') throw new HttpError(403, 'Only the person who added this award or the dog\'s owner can change it.')
    return a
  }
  api.patch('/awards/:id', auth, async (req, res) => {
    const a = await awardFor(req)
    const f = await awardFields(object(req.body), a, a.dog_id, a.role)
    await db.query('UPDATE awards SET title = $1, kind = $2, event_name = $3, placement = $4, awarded_on = $5, notes = $6, document_id = $7, is_public = $8 WHERE id = $9', [f.title, f.kind, f.event_name, f.placement, f.awarded_on, f.notes, f.document_id, !!f.is_public, a.id])
    res.json({ award: awardOut((await db.query(`${A_SELECT} WHERE a.id = $1`, [a.id])).rows[0], req.user.id, a.role) })
  })
  api.delete('/awards/:id', auth, async (req, res) => {
    const a = await awardFor(req)
    await db.query('DELETE FROM awards WHERE id = $1', [a.id])
    res.json({ ok: true })
  })

  // ---- events -----------------------------------------------------------------
  const E_SELECT = 'SELECT e.id, e.name, e.kind, e.starts_on, e.ends_on, e.venue, e.city, e.region, e.lat, e.lng, e.url, e.description, e.source_url, e.curated, e.created_by, u.name AS user_name FROM events e LEFT JOIN users u ON u.id = e.created_by'
  async function eventsOut(rows, user) {
    const ids = rows.map((r) => r.id), going = {}, mine = {}
    if (ids.length) {
      const ph = ids.map((_, i) => `$${i + 1}`).join(', ')
      const c = await db.query(`SELECT event_id, COUNT(*) AS n FROM event_entries WHERE event_id IN (${ph}) GROUP BY event_id`, ids)
      c.rows.forEach((r) => { going[r.event_id] = num(r.n) })
      if (user) {
        const m = await db.query(`SELECT x.event_id, x.status, x.result, d.slug, d.name FROM event_entries x JOIN dogs d ON d.id = x.dog_id JOIN memberships m ON m.dog_id = x.dog_id AND m.user_id = $${ids.length + 1} WHERE x.event_id IN (${ph})`, [...ids, user.id])
        m.rows.forEach((r) => { (mine[r.event_id] || (mine[r.event_id] = [])).push({ dog: r.slug, name: r.name, status: r.status, result: r.result || null }) })
      }
    }
    return rows.map((r) => ({
      id: r.id, name: r.name, kind: r.kind, startsOn: r.starts_on, endsOn: r.ends_on || null, venue: r.venue, city: r.city, region: r.region,
      // Curated coordinates are city-level. They are for the nearby filter, not for drawing a pin.
      at: r.lat == null || r.lng == null ? null : [num(r.lat), num(r.lng)], approximate: !!r.curated, url: r.url || null, description: r.description,
      curated: !!r.curated, sourceUrl: r.source_url || null, addedBy: r.curated ? null : firstName(r.user_name), mine: !!(user && r.created_by === user.id), going: going[r.id] || 0, entries: mine[r.id] || [],
    }))
  }
  // No sign-in needed. Upcoming first.
  api.get('/events', async (req, res) => {
    const from = req.query.from === undefined ? today() : date(String(req.query.from), 'from')
    let near = null
    if (req.query.near !== undefined) {
      const p = String(req.query.near).split(',').map((v) => (v.trim() === '' ? NaN : Number(v)))
      if (p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180) throw bad('near must look like 42.36,-71.06.')
      near = p
    }
    const { rows } = await db.query(`${E_SELECT} WHERE COALESCE(e.ends_on, e.starts_on) >= $1 ORDER BY e.starts_on ASC, e.name ASC, e.id ASC LIMIT 1000`, [from])
    const hit = near ? rows.filter((r) => r.lat != null && r.lng != null && milesBetween(near, [num(r.lat), num(r.lng)]) <= L.nearMiles) : rows
    res.json({ events: await eventsOut(hit.slice(0, L.rows), await userFor(req)), nearMiles: near ? L.nearMiles : null })
  })
  api.post('/events', auth, async (req, res) => {
    const b = object(req.body)
    const name = text(b.name, 'Name', { min: 1, max: L.name })
    if (name.length < 2) throw bad('Name must be at least 2 characters.')
    if (!EVENT_KINDS.includes(b.kind)) throw bad(`Kind must be one of: ${EVENT_KINDS.join(', ')}.`)
    const starts = date(b.startsOn, 'Start date'), ends = date(b.endsOn, 'End date', { optional: true })
    const t = Date.parse(starts + 'T00:00:00Z')
    if (t < Date.now() - 2 * DAY) throw bad('The start date is in the past.')
    if (t > Date.now() + 2 * 365 * DAY) throw bad('The start date is more than two years away.')
    if (ends && (ends < starts || Date.parse(ends + 'T00:00:00Z') - t > 31 * DAY)) throw bad('The end date must be on or after the start date, and within a month of it.')
    const venue = text(b.venue, 'Venue', { max: L.venue }), city = text(b.city, 'City', { min: 1, max: L.city }), region = text(b.region, 'State or region', { max: L.region })
    const description = text(b.description, 'Description', { max: L.description })
    const hasLat = b.lat != null && b.lat !== '', hasLng = b.lng != null && b.lng !== ''
    if (hasLat !== hasLng) throw bad('Send both lat and lng, or neither.')
    const lat = hasLat ? number(b.lat, 'lat', { min: -90, max: 90 }) : null, lng = hasLng ? number(b.lng, 'lng', { min: -180, max: 180 }) : null
    let url = null
    if (b.url != null && b.url !== '') { url = httpUrl(b.url); if (!url) throw bad('The link must be a web address that starts with http:// or https://.') }
    const r = addLimit('user:' + req.user.id)
    if (!r.ok) return limited(res, r)
    const id = newId()
    await db.query('INSERT INTO events (id, name, kind, starts_on, ends_on, venue, city, region, lat, lng, url, description, curated, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, FALSE, $13, $14)',
      [id, name, b.kind, starts, ends, venue, city, region, lat, lng, url, description, req.user.id, iso(Date.now())])
    res.status(201).json({ event: (await eventsOut((await db.query(`${E_SELECT} WHERE e.id = $1`, [id])).rows, req.user))[0] })
  })
  async function eventFor(id) {
    const { rows } = ID_RE.test(id) ? await db.query(`${E_SELECT} WHERE e.id = $1`, [id]) : { rows: [] }
    if (!rows[0]) throw new HttpError(404, 'No such event.')
    return rows[0]
  }
  api.delete('/events/:id', auth, async (req, res) => {
    const e = await eventFor(req.params.id)
    if (e.curated) throw new HttpError(403, 'This event comes from public listings and cannot be deleted here.')
    if (e.created_by !== req.user.id) throw new HttpError(403, 'Only the person who added this event can delete it.')
    await db.tx(async (t) => {
      await t.query('DELETE FROM event_entries WHERE event_id = $1', [e.id])
      await t.query('DELETE FROM events WHERE id = $1', [e.id])
    })
    res.json({ ok: true })
  })
  // A dog is marked going or entered, and later attended with a result.
  api.put('/events/:id/entries/:slug', auth, async (req, res) => {
    const e = await eventFor(req.params.id)
    const { dog } = await dogFor(req.params.slug, req.user.id)
    const b = req.body == null ? {} : object(req.body)
    const status = b.status === undefined ? 'going' : b.status
    if (!ENTRY_STATUSES.includes(status)) throw bad(`Status must be one of: ${ENTRY_STATUSES.join(', ')}.`)
    const result = b.result == null || b.result === '' ? null : text(b.result, 'Result', { max: L.result }) || null
    if (result && status !== 'attended') throw bad('A result goes with the status "attended".')
    const u = await db.query('UPDATE event_entries SET status = $1, result = $2 WHERE event_id = $3 AND dog_id = $4 RETURNING status', [status, result, e.id, dog.id])
    if (!u.rows[0]) await db.query('INSERT INTO event_entries (event_id, dog_id, status, result, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (event_id, dog_id) DO NOTHING', [e.id, dog.id, status, result, iso(Date.now())])
    res.json({ event: (await eventsOut([e], req.user))[0] })
  })
  api.delete('/events/:id/entries/:slug', auth, async (req, res) => {
    const e = await eventFor(req.params.id)
    const { dog } = await dogFor(req.params.slug, req.user.id)
    await db.query('DELETE FROM event_entries WHERE event_id = $1 AND dog_id = $2', [e.id, dog.id])
    res.json({ event: (await eventsOut([e], req.user))[0] })
  })
  // Every event this dog was marked for, past ones included, so a result can be added afterwards.
  api.get('/dogs/:slug/events', auth, async (req, res) => {
    const { dog } = await dogFor(req.params.slug, req.user.id)
    const { rows } = await db.query(`${E_SELECT} JOIN event_entries x ON x.event_id = e.id AND x.dog_id = $1 ORDER BY e.starts_on DESC, e.id ASC LIMIT 100`, [dog.id])
    res.json({ events: await eventsOut(rows, req.user) })
  })
}
