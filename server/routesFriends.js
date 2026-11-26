// Dog friends. A dog follows another dog; the app calls the dogs it follows its friends, and when
// both follow each other they are "friends with each other". Registered from app.js with the shared `kit`.
//
// Privacy rules this file keeps:
// - Only PUBLIC dogs can be followed, suggested, searched or shown in a friends feed. A dog that goes
//   private drops out of every list here, exactly like a dog that does not exist.
// - Another dog is only ever described by what its public page already shows: address, name, breed,
//   photo, city, and its last outing with the walker's first name. No emails, no full names, no routes
//   unless that dog shares routes, and nothing about who follows whom beyond the asking dog's own list.
// - The owner and family manage a dog's friends. Walkers and daycare can look but not change them.
export const FRIEND_LIMITS = { perDog: 100, suggestions: 12, search: 10, searchMin: 2, searchMax: 40, feed: 30 }

export function registerFriends(kit) {
  const { api, db, auth, dogFor, HttpError, bad, iso, num, firstName, photoUrl, origin, limiter, limited, R, SLUG_RE } = kit
  const canManage = (role) => role === 'owner' || role === 'family'
  const PUB = 'd.id, d.slug, d.name, d.breed, d.city, d.photo_v, d.is_demo'
  const pubDog = (d) => ({ slug: d.slug, name: d.name, breed: d.breed, photoUrl: photoUrl(d.slug, d.photo_v, true), city: d.city || '', isDemo: !!d.is_demo })
  const NO_DOG = 'No public dog with that address.'
  // The newest outing of each dog, in the words its public page uses.
  async function lastOutings(dogIds) {
    const out = {}
    await Promise.all(dogIds.map(async (id) => {
      const { rows } = await db.query('SELECT w.type, w.title, w.place, w.started_at, u.name AS user_name, m.role FROM walks w JOIN users u ON u.id = w.user_id LEFT JOIN memberships m ON m.dog_id = w.dog_id AND m.user_id = w.user_id WHERE w.dog_id = $1 ORDER BY w.started_at DESC, w.id DESC LIMIT 1', [id])
      const r = rows[0]
      if (r) out[id] = { type: r.type, title: r.title, startedAt: iso(r.started_at), place: r.place, with: r.role === 'daycare' ? r.user_name : firstName(r.user_name) }
    }))
    return out
  }
  const followedIds = async (dogId) => new Set((await db.query('SELECT followed_dog_id FROM dog_follows WHERE follower_dog_id = $1', [dogId])).rows.map((r) => r.followed_dog_id))
  const followerIds = async (dogId) => new Set((await db.query('SELECT follower_dog_id FROM dog_follows WHERE followed_dog_id = $1', [dogId])).rows.map((r) => r.follower_dog_id))
  const newest = (a, b) => (b.lastOuting ? Date.parse(b.lastOuting.startedAt) : 0) - (a.lastOuting ? Date.parse(a.lastOuting.startedAt) : 0) || a.name.localeCompare(b.name) || (a.slug < b.slug ? -1 : 1)
  const manager = (dog, role) => { if (!canManage(role)) throw new HttpError(403, `Only the owner and family can change ${dog.name}'s friends.`) }

  // The dogs this dog follows, newest outing first, and the invite link other people can use to add this dog.
  api.get('/dogs/:slug/friends', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    const { rows } = await db.query(`SELECT ${PUB} FROM dog_follows f JOIN dogs d ON d.id = f.followed_dog_id WHERE f.follower_dog_id = $1 AND d.is_public = TRUE ORDER BY f.created_at DESC LIMIT ${FRIEND_LIMITS.perDog}`, [dog.id])
    const back = await followerIds(dog.id), last = await lastOutings(rows.map((r) => r.id))
    const p = `/d/${dog.slug}?add=1`
    res.json({
      friends: rows.map((d) => ({ ...pubDog(d), lastOuting: last[d.id] || null, mutual: back.has(d.id) })).sort(newest),
      canManage: canManage(role), max: FRIEND_LIMITS.perDog,
      // A private dog has no public page, so there is nothing to send people to.
      invite: dog.is_public ? { path: p, url: origin(req) + p } : null,
    })
  })

  api.put('/dogs/:slug/friends/:otherSlug', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    manager(dog, role)
    const slug = req.params.otherSlug
    const { rows } = SLUG_RE.test(slug) ? await db.query(`SELECT ${PUB} FROM dogs d WHERE d.slug = $1 AND d.is_public = TRUE`, [slug]) : { rows: [] }
    const other = rows[0]
    // A private dog answers exactly like a dog that does not exist.
    if (!other) throw new HttpError(404, NO_DOG)
    if (other.id === dog.id) throw bad('A dog cannot be its own friend.')
    const mine = await followedIds(dog.id)
    if (!mine.has(other.id)) {
      if (mine.size >= FRIEND_LIMITS.perDog) throw bad(`${dog.name} can have up to ${FRIEND_LIMITS.perDog} friends in this trial. Remove one first.`)
      await db.query('INSERT INTO dog_follows (follower_dog_id, followed_dog_id, created_by, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (follower_dog_id, followed_dog_id) DO NOTHING', [dog.id, other.id, req.user.id, iso(Date.now())])
    }
    const back = await db.query('SELECT 1 AS x FROM dog_follows WHERE follower_dog_id = $1 AND followed_dog_id = $2', [other.id, dog.id])
    res.json({ friend: { ...pubDog(other), lastOuting: (await lastOutings([other.id]))[other.id] || null, mutual: !!back.rows[0] }, already: mine.has(other.id) })
  })
  // Removing a friend that is not there is the same as removing one that is. The answer never says
  // whether the other address belongs to a private dog.
  api.delete('/dogs/:slug/friends/:otherSlug', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    manager(dog, role)
    const slug = req.params.otherSlug
    if (!SLUG_RE.test(slug)) throw new HttpError(404, NO_DOG)
    const { rows } = await db.query('SELECT id FROM dogs WHERE slug = $1', [slug])
    if (rows[0]) await db.query('DELETE FROM dog_follows WHERE follower_dog_id = $1 AND followed_dog_id = $2', [dog.id, rows[0].id])
    res.json({ ok: true })
  })

  // Recent outings from the dogs this dog follows, in the same shape as the pack feed.
  api.get('/dogs/:slug/friends/feed', auth, async (req, res) => {
    const { dog } = await dogFor(req.params.slug, req.user.id)
    const ids = [...(await followedIds(dog.id))]
    if (!ids.length) return res.json({ walks: [] })
    const { rows } = await db.query(`${kit.PUBLIC_WALK_SQL} WHERE d.is_public = TRUE AND w.dog_id IN (${ids.map((_, i) => `$${i + 1}`).join(', ')}) ORDER BY w.started_at DESC, w.id DESC LIMIT ${FRIEND_LIMITS.feed}`, ids)
    res.json({ walks: await kit.publicWalksOut(rows) })
  })

  // Public dogs this dog does not follow yet: same city first, then whoever was out most recently.
  // Never this person's own dogs. `followsYou` marks a dog that already added this one.
  api.get('/dogs/:slug/friends/suggestions', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    const own = new Set((await db.query('SELECT dog_id FROM memberships WHERE user_id = $1', [req.user.id])).rows.map((r) => r.dog_id))
    const mine = await followedIds(dog.id), back = await followerIds(dog.id)
    const { rows } = await db.query(`SELECT ${PUB} FROM dogs d WHERE d.is_public = TRUE LIMIT 5000`)
    const act = await db.query('SELECT dog_id, MAX(started_at) AS last FROM walks WHERE started_at >= $1 GROUP BY dog_id', [iso(Date.now() - 90 * 864e5)])
    const last = new Map(act.rows.map((r) => [r.dog_id, new Date(r.last).getTime()]))
    const city = String(dog.city || '').trim().toLowerCase()
    const near = (d) => (city && String(d.city || '').trim().toLowerCase() === city ? 1 : 0)
    const pick = rows.filter((d) => d.id !== dog.id && !own.has(d.id) && !mine.has(d.id))
      .sort((a, b) => near(b) - near(a) || (last.get(b.id) || 0) - (last.get(a.id) || 0) || a.name.localeCompare(b.name) || (a.slug < b.slug ? -1 : 1)).slice(0, FRIEND_LIMITS.suggestions)
    const outs = await lastOutings(pick.map((d) => d.id))
    res.json({ suggestions: pick.map((d) => ({ ...pubDog(d), lastOuting: outs[d.id] || null, mutual: false, followsYou: back.has(d.id), sameCity: !!near(d) })), canManage: canManage(role) })
  })

  // Public dogs whose name starts with what was typed. Signed in, at least 2 characters, at most 10 answers,
  // and a small per-person rate limit so the list of dogs cannot be read out letter by letter at speed.
  const searchLimit = limiter({ windowMs: R.searchWindowMs, max: R.searchMax })
  kit.searchDogs = async (req, res) => {
    const r = searchLimit('user:' + req.user.id)
    if (!r.ok) return limited(res, r)
    const raw = typeof req.query.q === 'string' ? req.query.q : ''
    // % and _ are LIKE wildcards, so they are dropped rather than escaped. Dog names do not need them.
    const q = raw.replace(/[\u0000-\u001F\u007F%_\\]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, FRIEND_LIMITS.searchMax)
    if (q.length < FRIEND_LIMITS.searchMin) throw bad(`Type at least ${FRIEND_LIMITS.searchMin} letters of the dog's name.`)
    let ref = null
    if (req.query.dog !== undefined) ref = (await dogFor(String(req.query.dog), req.user.id)).dog
    const { rows } = await db.query(`SELECT ${PUB} FROM dogs d WHERE d.is_public = TRUE AND LOWER(d.name) LIKE $1 ORDER BY d.name ASC, d.slug ASC LIMIT ${FRIEND_LIMITS.search + 1}`, [q + '%'])
    const mine = ref ? await followedIds(ref.id) : new Set()
    res.json({ dogs: rows.filter((d) => !ref || d.id !== ref.id).slice(0, FRIEND_LIMITS.search).map((d) => ({ ...pubDog(d), ...(ref ? { following: mine.has(d.id) } : {}) })) })
  }
}
