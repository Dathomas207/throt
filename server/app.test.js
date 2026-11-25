// Run with: node --test server/
// Uses pg-mem unless DATABASE_URL points at a real Postgres.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDb, migrate, addColumns } from './db.js'
import { createApp, LIMITS, slugify } from './app.js'
import { esc } from './publicPage.js'

let db, server, base, staticDir
const tag = crypto.randomBytes(4).toString('hex')
const mail = (n) => `${n}-${tag}@example.com`

async function listen(app) {
  const s = app.listen(0)
  await new Promise((r) => s.once('listening', r))
  return { s, url: `http://127.0.0.1:${s.address().port}` }
}
before(async () => {
  db = await createDb()
  staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trot-static-'))
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!DOCTYPE html><title>Trot</title><div id="root">app shell</div>')
  fs.writeFileSync(path.join(staticDir, 'icon-192.png'), 'png')
  const l = await listen(createApp({ db, staticDir, rate: { sessionMax: 1000, writeMax: 100000, readMax: 100000 } }))
  server = l.s; base = l.url
})
after(async () => {
  await new Promise((r) => server.close(r))
  await db.close()
  fs.rmSync(staticDir, { recursive: true, force: true })
})

async function call(method, p, { token, body, raw, from = base } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined || raw !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(from + p, { method, headers, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined })
  const txt = await res.text()
  let json = null
  try { json = JSON.parse(txt) } catch (e) {}
  return { status: res.status, json, text: txt, headers: res.headers }
}
const signIn = async (name, n) => {
  const r = await call('POST', '/api/session', { body: { name, email: mail(n) } })
  assert.ok(r.status === 200 || r.status === 201, r.text)
  return { token: r.json.token, id: r.json.user.id, status: r.status }
}
const makeDog = async (token, name, extra = {}) => {
  const r = await call('POST', '/api/dogs', { token, body: { name, breed: 'Golden Retriever', weight: 68, bio: 'Swims in anything.', ...extra } })
  assert.equal(r.status, 201, r.text)
  return r.json.dog
}
const walk = (over = {}) => ({ type: 'Walk', title: 'Morning loop', note: 'Found the good stick.', place: 'Fresh Pond', miles: 1.5, minutes: 30, sniffs: 4, route: [[42.385, -71.149], [42.386, -71.148], [42.387, -71.147]], ...over })

test('health check answers and reports the database kind', async () => {
  const r = await call('GET', '/healthz')
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  const h = await call('GET', '/api/health')
  assert.deepEqual(h.json, { ok: true, service: 'trot' })
})

test('sign-in creates a user, finds the same user again, and only a hash of the token is stored', async () => {
  const a = await call('POST', '/api/session', { body: { name: 'Dale Thomas', email: `  ${mail('dale').toUpperCase()} ` } })
  assert.equal(a.status, 201)
  assert.equal(a.json.user.email, mail('dale'))
  assert.ok(a.json.token.length >= 40)
  const b = await call('POST', '/api/session', { body: { name: 'Someone Else', email: mail('dale') } })
  assert.equal(b.status, 200)
  assert.equal(b.json.user.id, a.json.user.id)
  assert.equal(b.json.user.name, 'Dale Thomas', 'an existing name is not overwritten')
  assert.notEqual(b.json.token, a.json.token)

  const me = await call('GET', '/api/me', { token: a.json.token })
  assert.equal(me.status, 200)
  assert.equal(me.json.user.name, 'Dale Thomas')
  assert.deepEqual(me.json.dogs, [])

  const stored = await db.query('SELECT token_hash FROM sessions WHERE user_id = $1', [a.json.user.id])
  assert.equal(stored.rows.length, 2)
  for (const row of stored.rows) {
    assert.match(row.token_hash, /^[0-9a-f]{64}$/)
    assert.notEqual(row.token_hash, a.json.token)
    assert.notEqual(row.token_hash, b.json.token)
  }
  assert.ok(stored.rows.some((r) => r.token_hash === crypto.createHash('sha256').update(a.json.token).digest('hex')))

  assert.equal((await call('GET', '/api/me')).status, 401)
  assert.equal((await call('GET', '/api/me', { token: 'x'.repeat(43) })).status, 401)
  assert.equal((await call('GET', '/api/me', { token: 'short' })).status, 401)

  const out = await call('DELETE', '/api/session', { token: b.json.token })
  assert.equal(out.status, 200)
  assert.equal((await call('GET', '/api/me', { token: b.json.token })).status, 401, 'a signed-out token stops working')
  assert.equal((await call('GET', '/api/me', { token: a.json.token })).status, 200, 'other sessions keep working')
})

test('an expired session is rejected', async () => {
  const u = await signIn('Expired Person', 'expired')
  await db.query('UPDATE sessions SET expires_at = $1 WHERE user_id = $2', [new Date(Date.now() - 1000).toISOString(), u.id])
  assert.equal((await call('GET', '/api/me', { token: u.token })).status, 401)
})

test('creating a dog makes the creator the owner, public by default, routes not shared', async () => {
  const u = await signIn('Owner One', 'own1')
  const dog = await makeDog(u.token, `Biscuit ${tag}`)
  assert.equal(dog.slug, `biscuit-${tag}`)
  assert.equal(dog.role, 'owner')
  assert.equal(dog.public, true)
  assert.equal(dog.shareRoutes, false)
  assert.equal(dog.weight, 68)
  const me = await call('GET', '/api/me', { token: u.token })
  assert.deepEqual(me.json.dogs.map((d) => [d.slug, d.role]), [[`biscuit-${tag}`, 'owner']])
  const withBirthday = await makeDog(u.token, `Pup ${tag}`, { birthday: '2021-05-30' })
  assert.equal(withBirthday.birthday, '2021-05-30')
  assert.match(withBirthday.age, /yrs$/)
  assert.equal((await call('POST', '/api/dogs', { body: { name: 'No auth' } })).status, 401)
})

test('slug collision adds a numeric suffix', async () => {
  const a = await signIn('Collide A', 'cola')
  const b = await signIn('Collide B', 'colb')
  const d1 = await makeDog(a.token, `Rex ${tag}`)
  const d2 = await makeDog(b.token, `Rex ${tag}`)
  const d3 = await makeDog(a.token, `REX!! ${tag}`)
  assert.equal(d1.slug, `rex-${tag}`)
  assert.equal(d2.slug, `rex-${tag}-2`)
  assert.equal(d3.slug, `rex-${tag}-3`)
  // Two at once must both succeed with different slugs.
  const [p, q] = await Promise.all([makeDog(a.token, `Race ${tag}`), makeDog(b.token, `Race ${tag}`)])
  assert.notEqual(p.slug, q.slug)
  assert.equal(slugify('  Señor Wüf!! '), 'senor-wuf')
  assert.equal(slugify('<script>alert(1)</script>'), 'script-alert-1-script')
  assert.equal(slugify('!!!'), 'dog')
})

test('a non-member gets 403 on a dog, and a non-owner member cannot change it', async () => {
  const owner = await signIn('Owner Two', 'own2')
  const stranger = await signIn('Stranger', 'stranger')
  const dog = await makeDog(owner.token, `Moose ${tag}`)
  const p = `/api/dogs/${dog.slug}`
  assert.equal((await call('GET', p, { token: stranger.token })).status, 403)
  assert.equal((await call('PATCH', p, { token: stranger.token, body: { bio: 'mine now' } })).status, 403)
  assert.equal((await call('POST', `${p}/walks`, { token: stranger.token, body: walk() })).status, 403)
  assert.equal((await call('POST', `${p}/invites`, { token: stranger.token, body: {} })).status, 403)
  assert.equal((await call('GET', `/api/feed?dog=${dog.slug}`, { token: stranger.token })).status, 403)
  assert.equal((await call('GET', p)).status, 401)
  assert.equal((await call('GET', `/api/dogs/no-such-dog-${tag}`, { token: stranger.token })).status, 404)

  const walker = await signIn('Walker Two', 'walk2')
  const inv = await call('POST', `${p}/invites`, { token: owner.token, body: { role: 'walker' } })
  assert.equal((await call('POST', `/api/invites/${inv.json.token}/accept`, { token: walker.token })).status, 200)
  assert.equal((await call('GET', p, { token: walker.token })).status, 200)
  assert.equal((await call('PATCH', p, { token: walker.token, body: { public: false } })).status, 403)
  assert.equal((await call('POST', `${p}/invites`, { token: walker.token, body: {} })).status, 403)

  const ok = await call('PATCH', p, { token: owner.token, body: { bio: 'New bio', share_routes: true, public: false } })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.dog.bio, 'New bio')
  assert.equal(ok.json.dog.shareRoutes, true)
  assert.equal(ok.json.dog.public, false)
  assert.equal(ok.json.dog.slug, dog.slug)
})

test('invite create and accept: single use, 14 days, no emails in the team', async () => {
  const owner = await signIn('Olive Owner', 'inv-owner')
  const pat = await signIn('Pat Walker', 'inv-pat')
  const sue = await signIn('Sue Neighbor', 'inv-sue')
  const dog = await makeDog(owner.token, `Juno ${tag}`)
  const inv = await call('POST', `/api/dogs/${dog.slug}/invites`, { token: owner.token, body: { role: 'family' } })
  assert.equal(inv.status, 201)
  assert.equal(inv.json.role, 'family')
  assert.equal(inv.json.path, `/?invite=${inv.json.token}`)
  assert.ok(inv.json.url.endsWith(inv.json.path))
  const days = (new Date(inv.json.expiresAt).getTime() - Date.now()) / 864e5
  assert.ok(days > 13.9 && days <= 14, `expires in ${days} days`)
  const stored = await db.query('SELECT token_hash FROM invites WHERE dog_id IN (SELECT id FROM dogs WHERE slug = $1)', [dog.slug])
  assert.notEqual(stored.rows[0].token_hash, inv.json.token, 'only a hash of the invite token is stored')

  const peek = await call('GET', `/api/invites/${inv.json.token}`)
  assert.deepEqual(peek.json, { dogName: `Juno ${tag}`, role: 'family', open: true })
  assert.equal((await call('POST', `/api/invites/${inv.json.token}/accept`)).status, 401)

  const acc = await call('POST', `/api/invites/${inv.json.token}/accept`, { token: pat.token })
  assert.equal(acc.status, 200)
  assert.deepEqual(acc.json, { dog: { slug: dog.slug, name: `Juno ${tag}` }, role: 'family', already: false })
  const again = await call('POST', `/api/invites/${inv.json.token}/accept`, { token: pat.token })
  assert.equal(again.status, 200)
  assert.equal(again.json.already, true)
  assert.equal((await call('POST', `/api/invites/${inv.json.token}/accept`, { token: sue.token })).status, 410, 'a used invite cannot be used by someone else')
  assert.equal((await call('GET', `/api/invites/${inv.json.token}`)).json.open, false)
  assert.equal((await call('POST', `/api/invites/${'z'.repeat(43)}/accept`, { token: sue.token })).status, 404)
  assert.equal((await call('POST', `/api/dogs/${dog.slug}/invites`, { token: owner.token, body: { role: 'owner' } })).status, 400)

  const old = await call('POST', `/api/dogs/${dog.slug}/invites`, { token: owner.token, body: {} })
  assert.equal(old.json.role, 'walker')
  await db.query('UPDATE invites SET expires_at = $1 WHERE token_hash = $2', [new Date(Date.now() - 1000).toISOString(), crypto.createHash('sha256').update(old.json.token).digest('hex')])
  assert.equal((await call('POST', `/api/invites/${old.json.token}/accept`, { token: sue.token })).status, 410, 'an expired invite is refused')

  const d = await call('GET', `/api/dogs/${dog.slug}`, { token: pat.token })
  assert.equal(d.status, 200)
  assert.deepEqual(d.json.team.map((m) => [m.name, m.role, m.you]), [['Olive Owner', 'owner', false], ['Pat Walker', 'family', true]])
  assert.equal(d.json.dog.role, 'family')
  assert.ok(!d.text.includes('@'), 'no email address anywhere in the dog response')
  const me = await call('GET', '/api/me', { token: pat.token })
  assert.deepEqual(me.json.dogs.map((x) => x.slug), [dog.slug])
})

test('a posted walk shows in the feed, newest first, with correct weekly per-person totals', async () => {
  const owner = await signIn('Dana Owner', 'feed-owner')
  const pat = await signIn('Pat Walker', 'feed-pat')
  const outsider = await signIn('Other Person', 'feed-out')
  const dog = await makeDog(owner.token, `Pickle ${tag}`)
  const other = await makeDog(outsider.token, `Elsewhere ${tag}`)
  const inv = await call('POST', `/api/dogs/${dog.slug}/invites`, { token: owner.token, body: { role: 'walker' } })
  await call('POST', `/api/invites/${inv.json.token}/accept`, { token: pat.token })
  const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString()
  const post = async (token, slug, over) => { const r = await call('POST', `/api/dogs/${slug}/walks`, { token, body: walk(over) }); assert.equal(r.status, 201, r.text); return r.json.walk }

  const w1 = await post(owner.token, dog.slug, { title: 'Owner one', miles: 1.5, minutes: 30, startedAt: ago(50) })
  const w2 = await post(owner.token, dog.slug, { title: 'Owner two', miles: 1, minutes: 20.5, startedAt: ago(26) })
  const w3 = await post(pat.token, dog.slug, { title: 'Pat one', type: 'Hike', miles: 2.25, minutes: 45, startedAt: ago(2) })
  const oldWalk = await post(owner.token, dog.slug, { title: 'Ten days ago', miles: 4, minutes: 100, startedAt: ago(240) })
  await post(outsider.token, other.slug, { title: 'Not your dog', startedAt: ago(1) })
  const noStart = await post(pat.token, dog.slug, { title: 'No start given', miles: 0, minutes: 10, route: null })
  assert.ok(Math.abs(new Date(noStart.startedAt).getTime() - (Date.now() - 600e3)) < 30e3, 'startedAt defaults to now minus the duration')
  assert.equal(noStart.route, null)
  assert.deepEqual(w1.route, [[42.385, -71.149], [42.386, -71.148], [42.387, -71.147]])
  assert.equal(w3.by.name, 'Pat Walker')
  assert.equal(w3.dog.slug, dog.slug)

  const feed = await call('GET', '/api/feed', { token: owner.token })
  assert.equal(feed.status, 200)
  assert.deepEqual(feed.json.walks.map((w) => w.title), ['No start given', 'Pat one', 'Owner two', 'Owner one', 'Ten days ago'])
  assert.equal(feed.json.nextCursor, null)
  assert.ok(!feed.text.includes('@'), 'no email address in the feed')
  assert.equal(feed.json.walks[1].by.you, false)
  assert.equal(feed.json.walks[2].by.you, true)

  // Pagination: two pages of two and one of one, no repeats.
  const seen = []
  let cursor = null, pages = 0
  do {
    const page = await call('GET', `/api/feed?limit=2${cursor ? `&cursor=${cursor}` : ''}`, { token: pat.token })
    assert.equal(page.status, 200)
    seen.push(...page.json.walks.map((w) => w.id))
    cursor = page.json.nextCursor
    pages += 1
  } while (cursor && pages < 10)
  assert.equal(pages, 3)
  assert.deepEqual(seen, [noStart.id, w3.id, w2.id, w1.id, oldWalk.id])
  assert.equal((await call('GET', '/api/feed?limit=0', { token: pat.token })).status, 400)
  assert.equal((await call('GET', '/api/feed?limit=51', { token: pat.token })).status, 400)
  assert.equal((await call('GET', '/api/feed?cursor=nonsense', { token: pat.token })).status, 400)
  const outFeed = await call('GET', '/api/feed', { token: outsider.token })
  assert.deepEqual(outFeed.json.walks.map((w) => w.title), ['Not your dog'])
  assert.equal((await call('GET', '/api/feed')).status, 401)

  const d = await call('GET', `/api/dogs/${dog.slug}`, { token: owner.token })
  const byName = Object.fromEntries(d.json.team.map((m) => [m.name, m.week]))
  assert.deepEqual(byName['Dana Owner'], { outings: 2, miles: 2.5, minutes: 50.5 })
  assert.deepEqual(byName['Pat Walker'], { outings: 2, miles: 2.25, minutes: 55 })
  assert.deepEqual(d.json.totals.week, { outings: 4, miles: 4.75, minutes: 105.5 })
  assert.deepEqual(d.json.totals.lifetime, { outings: 5, miles: 8.75, minutes: 205.5 })
  assert.equal(d.json.weekWalks.length, 4)
  assert.equal(d.json.walks.length, 5)

  // A walk is readable by members only. Others get the same 404 as a missing walk.
  assert.equal((await call('GET', `/api/walks/${w1.id}`, { token: pat.token })).status, 200)
  assert.equal((await call('GET', `/api/walks/${w1.id}`, { token: outsider.token })).status, 404)
  assert.equal((await call('GET', `/api/walks/${crypto.randomUUID()}`, { token: pat.token })).status, 404)
})

test('paw add and remove are idempotent', async () => {
  const owner = await signIn('Paw Owner', 'paw-owner')
  const pat = await signIn('Paw Pat', 'paw-pat')
  const outsider = await signIn('Paw Outsider', 'paw-out')
  const dog = await makeDog(owner.token, `Paws ${tag}`)
  const inv = await call('POST', `/api/dogs/${dog.slug}/invites`, { token: owner.token, body: {} })
  await call('POST', `/api/invites/${inv.json.token}/accept`, { token: pat.token })
  const w = (await call('POST', `/api/dogs/${dog.slug}/walks`, { token: owner.token, body: walk() })).json.walk
  const p = `/api/walks/${w.id}/paw`
  assert.deepEqual((await call('POST', p, { token: owner.token })).json, { paws: 1, pawed: true })
  assert.deepEqual((await call('POST', p, { token: owner.token })).json, { paws: 1, pawed: true })
  assert.deepEqual((await call('POST', p, { token: pat.token })).json, { paws: 2, pawed: true })
  const both = await Promise.all([call('POST', p, { token: pat.token }), call('POST', p, { token: pat.token })])
  assert.deepEqual(both.map((r) => r.status), [200, 200])
  const feed = await call('GET', '/api/feed', { token: pat.token })
  assert.deepEqual([feed.json.walks[0].paws, feed.json.walks[0].pawed], [2, true])
  assert.deepEqual((await call('DELETE', p, { token: owner.token })).json, { paws: 1, pawed: false })
  assert.deepEqual((await call('DELETE', p, { token: owner.token })).json, { paws: 1, pawed: false })
  assert.deepEqual((await call('DELETE', p, { token: pat.token })).json, { paws: 0, pawed: false })
  assert.equal((await call('POST', p, { token: outsider.token })).status, 404)
  assert.equal((await call('DELETE', p, { token: outsider.token })).status, 404)
  assert.equal((await call('POST', p)).status, 401)
  assert.equal((await call('POST', '/api/walks/not-an-id/paw', { token: owner.token })).status, 404)
  const rows = await db.query('SELECT COUNT(*) AS n FROM paws WHERE walk_id = $1', [w.id])
  assert.equal(Number(rows.rows[0].n), 0)
})

test('the public endpoint hides route geometry by default, shows first names only, and 404s for a private dog', async () => {
  const owner = await signIn('Priya Sharma-Jones', 'pub-owner')
  const care = await signIn('Happy Tails Daycare', 'pub-care')
  const dog = await makeDog(owner.token, `Biscuit Public ${tag}`)
  const inv = await call('POST', `/api/dogs/${dog.slug}/invites`, { token: owner.token, body: { role: 'daycare' } })
  await call('POST', `/api/invites/${inv.json.token}/accept`, { token: care.token })
  for (let i = 0; i < 12; i++) await call('POST', `/api/dogs/${dog.slug}/walks`, { token: owner.token, body: walk({ title: `Walk ${i}`, miles: 1, minutes: 20, startedAt: new Date(Date.now() - (i + 1) * 3600e3).toISOString() }) })
  await call('POST', `/api/dogs/${dog.slug}/walks`, { token: care.token, body: walk({ type: 'Daycare', title: 'Daycare day', miles: 0, minutes: 190, route: null, startedAt: new Date().toISOString() }) })

  const pub = await call('GET', `/api/public/dogs/${dog.slug}`)
  assert.equal(pub.status, 200)
  const d = pub.json.dog
  assert.equal(d.name, `Biscuit Public ${tag}`)
  assert.equal(d.breed, 'Golden Retriever')
  assert.equal(d.walks.length, 10, 'last 10 walks only')
  assert.equal(d.totals.lifetime.outings, 13)
  assert.equal(d.totals.lifetime.miles, 12)
  assert.equal(d.totals.week.outings, 13)
  assert.ok(d.walks.every((w) => !('route' in w)), 'no route geometry by default')
  assert.ok(!pub.text.includes('42.385'), 'no coordinates anywhere in the public answer')
  assert.equal(d.walks[0].with, 'Happy Tails Daycare')
  assert.equal(d.walks[1].with, 'Priya')
  assert.ok(!pub.text.includes('Sharma'), 'no surnames')
  assert.ok(!pub.text.includes('@'), 'no emails')
  assert.ok(!pub.text.includes(owner.id), 'no user ids')
  assert.ok(!('weight' in d))

  const page = await call('GET', `/d/${dog.slug}`)
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-type'), /text\/html/)
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/)
  assert.ok(page.text.includes(`Biscuit Public ${tag}`))
  assert.ok(page.text.includes('with <b>Priya</b>'))
  assert.ok(page.text.includes('at <b>Happy Tails Daycare</b>'))
  assert.ok(page.text.includes('property="og:title"'))
  assert.ok(page.text.includes('name="twitter:card"'))
  assert.ok(page.text.includes(`/d/${dog.slug}"`), 'og:url points at the page')
  assert.ok(page.text.includes('Open Trot'))
  assert.ok(!/<script/i.test(page.text), 'no client JavaScript')
  assert.ok(!page.text.includes('<svg'), 'no route drawing by default')
  assert.ok(!page.text.includes('Sharma') && !page.text.includes('@example.com'))

  const on = await call('PATCH', `/api/dogs/${dog.slug}`, { token: owner.token, body: { share_routes: true } })
  assert.equal(on.status, 200)
  const shared = await call('GET', `/api/public/dogs/${dog.slug}`)
  assert.deepEqual(shared.json.dog.walks[1].route, [[42.385, -71.149], [42.386, -71.148], [42.387, -71.147]])
  assert.equal(shared.json.dog.walks[0].route, null)
  assert.ok((await call('GET', `/d/${dog.slug}`)).text.includes('<svg'))

  const off = await call('PATCH', `/api/dogs/${dog.slug}`, { token: owner.token, body: { public: false } })
  assert.equal(off.status, 200)
  assert.equal((await call('GET', `/api/public/dogs/${dog.slug}`)).status, 404)
  const gone = await call('GET', `/d/${dog.slug}`)
  assert.equal(gone.status, 404)
  assert.ok(!gone.text.includes('Biscuit Public'), 'the 404 page says nothing about the dog')
  const never = await call('GET', `/d/never-existed-${tag}`)
  assert.equal(never.status, 404)
  assert.equal(gone.text, never.text, 'private and unknown dogs are indistinguishable')
  assert.equal((await call('GET', '/d/UPPER_case..')).status, 404)
  assert.equal((await call('GET', `/api/dogs/${dog.slug}`, { token: owner.token })).status, 200, 'members still see a private dog')
})

test('the public page escapes every interpolated value', async () => {
  const xss = '<script>alert(1)</script>'
  const owner = await signIn('<img src=x onerror=alert(2)> Mallory', 'xss-owner')
  const dog = await makeDog(owner.token, xss, { breed: '"><svg onload=alert(3)>', bio: `'"><iframe src=javascript:alert(4)></iframe> & co` })
  assert.match(dog.slug, /^script-alert-1-script/)
  await call('POST', `/api/dogs/${dog.slug}/walks`, { token: owner.token, body: walk({ title: '</title><script>alert(5)</script>', note: '<b onmouseover=alert(6)>hi</b>', place: '"><script src=//evil.example/x.js></script>' }) })
  const page = await call('GET', `/d/${dog.slug}`)
  assert.equal(page.status, 200)
  assert.ok(!/<script/i.test(page.text), 'no script tag survives')
  assert.ok(!/<iframe|<img|<svg onload|<b onmouseover/i.test(page.text), 'no injected element survives')
  assert.ok(page.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(page.text.includes('&lt;img'), 'the walker name is escaped too')
  assert.ok(page.text.includes('&quot;&gt;&lt;svg onload=alert(3)&gt;'))
  assert.ok(page.text.includes('&#39;&quot;&gt;&lt;iframe'))
  assert.ok(page.text.includes('&amp; co'))
  // Every attribute value that carries user text stays inside its quotes.
  for (const m of page.text.matchAll(/content="([^"]*)"/g)) assert.ok(!/[<>]/.test(m[1]), `unescaped meta content: ${m[1]}`)
  assert.equal(esc(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;')
  // The JSON API returns the raw text. Escaping there is the client's job (React does it).
  assert.equal((await call('GET', `/api/public/dogs/${dog.slug}`)).json.dog.name, xss)
})

test('input limits', async () => {
  const u = await signIn('Limit Tester', 'limits')
  const s = (body) => call('POST', '/api/session', { body })
  assert.equal((await s({ name: 'x'.repeat(LIMITS.name + 1), email: mail('long') })).status, 400)
  assert.equal((await s({ name: '', email: mail('noname') })).status, 400)
  assert.equal((await s({ name: 'A', email: 'not-an-email' })).status, 400)
  assert.equal((await s({ name: 'A', email: `${'a'.repeat(250)}@example.com` })).status, 400)
  assert.equal((await s({ name: 'A', email: { $ne: '' } })).status, 400)
  assert.equal((await s({ name: ['A'], email: mail('arr') })).status, 400)
  assert.equal((await s([])).status, 400)
  assert.equal((await call('POST', '/api/session', { raw: '{"name":' })).status, 400)
  assert.equal((await s({ name: 'A', email: `x'; DROP TABLE users; --@example.com` })).status, 400)
  const odd = await s({ name: `Robert'); DROP TABLE users; --`, email: mail('bobby') })
  assert.equal(odd.status, 201, 'odd names are stored as plain text')
  assert.equal(odd.json.user.name, `Robert'); DROP TABLE users; --`)
  assert.equal((await call('GET', '/api/me', { token: u.token })).status, 200, 'and the users table is still there')

  const d = (body) => call('POST', '/api/dogs', { token: u.token, body })
  assert.equal((await d({ name: '' })).status, 400)
  assert.equal((await d({ name: 'x'.repeat(LIMITS.dogName + 1) })).status, 400)
  assert.equal((await d({ name: 'Ok', bio: 'x'.repeat(LIMITS.bio + 1) })).status, 400)
  assert.equal((await d({ name: 'Ok', breed: 'x'.repeat(LIMITS.breed + 1) })).status, 400)
  assert.equal((await d({ name: 'Ok', weight: 'heavy' })).status, 400)
  assert.equal((await d({ name: 'Ok', weight: 9999 })).status, 400)
  assert.equal((await d({ name: 'Ok', birthday: '2021-02-31' })).status, 400)
  assert.equal((await d({ name: 'Ok', birthday: '2999-01-01' })).status, 400)
  const dog = await makeDog(u.token, `Limits ${tag}`)
  const p = `/api/dogs/${dog.slug}`
  assert.equal((await call('PATCH', p, { token: u.token, body: { public: 'yes' } })).status, 400)
  assert.equal((await call('PATCH', p, { token: u.token, body: {} })).status, 400)
  assert.equal((await call('PATCH', p, { token: u.token, body: { slug: 'taken', is_public: false, created_by: 'x' } })).status, 400, 'unknown fields change nothing')

  const w = (over) => call('POST', `${p}/walks`, { token: u.token, body: walk(over) })
  const pts = (n) => Array.from({ length: n }, (_, i) => [42 + i * 1e-5, -71 - i * 1e-5])
  assert.equal((await w({ route: pts(LIMITS.routePoints) })).status, 201, 'a route at the cap is accepted')
  assert.equal((await w({ route: pts(LIMITS.routePoints + 1) })).status, 400, 'one point over the cap is refused')
  assert.equal((await w({ route: [[91, 0], [0, 0]] })).status, 400)
  assert.equal((await w({ route: [[0, 181], [0, 0]] })).status, 400)
  assert.equal((await w({ route: [['42', '-71'], [0, 0]] })).status, 400)
  assert.equal((await w({ route: [[1, 2, 3], [0, 0]] })).status, 400)
  assert.equal((await w({ route: 'LINESTRING(0 0, 1 1)' })).status, 400)
  assert.equal((await w({ title: '' })).status, 400)
  assert.equal((await w({ title: 'x'.repeat(LIMITS.title + 1) })).status, 400)
  assert.equal((await w({ note: 'x'.repeat(LIMITS.note + 1) })).status, 400)
  assert.equal((await w({ minutes: LIMITS.minutes + 1 })).status, 400)
  assert.equal((await w({ minutes: -1 })).status, 400)
  assert.equal((await w({ minutes: '30' })).status, 400)
  assert.equal((await w({ miles: LIMITS.miles + 1 })).status, 400)
  assert.equal((await w({ sniffs: 1.5 })).status, 400)
  assert.equal((await w({ type: 'Teleport' })).status, 400)
  assert.equal((await w({ startedAt: new Date(Date.now() + 864e5).toISOString() })).status, 400)
  assert.equal((await w({ startedAt: 'yesterday-ish' })).status, 400)
  const big = await call('POST', `${p}/walks`, { token: u.token, raw: JSON.stringify(walk({ note: 'x'.repeat(600 * 1024) })) })
  assert.equal(big.status, 413, 'an oversized body is refused before it is parsed')
  const tidy = await w({ title: '  Spaced\n\tout\u0000 title  ' })
  assert.equal(tidy.json.walk.title, 'Spaced out title')
})

test('rate limiting on sign-in and on writes', async () => {
  const l = await listen(createApp({ db, rate: { sessionMax: 3, writeMax: 4 } }))
  try {
    const codes = []
    for (let i = 0; i < 5; i++) codes.push((await call('POST', '/api/session', { from: l.url, body: { name: 'Rate', email: mail('rate') } })).status)
    assert.deepEqual(codes, [201, 200, 200, 429, 429])
    const blocked = await call('POST', '/api/session', { from: l.url, body: { name: 'Rate', email: mail('rate') } })
    assert.ok(Number(blocked.headers.get('retry-after')) > 0)
    const u = await signIn('Rate Writer', 'rate-writer')
    const writes = []
    for (let i = 0; i < 6; i++) writes.push((await call('POST', '/api/dogs', { from: l.url, token: u.token, body: { name: `Rate ${tag} ${i}` } })).status)
    assert.deepEqual(writes, [201, 201, 201, 201, 429, 429])
    assert.equal((await call('GET', '/api/me', { from: l.url, token: u.token })).status, 200, 'reads are not counted as writes')
  } finally { await new Promise((r) => l.s.close(r)) }
})

test('the server serves the built frontend with an SPA fallback, but not for /api or /d', async () => {
  const home = await call('GET', '/')
  assert.equal(home.status, 200)
  assert.ok(home.text.includes('app shell'))
  assert.ok((await call('GET', '/some/app/route?invite=abc')).text.includes('app shell'))
  assert.equal((await call('GET', '/icon-192.png')).text, 'png')
  assert.equal((await call('GET', '/assets/missing.js')).status, 404)
  const api404 = await call('GET', '/api/nope')
  assert.equal(api404.status, 404)
  assert.deepEqual(api404.json, { error: 'Not found.' })
  assert.equal((await call('GET', '/d/')).status, 404)
  assert.equal((await call('GET', '/d/a/b')).status, 404)
  assert.ok(!(await call('GET', '/d/a/b')).text.includes('app shell'))
  assert.ok(!(await call('GET', '/%2e%2e/%2e%2e/etc/passwd')).text.includes('root:'), 'no path traversal out of the static folder')
  const sw = await call('GET', '/sw.js')
  assert.match(sw.headers.get('content-type'), /javascript/)
  assert.ok(sw.text.includes("startsWith('/api/')"))
  assert.equal((await call('GET', '/api/me')).headers.get('cache-control'), 'no-store')
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff')
})

// ---- profile editing, photos, team and walk housekeeping ----------------------
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const fakeImage = (sig, size) => { const b = Buffer.alloc(size, 7); sig.copy(b); return b }
const dataUrl = (type, buf) => `data:${type};base64,${buf.toString('base64')}`
const bytes = async (p, token) => {
  const res = await fetch(base + p, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  return { status: res.status, type: res.headers.get('content-type') || '', cache: res.headers.get('cache-control') || '', buf: Buffer.from(await res.arrayBuffer()) }
}
const join = async (ownerToken, slug, token, role = 'walker') => {
  const inv = await call('POST', `/api/dogs/${slug}/invites`, { token: ownerToken, body: { role } })
  assert.equal(inv.status, 201, inv.text)
  assert.equal((await call('POST', `/api/invites/${inv.json.token}/accept`, { token })).status, 200)
}

test('the startup migration can run again on the same database', async () => {
  const q = (t, p = []) => db.query(t, p)
  await addColumns(q)
  await addColumns(q)
  // pg-mem cannot repeat CREATE TABLE IF NOT EXISTS on a table that exists, and it
  // always starts empty anyway. The whole startup sequence is repeated on real Postgres.
  if (db.kind === 'postgres') { await migrate(q); await migrate(q) }
  const cols = await db.query('SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2', ['dogs', 'photo'])
  assert.equal(cols.rows.length, 1)
})

test('the owner can edit every profile field, and renaming a dog keeps its address', async () => {
  const owner = await signIn('Rena Owner', 'ren-owner')
  const dog = await makeDog(owner.token, `Biscuit ${tag}`)
  const p = `/api/dogs/${dog.slug}`
  const r = await call('PATCH', p, { token: owner.token, body: { name: 'Sir Barks', breed: 'Mutt', birthday: '2021-05-30', weight: 41.5, bio: 'Renamed.', public: true, shareRoutes: true } })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.json.dog.name, 'Sir Barks')
  assert.equal(r.json.dog.slug, dog.slug, 'the slug does not follow the name')
  assert.equal(r.json.dog.breed, 'Mutt')
  assert.equal(r.json.dog.birthday, '2021-05-30')
  assert.equal(r.json.dog.weight, 41.5)
  assert.equal(r.json.dog.shareRoutes, true)
  assert.equal(r.json.dog.photoUrl, null)
  assert.equal((await call('GET', p, { token: owner.token })).json.dog.name, 'Sir Barks')
  const page = await call('GET', `/d/${dog.slug}`)
  assert.equal(page.status, 200)
  assert.ok(page.text.includes('Sir Barks'))
  assert.equal((await call('GET', `/api/dogs/${slugify('Sir Barks')}`, { token: owner.token })).status, 404, 'no page appears at the new name')
  const me = await call('GET', '/api/me', { token: owner.token })
  assert.deepEqual(me.json.dogs.map((d) => [d.slug, d.name]), [[dog.slug, 'Sir Barks']])
  assert.equal((await call('PATCH', p, { token: owner.token, body: { name: '  ' } })).status, 400)
  assert.equal((await call('PATCH', p, { token: owner.token, body: { name: 'x'.repeat(LIMITS.dogName + 1) } })).status, 400)
  assert.equal((await call('PATCH', p, { token: owner.token, body: { slug: 'taken' } })).status, 400, 'a slug in the body changes nothing')
})

test('dog photo: type and size limits, bytes from a dedicated endpoint, a versioned URL in JSON, and removal', async () => {
  const owner = await signIn('Phoebe Owner', 'ph-owner')
  const walker = await signIn('Phil Walker', 'ph-walker')
  const stranger = await signIn('Stray Person', 'ph-stranger')
  const dog = await makeDog(owner.token, `Snap ${tag}`)
  const p = `/api/dogs/${dog.slug}`
  await join(owner.token, dog.slug, walker.token)
  assert.equal(dog.photoUrl, null)
  assert.equal((await bytes(`${p}/photo`, owner.token)).status, 404, 'no photo yet')

  const png = fakeImage(PNG_SIG, 2000)
  const patch = (photo, token = owner.token) => call('PATCH', p, { token, body: { photo } })
  for (const badPhoto of [
    'not a data url', 42, {}, '',
    dataUrl('image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')),
    dataUrl('image/gif', Buffer.from('GIF89a')),
    dataUrl('text/html', Buffer.from('<script>alert(1)</script>')),
    'data:image/png;base64,', 'data:image/png;base64,@@@@', 'data:image/png;charset=utf-8;base64,AAAA', 'data:image/png,rawbytes',
    dataUrl('image/jpeg', png), dataUrl('image/png', Buffer.from('<html><script>alert(1)</script></html>')),
  ]) {
    const r = await patch(badPhoto)
    assert.equal(r.status, 400, `${String(badPhoto).slice(0, 40)} -> ${r.text}`)
  }
  assert.equal((await patch(dataUrl('image/png', png), walker.token)).status, 403, 'only the owner sets the photo')
  assert.equal((await call('GET', p, { token: owner.token })).json.dog.photoUrl, null, 'nothing was stored by the rejected tries')

  const ok = await patch(dataUrl('image/png', png))
  assert.equal(ok.status, 200, ok.text)
  assert.match(ok.json.dog.photoUrl, new RegExp(`^/api/dogs/${dog.slug}/photo\\?v=[a-f0-9]{12}$`))
  assert.ok(!JSON.stringify(ok.json).includes('base64'), 'the photo itself is not in the JSON')
  const got = await bytes(ok.json.dog.photoUrl, owner.token)
  assert.equal(got.status, 200)
  assert.match(got.type, /^image\/png/)
  assert.match(got.cache, /max-age=300/)
  assert.ok(got.buf.equals(png), 'the decoded bytes come back unchanged')
  assert.equal((await bytes(ok.json.dog.photoUrl, walker.token)).status, 200, 'team members can load it')
  assert.equal((await bytes(ok.json.dog.photoUrl, stranger.token)).status, 403)
  assert.equal((await bytes(ok.json.dog.photoUrl)).status, 401)

  // Lists carry the URL only.
  assert.equal((await call('POST', `${p}/walks`, { token: walker.token, body: walk() })).status, 201)
  assert.equal((await call('POST', `${p}/walks`, { token: owner.token, body: walk({ title: 'Second' }) })).status, 201)
  for (const path of ['/api/me', p, `/api/feed?dog=${dog.slug}`, '/api/feed']) {
    const r = await call('GET', path, { token: owner.token })
    assert.equal(r.status, 200)
    assert.ok(!r.text.includes('base64') && r.text.length < 20000, `${path} carries no image data`)
    assert.ok(r.text.includes(ok.json.dog.photoUrl), `${path} carries the photo URL`)
  }
  const feed = await call('GET', `/api/feed?dog=${dog.slug}`, { token: walker.token })
  assert.ok(feed.json.walks.length === 2 && feed.json.walks.every((w) => w.dog.photoUrl === ok.json.dog.photoUrl))

  // Public: the bytes, the JSON and the page all point at the public endpoint.
  const pub = await call('GET', `/api/public/dogs/${dog.slug}`)
  assert.match(pub.json.dog.photoUrl, new RegExp(`^/api/public/dogs/${dog.slug}/photo\\?v=[a-f0-9]{12}$`))
  assert.ok(!pub.text.includes('base64'))
  const pubBytes = await bytes(pub.json.dog.photoUrl)
  assert.equal(pubBytes.status, 200)
  assert.match(pubBytes.type, /^image\/png/)
  assert.match(pubBytes.cache, /public, max-age=300/)
  assert.ok(pubBytes.buf.equals(png))
  const page = await call('GET', `/d/${dog.slug}`)
  assert.ok(page.text.includes(`<img class="av" src="/api/public/dogs/${dog.slug}/photo?v=`), 'the page shows the photo')
  assert.match(page.text, /alt="Photo of Snap [0-9a-f]+"/)
  assert.match(page.text, new RegExp(`<meta property="og:image" content="http://[^"]+/api/public/dogs/${dog.slug}/photo\\?v=[a-f0-9]{12}">`))
  assert.ok(!/<script/i.test(page.text))

  // A new photo gets a new version and the right content type.
  const jpg = fakeImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 900)
  const second = await patch(dataUrl('image/jpeg', jpg))
  assert.equal(second.status, 200)
  assert.notEqual(second.json.dog.photoUrl, ok.json.dog.photoUrl)
  assert.match((await bytes(second.json.dog.photoUrl, owner.token)).type, /^image\/jpeg/)
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(40, 1)])
  assert.equal((await patch(dataUrl('image/webp', webp))).status, 200)
  assert.match((await bytes(`/api/public/dogs/${dog.slug}/photo`)).type, /^image\/webp/)

  // Size: exactly at the cap is fine, one byte over is a 400, far over is cut off by the body limit.
  assert.equal((await patch(dataUrl('image/png', fakeImage(PNG_SIG, LIMITS.photoBytes)))).status, 200)
  const over = await patch(dataUrl('image/png', fakeImage(PNG_SIG, LIMITS.photoBytes + 1)))
  assert.equal(over.status, 400, over.text)
  assert.match(over.json.error, /300 KB/)
  assert.equal((await patch(dataUrl('image/png', fakeImage(PNG_SIG, 700 * 1024)))).status, 413)
  // The larger body limit is for this one route only.
  const big = await call('POST', `${p}/walks`, { token: owner.token, body: walk({ note: 'x'.repeat(410 * 1024) }) })
  assert.equal(big.status, 413)
  const bigMe = await call('PATCH', '/api/me', { token: owner.token, body: { name: 'x'.repeat(410 * 1024) } })
  assert.equal(bigMe.status, 413)

  // A private dog's public photo looks like a missing one. The team still sees it.
  assert.equal((await call('PATCH', p, { token: owner.token, body: { public: false } })).status, 200)
  const priv = await call('GET', `/api/public/dogs/${dog.slug}/photo`)
  assert.equal(priv.status, 404)
  assert.ok(priv.json && priv.json.error)
  assert.equal((await bytes(`${p}/photo`, walker.token)).status, 200)
  assert.equal((await call('PATCH', p, { token: owner.token, body: { public: true } })).status, 200)
  assert.equal((await bytes(`/api/public/dogs/${dog.slug}/photo`)).status, 200)

  // Removal.
  assert.equal((await patch(null, walker.token)).status, 403)
  const gone = await patch(null)
  assert.equal(gone.status, 200)
  assert.equal(gone.json.dog.photoUrl, null)
  assert.equal((await bytes(`${p}/photo`, owner.token)).status, 404)
  assert.equal((await bytes(`/api/public/dogs/${dog.slug}/photo`)).status, 404)
  assert.equal((await call('GET', `/api/public/dogs/${dog.slug}`)).json.dog.photoUrl, null)
  const page2 = await call('GET', `/d/${dog.slug}`)
  assert.ok(!page2.text.includes('<img'))
  assert.match(page2.text, /og:image" content="http:\/\/[^"]+\/icon-512\.png"/)
  assert.equal((await bytes(`/api/public/dogs/no-such-dog-${tag}/photo`)).status, 404)
  assert.equal((await bytes('/api/public/dogs/Bad_Slug!/photo')).status, 404)
})

test('PATCH /api/me changes the display name, with validation', async () => {
  const a = await signIn('Old Name', 'me-a')
  const b = await signIn('Other Person', 'me-b')
  assert.equal((await call('PATCH', '/api/me', { body: { name: 'Nobody' } })).status, 401)
  const r = await call('PATCH', '/api/me', { token: a.token, body: { name: '  New   Name ', email: mail('me-b'), id: b.id } })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.json.user, { id: a.id, name: 'New Name', email: mail('me-a') })
  assert.equal((await call('GET', '/api/me', { token: a.token })).json.user.name, 'New Name')
  assert.equal((await call('GET', '/api/me', { token: b.token })).json.user.name, 'Other Person', 'nobody else is renamed')
  for (const name of ['', '   ', 42, null, undefined, 'x'.repeat(LIMITS.name + 1)]) {
    assert.equal((await call('PATCH', '/api/me', { token: a.token, body: { name } })).status, 400, String(name).slice(0, 20))
  }
  assert.equal((await call('PATCH', '/api/me', { token: a.token, body: [] })).status, 400)
  assert.equal((await call('GET', '/api/me', { token: a.token })).json.user.name, 'New Name')
  // The new name shows on walks and the team.
  const dog = await makeDog(a.token, `Namey ${tag}`)
  await call('POST', `/api/dogs/${dog.slug}/walks`, { token: a.token, body: walk() })
  const d = await call('GET', `/api/dogs/${dog.slug}`, { token: a.token })
  assert.equal(d.json.team[0].name, 'New Name')
  assert.equal(d.json.walks[0].by.name, 'New Name')
})

test('an owner can remove a team member but not themselves, and nobody else can', async () => {
  const owner = await signIn('Tess Owner', 'rm-owner')
  const pat = await signIn('Pat Walker', 'rm-pat')
  const sue = await signIn('Sue Family', 'rm-sue')
  const stranger = await signIn('Stray Two', 'rm-stranger')
  const dog = await makeDog(owner.token, `Teamy ${tag}`)
  const p = `/api/dogs/${dog.slug}`
  await join(owner.token, dog.slug, pat.token)
  await join(owner.token, dog.slug, sue.token, 'family')
  const w = await call('POST', `${p}/walks`, { token: pat.token, body: walk() })
  assert.equal(w.status, 201)

  assert.equal((await call('DELETE', `${p}/members/${sue.id}`, { token: pat.token })).status, 403, 'a member cannot remove a member')
  assert.equal((await call('DELETE', `${p}/members/${pat.id}`, { token: pat.token })).status, 403)
  assert.equal((await call('DELETE', `${p}/members/${pat.id}`, { token: stranger.token })).status, 403)
  assert.equal((await call('DELETE', `${p}/members/${pat.id}`)).status, 401)
  assert.equal((await call('DELETE', `${p}/members/${owner.id}`, { token: owner.token })).status, 400, 'the owner cannot remove themselves')
  assert.equal((await call('DELETE', `${p}/members/${stranger.id}`, { token: owner.token })).status, 404)
  assert.equal((await call('DELETE', `${p}/members/not-an-id`, { token: owner.token })).status, 404)
  assert.equal((await call('GET', p, { token: owner.token })).json.team.length, 3)

  const r = await call('DELETE', `${p}/members/${pat.id}`, { token: owner.token })
  assert.equal(r.status, 200, r.text)
  const d = await call('GET', p, { token: owner.token })
  assert.deepEqual(d.json.team.map((m) => m.name).sort(), ['Sue Family', 'Tess Owner'])
  assert.equal(d.json.walks.length, 1, 'their walks stay with the dog')
  assert.equal((await call('GET', p, { token: pat.token })).status, 403, 'the removed person loses access')
  assert.equal((await call('GET', `/api/walks/${w.json.walk.id}`, { token: pat.token })).status, 404)
  assert.deepEqual((await call('GET', '/api/me', { token: pat.token })).json.dogs, [])
  assert.equal((await call('DELETE', `${p}/members/${pat.id}`, { token: owner.token })).status, 404, 'already gone')
  assert.equal((await call('GET', p, { token: sue.token })).status, 200, 'others are untouched')
})

test('an owner can list and cancel a pending invite', async () => {
  const owner = await signIn('Ivy Owner', 'ci-owner')
  const other = await signIn('Otto Owner', 'ci-other')
  const pat = await signIn('Pat Walker', 'ci-pat')
  const sue = await signIn('Sue Family', 'ci-sue')
  const dog = await makeDog(owner.token, `Invy ${tag}`)
  const otherDog = await makeDog(other.token, `Elsewhere ${tag}`)
  const p = `/api/dogs/${dog.slug}`
  const a = await call('POST', `${p}/invites`, { token: owner.token, body: { role: 'walker' } })
  const b = await call('POST', `${p}/invites`, { token: owner.token, body: { role: 'family' } })
  const list = await call('GET', `${p}/invites`, { token: owner.token })
  assert.equal(list.status, 200)
  assert.equal(list.json.invites.length, 2)
  assert.deepEqual(list.json.invites.map((i) => i.role).sort(), ['family', 'walker'])
  assert.ok(!list.text.includes(a.json.token) && !list.text.includes(b.json.token), 'the list never repeats a link token')
  assert.ok(!list.text.includes('@'), 'no emails')
  const idA = crypto.createHash('sha256').update(a.json.token).digest('hex')
  assert.ok(list.json.invites.some((i) => i.id === idA))

  await join(owner.token, dog.slug, pat.token)
  assert.equal((await call('GET', `${p}/invites`, { token: pat.token })).status, 403)
  assert.equal((await call('DELETE', `${p}/invites/${idA}`, { token: pat.token })).status, 403)
  assert.equal((await call('DELETE', `${p}/invites/${idA}`, { token: other.token })).status, 403)
  assert.equal((await call('DELETE', `/api/dogs/${otherDog.slug}/invites/${idA}`, { token: other.token })).status, 404, 'another owner cannot cancel it through their own dog')
  assert.equal((await call('DELETE', `${p}/invites/nope`, { token: owner.token })).status, 404)
  assert.equal((await call('GET', `/api/invites/${a.json.token}`)).json.open, true)

  const r = await call('DELETE', `${p}/invites/${idA}`, { token: owner.token })
  assert.equal(r.status, 200, r.text)
  assert.equal((await call('GET', `/api/invites/${a.json.token}`)).status, 404, 'the link is dead')
  assert.equal((await call('POST', `/api/invites/${a.json.token}/accept`, { token: sue.token })).status, 404)
  assert.equal((await call('DELETE', `${p}/invites/${idA}`, { token: owner.token })).status, 404)
  // The other invite still works, and a used invite is not listed or cancellable.
  assert.equal((await call('POST', `/api/invites/${b.json.token}/accept`, { token: sue.token })).status, 200)
  const idB = crypto.createHash('sha256').update(b.json.token).digest('hex')
  assert.equal((await call('DELETE', `${p}/invites/${idB}`, { token: owner.token })).status, 404)
  const left = (await call('GET', `${p}/invites`, { token: owner.token })).json.invites
  assert.ok(!left.some((i) => i.id === idA || i.id === idB))
  assert.equal((await call('GET', p, { token: sue.token })).status, 200, 'cancelling an invite removes nobody')
})

test('a member can delete their own walk and the owner can delete any walk on the dog', async () => {
  const owner = await signIn('Wes Owner', 'dw-owner')
  const pat = await signIn('Pat Walker', 'dw-pat')
  const sue = await signIn('Sue Family', 'dw-sue')
  const stranger = await signIn('Stray Three', 'dw-stranger')
  const dog = await makeDog(owner.token, `Walky ${tag}`)
  const p = `/api/dogs/${dog.slug}`
  await join(owner.token, dog.slug, pat.token)
  await join(owner.token, dog.slug, sue.token, 'family')
  const post = async (token, title) => (await call('POST', `${p}/walks`, { token, body: walk({ title }) })).json.walk.id
  const mine = await post(pat.token, 'Pat one')
  const mine2 = await post(pat.token, 'Pat two')
  const owners = await post(owner.token, 'Owner one')
  assert.equal((await call('POST', `/api/walks/${mine}/paw`, { token: sue.token })).status, 200)

  assert.equal((await call('DELETE', `/api/walks/${mine}`)).status, 401)
  assert.equal((await call('DELETE', `/api/walks/${mine}`, { token: stranger.token })).status, 404, 'a non-member cannot tell the walk exists')
  assert.equal((await call('DELETE', `/api/walks/${mine}`, { token: sue.token })).status, 403, 'another member cannot delete it')
  assert.equal((await call('DELETE', `/api/walks/${owners}`, { token: pat.token })).status, 403, 'a member cannot delete the owner\'s walk')
  assert.equal((await call('DELETE', '/api/walks/not-an-id', { token: owner.token })).status, 404)
  assert.equal((await call('GET', `/api/feed?dog=${dog.slug}`, { token: owner.token })).json.walks.length, 3)

  assert.equal((await call('DELETE', `/api/walks/${mine}`, { token: pat.token })).status, 200, 'their own walk')
  assert.equal((await call('GET', `/api/walks/${mine}`, { token: pat.token })).status, 404)
  assert.equal((await call('DELETE', `/api/walks/${mine}`, { token: pat.token })).status, 404)
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM paws WHERE walk_id = $1', [mine])).rows[0].n * 1, 0, 'its paws go with it')
  assert.equal((await call('DELETE', `/api/walks/${mine2}`, { token: owner.token })).status, 200, 'the owner deletes a member\'s walk')
  const d = await call('GET', p, { token: owner.token })
  assert.deepEqual(d.json.walks.map((w) => w.title), ['Owner one'])
  assert.equal(d.json.totals.lifetime.outings, 1)
  assert.equal((await call('GET', `/api/public/dogs/${dog.slug}`)).json.dog.walks.length, 1)
})

// ---- settings, health, places, documents, awards, events, boards, challenges, demo seed ----
import zlib from 'node:zlib'
import { activitySummary, bestStreak, dueStatus } from './routesHealth.js'
import { sniffDocument, safeFilename, DOC_LIMITS } from './routesDocs.js'
import { seedEvents, httpUrl } from './routesShows.js'
import { rank, challengeProgress, monthWindow, weekWindow, weekendWindow, lifetimeBadges, CHALLENGES } from './routesCompete.js'
import { seedDemo, DEMO_DOGS, DEMO_DOMAIN } from './seedDemo.js'
import { WALK_TYPES } from './app.js'

const ago = (ms) => new Date(Date.now() - ms).toISOString()
const dayStr = (offsetDays = 0) => new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10)
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
// Puts a walk straight into the database at any time, past the API's date rules.
async function rawWalk(slug, t, miles) {
  const d = (await db.query('SELECT id, created_by FROM dogs WHERE slug = $1', [slug])).rows[0]
  const at = new Date(t).toISOString()
  await db.query('INSERT INTO walks (id, dog_id, user_id, type, title, miles, minutes, started_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [crypto.randomUUID(), d.id, d.created_by, 'Walk', 'Seeded', miles, 30, at, at])
}

test('tracking level, daily goal, city and the leaderboard switch live on the dog and only the owner sets them', async () => {
  const owner = await signIn('Tia Owner', 'tl-owner')
  const pat = await signIn('Pat Walker', 'tl-pat')
  const dog = await makeDog(owner.token, `Level ${tag}`)
  const p = `/api/dogs/${dog.slug}`
  assert.equal(dog.trackingLevel, 1, 'level 1 by default')
  assert.equal(dog.goalMinutes, null)
  assert.equal(dog.leaderboards, true)
  assert.equal(dog.isDemo, false)
  await join(owner.token, dog.slug, pat.token)
  for (const bad of [0, 4, 1.5, '2', null]) assert.equal((await call('PATCH', p, { token: owner.token, body: { tracking_level: bad } })).status, 400, `level ${bad}`)
  for (const bad of [9, 301, 45.5, '60']) assert.equal((await call('PATCH', p, { token: owner.token, body: { goal_minutes: bad } })).status, 400, `goal ${bad}`)
  assert.equal((await call('PATCH', p, { token: pat.token, body: { tracking_level: 2 } })).status, 403)
  assert.equal((await call('PATCH', p, { token: pat.token, body: { goal_minutes: 60 } })).status, 403)
  const r = await call('PATCH', p, { token: owner.token, body: { tracking_level: 3, goal_minutes: 75, city: ' Boston,  MA ', leaderboards: false } })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual([r.json.dog.trackingLevel, r.json.dog.goalMinutes, r.json.dog.city, r.json.dog.leaderboards], [3, 75, 'Boston, MA', false])
  const me = await call('GET', '/api/me', { token: pat.token })
  assert.equal(me.json.dogs.find((d) => d.slug === dog.slug).trackingLevel, 3)
  assert.equal((await call('PATCH', p, { token: owner.token, body: { trackingLevel: 2, goalMinutes: null } })).json.dog.goalMinutes, null, 'null clears the goal')
  assert.equal((await call('PATCH', p, { token: owner.token, body: { leaderboards: 'no' } })).status, 400)
  assert.equal((await call('PATCH', p, { token: owner.token, body: { city: 'x'.repeat(61) } })).status, 400)
})

test('activity summary: weeks, change against the 4 weeks before, streak and active days', () => {
  const now = Date.UTC(2026, 10, 25, 18, 0, 0), D = 864e5
  const w = (daysAgo, minutes, miles = 1, type = 'Walk', extra = {}) => ({ started_at: new Date(now - daysAgo * D).toISOString(), minutes, miles, type, ...extra })
  const walks = [w(0, 30, 1, 'Walk', { max_speed: 6.2, sprints: 2 }), w(1, 30), w(2, 60, 2, 'Play time', { sprints: 5 }), w(2, 500, 0, 'Daycare'), w(4, 20), ...[7, 14, 21, 28].map((d) => w(d, 100, 3)), w(55, 10)]
  const a = activitySummary(walks, now, 0)
  assert.deepEqual([a.last7.minutes, a.last7.miles, a.last7.outings], [140, 5, 4], 'daycare is left out')
  assert.equal(a.previousWeeklyAverage.minutes, 100)
  assert.equal(a.changePercent.minutes, 40)
  assert.equal(a.activeDays, 4)
  assert.equal(a.streakDays, 3)
  assert.equal(a.todayMinutes, 30)
  assert.equal(a.weeks.length, 8)
  assert.equal(a.weeks[7].minutes, 140, 'newest week last')
  assert.equal(a.weeks[0].minutes, 10)
  assert.equal(a.last7.topSpeed, 6.2)
  assert.equal(a.last7.sprints, 7)
  assert.deepEqual(a.last7.byType, [{ type: 'Walk', minutes: 80 }, { type: 'Play time', minutes: 60 }])
  const none = activitySummary([w(1, 30)], now, 0)
  assert.equal(none.changePercent.minutes, null, 'nothing to compare against')
  assert.equal(none.streakDays, 1, 'a walk yesterday keeps the streak alive')
  assert.equal(none.last7.topSpeed, null, 'a missing speed is not zero')
  // The person's own calendar decides what "today" is.
  const early = [{ started_at: new Date(now - 17 * 3600e3).toISOString(), minutes: 20, miles: 1, type: 'Walk' }]
  assert.equal(activitySummary(early, now, 0).todayMinutes, 20, '01:00 UTC is today in UTC')
  assert.equal(activitySummary(early, now, 300).todayMinutes, 0, 'and yesterday evening five hours west')
  assert.equal(bestStreak(new Set([1, 2, 3, 7, 8])), 3)
  assert.deepEqual([dueStatus(dayStr(-1), dayStr()), dueStatus(dayStr(10), dayStr()), dueStatus(dayStr(30), dayStr()), dueStatus(dayStr(31), dayStr()), dueStatus(null, dayStr())], ['overdue', 'due_soon', 'due_soon', 'ok', null])
})

test('health entries: members only, validated, edited and deleted by the creator or the owner, with a computed summary', async () => {
  const owner = await signIn('Hana Owner', 'he-owner')
  const pat = await signIn('Pat Walker', 'he-pat')
  const sue = await signIn('Sue Family', 'he-sue')
  const stranger = await signIn('Stray Four', 'he-stranger')
  const dog = await makeDog(owner.token, `Healthy ${tag}`)
  const p = `/api/dogs/${dog.slug}/health`
  await join(owner.token, dog.slug, pat.token)
  await join(owner.token, dog.slug, sue.token, 'family')
  assert.equal((await call('GET', p)).status, 401)
  assert.equal((await call('GET', p, { token: stranger.token })).status, 403)
  assert.equal((await call('POST', p, { token: stranger.token, body: { kind: 'note', notes: 'hi' } })).status, 403)
  const empty = await call('GET', p, { token: pat.token })
  assert.equal(empty.status, 200)
  assert.deepEqual(empty.json.entries, [])
  assert.equal(empty.json.summary.weight, null)
  assert.deepEqual(empty.json.summary.goal, { minutes: null, todayMinutes: 0, percent: null })
  assert.equal(empty.json.summary.activity.longestWalk, null)

  const add = (token, body) => call('POST', p, { token, body })
  const bad = [
    { kind: 'surgery', title: 'x' }, { kind: 'weight', value: 0, unit: 'lb', occurredOn: dayStr() }, { kind: 'weight', value: 401, unit: 'lb', occurredOn: dayStr() }, { kind: 'weight', value: 201, unit: 'kg', occurredOn: dayStr() },
    { kind: 'weight', value: 60, unit: 'stone', occurredOn: dayStr() }, { kind: 'weight', value: '60', unit: 'lb', occurredOn: dayStr() }, { kind: 'weight', value: 60, unit: 'lb' }, { kind: 'weight', value: 60, unit: 'lb', occurredOn: dayStr(5) },
    { kind: 'weight', value: 60, unit: 'lb', occurredOn: '2026-02-30' }, { kind: 'vaccine', title: '' }, { kind: 'vaccine', title: 'x'.repeat(81) }, { kind: 'vaccine', title: 'Rabies', occurredOn: '2026-05-01', dueOn: '2026-04-01' },
    { kind: 'vaccine', title: 'Rabies', dueOn: '05/01/2027' }, { kind: 'medication', title: 'Carprofen', detail: 'x'.repeat(81) }, { kind: 'medication', title: 'Carprofen', occurredOn: '2026-05-02', dueOn: '2026-05-01' },
    { kind: 'vet_visit', title: 'Checkup' }, { kind: 'vet_visit', occurredOn: dayStr(-3) }, { kind: 'condition', title: '' }, { kind: 'note', notes: '' }, { kind: 'note', notes: 'x'.repeat(1001) }, { kind: 'note', notes: 5 },
  ]
  for (const b of bad) assert.equal((await add(pat.token, b)).status, 400, JSON.stringify(b).slice(0, 80))
  assert.equal((await call('POST', p, { token: pat.token, raw: '[1]' })).status, 400)

  const w1 = await add(pat.token, { kind: 'weight', value: 70.1, unit: 'lb', occurredOn: dayStr(-60) })
  assert.equal(w1.status, 201, w1.text)
  assert.equal(w1.json.entry.addedBy, 'Pat')
  assert.equal(w1.json.entry.canEdit, true)
  const w2 = await add(owner.token, { kind: 'weight', value: 31, unit: 'kg', occurredOn: dayStr(-1) })
  assert.equal(w2.status, 201)
  const vax = await add(sue.token, { kind: 'vaccine', title: '  Rabies   vaccine ', occurredOn: dayStr(-355), dueOn: dayStr(10) })
  assert.equal(vax.json.entry.title, 'Rabies vaccine')
  assert.equal(vax.json.entry.status, 'due_soon')
  assert.equal((await add(sue.token, { kind: 'vaccine', title: 'Flea and tick', dueOn: dayStr(-2) })).json.entry.status, 'overdue')
  assert.equal((await add(sue.token, { kind: 'vaccine', title: 'Bordetella', dueOn: dayStr(200) })).json.entry.status, 'ok')
  const med = await add(pat.token, { kind: 'medication', title: 'Carprofen', detail: '50 mg', schedule: 'Twice a day with food', occurredOn: dayStr(-3), dueOn: dayStr(11) })
  assert.deepEqual([med.json.entry.detail, med.json.entry.schedule, med.json.entry.dueOn], ['50 mg', 'Twice a day with food', dayStr(11)])
  assert.equal((await add(pat.token, { kind: 'vet_visit', occurredOn: dayStr(-3), detail: 'Fresh Pond Animal Hospital', title: 'Limping', notes: 'Rest for a week.' })).status, 201)
  assert.equal((await add(pat.token, { kind: 'condition', title: 'Chicken allergy' })).status, 201)
  assert.equal((await add(pat.token, { kind: 'note', notes: 'Eats grass when nervous.' })).status, 201)
  await call('PATCH', `/api/dogs/${dog.slug}`, { token: owner.token, body: { goal_minutes: 60 } })
  assert.equal((await call('POST', `/api/dogs/${dog.slug}/walks`, { token: pat.token, body: walk({ minutes: 45, miles: 2, startedAt: ago(46 * 60e3), maxSpeed: 7.4, sprints: 3 }) })).status, 201)

  const all = await call('GET', `${p}?tz=0`, { token: sue.token })
  assert.equal(all.json.entries.length, 9)
  assert.ok(!all.text.includes('@'), 'no emails anywhere in the health answer')
  const s = all.json.summary
  assert.deepEqual(s.weight.latest, { value: 31, unit: 'kg', on: dayStr(-1) })
  assert.equal(s.weight.change.unit, 'kg')
  assert.equal(s.weight.change.value, -0.8, '70.1 lb is 31.8 kg')
  assert.equal(s.weight.history.length, 2)
  assert.deepEqual(s.vaccines, { overdue: 1, dueSoon: 1 })
  assert.equal(s.activity.last7.minutes, 45)
  assert.equal(s.activity.last7.topSpeed, 7.4)
  assert.equal(s.activity.last7.sprints, 3)
  assert.equal(s.activity.longestWalk.minutes, 45)
  assert.equal(s.activity.bestTopSpeed.mph, 7.4)
  assert.ok(s.activity.streakDays >= 1)
  assert.equal(s.goal.minutes, 60)
  assert.ok(s.goal.percent >= 0 && s.goal.percent <= 100)
  assert.equal(all.json.entries.find((e) => e.id === w1.json.entry.id).canEdit, false, 'Sue did not add it and is not the owner')

  // edit and delete: the creator or the owner
  const id = vax.json.entry.id
  assert.equal((await call('PATCH', `/api/health/${id}`, { body: { title: 'x' } })).status, 401)
  assert.equal((await call('PATCH', `/api/health/${id}`, { token: stranger.token, body: { title: 'x' } })).status, 403)
  assert.equal((await call('PATCH', `/api/health/${id}`, { token: pat.token, body: { title: 'x' } })).status, 403, 'another member')
  assert.equal((await call('PATCH', `/api/health/${id}`, { token: sue.token, body: { title: '' } })).status, 400)
  assert.equal((await call('PATCH', `/api/health/${id}`, { token: sue.token, body: { kind: 'note' } })).status, 400)
  assert.equal((await call('PATCH', `/api/health/${id}`, { token: sue.token, body: { dueOn: dayStr(-400) } })).status, 400, 'the whole entry is checked again')
  const ed = await call('PATCH', `/api/health/${id}`, { token: sue.token, body: { dueOn: dayStr(90), notes: 'Three year shot' } })
  assert.equal(ed.status, 200, ed.text)
  assert.deepEqual([ed.json.entry.title, ed.json.entry.dueOn, ed.json.entry.status, ed.json.entry.notes], ['Rabies vaccine', dayStr(90), 'ok', 'Three year shot'])
  assert.equal((await call('PATCH', `/api/health/${id}`, { token: owner.token, body: { title: 'Rabies (3 year)' } })).json.entry.title, 'Rabies (3 year)', 'the owner can edit any entry')
  assert.equal((await call('DELETE', `/api/health/${med.json.entry.id}`, { token: sue.token })).status, 403)
  assert.equal((await call('DELETE', `/api/health/${med.json.entry.id}`, { token: stranger.token })).status, 403)
  assert.equal((await call('DELETE', `/api/health/${med.json.entry.id}`, { token: pat.token })).status, 200)
  assert.equal((await call('DELETE', `/api/health/${med.json.entry.id}`, { token: pat.token })).status, 404)
  assert.equal((await call('DELETE', `/api/health/${w1.json.entry.id}`, { token: owner.token })).status, 200, 'the owner can delete any entry')
  assert.equal((await call('DELETE', '/api/health/nope', { token: owner.token })).status, 404)
  assert.equal((await call('GET', p, { token: owner.token })).json.entries.length, 7)
})

test('vet share link: owner made, unguessable, hashed at rest, noindex, escaped, expires after 14 days and can be revoked', async () => {
  const owner = await signIn('Vera Owner', 'vs-owner')
  const pat = await signIn('Pat Walker', 'vs-pat')
  const dog = await makeDog(owner.token, `Vetty <b>${tag}</b>`, { breed: '"><img src=x onerror=alert(1)>' })
  const p = `/api/dogs/${dog.slug}/health`
  await join(owner.token, dog.slug, pat.token)
  const evil = '<script>alert(1)</script>'
  await call('POST', p, { token: owner.token, body: { kind: 'vaccine', title: evil, dueOn: dayStr(10) } })
  await call('POST', p, { token: pat.token, body: { kind: 'condition', title: 'Chicken allergy', notes: '"quoted" & <i>tagged</i>' } })
  await call('POST', p, { token: owner.token, body: { kind: 'weight', value: 68, unit: 'lb', occurredOn: dayStr(-2) } })
  await call('POST', p, { token: owner.token, body: { kind: 'medication', title: 'Carprofen', detail: '50 mg', schedule: 'Twice a day' } })
  await call('POST', p, { token: owner.token, body: { kind: 'vet_visit', occurredOn: dayStr(-9), detail: 'Pond Vets', title: 'Annual exam' } })
  await call('POST', p, { token: owner.token, body: { kind: 'note', notes: 'PRIVATE-NOTE-NOT-FOR-THE-VET' } })

  assert.equal((await call('POST', `${p}/shares`, { token: pat.token })).status, 403, 'only the owner')
  assert.equal((await call('GET', `${p}/shares`, { token: pat.token })).status, 403)
  const before = Date.now()
  const s = await call('POST', `${p}/shares`, { token: owner.token })
  assert.equal(s.status, 201, s.text)
  assert.ok(s.json.token.length >= 40)
  assert.equal(s.json.path, `/vet/${s.json.token}`)
  const life = new Date(s.json.expiresAt).getTime() - before
  assert.ok(life > 13.9 * 864e5 && life < 14.1 * 864e5, '14 days')
  const stored = await db.query('SELECT token_hash FROM health_shares WHERE token_hash = $1', [crypto.createHash('sha256').update(s.json.token).digest('hex')])
  assert.equal(stored.rows.length, 1)
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM health_shares WHERE token_hash = $1', [s.json.token])).rows[0].n * 1, 0, 'the token itself is not stored')
  const list = await call('GET', `${p}/shares`, { token: owner.token })
  assert.equal(list.json.shares.length, 1)
  assert.ok(!list.text.includes(s.json.token), 'the list cannot rebuild the link')

  const page = await call('GET', s.json.path)
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-type'), /text\/html/)
  assert.match(page.text, /<meta name="robots" content="noindex, nofollow">/)
  assert.match(page.headers.get('x-robots-tag'), /noindex/)
  assert.equal(page.headers.get('cache-control'), 'no-store')
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/)
  assert.ok(!page.text.includes('<script'), 'no script tag survives')
  assert.ok(!page.text.includes('<img src=x'), 'the breed is escaped')
  assert.ok(page.text.includes(esc(evil)))
  assert.ok(page.text.includes('&quot;quoted&quot; &amp; &lt;i&gt;tagged&lt;/i&gt;'))
  assert.ok(page.text.includes('Vetty &lt;b&gt;'))
  for (const want of ['Due soon', 'Carprofen', '50 mg', 'Pond Vets', 'Annual exam', 'Chicken allergy', '68 lb', 'ACTIVITY']) assert.ok(page.text.includes(want), want)
  assert.ok(!page.text.includes('@example.com') && !page.text.includes(mail('vs-owner')) && !page.text.includes(mail('vs-pat')), 'no emails')
  assert.ok(!page.text.includes('Vera') && !page.text.includes('Pat Walker'), 'no names of people')
  assert.ok(!page.text.includes('PRIVATE-NOTE'), 'free notes stay with the team')
  assert.ok(!page.text.includes('—'), 'no em dashes')

  assert.equal((await call('GET', '/vet/' + 'a'.repeat(43))).status, 404)
  assert.equal((await call('GET', '/vet/short')).status, 404)
  assert.match((await call('GET', '/vet/short')).text, /noindex/)
  // expiry
  const hash = crypto.createHash('sha256').update(s.json.token).digest('hex')
  await db.query('UPDATE health_shares SET expires_at = $1 WHERE token_hash = $2', [new Date(Date.now() - 1000).toISOString(), hash])
  assert.equal((await call('GET', s.json.path)).status, 404, 'expired')
  assert.equal((await call('GET', `${p}/shares`, { token: owner.token })).json.shares.length, 0)
  // revocation
  const s2 = await call('POST', `${p}/shares`, { token: owner.token })
  assert.equal((await call('GET', s2.json.path)).status, 200)
  assert.equal((await call('DELETE', `${p}/shares/${s2.json.id}`, { token: pat.token })).status, 403)
  assert.equal((await call('DELETE', `${p}/shares/not-a-hash`, { token: owner.token })).status, 404)
  assert.equal((await call('DELETE', `${p}/shares/${s2.json.id}`, { token: owner.token })).status, 200)
  assert.equal((await call('GET', s2.json.path)).status, 404, 'revoked')
  assert.equal((await call('DELETE', `${p}/shares/${s2.json.id}`, { token: owner.token })).status, 404)
})

test('community places: box rules, add, confirm once per person, first names only, creator-only delete', async () => {
  const ann = await signIn('Ann Adder', 'pl-ann')
  const bob = await signIn('Bob Confirmer', 'pl-bob')
  // A spot nobody else in the test run uses.
  const lat = -45 - Math.random(), lng = 100 + Math.random()
  const box = (d = 0.01) => `/api/places?s=${lat - d}&w=${lng - d}&n=${lat + d}&e=${lng + d}`
  assert.equal((await call('GET', box())).status, 200, 'no sign-in needed to read')
  assert.deepEqual((await call('GET', box())).json, { places: [] })
  for (const q of ['', '?s=1&w=1&n=2', '?s=a&w=1&n=2&e=2', '?s=2&w=1&n=1&e=2', '?s=1&w=2&n=2&e=1', '?s=-91&w=1&n=2&e=2', '?s=1&w=1&n=2&e=181', '?s=&w=1&n=2&e=2']) assert.equal((await call('GET', '/api/places' + q)).status, 400, q)

  const good = { name: 'The Salty Dog Taproom', category: 'bar', lat, lng, note: 'Water bowls on the patio.' }
  assert.equal((await call('POST', '/api/places', { body: good })).status, 401)
  for (const over of [{ name: 'A' }, { name: 'x'.repeat(81) }, { name: 5 }, { category: 'pub' }, { category: undefined }, { lat: 91 }, { lng: -181 }, { lat: '42' }, { lat: undefined }, { note: 'x'.repeat(281) }]) {
    assert.equal((await call('POST', '/api/places', { token: ann.token, body: { ...good, ...over } })).status, 400, JSON.stringify(over).slice(0, 60))
  }
  const made = await call('POST', '/api/places', { token: ann.token, body: good })
  assert.equal(made.status, 201, made.text)
  const pl = made.json.place
  assert.deepEqual(Object.keys(pl).sort(), ['addedBy', 'at', 'category', 'confirmations', 'confirmed', 'id', 'name', 'note'])
  assert.deepEqual([pl.name, pl.category, pl.note, pl.addedBy, pl.confirmations, pl.confirmed], ['The Salty Dog Taproom', 'bar', 'Water bowls on the patio.', 'Ann', 1, true], 'the creator is the first confirmation')
  assert.ok(Math.abs(pl.at[0] - lat) < 1e-5 && Math.abs(pl.at[1] - lng) < 1e-5)

  const anon = await call('GET', box())
  assert.equal(anon.json.places.length, 1)
  assert.equal(anon.json.places[0].confirmed, false, 'not signed in, so never confirmed')
  assert.equal(anon.json.places[0].addedBy, 'Ann')
  assert.ok(!anon.text.includes('@') && !anon.text.includes('Adder'), 'first name only, no email')
  assert.equal((await call('GET', box(), { token: bob.token })).json.places[0].confirmed, false)
  assert.equal((await call('GET', box(), { token: ann.token })).json.places[0].confirmed, true)

  assert.equal((await call('POST', `/api/places/${pl.id}/confirm`)).status, 401)
  assert.deepEqual((await call('POST', `/api/places/${pl.id}/confirm`, { token: bob.token })).json, { confirmations: 2, confirmed: true })
  assert.deepEqual((await call('POST', `/api/places/${pl.id}/confirm`, { token: bob.token })).json, { confirmations: 2, confirmed: true }, 'a second confirm does not double count')
  assert.deepEqual((await call('POST', `/api/places/${pl.id}/confirm`, { token: ann.token })).json, { confirmations: 2, confirmed: true })
  assert.deepEqual((await call('DELETE', `/api/places/${pl.id}/confirm`, { token: bob.token })).json, { confirmations: 1, confirmed: false })
  assert.deepEqual((await call('DELETE', `/api/places/${pl.id}/confirm`, { token: bob.token })).json, { confirmations: 1, confirmed: false })
  assert.equal((await call('POST', '/api/places/nope/confirm', { token: bob.token })).status, 404)
  assert.equal((await call('POST', `/api/places/${crypto.randomUUID()}/confirm`, { token: bob.token })).status, 404)

  // A box wider than a degree is shrunk around its centre, so a far corner drops out.
  await call('POST', '/api/places', { token: ann.token, body: { ...good, name: 'Far Corner Cafe', category: 'cafe', lat: lat + 0.9, lng } })
  const wide = await call('GET', `/api/places?s=${lat - 1}&w=${lng - 1}&n=${lat + 1}&e=${lng + 1}`)
  assert.deepEqual(wide.json.places.map((x) => x.name), ['The Salty Dog Taproom'])
  assert.equal((await call('GET', `/api/places?s=${lat + 0.85}&w=${lng - 0.1}&n=${lat + 0.95}&e=${lng + 0.1}`)).json.places.length, 1)

  assert.equal((await call('DELETE', `/api/places/${pl.id}`, { token: bob.token })).status, 403, 'creator only')
  assert.equal((await call('DELETE', `/api/places/${pl.id}`)).status, 401)
  assert.equal((await call('DELETE', `/api/places/${pl.id}`, { token: ann.token })).status, 200)
  assert.equal((await call('DELETE', `/api/places/${pl.id}`, { token: ann.token })).status, 404)
  assert.deepEqual((await call('GET', box())).json.places, [])
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM place_confirms WHERE place_id = $1', [pl.id])).rows[0].n * 1, 0)
})

test('adding places is rate limited per person, and at most 300 come back', async () => {
  const l = await listen(createApp({ db, rate: { sessionMax: 1000, writeMax: 100000, readMax: 100000, placeMax: 2 } }))
  try {
    const a = await signIn('Rae Limited', 'pl-rate')
    const b = await signIn('Other Person', 'pl-rate2')
    const body = { name: 'Dog Bar', category: 'bar', lat: -60.5, lng: 20.5 }
    const post = (token) => call('POST', '/api/places', { token, body, from: l.url })
    assert.equal((await post(a.token)).status, 201)
    assert.equal((await post(a.token)).status, 201)
    const third = await post(a.token)
    assert.equal(third.status, 429)
    assert.ok(Number(third.headers.get('retry-after')) > 0)
    assert.equal((await post(b.token)).status, 201, 'the limit is per person')
    assert.equal((await call('POST', '/api/places', { token: a.token, body: { ...body, name: 'x' }, from: l.url })).status, 400, 'a rejected add does not need the limit to say no')
  } finally { await new Promise((r) => l.s.close(r)) }
  const u = await signIn('Bulk Adder', 'pl-bulk')
  const now = new Date().toISOString()
  for (let i = 0; i < 305; i++) await db.query('INSERT INTO places (id, name, category, lat, lng, note, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [crypto.randomUUID(), `Spot ${i}`, 'park', -70.5 + i * 1e-4, 50.5, '', u.id, now])
  assert.equal((await call('GET', '/api/places?s=-71&w=50&n=-70&e=51')).json.places.length, 300)
  await db.query('DELETE FROM places WHERE created_by = $1', [u.id])
})

test('walk types match src/data.js, and timed sessions with no route are valid', async () => {
  const { ACTIVITY_TYPES } = await import('../src/data.js')
  assert.deepEqual(WALK_TYPES, ACTIVITY_TYPES.map((t) => t.id), 'server/app.js WALK_TYPES and src/data.js ACTIVITY_TYPES have drifted')
  const owner = await signIn('Tye Owner', 'ty-owner')
  const dog = await makeDog(owner.token, `Typey ${tag}`)
  const p = `/api/dogs/${dog.slug}`
  for (const t of ACTIVITY_TYPES) {
    const body = t.gps ? walk({ type: t.id }) : { type: t.id, title: `${t.label} session`, minutes: 25, miles: 0 }
    const r = await call('POST', `${p}/walks`, { token: owner.token, body })
    assert.equal(r.status, 201, `${t.id}: ${r.text}`)
    if (!t.gps) assert.deepEqual([r.json.walk.miles, r.json.walk.route], [0, null])
  }
  assert.equal((await call('POST', `${p}/walks`, { token: owner.token, body: walk({ type: 'Nap' }) })).status, 400)
  const d = await call('GET', p, { token: owner.token })
  assert.equal(d.json.totals.lifetime.outings, ACTIVITY_TYPES.length)
  assert.equal(d.json.totals.lifetime.minutes, 5 * 30 + 5 * 25)
  assert.equal((await call('GET', '/api/heat')).status, 200, 'walks without a route do not break the heat endpoint')
  assert.equal((await call('GET', `/d/${dog.slug}`)).status, 200)
  assert.equal((await call('GET', `/api/dogs/${dog.slug}/health`, { token: owner.token })).status, 200)
})

test('performance statistics on a walk: validated, optional, and returned everywhere a walk is', async () => {
  const owner = await signIn('Percy Owner', 'pf-owner')
  const dog = await makeDog(owner.token, `Speedy ${tag}`)
  const p = `/api/dogs/${dog.slug}`
  const post = (over) => call('POST', `${p}/walks`, { token: owner.token, body: walk(over) })
  for (const over of [{ avgSpeed: -1 }, { avgSpeed: 41 }, { maxSpeed: 40.5 }, { maxSpeed: '7' }, { sprints: -1 }, { sprints: 501 }, { sprints: 2.5 }, { movingMinutes: 31 }, { runMinutes: 30.5 }, { movingMinutes: -1 }, { avgSpeed: 8, maxSpeed: 5 }]) {
    assert.equal((await post(over)).status, 400, JSON.stringify(over))
  }
  const full = await post({ avgSpeed: 3.04, maxSpeed: 7.44, sprints: 4, movingMinutes: 26.4, runMinutes: 3, sniffs: 9 })
  assert.equal(full.status, 201, full.text)
  assert.deepEqual([full.json.walk.avgSpeed, full.json.walk.maxSpeed, full.json.walk.sprints, full.json.walk.movingMinutes, full.json.walk.runMinutes], [3, 7.4, 4, 26.4, 3])
  const plain = await post({ title: 'No numbers' })
  assert.deepEqual([plain.json.walk.avgSpeed, plain.json.walk.maxSpeed, plain.json.walk.sprints, plain.json.walk.movingMinutes, plain.json.walk.runMinutes], [null, null, null, null, null], 'missing stays null, not zero')
  assert.equal((await post({ sniffs: undefined, title: 'Older client' })).status, 201)
  const one = await call('GET', `/api/walks/${full.json.walk.id}`, { token: owner.token })
  assert.equal(one.json.walk.maxSpeed, 7.4)
  const feed = await call('GET', `/api/feed?dog=${dog.slug}`, { token: owner.token })
  assert.equal(feed.json.walks.find((w) => w.id === full.json.walk.id).sprints, 4)
  assert.equal((await call('GET', p, { token: owner.token })).json.walks.find((w) => w.id === full.json.walk.id).avgSpeed, 3)
  const pub = await call('GET', `/api/public/dogs/${dog.slug}`)
  assert.equal(pub.json.dog.walks.find((w) => w.title === 'Morning loop').maxSpeed, 7.4)
  const page = await call('GET', `/d/${dog.slug}`)
  assert.ok(page.text.includes('TOP SPEED') && page.text.includes('7.4 mph'))
  assert.ok(!/sniff/i.test(page.text), 'sniff stops are gone from the public page: ' + page.text.slice(Math.max(0, page.text.search(/sniff/i) - 80), page.text.search(/sniff/i) + 40))
  assert.ok(page.text.includes("not the dog's own"), 'the honest line about phone speeds')
})

test('documents: members only, real PDF, JPEG, PNG or WebP by magic bytes, size limits, safe file responses', async () => {
  const owner = await signIn('Dora Owner', 'dc-owner')
  const pat = await signIn('Pat Walker', 'dc-pat')
  const sue = await signIn('Sue Family', 'dc-sue')
  const stranger = await signIn('Stray Five', 'dc-stranger')
  const dog = await makeDog(owner.token, `Papers ${tag}`)
  const p = `/api/dogs/${dog.slug}/documents`
  await join(owner.token, dog.slug, pat.token)
  await join(owner.token, dog.slug, sue.token, 'family')
  const up = (token, body) => call('POST', p, { token, body })
  const pdf = { name: 'Rabies certificate 2026', category: 'vaccination', notes: 'From the clinic', file: dataUrl('application/pdf', PDF) }

  assert.equal((await call('GET', p)).status, 401)
  assert.equal((await up(undefined, pdf)).status, 401, 'nothing is read from someone who is not signed in')
  assert.equal((await call('GET', p, { token: stranger.token })).status, 403)
  assert.equal((await up(stranger.token, pdf)).status, 403)
  assert.deepEqual((await call('GET', p, { token: pat.token })).json.documents, [])

  const rejects = [
    [{ ...pdf, file: dataUrl('image/gif', Buffer.from('GIF89a')) }, 400, 'gif'], [{ ...pdf, file: dataUrl('text/html', Buffer.from('<script>alert(1)</script>')) }, 400, 'html'],
    [{ ...pdf, file: dataUrl('image/svg+xml', Buffer.from('<svg/>')) }, 400, 'svg'], [{ ...pdf, file: dataUrl('application/pdf', Buffer.from('<html><script>alert(1)</script>')) }, 400, 'html dressed as pdf'],
    [{ ...pdf, file: dataUrl('image/png', PDF) }, 400, 'pdf declared as png'], [{ ...pdf, file: dataUrl('application/pdf', PNG) }, 400, 'png declared as pdf'], [{ ...pdf, file: 'data:application/pdf;base64,@@@@' }, 400, 'not base64'],
    [{ ...pdf, file: undefined }, 400, 'no file'], [{ ...pdf, name: '' }, 400, 'no name'], [{ ...pdf, name: 'x'.repeat(121) }, 400, 'long name'], [{ ...pdf, category: 'secrets' }, 400, 'category'], [{ ...pdf, notes: 'x'.repeat(501) }, 400, 'notes'],
    [{ ...pdf, file: dataUrl('application/pdf', Buffer.concat([PDF, Buffer.alloc(DOC_LIMITS.fileBytes)])) }, 413, 'over 5 MB'],
  ]
  for (const [body, status, why] of rejects) assert.equal((await up(pat.token, body)).status, status, why)
  assert.equal((await call('POST', p, { token: pat.token, raw: `{"name":"big","file":"${'A'.repeat(7.6 * 1024 * 1024)}"}` })).status, 413, 'the body limit')
  assert.equal(sniffDocument(Buffer.from('RIFFxxxxWEBPVP8 ')), 'image/webp')
  assert.equal(sniffDocument(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(sniffDocument(Buffer.from('hello')), '')

  const a = await up(pat.token, pdf)
  assert.equal(a.status, 201, a.text)
  assert.deepEqual([a.json.document.name, a.json.document.category, a.json.document.contentType, a.json.document.size, a.json.document.uploadedBy, a.json.document.inVetSummary, a.json.document.canEdit], ['Rabies certificate 2026', 'vaccination', 'application/pdf', PDF.length, 'Pat', false, true])
  assert.ok(!('data' in a.json.document) && !('file' in a.json.document))
  const b = await up(sue.token, { name: 'Tag "photo"; ../../etc/passwd\r\nX-Evil: 1', category: 'licence', file: dataUrl('image/png', PNG) })
  assert.equal(b.status, 201, b.text)
  const big = await up(owner.token, { name: 'Just under the limit', file: dataUrl('application/pdf', Buffer.concat([PDF, Buffer.alloc(DOC_LIMITS.fileBytes - PDF.length)])) })
  assert.equal(big.status, 201, 'exactly 5 MB is allowed')
  assert.equal(big.json.document.category, 'other')

  const list = await call('GET', p, { token: sue.token })
  assert.equal(list.json.documents.length, 3)
  assert.equal(list.json.usedBytes, PDF.length + PNG.length + DOC_LIMITS.fileBytes)
  assert.ok(list.text.length < 3000, 'metadata only, never the bytes')
  assert.ok(!list.text.includes('@'))

  const f = `/api/documents/${a.json.document.id}/file`
  assert.equal((await call('GET', f)).status, 401)
  assert.equal((await call('GET', f, { token: stranger.token })).status, 403)
  const res = await fetch(base + f, { headers: { authorization: `Bearer ${sue.token}` } })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/pdf')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.match(res.headers.get('content-security-policy'), /sandbox/)
  assert.equal(res.headers.get('content-disposition'), 'inline; filename="Rabies certificate 2026.pdf"')
  assert.match(res.headers.get('cache-control'), /no-store/)
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(PDF), 'the same bytes come back')
  const res2 = await fetch(`${base}/api/documents/${b.json.document.id}/file`, { headers: { authorization: `Bearer ${pat.token}` } })
  assert.equal(res2.headers.get('content-type'), 'image/png')
  assert.equal(res2.headers.get('content-disposition'), 'inline; filename="Tag photo ....etcpasswd X-Evil 1.png"', 'nothing in a name can break out of the header')
  assert.equal(safeFilename('', 'image/jpeg'), 'document.jpg')
  assert.equal(safeFilename('scan.JPEG', 'image/jpeg'), 'scan.JPEG')
  assert.equal((await call('GET', '/api/documents/nope/file', { token: owner.token })).status, 404)

  // rename, recategorize, notes: the uploader or the owner
  const d = `/api/documents/${a.json.document.id}`
  assert.equal((await call('PATCH', d, { token: sue.token, body: { name: 'x' } })).status, 403)
  assert.equal((await call('PATCH', d, { token: stranger.token, body: { name: 'x' } })).status, 403)
  assert.equal((await call('PATCH', d, { token: pat.token, body: {} })).status, 400)
  assert.equal((await call('PATCH', d, { token: pat.token, body: { category: 'nope' } })).status, 400)
  const ren = await call('PATCH', d, { token: pat.token, body: { name: 'Rabies cert', category: 'vet', notes: 'Renamed' } })
  assert.deepEqual([ren.json.document.name, ren.json.document.category, ren.json.document.notes], ['Rabies cert', 'vet', 'Renamed'])
  assert.equal((await call('PATCH', d, { token: pat.token, body: { inVetSummary: true } })).status, 403, 'only the owner decides what the vet link shows')

  // a health entry and an award can point at a document of the same dog
  const other = await makeDog(owner.token, `Other papers ${tag}`)
  const stray = await call('POST', `/api/dogs/${other.slug}/documents`, { token: owner.token, body: pdf })
  const h = `/api/dogs/${dog.slug}/health`
  assert.equal((await call('POST', h, { token: pat.token, body: { kind: 'vaccine', title: 'Rabies', documentId: stray.json.document.id } })).status, 400, 'not this dog\'s document')
  const vax = await call('POST', h, { token: pat.token, body: { kind: 'vaccine', title: 'Rabies', documentId: a.json.document.id } })
  assert.deepEqual(vax.json.entry.document, { id: a.json.document.id, name: 'Rabies cert' })
  const vax2 = await call('POST', h, { token: pat.token, body: { kind: 'vaccine', title: 'Bordetella' } })
  assert.equal((await call('PATCH', `/api/health/${vax2.json.entry.id}`, { token: pat.token, body: { documentId: a.json.document.id } })).json.entry.document.id, a.json.document.id)
  assert.equal((await call('PATCH', `/api/health/${vax2.json.entry.id}`, { token: pat.token, body: { documentId: null } })).json.entry.document, null)

  // never public, and on the vet page only when the owner ticks it
  assert.ok(!(await call('GET', `/d/${dog.slug}`)).text.includes('Rabies cert'))
  assert.ok(!(await call('GET', `/api/public/dogs/${dog.slug}`)).text.includes('Rabies cert'))
  const share = await call('POST', `${h}/shares`, { token: owner.token })
  assert.ok(!(await call('GET', share.json.path)).text.includes('Rabies cert'))
  assert.equal((await call('GET', `${share.json.path}/doc/${a.json.document.id}`)).status, 404, 'not ticked, so not reachable through the link')
  assert.equal((await call('PATCH', d, { token: owner.token, body: { inVetSummary: true } })).json.document.inVetSummary, true)
  const vetPage = await call('GET', share.json.path)
  assert.ok(vetPage.text.includes('Rabies cert') && vetPage.text.includes(`${share.json.path}/doc/${a.json.document.id}`))
  assert.ok(!vetPage.text.includes('Tag photo'), 'other documents stay out')
  const viaVet = await fetch(`${base}${share.json.path}/doc/${a.json.document.id}`)
  assert.equal(viaVet.status, 200)
  assert.equal(viaVet.headers.get('x-content-type-options'), 'nosniff')
  assert.match(viaVet.headers.get('content-security-policy'), /sandbox/)
  assert.equal((await call('GET', `${share.json.path}/doc/${b.json.document.id}`)).status, 404)
  await call('DELETE', `${h}/shares/${share.json.id}`, { token: owner.token })
  assert.equal((await call('GET', `${share.json.path}/doc/${a.json.document.id}`)).status, 404, 'the document link dies with the share link')

  // 50 MB per dog
  await db.query('UPDATE documents SET size_bytes = $1 WHERE id = $2', [DOC_LIMITS.dogBytes - PDF.length - PNG.length - 10, big.json.document.id])
  assert.equal((await up(pat.token, pdf)).status, 413, 'the dog is full')
  await db.query('UPDATE documents SET size_bytes = $1 WHERE id = $2', [DOC_LIMITS.fileBytes, big.json.document.id])

  // delete: the uploader or the owner
  assert.equal((await call('DELETE', d, { token: sue.token })).status, 403)
  assert.equal((await call('DELETE', d, { token: stranger.token })).status, 403)
  assert.equal((await call('DELETE', d, { token: pat.token })).status, 200)
  assert.equal((await call('GET', f, { token: pat.token })).status, 404)
  assert.equal((await call('GET', h, { token: pat.token })).json.entries.find((e) => e.id === vax.json.entry.id).document, null, 'the entry stops pointing at a deleted document')
  assert.equal((await call('DELETE', `/api/documents/${b.json.document.id}`, { token: owner.token })).status, 200, 'the owner can delete any')
  assert.equal((await call('GET', p, { token: owner.token })).json.documents.length, 1)
})

test('awards: members-only CRUD, only the owner makes one public, and only public ones reach /d/:slug', async () => {
  const owner = await signIn('Ava Owner', 'aw-owner')
  const pat = await signIn('Pat Walker', 'aw-pat')
  const stranger = await signIn('Stray Six', 'aw-stranger')
  const dog = await makeDog(owner.token, `Shelf ${tag}`)
  const p = `/api/dogs/${dog.slug}/awards`
  await join(owner.token, dog.slug, pat.token)
  assert.equal((await call('GET', p)).status, 401)
  assert.equal((await call('GET', p, { token: stranger.token })).status, 403)
  assert.equal((await call('POST', p, { token: stranger.token, body: { title: 'x' } })).status, 403)
  for (const b of [{}, { title: '' }, { title: 'x'.repeat(81) }, { title: 'T', kind: 'trophy' }, { title: 'T', awardedOn: 'June' }, { title: 'T', awardedOn: dayStr(9) }, { title: 'T', placement: 'x'.repeat(61) }, { title: 'T', public: 'yes' }, { title: 'T', documentId: crypto.randomUUID() }]) {
    assert.equal((await call('POST', p, { token: pat.token, body: b })).status, 400, JSON.stringify(b).slice(0, 60))
  }
  assert.equal((await call('POST', p, { token: pat.token, body: { title: 'Sneaky', public: true } })).status, 403, 'a member cannot publish')
  const secret = await call('POST', p, { token: pat.token, body: { title: 'Private <b>ribbon</b>', kind: 'ribbon', eventName: 'Backyard match', placement: 'Second', awardedOn: dayStr(-20), notes: 'Team only' } })
  assert.equal(secret.status, 201, secret.text)
  assert.deepEqual([secret.json.award.kind, secret.json.award.public, secret.json.award.addedBy, secret.json.award.placement], ['ribbon', false, 'Pat', 'Second'])
  const shown = await call('POST', p, { token: owner.token, body: { title: 'Trick dog <i>novice</i>', kind: 'trick', public: true, awardedOn: dayStr(-5) } })
  assert.equal(shown.json.award.public, true)
  const list = await call('GET', p, { token: pat.token })
  assert.equal(list.json.awards.length, 2)
  assert.ok(Array.isArray(list.json.badges) && list.json.badges.length >= 6)
  assert.ok(!list.text.includes('@'))

  const pub = await call('GET', `/api/public/dogs/${dog.slug}`)
  assert.deepEqual(pub.json.dog.awards.map((a) => a.title), ['Trick dog <i>novice</i>'])
  const page = await call('GET', `/d/${dog.slug}`)
  assert.ok(page.text.includes('Trick dog &lt;i&gt;novice&lt;/i&gt;') && page.text.includes('AWARDS'))
  assert.ok(!page.text.includes('Private') && !page.text.includes('Backyard match') && !page.text.includes('<i>novice'))

  const id = secret.json.award.id
  assert.equal((await call('PATCH', `/api/awards/${id}`, { token: stranger.token, body: { title: 'x' } })).status, 403)
  assert.equal((await call('PATCH', `/api/awards/${id}`, { token: pat.token, body: { public: true } })).status, 403)
  assert.equal((await call('PATCH', `/api/awards/${id}`, { token: pat.token, body: { kind: 'nope' } })).status, 400)
  assert.equal((await call('PATCH', `/api/awards/${id}`, { token: pat.token, body: { title: 'Second place ribbon' } })).json.award.title, 'Second place ribbon')
  assert.equal((await call('PATCH', `/api/awards/${shown.json.award.id}`, { token: pat.token, body: { title: 'x' } })).status, 403, 'not theirs')
  assert.equal((await call('PATCH', `/api/awards/${id}`, { token: owner.token, body: { public: true } })).json.award.public, true)
  assert.equal((await call('GET', `/api/public/dogs/${dog.slug}`)).json.dog.awards.length, 2)
  assert.equal((await call('PATCH', `/api/awards/${id}`, { token: owner.token, body: { public: false } })).json.award.public, false)
  assert.equal((await call('GET', `/api/public/dogs/${dog.slug}`)).json.dog.awards.length, 1)
  assert.equal((await call('DELETE', `/api/awards/${shown.json.award.id}`, { token: pat.token })).status, 403)
  assert.equal((await call('DELETE', `/api/awards/${id}`, { token: stranger.token })).status, 403)
  assert.equal((await call('DELETE', `/api/awards/${id}`, { token: pat.token })).status, 200)
  assert.equal((await call('DELETE', `/api/awards/${id}`, { token: pat.token })).status, 404)
  assert.equal((await call('DELETE', `/api/awards/${shown.json.award.id}`, { token: owner.token })).status, 200)
  assert.ok(!(await call('GET', `/d/${dog.slug}`)).text.includes('AWARDS'))
})

test('earned badges come from saved walks and are not stored', async () => {
  const now = Date.now(), D = 864e5
  const w = (daysAgo, over = {}) => ({ started_at: new Date(now - daysAgo * D).toISOString(), miles: 4, minutes: 60, place: 'Pond', user_id: 'a', type: 'Walk', max_speed: null, sprints: null, ...over })
  const none = lifetimeBadges([], 0, now)
  assert.ok(none.every((b) => !b.earned && b.progress === 0))
  assert.deepEqual(none.map((b) => b.id).sort(), ['first-sprint', 'first-walk', 'miles-100', 'miles-25', 'people-3', 'places-5', 'speed-pb', 'streak-7'])
  const some = lifetimeBadges([...[0, 1, 2, 3, 4, 5, 6].map((d) => w(d, { place: `Place ${d % 5}`, user_id: `u${d % 3}` })), w(20, { max_speed: 6 }), w(1, { max_speed: 8.1, sprints: 2 }), w(3, { type: 'Daycare', miles: 500 })], 0, now)
  const by = Object.fromEntries(some.map((b) => [b.id, b]))
  assert.deepEqual(['first-walk', 'streak-7', 'miles-25', 'places-5', 'people-3', 'first-sprint', 'speed-pb'].map((k) => by[k].earned), [true, true, true, true, true, true, true])
  assert.equal(by['miles-100'].earned, false)
  assert.equal(by['miles-100'].progress, 36, 'daycare miles do not count')
  assert.equal(lifetimeBadges([w(0, { max_speed: 9 })], 0, now).find((b) => b.id === 'speed-pb').earned, false, 'a first speed is not yet a personal best')
  assert.equal(lifetimeBadges([w(30, { max_speed: 9 }), w(1, { max_speed: 7 })], 0, now).find((b) => b.id === 'speed-pb').earned, false)

  const owner = await signIn('Bea Owner', 'bd-owner')
  const dog = await makeDog(owner.token, `Badger ${tag}`)
  const badges = async () => Object.fromEntries((await call('GET', `/api/dogs/${dog.slug}/awards`, { token: owner.token })).json.badges.map((b) => [b.id, b]))
  assert.equal((await badges())['first-walk'].earned, false)
  await call('POST', `/api/dogs/${dog.slug}/walks`, { token: owner.token, body: walk({ sprints: 2, maxSpeed: 6 }) })
  const after = await badges()
  assert.equal(after['first-walk'].earned, true)
  assert.equal(after['first-sprint'].earned, true)
  assert.deepEqual([after['miles-25'].progress, after['miles-25'].target, after['miles-25'].earned], [1.5, 25, false])
})

test('events: anyone reads, signed-in people add, validated, first names only, creator-only delete', async () => {
  const ann = await signIn('Ann Organizer', 'ev-ann')
  const bob = await signIn('Bob Other', 'ev-bob')
  const good = { name: `Fun match ${tag}`, kind: 'fun_match', startsOn: dayStr(20), endsOn: dayStr(21), venue: 'Town green', city: 'Testville', region: 'MA', lat: 12.5, lng: 77.5, url: 'https://example.org/match?x=1', description: 'Bring water.' }
  assert.equal((await call('POST', '/api/events', { body: good })).status, 401)
  const bads = [{ name: 'A' }, { name: 'x'.repeat(101) }, { kind: 'race' }, { startsOn: 'soon' }, { startsOn: '2026-13-01' }, { startsOn: dayStr(-10) }, { startsOn: dayStr(800) }, { endsOn: dayStr(19) }, { endsOn: dayStr(70) }, { city: '' }, { lat: 91 }, { lng: undefined },
    { url: 'javascript:alert(1)' }, { url: 'ftp://example.org/x' }, { url: 'data:text/html,<script>1</script>' }, { url: 'https://user:pw@example.org' }, { url: 'not a url' }, { url: 'https://example.org/"><script>' }, { description: 'x'.repeat(601) }]
  for (const over of bads) assert.equal((await call('POST', '/api/events', { token: ann.token, body: { ...good, ...over } })).status, 400, JSON.stringify(over).slice(0, 70))
  assert.equal(httpUrl('HTTPS://Example.org/a'), 'https://example.org/a')
  const made = await call('POST', '/api/events', { token: ann.token, body: good })
  assert.equal(made.status, 201, made.text)
  const ev = made.json.event
  assert.deepEqual([ev.name, ev.kind, ev.startsOn, ev.endsOn, ev.city, ev.addedBy, ev.curated, ev.mine, ev.going, ev.url], [good.name, 'fun_match', dayStr(20), dayStr(21), 'Testville', 'Ann', false, true, 0, good.url])
  const bare = await call('POST', '/api/events', { token: ann.token, body: { name: `Later class ${tag}`, kind: 'class', startsOn: dayStr(40), city: 'Elsewhere' } })
  assert.equal(bare.status, 201)
  assert.deepEqual([bare.json.event.at, bare.json.event.url, bare.json.event.endsOn], [null, null, null])

  const anon = await call('GET', '/api/events')
  assert.equal(anon.status, 200, 'no sign-in needed to read')
  const mine = anon.json.events.filter((e) => e.name.endsWith(tag))
  assert.deepEqual(mine.map((e) => e.name), [good.name, `Later class ${tag}`], 'upcoming first')
  assert.ok(!anon.text.includes('@') && !anon.text.includes('Organizer'), 'first name only')
  assert.equal(mine[0].mine, false)
  const dates = anon.json.events.map((e) => e.startsOn)
  assert.deepEqual(dates, dates.slice().sort())
  assert.equal((await call('GET', `/api/events?from=${dayStr(30)}`)).json.events.filter((e) => e.name.endsWith(tag)).length, 1)
  assert.equal((await call('GET', '/api/events?from=tomorrow')).status, 400)
  assert.equal((await call('GET', '/api/events?near=abc')).status, 400)
  assert.equal((await call('GET', '/api/events?near=95,10')).status, 400)
  const near = await call('GET', '/api/events?near=12.9,77.6')
  assert.deepEqual(near.json.events.map((e) => e.name), [good.name], 'about 30 miles away, inside the radius, and events without a pin are left out')
  assert.equal((await call('GET', '/api/events?near=14.5,77.5')).json.events.length, 0, 'about 138 miles away')

  assert.equal((await call('DELETE', `/api/events/${ev.id}`, { token: bob.token })).status, 403)
  assert.equal((await call('DELETE', `/api/events/${bare.json.event.id}`, { token: ann.token })).status, 200)
  assert.equal((await call('DELETE', `/api/events/${bare.json.event.id}`, { token: ann.token })).status, 404)

  // going, then a result
  const dog = await makeDog(bob.token, `Shower ${tag}`)
  const e = `/api/events/${ev.id}/entries/${dog.slug}`
  assert.equal((await call('PUT', e, { body: {} })).status, 401)
  assert.equal((await call('PUT', e, { token: ann.token, body: {} })).status, 403, 'not on that dog\'s team')
  assert.equal((await call('PUT', e, { token: bob.token, body: { status: 'maybe' } })).status, 400)
  assert.equal((await call('PUT', e, { token: bob.token, body: { status: 'going', result: 'First' } })).status, 400)
  const going = await call('PUT', e, { token: bob.token, body: { status: 'going' } })
  assert.deepEqual([going.json.event.going, going.json.event.entries], [1, [{ dog: dog.slug, name: dog.name, status: 'going', result: null }]])
  await call('PUT', e, { token: bob.token, body: { status: 'going' } })
  const res = await call('PUT', e, { token: bob.token, body: { status: 'attended', result: 'Second in novice' } })
  assert.deepEqual([res.json.event.going, res.json.event.entries[0].status, res.json.event.entries[0].result], [1, 'attended', 'Second in novice'], 'one entry per dog')
  assert.equal((await call('GET', '/api/events', { token: ann.token })).json.events.find((x) => x.id === ev.id).entries.length, 0, 'entries are only shown for your own dogs')
  assert.equal((await call('GET', `/api/dogs/${dog.slug}/events`, { token: bob.token })).json.events[0].entries[0].result, 'Second in novice')
  assert.equal((await call('GET', `/api/dogs/${dog.slug}/events`, { token: ann.token })).status, 403)
  assert.equal((await call('DELETE', e, { token: bob.token })).json.event.going, 0)
  assert.equal((await call('DELETE', `/api/events/${ev.id}`, { token: ann.token })).status, 200)
})

test('adding events is rate limited per person', async () => {
  const l = await listen(createApp({ db, rate: { sessionMax: 1000, writeMax: 100000, readMax: 100000, eventMax: 1 } }))
  try {
    const a = await signIn('Eve Limited', 'ev-rate')
    const body = { name: `Limited ${tag}`, kind: 'meetup', startsOn: dayStr(3), city: 'Testville' }
    const first = await call('POST', '/api/events', { token: a.token, body, from: l.url })
    assert.equal(first.status, 201)
    assert.equal((await call('POST', '/api/events', { token: a.token, body, from: l.url })).status, 429)
    await call('DELETE', `/api/events/${first.json.event.id}`, { token: a.token })
  } finally { await new Promise((r) => l.s.close(r)) }
})

test('curated events: seeding twice leaves one row each, edits update, past ones are skipped, nobody can delete them', async () => {
  const mem = await createDb('')
  const l = await listen(createApp({ db: mem, rate: { sessionMax: 1000 } }))
  try {
    const data = { note: 'test', events: [
      { name: 'Curated show A', kind: 'conformation', starts_on: dayStr(5), ends_on: dayStr(6), venue: null, city: 'Springfield', region: 'MA', lat: 42.1, lng: -72.6, url: 'https://example.org/a', description: 'All-breed show.' },
      { name: 'Curated show B', kind: 'obedience', starts_on: dayStr(9), ends_on: null, venue: 'Hall', city: 'Concord', region: 'NC', lat: 35.4, lng: -80.6, url: 'https://example.org/b', description: '' },
      { name: 'Already over', kind: 'agility', starts_on: dayStr(-9), ends_on: dayStr(-8), venue: '', city: 'Gone', region: 'MA', lat: 1, lng: 1, url: 'https://example.org/c', description: '' },
      { name: 'Ends today', kind: 'agility', starts_on: dayStr(-1), ends_on: dayStr(0), venue: '', city: 'Now', region: 'MA', lat: 1, lng: 1, url: 'https://example.org/d', description: '' },
      { name: 'Bad link', kind: 'agility', starts_on: dayStr(3), ends_on: null, venue: '', city: 'X', region: 'MA', lat: 1, lng: 1, url: 'javascript:alert(1)', description: '' },
    ] }
    assert.equal(await seedEvents(mem, data), 3)
    assert.equal(await seedEvents(mem, data), 3)
    assert.equal((await mem.query('SELECT COUNT(*) AS n FROM events')).rows[0].n * 1, 3, 'one row per event')
    data.events[0].venue = 'Big E grounds'
    await seedEvents(mem, data)
    const list = await call('GET', '/api/events', { from: l.url })
    assert.deepEqual(list.json.events.map((e) => e.name), ['Ends today', 'Curated show A', 'Curated show B'])
    const a = list.json.events[1]
    assert.deepEqual([a.venue, a.curated, a.sourceUrl, a.addedBy, a.approximate, a.mine], ['Big E grounds', true, 'https://example.org/a', null, true, false])
    const r = await call('POST', '/api/session', { body: { name: 'Del Eter', email: 'del@example.com' }, from: l.url })
    assert.equal((await call('DELETE', `/api/events/${a.id}`, { token: r.json.token, from: l.url })).status, 403, 'curated events cannot be deleted by users')
    const real = JSON.parse(fs.readFileSync(new URL('./seed-events.json', import.meta.url), 'utf8'))
    const kept = await seedEvents(mem, real)
    await seedEvents(mem, real)
    assert.equal((await mem.query('SELECT COUNT(*) AS n FROM events')).rows[0].n * 1, 3 + kept, 'the shipped file seeds without duplicates')
    assert.ok(kept <= real.events.length)
  } finally { await new Promise((r) => l.s.close(r)); await mem.close() }
})

test('leaderboards: ranked from saved walks, ties share a rank, private and opted-out dogs are left off, no people in the answer', async () => {
  const breed = `Testhound ${tag}`
  const ownerA = await signIn('Lena Secretname', 'lb-a')
  const ownerB = await signIn('Omar Hiddenname', 'lb-b')
  const mk = async (o, name, extra = {}) => makeDog(o.token, `${name} ${tag}`, { breed, city: `Rankton ${tag}`, ...extra })
  const top = await mk(ownerA, 'Topdog', { weight: 70 }), mid = await mk(ownerA, 'Middog', { weight: 30 }), tie = await mk(ownerB, 'Alsomid', { weight: 30 })
  const priv = await mk(ownerB, 'Private', { weight: 30 }), out = await mk(ownerB, 'Optout', { weight: 30 }), idle = await mk(ownerB, 'Idle', { weight: 30 }), play = await mk(ownerB, 'Player', { weight: 30 })
  const post = (o, d, over) => call('POST', `/api/dogs/${d.slug}/walks`, { token: o.token, body: walk({ startedAt: ago(60e3), minutes: 1, ...over }) })
  await post(ownerA, top, { miles: 3, maxSpeed: 5 }); await post(ownerA, top, { miles: 2.5 })
  await post(ownerA, mid, { miles: 2, maxSpeed: 9.5 }); await post(ownerB, tie, { miles: 2 })
  await post(ownerB, priv, { miles: 50 }); await post(ownerB, out, { miles: 60 })
  await call('POST', `/api/dogs/${play.slug}/walks`, { token: ownerB.token, body: { type: 'Play time', title: 'Tug', minutes: 40, miles: 0, startedAt: ago(41 * 60e3) } })
  await post(ownerB, top, {}).then((r) => assert.equal(r.status, 403))
  await call('PATCH', `/api/dogs/${priv.slug}`, { token: ownerB.token, body: { public: false } })
  await call('PATCH', `/api/dogs/${out.slug}`, { token: ownerB.token, body: { leaderboards: false } })
  // Walks outside the window and daycare days do not count.
  await rawWalk(mid.slug, Date.now() - 70 * 864e5, 99)
  await post(ownerA, mid, { type: 'Daycare', miles: 80, title: 'Daycare' })

  const q = (extra = '') => `/api/leaderboards?scope=breed&breed=${encodeURIComponent(breed)}${extra}`
  const board = await call('GET', q())
  assert.equal(board.status, 200, board.text)
  assert.deepEqual(board.json.rows.map((r) => [r.rank, r.slug, r.value]), [[1, top.slug, 5.5], [2, tie.slug, 2], [2, mid.slug, 2]], 'ties share a rank and sort by name; timed sessions are not on the distance board')
  assert.deepEqual(Object.keys(board.json.rows[0]).sort(), ['breed', 'isDemo', 'name', 'photoUrl', 'rank', 'slug', 'value', 'you'])
  assert.deepEqual([board.json.total, board.json.few, board.json.metric, board.json.scope, board.json.period.kind, board.json.you], [3, true, 'miles', 'breed', 'week', null])
  for (const hidden of ['Lena', 'Omar', 'Secretname', 'Hiddenname', '@', priv.slug, out.slug, idle.slug]) assert.ok(!board.text.includes(hidden), `${hidden} must not appear`)

  const outings = await call('GET', q('&metric=outings&period=month'))
  assert.deepEqual(outings.json.rows.map((r) => [r.rank, r.slug, r.value]), [[1, top.slug, 2], [2, tie.slug, 1], [2, mid.slug, 1], [2, play.slug, 1]], 'outings count timed sessions')
  assert.deepEqual((await call('GET', q('&metric=minutes'))).json.rows[0], { rank: 1, name: play.name, slug: play.slug, breed, photoUrl: null, isDemo: false, value: 40, you: false })
  assert.deepEqual((await call('GET', q('&metric=top_speed'))).json.rows.map((r) => [r.slug, r.value]), [[mid.slug, 9.5], [top.slug, 5]], 'best single-walk top speed, dogs without a speed are left off')

  const meA = await call('GET', q(`&dog=${mid.slug}`), { token: ownerA.token })
  assert.deepEqual(meA.json.you, { rank: 2, value: 2, inTop: true })
  assert.equal(meA.json.rows.find((r) => r.slug === mid.slug).you, true)
  assert.equal((await call('GET', `/api/leaderboards?scope=breed&dog=${mid.slug}`, { token: ownerA.token })).json.scopeLabel, breed, 'the dog\'s own breed is the default')
  assert.deepEqual([(await call('GET', q(`&dog=${priv.slug}`), { token: ownerB.token })).json.you, (await call('GET', q(`&dog=${priv.slug}`), { token: ownerB.token })).json.youNote], [null, 'private'])
  assert.equal((await call('GET', q(`&dog=${out.slug}`), { token: ownerB.token })).json.youNote, 'opted_out')
  assert.equal((await call('GET', q(`&dog=${idle.slug}`), { token: ownerB.token })).json.youNote, 'no_walks')
  assert.equal((await call('GET', q(`&dog=${top.slug}`), { token: ownerB.token })).status, 403, 'someone else\'s dog cannot be the reference')
  const city = await call('GET', `/api/leaderboards?scope=city&city=${encodeURIComponent('rankton ' + tag)}&metric=outings`)
  assert.equal(city.json.total, 4, 'city match ignores case')
  const size = await call('GET', `/api/leaderboards?scope=size&dog=${top.slug}`, { token: ownerA.token })
  assert.match(size.json.scopeLabel, /Large/)
  assert.ok(size.json.rows.some((r) => r.slug === top.slug) && !size.json.rows.some((r) => r.slug === mid.slug))
  const all = await call('GET', '/api/leaderboards')
  assert.equal(all.status, 200)
  assert.ok(all.json.rows.length <= 50)
  assert.ok(!all.json.rows.some((r) => r.slug === priv.slug || r.slug === out.slug))
  for (const bad of ['?period=year', '?metric=steps', '?scope=planet', '?scope=breed', '?scope=city', '?scope=size']) assert.equal((await call('GET', '/api/leaderboards' + bad)).status, 400, bad)
  assert.deepEqual(rank([{ name: 'B', slug: 'b', value: 3 }, { name: 'A', slug: 'a', value: 3 }, { name: 'C', slug: 'c', value: 9 }, { name: 'D', slug: 'd', value: 1 }]).map((r) => [r.rank, r.slug]), [[1, 'c'], [2, 'a'], [2, 'b'], [4, 'd']])
})

test('challenges: joining is idempotent, progress is computed inside the window only, and finishing earns the badge', async () => {
  const now = Date.now(), m = monthWindow(now)
  assert.equal(new Date(m.start).getUTCDate(), 1)
  assert.equal(new Date(weekWindow(now).start).getUTCDay(), 1, 'weeks start on Monday')
  assert.equal(new Date(weekendWindow(now).start).getUTCDay(), 6)
  assert.equal(weekendWindow(now).end - weekendWindow(now).start, 2 * 864e5)
  const w = (t, over = {}) => ({ started_at: new Date(t).toISOString(), miles: 2, minutes: 30, place: 'Pond', user_id: 'a', type: 'Walk', ...over })
  assert.equal(challengeProgress('month-25', [w(now), w(now, { miles: 3.26 }), w(now, { type: 'Daycare', miles: 40 })]), 5.3)
  assert.equal(challengeProgress('explorer-5', [w(now, { place: 'Pond' }), w(now, { place: ' pond ' }), w(now, { place: 'Fells' }), w(now, { place: '' })]), 2)
  assert.equal(challengeProgress('team-3', [w(now), w(now, { user_id: 'b' }), w(now, { user_id: 'b' })]), 2)
  assert.equal(challengeProgress('streak-7', [0, 1, 2, 5].map((d) => w(now - d * 864e5))), 3)
  assert.equal(challengeProgress('weekend-long', [w(now, { minutes: 75 }), w(now, { minutes: 20 })]), 75)
  assert.equal(challengeProgress('play-120', [w(now, { type: 'Play time', minutes: 50 }), w(now, { type: 'Fetch', minutes: 20 }), w(now, { minutes: 90 })]), 70)

  const owner = await signIn('Cora Owner', 'ch-owner')
  const pat = await signIn('Pat Walker', 'ch-pat')
  const stranger = await signIn('Stray Seven', 'ch-stranger')
  const dog = await makeDog(owner.token, `Challenger ${tag}`)
  await join(owner.token, dog.slug, pat.token)
  const anon = await call('GET', '/api/challenges')
  assert.equal(anon.status, 200)
  assert.deepEqual(anon.json.challenges.map((c) => c.key), CHALLENGES.map((c) => c.key))
  assert.ok(!('joined' in anon.json.challenges[0]))
  assert.equal(anon.json.challenges[0].periodKey, m.key)
  const p = `/api/dogs/${dog.slug}/challenges/month-25`
  assert.equal((await call('POST', p)).status, 401)
  assert.equal((await call('POST', p, { token: stranger.token })).status, 403)
  assert.equal((await call('POST', `/api/dogs/${dog.slug}/challenges/nope`, { token: owner.token })).status, 404)
  const j1 = await call('POST', p, { token: pat.token })
  assert.deepEqual([j1.status, j1.json.challenge.joined, j1.json.challenge.progress, j1.json.challenge.completed], [200, true, 0, false])
  const count = j1.json.challenge.joinedDogs
  const j2 = await call('POST', p, { token: owner.token })
  assert.equal(j2.json.challenge.joinedDogs, count, 'joining twice counts once')
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM challenge_joins j JOIN dogs d ON d.id = j.dog_id WHERE d.slug = $1', [dog.slug])).rows[0].n * 1, 1)

  // One walk just before the month began, one inside it.
  const insert = (t, miles) => rawWalk(dog.slug, t, miles)
  await insert(m.start - 1000, 20)
  await insert(m.start, 4)
  const st = async () => (await call('GET', `/api/challenges?dog=${dog.slug}`, { token: owner.token })).json.challenges.find((c) => c.key === 'month-25')
  assert.deepEqual([(await st()).progress, (await st()).percent, (await st()).joined], [4, 16, true], 'the walk a second before the window is not counted')
  await insert(m.end, 30)
  assert.equal((await st()).progress, 4, 'nor is one at the first instant of next month')
  const badges = async () => (await call('GET', `/api/dogs/${dog.slug}/awards`, { token: owner.token })).json.badges
  assert.ok(!(await badges()).some((b) => b.kind === 'challenge'))
  await insert(m.start + 1000, 21.5)
  assert.deepEqual([(await st()).progress, (await st()).percent, (await st()).completed], [25.5, 100, true])
  const earned = (await badges()).find((b) => b.id === `challenge:month-25:${m.key}`)
  assert.ok(earned && earned.earned && earned.name.startsWith('25-mile month'), 'finishing awards the matching badge')

  const detail = await call('GET', '/api/challenges/month-25')
  assert.equal(detail.status, 200)
  const row = detail.json.rows.find((r) => r.slug === dog.slug)
  assert.deepEqual([row.value, row.completed, row.name], [25.5, true, dog.name])
  assert.ok(!detail.text.includes('Cora') && !detail.text.includes('@'), 'no owner names or emails')
  assert.equal((await call('GET', '/api/challenges/nope')).status, 404)
  await call('PATCH', `/api/dogs/${dog.slug}`, { token: owner.token, body: { public: false } })
  assert.ok(!(await call('GET', '/api/challenges/month-25')).json.rows.some((r) => r.slug === dog.slug), 'a private dog is not on the challenge board')
  const left = await call('DELETE', p, { token: pat.token })
  assert.deepEqual([left.json.challenge.joined, left.json.challenge.joinedDogs], [false, count - 1])
  assert.equal((await call('DELETE', p, { token: pat.token })).json.challenge.joined, false, 'leaving twice is fine')
  assert.ok(!(await badges()).some((b) => b.kind === 'challenge'), 'the badge belongs to a joined challenge')
})

test('a person on the team: totals with the dog, their outings, role changes by the owner, and never an email', async () => {
  const owner = await signIn('Mona Owner', 'pm-owner')
  const pat = await signIn('Pat Walker', 'pm-pat')
  const stranger = await signIn('Stray Eight', 'pm-stranger')
  const dog = await makeDog(owner.token, `Teamy ${tag}`)
  const p = `/api/dogs/${dog.slug}`
  await join(owner.token, dog.slug, pat.token)
  await call('POST', `${p}/walks`, { token: pat.token, body: walk({ title: 'Pat recent', minutes: 30, miles: 1 }) })
  await call('POST', `${p}/walks`, { token: pat.token, body: walk({ title: 'Pat old', minutes: 60, miles: 2, startedAt: ago(20 * 864e5) }) })
  await call('POST', `${p}/walks`, { token: owner.token, body: walk({ title: 'Owner recent', minutes: 90, miles: 3 }) })
  assert.equal((await call('GET', `${p}/members/${pat.id}`)).status, 401)
  assert.equal((await call('GET', `${p}/members/${pat.id}`, { token: stranger.token })).status, 403)
  assert.equal((await call('GET', `${p}/members/${stranger.id}`, { token: owner.token })).status, 404)
  const r = await call('GET', `${p}/members/${pat.id}`, { token: owner.token })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual([r.json.member.name, r.json.member.role, r.json.member.you], ['Pat Walker', 'walker', false])
  assert.deepEqual(r.json.member.week, { outings: 1, miles: 1, minutes: 30 })
  assert.deepEqual(r.json.member.lifetime, { outings: 2, miles: 3, minutes: 90 })
  assert.equal(r.json.member.sharePercent, 25)
  assert.deepEqual(r.json.walks.map((w) => w.title), ['Pat recent', 'Pat old'])
  assert.ok(!r.text.includes('@'), 'no email')
  assert.equal((await call('GET', `${p}/members/${pat.id}`, { token: pat.token })).json.member.you, true)

  const role = (token, id, body) => call('PATCH', `${p}/members/${id}`, { token, body })
  assert.equal((await role(pat.token, pat.id, { role: 'family' })).status, 403)
  assert.equal((await role(owner.token, pat.id, { role: 'owner' })).status, 400)
  assert.equal((await role(owner.token, pat.id, { role: 'boss' })).status, 400)
  assert.equal((await role(owner.token, owner.id, { role: 'walker' })).status, 400, 'the owner stays the owner')
  assert.equal((await role(owner.token, stranger.id, { role: 'family' })).status, 404)
  assert.equal((await role(owner.token, pat.id, { role: 'family' })).status, 200)
  assert.equal((await call('GET', p, { token: owner.token })).json.team.find((m) => m.id === pat.id).role, 'family')
})

test('demo seed: idempotent, labelled, never able to sign in, and enough to fill the boards on its own', async () => {
  const mem = await createDb('')
  const l = await listen(createApp({ db: mem, rate: { sessionMax: 1000 } }))
  const hidden = await listen(createApp({ db: mem, demoOnBoards: false }))
  try {
    const a = await seedDemo(mem)
    const count = async (t) => (await mem.query(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n * 1
    const first = { users: await count('users'), dogs: await count('dogs'), walks: await count('walks'), members: await count('memberships'), joins: await count('challenge_joins'), awards: await count('awards'), paws: await count('paws') }
    const b = await seedDemo(mem)
    assert.deepEqual(a, b)
    assert.deepEqual({ users: await count('users'), dogs: await count('dogs'), walks: await count('walks'), members: await count('memberships'), joins: await count('challenge_joins'), awards: await count('awards'), paws: await count('paws') }, first, 'seeding again adds nothing')
    assert.equal(first.dogs, DEMO_DOGS.length)
    assert.ok(first.dogs >= 10 && first.walks > 200 && first.paws > 0 && first.awards >= 2 && first.joins === first.dogs * 2)
    assert.equal((await mem.query('SELECT COUNT(*) AS n FROM users WHERE is_demo = FALSE')).rows[0].n * 1, 0)
    assert.ok((await mem.query('SELECT email FROM users')).rows.every((r) => r.email.endsWith('@' + DEMO_DOMAIN)))
    for (const email of [`dale@${DEMO_DOMAIN}`, `PAT@${DEMO_DOMAIN.toUpperCase()}`, 'anyone@somewhere.invalid']) {
      const r = await call('POST', '/api/session', { body: { name: 'Dale', email }, from: l.url })
      assert.equal(r.status, 403, email)
      assert.ok(!r.json.token)
    }
    assert.equal(await count('sessions'), 0)
    // The miles on a walk are the length of its line.
    const one = (await mem.query('SELECT miles, route, started_at FROM walks WHERE route IS NOT NULL LIMIT 1')).rows[0]
    const pts = JSON.parse(one.route), R = 3958.8, rad = Math.PI / 180
    let d = 0
    for (let i = 1; i < pts.length; i++) { const x = Math.sin(((pts[i][0] - pts[i - 1][0]) * rad) / 2) ** 2 + Math.cos(pts[i - 1][0] * rad) * Math.cos(pts[i][0] * rad) * Math.sin(((pts[i][1] - pts[i - 1][1]) * rad) / 2) ** 2; d += 2 * R * Math.asin(Math.sqrt(x)) }
    assert.ok(Math.abs(d - one.miles) < 0.01, 'distance matches the line')
    assert.deepEqual(pts[0], pts[pts.length - 1], 'a closed loop')
    assert.ok((await mem.query('SELECT started_at FROM walks ORDER BY started_at DESC LIMIT 1')).rows[0].started_at.getTime() > Date.now() - 2 * 864e5, 'the newest walk is recent')
    assert.ok((await mem.query('SELECT started_at FROM walks ORDER BY started_at DESC LIMIT 1')).rows[0].started_at.getTime() <= Date.now())
    assert.ok((await mem.query('SELECT DISTINCT type FROM walks')).rows.length >= 7, 'a mix of activity types')

    const board = await call('GET', '/api/leaderboards?period=month', { from: l.url })
    assert.equal(board.status, 200)
    assert.ok(board.json.rows.length >= 8 && !board.json.few, 'boards work with only demo dogs')
    assert.ok(board.json.rows.every((r) => r.isDemo === true), 'every demo row is labelled')
    assert.ok(!board.text.includes(DEMO_DOMAIN))
    assert.ok((await call('GET', '/api/leaderboards?period=month&scope=city&city=Charlotte%2C%20NC', { from: l.url })).json.rows.length >= 3)
    assert.ok((await call('GET', '/api/leaderboards?period=month&metric=top_speed', { from: l.url })).json.rows.length >= 5)
    const pub = await call('GET', '/api/public/dogs/biscuit', { from: l.url })
    assert.deepEqual([pub.status, pub.json.dog.isDemo, pub.json.dog.name], [200, true, 'Biscuit'])
    for (const dog of DEMO_DOGS) {
      const page = await call('GET', `/d/${dog.slug}`, { from: l.url })
      assert.equal(page.status, 200, dog.slug)
      assert.ok(page.text.includes('Demo dog'), 'the public page says so')
    }
    const pack = await call('GET', '/api/pack', { from: l.url })
    assert.ok(pack.json.walks.length > 10 && pack.json.walks.every((w) => w.dog.isDemo))
    assert.ok(!pack.text.includes(DEMO_DOMAIN))
    assert.ok((await call('GET', '/api/challenges/month-25', { from: l.url })).json.rows.length >= 5)
    assert.ok((await call('GET', '/api/heat', { from: l.url })).json.points.length > 100, 'the heatmap has something to draw')
    // The flag that takes demo dogs off the boards.
    assert.equal((await call('GET', '/api/leaderboards?period=month', { from: hidden.url })).json.rows.length, 0)
    assert.equal((await call('GET', '/api/challenges/month-25', { from: hidden.url })).json.rows.length, 0)
    // A real dog that already lives at a demo address is left alone.
    const mem2 = await createDb('')
    try {
      await mem2.query('INSERT INTO users (id, name, email, created_at) VALUES ($1, $2, $3, $4)', ['u1', 'Real', 'real@example.com', new Date().toISOString()])
      await mem2.query('INSERT INTO dogs (id, slug, name, created_by, created_at) VALUES ($1, $2, $3, $4, $5)', ['d1', 'biscuit', 'Real Biscuit', 'u1', new Date().toISOString()])
      await seedDemo(mem2); await seedDemo(mem2)
      const rows = (await mem2.query('SELECT slug, is_demo FROM dogs WHERE slug LIKE $1 ORDER BY slug', ['biscuit%'])).rows
      assert.deepEqual(rows.map((r) => [r.slug, r.is_demo]), [['biscuit', false], ['biscuit-demo', true]])
    } finally { await mem2.close() }
  } finally { await new Promise((r) => l.s.close(r)); await new Promise((r) => hidden.s.close(r)); await mem.close() }
})

test('the pack feed shows public dogs only, with first names and no routes unless shared', async () => {
  const owner = await signIn('Pia Lastname', 'pk-owner')
  const viewer = await signIn('Vic Viewer', 'pk-viewer')
  const open = await makeDog(owner.token, `Packpub ${tag}`), shut = await makeDog(owner.token, `Packpriv ${tag}`)
  await call('PATCH', `/api/dogs/${shut.slug}`, { token: owner.token, body: { public: false } })
  await call('POST', `/api/dogs/${open.slug}/walks`, { token: owner.token, body: walk({ title: `Open walk ${tag}` }) })
  await call('POST', `/api/dogs/${shut.slug}/walks`, { token: owner.token, body: walk({ title: `Shut walk ${tag}` }) })
  const pack = await call('GET', '/api/pack', { token: viewer.token })
  const mine = pack.json.walks.find((w) => w.title === `Open walk ${tag}`)
  assert.ok(mine, 'a public dog\'s walk is in the pack')
  assert.deepEqual([mine.with, mine.route, mine.dog.isDemo, mine.dog.slug], ['Pia', null, false, open.slug])
  assert.ok(!pack.text.includes(`Shut walk ${tag}`) && !pack.text.includes('Lastname') && !pack.text.includes('@'))
  assert.equal((await call('GET', '/api/pack')).status, 200)
  assert.ok(!(await call('GET', '/api/pack', { token: owner.token })).text.includes(`Open walk ${tag}`), 'your own dogs are in your feed already')
})

test('static files: hashed assets are cached for a year and gzipped, index.html is always revalidated', async () => {
  fs.mkdirSync(path.join(staticDir, 'assets'), { recursive: true })
  const js = 'console.log("trot");'.repeat(400)
  fs.writeFileSync(path.join(staticDir, 'assets', 'index-abc123.js'), js)
  const gz = await fetch(base + '/assets/index-abc123.js', { headers: { 'accept-encoding': 'gzip' } })
  assert.equal(gz.status, 200)
  assert.equal(gz.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(gz.headers.get('content-encoding'), 'gzip')
  assert.match(gz.headers.get('vary'), /Accept-Encoding/i)
  assert.match(gz.headers.get('content-type'), /javascript/)
  assert.equal(await gz.text(), js)
  const raw = await fetch(base + '/assets/index-abc123.js', { headers: { 'accept-encoding': 'identity' } })
  assert.equal(raw.headers.get('content-encoding'), null)
  assert.equal(raw.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(await raw.text(), js)
  assert.ok(zlib.gzipSync(js).length < js.length / 5)
  const again = await fetch(base + '/assets/index-abc123.js', { headers: { 'accept-encoding': 'gzip', 'if-none-match': gz.headers.get('etag') } })
  assert.equal(again.status, 304)
  assert.equal((await call('GET', '/')).headers.get('cache-control'), 'no-cache')
  assert.equal((await call('GET', '/some/app/route')).headers.get('cache-control'), 'no-cache')
  assert.equal((await fetch(base + '/assets/..%2f..%2fetc%2fpasswd.js', { headers: { 'accept-encoding': 'gzip' } })).status, 404)
  assert.match((await call('GET', '/sw.js')).text, /\/vet\//, 'the service worker leaves vet links alone')
})

import { seedPlaces, geocodePlaces } from './routesPlaces.js'
test('curated places: seeded once, geocoded once, hidden until they have coordinates, never deleted by a user', async () => {
  const mem = await createDb('')
  const l = await listen(createApp({ db: mem, rate: { sessionMax: 1000 } }))
  try {
    const data = { places: [
      { name: 'Barkside Dog Park', category: 'park', address: '1 Park Road, Charlotte, NC 28203', note: 'Fenced, with water.', source_url: 'https://example.org/parks' },
      { name: 'Hound and Hops', category: 'bar', address: '2 Brew Street, Charlotte, NC 28205', note: 'Dogs on the patio.', source_url: 'https://example.org/hops' },
      { name: 'Hound and Hops', category: 'bar', address: '9 Other Street, Cornelius, NC 28031', note: 'Second location.', source_url: 'https://example.org/hops2' },
      { name: 'No address', category: 'park', address: '', note: '', source_url: 'https://example.org/x' },
      { name: 'Bad kind', category: 'castle', address: '3 Road', note: '', source_url: 'https://example.org/y' },
    ] }
    assert.equal(await seedPlaces(mem, data), 3)
    assert.equal(await seedPlaces(mem, data), 3)
    assert.equal((await mem.query('SELECT COUNT(*) AS n FROM places')).rows[0].n * 1, 3, 'one row per name and address')
    const box = '/api/places?s=35&w=-81&n=35.6&e=-80.6'
    assert.deepEqual((await call('GET', box, { from: l.url })).json.places, [], 'no coordinates yet, so nothing on the map')

    // First pass: the second lookup fails.
    const calls = []
    const fake = (fail) => async (url, opts) => {
      calls.push({ url, agent: opts.headers['User-Agent'], signal: !!opts.signal })
      const q = decodeURIComponent(url.split('q=')[1])
      if (fail(q)) return { ok: false, status: 503, json: async () => ({}) }
      return { ok: true, json: async () => [{ lat: q.startsWith('1 ') ? '35.2001' : q.startsWith('2 ') ? '35.2502' : '35.4803', lon: '-80.8404' }] }
    }
    const one = await geocodePlaces(mem, { fetchImpl: fake((q) => q.startsWith('2 Brew')), delayMs: 0 })
    assert.deepEqual(one, { found: 2, failed: 1, skipped: 0 })
    assert.equal(calls.length, 3)
    assert.ok(calls.every((c) => c.url.startsWith('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=') && /Trot/.test(c.agent) && c.signal), 'the documented endpoint, a descriptive User-Agent and a timeout signal')
    const first = await call('GET', box, { from: l.url })
    assert.deepEqual(first.json.places.map((p) => p.name).sort(), ['Barkside Dog Park', 'Hound and Hops'], 'the failed one is hidden meanwhile')
    const park = first.json.places.find((p) => p.name === 'Barkside Dog Park')
    assert.deepEqual(Object.keys(park).sort(), ['addedBy', 'address', 'at', 'category', 'confirmations', 'confirmed', 'curated', 'id', 'name', 'note', 'sourceUrl'])
    assert.deepEqual([park.curated, park.address, park.sourceUrl, park.addedBy, park.at, park.confirmations, park.confirmed, park.category], [true, '1 Park Road, Charlotte, NC 28203', 'https://example.org/parks', null, [35.2001, -80.8404], 0, false, 'park'])

    // Second pass, as at the next startup: only the missing row is looked up.
    calls.length = 0
    await seedPlaces(mem, data)
    const two = await geocodePlaces(mem, { fetchImpl: fake(() => false), delayMs: 0 })
    assert.deepEqual(two, { found: 1, failed: 0, skipped: 0 })
    assert.equal(calls.length, 1, 'a row with coordinates is never geocoded again')
    assert.match(decodeURIComponent(calls[0].url), /2 Brew Street/)
    assert.equal((await call('GET', box, { from: l.url })).json.places.length, 3)
    assert.deepEqual(await geocodePlaces(mem, { fetchImpl: async () => { throw new Error('must not be called') }, delayMs: 0 }), { found: 0, failed: 0, skipped: 0 })
    assert.equal((await mem.query('SELECT COUNT(*) AS n FROM places WHERE geocoded_at IS NOT NULL')).rows[0].n * 1, 3)
    // Junk answers and thrown errors count as failures and leave the row alone.
    await mem.query('UPDATE places SET lat = NULL, lng = NULL WHERE name = $1', ['Barkside Dog Park'])
    assert.deepEqual(await geocodePlaces(mem, { fetchImpl: async () => ({ ok: true, json: async () => [{ lat: 'abc', lon: '1' }] }), delayMs: 0 }), { found: 0, failed: 1, skipped: 0 })
    assert.deepEqual(await geocodePlaces(mem, { fetchImpl: async () => { throw new Error('network down') }, delayMs: 0 }), { found: 0, failed: 1, skipped: 0 })
    assert.equal((await call('GET', box, { from: l.url })).json.places.length, 2)
    assert.deepEqual(await geocodePlaces(mem, { fetchImpl: fake(() => false), delayMs: 0 }), { found: 1, failed: 0, skipped: 0 })

    // People can still confirm a curated place, and nobody can delete it.
    const u = await call('POST', '/api/session', { body: { name: 'Carl Confirmer', email: 'carl@example.com' }, from: l.url })
    assert.deepEqual((await call('POST', `/api/places/${park.id}/confirm`, { token: u.json.token, from: l.url })).json, { confirmations: 1, confirmed: true })
    assert.equal((await call('DELETE', `/api/places/${park.id}`, { token: u.json.token, from: l.url })).status, 403)
    assert.equal((await mem.query('SELECT COUNT(*) AS n FROM places')).rows[0].n * 1, 3)
    // A place a person adds keeps the plain shape.
    const mine = await call('POST', '/api/places', { token: u.json.token, from: l.url, body: { name: 'My spot', category: 'water', lat: 35.21, lng: -80.84 } })
    assert.deepEqual(Object.keys(mine.json.place).sort(), ['addedBy', 'at', 'category', 'confirmations', 'confirmed', 'id', 'name', 'note'])
    // The shipped list loads, without duplicates.
    const real = JSON.parse(fs.readFileSync(new URL('./seed-places.json', import.meta.url), 'utf8'))
    const n = await seedPlaces(mem, real)
    await seedPlaces(mem, real)
    assert.equal(n, real.places.length)
    assert.equal((await mem.query('SELECT COUNT(*) AS n FROM places WHERE curated = TRUE')).rows[0].n * 1, 3 + n)
  } finally { await new Promise((r) => l.s.close(r)); await mem.close() }
})
