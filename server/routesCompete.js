// Leaderboards, challenges, Trot's own earned badges and the pack feed.
// Everything here is computed from saved walks when it is asked for. Nothing is
// stored except which dogs joined which challenge. Windows are in UTC.
import { bestStreak, dayIndex, tzOf } from './routesHealth.js'

const DAY = 864e5
const r1 = (v) => Math.round(v * 10) / 10
const ymd = (t) => new Date(t).toISOString().slice(0, 10)

export function monthWindow(now) {
  const d = new Date(now), y = d.getUTCFullYear(), m = d.getUTCMonth()
  return { key: `${y}-${String(m + 1).padStart(2, '0')}`, start: Date.UTC(y, m, 1), end: Date.UTC(y, m + 1, 1), label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) }
}
export function weekWindow(now) {
  const day = Math.floor(now / DAY)
  // 1970-01-01 was a Thursday, so day 4 was the first Monday.
  const monday = day - ((((day - 4) % 7) + 7) % 7)
  return { key: ymd(monday * DAY), start: monday * DAY, end: (monday + 7) * DAY, label: `Week of ${new Date(monday * DAY).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` }
}
export function weekendWindow(now) {
  const w = weekWindow(now), sat = w.start + 5 * DAY
  return { key: ymd(sat), start: sat, end: w.end, label: `Weekend of ${new Date(sat).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` }
}
const WINDOWS = { month: monthWindow, weekend: weekendWindow }
// The window a stored join belongs to, rebuilt from its period key.
function windowOfKey(kind, key) {
  const t = Date.parse((kind === 'month' ? key + '-01' : key) + 'T12:00:00Z')
  return Number.isNaN(t) ? null : WINDOWS[kind](t)
}

// Defined here, not made by users yet.
export const CHALLENGES = [
  { key: 'month-25', name: '25-mile month', description: 'Cover 25 miles together this month.', unit: 'mi', target: 25, window: 'month' },
  { key: 'streak-7', name: 'Seven in a row', description: 'Get out 7 days in a row this month.', unit: 'days', target: 7, window: 'month' },
  { key: 'explorer-5', name: 'Explorer', description: 'Walk in 5 different places this month.', unit: 'places', target: 5, window: 'month' },
  { key: 'team-3', name: 'Whole team', description: 'Get walked by 3 different people this month.', unit: 'people', target: 3, window: 'month' },
  { key: 'play-120', name: 'Play month', description: '120 minutes of play time, fetch or dog park this month.', unit: 'min', target: 120, window: 'month' },
  { key: 'weekend-long', name: 'Weekend long walk', description: 'One walk of 60 minutes or more on Saturday or Sunday.', unit: 'min', target: 60, window: 'weekend' },
]
export const PLAY_TYPES = ['Play time', 'Fetch', 'Dog park']
const places = (walks) => new Set(walks.map((w) => String(w.place || '').trim().toLowerCase()).filter(Boolean))
// Progress for one challenge from the walks that fall inside its window.
export function challengeProgress(key, walks) {
  const ws = walks.filter((w) => w.type !== 'Daycare')
  if (key === 'month-25') return r1(ws.reduce((s, w) => s + (Number(w.miles) || 0), 0))
  if (key === 'streak-7') return bestStreak(new Set(ws.map((w) => dayIndex(new Date(w.started_at).getTime()))))
  if (key === 'explorer-5') return places(ws).size
  if (key === 'team-3') return new Set(ws.map((w) => w.user_id)).size
  if (key === 'play-120') return Math.round(ws.filter((w) => PLAY_TYPES.includes(w.type)).reduce((s, w) => s + (Number(w.minutes) || 0), 0))
  if (key === 'weekend-long') return Math.round(ws.reduce((m, w) => Math.max(m, Number(w.minutes) || 0), 0))
  return 0
}
const inWindow = (walks, win) => walks.filter((w) => { const t = new Date(w.started_at).getTime(); return t >= win.start && t < win.end })

// Trot's own badges. Earned from saved walks, never stored. Daycare days do not count.
export function lifetimeBadges(walks, tz = 0, now = Date.now()) {
  const ws = walks.filter((w) => w.type !== 'Daycare')
  const miles = r1(ws.reduce((s, w) => s + (Number(w.miles) || 0), 0))
  const streak = bestStreak(new Set(ws.map((w) => dayIndex(new Date(w.started_at).getTime(), tz))))
  const b = (id, name, how, progress, target, unit) => ({ id, name, how, kind: 'lifetime', progress: Math.min(progress, target), target, unit, earned: progress >= target })
  // A personal best needs something to beat: a walk in the last 7 days holds the best top speed of at least two.
  const fast = ws.filter((w) => Number(w.max_speed) > 0).sort((a, z) => Number(z.max_speed) - Number(a.max_speed))
  const pb = fast.length > 1 && now - new Date(fast[0].started_at).getTime() < 7 * DAY ? 1 : 0
  return [
    b('first-sprint', 'First sprint', 'Record a walk with at least one sprint.', ws.some((w) => Number(w.sprints) > 0) ? 1 : 0, 1, 'sprint'),
    b('speed-pb', 'New top speed', 'Set a new all-time top speed in the last 7 days.', pb, 1, 'best'),
    b('first-walk', 'First walk', 'Save one walk.', ws.length, 1, 'walk'),
    b('streak-7', '7-day streak', 'Walk 7 days in a row.', streak, 7, 'days'),
    b('miles-25', '25 miles', 'Cover 25 miles in all.', miles, 25, 'mi'),
    b('miles-100', '100 miles', 'Cover 100 miles in all.', miles, 100, 'mi'),
    b('places-5', '5 places', 'Walk in 5 different places.', places(ws).size, 5, 'places'),
    b('people-3', '3 walkers', 'Get walked by 3 different people.', new Set(ws.map((w) => w.user_id)).size, 3, 'people'),
  ]
}
// Same value, same rank. The next dog after a tie skips the shared places.
export function rank(list) {
  const rows = list.slice().sort((a, b) => b.value - a.value || a.name.localeCompare(b.name) || (a.slug < b.slug ? -1 : 1))
  let last = null, at = 0
  return rows.map((r, i) => { if (r.value !== last) { at = i + 1; last = r.value } return { rank: at, ...r } })
}
export const sizeClass = (weight) => (weight == null ? null : weight < 25 ? 'small' : weight <= 60 ? 'medium' : 'large')
const SIZE_LABEL = { small: 'Small dogs (under 25 lb)', medium: 'Medium dogs (25 to 60 lb)', large: 'Large dogs (over 60 lb)' }
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

export function registerCompete(kit) {
  const { api, db, auth, userFor, dogFor, HttpError, bad, iso, num, firstName, photoUrl, parseRoute, thin, pawCounts, demoOnBoards, walkPhotos } = kit
  const WALK = 'started_at, miles, minutes, place, user_id, type, max_speed, sprints'
  const walksOf = async (dogId, win) => (win
    ? await db.query(`SELECT ${WALK} FROM walks WHERE dog_id = $1 AND started_at >= $2 AND started_at < $3 LIMIT 5000`, [dogId, iso(win.start), iso(win.end)])
    : await db.query(`SELECT ${WALK} FROM walks WHERE dog_id = $1 LIMIT 20000`, [dogId])).rows
  // Dogs that may appear on a board: public, not opted out, and demo dogs only while they are allowed.
  const boardDogs = async () => (await db.query(`SELECT id, slug, name, breed, weight, city, photo_v, is_demo FROM dogs WHERE is_public = TRUE AND leaderboards = TRUE${demoOnBoards ? '' : ' AND is_demo = FALSE'} LIMIT 10000`)).rows
  // Never a person's name or email, only the dog.
  const row = (d, value, mine) => ({ name: d.name, slug: d.slug, breed: d.breed, photoUrl: photoUrl(d.slug, d.photo_v, true), isDemo: !!d.is_demo, value, you: !!mine })
  async function refDog(req) {
    const user = await userFor(req)
    if (!user || req.query.dog === undefined) return { user, dog: null }
    return { user, dog: (await dogFor(String(req.query.dog), user.id)).dog }
  }

  kit.badgesFor = async (dogId, tz) => {
    const all = await walksOf(dogId)
    const out = lifetimeBadges(all, tz)
    const joins = await db.query('SELECT challenge_key, period_key FROM challenge_joins WHERE dog_id = $1 ORDER BY joined_at DESC LIMIT 36', [dogId])
    for (const j of joins.rows) {
      const c = CHALLENGES.find((x) => x.key === j.challenge_key), win = c && windowOfKey(c.window, j.period_key)
      if (!win) continue
      const p = challengeProgress(c.key, inWindow(all, win))
      // Finishing a joined challenge earns its badge for that month or weekend.
      if (p >= c.target) out.push({ id: `challenge:${c.key}:${j.period_key}`, name: `${c.name}, ${win.label}`, how: c.description, kind: 'challenge', progress: c.target, target: c.target, unit: c.unit, earned: true })
    }
    return out
  }

  // -- leaderboards
  api.get('/leaderboards', async (req, res) => {
    const period = req.query.period === undefined ? 'week' : req.query.period
    const metric = req.query.metric === undefined ? 'miles' : req.query.metric
    const scope = req.query.scope === undefined ? 'all' : req.query.scope
    if (!['week', 'month'].includes(period)) throw bad('period must be week or month.')
    if (!['miles', 'minutes', 'outings', 'top_speed'].includes(metric)) throw bad('metric must be miles, minutes, outings or top_speed.')
    if (!['all', 'breed', 'city', 'size'].includes(scope)) throw bad('scope must be all, breed, city or size.')
    const { dog: ref } = await refDog(req)
    const q = (k) => (typeof req.query[k] === 'string' ? req.query[k].trim().slice(0, 60) : '')
    let keep = () => true, scopeLabel = 'All dogs'
    if (scope === 'breed') {
      const breed = q('breed') || (ref && ref.breed) || ''
      if (!breed) throw bad('Add a breed to the profile to see a breed board.')
      keep = (d) => same(d.breed, breed); scopeLabel = breed
    } else if (scope === 'city') {
      const city = q('city') || (ref && ref.city) || ''
      if (!city) throw bad('Add a city to the profile to see a city board.')
      keep = (d) => same(d.city, city); scopeLabel = city
    } else if (scope === 'size') {
      const size = ['small', 'medium', 'large'].includes(q('size')) ? q('size') : ref ? sizeClass(ref.weight == null ? null : num(ref.weight)) : null
      if (!size) throw bad('Add a weight to the profile to see a size board.')
      keep = (d) => sizeClass(d.weight == null ? null : num(d.weight)) === size; scopeLabel = SIZE_LABEL[size]
    }
    const now = Date.now(), win = period === 'week' ? weekWindow(now) : monthWindow(now)
    const dogs = new Map((await boardDogs()).filter(keep).map((d) => [d.id, d]))
    const { rows } = await db.query('SELECT dog_id, miles, minutes, max_speed FROM walks WHERE started_at >= $1 AND started_at < $2 AND type <> $3 LIMIT 100000', [iso(win.start), iso(win.end), 'Daycare'])
    const sum = new Map()
    for (const w of rows) {
      if (!dogs.has(w.dog_id)) continue
      const s = sum.get(w.dog_id) || { miles: 0, minutes: 0, outings: 0, top: 0 }
      s.miles += num(w.miles); s.minutes += num(w.minutes); s.outings += 1; s.top = Math.max(s.top, num(w.max_speed))
      sum.set(w.dog_id, s)
    }
    // Timed sessions have no miles, so the distance board passes them by. The best single-walk top speed is in mph.
    const value = (s) => (metric === 'miles' ? r1(s.miles) : metric === 'minutes' ? Math.round(s.minutes) : metric === 'top_speed' ? r1(s.top) : s.outings)
    const ranked = rank([...sum.entries()].map(([id, s]) => row(dogs.get(id), value(s), ref && ref.id === id)).filter((r) => r.value > 0))
    const mine = ref ? ranked.find((r) => r.you) : null
    let youNote = ''
    if (ref && !mine) youNote = !ref.is_public ? 'private' : !ref.leaderboards ? 'opted_out' : !keep(ref) ? 'not_in_scope' : 'no_walks'
    res.json({
      period: { key: win.key, kind: period, label: win.label, startsAt: iso(win.start), endsAt: iso(win.end) }, metric, scope, scopeLabel,
      total: ranked.length, few: ranked.length < 5, rows: ranked.slice(0, 50), you: mine ? { rank: mine.rank, value: mine.value, inTop: mine.rank <= 50 && ranked.indexOf(mine) < 50 } : null, youNote,
    })
  })

  // -- challenges
  const windowNow = (c, now) => WINDOWS[c.window](now)
  async function joinCounts(now) {
    const n = {}
    for (const c of CHALLENGES) {
      const r = await db.query('SELECT COUNT(*) AS n FROM challenge_joins WHERE challenge_key = $1 AND period_key = $2', [c.key, windowNow(c, now).key])
      n[c.key] = num(r.rows[0].n)
    }
    return n
  }
  const shape = (c, win, now, joinedDogs) => ({
    key: c.key, name: c.name, description: c.description, unit: c.unit, target: c.target, periodKey: win.key, periodLabel: win.label, startsAt: iso(win.start), endsAt: iso(win.end),
    started: now >= win.start, daysLeft: Math.max(0, Math.ceil((win.end - now) / DAY)), startsInDays: Math.max(0, Math.ceil((win.start - now) / DAY)), joinedDogs,
  })
  async function stateFor(c, win, dogId) {
    const j = await db.query('SELECT joined_at FROM challenge_joins WHERE dog_id = $1 AND challenge_key = $2 AND period_key = $3', [dogId, c.key, win.key])
    const progress = challengeProgress(c.key, await walksOf(dogId, win))
    return { joined: !!j.rows[0], progress, percent: Math.min(100, Math.round((progress / c.target) * 100)), completed: progress >= c.target }
  }
  api.get('/challenges', async (req, res) => {
    const { dog } = await refDog(req)
    const now = Date.now(), counts = await joinCounts(now)
    const out = []
    for (const c of CHALLENGES) {
      const win = windowNow(c, now)
      out.push({ ...shape(c, win, now, counts[c.key]), ...(dog ? await stateFor(c, win, dog.id) : {}) })
    }
    res.json({ challenges: out })
  })
  const challengeFor = (key) => { const c = CHALLENGES.find((x) => x.key === key); if (!c) throw new HttpError(404, 'No such challenge.'); return c }
  api.get('/challenges/:key', async (req, res) => {
    const c = challengeFor(req.params.key)
    const { dog } = await refDog(req)
    const now = Date.now(), win = windowNow(c, now)
    const joined = await db.query('SELECT dog_id FROM challenge_joins WHERE challenge_key = $1 AND period_key = $2 LIMIT 2000', [c.key, win.key])
    const ids = new Set(joined.rows.map((r) => r.dog_id))
    const dogs = (await boardDogs()).filter((d) => ids.has(d.id))
    const list = []
    for (const d of dogs.slice(0, 500)) list.push(row(d, challengeProgress(c.key, await walksOf(d.id, win)), dog && dog.id === d.id))
    const ranked = rank(list)
    res.json({ challenge: { ...shape(c, win, now, ids.size), ...(dog ? await stateFor(c, win, dog.id) : {}) }, total: ranked.length, few: ranked.length < 5, rows: ranked.slice(0, 50).map((r) => ({ ...r, completed: r.value >= c.target })) })
  })
  // Joining twice is the same as joining once.
  api.post('/dogs/:slug/challenges/:key', auth, async (req, res) => {
    const c = challengeFor(req.params.key)
    const { dog } = await dogFor(req.params.slug, req.user.id)
    const now = Date.now(), win = windowNow(c, now)
    await db.query('INSERT INTO challenge_joins (dog_id, challenge_key, period_key, joined_at) VALUES ($1, $2, $3, $4) ON CONFLICT (dog_id, challenge_key, period_key) DO NOTHING', [dog.id, c.key, win.key, iso(now)])
    res.json({ challenge: { ...shape(c, win, now, (await joinCounts(now))[c.key]), ...(await stateFor(c, win, dog.id)) } })
  })
  api.delete('/dogs/:slug/challenges/:key', auth, async (req, res) => {
    const c = challengeFor(req.params.key)
    const { dog } = await dogFor(req.params.slug, req.user.id)
    const now = Date.now(), win = windowNow(c, now)
    await db.query('DELETE FROM challenge_joins WHERE dog_id = $1 AND challenge_key = $2 AND period_key = $3', [dog.id, c.key, win.key])
    res.json({ challenge: { ...shape(c, win, now, (await joinCounts(now))[c.key]), ...(await stateFor(c, win, dog.id)) } })
  })

  // -- the pack: recent outings of public dogs, with exactly what their public pages show
  // One shape for every feed of other people's dogs (the pack and the friends feed). First names only, no route unless the dog shares routes.
  kit.PUBLIC_WALK_SQL = 'SELECT w.id, w.dog_id, w.type, w.title, w.note, w.place, w.miles, w.minutes, w.sniffs, w.started_at, w.route, d.slug, d.name AS dog_name, d.breed, d.photo_v, d.is_demo, d.share_routes, u.name AS user_name, m.role FROM walks w JOIN dogs d ON d.id = w.dog_id JOIN users u ON u.id = w.user_id LEFT JOIN memberships m ON m.dog_id = w.dog_id AND m.user_id = w.user_id'
  kit.publicWalksOut = async (page) => {
    const ids = page.map((r) => r.id)
    const { counts } = await pawCounts(ids, null)
    const shots = await walkPhotos(ids, { pub: true })
    return page.map((r) => ({
      id: r.id, dog: { slug: r.slug, name: r.dog_name, breed: r.breed, photoUrl: photoUrl(r.slug, r.photo_v, true), isDemo: !!r.is_demo },
      with: r.role === 'daycare' ? r.user_name : firstName(r.user_name), type: r.type, title: r.title, note: r.note, place: r.place, miles: num(r.miles), minutes: num(r.minutes), sniffs: num(r.sniffs),
      startedAt: iso(r.started_at), paws: counts[r.id] || 0, route: r.share_routes ? thin(parseRoute(r.route), 120) : null, photos: shots[r.id] || [],
    }))
  }
  api.get('/pack', async (req, res) => {
    const user = await userFor(req)
    const own = new Set(user ? (await db.query('SELECT dog_id FROM memberships WHERE user_id = $1', [user.id])).rows.map((r) => r.dog_id) : [])
    const { rows } = await db.query(`${kit.PUBLIC_WALK_SQL} WHERE d.is_public = TRUE ORDER BY w.started_at DESC, w.id DESC LIMIT 80`)
    res.json({ walks: await kit.publicWalksOut(rows.filter((r) => !own.has(r.dog_id)).slice(0, 30)) })
  })

  kit.tzOf = tzOf
}
