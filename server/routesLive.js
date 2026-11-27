// Live walks: friends who are out right now, on the map. Registered from app.js with the shared `kit`.
//
// This file shows where a person is, so every rule below is kept here on the server and has a test in
// server/live.test.js. Nothing in the browser is trusted to hide a position.
//
// 1. Off by default. A row exists only after the walker turned sharing on and started a Live GPS walk.
//    The "share by default" setting is a column on the account, FALSE until the person changes it.
// 2. Mutual friends only. A viewer sees a live walk of dog D when one of the dogs the viewer is owner or
//    family of follows D, and D follows that same dog back. One-way follows, people who are signed out and
//    the public pages get nothing. D has to be public, like everything else friends can see.
// 3. Only during a walk. The row is deleted on stop and when the walker saves an outing. A row with no
//    update for 10 minutes counts as ended: it is never returned and is deleted the next time anyone reads
//    or writes here. A row older than 12 hours ends the same way.
// 4. Home hidden. A position within 150 m of where the walk started, or within 150 m of the walker's
//    usual start (the most common start among their saved walks), is never stored and never returned.
//    Friends then see "Out on a walk" with no position and no place name.
// 5. No history. One row per walker, overwritten by each update. There is no trail.
// 6. Never public. Nothing here feeds the heatmap, the public pages, usage events or notifications,
//    and no coordinate is ever logged. Positions travel in request bodies, never in an address.
// 7. Stored rounded to 5 decimals. Returned to friends rounded to 4, about 11 m.
// 8. Real GPS only. A start has to say `source: 'gps'`. The app sends that for Live GPS and never for
//    demo playback. The server cannot prove where a position came from, so this is a contract, not a lock.
export const LIVE = { zoneM: 150, staleMs: 10 * 60e3, maxMs: 12 * 3600e3, minPingMs: 5000, placeM: 75, historyWalks: 200, pollSeconds: 20, pingSeconds: 15, maxFriends: 50 }

const RAD = Math.PI / 180
// Distance in metres between two [lat, lng] points.
export function metres(a, b) {
  const x = (b[1] - a[1]) * RAD * Math.cos(((a[0] + b[0]) / 2) * RAD), y = (b[0] - a[0]) * RAD
  return Math.sqrt(x * x + y * y) * 6371000
}
const r5 = (v) => Math.round(v * 1e5) / 1e5
const r4 = (v) => Math.round(v * 1e4) / 1e4

// The usual start: past start points are grouped greedily (a point joins the first group whose first
// point is within 150 m), and the middle of the largest group wins. A tie goes to the group met first,
// which is the most recent because the caller passes newest first. No history means no usual start.
export function usualStart(starts, radiusM = LIVE.zoneM) {
  const groups = []
  for (const p of starts || []) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue
    const g = groups.find((x) => metres(x.seed, p) <= radiusM)
    if (g) { g.n++; g.lat += p[0]; g.lng += p[1] } else groups.push({ seed: p, n: 1, lat: p[0], lng: p[1] })
  }
  let best = null
  for (const g of groups) if (!best || g.n > best.n) best = g
  return best ? [r5(best.lat / best.n), r5(best.lng / best.n)] : null
}
// True when a position must not be shown. Both the stored value and the rounded value that friends
// would get are checked, so rounding can never move a point back inside a zone.
export function inZone(lat, lng, zones, radiusM = LIVE.zoneM) {
  const pts = [[lat, lng], [r4(lat), r4(lng)]]
  return zones.some((z) => z && Number.isFinite(z[0]) && Number.isFinite(z[1]) && pts.some((p) => metres(p, z) <= radiusM))
}
// The first [lat, lng] pair of a stored route, read from the start of its JSON text.
const firstPoint = (head) => { const m = /^\s*\[\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/.exec(String(head || '')); return m ? [Number(m[1]), Number(m[2])] : null }

export function registerLive(kit, { now = () => Date.now() } = {}) {
  const { api, db, auth, dogFor, HttpError, bad, object, number, bool, iso, firstName, photoUrl, isUnique } = kit
  const TYPES = (kit.WALK_TYPES || ['Walk', 'Run', 'Hike']).filter((t) => t !== 'Daycare')
  const coord = (b) => ({ lat: r5(number(b.lat, 'lat', { min: -90, max: 90 })), lng: r5(number(b.lng, 'lng', { min: -180, max: 180 })) })
  const zonesOf = (row) => [[row.start_lat, row.start_lng], row.home_lat == null || row.home_lng == null ? null : [row.home_lat, row.home_lng]]
  const ms = (v) => new Date(v).getTime()
  const ended = (row, t) => t - ms(row.updated_at) > LIVE.staleMs || t - ms(row.started_at) > LIVE.maxMs
  // Rows that have ended are removed whenever this file is used. Nothing reads them in between.
  const sweep = (t) => db.query('DELETE FROM live_walks WHERE updated_at < $1 OR started_at < $2', [iso(t - LIVE.staleMs), iso(t - LIVE.maxMs)])
  const stop = (userId) => db.query('DELETE FROM live_walks WHERE user_id = $1', [userId])
  // Saving an outing ends sharing. app.js calls this from POST /dogs/:slug/walks.
  kit.liveStop = async (userId) => { try { await stop(userId) } catch (e) { console.error('live stop failed') } }

  async function usualFor(userId) {
    const { rows } = await db.query(`SELECT SUBSTRING(route FROM 1 FOR 80) AS head FROM walks WHERE user_id = $1 AND route IS NOT NULL ORDER BY started_at DESC LIMIT ${LIVE.historyWalks}`, [userId])
    return usualStart(rows.map((r) => firstPoint(r.head)).filter(Boolean))
  }
  // The name of the nearest listed place within 75 m, or null. Name only.
  async function placeNear(lat, lng) {
    const dLat = 0.001, dLng = 0.001 / Math.max(0.2, Math.cos(lat * RAD))
    const { rows } = await db.query('SELECT name, lat, lng FROM places WHERE lat IS NOT NULL AND lng IS NOT NULL AND lat >= $1 AND lat <= $2 AND lng >= $3 AND lng <= $4 LIMIT 200', [lat - dLat, lat + dLat, lng - dLng, lng + dLng])
    let best = null
    for (const p of rows) { const d = metres([lat, lng], [p.lat, p.lng]); if (d <= LIVE.placeM && (!best || d < best.d)) best = { d, name: p.name } }
    return best ? String(best.name).slice(0, 80) : null
  }

  // The account setting. Off until the person turns it on.
  api.get('/live/settings', auth, async (req, res) => {
    const { rows } = await db.query('SELECT share_walks_default FROM users WHERE id = $1', [req.user.id])
    res.json({ shareByDefault: !!(rows[0] && rows[0].share_walks_default) })
  })
  api.put('/live/settings', auth, async (req, res) => {
    const on = bool(object(req.body).shareByDefault, 'shareByDefault')
    await db.query('UPDATE users SET share_walks_default = $1 WHERE id = $2', [on, req.user.id])
    res.json({ shareByDefault: on })
  })

  // Starts (or restarts) sharing for the caller. `lat` and `lng` are where the walk began. That point is
  // the middle of the hidden zone, so the row starts with no position at all.
  api.post('/live/start', auth, async (req, res) => {
    const b = object(req.body)
    if (typeof b.dog !== 'string') throw bad('dog is required.')
    const { dog } = await dogFor(b.dog, req.user.id)
    if (b.source !== 'gps') throw bad('Only a Live GPS walk can be shared.')
    const activity = b.activity === undefined ? 'Walk' : b.activity
    if (!TYPES.includes(activity)) throw bad(`activity must be one of: ${TYPES.join(', ')}.`)
    const at = coord(b)
    const elapsed = number(b.elapsedSeconds, 'elapsedSeconds', { max: LIVE.maxMs / 1000, optional: true }) || 0
    if (!dog.is_public) throw bad(`${dog.name}'s page is private, so friends cannot see this walk. Make the page public to share.`)
    const t = now()
    await sweep(t)
    const home = await usualFor(req.user.id)
    const vals = [dog.id, activity, iso(t - elapsed * 1000), iso(t), at.lat, at.lng, home ? home[0] : null, home ? home[1] : null, req.user.id]
    const update = () => db.query('UPDATE live_walks SET dog_id = $1, activity = $2, started_at = $3, updated_at = $4, pinged_at = NULL, lat = NULL, lng = NULL, place = NULL, start_lat = $5, start_lng = $6, home_lat = $7, home_lng = $8 WHERE user_id = $9 RETURNING user_id', vals)
    if (!(await update()).rows[0]) {
      try { await db.query('INSERT INTO live_walks (dog_id, activity, started_at, updated_at, start_lat, start_lng, home_lat, home_lng, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', vals) }
      catch (e) { if (!isUnique(e)) throw e; await update() }
    }
    res.status(201).json({ ok: true, sharing: true, visible: false, pingSeconds: LIVE.pingSeconds })
  })

  // The newest position replaces the one before. Inside a hidden zone the row keeps no position.
  api.post('/live/ping', auth, async (req, res) => {
    const at = coord(object(req.body))
    const t = now()
    const { rows } = await db.query('SELECT user_id, started_at, updated_at, pinged_at, lat, start_lat, start_lng, home_lat, home_lng FROM live_walks WHERE user_id = $1', [req.user.id])
    const row = rows[0]
    if (!row || ended(row, t)) { if (row) await stop(req.user.id); throw new HttpError(404, 'This walk is not being shared.') }
    // Updates closer together than 5 seconds are dropped whole, so a busy phone cannot be followed step by step.
    if (row.pinged_at && t - ms(row.pinged_at) < LIVE.minPingMs) return res.json({ ok: true, ignored: true, visible: row.lat != null })
    const hidden = inZone(at.lat, at.lng, zonesOf(row))
    const place = hidden ? null : await placeNear(at.lat, at.lng)
    await db.query('UPDATE live_walks SET lat = $1, lng = $2, place = $3, updated_at = $4, pinged_at = $4 WHERE user_id = $5', [hidden ? null : at.lat, hidden ? null : at.lng, place, iso(t), req.user.id])
    res.json({ ok: true, visible: !hidden })
  })

  api.post('/live/stop', auth, async (req, res) => {
    await stop(req.user.id)
    res.json({ ok: true, sharing: false })
  })

  // Live walks of the caller's mutual friends. See rule 2 at the top for who that is.
  api.get('/live/friends', auth, async (req, res) => {
    const t = now()
    await sweep(t)
    const out = { friends: [], pollSeconds: LIVE.pollSeconds }
    const mine = (await db.query("SELECT dog_id FROM memberships WHERE user_id = $1 AND role IN ('owner', 'family')", [req.user.id])).rows.map((r) => r.dog_id)
    if (!mine.length) return res.json(out)
    const marks = mine.map((_, i) => `$${i + 1}`).join(', ')
    const [fwd, back] = await Promise.all([
      db.query(`SELECT follower_dog_id, followed_dog_id FROM dog_follows WHERE follower_dog_id IN (${marks})`, mine),
      db.query(`SELECT follower_dog_id, followed_dog_id FROM dog_follows WHERE followed_dog_id IN (${marks})`, mine),
    ])
    const backSet = new Set(back.rows.map((r) => `${r.follower_dog_id}>${r.followed_dog_id}`))
    const mutual = [...new Set(fwd.rows.filter((r) => backSet.has(`${r.followed_dog_id}>${r.follower_dog_id}`)).map((r) => r.followed_dog_id))]
    if (!mutual.length) return res.json(out)
    const { rows } = await db.query(
      `SELECT l.dog_id, l.activity, l.started_at, l.updated_at, l.lat, l.lng, l.start_lat, l.start_lng, l.home_lat, l.home_lng, l.place, d.slug, d.name, d.photo_v, u.name AS user_name, m.role
       FROM live_walks l JOIN dogs d ON d.id = l.dog_id JOIN users u ON u.id = l.user_id JOIN memberships m ON m.dog_id = l.dog_id AND m.user_id = l.user_id
       WHERE d.is_public = TRUE AND l.user_id <> $${mutual.length + 1} AND l.dog_id IN (${mutual.map((_, i) => `$${i + 1}`).join(', ')})
       ORDER BY l.updated_at DESC LIMIT ${LIVE.maxFriends}`, [...mutual, req.user.id])
    const seen = new Set()
    for (const r of rows) {
      // One entry per dog: the walker heard from most recently. A row that has ended is never returned.
      if (ended(r, t) || seen.has(r.dog_id)) continue
      seen.add(r.dog_id)
      // Checked again on the way out, so a position inside a zone cannot leave even if one was stored.
      const show = r.lat != null && r.lng != null && !inZone(r.lat, r.lng, zonesOf(r))
      out.friends.push({
        slug: r.slug, name: r.name, photoUrl: photoUrl(r.slug, r.photo_v, true),
        with: firstName(r.user_name), activity: r.activity,
        minutesOut: Math.max(0, Math.round((t - ms(r.started_at)) / 60e3)),
        lastSeenSeconds: Math.max(0, Math.round((t - ms(r.updated_at)) / 1000)),
        position: show ? { lat: r4(r.lat), lng: r4(r.lng) } : null,
        place: show ? r.place || null : null,
      })
    }
    res.json(out)
  })
}
