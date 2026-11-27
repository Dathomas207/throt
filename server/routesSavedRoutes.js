// Saved routes: built in the route builder, or kept from an outing that was recorded. Registered from
// app.js with the shared `kit`. (The other files here are named for the HTTP routes they add. This one
// adds the HTTP routes for walking routes.)
//
// Privacy rules this file keeps:
// - A saved route belongs to the person who saved it. Nobody else can list, read, change or delete it,
//   and that includes the rest of a dog's care team. Someone else's route answers 404, like one that is not there.
// - Recent routes are worked out from the asking person's own recorded outings and from nobody else's.
// - Saving the route of an outing needs a place on that dog's care team, the same rule as reading the outing.
export const ROUTE_LIMITS = { perUser: 200, points: 2000, controlPoints: 26, name: 60, listPoints: 160, recents: 10, recentScan: 80 }
export const ROUTE_KINDS = ['built', 'walked']
export const PACE_MIN_PER_MILE = 20

const EARTH_M = 6371008.8, RAD = Math.PI / 180
const meters = (a, b) => {
  const dLat = (b[0] - a[0]) * RAD, dLng = (b[1] - a[1]) * RAD
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.sqrt(x))
}
export const lineMeters = (pts) => { let d = 0; for (let i = 1; i < pts.length; i++) d += meters(pts[i - 1], pts[i]); return d }
export const lineMiles = (pts) => lineMeters(pts) / 1609.344
const thinTo = (pts, max) => {
  if (!pts || pts.length <= max) return pts
  const out = []
  for (let i = 0; i < max; i++) out.push(pts[Math.round((i * (pts.length - 1)) / (max - 1))])
  return out
}
// Distance in meters from p to the segment a-b, on a flat map of the small area around a.
function toSegment(p, a, b) {
  const k = Math.cos(a[0] * RAD), bx = (b[1] - a[1]) * k, by = b[0] - a[0], px = (p[1] - a[1]) * k, py = p[0] - a[0]
  const len2 = bx * bx + by * by, t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0
  return meters(p, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
}
// `n` points spaced evenly by distance along a line, both ends included.
export function sampleLine(pts, n) {
  const total = lineMeters(pts), out = [pts[0]]
  if (!(total > 0) || n < 2) return out
  let d = 0, k = 1
  for (let i = 1; i < pts.length && k < n; i++) {
    const a = pts[i - 1], b = pts[i], step = meters(a, b)
    while (k < n && step > 0 && d + step >= (total * k) / (n - 1) - 1e-6) { const t = Math.max(0, Math.min(1, ((total * k) / (n - 1) - d) / step)); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); k++ }
    d += step
  }
  while (out.length < n) out.push(pts[pts.length - 1])
  return out
}
// The share of line a (sampled) that lies within nearM of line b.
export function overlapShare(a, b, { nearM = 60, samples = 24 } = {}) {
  const line = thinTo(b, 300)
  let hit = 0
  const pts = sampleLine(a, samples)
  for (const p of pts) { for (let i = 1; i < line.length; i++) if (toSegment(p, line[i - 1], line[i]) <= nearM) { hit++; break } }
  return hit / pts.length
}
// Two walks count as the same route when they start within 150 m of each other, their lengths are within
// 12 percent, and most of each line lies close to the other. Pure, so it is tested on its own.
export function similarRoutes(a, b, { startM = 150, lengthPct = 0.12, nearM = 60, overlap = 0.8, samples = 24 } = {}) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return false
  if (meters(a[0], b[0]) > startM) return false
  const la = lineMeters(a), lb = lineMeters(b)
  if (!(la > 0) || !(lb > 0) || Math.abs(la - lb) > lengthPct * Math.max(la, lb)) return false
  return overlapShare(a, b, { nearM, samples }) >= overlap && overlapShare(b, a, { nearM, samples }) >= overlap
}
// walks: newest first, each { id, pts, routeId, ... }. Walks along nearly the same line are folded into the
// newest of them. Returns up to `max` groups: { walk, times, walkIds, routeIds }.
export function distinctRecents(walks, max = ROUTE_LIMITS.recents) {
  const groups = []
  for (const w of walks) {
    if (!Array.isArray(w.pts) || w.pts.length < 2) continue
    const g = groups.find((x) => similarRoutes(x.walk.pts, w.pts))
    if (g) { g.times++; g.walkIds.push(w.id); if (w.routeId) g.routeIds.push(w.routeId) }
    else if (groups.length < max) groups.push({ walk: w, times: 1, walkIds: [w.id], routeIds: w.routeId ? [w.routeId] : [] })
  }
  return groups
}

export function registerSavedRoutes(kit) {
  const { api, db, auth, dogFor, HttpError, bad, text, bool, object, newId, iso, num, round, ID_RE, parseRoute, walkFor } = kit
  const NOT_FOUND = 'No such saved route.'
  const COLS = 'r.id, r.user_id, r.dog_id, r.name, r.kind, r.points, r.control, r.miles, r.minutes, r.favorite, r.usual, r.source_walk_id, r.start_lat, r.start_lng, r.times_walked, r.last_walked_at, r.created_at, r.updated_at, d.slug AS dog_slug, d.name AS dog_name'
  const FROM = 'FROM routes r LEFT JOIN dogs d ON d.id = r.dog_id'
  const parse = (s) => { try { return JSON.parse(s) } catch (e) { return null } }
  const minutesFor = (miles) => Math.max(1, Math.round(miles * PACE_MIN_PER_MILE))

  // ---- input ----------------------------------------------------------------
  function points(v) {
    if (!Array.isArray(v)) throw bad('Points must be a list of [lat, lng] pairs.')
    if (v.length < 2) throw bad('A route needs at least two points.')
    if (v.length > ROUTE_LIMITS.points) throw bad(`A route can have up to ${ROUTE_LIMITS.points} points.`)
    const out = []
    for (const p of v) {
      if (!Array.isArray(p) || p.length !== 2) throw bad('Points must be a list of [lat, lng] pairs.')
      const [lat, lng] = p
      if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw bad('The route has a point that is not a valid coordinate.')
      out.push([round(lat, 1e5), round(lng, 1e5)])
    }
    const miles = lineMiles(out)
    if (!(miles > 0.005)) throw bad('That route has no length. Add a point somewhere else.')
    if (miles > 200) throw bad('A route can be up to 200 miles long.')
    return { pts: out, miles: round(miles, 100) }
  }
  // The builder's control points and one mode per leg between them. Optional.
  function control(v) {
    if (v == null) return null
    const c = object(v)
    if (!Array.isArray(c.points) || c.points.length < 2 || c.points.length > ROUTE_LIMITS.controlPoints) throw bad(`Control points must be a list of 2 to ${ROUTE_LIMITS.controlPoints} [lat, lng] pairs.`)
    const pts = c.points.map((p) => {
      if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number' || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || p[0] < -90 || p[0] > 90 || p[1] < -180 || p[1] > 180) throw bad('A control point is not a valid coordinate.')
      return [round(p[0], 1e5), round(p[1], 1e5)]
    })
    if (!Array.isArray(c.modes) || c.modes.length !== pts.length - 1 || c.modes.some((m) => m !== 'path' && m !== 'straight')) throw bad('Each leg between two control points needs a mode: path or straight.')
    return { points: pts, modes: c.modes }
  }
  const nameOf = (v, miles) => text(v, 'Name', { max: ROUTE_LIMITS.name }) || `${miles.toFixed(1)} mi route`
  async function dogIdFor(slug, userId) {
    if (slug == null || slug === '') return null
    if (typeof slug !== 'string') throw bad('Dog must be a dog address.')
    return (await dogFor(slug, userId)).dog.id
  }

  // ---- output ---------------------------------------------------------------
  const routeOut = (r, { full = false, from = null } = {}) => {
    const pts = parseRoute(r.points) || [], c = r.control ? parse(r.control) : null
    const start = r.start_lat == null || r.start_lng == null ? null : [num(r.start_lat), num(r.start_lng)]
    return {
      id: r.id, name: r.name, kind: r.kind === 'walked' ? 'walked' : 'built', miles: num(r.miles), minutes: num(r.minutes), favorite: !!r.favorite, usual: !!r.usual,
      dog: r.dog_slug ? { slug: r.dog_slug, name: r.dog_name } : null, sourceWalkId: r.source_walk_id || null, start,
      timesWalked: num(r.times_walked), lastWalkedAt: r.last_walked_at ? iso(r.last_walked_at) : null, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
      // Lists carry a thinned line for the thumbnail. The full line and the control points come from GET /api/routes/:id.
      points: full ? pts : thinTo(pts, ROUTE_LIMITS.listPoints), pointCount: pts.length, editable: !!c, ...(full ? { control: c } : {}),
      ...(from && start ? { distance: round(meters(from, start) / 1609.344, 100) } : {}),
    }
  }
  // Only ever the asking person's own row. Anything else is a 404.
  async function mine(id, userId) {
    if (!ID_RE.test(id)) throw new HttpError(404, NOT_FOUND)
    const { rows } = await db.query(`SELECT ${COLS} ${FROM} WHERE r.id = $1 AND r.user_id = $2`, [id, userId])
    if (!rows[0]) throw new HttpError(404, NOT_FOUND)
    return rows[0]
  }
  const countFor = async (userId) => num((await db.query('SELECT COUNT(*) AS n FROM routes WHERE user_id = $1', [userId])).rows[0].n)
  const full = async (id, userId) => routeOut(await mine(id, userId), { full: true })
  async function room(userId) {
    if ((await countFor(userId)) >= ROUTE_LIMITS.perUser) throw bad(`You can keep up to ${ROUTE_LIMITS.perUser} saved routes. Delete one you no longer use, then save this one.`)
  }
  async function insert(userId, { dogId = null, name, kind, pts, miles, ctl = null, favorite = false, sourceWalkId = null, timesWalked = 0, lastWalkedAt = null, clientId = null }) {
    const id = newId(), now = iso(Date.now())
    await db.query('INSERT INTO routes (id, user_id, dog_id, name, kind, points, control, miles, minutes, favorite, usual, source_walk_id, start_lat, start_lng, times_walked, last_walked_at, client_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, $11, $12, $13, $14, $15, $16, $17, $17)',
      [id, userId, dogId, name, kind, JSON.stringify(pts), ctl ? JSON.stringify(ctl) : null, miles, minutesFor(miles), favorite, sourceWalkId, round(pts[0][0], 1e4), round(pts[0][1], 1e4), timesWalked, lastWalkedAt, clientId, now])
    return id
  }

  // The asking person's recorded outings with a line, newest first, folded into distinct routes.
  async function recents(userId) {
    const { rows } = await db.query(`SELECT w.id, w.title, w.place, w.miles, w.minutes, w.started_at, w.route, w.route_id, d.slug AS dog_slug, d.name AS dog_name FROM walks w JOIN dogs d ON d.id = w.dog_id JOIN memberships m ON m.dog_id = w.dog_id AND m.user_id = $1 WHERE w.user_id = $1 AND w.route IS NOT NULL ORDER BY w.started_at DESC, w.id DESC LIMIT ${ROUTE_LIMITS.recentScan}`, [userId])
    const groups = distinctRecents(rows.map((r) => ({ id: r.id, row: r, pts: parseRoute(r.route), routeId: r.route_id || null })))
    // A group the person already saved or starred says so, so the list can show the star filled in.
    const saved = (await db.query('SELECT id, name, favorite, usual, source_walk_id FROM routes WHERE user_id = $1', [userId])).rows
    return groups.map((g) => {
      const r = g.walk.row
      const s = saved.find((x) => g.routeIds.includes(x.id)) || saved.find((x) => x.source_walk_id && g.walkIds.includes(x.source_walk_id)) || null
      return {
        id: 'walk:' + r.id, kind: 'recent', walkId: r.id, name: r.title || r.place || 'Walk', startedAt: iso(r.started_at), dog: { slug: r.dog_slug, name: r.dog_name },
        miles: round(lineMiles(g.walk.pts), 100), minutes: Math.max(1, Math.round(num(r.minutes))), timesWalked: g.times, points: thinTo(g.walk.pts, ROUTE_LIMITS.listPoints),
        saved: s ? { id: s.id, name: s.name, favorite: !!s.favorite, usual: !!s.usual } : null,
      }
    })
  }

  // ---- routes ---------------------------------------------------------------
  // filter=all (the default) or favorites: saved routes. filter=recent: routes worked out from recorded outings.
  // near=lat,lng adds each route's distance from that point and puts the nearest first.
  api.get('/routes', auth, async (req, res) => {
    const filter = req.query.filter === undefined ? 'all' : req.query.filter
    if (!['all', 'favorites', 'recent'].includes(filter)) throw bad('Filter must be all, favorites or recent.')
    let from = null
    if (req.query.near !== undefined) {
      const m = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(String(req.query.near))
      if (!m || Math.abs(Number(m[1])) > 90 || Math.abs(Number(m[2])) > 180) throw bad('near must look like 35.19,-80.84.')
      from = [Number(m[1]), Number(m[2])]
    }
    if (filter === 'recent') return res.json({ routes: await recents(req.user.id), max: ROUTE_LIMITS.recents })
    const { rows } = await db.query(`SELECT ${COLS} ${FROM} WHERE r.user_id = $1${filter === 'favorites' ? ' AND r.favorite = TRUE' : ''} ORDER BY r.updated_at DESC, r.id DESC LIMIT ${ROUTE_LIMITS.perUser}`, [req.user.id])
    const routes = rows.map((r) => routeOut(r, { from }))
    if (from) routes.sort((a, b) => (a.distance == null ? Infinity : a.distance) - (b.distance == null ? Infinity : b.distance))
    res.json({ routes, max: ROUTE_LIMITS.perUser })
  })
  api.get('/routes/:id', auth, async (req, res) => res.json({ route: await full(req.params.id, req.user.id) }))

  // clientId is the id the route had on the device it was first saved on. Sending the same one again
  // answers with the route that is already there, so moving local routes to the account can be repeated.
  api.post('/routes', auth, async (req, res) => {
    const b = object(req.body)
    let clientId = null
    if (b.clientId != null) {
      if (typeof b.clientId !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(b.clientId)) throw bad('clientId must be a short id.')
      clientId = b.clientId
      const had = await db.query('SELECT id FROM routes WHERE user_id = $1 AND client_id = $2', [req.user.id, clientId])
      if (had.rows[0]) return res.json({ route: await full(had.rows[0].id, req.user.id), already: true })
    }
    const { pts, miles } = points(b.points)
    const ctl = control(b.control)
    const kind = b.kind === undefined ? 'built' : b.kind
    if (!ROUTE_KINDS.includes(kind)) throw bad('Kind must be built or walked.')
    const favorite = b.favorite === undefined ? false : bool(b.favorite, 'Favorite')
    const name = nameOf(b.name, miles)
    const dogId = await dogIdFor(b.dog, req.user.id)
    await room(req.user.id)
    const id = await insert(req.user.id, { dogId, name, kind, pts, miles, ctl, favorite, clientId })
    res.status(201).json({ route: await full(id, req.user.id) })
  })

  // name, favorite, the line itself when the route was edited again, and the usual walk for a dog.
  // The usual walk is one favorite per dog: setting it on one route takes it off the others for that dog.
  api.patch('/routes/:id', auth, async (req, res) => {
    const r = await mine(req.params.id, req.user.id)
    const b = object(req.body)
    const sets = [], vals = []
    const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`) }
    if (b.name !== undefined) set('name', text(b.name, 'Name', { min: 1, max: ROUTE_LIMITS.name }))
    if (b.points !== undefined) {
      const { pts, miles } = points(b.points)
      set('points', JSON.stringify(pts)); set('miles', miles); set('minutes', minutesFor(miles)); set('start_lat', round(pts[0][0], 1e4)); set('start_lng', round(pts[0][1], 1e4))
      // Control points describe one particular line. A new line without them means the old ones no longer fit.
      const ctl = control(b.control)
      set('control', ctl ? JSON.stringify(ctl) : null)
    } else if (b.control !== undefined) throw bad('Send the points along with the control points.')
    let favorite = !!r.favorite
    if (b.favorite !== undefined) { favorite = bool(b.favorite, 'Favorite'); set('favorite', favorite) }
    let dogId = r.dog_id
    if (b.dog !== undefined) { dogId = await dogIdFor(b.dog, req.user.id); set('dog_id', dogId) }
    let usual = !!r.usual && favorite && !!dogId
    if (b.usual !== undefined) {
      usual = bool(b.usual, 'Usual walk')
      if (usual && !favorite) throw bad('Add this route to your favorites first. The usual walk is one of your favorites.')
      if (usual && !dogId) throw bad('Say which dog this is the usual walk for.')
    }
    if (usual !== !!r.usual) set('usual', usual)
    if (!sets.length) throw bad('Nothing to change.')
    set('updated_at', iso(Date.now()))
    await db.tx(async (t) => {
      if (usual) await t.query('UPDATE routes SET usual = FALSE WHERE user_id = $1 AND dog_id = $2 AND id <> $3 AND usual = TRUE', [req.user.id, dogId, r.id])
      await t.query(`UPDATE routes SET ${sets.join(', ')} WHERE id = $${vals.length + 1} AND user_id = $${vals.length + 2}`, [...vals, r.id, req.user.id])
    })
    res.json({ route: await full(r.id, req.user.id) })
  })

  api.delete('/routes/:id', auth, async (req, res) => {
    const r = await mine(req.params.id, req.user.id)
    await db.tx(async (t) => {
      await t.query('UPDATE walks SET route_id = NULL WHERE route_id = $1 AND user_id = $2', [r.id, req.user.id])
      await t.query('DELETE FROM routes WHERE id = $1 AND user_id = $2', [r.id, req.user.id])
    })
    res.json({ ok: true })
  })

  // Keeps the line of a recorded outing as a 'walked' route. Anyone on that dog's care team can do it for
  // an outing they can read, and the route is theirs alone. Asking twice answers with the same route.
  api.post('/walks/:id/route', auth, async (req, res) => {
    const w = await walkFor(req.params.id, req.user.id)
    const b = req.body == null ? {} : object(req.body)
    const favorite = b.favorite === undefined ? null : bool(b.favorite, 'Favorite')
    const had = await db.query('SELECT id, favorite FROM routes WHERE user_id = $1 AND source_walk_id = $2', [req.user.id, w.id])
    if (had.rows[0]) {
      if (favorite === true && !had.rows[0].favorite) await db.query('UPDATE routes SET favorite = TRUE, updated_at = $1 WHERE id = $2', [iso(Date.now()), had.rows[0].id])
      return res.json({ route: await full(had.rows[0].id, req.user.id), already: true })
    }
    const line = parseRoute(w.route)
    if (!line) throw bad('This outing has no recorded route to save.')
    const { pts, miles } = points(thinTo(line, ROUTE_LIMITS.points))
    const name = b.name === undefined ? text(w.title || w.place || '', 'Name', { max: 200 }).slice(0, ROUTE_LIMITS.name) || `${miles.toFixed(1)} mi walk` : nameOf(b.name, miles)
    await room(req.user.id)
    const id = await insert(req.user.id, { dogId: w.dog_id, name, kind: 'walked', pts, miles, favorite: favorite === true, sourceWalkId: w.id, timesWalked: 1, lastWalkedAt: iso(w.started_at) })
    res.status(201).json({ route: await full(id, req.user.id) })
  })

  // Called when an outing is saved with a routeId. A route that is not this person's is left alone and the outing is saved without a link.
  kit.linkWalkToRoute = async ({ walkId, routeId, userId, startedAt }) => {
    const { rows } = await db.query('SELECT id, last_walked_at FROM routes WHERE id = $1 AND user_id = $2', [routeId, userId])
    if (!rows[0]) return null
    const last = rows[0].last_walked_at && new Date(rows[0].last_walked_at).getTime() > new Date(startedAt).getTime() ? iso(rows[0].last_walked_at) : startedAt
    await db.query('UPDATE walks SET route_id = $1 WHERE id = $2', [routeId, walkId])
    await db.query('UPDATE routes SET times_walked = times_walked + 1, last_walked_at = $1 WHERE id = $2', [last, routeId])
    return routeId
  }
}
