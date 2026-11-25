// Health records, the computed activity summary and "Share with the vet" links.
// Registered from app.js, which hands over the shared helpers as `kit`.
import { renderVetPage, renderVetGone } from './vetPage.js'

export const HEALTH_KINDS = ['weight', 'vaccine', 'medication', 'vet_visit', 'condition', 'note']
export const HEALTH_LIMITS = { title: 80, detail: 80, schedule: 80, notes: 1000, entriesPerDog: 500, sharesPerDog: 10, shareDays: 14 }
const DAY = 864e5
const LB_PER_KG = 2.20462

// Day arithmetic. `tz` is minutes behind UTC, the same number a browser's
// getTimezoneOffset() gives, so "today" and streaks follow the person's own calendar.
export const dayIndex = (t, tz = 0) => Math.floor((t - tz * 60e3) / DAY)
export const dayString = (t, tz = 0) => new Date(t - tz * 60e3).toISOString().slice(0, 10)
const dayNumber = (s) => Math.round(Date.parse(s + 'T00:00:00Z') / DAY)
export function tzOf(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(-840, Math.min(840, Math.round(n))) : 0
}

// Longest run of consecutive days in a set of day indexes.
export function bestStreak(days) {
  let best = 0
  for (const d of days) {
    if (days.has(d - 1)) continue
    let n = 1
    while (days.has(d + n)) n++
    if (n > best) best = n
  }
  return best
}

// Activity health from saved walks. Daycare days are left out, as they are in the
// weekly bars. Weeks are rolling 7-day windows that end today.
export function activitySummary(walks, now, tz = 0) {
  const r1 = (v) => Math.round(v * 10) / 10
  const today = dayIndex(now, tz)
  const weeks = [...Array(8)].map((_, i) => ({ start: dayString(now - (i * 7 + 6) * DAY, tz), end: dayString(now - i * 7 * DAY, tz), minutes: 0, miles: 0, outings: 0, byType: {} }))
  const days = new Set(), active = new Set()
  let todayMinutes = 0, topSpeed = 0, sprints = 0
  for (const w of walks) {
    if (w.type === 'Daycare') continue
    const ago = Math.max(0, today - dayIndex(new Date(w.started_at).getTime(), tz))
    days.add(today - ago)
    if (ago === 0) todayMinutes += Number(w.minutes) || 0
    if (ago < 7) { active.add(ago); topSpeed = Math.max(topSpeed, Number(w.max_speed) || 0); sprints += Number(w.sprints) || 0 }
    const k = Math.floor(ago / 7)
    if (k < 8) { weeks[k].minutes += Number(w.minutes) || 0; weeks[k].miles += Number(w.miles) || 0; weeks[k].outings += 1; weeks[k].byType[w.type] = (weeks[k].byType[w.type] || 0) + (Number(w.minutes) || 0) }
  }
  for (const w of weeks) { w.minutes = Math.round(w.minutes); w.miles = r1(w.miles); for (const k of Object.keys(w.byType)) w.byType[k] = Math.round(w.byType[k]) }
  const prev = weeks.slice(1, 5)
  const avgMin = prev.reduce((s, w) => s + w.minutes, 0) / 4, avgMi = prev.reduce((s, w) => s + w.miles, 0) / 4
  // A streak is still alive if the last walk was yesterday.
  let streak = 0
  for (let d = days.has(today) ? today : today - 1; days.has(d); d--) streak++
  return {
    // Speeds come from the phone carried on the walk. Missing ones stay null rather than zero.
    last7: { minutes: weeks[0].minutes, miles: weeks[0].miles, outings: weeks[0].outings, topSpeed: topSpeed > 0 ? r1(topSpeed) : null, sprints, byType: Object.entries(weeks[0].byType).map(([type, minutes]) => ({ type, minutes })).sort((a, b) => b.minutes - a.minutes) },
    previousWeeklyAverage: { minutes: Math.round(avgMin), miles: r1(avgMi) },
    changePercent: { minutes: avgMin > 0 ? Math.round(((weeks[0].minutes - avgMin) / avgMin) * 100) : null, miles: avgMi > 0 ? Math.round(((weeks[0].miles - avgMi) / avgMi) * 100) : null },
    activeDays: active.size, streakDays: streak, todayMinutes: Math.round(todayMinutes),
    weeks: weeks.slice().reverse(),
  }
}

export function weightSummary(entries) {
  const ws = entries.filter((e) => e.kind === 'weight' && e.value != null && e.occurredOn).sort((a, b) => (a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : a.createdAt < b.createdAt ? -1 : 1))
  if (!ws.length) return null
  const last = ws[ws.length - 1], first = ws[0]
  const to = (e) => (e.unit === last.unit ? e.value : last.unit === 'kg' ? e.value / LB_PER_KG : e.value * LB_PER_KG)
  return {
    latest: { value: last.value, unit: last.unit, on: last.occurredOn }, count: ws.length,
    change: ws.length > 1 ? { value: Math.round((last.value - to(first)) * 10) / 10, unit: last.unit, since: first.occurredOn } : null,
    history: ws.map((e) => ({ on: e.occurredOn, value: Math.round(to(e) * 10) / 10, unit: last.unit })),
  }
}
// Vaccines and preventives: "Due soon" inside 30 days, "Overdue" after the date.
export function dueStatus(dueOn, today) {
  if (!dueOn) return null
  const left = dayNumber(dueOn) - dayNumber(today)
  return left < 0 ? 'overdue' : left <= 30 ? 'due_soon' : 'ok'
}
export const byDue = (a, b) => (a.dueOn || '9999') < (b.dueOn || '9999') ? -1 : (a.dueOn || '9999') > (b.dueOn || '9999') ? 1 : 0

export function registerHealth(kit) {
  const { api, app, db, auth, dogFor, memberItem, HttpError, bad, text, number, object, sha, newToken, newId, iso, num, firstName, origin, ID_RE, TOKEN_RE, readLimit, pageHeaders } = kit
  const L = HEALTH_LIMITS

  function date(v, label, { optional = true, future = true } = {}) {
    if (v == null || v === '') { if (optional) return null; throw bad(`${label} is required.`) }
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad(`${label} must look like 2026-05-30.`)
    const d = new Date(v + 'T00:00:00Z')
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw bad(`${label} is not a real date.`)
    if (v < '1990-01-01') throw bad(`${label} is too long ago.`)
    if (!future && d.getTime() > Date.now() + 1.6 * DAY) throw bad(`${label} cannot be in the future.`)
    if (d.getTime() > Date.now() + 30 * 365.25 * DAY) throw bad(`${label} is too far in the future.`)
    return v
  }
  // The whole entry is checked every time, so an edit cannot leave a half-valid row.
  function entryFields(kind, b) {
    const f = { title: '', value: null, unit: null, occurred_on: null, due_on: null, detail: '', schedule: '', notes: '' }
    const order = (a, z, msg) => { if (a && z && z < a) throw bad(msg) }
    if (kind === 'weight') {
      f.unit = b.unit === undefined || b.unit === null ? 'lb' : b.unit
      if (f.unit !== 'lb' && f.unit !== 'kg') throw bad('Unit must be lb or kg.')
      f.value = number(b.value, 'Weight', f.unit === 'kg' ? { min: 0.2, max: 200 } : { min: 0.5, max: 400 })
      f.occurred_on = date(b.occurredOn, 'Date', { optional: false, future: false })
      f.notes = text(b.notes, 'Notes', { max: L.notes })
    } else if (kind === 'vaccine') {
      f.title = text(b.title, 'Name', { min: 1, max: L.title })
      f.occurred_on = date(b.occurredOn, 'Date given', { future: false })
      f.due_on = date(b.dueOn, 'Next due date')
      order(f.occurred_on, f.due_on, 'The next due date cannot be before the date given.')
      f.notes = text(b.notes, 'Notes', { max: L.notes })
    } else if (kind === 'medication') {
      f.title = text(b.title, 'Name', { min: 1, max: L.title })
      f.detail = text(b.detail, 'Dose', { max: L.detail })
      f.schedule = text(b.schedule, 'Schedule', { max: L.schedule })
      f.occurred_on = date(b.occurredOn, 'Start date')
      f.due_on = date(b.dueOn, 'End date')
      order(f.occurred_on, f.due_on, 'The end date cannot be before the start date.')
      f.notes = text(b.notes, 'Notes', { max: L.notes })
    } else if (kind === 'vet_visit') {
      f.occurred_on = date(b.occurredOn, 'Date', { optional: false, future: false })
      f.detail = text(b.detail, 'Clinic', { max: L.detail })
      f.title = text(b.title, 'Reason', { min: 1, max: L.title })
      f.notes = text(b.notes, 'Notes', { max: L.notes })
    } else if (kind === 'condition') {
      f.title = text(b.title, 'Name', { min: 1, max: L.title })
      f.notes = text(b.notes, 'Notes', { max: L.notes })
    } else {
      f.title = text(b.title, 'Title', { max: L.title })
      f.notes = text(b.notes, 'Note', { min: 1, max: L.notes })
    }
    return f
  }
  // A health entry can point at one of the same dog's documents, such as a vaccine certificate.
  async function documentRef(v, dogId) {
    if (v == null || v === '') return null
    if (typeof v !== 'string' || !ID_RE.test(v)) throw bad('That document does not exist.')
    const { rows } = await db.query('SELECT id FROM documents WHERE id = $1 AND dog_id = $2', [v, dogId])
    if (!rows[0]) throw bad('That document does not belong to this dog.')
    return v
  }
  const COLS = 'h.id, h.dog_id, h.kind, h.title, h.value, h.unit, h.occurred_on, h.due_on, h.detail, h.schedule, h.notes, h.document_id, h.created_by, h.created_at'
  const SELECT = `SELECT ${COLS}, u.name AS user_name, dc.name AS document_name FROM health_entries h JOIN users u ON u.id = h.created_by LEFT JOIN documents dc ON dc.id = h.document_id`
  const entryOut = (r, userId, role, today) => ({
    id: r.id, kind: r.kind, title: r.title, value: r.value == null ? null : num(r.value), unit: r.unit || null, occurredOn: r.occurred_on || null, dueOn: r.due_on || null,
    detail: r.detail, schedule: r.schedule, notes: r.notes, document: r.document_id && r.document_name != null ? { id: r.document_id, name: r.document_name } : null,
    ...(r.kind === 'vaccine' ? { status: dueStatus(r.due_on, today) } : {}),
    addedBy: firstName(r.user_name), createdAt: iso(r.created_at), ...(userId ? { canEdit: r.created_by === userId || role === 'owner' } : {}),
  })
  async function entriesFor(dogId, userId, role, today) {
    const { rows } = await db.query(`${SELECT} WHERE h.dog_id = $1 ORDER BY h.created_at DESC, h.id DESC LIMIT ${L.entriesPerDog}`, [dogId])
    return rows.map((r) => entryOut(r, userId, role, today))
  }
  async function activityFor(dogId, now, tz) {
    const w = await db.query('SELECT started_at, minutes, miles, type, max_speed, sprints FROM walks WHERE dog_id = $1 AND started_at >= $2 ORDER BY started_at DESC LIMIT 5000', [dogId, iso(now - 400 * DAY)])
    const a = activitySummary(w.rows, now, tz)
    const top = await db.query('SELECT title, minutes, miles, started_at FROM walks WHERE dog_id = $1 AND type <> $2 ORDER BY minutes DESC, started_at DESC LIMIT 1', [dogId, 'Daycare'])
    a.longestWalk = top.rows[0] ? { title: top.rows[0].title, minutes: Math.round(num(top.rows[0].minutes)), miles: num(top.rows[0].miles), on: dayString(new Date(top.rows[0].started_at).getTime(), tz) } : null
    const fast = await db.query('SELECT title, max_speed, started_at FROM walks WHERE dog_id = $1 AND max_speed IS NOT NULL AND max_speed > 0 ORDER BY max_speed DESC, started_at DESC LIMIT 1', [dogId])
    a.bestTopSpeed = fast.rows[0] ? { title: fast.rows[0].title, mph: Math.round(num(fast.rows[0].max_speed) * 10) / 10, on: dayString(new Date(fast.rows[0].started_at).getTime(), tz) } : null
    return a
  }
  const summaryOf = (entries, activity, dog) => {
    const vax = entries.filter((e) => e.kind === 'vaccine')
    const goal = dog.goal_minutes == null ? null : num(dog.goal_minutes)
    return {
      activity, weight: weightSummary(entries),
      goal: { minutes: goal, todayMinutes: activity.todayMinutes, percent: goal ? Math.min(100, Math.round((activity.todayMinutes / goal) * 100)) : null },
      vaccines: { overdue: vax.filter((e) => e.status === 'overdue').length, dueSoon: vax.filter((e) => e.status === 'due_soon').length },
    }
  }

  api.get('/dogs/:slug/health', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    const now = Date.now(), tz = tzOf(req.query.tz)
    const entries = await entriesFor(dog.id, req.user.id, role, dayString(now, tz))
    res.json({ entries, summary: summaryOf(entries, await activityFor(dog.id, now, tz), dog) })
  })
  api.post('/dogs/:slug/health', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    const b = object(req.body)
    if (!HEALTH_KINDS.includes(b.kind)) throw bad(`Kind must be one of: ${HEALTH_KINDS.join(', ')}.`)
    const f = entryFields(b.kind, b)
    const doc = await documentRef(b.documentId, dog.id)
    const n = await db.query('SELECT COUNT(*) AS n FROM health_entries WHERE dog_id = $1', [dog.id])
    if (num(n.rows[0].n) >= L.entriesPerDog) throw bad(`A dog can have up to ${L.entriesPerDog} health entries in this trial.`)
    const id = newId()
    await db.query('INSERT INTO health_entries (id, dog_id, kind, title, value, unit, occurred_on, due_on, detail, schedule, notes, document_id, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)',
      [id, dog.id, b.kind, f.title, f.value, f.unit, f.occurred_on, f.due_on, f.detail, f.schedule, f.notes, doc, req.user.id, iso(Date.now())])
    const { rows } = await db.query(`${SELECT} WHERE h.id = $1`, [id])
    res.status(201).json({ entry: entryOut(rows[0], req.user.id, role, dayString(Date.now(), tzOf(req.query.tz))) })
  })
  const mine = async (req) => {
    const e = await memberItem('health_entries', 'id, dog_id, kind, title, value, unit, occurred_on, due_on, detail, schedule, notes, document_id, created_by', req.params.id, req.user.id, 'No such health entry.')
    if (e.created_by !== req.user.id && e.role !== 'owner') throw new HttpError(403, 'Only the person who added this entry or the dog\'s owner can change it.')
    return e
  }
  api.patch('/health/:id', auth, async (req, res) => {
    const e = await mine(req)
    const b = object(req.body)
    if (b.kind !== undefined && b.kind !== e.kind) throw bad('The kind of an entry cannot change. Delete it and add a new one.')
    const cur = { title: e.title, value: e.value == null ? null : num(e.value), unit: e.unit, occurredOn: e.occurred_on, dueOn: e.due_on, detail: e.detail, schedule: e.schedule, notes: e.notes }
    const f = entryFields(e.kind, { ...cur, ...Object.fromEntries(Object.entries(b).filter(([k]) => k in cur)) })
    const doc = b.documentId === undefined ? e.document_id : await documentRef(b.documentId, e.dog_id)
    await db.query('UPDATE health_entries SET title = $1, value = $2, unit = $3, occurred_on = $4, due_on = $5, detail = $6, schedule = $7, notes = $8, document_id = $9 WHERE id = $10',
      [f.title, f.value, f.unit, f.occurred_on, f.due_on, f.detail, f.schedule, f.notes, doc, e.id])
    const { rows } = await db.query(`${SELECT} WHERE h.id = $1`, [e.id])
    res.json({ entry: entryOut(rows[0], req.user.id, e.role, dayString(Date.now(), tzOf(req.query.tz))) })
  })
  api.delete('/health/:id', auth, async (req, res) => {
    const e = await mine(req)
    await db.query('DELETE FROM health_entries WHERE id = $1', [e.id])
    res.json({ ok: true })
  })

  // -- share with the vet: owner-made links, 14 days, revocable, only a hash stored
  const shareOut = (r) => ({ id: r.token_hash, createdAt: iso(r.created_at), expiresAt: iso(r.expires_at) })
  api.post('/dogs/:slug/health/shares', auth, async (req, res) => {
    const { dog } = await dogFor(req.params.slug, req.user.id, { owner: true })
    const now = Date.now()
    const open = await db.query('SELECT COUNT(*) AS n FROM health_shares WHERE dog_id = $1 AND revoked_at IS NULL AND expires_at > $2', [dog.id, iso(now)])
    if (num(open.rows[0].n) >= L.sharesPerDog) throw bad('This dog has too many open vet links. Turn one off first.')
    const token = newToken()
    const row = { token_hash: sha(token), created_at: iso(now), expires_at: iso(now + L.shareDays * DAY) }
    await db.query('INSERT INTO health_shares (token_hash, dog_id, created_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)', [row.token_hash, dog.id, req.user.id, row.created_at, row.expires_at])
    const p = `/vet/${token}`
    res.status(201).json({ ...shareOut(row), token, path: p, url: origin(req) + p })
  })
  api.get('/dogs/:slug/health/shares', auth, async (req, res) => {
    const { dog } = await dogFor(req.params.slug, req.user.id, { owner: true })
    const { rows } = await db.query('SELECT token_hash, created_at, expires_at FROM health_shares WHERE dog_id = $1 AND revoked_at IS NULL AND expires_at > $2 ORDER BY created_at DESC, token_hash ASC', [dog.id, iso(Date.now())])
    res.json({ shares: rows.map(shareOut) })
  })
  api.delete('/dogs/:slug/health/shares/:id', auth, async (req, res) => {
    const { dog } = await dogFor(req.params.slug, req.user.id, { owner: true })
    if (!/^[a-f0-9]{64}$/.test(req.params.id)) throw new HttpError(404, 'No open vet link like that.')
    const u = await db.query('UPDATE health_shares SET revoked_at = $1 WHERE token_hash = $2 AND dog_id = $3 AND revoked_at IS NULL RETURNING token_hash', [iso(Date.now()), req.params.id, dog.id])
    if (!u.rows[0]) throw new HttpError(404, 'No open vet link like that.')
    res.json({ ok: true })
  })

  // The summary page itself. An unknown, expired or revoked link all look the same.
  async function shareFor(token) {
    if (!TOKEN_RE.test(token)) return null
    const { rows } = await db.query('SELECT s.dog_id, s.expires_at, d.name, d.breed, d.birthday, d.age, d.goal_minutes FROM health_shares s JOIN dogs d ON d.id = s.dog_id WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2', [sha(token), iso(Date.now())])
    return rows[0] || null
  }
  const vetHeaders = (res) => { pageHeaders(res); res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow').set('Referrer-Policy', 'no-referrer') }
  app.get('/vet/:token', async (req, res) => {
    const r = readLimit('ip:' + req.ip)
    vetHeaders(res)
    if (!r.ok) return res.status(429).set('Retry-After', String(r.retry)).send(renderVetGone())
    try {
      const s = await shareFor(req.params.token)
      if (!s) return res.status(404).send(renderVetGone())
      const now = Date.now()
      const entries = await entriesFor(s.dog_id, null, null, dayString(now))
      const docs = await db.query('SELECT id, name, category FROM documents WHERE dog_id = $1 AND in_vet_summary = TRUE ORDER BY created_at DESC LIMIT 50', [s.dog_id])
      res.send(renderVetPage({
        dog: { name: s.name, breed: s.breed, age: kit.ageLabel(s) }, expiresAt: iso(s.expires_at), generatedAt: iso(now),
        entries, summary: summaryOf(entries, await activityFor(s.dog_id, now, 0), s),
        documents: docs.rows.map((d) => ({ name: d.name, category: d.category, href: `/vet/${req.params.token}/doc/${d.id}` })),
      }))
    } catch (e) { console.error(e); res.status(500).send(renderVetGone()) }
  })
  // A document the owner ticked for the vet summary. It opens only while the link is valid.
  app.get('/vet/:token/doc/:id', async (req, res) => {
    const r = readLimit('ip:' + req.ip)
    vetHeaders(res)
    if (!r.ok) return res.status(429).set('Retry-After', String(r.retry)).send(renderVetGone())
    try {
      const s = await shareFor(req.params.token)
      const { rows } = s && ID_RE.test(req.params.id) ? await db.query('SELECT name, content_type, data FROM documents WHERE id = $1 AND dog_id = $2 AND in_vet_summary = TRUE', [req.params.id, s.dog_id]) : { rows: [] }
      if (!rows[0]) return res.status(404).send(renderVetGone())
      kit.sendDocument(res, rows[0])
    } catch (e) { console.error(e); res.status(500).send(renderVetGone()) }
  })
  app.use('/vet', (req, res) => { vetHeaders(res); res.status(404).send(renderVetGone()) })
}
