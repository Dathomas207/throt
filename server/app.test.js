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
