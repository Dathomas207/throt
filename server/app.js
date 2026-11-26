import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import zlib from 'node:zlib'
import { renderDogPage, renderNotFound } from './publicPage.js'
import { registerHealth } from './routesHealth.js'
import { registerPlaces } from './routesPlaces.js'
import { registerDocs, DOC_LIMITS } from './routesDocs.js'
import { registerShows } from './routesShows.js'
import { registerCompete } from './routesCompete.js'
import { registerRegistration } from './routesRegistration.js'
import { registerFriends } from './routesFriends.js'
import { registerPhotos, WALK_PHOTO_LIMITS } from './routesPhotos.js'
import { registerUsage } from './routesUsage.js'
import { registerNotifications } from './routesNotifications.js'
import { registerWeather } from './routesWeather.js'

import { geoRouter } from './geo.js'

export const LIMITS = {
  body: '400kb',
  // PATCH /api/dogs/:slug only: room for a 300 KB photo as base64 plus the other fields.
  photoBody: '420kb',
  photoBytes: 300 * 1024,
  routePoints: 5000,
  name: 60,
  email: 254,
  dogName: 40,
  breed: 60,
  bio: 280,
  age: 20,
  title: 80,
  note: 500,
  place: 80,
  miles: 200,
  minutes: 1440,
  sniffs: 1000,
  weight: 400,
  activeInvites: 50,
  dogsPerUser: 20,
  city: 60,
  speed: 40,
  sprints: 500,
  goalMin: 10,
  goalMax: 300,
}
export const ROLES = ['owner', 'walker', 'family', 'daycare']
export const INVITE_ROLES = ['walker', 'family', 'daycare']
// Mirrors the ids of ACTIVITY_TYPES in src/data.js. A test fails if the two lists drift.
export const WALK_TYPES = ['Walk', 'Run', 'Hike', 'Play time', 'Fetch', 'Dog park', 'Swim', 'Training', 'Agility', 'Daycare']
// Seeded demo accounts live on this domain, which can never receive mail. Nobody can sign in with it.
export const DEMO_EMAIL_DOMAIN = 'example.invalid'
const SESSION_DAYS = 30
const INVITE_DAYS = 14
const DAY = 864e5

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const bad = (msg) => new HttpError(400, msg)

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const newToken = () => crypto.randomBytes(32).toString('base64url')
const newId = () => crypto.randomUUID()
const iso = (v) => new Date(v).toISOString()
const num = (v) => Number(v) || 0
const round = (v, p) => Math.round(v * p) / p
const firstName = (name) => String(name || '').trim().split(/\s+/)[0].slice(0, 30)

// ---- input validation -------------------------------------------------------
function text(v, label, { max, min = 0 } = {}) {
  if (v == null) v = ''
  if (typeof v !== 'string') throw bad(`${label} must be text.`)
  // Drop control characters, collapse runs of whitespace.
  const s = v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  if (s.length < min) throw bad(`${label} is required.`)
  if (s.length > max) throw bad(`${label} must be ${max} characters or fewer.`)
  return s
}
function number(v, label, { min = 0, max, integer = false, optional = false } = {}) {
  if (v == null || v === '') { if (optional) return null; throw bad(`${label} is required.`) }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(`${label} must be a number.`)
  if (integer && !Number.isInteger(v)) throw bad(`${label} must be a whole number.`)
  if (v < min || v > max) throw bad(`${label} must be between ${min} and ${max}.`)
  return v
}
function email(v) {
  if (typeof v !== 'string') throw bad('Email is required.')
  const s = v.trim().toLowerCase()
  if (!s) throw bad('Email is required.')
  if (s.length > LIMITS.email) throw bad(`Email must be ${LIMITS.email} characters or fewer.`)
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(s)) throw bad('That email does not look right.')
  return s
}
function birthday(v) {
  if (v == null || v === '') return null
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad('Birthday must look like 2021-05-30.')
  const d = new Date(v + 'T00:00:00Z')
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw bad('Birthday is not a real date.')
  if (d.getTime() > Date.now() + DAY) throw bad('Birthday cannot be in the future.')
  if (d.getTime() < Date.now() - 40 * 365.25 * DAY) throw bad('Birthday is too long ago.')
  return v
}
function route(v) {
  if (v == null) return null
  if (!Array.isArray(v)) throw bad('Route must be a list of [lat, lng] pairs.')
  if (v.length > LIMITS.routePoints) throw bad(`Route must be ${LIMITS.routePoints} points or fewer.`)
  if (v.length < 2) return null
  const out = []
  for (const p of v) {
    if (!Array.isArray(p) || p.length !== 2) throw bad('Route must be a list of [lat, lng] pairs.')
    const [lat, lng] = p
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw bad('Route has a point that is not a valid coordinate.')
    out.push([round(lat, 1e5), round(lng, 1e5)])
  }
  return out
}
function bool(v, label) {
  if (typeof v !== 'boolean') throw bad(`${label} must be true or false.`)
  return v
}
// A dog photo arrives as a data URL. Only three raster types are accepted, the
// declared type has to match the first bytes, and the decoded size is capped.
const PHOTO_RE = /^data:(image\/(?:jpeg|png|webp));base64,/
function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  return ''
}
function photo(v) {
  if (v === null) return { data: null, v: null }
  if (typeof v !== 'string') throw bad('Photo must be an image, or null to remove it.')
  const m = PHOTO_RE.exec(v.slice(0, 40))
  if (!m) throw bad('Photo must be a JPEG, PNG or WebP image.')
  const b64 = v.slice(m[0].length)
  const tooBig = bad(`Photo must be ${Math.round(LIMITS.photoBytes / 1024)} KB or smaller.`)
  if (b64.length > Math.ceil(LIMITS.photoBytes / 3) * 4) throw tooBig
  if (!b64.length || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw bad('Photo is not valid image data.')
  const buf = Buffer.from(b64, 'base64')
  if (buf.length > LIMITS.photoBytes) throw tooBig
  if (sniff(buf) !== m[1]) throw bad('Photo is not valid image data.')
  return { data: `data:${m[1]};base64,${buf.toString('base64')}`, v: sha(buf).slice(0, 12) }
}
function photoBytes(stored) {
  const m = PHOTO_RE.exec(String(stored || '').slice(0, 40))
  if (!m) return null
  return { type: m[1], buf: Buffer.from(stored.slice(m[0].length), 'base64') }
}
function object(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('Send a JSON object.')
  return v
}
function dogFields(b, { partial }) {
  const out = {}
  if (!partial || b.name !== undefined) out.name = text(b.name, 'Dog name', { min: 1, max: LIMITS.dogName })
  if (!partial || b.breed !== undefined) out.breed = text(b.breed, 'Breed', { max: LIMITS.breed })
  if (!partial || b.bio !== undefined) out.bio = text(b.bio, 'Bio', { max: LIMITS.bio })
  if (!partial || b.age !== undefined) out.age = text(b.age, 'Age', { max: LIMITS.age })
  if (!partial || b.birthday !== undefined) out.birthday = birthday(b.birthday)
  if (!partial || b.weight !== undefined) out.weight = number(b.weight, 'Weight', { min: 0.5, max: LIMITS.weight, optional: true })
  if (b.city !== undefined) out.city = text(b.city, 'City', { max: LIMITS.city })
  return out
}
function ageLabel(dog) {
  if (dog.birthday) {
    const b = new Date(dog.birthday + 'T00:00:00Z'), n = new Date()
    let months = (n.getUTCFullYear() - b.getUTCFullYear()) * 12 + (n.getUTCMonth() - b.getUTCMonth()) - (n.getUTCDate() < b.getUTCDate() ? 1 : 0)
    if (months < 0) months = 0
    if (months < 1) return 'Under 1 mo'
    if (months < 24) return `${months} ${months === 1 ? 'mo' : 'mos'}`
    return `${Math.floor(months / 12)} yrs`
  }
  return dog.age || ''
}
export function slugify(name) {
  const s = String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '')
  return s || 'dog'
}
const ID_RE = /^[0-9a-f-]{36}$/
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/
const isUnique = (e) => e && (e.code === '23505' || /unique|duplicate/i.test(e.message || ''))

// ---- small in-memory rate limiter ------------------------------------------
// Fixed window per key. Good enough for a single trial instance. It resets on
// restart and is not shared between instances.
function limiter({ windowMs, max }) {
  const hits = new Map()
  return (key) => {
    const now = Date.now()
    if (hits.size > 20000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k)
    let h = hits.get(key)
    if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h) }
    h.n += 1
    return { ok: h.n <= max, retry: Math.ceil((h.reset - now) / 1000) }
  }
}

export function createApp({ db, staticDir, baseUrl = '', trustProxy = 0, rate = {}, demoOnBoards = process.env.DEMO_ON_LEADERBOARDS !== '0', adminEmails = process.env.ADMIN_EMAILS } = {}) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', trustProxy)
  const R = { sessionMax: 20, sessionWindowMs: 15 * 60e3, writeMax: 120, writeWindowMs: 60e3, readMax: 600, readWindowMs: 60e3, placeMax: 30, placeWindowMs: 3600e3, eventMax: 20, eventWindowMs: 3600e3, claimMax: 10, claimWindowMs: 3600e3, reportMax: 20, reportWindowMs: 3600e3, searchMax: 30, searchWindowMs: 60e3, ...rate }
  const sessionLimit = limiter({ windowMs: R.sessionWindowMs, max: R.sessionMax })
  const writeLimit = limiter({ windowMs: R.writeWindowMs, max: R.writeMax })
  const readLimit = limiter({ windowMs: R.readWindowMs, max: R.readMax })
  const limited = (res, r) => { res.set('Retry-After', String(r.retry)); throw new HttpError(429, 'Too many requests. Wait a moment and try again.') }
  const origin = (req) => (baseUrl || `${req.protocol}://${req.get('host') || 'localhost'}`).replace(/\/+$/, '')

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    next()
  })

  app.get('/healthz', async (req, res) => {
    try { await db.query('SELECT 1'); res.json({ ok: true, db: db.kind }) } catch (e) { res.status(503).json({ ok: false }) }
  })

  // ---- API ------------------------------------------------------------------
  const api = express.Router()
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    const r = readLimit('ip:' + req.ip)
    if (!r.ok) return limited(res, r)
    next()
  })
  // One route takes a photo, so only that route gets the larger body limit.
  const jsonBody = express.json({ limit: LIMITS.body })
  const jsonPhotoBody = express.json({ limit: LIMITS.photoBody })
  // A document upload is the one large body. The caller has to be signed in before any of it is read.
  const jsonDocBody = express.json({ limit: DOC_LIMITS.body })
  const jsonWalkPhotoBody = express.json({ limit: WALK_PHOTO_LIMITS.body })
  api.use(async (req, res, next) => {
    // Usage batches bring their own 4 KB parser (routesUsage.js), so nothing larger is ever read for them.
    if (req.method === 'POST' && /^\/usage\/?$/.test(req.path)) return next()
    if (req.method === 'POST' && /^\/dogs\/[^/]+\/documents\/?$/.test(req.path)) {
      if (!(await userFor(req))) throw new HttpError(401, 'Sign in to continue.')
      return jsonDocBody(req, res, next)
    }
    // An outing photo is the other body above the default size. Same rule: signed in before any of it is read.
    if (req.method === 'POST' && /^\/walks\/[^/]+\/photos\/?$/.test(req.path)) {
      if (!(await userFor(req))) throw new HttpError(401, 'Sign in to continue.')
      return jsonWalkPhotoBody(req, res, next)
    }
    return (req.method === 'PATCH' && /^\/dogs\/[^/]+\/?$/.test(req.path) ? jsonPhotoBody : jsonBody)(req, res, next)
  })
  // The client uses this to tell a real Trot API from static hosting, where any
  // path answers with index.html.
  api.get('/health', (req, res) => res.json({ ok: true, service: 'trot' }))

  // Public runtime settings for the map. Only a public (pk.) Mapbox token is ever sent to browsers.
  api.get('/config', (req, res) => {
    const t = (process.env.MAPBOX || process.env.MAPBOX_TOKEN || process.env.MAPBOX_ACCESS_TOKEN || '').trim()
    const style = (process.env.MAPBOX_STYLE || '').trim().replace(/^mapbox:\/\/styles\//, '')
    res.json({ mapboxToken: /^pk\.[\w.-]+$/.test(t) ? t : '', mapboxStyle: /^[\w-]+\/[\w-]+$/.test(style) ? style : '' })
  })

  // Anonymous heatmap of where dogs walk: counts per ~11 m cell from walks of public dogs.
  // The first and last 150 m of every walk are dropped so homes are not revealed, and no dog or person is identified.
  api.get('/heat', async (req, res, next) => {
    try {
      const num = (k) => { const v = Number(req.query[k]); return Number.isFinite(v) ? v : null }
      const box = { s: num('s'), w: num('w'), n: num('n'), e: num('e') }
      const hasBox = Object.values(box).every((v) => v !== null)
      const { rows } = await db.query('SELECT w.route FROM walks w JOIN dogs d ON d.id = w.dog_id WHERE d.is_public = TRUE AND w.route IS NOT NULL ORDER BY w.started_at DESC LIMIT 500')
      const cells = new Map()
      const m = (a, b) => { const r = Math.PI / 180, x = (b[1] - a[1]) * r * Math.cos(((a[0] + b[0]) / 2) * r), y = (b[0] - a[0]) * r; return Math.sqrt(x * x + y * y) * 6371000 }
      for (const row of rows) {
        let pts; try { pts = JSON.parse(row.route) } catch (e) { continue }
        if (!Array.isArray(pts) || pts.length < 4) continue
        const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + m(pts[i - 1], pts[i]))
        const total = cum[cum.length - 1]; if (total < 450) continue
        const seen = new Set()
        for (let i = 0; i < pts.length; i++) {
          if (cum[i] < 150 || cum[i] > total - 150) continue
          const la = pts[i][0], lo = pts[i][1]
          if (hasBox && (la < box.s || la > box.n || lo < box.w || lo > box.e)) continue
          const k = la.toFixed(4) + ',' + lo.toFixed(4)
          if (seen.has(k)) continue
          seen.add(k); cells.set(k, (cells.get(k) || 0) + 1)
        }
      }
      const points = [...cells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6000).map(([k, c]) => { const [la, lo] = k.split(','); return [Number(la), Number(lo), c] })
      res.json({ points })
    } catch (e) { next(e) }
  })

  async function userFor(req) {
    const h = req.get('authorization') || ''
    const m = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(h)
    if (!m) return null
    const { rows } = await db.query(
      'SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2',
      [sha(m[1]), iso(Date.now())])
    return rows[0] ? { ...rows[0], tokenHash: sha(m[1]) } : null
  }
  // Admins are the signed-in people whose email is in ADMIN_EMAILS (comma separated). With it unset there are none.
  const admins = new Set(String(adminEmails || '').split(',').map((e) => e.trim().toLowerCase()).filter((e) => e && !e.endsWith('.invalid')))
  const isAdmin = (u) => !!(u && u.email && admins.has(String(u.email).toLowerCase()))
  const admin = (req, res, next) => { if (!isAdmin(req.user)) throw new HttpError(403, 'Admins only.'); next() }
  // The admins' user ids, so the metrics can leave their own activity out.
  const adminIds = async () => { const list = [...admins]; return new Set(list.length ? (await db.query(`SELECT id FROM users WHERE LOWER(email) IN (${list.map((_, i) => `$${i + 1}`).join(', ')})`, list)).rows.map((r) => r.id) : []) }
  const auth = async (req, res, next) => {
    const u = await userFor(req)
    if (!u) throw new HttpError(401, 'Sign in to continue.')
    req.user = u
    if (req.method !== 'GET') {
      const r = writeLimit('user:' + u.id)
      if (!r.ok) return limited(res, r)
    }
    next()
  }
  // Every dog column except the photo itself, which only the photo endpoints read.
  const DOG_FIELDS = ['id', 'slug', 'name', 'breed', 'birthday', 'age', 'weight', 'bio', 'is_public', 'share_routes', 'created_by', 'created_at', 'photo_v', 'tracking_level', 'goal_minutes', 'city', 'leaderboards', 'is_demo']
  const DOG_COLS = DOG_FIELDS.join(', ')
  const DOG_COLS_D = DOG_FIELDS.map((c) => 'd.' + c).join(', ')
  const V_RE = /^[a-f0-9]{6,64}$/
  const photoUrl = (slug, v, pub) => (v && V_RE.test(v) ? `/api/${pub ? 'public/' : ''}dogs/${slug}/photo?v=${v}` : null)
  async function dogFor(slug, userId, { owner = false } = {}) {
    if (!SLUG_RE.test(slug)) throw new HttpError(404, 'No dog with that address.')
    const { rows } = await db.query(`SELECT ${DOG_COLS} FROM dogs WHERE slug = $1`, [slug])
    const dog = rows[0]
    if (!dog) throw new HttpError(404, 'No dog with that address.')
    const m = await db.query('SELECT role FROM memberships WHERE dog_id = $1 AND user_id = $2', [dog.id, userId])
    if (!m.rows[0]) throw new HttpError(403, 'You are not on this dog\'s care team.')
    if (owner && m.rows[0].role !== 'owner') throw new HttpError(403, 'Only the owner can do that.')
    return { dog, role: m.rows[0].role }
  }
  const dogOut = (d, role) => ({
    slug: d.slug, name: d.name, breed: d.breed, birthday: d.birthday || null, age: ageLabel(d), weight: d.weight == null ? null : num(d.weight), bio: d.bio,
    public: !!d.is_public, shareRoutes: !!d.share_routes, photoUrl: photoUrl(d.slug, d.photo_v),
    trackingLevel: [1, 2, 3].includes(num(d.tracking_level)) ? num(d.tracking_level) : 1, goalMinutes: d.goal_minutes == null ? null : num(d.goal_minutes),
    city: d.city || '', leaderboards: d.leaderboards !== false, isDemo: !!d.is_demo, ...(role ? { role } : {}),
  })
  const totalsOut = (r) => ({ outings: num(r && r.outings), miles: round(num(r && r.miles), 100), minutes: round(num(r && r.minutes), 10) })
  async function totals(dogId, since) {
    const q = since
      ? await db.query('SELECT COUNT(*) AS outings, COALESCE(SUM(miles), 0) AS miles, COALESCE(SUM(minutes), 0) AS minutes FROM walks WHERE dog_id = $1 AND started_at >= $2', [dogId, since])
      : await db.query('SELECT COUNT(*) AS outings, COALESCE(SUM(miles), 0) AS miles, COALESCE(SUM(minutes), 0) AS minutes FROM walks WHERE dog_id = $1', [dogId])
    return totalsOut(q.rows[0])
  }
  async function pawCounts(walkIds, userId) {
    const counts = {}, mine = {}
    if (!walkIds.length) return { counts, mine }
    const ph = walkIds.map((_, i) => `$${i + 1}`).join(', ')
    const c = await db.query(`SELECT walk_id, COUNT(*) AS n FROM paws WHERE walk_id IN (${ph}) GROUP BY walk_id`, walkIds)
    c.rows.forEach((r) => { counts[r.walk_id] = num(r.n) })
    if (userId) {
      const m = await db.query(`SELECT walk_id FROM paws WHERE user_id = $${walkIds.length + 1} AND walk_id IN (${ph})`, [...walkIds, userId])
      m.rows.forEach((r) => { mine[r.walk_id] = true })
    }
    return { counts, mine }
  }
  const parseRoute = (s) => { if (!s) return null; try { const v = JSON.parse(s); return Array.isArray(v) && v.length > 1 ? v : null } catch (e) { return null } }
  // Lists carry a thinned route for the thumbnail. The full route comes from GET /api/walks/:id.
  const thin = (pts, max = 120) => {
    if (!pts || pts.length <= max) return pts
    const out = []
    for (let i = 0; i < max; i++) out.push(pts[Math.round((i * (pts.length - 1)) / (max - 1))])
    return out
  }
  const WALK_COLS = 'w.id, w.dog_id, w.user_id, w.type, w.title, w.note, w.place, w.miles, w.minutes, w.sniffs, w.started_at, w.route, w.avg_speed, w.max_speed, w.sprints, w.moving_minutes, w.run_minutes, d.slug AS dog_slug, d.name AS dog_name, d.photo_v AS dog_photo_v, d.is_demo AS dog_is_demo, u.name AS user_name'
  // Performance statistics are optional. A missing one is null, never zero.
  const opt = (v) => (v == null ? null : num(v))
  const perf = (r) => ({ avgSpeed: opt(r.avg_speed), maxSpeed: opt(r.max_speed), sprints: opt(r.sprints), movingMinutes: opt(r.moving_minutes), runMinutes: opt(r.run_minutes) })
  // Photos on outings, as { walkId: [{ id, url, w, h }] }, oldest first. Lists carry the first three, a
  // single outing carries all of them. `pub` builds the address that needs no sign-in, which only
  // answers for public dogs. With `userId` each photo also says whether that person added it.
  const HASH_RE = /^[a-f0-9]{8,64}$/
  const walkPhotoUrl = (walkId, id, hash, pub) => `/api/${pub ? 'public/' : ''}walks/${walkId}/photos/${id}${HASH_RE.test(hash || '') ? `?v=${hash}` : ''}`
  async function walkPhotos(walkIds, { pub = false, limit = 3, userId = null } = {}) {
    const out = {}
    if (!walkIds.length) return out
    const { rows } = await db.query(`SELECT id, walk_id, added_by, width, height, hash FROM walk_photos WHERE walk_id IN (${walkIds.map((_, i) => `$${i + 1}`).join(', ')}) ORDER BY created_at ASC, id ASC`, walkIds)
    for (const r of rows) {
      const list = out[r.walk_id] || (out[r.walk_id] = [])
      if (list.length < limit) list.push({ id: r.id, url: walkPhotoUrl(r.walk_id, r.id, r.hash, pub), w: num(r.width), h: num(r.height), ...(userId ? { mine: r.added_by === userId } : {}) })
    }
    return out
  }
  async function walksOut(rows, userId, { full = false } = {}) {
    const { counts, mine } = await pawCounts(rows.map((r) => r.id), userId)
    const shots = await walkPhotos(rows.map((r) => r.id), full ? { limit: WALK_PHOTO_LIMITS.perWalk, userId } : {})
    return rows.map((r) => {
      const pts = parseRoute(r.route)
      return {
        id: r.id, dog: { slug: r.dog_slug, name: r.dog_name, photoUrl: photoUrl(r.dog_slug, r.dog_photo_v), isDemo: !!r.dog_is_demo }, by: { id: r.user_id, name: r.user_name, you: r.user_id === userId },
        type: r.type, title: r.title, note: r.note, place: r.place, miles: num(r.miles), minutes: num(r.minutes), sniffs: num(r.sniffs), ...perf(r),
        startedAt: iso(r.started_at), route: full ? pts : thin(pts), paws: counts[r.id] || 0, pawed: !!mine[r.id], photos: shots[r.id] || [],
      }
    })
  }

  // -- session
  api.post('/session', async (req, res) => {
    const r = sessionLimit('ip:' + req.ip)
    if (!r.ok) return limited(res, r)
    const b = object(req.body)
    const mail = email(b.email)
    if (mail.endsWith('@' + DEMO_EMAIL_DOMAIN) || mail.endsWith('.invalid')) throw new HttpError(403, 'That address belongs to a demo account and cannot be used to sign in.')
    const name = text(b.name, 'Your name', { min: 1, max: LIMITS.name })
    const now = Date.now()
    let { rows } = await db.query('SELECT id, name, email FROM users WHERE email = $1', [mail])
    let created = false
    if (!rows[0]) {
      try {
        await db.query('INSERT INTO users (id, name, email, created_at) VALUES ($1, $2, $3, $4)', [newId(), name, mail, iso(now)])
        created = true
      } catch (e) { if (!isUnique(e)) throw e }
      rows = (await db.query('SELECT id, name, email FROM users WHERE email = $1', [mail])).rows
    }
    const user = rows[0]
    const token = newToken()
    await db.query('DELETE FROM sessions WHERE expires_at < $1', [iso(now)])
    await db.query('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [sha(token), user.id, iso(now), iso(now + SESSION_DAYS * DAY)])
    // One welcome note on the first sign-in. It is keyed, so it is never written twice.
    if (created) await kit.welcome(user.id)
    res.status(created ? 201 : 200).json({ token, user: { id: user.id, name: user.name, email: user.email, isAdmin: isAdmin(user) }, created })
  })
  api.delete('/session', auth, async (req, res) => {
    await db.query('DELETE FROM sessions WHERE token_hash = $1', [req.user.tokenHash])
    res.json({ ok: true })
  })

  api.get('/me', auth, async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${DOG_COLS_D}, m.role FROM memberships m JOIN dogs d ON d.id = m.dog_id WHERE m.user_id = $1 ORDER BY m.created_at ASC, d.slug ASC`, [req.user.id])
    // The unread count rides along so the bell shows a number without a second request.
    res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email, isAdmin: isAdmin(req.user) }, dogs: rows.map((d) => dogOut(d, d.role)), unread: await kit.unreadFor(req.user.id, req.query.tz) })
  })

  api.patch('/me', auth, async (req, res) => {
    const b = object(req.body)
    const name = text(b.name, 'Your name', { min: 1, max: LIMITS.name })
    await db.query('UPDATE users SET name = $1 WHERE id = $2', [name, req.user.id])
    res.json({ user: { id: req.user.id, name, email: req.user.email } })
  })

  // -- dogs
  api.post('/dogs', auth, async (req, res) => {
    const f = dogFields(object(req.body), { partial: false })
    const owned = await db.query('SELECT COUNT(*) AS n FROM memberships WHERE user_id = $1 AND role = $2', [req.user.id, 'owner'])
    if (num(owned.rows[0].n) >= LIMITS.dogsPerUser) throw bad(`You can add up to ${LIMITS.dogsPerUser} dogs in this trial.`)
    const base = slugify(f.name)
    const now = iso(Date.now())
    for (let attempt = 0; attempt < 6; attempt++) {
      const taken = new Set((await db.query('SELECT slug FROM dogs WHERE slug = $1 OR slug LIKE $2', [base, base + '-%'])).rows.map((r) => r.slug))
      // "search" is an API path under /api/dogs, so no dog gets it as an address.
      taken.add('search')
      let slug = base
      for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`
      const id = newId()
      try {
        await db.tx(async (t) => {
          await t.query('INSERT INTO dogs (id, slug, name, breed, birthday, age, weight, bio, is_public, share_routes, created_by, created_at, city) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, FALSE, $9, $10, $11)',
            [id, slug, f.name, f.breed, f.birthday, f.age, f.weight, f.bio, req.user.id, now, f.city || ''])
          await t.query('INSERT INTO memberships (user_id, dog_id, role, created_at) VALUES ($1, $2, $3, $4)', [req.user.id, id, 'owner', now])
        })
      } catch (e) { if (isUnique(e)) continue; throw e }
      const { rows } = await db.query(`SELECT ${DOG_COLS} FROM dogs WHERE id = $1`, [id])
      return res.status(201).json({ dog: dogOut(rows[0], 'owner') })
    }
    throw new HttpError(503, 'Could not pick an address for this dog. Try again.')
  })

  // Registered ahead of /dogs/:slug so the word "search" is never read as a dog's address. The handler is in routesFriends.js.
  api.get('/dogs/search', auth, (req, res) => kit.searchDogs(req, res))

  api.get('/dogs/:slug', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    const since = iso(Date.now() - 7 * DAY)
    const members = await db.query('SELECT u.id, u.name, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.dog_id = $1 ORDER BY m.created_at ASC, u.id ASC', [dog.id])
    const per = await db.query('SELECT user_id, COUNT(*) AS outings, COALESCE(SUM(miles), 0) AS miles, COALESCE(SUM(minutes), 0) AS minutes FROM walks WHERE dog_id = $1 AND started_at >= $2 GROUP BY user_id', [dog.id, since])
    const byUser = Object.fromEntries(per.rows.map((r) => [r.user_id, totalsOut(r)]))
    const recent = await db.query(`SELECT ${WALK_COLS} FROM walks w JOIN dogs d ON d.id = w.dog_id JOIN users u ON u.id = w.user_id WHERE w.dog_id = $1 ORDER BY w.started_at DESC, w.id DESC LIMIT 20`, [dog.id])
    const wk = await db.query('SELECT started_at, minutes, miles, type FROM walks WHERE dog_id = $1 AND started_at >= $2 ORDER BY started_at DESC LIMIT 500', [dog.id, since])
    res.json({
      dog: dogOut(dog, role),
      totals: { week: await totals(dog.id, since), lifetime: await totals(dog.id) },
      team: members.rows.map((m) => ({ id: m.id, name: m.name, role: m.role, you: m.id === req.user.id, week: byUser[m.id] || totalsOut(null) })),
      weekWalks: wk.rows.map((r) => ({ startedAt: iso(r.started_at), minutes: num(r.minutes), miles: num(r.miles), type: r.type })),
      walks: await walksOut(recent.rows, req.user.id),
    })
  })

  api.patch('/dogs/:slug', auth, async (req, res) => {
    const { dog } = await dogFor(req.params.slug, req.user.id, { owner: true })
    const b = object(req.body)
    const f = dogFields(b, { partial: true })
    if (b.public !== undefined) f.is_public = bool(b.public, 'public')
    const sr = b.share_routes !== undefined ? b.share_routes : b.shareRoutes
    if (sr !== undefined) f.share_routes = bool(sr, 'share_routes')
    if (b.photo !== undefined) { const ph = photo(b.photo); f.photo = ph.data; f.photo_v = ph.v }
    const lvl = b.tracking_level !== undefined ? b.tracking_level : b.trackingLevel
    if (lvl !== undefined) f.tracking_level = number(lvl, 'Tracking level', { min: 1, max: 3, integer: true })
    const goal = b.goal_minutes !== undefined ? b.goal_minutes : b.goalMinutes
    // null clears the goal. The goal is the owner's own number, not a recommendation.
    if (goal !== undefined) f.goal_minutes = goal === null ? null : number(goal, 'Daily goal', { min: LIMITS.goalMin, max: LIMITS.goalMax, integer: true })
    if (b.leaderboards !== undefined) f.leaderboards = bool(b.leaderboards, 'leaderboards')
    // Column names come from this fixed list, never from the request. The slug is
    // not in it: a renamed dog keeps its address so shared links keep working.
    const cols = ['name', 'breed', 'bio', 'age', 'birthday', 'weight', 'is_public', 'share_routes', 'photo', 'photo_v', 'tracking_level', 'goal_minutes', 'city', 'leaderboards'].filter((c) => f[c] !== undefined)
    if (!cols.length) throw bad('Nothing to change.')
    await db.query(`UPDATE dogs SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${cols.length + 1}`, [...cols.map((c) => f[c]), dog.id])
    const { rows } = await db.query(`SELECT ${DOG_COLS} FROM dogs WHERE id = $1`, [dog.id])
    res.json({ dog: dogOut(rows[0], 'owner') })
  })

  // The photo is served as image bytes, never inside JSON. The URL carries a
  // version, so a short cache lifetime is safe and a new photo shows at once.
  const sendPhoto = (res, stored, cache) => {
    const p = photoBytes(stored)
    if (!p) throw new HttpError(404, 'This dog has no photo.')
    res.set('Cache-Control', cache).set('Content-Security-Policy', "default-src 'none'; sandbox").type(p.type).send(p.buf)
  }
  api.get('/dogs/:slug/photo', auth, async (req, res) => {
    const { dog } = await dogFor(req.params.slug, req.user.id)
    const { rows } = await db.query('SELECT photo FROM dogs WHERE id = $1', [dog.id])
    sendPhoto(res, rows[0] && rows[0].photo, 'private, max-age=300')
  })

  // -- team: the owner can remove anyone but themselves
  api.delete('/dogs/:slug/members/:userId', auth, async (req, res) => {
    const { dog } = await dogFor(req.params.slug, req.user.id, { owner: true })
    const id = req.params.userId
    if (id === req.user.id) throw bad('You cannot remove yourself from your own dog\'s team.')
    if (!ID_RE.test(id)) throw new HttpError(404, 'That person is not on this team.')
    const m = await db.query('SELECT role FROM memberships WHERE dog_id = $1 AND user_id = $2', [dog.id, id])
    if (!m.rows[0]) throw new HttpError(404, 'That person is not on this team.')
    if (m.rows[0].role === 'owner') throw bad('An owner cannot be removed.')
    await db.query('DELETE FROM memberships WHERE dog_id = $1 AND user_id = $2 AND role <> $3', [dog.id, id, 'owner'])
    res.json({ ok: true })
  })

  // One person's time with this dog: last 7 days, all time, and the outings they logged. No email.
  api.get('/dogs/:slug/members/:userId', auth, async (req, res) => {
    const { dog } = await dogFor(req.params.slug, req.user.id)
    const id = req.params.userId
    const m = ID_RE.test(id) ? await db.query('SELECT u.id, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.dog_id = $1 AND m.user_id = $2', [dog.id, id]) : { rows: [] }
    if (!m.rows[0]) throw new HttpError(404, 'That person is not on this team.')
    const since = iso(Date.now() - 7 * DAY)
    const sum = async (extra, params) => totalsOut((await db.query(`SELECT COUNT(*) AS outings, COALESCE(SUM(miles), 0) AS miles, COALESCE(SUM(minutes), 0) AS minutes FROM walks WHERE dog_id = $1${extra}`, params)).rows[0])
    const week = await sum(' AND user_id = $2 AND started_at >= $3', [dog.id, id, since]), all = await sum(' AND started_at >= $2', [dog.id, since])
    const recent = await db.query(`SELECT ${WALK_COLS} FROM walks w JOIN dogs d ON d.id = w.dog_id JOIN users u ON u.id = w.user_id WHERE w.dog_id = $1 AND w.user_id = $2 ORDER BY w.started_at DESC, w.id DESC LIMIT 50`, [dog.id, id])
    res.json({
      member: { id: m.rows[0].id, name: m.rows[0].name, role: m.rows[0].role, you: id === req.user.id, week, lifetime: await sum(' AND user_id = $2', [dog.id, id]), sharePercent: all.minutes > 0 ? Math.round((week.minutes / all.minutes) * 100) : 0 },
      walks: await walksOut(recent.rows, req.user.id),
    })
  })
  // The owner can change how someone is on the team. An owner's own role stays.
  api.patch('/dogs/:slug/members/:userId', auth, async (req, res) => {
    const { dog } = await dogFor(req.params.slug, req.user.id, { owner: true })
    const id = req.params.userId
    const role = object(req.body).role
    if (!INVITE_ROLES.includes(role)) throw bad(`Role must be one of: ${INVITE_ROLES.join(', ')}.`)
    const m = ID_RE.test(id) ? await db.query('SELECT role FROM memberships WHERE dog_id = $1 AND user_id = $2', [dog.id, id]) : { rows: [] }
    if (!m.rows[0]) throw new HttpError(404, 'That person is not on this team.')
    if (m.rows[0].role === 'owner') throw bad('An owner\'s role cannot be changed.')
    await db.query('UPDATE memberships SET role = $1 WHERE dog_id = $2 AND user_id = $3 AND role <> $4', [role, dog.id, id, 'owner'])
    res.json({ ok: true, role })
  })

  // -- invites
  api.post('/dogs/:slug/invites', auth, async (req, res) => {
    const { dog } = await dogFor(req.params.slug, req.user.id, { owner: true })
    const b = req.body == null ? {} : object(req.body)
    const role = b.role === undefined ? 'walker' : b.role
    if (!INVITE_ROLES.includes(role)) throw bad(`Role must be one of: ${INVITE_ROLES.join(', ')}.`)
    const now = Date.now()
    const open = await db.query('SELECT COUNT(*) AS n FROM invites WHERE dog_id = $1 AND used_by IS NULL AND expires_at > $2', [dog.id, iso(now)])
    if (num(open.rows[0].n) >= LIMITS.activeInvites) throw bad('This dog has too many open invites. Wait for some to expire.')
    const token = newToken()
    const expiresAt = iso(now + INVITE_DAYS * DAY)
    await db.query('INSERT INTO invites (token_hash, dog_id, role, created_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)', [sha(token), dog.id, role, req.user.id, iso(now), expiresAt])
    const p = `/?invite=${token}`
    res.status(201).json({ token, role, expiresAt, path: p, url: origin(req) + p })
  })
  // Open invites for the owner. The id is the stored hash of the token, which
  // cannot be turned back into the link, so it is safe to use as a handle.
  api.get('/dogs/:slug/invites', auth, async (req, res) => {
    const { dog } = await dogFor(req.params.slug, req.user.id, { owner: true })
    const { rows } = await db.query('SELECT token_hash, role, created_at, expires_at FROM invites WHERE dog_id = $1 AND used_by IS NULL AND expires_at > $2 ORDER BY created_at DESC, token_hash ASC', [dog.id, iso(Date.now())])
    res.json({ invites: rows.map((r) => ({ id: r.token_hash, role: r.role, createdAt: iso(r.created_at), expiresAt: iso(r.expires_at) })) })
  })
  api.delete('/dogs/:slug/invites/:id', auth, async (req, res) => {
    const { dog } = await dogFor(req.params.slug, req.user.id, { owner: true })
    if (!/^[a-f0-9]{64}$/.test(req.params.id)) throw new HttpError(404, 'No open invite like that.')
    const d = await db.query('DELETE FROM invites WHERE token_hash = $1 AND dog_id = $2 AND used_by IS NULL RETURNING token_hash', [req.params.id, dog.id])
    if (!d.rows[0]) throw new HttpError(404, 'No open invite like that.')
    res.json({ ok: true })
  })
  const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/
  async function inviteFor(token) {
    if (!TOKEN_RE.test(token)) throw new HttpError(404, 'This invite link is not valid.')
    const { rows } = await db.query('SELECT i.*, d.slug, d.name AS dog_name FROM invites i JOIN dogs d ON d.id = i.dog_id WHERE i.token_hash = $1', [sha(token)])
    if (!rows[0]) throw new HttpError(404, 'This invite link is not valid.')
    return rows[0]
  }
  // Lets the sign-in screen say which dog the invite is for. Dog name and role only.
  api.get('/invites/:token', async (req, res) => {
    const inv = await inviteFor(req.params.token)
    const open = !inv.used_by && new Date(inv.expires_at).getTime() > Date.now()
    res.json({ dogName: inv.dog_name, role: inv.role, open })
  })
  api.post('/invites/:token/accept', auth, async (req, res) => {
    const inv = await inviteFor(req.params.token)
    const out = (role, already) => res.json({ dog: { slug: inv.slug, name: inv.dog_name }, role, already })
    const mine = await db.query('SELECT role FROM memberships WHERE dog_id = $1 AND user_id = $2', [inv.dog_id, req.user.id])
    if (mine.rows[0]) return out(mine.rows[0].role, true)
    const now = iso(Date.now())
    await db.tx(async (t) => {
      // Single use: the UPDATE only matches while the invite is unused and unexpired.
      const u = await t.query('UPDATE invites SET used_by = $1, used_at = $2 WHERE token_hash = $3 AND used_by IS NULL AND expires_at > $2 RETURNING role', [req.user.id, now, inv.token_hash])
      if (!u.rows[0]) throw new HttpError(410, 'This invite link has expired or was already used. Ask for a new one.')
      await t.query('INSERT INTO memberships (user_id, dog_id, role, created_at) VALUES ($1, $2, $3, $4)', [req.user.id, inv.dog_id, inv.role, now])
    })
    await kit.notify(inv.created_by, { kind: 'care_invite_accepted', dogId: inv.dog_id, actorId: req.user.id, title: `${firstName(req.user.name)} joined ${inv.dog_name}'s care team`, body: `They accepted your invite as ${inv.role === 'daycare' ? 'daycare' : inv.role === 'family' ? 'family' : 'a walker'}.`, link: { to: 'people', dog: inv.slug } })
    out(inv.role, false)
  })

  // -- walks
  api.post('/dogs/:slug/walks', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    const b = object(req.body)
    const type = b.type === undefined ? 'Walk' : b.type
    if (!WALK_TYPES.includes(type)) throw bad(`Type must be one of: ${WALK_TYPES.join(', ')}.`)
    const title = text(b.title, 'Title', { min: 1, max: LIMITS.title })
    const note = text(b.note, 'Note', { max: LIMITS.note })
    const place = text(b.place, 'Place', { max: LIMITS.place })
    const miles = number(b.miles ?? 0, 'Miles', { max: LIMITS.miles })
    const minutes = number(b.minutes, 'Minutes', { max: LIMITS.minutes })
    const sniffs = number(b.sniffs ?? 0, 'Sniff stops', { max: LIMITS.sniffs, integer: true })
    const pts = route(b.route)
    // Optional performance statistics, measured from the phone carried on the walk.
    const avgSpeed = number(b.avgSpeed, 'Average speed', { max: LIMITS.speed, optional: true })
    const maxSpeed = number(b.maxSpeed, 'Top speed', { max: LIMITS.speed, optional: true })
    const sprints = number(b.sprints, 'Sprints', { max: LIMITS.sprints, integer: true, optional: true })
    const movingMinutes = number(b.movingMinutes, 'Moving time', { max: LIMITS.minutes, optional: true })
    const runMinutes = number(b.runMinutes, 'Running time', { max: LIMITS.minutes, optional: true })
    if ((movingMinutes != null && movingMinutes > minutes + 0.01) || (runMinutes != null && runMinutes > minutes + 0.01)) throw bad('Moving time and running time cannot be longer than the walk.')
    if (avgSpeed != null && maxSpeed != null && avgSpeed > maxSpeed + 0.05) throw bad('Average speed cannot be above top speed.')
    const now = Date.now()
    let started = now - minutes * 60e3
    if (b.startedAt !== undefined && b.startedAt !== null) {
      if (typeof b.startedAt !== 'string' || b.startedAt.length > 40) throw bad('startedAt must be an ISO date.')
      started = new Date(b.startedAt).getTime()
      if (Number.isNaN(started)) throw bad('startedAt must be an ISO date.')
      if (started > now + 5 * 60e3) throw bad('A walk cannot start in the future.')
      if (started < now - 366 * DAY) throw bad('A walk cannot be more than a year old.')
    }
    const id = newId()
    await db.query('INSERT INTO walks (id, dog_id, user_id, type, title, note, place, miles, minutes, sniffs, started_at, route, created_at, avg_speed, max_speed, sprints, moving_minutes, run_minutes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)',
      [id, dog.id, req.user.id, type, title, note, place, round(miles, 100), round(minutes, 100), b.sniffs == null ? 0 : sniffs, iso(started), pts ? JSON.stringify(pts) : null, iso(now), avgSpeed == null ? null : round(avgSpeed, 10), maxSpeed == null ? null : round(maxSpeed, 10), sprints, movingMinutes == null ? null : round(movingMinutes, 100), runMinutes == null ? null : round(runMinutes, 100)])
    const { rows } = await db.query(`SELECT ${WALK_COLS} FROM walks w JOIN dogs d ON d.id = w.dog_id JOIN users u ON u.id = w.user_id WHERE w.id = $1`, [id])
    // The owner and family hear about it when a walker or daycare logs an outing.
    if (role === 'walker' || role === 'daycare') await kit.notifyDogPeople(dog.id, { kind: 'care_walk_logged', actorId: req.user.id, title: `${role === 'daycare' ? req.user.name : firstName(req.user.name)} logged ${type === 'Walk' ? 'a walk' : type === 'Daycare' ? 'a daycare day' : `an outing (${type})`} for ${dog.name}`, body: `${title} · ${Math.round(minutes)} min${miles > 0 ? ` · ${round(miles, 10)} mi` : ''}`, link: { to: 'outing', id, dog: dog.slug } })
    res.status(201).json({ walk: (await walksOut(rows, req.user.id, { full: true }))[0] })
  })

  // Members only. Anyone else gets the same 404 as for a walk that does not exist.
  async function walkFor(id, userId) {
    if (!ID_RE.test(id)) throw new HttpError(404, 'No such walk.')
    const { rows } = await db.query(`SELECT ${WALK_COLS} FROM walks w JOIN dogs d ON d.id = w.dog_id JOIN users u ON u.id = w.user_id JOIN memberships m ON m.dog_id = w.dog_id AND m.user_id = $2 WHERE w.id = $1`, [id, userId])
    if (!rows[0]) throw new HttpError(404, 'No such walk.')
    return rows[0]
  }
  api.get('/walks/:id', auth, async (req, res) => {
    const w = await walkFor(req.params.id, req.user.id)
    res.json({ walk: (await walksOut([w], req.user.id, { full: true }))[0] })
  })
  // The person who logged a walk can delete it, and so can the dog's owner.
  api.delete('/walks/:id', auth, async (req, res) => {
    const w = await walkFor(req.params.id, req.user.id)
    if (w.user_id !== req.user.id) {
      const m = await db.query('SELECT role FROM memberships WHERE dog_id = $1 AND user_id = $2', [w.dog_id, req.user.id])
      if (!m.rows[0] || m.rows[0].role !== 'owner') throw new HttpError(403, 'Only the person who logged this walk or the dog\'s owner can delete it.')
    }
    await db.tx(async (t) => {
      await t.query('DELETE FROM paws WHERE walk_id = $1', [w.id])
      await t.query('DELETE FROM walk_photos WHERE walk_id = $1', [w.id])
      await t.query('DELETE FROM walks WHERE id = $1', [w.id])
    })
    res.json({ ok: true })
  })
  const pawState = async (walkId, userId) => {
    const { counts, mine } = await pawCounts([walkId], userId)
    return { paws: counts[walkId] || 0, pawed: !!mine[walkId] }
  }
  api.post('/walks/:id/paw', auth, async (req, res) => {
    const w = await walkFor(req.params.id, req.user.id)
    const had = await db.query('SELECT 1 AS x FROM paws WHERE walk_id = $1 AND user_id = $2', [w.id, req.user.id])
    await db.query('INSERT INTO paws (walk_id, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (walk_id, user_id) DO NOTHING', [w.id, req.user.id, iso(Date.now())])
    const state = await pawState(w.id, req.user.id)
    // One notification per outing per person. More paws rewrite it instead of stacking up.
    if (!had.rows[0]) {
      const who = (await db.query('SELECT user_id FROM paws WHERE walk_id = $1', [w.id])).rows.map((r) => r.user_id)
      const people = new Set([...(await kit.dogPeople(w.dog_id)), w.user_id])
      people.delete(req.user.id)
      for (const id of people) {
        const others = who.filter((u) => u !== id && u !== req.user.id).length
        await kit.notify(id, { kind: 'paw', dogId: w.dog_id, actorId: req.user.id, dedupeKey: `paw:${w.id}`, refresh: true, title: `${firstName(req.user.name)}${others ? ` and ${others} ${others === 1 ? 'other' : 'others'}` : ''} pawed ${w.dog_name}'s outing`, body: w.title, link: { to: 'outing', id: w.id, dog: w.dog_slug } })
      }
    }
    res.json(state)
  })
  api.delete('/walks/:id/paw', auth, async (req, res) => {
    const w = await walkFor(req.params.id, req.user.id)
    await db.query('DELETE FROM paws WHERE walk_id = $1 AND user_id = $2', [w.id, req.user.id])
    res.json(await pawState(w.id, req.user.id))
  })

  // -- feed: newest first, keyset pagination on (started_at, id)
  api.get('/feed', auth, async (req, res) => {
    let limit = 20
    if (req.query.limit !== undefined) {
      limit = Number(req.query.limit)
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw bad('limit must be a whole number from 1 to 50.')
    }
    const params = [req.user.id]
    let where = ''
    if (req.query.dog !== undefined) {
      const { dog } = await dogFor(String(req.query.dog), req.user.id)
      params.push(dog.id)
      where += ` AND w.dog_id = $${params.length}`
    }
    if (req.query.cursor !== undefined) {
      let at, id
      try { [at, id] = Buffer.from(String(req.query.cursor).slice(0, 200), 'base64url').toString('utf8').split('|') } catch (e) {}
      if (!at || !id || Number.isNaN(new Date(at).getTime()) || !ID_RE.test(id)) throw bad('That cursor is not valid.')
      params.push(iso(at), id)
      where += ` AND (w.started_at < $${params.length - 1} OR (w.started_at = $${params.length - 1} AND w.id < $${params.length}))`
    }
    params.push(limit + 1)
    const { rows } = await db.query(
      `SELECT ${WALK_COLS} FROM walks w JOIN memberships m ON m.dog_id = w.dog_id AND m.user_id = $1 JOIN dogs d ON d.id = w.dog_id JOIN users u ON u.id = w.user_id WHERE TRUE${where} ORDER BY w.started_at DESC, w.id DESC LIMIT $${params.length}`, params)
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    res.json({
      walks: await walksOut(page, req.user.id),
      nextCursor: rows.length > limit ? Buffer.from(`${iso(last.started_at)}|${last.id}`).toString('base64url') : null,
    })
  })

  // -- public
  async function publicDog(slug) {
    if (!SLUG_RE.test(slug)) return null
    const { rows } = await db.query(`SELECT ${DOG_COLS} FROM dogs WHERE slug = $1`, [slug])
    const dog = rows[0]
    // Private dogs look exactly like dogs that do not exist.
    if (!dog || !dog.is_public) return null
    const since = iso(Date.now() - 7 * DAY)
    const w = await db.query(
      'SELECT w.id, w.type, w.title, w.note, w.place, w.miles, w.minutes, w.sniffs, w.started_at, w.route, w.avg_speed, w.max_speed, w.sprints, w.moving_minutes, w.run_minutes, u.name AS user_name, m.role FROM walks w JOIN users u ON u.id = w.user_id LEFT JOIN memberships m ON m.dog_id = w.dog_id AND m.user_id = w.user_id WHERE w.dog_id = $1 ORDER BY w.started_at DESC, w.id DESC LIMIT 10', [dog.id])
    const { counts } = await pawCounts(w.rows.map((r) => r.id), null)
    const shots = await walkPhotos(w.rows.map((r) => r.id), { pub: true, limit: WALK_PHOTO_LIMITS.perWalk })
    // Only the awards the owner chose to show.
    const aw = await db.query('SELECT title, kind, event_name, placement, awarded_on FROM awards WHERE dog_id = $1 AND is_public = TRUE ORDER BY awarded_on DESC, created_at DESC LIMIT 50', [dog.id])
    // The care team is shown for demo dogs only. Real dogs keep it private until there is a setting for it.
    let team = []
    if (dog.is_demo) {
      const t = await db.query('SELECT u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.dog_id = $1 ORDER BY m.created_at, u.name', [dog.id])
      const rank = { owner: 0, family: 1, walker: 2, daycare: 3 }
      team = t.rows.map((r) => ({ name: r.role === 'daycare' ? r.name : firstName(r.name), role: r.role })).sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9))
    }
    return {
      team, city: dog.city || '',
      slug: dog.slug, name: dog.name, breed: dog.breed, bio: dog.bio, shareRoutes: !!dog.share_routes, photoUrl: photoUrl(dog.slug, dog.photo_v, true), isDemo: !!dog.is_demo,
      awards: aw.rows.map((r) => ({ title: r.title, kind: r.kind, eventName: r.event_name, placement: r.placement, awardedOn: r.awarded_on || null })),
      totals: { lifetime: await totals(dog.id), week: await totals(dog.id, since) },
      walks: w.rows.map((r) => {
        const out = {
          type: r.type, title: r.title, note: r.note, place: r.place, miles: num(r.miles), minutes: num(r.minutes), sniffs: num(r.sniffs), ...perf(r), startedAt: iso(r.started_at),
          // First names only for people. A daycare is a business, so its name is shown whole.
          with: r.role === 'daycare' ? r.user_name : firstName(r.user_name), paws: counts[r.id] || 0, photos: shots[r.id] || [],
        }
        if (dog.share_routes) out.route = thin(parseRoute(r.route), 300)
        return out
      }),
    }
  }
  api.get('/public/dogs/:slug', async (req, res) => {
    const dog = await publicDog(req.params.slug)
    if (!dog) throw new HttpError(404, 'No public dog with that address.')
    res.json({ dog })
  })

  // Public dogs only. A private dog's photo answers exactly like a missing one.
  api.get('/public/dogs/:slug/photo', async (req, res) => {
    const slug = req.params.slug
    const { rows } = SLUG_RE.test(slug) ? await db.query('SELECT photo FROM dogs WHERE slug = $1 AND is_public = TRUE AND photo IS NOT NULL', [slug]) : { rows: [] }
    if (!rows[0]) throw new HttpError(404, 'No public photo at that address.')
    sendPhoto(res, rows[0].photo, 'public, max-age=300')
  })

  // Shared with the route modules, which are registered here before the catch-all.
  async function memberItem(table, cols, id, userId, missing) {
    // `table` and `cols` are fixed strings from the route modules, never from a request.
    if (!ID_RE.test(id)) throw new HttpError(404, missing)
    const { rows } = await db.query(`SELECT ${cols} FROM ${table} WHERE id = $1`, [id])
    if (!rows[0]) throw new HttpError(404, missing)
    const m = await db.query('SELECT role FROM memberships WHERE dog_id = $1 AND user_id = $2', [rows[0].dog_id, userId])
    if (!m.rows[0]) throw new HttpError(403, 'You are not on this dog\'s care team.')
    return { ...rows[0], role: m.rows[0].role }
  }
  const pageHeaders = (res) => {
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
    res.set('X-Frame-Options', 'DENY')
    res.type('html')
  }
  const kit = { api, app, db, auth, admin, isAdmin, adminIds, isUnique, email, userFor, dogFor, memberItem, HttpError, bad, text, number, bool, object, sha, newToken, newId, iso, num, round, firstName, ageLabel, origin, ID_RE, TOKEN_RE, limiter, limited, readLimit, R, pageHeaders, photoUrl, parseRoute, thin, pawCounts, demoOnBoards, walkFor, walkPhotos, walkPhotoUrl, SLUG_RE, sniff }
  // First, so every other module can call kit.notify.
  registerNotifications(kit)
  registerUsage(kit)
  registerCompete(kit)
  registerDocs(kit)
  registerHealth(kit)
  registerPlaces(kit)
  registerShows(kit)
  registerRegistration(kit)
  registerFriends(kit)
  registerPhotos(kit)
  registerWeather(kit)
  // Read-only lookups, no sign-in. They sit on the API router, so only the per-address read limit applies.
  api.use('/geo', geoRouter(db))

  api.use((req, res) => res.status(404).json({ error: 'Not found.' }))
  api.use((err, req, res, next) => {
    let status = err.status || err.statusCode || 500
    let message = err.message
    if (err.type === 'entity.too.large') { status = 413; message = 'That is too much data for one request.' }
    else if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) { status = 400; message = 'The request body is not valid JSON.' }
    else if (status >= 500) { console.error(err); message = 'Something went wrong on our side.' }
    res.status(status).json({ error: message })
  })
  app.use('/api', api)

  // ---- public dog page --------------------------------------------------------
  app.get('/d/:slug', async (req, res) => {
    const r = readLimit('ip:' + req.ip)
    pageHeaders(res)
    if (!r.ok) return res.status(429).set('Retry-After', String(r.retry)).send(renderNotFound())
    let dog = null
    try { dog = await publicDog(req.params.slug); if (dog) dog.lost = await kit.publicLost(dog.slug) } catch (e) { console.error(e); return res.status(500).send(renderNotFound()) }
    if (!dog) return res.status(404).set('Cache-Control', 'no-store').send(renderNotFound())
    // ?add=1 is the friend invite link: the same page with an "Add as a friend" button on top.
    res.set('Cache-Control', 'public, max-age=60').send(renderDogPage(dog, origin(req), { add: req.query.add === '1' }))
  })
  app.use('/d', (req, res) => { pageHeaders(res); res.status(404).send(renderNotFound()) })

  // ---- built frontend ---------------------------------------------------------
  // The stock service worker in public/ caches every same-origin GET. Behind this
  // server that would keep signed-in API answers in the browser cache, so the
  // server answers /sw.js itself with a version that leaves /api, /d and /healthz alone.
  app.get('/sw.js', (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'no-cache').send(`// Network first, falling back to cache, for the app shell only.
const CACHE = 'trot-v3'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())))
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url)
  if (e.request.method !== 'GET' || u.origin !== location.origin) return
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/d/') || u.pathname.startsWith('/vet/') || u.pathname.startsWith('/t/') || u.pathname === '/healthz') return
  // Cache under the path only, so a one-time invite token in the query never lands in the cache.
  const key = u.pathname
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(key, c)) } return r }).catch(() => caches.match(key).then((r) => r || caches.match('/'))))
})
`)
  })
  if (staticDir) {
    const index = path.join(staticDir, 'index.html')
    // Text assets are gzipped once and kept in memory. Hashed files under /assets never
    // change, so browsers keep them for a year. index.html is always revalidated.
    const zipped = new Map()
    const ZIP = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.html': 'text/html; charset=utf-8' }
    app.use((req, res, next) => {
      const type = ZIP[path.extname(req.path)]
      if (!type || (req.method !== 'GET' && req.method !== 'HEAD') || !/\bgzip\b/.test(req.get('accept-encoding') || '') || req.path === '/sw.js' || req.path === '/index.html') return next()
      let rel
      try { rel = decodeURIComponent(req.path) } catch (e) { return next() }
      const file = path.join(staticDir, rel)
      if (rel.includes('\0') || !file.startsWith(staticDir + path.sep)) return next()
      let hit = zipped.get(file)
      try {
        const st = fs.statSync(file)
        if (!st.isFile() || st.size > 8 * 1024 * 1024) return next()
        if (!hit || hit.mtime !== st.mtimeMs) {
          if (zipped.size > 300) zipped.clear()
          hit = { mtime: st.mtimeMs, buf: zlib.gzipSync(fs.readFileSync(file), { level: 9 }), etag: `W/"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}-gz"` }
          zipped.set(file, hit)
        }
      } catch (e) { return next() }
      res.set('Content-Type', type).set('Content-Encoding', 'gzip').set('Vary', 'Accept-Encoding').set('ETag', hit.etag)
      res.set('Cache-Control', /^\/assets\//.test(rel) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600')
      if (req.get('if-none-match') === hit.etag) return res.status(304).end()
      res.set('Content-Length', String(hit.buf.length))
      return req.method === 'HEAD' ? res.end() : res.end(hit.buf)
    })
    app.use(express.static(staticDir, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (/[\\/]assets[\\/]/.test(p)) res.set('Cache-Control', 'public, max-age=31536000, immutable') } }))
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next()
      // A missing file is a 404. Everything else is a route inside the app.
      if (path.extname(req.path)) return res.status(404).type('text').send('Not found')
      if (!fs.existsSync(index)) return res.status(503).type('text').send('The frontend is not built yet. Run: npm run build')
      res.set('Cache-Control', 'no-cache').sendFile(index)
    })
  }
  app.use((req, res) => res.status(404).type('text').send('Not found'))
  app.use((err, req, res, next) => { console.error(err); res.status(500).type('text').send('Something went wrong.') })
  return app
}
