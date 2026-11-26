// Dog friends (follows, feed, suggestions, search, invite link) and photos on outings.
// Loaded by server/index.js under `node --test server/`. Uses its own pg-mem database.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createDb } from './db.js'
import { createApp } from './app.js'
import { FRIEND_LIMITS } from './routesFriends.js'
import { WALK_PHOTO_LIMITS, jpegSize } from './routesPhotos.js'
import { seedDemo, removeDemo, demoId, DEMO_FOLLOWS, DEMO_DOGS } from './seedDemo.js'

let db, server, base
const tag = crypto.randomBytes(4).toString('hex')
const mail = (n) => `${n}-${tag}@example.com`
const RATE = { sessionMax: 100000, writeMax: 100000, readMax: 100000, searchMax: 100000 }

async function listen(app) {
  const s = app.listen(0)
  await new Promise((r) => s.once('listening', r))
  return { s, url: `http://127.0.0.1:${s.address().port}` }
}
before(async () => {
  db = await createDb()
  const l = await listen(createApp({ db, rate: RATE }))
  server = l.s; base = l.url
})
after(async () => {
  await new Promise((r) => server.close(r))
  await db.close()
})

async function call(method, p, { token, body, headers: extra, from = base } = {}) {
  const headers = { ...(extra || {}) }
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(from + p, { method, headers, redirect: 'manual', body: body !== undefined ? JSON.stringify(body) : undefined })
  const buf = Buffer.from(await res.arrayBuffer()), txt = buf.toString('utf8')
  let json = null
  try { json = JSON.parse(txt) } catch (e) {}
  return { status: res.status, json, text: txt, buf, headers: res.headers }
}
const signIn = async (name, n, from = base) => {
  const r = await call('POST', '/api/session', { body: { name, email: mail(n) }, from })
  assert.ok(r.status === 200 || r.status === 201, r.text)
  return { token: r.json.token, id: r.json.user.id, email: mail(n) }
}
const makeDog = async (token, name, extra = {}, from = base) => {
  const r = await call('POST', '/api/dogs', { token, body: { name, breed: 'Mixed', weight: 40, bio: '', ...extra }, from })
  assert.equal(r.status, 201, r.text)
  return r.json.dog
}
const join = async (ownerToken, slug, role, name, n) => {
  const inv = await call('POST', `/api/dogs/${slug}/invites`, { token: ownerToken, body: { role } })
  assert.equal(inv.status, 201, inv.text)
  const u = await signIn(name, n)
  assert.equal((await call('POST', `/api/invites/${inv.json.token}/accept`, { token: u.token })).status, 200)
  return u
}
const ROUTE = [[35.19, -80.84], [35.191, -80.841], [35.192, -80.84], [35.19, -80.84]]
const walk = async (token, slug, extra = {}) => {
  const r = await call('POST', `/api/dogs/${slug}/walks`, { token, body: { type: 'Walk', title: 'Loop', note: 'n', place: 'Somewhere Park', miles: 1.2, minutes: 24, route: ROUTE, ...extra } })
  assert.equal(r.status, 201, r.text)
  return r.json.walk
}
// A small file with a real JPEG frame header. `pad` adds comment segments to reach a size.
function jpeg(w = 1200, h = 900, pad = 0, salt = '') {
  const parts = [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])]
  const note = Buffer.from('trot-test ' + salt)
  const com = (data) => { const head = Buffer.from([0xff, 0xfe, 0, 0]); head.writeUInt16BE(data.length + 2, 2); return Buffer.concat([head, data]) }
  parts.push(com(note))
  for (let left = pad; left > 0; left -= 60000) parts.push(com(Buffer.alloc(Math.min(60000, left), 0x41)))
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01])
  sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7)
  parts.push(sof, Buffer.from([0xff, 0xd9]))
  return Buffer.concat(parts)
}
const dataUrl = (buf, type = 'image/jpeg') => `data:${type};base64,${buf.toString('base64')}`
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)])
const addPhoto = (token, walkId, buf = jpeg(), type) => call('POST', `/api/walks/${walkId}/photos`, { token, body: { photo: dataUrl(buf, type) } })
const follow = (token, slug, other) => call('PUT', `/api/dogs/${slug}/friends/${other}`, { token, body: {} })
const friendsOf = async (token, slug) => { const r = await call('GET', `/api/dogs/${slug}/friends`, { token }); assert.equal(r.status, 200, r.text); return r.json }
const PUBLIC_DOG_KEYS = ['breed', 'city', 'isDemo', 'name', 'photoUrl', 'slug']

// ---- friends ------------------------------------------------------------------
test('follow rules: public dogs only, never itself, the same follow twice is one follow', async () => {
  const a = await signIn('Ada Lovelace-Quimby', 'f1-a'), b = await signIn('Bram Stoker-Vance', 'f1-b')
  const mine = await makeDog(a.token, `Alpha ${tag}`, { city: 'Charlotte, NC' })
  const theirs = await makeDog(b.token, `Bravo ${tag}`, { city: 'Charlotte, NC' })
  const hidden = await makeDog(b.token, `Hidden ${tag}`)
  assert.equal((await call('PATCH', `/api/dogs/${hidden.slug}`, { token: b.token, body: { public: false } })).status, 200)

  assert.equal((await call('GET', `/api/dogs/${mine.slug}/friends`)).status, 401)
  assert.deepEqual((await friendsOf(a.token, mine.slug)).friends, [])

  const ok = await follow(a.token, mine.slug, theirs.slug)
  assert.equal(ok.status, 200, ok.text)
  assert.deepEqual(Object.keys(ok.json.friend).sort(), [...PUBLIC_DOG_KEYS, 'lastOuting', 'mutual'].sort())
  assert.equal(ok.json.friend.mutual, false)
  assert.equal(ok.json.friend.lastOuting, null)
  assert.equal(ok.json.already, false)
  assert.equal((await follow(a.token, mine.slug, theirs.slug)).json.already, true)
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM dog_follows')).rows[0].n >= 1, true)
  assert.equal((await friendsOf(a.token, mine.slug)).friends.length, 1)

  // A private dog and a dog that does not exist give the same answer.
  const priv = await follow(a.token, mine.slug, hidden.slug), none = await follow(a.token, mine.slug, 'no-such-dog-here')
  assert.equal(priv.status, 404); assert.equal(none.status, 404)
  assert.equal(priv.json.error, none.json.error)
  assert.equal((await follow(a.token, mine.slug, 'Not A Slug!')).status, 404)
  assert.equal((await follow(a.token, mine.slug, mine.slug)).status, 400)
  // Somebody else's dog cannot be made to follow anything.
  assert.equal((await follow(a.token, theirs.slug, mine.slug)).status, 403)

  // A followed dog that goes private drops out of the list, and comes back if it is public again.
  assert.equal((await call('PATCH', `/api/dogs/${theirs.slug}`, { token: b.token, body: { public: false } })).status, 200)
  assert.deepEqual((await friendsOf(a.token, mine.slug)).friends, [])
  assert.equal((await call('PATCH', `/api/dogs/${theirs.slug}`, { token: b.token, body: { public: true } })).status, 200)
  assert.equal((await friendsOf(a.token, mine.slug)).friends.length, 1)

  // Removing is the same whether or not the follow was there, and never reveals a private dog.
  assert.deepEqual((await call('DELETE', `/api/dogs/${mine.slug}/friends/${theirs.slug}`, { token: a.token })).json, { ok: true })
  assert.deepEqual((await call('DELETE', `/api/dogs/${mine.slug}/friends/${theirs.slug}`, { token: a.token })).json, { ok: true })
  assert.deepEqual((await call('DELETE', `/api/dogs/${mine.slug}/friends/${hidden.slug}`, { token: a.token })).json, { ok: true })
  assert.deepEqual((await friendsOf(a.token, mine.slug)).friends, [])
})

test('friends are managed by the owner and family; walkers and daycare can look but not change', async () => {
  const owner = await signIn('Olive Owner-Hartley', 'f2-own'), other = await signIn('Otto Other-Mills', 'f2-oth')
  const dog = await makeDog(owner.token, `Roles ${tag}`), target = await makeDog(other.token, `Target ${tag}`), second = await makeDog(other.token, `Second ${tag}`)
  const family = await join(owner.token, dog.slug, 'family', 'Fay Family', 'f2-fam')
  const walker = await join(owner.token, dog.slug, 'walker', 'Wes Walker', 'f2-walk')
  const daycare = await join(owner.token, dog.slug, 'daycare', 'Happy Paws Daycare', 'f2-day')
  const stranger = await signIn('Sam Stranger', 'f2-str')

  for (const u of [walker, daycare]) {
    const r = await follow(u.token, dog.slug, target.slug)
    assert.equal(r.status, 403, r.text)
    assert.match(r.json.error, /owner and family/)
    assert.equal((await call('DELETE', `/api/dogs/${dog.slug}/friends/${target.slug}`, { token: u.token })).status, 403)
  }
  assert.equal((await follow(stranger.token, dog.slug, target.slug)).status, 403)
  assert.equal((await follow(owner.token, dog.slug, target.slug)).status, 200)
  assert.equal((await follow(family.token, dog.slug, second.slug)).status, 200)

  const seenByWalker = await friendsOf(walker.token, dog.slug)
  assert.equal(seenByWalker.friends.length, 2)
  assert.equal(seenByWalker.canManage, false)
  assert.equal((await friendsOf(family.token, dog.slug)).canManage, true)
  assert.equal((await friendsOf(owner.token, dog.slug)).canManage, true)
  for (const p of ['friends', 'friends/feed', 'friends/suggestions']) assert.equal((await call('GET', `/api/dogs/${dog.slug}/${p}`, { token: stranger.token })).status, 403, p)

  assert.equal((await call('DELETE', `/api/dogs/${dog.slug}/friends/${second.slug}`, { token: family.token })).status, 200)
  assert.equal((await friendsOf(owner.token, dog.slug)).friends.length, 1)
})

test('mutual flag, last outing with a first name only, and the invite link', async () => {
  const a = await signIn('Greta Garbanzo-Fielding', 'f3-a'), b = await signIn('Horatio Pemberton-Locke', 'f3-b')
  const one = await makeDog(a.token, `Mutual One ${tag}`), two = await makeDog(b.token, `Mutual Two ${tag}`)
  await walk(b.token, two.slug, { title: 'Creek loop', place: 'Creek Park' })
  await follow(a.token, one.slug, two.slug)
  let list = await friendsOf(a.token, one.slug)
  assert.equal(list.friends[0].mutual, false)
  assert.deepEqual(Object.keys(list.friends[0]).sort(), [...PUBLIC_DOG_KEYS, 'lastOuting', 'mutual'].sort())
  assert.deepEqual(Object.keys(list.friends[0].lastOuting).sort(), ['place', 'startedAt', 'title', 'type', 'with'])
  assert.equal(list.friends[0].lastOuting.with, 'Horatio')
  assert.equal(list.friends[0].lastOuting.title, 'Creek loop')
  assert.match(list.friends[0].photoUrl === null ? '/api/public/' : list.friends[0].photoUrl, /^\/api\/public\//)

  assert.equal((await follow(b.token, two.slug, one.slug)).json.friend.mutual, true)
  list = await friendsOf(a.token, one.slug)
  assert.equal(list.friends[0].mutual, true)
  assert.equal((await friendsOf(b.token, two.slug)).friends[0].mutual, true)
  // One side leaving ends "friends with each other" for both, and the other side still follows.
  await call('DELETE', `/api/dogs/${two.slug}/friends/${one.slug}`, { token: b.token })
  assert.equal((await friendsOf(a.token, one.slug)).friends[0].mutual, false)

  const blob = JSON.stringify(list)
  for (const secret of [b.email, a.email, 'Pemberton', b.id]) assert.ok(!blob.includes(secret), secret)

  // The invite link is the public page with ?add=1. A private dog has none.
  assert.equal(list.invite.path, `/d/${one.slug}?add=1`)
  assert.ok(list.invite.url.endsWith(list.invite.path))
  const page = await call('GET', list.invite.path)
  assert.equal(page.status, 200)
  assert.ok(page.text.includes(`Add Mutual One ${tag} as a friend on Trot`))
  assert.ok(page.text.includes(`href="/?friend=${one.slug}"`))
  const plain = await call('GET', `/d/${one.slug}`)
  assert.ok(!plain.text.includes('as a friend on Trot'))
  assert.equal((await call('PATCH', `/api/dogs/${one.slug}`, { token: a.token, body: { public: false } })).status, 200)
  assert.equal((await friendsOf(a.token, one.slug)).invite, null)
  assert.equal((await call('GET', `/d/${one.slug}?add=1`)).status, 404)
})

test('friends feed: only followed public dogs, in the pack shape, with no private fields', async () => {
  const me = await signIn('Ines Marlowe-Reyes', 'f4-me'), them = await signIn('Jasper Thistlewood-Okafor', 'f4-them')
  const mine = await makeDog(me.token, `Feed Mine ${tag}`)
  const open = await makeDog(them.token, `Feed Open ${tag}`), sharing = await makeDog(them.token, `Feed Sharing ${tag}`), secret = await makeDog(them.token, `Feed Secret ${tag}`), unfollowed = await makeDog(them.token, `Feed Unfollowed ${tag}`)
  assert.equal((await call('PATCH', `/api/dogs/${sharing.slug}`, { token: them.token, body: { shareRoutes: true } })).status, 200)
  const w1 = await walk(them.token, open.slug, { title: 'Open outing' })
  await walk(them.token, sharing.slug, { title: 'Sharing outing' })
  await walk(them.token, secret.slug, { title: 'Secret outing' })
  await walk(them.token, unfollowed.slug, { title: 'Unfollowed outing' })
  assert.equal((await addPhoto(them.token, w1.id)).status, 201)
  for (const d of [open, sharing, secret]) assert.equal((await follow(me.token, mine.slug, d.slug)).status, 200)
  assert.equal((await call('PATCH', `/api/dogs/${secret.slug}`, { token: them.token, body: { public: false } })).status, 200)

  const feed = await call('GET', `/api/dogs/${mine.slug}/friends/feed`, { token: me.token })
  assert.equal(feed.status, 200, feed.text)
  assert.deepEqual(feed.json.walks.map((w) => w.title).sort(), ['Open outing', 'Sharing outing'])
  const pack = await call('GET', '/api/pack', { token: me.token })
  const packWalk = pack.json.walks.find((w) => w.id === w1.id)
  const first = feed.json.walks.find((w) => w.id === w1.id)
  assert.deepEqual(Object.keys(first).sort(), Object.keys(packWalk).sort(), 'same shape as the pack feed')
  assert.deepEqual(Object.keys(first).sort(), ['dog', 'id', 'miles', 'minutes', 'note', 'paws', 'photos', 'place', 'route', 'sniffs', 'startedAt', 'title', 'type', 'with'])
  assert.deepEqual(Object.keys(first.dog).sort(), ['breed', 'isDemo', 'name', 'photoUrl', 'slug'])
  assert.equal(first.with, 'Jasper')
  assert.equal(first.route, null, 'no route unless the dog shares routes')
  assert.ok(Array.isArray(feed.json.walks.find((w) => w.title === 'Sharing outing').route))
  assert.equal(first.photos.length, 1)
  assert.deepEqual(Object.keys(first.photos[0]).sort(), ['h', 'id', 'url', 'w'])
  assert.match(first.photos[0].url, /^\/api\/public\/walks\//)
  for (const s of [them.email, me.email, 'Thistlewood', them.id, 'Secret outing', secret.slug]) assert.ok(!feed.text.includes(s), s)
  // A dog with no friends has an empty feed, not everybody's outings.
  const lonely = await makeDog(me.token, `Feed Lonely ${tag}`)
  assert.deepEqual((await call('GET', `/api/dogs/${lonely.slug}/friends/feed`, { token: me.token })).json.walks, [])
})

test('suggestions: public dogs not yet followed, never your own, same city first, capped', async () => {
  const me = await signIn('Kit Suggest-Harrow', 'f5-me'), them = await signIn('Lou Suggest-Bellweather', 'f5-them')
  const city = `Sugville ${tag}`
  const mine = await makeDog(me.token, `Sug Mine ${tag}`, { city }), sibling = await makeDog(me.token, `Sug Sibling ${tag}`, { city })
  const near = await makeDog(them.token, `Sug Near ${tag}`, { city: city.toUpperCase() }), far = await makeDog(them.token, `Sug Far ${tag}`, { city: 'Elsewhere' })
  const followed = await makeDog(them.token, `Sug Followed ${tag}`, { city }), hidden = await makeDog(them.token, `Sug Hidden ${tag}`, { city })
  await walk(them.token, far.slug) // the far dog is the most recently active, and still comes after the same-city dog
  assert.equal((await call('PATCH', `/api/dogs/${hidden.slug}`, { token: them.token, body: { public: false } })).status, 200)
  await follow(me.token, mine.slug, followed.slug)
  await follow(them.token, near.slug, mine.slug)

  const r = await call('GET', `/api/dogs/${mine.slug}/friends/suggestions`, { token: me.token })
  assert.equal(r.status, 200, r.text)
  const slugs = r.json.suggestions.map((s) => s.slug)
  assert.ok(r.json.suggestions.length <= FRIEND_LIMITS.suggestions)
  for (const no of [mine.slug, sibling.slug, followed.slug, hidden.slug]) assert.ok(!slugs.includes(no), no)
  assert.equal(slugs[0], near.slug, 'the same-city dog leads')
  assert.equal(r.json.suggestions[0].sameCity, true)
  assert.equal(r.json.suggestions[0].followsYou, true)
  assert.deepEqual(Object.keys(r.json.suggestions[0]).sort(), [...PUBLIC_DOG_KEYS, 'followsYou', 'lastOuting', 'mutual', 'sameCity'].sort())
  for (const s of [them.email, 'Bellweather', them.id]) assert.ok(!r.text.includes(s), s)
  // Once followed, a dog leaves the suggestions.
  await follow(me.token, mine.slug, near.slug)
  assert.ok(!(await call('GET', `/api/dogs/${mine.slug}/friends/suggestions`, { token: me.token })).json.suggestions.some((s) => s.slug === near.slug))

  // The cap holds when there are many public dogs.
  for (let i = 0; i < FRIEND_LIMITS.suggestions + 3; i++) await makeDog(them.token, `Sug Crowd ${i} ${tag}`, { city })
  assert.equal((await call('GET', `/api/dogs/${mine.slug}/friends/suggestions`, { token: me.token })).json.suggestions.length, FRIEND_LIMITS.suggestions)
})

test('search: signed in, name prefix, 2 characters or more, 10 at most, public dogs only, rate limited', async () => {
  const me = await signIn('Mina Search-Dunmore', 'f6-me'), them = await signIn('Ned Search-Ashcombe', 'f6-them')
  const word = `zq${tag}`
  const mine = await makeDog(me.token, `${word} mine`)
  for (let i = 0; i < 12; i++) await makeDog(them.token, `${word} dog ${String(i).padStart(2, '0')}`)
  const hidden = await makeDog(them.token, `${word} hidden`)
  assert.equal((await call('PATCH', `/api/dogs/${hidden.slug}`, { token: them.token, body: { public: false } })).status, 200)
  const q = (s, t = me.token, extra = '') => call('GET', `/api/dogs/search?q=${encodeURIComponent(s)}${extra}`, { token: t })

  assert.equal((await call('GET', `/api/dogs/search?q=${word}`)).status, 401)
  for (const short of ['', 'z', ' z ', '%', '%%', '__', 'z%']) assert.equal((await q(short)).status, 400, JSON.stringify(short))
  assert.equal((await call('GET', '/api/dogs/search', { token: me.token })).status, 400)

  const all = await q(word.toUpperCase())
  assert.equal(all.status, 200, all.text)
  assert.equal(all.json.dogs.length, FRIEND_LIMITS.search)
  assert.deepEqual(Object.keys(all.json.dogs[0]).sort(), PUBLIC_DOG_KEYS)
  assert.ok(all.json.dogs.every((d) => d.name.toLowerCase().startsWith(word)))
  assert.ok(!all.text.includes(hidden.slug))
  for (const s of [them.email, 'Ashcombe', them.id]) assert.ok(!all.text.includes(s), s)
  // Prefix, not "contains", and wildcards are not wildcards.
  assert.deepEqual((await q(`dog 0`)).json.dogs.filter((d) => d.name.includes(word)), [])
  assert.deepEqual((await q(`${word.slice(0, 2)}%${word.slice(-2)}`)).json.dogs, [])
  // With ?dog= the asking dog is left out and each answer says whether it is already a friend.
  const one = await q(`${word} dog 03`, me.token, `&dog=${mine.slug}`)
  assert.equal(one.json.dogs.length, 1)
  assert.equal(one.json.dogs[0].following, false)
  await follow(me.token, mine.slug, one.json.dogs[0].slug)
  assert.equal((await q(`${word} dog 03`, me.token, `&dog=${mine.slug}`)).json.dogs[0].following, true)
  assert.ok(!(await q(`${word} m`, me.token, `&dog=${mine.slug}`)).json.dogs.some((d) => d.slug === mine.slug))
  assert.equal((await q(word, them.token, `&dog=${mine.slug}`)).status, 403, 'only for a dog you are on the team of')

  // A dog called Search does not take the address the search endpoint lives at.
  const named = await makeDog(me.token, 'Search')
  assert.notEqual(named.slug, 'search')
  assert.equal((await call('GET', `/api/dogs/${named.slug}`, { token: me.token })).status, 200)

  // Its own small limit per person.
  const tight = await listen(createApp({ db, rate: { ...RATE, searchMax: 3 } }))
  try {
    for (let i = 0; i < 3; i++) assert.equal((await call('GET', `/api/dogs/search?q=${word}`, { token: me.token, from: tight.url })).status, 200)
    const over = await call('GET', `/api/dogs/search?q=${word}`, { token: me.token, from: tight.url })
    assert.equal(over.status, 429)
    assert.ok(Number(over.headers.get('retry-after')) > 0)
    assert.equal((await call('GET', `/api/dogs/search?q=${word}`, { token: them.token, from: tight.url })).status, 200, 'the limit is per person')
  } finally { await new Promise((r) => tight.s.close(r)) }
})

test('demo seed: Charlotte dogs follow each other, Biscuit and Millie are friends with each other', async () => {
  const mem = await createDb()
  const l = await listen(createApp({ db: mem, rate: RATE }))
  try {
    await seedDemo(mem)
    const total = Object.values(DEMO_FOLLOWS).reduce((s, x) => s + x.length, 0)
    const n = async () => Number((await mem.query('SELECT COUNT(*) AS n FROM dog_follows')).rows[0].n)
    assert.equal(await n(), total)
    await seedDemo(mem)
    assert.equal(await n(), total, 'seeding twice changes nothing')
    for (const [slug, list] of Object.entries(DEMO_FOLLOWS)) {
      const from = DEMO_DOGS.find((d) => d.slug === slug)
      assert.ok(from, slug)
      for (const other of list) { assert.notEqual(other, slug); assert.equal(DEMO_DOGS.find((d) => d.slug === other).at, from.at, `${slug} and ${other} are in the same city`) }
    }
    assert.ok(DEMO_FOLLOWS.biscuit.includes('millie') && DEMO_FOLLOWS.millie.includes('biscuit'))
    assert.ok(DEMO_FOLLOWS.biscuit.length >= 3 && DEMO_FOLLOWS.millie.length >= 3)
    const has = async (a, b) => (await mem.query('SELECT 1 AS x FROM dog_follows WHERE follower_dog_id = $1 AND followed_dog_id = $2', [demoId('dog:' + a), demoId('dog:' + b)])).rows.length === 1
    assert.ok(await has('biscuit', 'millie')); assert.ok(await has('millie', 'biscuit'))

    // A real person's dog sees the Charlotte demo dogs as suggestions, labelled as demo dogs, and can follow one.
    const u = await signIn('Vera Visitor', 'f7', l.url)
    const dog = await makeDog(u.token, `Seed Visitor ${tag}`, { city: 'Charlotte, NC' }, l.url)
    const sug = await call('GET', `/api/dogs/${dog.slug}/friends/suggestions`, { token: u.token, from: l.url })
    assert.ok(sug.json.suggestions.length >= 7)
    assert.ok(sug.json.suggestions.slice(0, 7).every((s) => s.city === 'Charlotte, NC' && s.isDemo))
    assert.ok(sug.json.suggestions[0].lastOuting && sug.json.suggestions[0].lastOuting.with)
    assert.ok(!sug.text.includes('example.invalid'))
    assert.equal((await call('PUT', `/api/dogs/${dog.slug}/friends/biscuit`, { token: u.token, body: {}, from: l.url })).status, 200)
    const feed = await call('GET', `/api/dogs/${dog.slug}/friends/feed`, { token: u.token, from: l.url })
    assert.ok(feed.json.walks.length > 0 && feed.json.walks.every((w) => w.dog.slug === 'biscuit'))
    // Seeding again keeps the real person's follow, and removing the demo takes every demo follow with it.
    await seedDemo(mem)
    assert.equal(await n(), total + 1)
    await removeDemo(mem)
    assert.equal(await n(), 0)
  } finally { await new Promise((r) => l.s.close(r)); await mem.close() }
})

// ---- photos on outings -----------------------------------------------------------
test('jpegSize reads the frame header and refuses anything else', () => {
  assert.deepEqual(jpegSize(jpeg(1600, 1200)), { width: 1600, height: 1200 })
  assert.deepEqual(jpegSize(jpeg(3, 5, 130000)), { width: 3, height: 5 })
  assert.equal(jpegSize(PNG), null)
  assert.equal(jpegSize(Buffer.from([0xff, 0xd8, 0xff])), null)
  assert.equal(jpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0])), null)
  assert.equal(jpegSize(jpeg(0, 10)), null)
  assert.equal(jpegSize(Buffer.alloc(0)), null)
})

// One dog with an owner, a family member, two walkers, a daycare and a stranger, plus one saved outing.
async function photoTeam(n, extra) {
  const owner = await signIn('Petra Photo-Ownerson', `${n}-own`)
  const dog = await makeDog(owner.token, `Photo ${n} ${tag}`, extra)
  const family = await join(owner.token, dog.slug, 'family', 'Fay Family', `${n}-fam`)
  const walker = await join(owner.token, dog.slug, 'walker', 'Wes Walker', `${n}-walk`)
  const walker2 = await join(owner.token, dog.slug, 'walker', 'Wendy Walker', `${n}-walk2`)
  const daycare = await join(owner.token, dog.slug, 'daycare', 'Happy Paws Daycare', `${n}-day`)
  const stranger = await signIn('Sam Stranger', `${n}-str`)
  return { owner, family, walker, walker2, daycare, stranger, dog, slug: dog.slug, walk: await walk(walker.token, dog.slug) }
}

test('photo upload: JPEG only, real JPEG bytes, size cap, six per outing', async () => {
  const t = await photoTeam('p1')
  const id = t.walk.id
  assert.deepEqual(t.walk.photos, [], 'a new outing starts with an empty list')

  const ok = await addPhoto(t.walker.token, id, jpeg(1600, 1200))
  assert.equal(ok.status, 201, ok.text)
  assert.deepEqual(Object.keys(ok.json.photo).sort(), ['h', 'id', 'mine', 'url', 'w'])
  assert.equal(ok.json.photo.w, 1600); assert.equal(ok.json.photo.h, 1200)
  assert.match(ok.json.photo.url, new RegExp(`^/api/walks/${id}/photos/[0-9a-f-]{36}\\?v=[a-f0-9]{16}$`))
  assert.equal(ok.json.count, 1); assert.equal(ok.json.max, WALK_PHOTO_LIMITS.perWalk)
  const row = (await db.query('SELECT width, height, bytes, hash, added_by FROM walk_photos WHERE id = $1', [ok.json.photo.id])).rows[0]
  assert.equal(row.added_by, t.walker.id); assert.equal(Number(row.bytes), jpeg(1600, 1200).length)

  // Wrong type, a PNG wearing a JPEG label, junk, and things that are not data URLs at all.
  for (const [what, body] of [
    ['png', { photo: dataUrl(PNG, 'image/png') }], ['webp label', { photo: dataUrl(jpeg(), 'image/webp') }], ['png bytes as jpeg', { photo: dataUrl(PNG) }],
    ['text as jpeg', { photo: dataUrl(Buffer.from('<script>alert(1)</script>')) }], ['no frame header', { photo: dataUrl(Buffer.from([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4, 5, 6, 7, 8])) }],
    ['bad base64', { photo: 'data:image/jpeg;base64,@@@@' }], ['empty', { photo: 'data:image/jpeg;base64,' }], ['a link', { photo: 'https://example.com/a.jpg' }], ['missing', {}], ['number', { photo: 7 }],
    ['svg', { photo: dataUrl(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml') }], ['huge sides', { photo: dataUrl(jpeg(WALK_PHOTO_LIMITS.maxSide + 1, 10)) }],
  ]) {
    const r = await call('POST', `/api/walks/${id}/photos`, { token: t.owner.token, body })
    assert.equal(r.status, 400, `${what}: ${r.text}`)
  }
  // Just under the cap is fine. Just over it, and far over it, are both refused as too large.
  const fits = await addPhoto(t.owner.token, id, jpeg(800, 600, WALK_PHOTO_LIMITS.bytes - 300, 'fits'))
  assert.equal(fits.status, 201, fits.text)
  const over = await addPhoto(t.owner.token, id, jpeg(800, 600, WALK_PHOTO_LIMITS.bytes + 200, 'over'))
  assert.equal(over.status, 413, over.text)
  assert.match(over.json.error, /700 KB/)
  assert.equal((await addPhoto(t.owner.token, id, jpeg(800, 600, 3 * 1024 * 1024, 'far over'))).status, 413)
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM walk_photos WHERE walk_id = $1', [id])).rows[0].n), 2)

  // Six per outing.
  for (let i = 2; i < WALK_PHOTO_LIMITS.perWalk; i++) assert.equal((await addPhoto(t.family.token, id, jpeg(640, 480, 0, 'n' + i))).status, 201)
  const full = await addPhoto(t.owner.token, id, jpeg(640, 480, 0, 'seventh'))
  assert.equal(full.status, 400, full.text)
  assert.match(full.json.error, /up to 6 photos/)
  // Deleting one makes room again.
  assert.equal((await call('DELETE', `/api/walks/${id}/photos/${ok.json.photo.id}`, { token: t.walker.token })).status, 200)
  assert.equal((await addPhoto(t.owner.token, id, jpeg(640, 480, 0, 'again'))).status, 201)
})

test('photo permissions: the care team adds and views, the uploader, owner and family delete', async () => {
  const t = await photoTeam('p2')
  const id = t.walk.id
  assert.equal((await call('POST', `/api/walks/${id}/photos`, { body: { photo: dataUrl(jpeg()) } })).status, 401)
  // Not on the team: the same 404 as an outing that does not exist.
  const no = await addPhoto(t.stranger.token, id), missing = await addPhoto(t.stranger.token, crypto.randomUUID())
  assert.equal(no.status, 404); assert.equal(missing.status, 404); assert.equal(no.json.error, missing.json.error)
  const made = {}
  for (const who of ['owner', 'family', 'walker', 'walker2', 'daycare']) {
    const r = await addPhoto(t[who].token, id, jpeg(900, 700, 0, who))
    assert.equal(r.status, 201, `${who}: ${r.text}`)
    made[who] = r.json.photo
  }
  // Viewing follows the outing: team only on the signed-in address.
  const path = made.owner.url
  assert.equal((await call('GET', path)).status, 401)
  assert.equal((await call('GET', path, { token: t.stranger.token })).status, 404)
  const got = await call('GET', path, { token: t.daycare.token })
  assert.equal(got.status, 200)
  assert.equal(got.headers.get('content-type'), 'image/jpeg')
  assert.ok(got.buf.equals(jpeg(900, 700, 0, 'owner')), 'the stored bytes come back unchanged')
  assert.equal(got.headers.get('cache-control'), 'private, max-age=300', 'the signed-in copy is private and short-lived')
  assert.match(got.headers.get('vary') || '', /Authorization/i)
  assert.match(got.headers.get('content-security-policy'), /sandbox/)
  assert.equal(got.headers.get('x-content-type-options'), 'nosniff')
  const hash = /v=([a-f0-9]+)/.exec(path)[1]
  assert.equal(got.headers.get('etag'), `"${hash}"`)
  assert.equal((await call('GET', path, { token: t.daycare.token, headers: { 'if-none-match': `"${hash}"` } })).status, 304)
  assert.equal((await call('GET', `/api/walks/${id}/photos/${crypto.randomUUID()}`, { token: t.owner.token })).status, 404)
  assert.equal((await call('GET', `/api/walks/${id}/photos/nope`, { token: t.owner.token })).status, 404)
  // A photo cannot be reached through another outing's address.
  const other = await walk(t.owner.token, t.slug)
  assert.equal((await call('GET', `/api/walks/${other.id}/photos/${made.owner.id}`, { token: t.owner.token })).status, 404)
  assert.equal((await call('DELETE', `/api/walks/${other.id}/photos/${made.owner.id}`, { token: t.owner.token })).status, 404)

  // The detail view says which photos are the viewer's own. Lists do not carry that.
  const detail = await call('GET', `/api/walks/${id}`, { token: t.walker.token })
  assert.equal(detail.json.walk.photos.length, 5)
  assert.deepEqual(detail.json.walk.photos.filter((p) => p.mine).map((p) => p.id), [made.walker.id])

  const del = (who, photo) => call('DELETE', `/api/walks/${id}/photos/${photo.id}`, { token: t[who].token })
  assert.equal((await call('DELETE', `/api/walks/${id}/photos/${made.owner.id}`)).status, 401)
  assert.equal((await del('stranger', made.owner)).status, 404)
  // A walker or the daycare cannot delete somebody else's photo.
  for (const who of ['walker', 'daycare']) { const r = await del(who, made.owner); assert.equal(r.status, 403, who); assert.match(r.json.error, /owner or family/) }
  assert.equal((await del('walker', made.walker2)).status, 403)
  assert.equal((await del('walker2', made.walker2)).status, 200, 'the uploader')
  assert.equal((await del('daycare', made.daycare)).status, 200, 'the uploader')
  assert.equal((await del('family', made.walker)).status, 200, 'family')
  const last = await del('owner', made.family)
  assert.equal(last.status, 200, 'owner')
  assert.equal(last.json.count, 1)
  assert.equal((await del('owner', made.family)).status, 404, 'already gone')
  assert.equal((await call('GET', made.family.url, { token: t.owner.token })).status, 404)

  // Deleting the outing takes its photos with it.
  assert.equal((await call('DELETE', `/api/walks/${id}`, { token: t.owner.token })).status, 200)
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM walk_photos WHERE walk_id = $1', [id])).rows[0].n), 0)
  assert.equal((await call('GET', made.owner.url, { token: t.owner.token })).status, 404)
})

test('public serving: only for public dogs, with cache headers keyed on the hash', async () => {
  const t = await photoTeam('p3')
  const id = t.walk.id
  const p = (await addPhoto(t.owner.token, id, jpeg(1000, 800, 0, 'pub'))).json.photo
  const pub = p.url.replace('/api/walks/', '/api/public/walks/')
  const got = await call('GET', pub)
  assert.equal(got.status, 200)
  assert.equal(got.headers.get('content-type'), 'image/jpeg')
  assert.equal(got.headers.get('cache-control'), 'public, max-age=604800, immutable')
  assert.ok(got.buf.equals(jpeg(1000, 800, 0, 'pub')))
  const hash = /v=([a-f0-9]+)/.exec(pub)[1]
  assert.equal(got.headers.get('etag'), `"${hash}"`)
  assert.equal((await call('GET', pub, { headers: { 'if-none-match': `"${hash}"` } })).status, 304)
  assert.equal((await call('GET', pub.replace(hash, 'abcdef0123456789'))).headers.get('cache-control'), 'public, max-age=300', 'a wrong hash is not cached for long')
  for (const bad of [`/api/public/walks/${id}/photos/${crypto.randomUUID()}`, `/api/public/walks/${crypto.randomUUID()}/photos/${p.id}`, `/api/public/walks/x/photos/y`]) assert.equal((await call('GET', bad)).status, 404, bad)

  // The public page and the public JSON show the photo.
  const page = await call('GET', `/d/${t.slug}`)
  assert.equal(page.status, 200)
  assert.ok(page.text.includes(`src="${pub.replace(/&/g, '&amp;')}"`), 'the page links the public address')
  assert.ok(!page.text.includes(`"/api/walks/${id}`), 'never the signed-in address')
  assert.match(page.headers.get('content-security-policy'), /img-src 'self'/)
  const json = await call('GET', `/api/public/dogs/${t.slug}`)
  assert.deepEqual(json.json.dog.walks[0].photos, [{ id: p.id, url: pub, w: 1000, h: 800 }])

  // Private dog: the public address answers exactly like a missing photo, and the team still sees it.
  assert.equal((await call('PATCH', `/api/dogs/${t.slug}`, { token: t.owner.token, body: { public: false } })).status, 200)
  const gone = await call('GET', pub), never = await call('GET', `/api/public/walks/${id}/photos/${crypto.randomUUID()}`)
  assert.equal(gone.status, 404); assert.equal(gone.text, never.text)
  assert.equal((await call('GET', `/d/${t.slug}`)).status, 404)
  assert.equal((await call('GET', p.url, { token: t.walker.token })).status, 200)
  assert.ok(!(await call('GET', '/api/pack')).text.includes(p.id))
})

test('photos in feed shapes: first three in lists, all in detail, public addresses in public feeds', async () => {
  const t = await photoTeam('p4')
  const id = t.walk.id
  const ids = []
  for (let i = 0; i < 5; i++) ids.push((await addPhoto(t.owner.token, id, jpeg(700 + i, 500, 0, 'shape' + i))).json.photo.id)
  const bare = await walk(t.owner.token, t.slug, { title: 'No photos here' })

  const LIST_KEYS = ['h', 'id', 'url', 'w']
  const check = (w, n, prefix, keys = LIST_KEYS) => {
    assert.equal(w.photos.length, n)
    assert.deepEqual(w.photos.map((p) => p.id), ids.slice(0, n), 'oldest first')
    for (const p of w.photos) { assert.deepEqual(Object.keys(p).sort(), keys); assert.ok(p.url.startsWith(prefix), p.url); assert.equal(p.h, 500) }
    assert.equal(w.photos[0].w, 700)
  }
  const feed = await call('GET', `/api/feed?dog=${t.slug}`, { token: t.walker.token })
  check(feed.json.walks.find((w) => w.id === id), 3, `/api/walks/${id}/photos/`)
  assert.deepEqual(feed.json.walks.find((w) => w.id === bare.id).photos, [])
  check((await call('GET', '/api/feed', { token: t.owner.token })).json.walks.find((w) => w.id === id), 3, `/api/walks/${id}/photos/`)
  const dog = await call('GET', `/api/dogs/${t.slug}`, { token: t.owner.token })
  check(dog.json.walks.find((w) => w.id === id), 3, `/api/walks/${id}/photos/`)
  const person = await call('GET', `/api/dogs/${t.slug}/members/${t.walker.id}`, { token: t.owner.token })
  check(person.json.walks.find((w) => w.id === id), 3, `/api/walks/${id}/photos/`)
  check((await call('GET', `/api/walks/${id}`, { token: t.owner.token })).json.walk, 5, `/api/walks/${id}/photos/`, ['h', 'id', 'mine', 'url', 'w'])

  const pack = await call('GET', '/api/pack')
  check(pack.json.walks.find((w) => w.id === id), 3, `/api/public/walks/${id}/photos/`)
  const pub = await call('GET', `/api/public/dogs/${t.slug}`)
  const pw = pub.json.dog.walks.find((w) => w.photos.length)
  assert.equal(pw.photos.length, 5)
  assert.ok(pw.photos.every((p) => p.url.startsWith(`/api/public/walks/${id}/photos/`)))
  const page = await call('GET', `/d/${t.slug}`)
  assert.equal((page.text.match(/<img src="\/api\/public\/walks\//g) || []).length, 5)
  assert.ok(page.text.includes('Photo 1 of 5'))

  const fan = await signIn('Fern Follower', 'p4-fan'), fanDog = await makeDog(fan.token, `Fan ${tag}`)
  await follow(fan.token, fanDog.slug, t.slug)
  check((await call('GET', `/api/dogs/${fanDog.slug}/friends/feed`, { token: fan.token })).json.walks.find((w) => w.id === id), 3, `/api/public/walks/${id}/photos/`)
  // Every address a list hands out really serves the picture.
  assert.equal((await call('GET', pack.json.walks.find((w) => w.id === id).photos[0].url)).status, 200)
  assert.equal((await call('GET', feed.json.walks.find((w) => w.id === id).photos[0].url, { token: t.walker.token })).status, 200)
})
