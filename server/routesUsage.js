// First-party usage counts and the admin metrics built on them. Registered from app.js with the shared `kit`.
//
// Privacy rules this file keeps:
// - No IP address, no coordinates, no email and no free text from people is stored. The one text field,
//   a client error message, is cut to 200 characters and has emails, tokens and long digit runs masked here
//   as well as in the browser.
// - Only the device family is kept ("Safari on iPhone or iPad"), never the user agent string.
// - Event names and the keys inside `props` come from the fixed lists below. Anything else is dropped.
// - Numbers arrive as buckets ("10_30"), never as exact minutes or miles.
// - Rows older than 180 days are deleted.
import express from 'express'
import { agentFamily } from './routesRegistration.js'

export const USAGE_LIMITS = { batch: 20, bodyBytes: 4096, propsBytes: 300, message: 200, keepDays: 180, maxDays: 90 }
const TOKEN = /^[A-Za-z0-9_ .:+\-]{1,40}$/
const tok = (v) => (typeof v === 'string' && TOKEN.test(v) ? v : undefined)
const flag = (v) => (typeof v === 'boolean' ? v : undefined)
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(100000, Math.round(v)) : undefined)
// Emails, bearer tokens, long opaque strings, ids and long digit runs never reach the table.
export function maskText(v, max = USAGE_LIMITS.message) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/g, '[email]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/-?\d{1,3}\.\d{4,}/g, '[n]')
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}\b/g, '[token]')
    .replace(/\d{6,}/g, '[digits]')
    .replace(/\s+/g, ' ').trim().slice(0, max)
}
// "/dogs/biscuit-2/walks?x=1" becomes "/dogs/:id/walks": ids, dog addresses, codes and the query never stay.
const FIXED = new Set(['api', 'dogs', 'walks', 'routes', 'route', 'photos', 'photo', 'friends', 'feed', 'suggestions', 'search', 'me', 'session', 'places', 'confirm', 'claim', 'report', 'events', 'entries', 'awards', 'health', 'shares', 'documents', 'file', 'registration', 'tags', 'scans', 'read', 'lost', 'invites', 'accept', 'members', 'challenges', 'leaderboards', 'pack', 'notifications', 'prefs', 'usage', 'admin', 'metrics', 'claims', 'reports', 'approve', 'reject', 'resolve', 'public', 'geo', 'config', 'heat', 'paw', 'parks', 'more'])
export function pathPattern(v) {
  const p = String(v == null ? '' : v).split(/[?#]/)[0].slice(0, 200)
  return p.split('/').map((seg, i) => (seg === '' && i === 0 ? '' : FIXED.has(seg) ? seg : ':id')).join('/').slice(0, 80)
}
// Every event the server accepts, with the props it keeps. Mirrored by EVENTS in src/usage.js; a test fails if the two drift.
export const USAGE_EVENTS = {
  app_open: { mode: tok, standalone: flag },
  sign_up: {}, sign_in: {}, dog_created: {},
  tab_view: { tab: tok },
  walk_started: { type: tok, gps: flag },
  walk_saved: { type: tok, minutes: tok, miles: tok, photos: count, had_gps: flag },
  walk_discarded: {},
  photo_added: { count },
  friend_added: {}, friend_removed: {}, invite_link_copied: {},
  care_invite_sent: {}, care_invite_accepted: {},
  place_opened: { category: tok, curated: flag },
  place_confirmed: {}, place_claim_sent: {}, place_reported: {},
  route_built: {},
  // The route builder and saved routes. Counts and fixed words only: never a name, a place or a coordinate.
  route_edited: { legs: tok }, route_saved: { kind: tok }, route_favorited: {}, route_started: { source: tok },
  loop_from_here: { result: tok },
  event_marked: {}, tag_created: {}, lost_mode_on: {}, lost_mode_off: {}, registration_saved: {},
  plan_viewed: {}, notification_opened: { kind: tok },
  location_permission: { state: tok },
  // Training: fixed words only (a track id, home/yard/out, a level number, a badge tier). Never a note or a skill a person typed.
  training_opened: {}, training_session_logged: { track: tok, place: tok }, training_level_confirmed: { level: count }, training_badge_earned: { tier: tok },
  // Live walk sharing: names only. No property is kept, so no position or place can ride along.
  live_share_started: {}, live_share_stopped: {}, live_friend_opened: {},
  client_error: { message: (v) => (typeof v === 'string' ? maskText(v) : undefined), kind: tok, screen: tok, method: (v) => (typeof v === 'string' && /^(GET|POST|PUT|PATCH|DELETE)$/.test(v) ? v : undefined), path: (v) => (typeof v === 'string' ? pathPattern(v) : undefined), status: count, code: count, n: count },
}
export function cleanProps(name, raw) {
  const spec = USAGE_EVENTS[name], out = {}
  if (!spec || !raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const k of Object.keys(spec)) { const v = spec[k](raw[k]); if (v !== undefined && v !== '') out[k] = v }
  // Capped at 300 bytes. Only an error message can be long, so that is what gives way.
  while (Buffer.byteLength(JSON.stringify(out)) > USAGE_LIMITS.propsBytes && out.message) out.message = out.message.slice(0, Math.max(0, out.message.length - 20))
  return Buffer.byteLength(JSON.stringify(out)) > USAGE_LIMITS.propsBytes ? {} : out
}
const DAY = 864e5
const ANON_RE = /^[A-Za-z0-9_-]{8,40}$/
const VERSION_RE = /^[A-Za-z0-9._-]{1,20}$/
const BEARER_RE = /^[A-Za-z0-9_-]{20,200}$/

export function registerUsage(kit) {
  const { api, db, auth, admin, sha, newId, iso, num, limiter, R, SLUG_RE, adminIds } = kit
  const usageLimit = limiter({ windowMs: R.usageWindowMs ?? 60e3, max: R.usageMax ?? 60 })
  // sendBeacon cannot set headers, so the body may arrive as text/plain and may carry the session token itself.
  const parse = express.json({ limit: USAGE_LIMITS.bodyBytes, type: ['application/json', 'text/plain'] })
  let sweep = 0
  // app.js leaves this one path unparsed so the 4 KB cap applies before any of the body is read.
  api.post('/usage', (req, res) => kit.usageHandler(req, res))
  // Always 204, and never an error the app has to handle: a body that is too big, a batch that is too
  // long, an unknown name or a busy limiter all end the same way, with nothing stored.
  kit.usageHandler = (req, res) => {
    const done = () => { if (!res.headersSent) res.status(204).end() }
    if (!usageLimit('ip:' + req.ip).ok) return done()
    parse(req, res, async (err) => {
      try {
        const b = req.body
        if (err || !b || typeof b !== 'object' || Array.isArray(b) || !Array.isArray(b.events) || b.events.length > USAGE_LIMITS.batch) return done()
        let userId = null
        const h = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(req.get('authorization') || '')
        const t = h ? h[1] : typeof b.auth === 'string' && BEARER_RE.test(b.auth) ? b.auth : null
        if (t) { const s = await db.query('SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > $2', [sha(t), iso(Date.now())]); userId = s.rows[0] ? s.rows[0].user_id : null }
        // A signed-in event carries the user and nothing else. The browser id is only kept for signed-out and demo use.
        const anon = !userId && typeof b.anon === 'string' && ANON_RE.test(b.anon) ? b.anon : null
        if (!userId && !anon) return done()
        const ua = agentFamily(req.get('user-agent')), v = typeof b.v === 'string' && VERSION_RE.test(b.v) ? b.v : ''
        const dogs = new Map()
        const dogId = async (slug) => {
          if (!userId || typeof slug !== 'string' || !SLUG_RE.test(slug)) return null
          if (!dogs.has(slug)) { const d = await db.query('SELECT d.id FROM dogs d JOIN memberships m ON m.dog_id = d.id AND m.user_id = $2 WHERE d.slug = $1', [slug, userId]); dogs.set(slug, d.rows[0] ? d.rows[0].id : null) }
          return dogs.get(slug)
        }
        const now = Date.now(), rows = []
        for (const e of b.events) {
          if (!e || typeof e !== 'object' || typeof e.name !== 'string' || !Object.prototype.hasOwnProperty.call(USAGE_EVENTS, e.name)) continue
          // The browser may say how long ago the event happened (it queues for a few seconds). Never the future, never more than a day back.
          const ago = typeof e.ago === 'number' && Number.isFinite(e.ago) ? Math.max(0, Math.min(DAY, e.ago)) : 0
          rows.push([newId(), iso(now - ago), userId, anon, e.name, await dogId(e.dog), JSON.stringify(cleanProps(e.name, e.props)), ua, v])
        }
        if (rows.length) await db.query(`INSERT INTO usage_events (id, at, user_id, anon_id, name, dog_id, props, ua, app_version) VALUES ${rows.map((_, i) => `(${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `$${i * 9 + n}`).join(', ')})`).join(', ')}`, rows.flat())
        if (now - sweep > 6 * 3600e3) { sweep = now; await db.query('DELETE FROM usage_events WHERE at < $1', [iso(now - USAGE_LIMITS.keepDays * DAY)]) }
      } catch (e) { console.error('usage:', e.message) }
      done()
    })
  }

  // ---- admin metrics ----------------------------------------------------------
  const dayOf = (t) => new Date(t).toISOString().slice(0, 10)
  const props = (r) => { try { const p = JSON.parse(r.props); return p && typeof p === 'object' ? p : {} } catch (e) { return {} } }
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([name, count]) => ({ name, count }))
  // Everything is worked out from usage_events, in UTC days. People who send Do Not Track or Global Privacy
  // Control are not in the table, so every number here is a floor, not a census.
  api.get('/admin/metrics', auth, admin, async (req, res) => {
    const want = Number(req.query.days)
    const days = Number.isInteger(want) && want >= 1 && want <= USAGE_LIMITS.maxDays ? want : 14
    const includeAdmins = req.query.includeAdmins === '1'
    const now = Date.now(), since = now - days * DAY
    // The week-two cohort signed up 7 to 14 days ago, so at least 14 days are read whatever the window is.
    const { rows: all } = await db.query('SELECT at, user_id, anon_id, name, dog_id, props FROM usage_events WHERE at >= $1 ORDER BY at ASC LIMIT 200000', [iso(now - Math.max(days, 14) * DAY)])
    const skipUsers = includeAdmins ? new Set() : await adminIds()
    const demoDogs = new Set((await db.query('SELECT id FROM dogs WHERE is_demo = TRUE')).rows.map((r) => r.id))
    const ev = all.filter((r) => !(r.user_id && skipUsers.has(r.user_id)) && !(r.dog_id && demoDogs.has(r.dog_id))).map((r) => ({ t: new Date(r.at).getTime(), who: r.user_id ? 'u:' + r.user_id : 'a:' + r.anon_id, user: r.user_id, name: r.name, p: props(r) }))
    const win = ev.filter((e) => e.t >= since)
    const dayList = []
    for (let i = days - 1; i >= 0; i--) dayList.push(dayOf(now - i * DAY))
    const active = new Map(dayList.map((d) => [d, new Set()])), signups = new Map(dayList.map((d) => [d, 0])), walks = new Map(dayList.map((d) => [d, 0]))
    const people = new Set(), tabs = new Map(), names = new Map(), errors = new Map()
    for (const e of win) {
      const d = dayOf(e.t)
      people.add(e.who)
      if (active.has(d)) active.get(d).add(e.who)
      if (e.name === 'sign_up' && signups.has(d)) signups.set(d, signups.get(d) + 1)
      if (e.name === 'walk_saved' && walks.has(d)) walks.set(d, walks.get(d) + 1)
      names.set(e.name, (names.get(e.name) || 0) + 1)
      if (e.name === 'tab_view' && e.p.tab) tabs.set(e.p.tab, (tabs.get(e.p.tab) || 0) + 1)
      if (e.name === 'client_error') {
        const key = e.p.message || '(no message)'
        const g = errors.get(key) || { message: key, kind: e.p.kind || '', screen: e.p.screen || '', count: 0, lastSeen: 0 }
        g.count += e.p.n > 0 ? e.p.n : 1
        if (e.t >= g.lastSeen) { g.lastSeen = e.t; g.kind = e.p.kind || g.kind; g.screen = e.p.screen || g.screen }
        errors.set(key, g)
      }
    }
    // Activation: of the people who signed up in the window, how many went on to do each thing (by now).
    const cohort = new Map()
    for (const e of win) if (e.name === 'sign_up' && e.user && !cohort.has(e.user)) cohort.set(e.user, e.t)
    const did = { dog_created: new Set(), care_invite_sent: new Set(), friend_added: new Set() }, saved = new Map()
    for (const e of ev) {
      if (!e.user || !cohort.has(e.user) || e.t < cohort.get(e.user)) continue
      if (did[e.name]) did[e.name].add(e.user)
      if (e.name === 'walk_saved') saved.set(e.user, (saved.get(e.user) || 0) + 1)
    }
    const walked = (n) => [...saved.values()].filter((c) => c >= n).length
    const funnel = [
      { key: 'signed_up', label: 'Signed up', count: cohort.size },
      { key: 'dog_created', label: 'Created a dog', count: did.dog_created.size },
      { key: 'first_walk', label: 'Saved a first walk', count: walked(1) },
      { key: 'second_walk', label: 'Saved a second walk', count: walked(2) },
      { key: 'care_invite', label: 'Invited a care team member', count: did.care_invite_sent.size },
      { key: 'friend_added', label: 'Added a friend', count: did.friend_added.size },
    ]
    // Week two: of the people who signed up 7 to 14 days ago, the share with any event in days 7 to 14 after signing up.
    const w2 = new Map()
    for (const e of ev) if (e.name === 'sign_up' && e.user && e.t >= now - 14 * DAY && e.t < now - 7 * DAY && !w2.has(e.user)) w2.set(e.user, e.t)
    const back = new Set()
    for (const e of ev) { const t0 = w2.get(e.user); if (t0 !== undefined && e.t >= t0 + 7 * DAY && e.t < t0 + 14 * DAY) back.add(e.user) }
    const enough = w2.size >= 5
    res.json({
      days, includeAdmins, from: dayList[0], to: dayList[dayList.length - 1], generatedAt: iso(now),
      totals: { people: people.size, events: win.length, signups: [...signups.values()].reduce((a, b) => a + b, 0), walksSaved: [...walks.values()].reduce((a, b) => a + b, 0), errors: [...errors.values()].reduce((a, g) => a + g.count, 0) },
      daily: dayList.map((d) => ({ day: d, active: active.get(d).size, signups: signups.get(d), walksSaved: walks.get(d) })),
      funnel,
      weekTwo: { cohort: w2.size, returned: back.size, rate: enough ? Math.round((back.size / w2.size) * 1000) / 1000 : null, note: enough ? '' : 'not enough data' },
      topTabs: top(tabs, 8), topEvents: top(names, 12),
      clientErrors: [...errors.values()].sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen).slice(0, 30).map((g) => ({ ...g, lastSeen: iso(g.lastSeen) })),
    })
  })
}
