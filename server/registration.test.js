// Registration and ID, Trot Tags, scans, found reports and Lost Dog mode.
// Loaded by server/index.js under `node --test server/`. Uses its own pg-mem database.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createDb } from './db.js'
import { createApp } from './app.js'
import { cleanMicrochip, checklist, dateStatus, agentFamily, newTagCode, REG_LINKS } from './routesRegistration.js'
import { TAG_SCRIPT, TAG_SCRIPT_HASH } from './tagPage.js'

let db, server, base
const tag = crypto.randomBytes(4).toString('hex')
const mail = (n) => `${n}-${tag}@example.com`
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10)

async function listen(app) {
  const s = app.listen(0)
  await new Promise((r) => s.once('listening', r))
  return { s, url: `http://127.0.0.1:${s.address().port}` }
}
before(async () => {
  db = await createDb()
  const l = await listen(createApp({ db, rate: { sessionMax: 1000, writeMax: 100000, readMax: 100000, tagMax: 100000, foundMax: 100000 } }))
  server = l.s; base = l.url
})
after(async () => {
  await new Promise((r) => server.close(r))
  await db.close()
})

async function call(method, p, { token, body, raw, form, ua, from = base } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (ua) headers['user-agent'] = ua
  if (body !== undefined || raw !== undefined) headers['content-type'] = 'application/json'
  if (form !== undefined) headers['content-type'] = 'application/x-www-form-urlencoded'
  const res = await fetch(from + p, { method, headers, redirect: 'manual', body: form !== undefined ? new URLSearchParams(form).toString() : raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined })
  const txt = await res.text()
  let json = null
  try { json = JSON.parse(txt) } catch (e) {}
  return { status: res.status, json, text: txt, headers: res.headers }
}
const signIn = async (name, n, from = base) => {
  const r = await call('POST', '/api/session', { body: { name, email: mail(n) }, from })
  assert.ok(r.status === 200 || r.status === 201, r.text)
  return { token: r.json.token, id: r.json.user.id }
}
const makeDog = async (token, name, extra = {}, from = base) => {
  const r = await call('POST', '/api/dogs', { token, body: { name, breed: 'Golden Retriever', weight: 68, bio: 'Swims in anything.', ...extra }, from })
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
// One dog with an owner and one person in each other role.
async function team(n, extra) {
  const owner = await signIn('Zebediah Quimbleton', `${n}-own`)
  const dog = await makeDog(owner.token, `Reg ${n} ${tag}`, extra)
  const family = await join(owner.token, dog.slug, 'family', 'Fay Family', `${n}-fam`)
  const walker = await join(owner.token, dog.slug, 'walker', 'Wes Walker', `${n}-walk`)
  const daycare = await join(owner.token, dog.slug, 'daycare', 'Happy Paws Daycare', `${n}-day`)
  const stranger = await signIn('Sam Stranger', `${n}-str`)
  return { owner, family, walker, daycare, stranger, dog, slug: dog.slug, ownerEmail: mail(`${n}-own`) }
}
const FULL = { microchipNumber: '985 112 000 123 456', microchipRegistry: 'HomeAgain', licenseNumber: 'CLT-FAKE-0042', licenseExpiresOn: day(200), rabiesTag: 'RAB-FAKE-7781', rabiesDueOn: day(300), akcNumber: 'ss12345601', altered: 'yes' }
const SECRETS = ['985112000123456', '985 112 000 123 456', 'CLT-FAKE-0042', 'RAB-FAKE-7781', 'SS12345601', 'HomeAgain']

test('pure helpers: microchip formats, date status, checklist, device family, tag codes', () => {
  assert.equal(cleanMicrochip(' 985-112-000-123-456 '), '985112000123456')
  assert.equal(cleanMicrochip('0a1b2c3d4e'), '0A1B2C3D4E')
  assert.equal(cleanMicrochip('012*345*678'), '012345678')
  assert.equal(cleanMicrochip(''), '')
  assert.equal(cleanMicrochip(null), '')
  for (const no of ['12345', '98511200012345X', '0G1B2C3D4E', '1234567890123456', '12345678A', '<script>']) assert.equal(cleanMicrochip(no), null, no)
  assert.equal(dateStatus('2027-03-01', '2027-03-02'), 'expired')
  assert.equal(dateStatus('2027-03-02', '2027-03-02'), 'expiring', 'the last day still counts as current')
  assert.equal(dateStatus('2027-04-01', '2027-03-02'), 'expiring', '30 days left')
  assert.equal(dateStatus('2027-04-02', '2027-03-02'), 'done', '31 days left')
  assert.equal(dateStatus(null, '2027-03-02'), null)
  assert.deepEqual(checklist({}, '2027-03-02').map((c) => c.status), ['missing', 'missing', 'missing'])
  assert.deepEqual(checklist({ microchipNumber: '1', licenseNumber: 'x', rabiesTag: 'y' }, '2027-03-02').map((c) => c.status), ['done', 'done', 'done'], 'a number with no date counts as done')
  assert.equal(agentFamily(IPHONE), 'Safari on iPhone or iPad')
  assert.equal(agentFamily('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36'), 'Chrome on Android')
  assert.equal(agentFamily('Slackbot-LinkExpanding 1.0'), 'bot')
  assert.equal(agentFamily(''), 'Unknown device')
  const codes = new Set([...Array(200)].map(newTagCode))
  assert.equal(codes.size, 200)
  for (const c of codes) assert.match(c, /^[2-9A-HJ-NP-Z]{12}$/, 'no 0, 1, I or O')
  assert.equal(TAG_SCRIPT_HASH, crypto.createHash('sha256').update(TAG_SCRIPT).digest('base64'))
})

test('registration: owner and family edit, walker and daycare only view, strangers and signed-out people get nothing', async () => {
  const t = await team('perm', { city: 'Charlotte' })
  const p = `/api/dogs/${t.slug}/registration`
  const empty = await call('GET', p, { token: t.owner.token })
  assert.equal(empty.status, 200)
  assert.equal(empty.json.registration.licenseJurisdiction, 'Charlotte-Mecklenburg', 'a Charlotte dog is offered its jurisdiction')
  assert.equal(empty.json.charlotte, true)
  assert.equal(empty.json.registration.altered, 'unknown')
  assert.equal(empty.json.canEdit, true)
  assert.deepEqual(empty.json.links, REG_LINKS)
  assert.ok(!JSON.stringify(empty.json).includes('$'), 'no fee amounts')

  const saved = await call('PUT', p, { token: t.owner.token, body: FULL })
  assert.equal(saved.status, 200, saved.text)
  assert.equal(saved.json.registration.microchipNumber, '985112000123456', 'stored without spaces')
  assert.equal(saved.json.registration.akcNumber, 'SS12345601')
  assert.equal(saved.json.registration.licenseJurisdiction, 'Charlotte-Mecklenburg')
  assert.deepEqual(saved.json.checklist.map((c) => c.status), ['done', 'done', 'done'])

  // Family can edit. Fields left out keep their value, and an empty string clears one.
  const fam = await call('PUT', p, { token: t.family.token, body: { rabiesTag: '', altered: 'no' } })
  assert.equal(fam.status, 200, fam.text)
  assert.equal(fam.json.registration.rabiesTag, '')
  assert.equal(fam.json.registration.altered, 'no')
  assert.equal(fam.json.registration.licenseNumber, 'CLT-FAKE-0042')

  for (const who of [t.walker, t.daycare]) {
    const g = await call('GET', p, { token: who.token })
    assert.equal(g.status, 200)
    assert.equal(g.json.canEdit, false)
    assert.equal(g.json.registration.microchipNumber, '985112000123456')
    assert.equal((await call('PUT', p, { token: who.token, body: { altered: 'yes' } })).status, 403)
  }
  assert.equal((await call('GET', p, { token: t.stranger.token })).status, 403)
  assert.equal((await call('PUT', p, { token: t.stranger.token, body: { altered: 'yes' } })).status, 403)
  assert.equal((await call('GET', p)).status, 401)
  assert.equal((await call('PUT', p, { body: { altered: 'yes' } })).status, 401)
  assert.equal((await call('GET', '/api/dogs/no-such-dog-here/registration', { token: t.owner.token })).status, 404)
  assert.equal((await call('GET', p, { token: t.owner.token })).json.registration.altered, 'no', 'the refused writes changed nothing')

  // A dog outside Charlotte is offered no jurisdiction.
  const other = await makeDog(t.owner.token, `Elsewhere ${tag}`, { city: 'Boston' })
  const o = await call('GET', `/api/dogs/${other.slug}/registration`, { token: t.owner.token })
  assert.equal(o.json.registration.licenseJurisdiction, '')
  assert.equal(o.json.charlotte, false)
})

test('registration: validation', async () => {
  const owner = await signIn('Val Owner', 'val-own')
  const dog = await makeDog(owner.token, `Val ${tag}`)
  const p = `/api/dogs/${dog.slug}/registration`
  const put = (body) => call('PUT', p, { token: owner.token, body })
  for (const ok of ['985112000123456', '0A1B2C3D4E', '0a1b2c3d4e', '012345678', ' 985 112 000 123 456 ', '']) assert.equal((await put({ microchipNumber: ok })).status, 200, ok)
  assert.equal((await call('GET', p, { token: owner.token })).json.registration.microchipNumber, '')
  for (const no of ['1234', '12345678901234', '98511200012345Z', 'ZZZZZZZZZZ', '1234567890123456', 15, ['985112000123456']]) {
    const r = await put({ microchipNumber: no })
    assert.equal(r.status, 400, JSON.stringify(no))
    assert.match(r.json.error, /15 digits|must be text/)
  }
  for (const bad of ['2027-02-30', '27-01-01', 'tomorrow', '1900-01-01', 20270101]) {
    assert.equal((await put({ licenseExpiresOn: bad })).status, 400, String(bad))
    assert.equal((await put({ rabiesDueOn: bad })).status, 400, String(bad))
  }
  assert.equal((await put({ licenseExpiresOn: null, rabiesDueOn: '' })).status, 200)
  assert.equal((await put({ altered: 'maybe' })).status, 400)
  assert.equal((await put({ microchipRegistry: 'x'.repeat(61) })).status, 400)
  assert.equal((await put({ licenseNumber: 'x'.repeat(41) })).status, 400)
  assert.equal((await put({ akcNumber: 'SS<1>' })).status, 400)
  assert.equal((await put({})).status, 400)
  assert.equal((await put({ unknownField: 1 })).status, 400)
  assert.equal((await call('PUT', p, { token: owner.token, raw: '[1]' })).status, 400)
  const tidy = await put({ microchipRegistry: '  Pet\u0007Link \n  USA ', licenseJurisdiction: 'Wake County' })
  assert.equal(tidy.json.registration.microchipRegistry, 'Pet Link USA', 'control characters go, spaces collapse')
  assert.equal(tidy.json.registration.licenseJurisdiction, 'Wake County')
})

test('checklist: done, missing, expiring within 30 days, and expired', async () => {
  const owner = await signIn('Check Owner', 'chk-own')
  const dog = await makeDog(owner.token, `Check ${tag}`)
  const p = `/api/dogs/${dog.slug}/registration?tz=0`
  const put = async (body) => { const r = await call('PUT', p, { token: owner.token, body }); assert.equal(r.status, 200, r.text); return Object.fromEntries(r.json.checklist.map((c) => [c.key, c])) }
  let c = Object.fromEntries((await call('GET', p, { token: owner.token })).json.checklist.map((x) => [x.key, x]))
  assert.deepEqual([c.microchip.status, c.license.status, c.rabies.status], ['missing', 'missing', 'missing'])
  c = await put({ microchipNumber: '985112000123456', licenseNumber: 'FAKE-1', licenseExpiresOn: day(10), rabiesDueOn: day(-3) })
  assert.equal(c.microchip.status, 'done')
  assert.equal(c.license.status, 'expiring')
  assert.match(c.license.detail, /^Expires on \d{4}-\d{2}-\d{2}$/)
  assert.equal(c.rabies.status, 'expired')
  assert.match(c.rabies.detail, /^Was due on /)
  c = await put({ licenseExpiresOn: day(30), rabiesDueOn: day(31) })
  assert.equal(c.license.status, 'expiring', 'exactly 30 days left is still expiring')
  assert.equal(c.rabies.status, 'done')
  c = await put({ licenseExpiresOn: day(-1), rabiesDueOn: day(400) })
  assert.equal(c.license.status, 'expired')
  assert.equal(c.rabies.status, 'done')
  c = await put({ licenseExpiresOn: null, licenseNumber: '' })
  assert.equal(c.license.status, 'missing')
  // An expiry date alone is enough to track, even with no number.
  c = await put({ licenseExpiresOn: day(90) })
  assert.equal(c.license.status, 'done')
})

test('tags: owner and family create, list and retire; walkers cannot; codes are unguessable and never reused', async () => {
  const t = await team('tags')
  const p = `/api/dogs/${t.slug}/tags`
  const made = await call('POST', p, { token: t.owner.token, body: { label: '  Blue collar  ' } })
  assert.equal(made.status, 201, made.text)
  const a = made.json.tag
  assert.match(a.code, /^[2-9A-HJ-NP-Z]{12}$/)
  assert.equal(a.url, `${base}/t/${a.code}`)
  assert.equal(a.label, 'Blue collar')
  assert.equal(a.active, true)
  const b = (await call('POST', p, { token: t.family.token })).json.tag
  assert.equal(b.label, 'Collar tag')
  assert.notEqual(b.code, a.code)
  for (const who of [t.walker, t.daycare, t.stranger]) {
    assert.equal((await call('POST', p, { token: who.token, body: {} })).status, 403)
    assert.equal((await call('GET', p, { token: who.token })).status, 403)
    assert.equal((await call('DELETE', `${p}/${a.id}`, { token: who.token })).status, 403)
  }
  assert.equal((await call('GET', p)).status, 401)
  assert.equal((await call('POST', p, { token: t.owner.token, body: { label: 'x'.repeat(41) } })).status, 400)
  const list = await call('GET', p, { token: t.family.token })
  assert.deepEqual(list.json.tags.map((x) => x.id).sort(), [a.id, b.id].sort())

  assert.equal((await call('GET', `/t/${a.code}`)).status, 200)
  assert.equal((await call('GET', `/t/${a.code.toLowerCase()}`)).status, 200, 'a code typed in lower case still opens')
  assert.equal((await call('DELETE', `${p}/${a.id}`, { token: t.family.token })).status, 200)
  assert.equal((await call('DELETE', `${p}/${a.id}`, { token: t.owner.token })).status, 404, 'already retired')
  assert.equal((await call('DELETE', `${p}/not-an-id`, { token: t.owner.token })).status, 404)
  assert.equal((await call('GET', `/t/${a.code}`)).status, 404)
  const after = (await call('GET', p, { token: t.owner.token })).json.tags
  assert.equal(after.find((x) => x.id === a.id).active, false)
  assert.equal(after[0].id, b.id, 'working tags are listed first')
  // Someone else's dog cannot retire this dog's tag.
  const otherDog = await makeDog(t.stranger.token, `Other ${tag}`)
  assert.equal((await call('DELETE', `/api/dogs/${otherDog.slug}/tags/${b.id}`, { token: t.stranger.token })).status, 404)
  assert.equal((await call('GET', `/t/${b.code}`)).status, 200)
  // Ten working tags at most.
  for (let i = 0; i < 9; i++) assert.equal((await call('POST', p, { token: t.owner.token, body: {} })).status, 201)
  assert.equal((await call('POST', p, { token: t.owner.token, body: {} })).status, 400)
})

test('tag page: not lost, lost, unknown and retired; strict headers; no person, contact, city or registration on it', async () => {
  const t = await team('page', { city: 'Charlotte' })
  await call('PUT', `/api/dogs/${t.slug}/registration`, { token: t.owner.token, body: FULL })
  const made = (await call('POST', `/api/dogs/${t.slug}/tags`, { token: t.owner.token, body: {} })).json.tag
  const retired = (await call('POST', `/api/dogs/${t.slug}/tags`, { token: t.owner.token, body: {} })).json.tag
  await call('DELETE', `/api/dogs/${t.slug}/tags/${retired.id}`, { token: t.owner.token })
  const clean = (html) => {
    for (const s of [...SECRETS, 'Zebediah', 'Quimbleton', 'Fay', 'Wes Walker', t.ownerEmail, 'example.com', 'Charlotte', 'Mecklenburg']) assert.ok(!html.includes(s), `tag page leaks ${s}`)
  }

  const off = await call('GET', `/t/${made.code}`, { ua: IPHONE })
  assert.equal(off.status, 200)
  assert.match(off.headers.get('content-type'), /text\/html/)
  assert.equal(off.headers.get('x-robots-tag'), 'noindex, nofollow')
  assert.equal(off.headers.get('cache-control'), 'no-store')
  assert.equal(off.headers.get('x-frame-options'), 'DENY')
  assert.equal(off.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(off.headers.get('x-content-type-options'), 'nosniff')
  const csp = off.headers.get('content-security-policy')
  assert.match(csp, /default-src 'none'/)
  assert.match(csp, /form-action 'self'/)
  assert.match(csp, /frame-ancestors 'none'/)
  assert.ok(csp.includes(`script-src 'sha256-${TAG_SCRIPT_HASH}'`) && !/script-src[^;]*unsafe-inline/.test(csp))
  assert.match(off.text, /<meta name="robots" content="noindex, nofollow">/)
  const name = t.dog.name
  assert.ok(off.text.includes(`This is ${name}.`))
  assert.ok(off.text.includes(`${name} is not reported lost.`))
  assert.ok(off.text.includes(`href="/d/${t.slug}"`), 'a public dog links to its page')
  assert.ok(off.text.includes('Golden Retriever'))
  assert.ok(!off.text.includes('<form'), 'no found form unless the dog is reported lost')
  assert.ok(!off.text.includes('<script'), 'no script unless there is a form')
  clean(off.text)

  // A private dog gets no link to a public page.
  await call('PATCH', `/api/dogs/${t.slug}`, { token: t.owner.token, body: { public: false } })
  assert.ok(!(await call('GET', `/t/${made.code}`)).text.includes('/d/'))
  await call('PATCH', `/api/dogs/${t.slug}`, { token: t.owner.token, body: { public: true } })

  assert.equal((await call('PUT', `/api/dogs/${t.slug}/lost`, { token: t.owner.token, body: { lost: true, note: 'Red harness. Shy, <b>please</b> do not chase.' } })).status, 200)
  const on = await call('GET', `/t/${made.code}`, { ua: IPHONE })
  assert.equal(on.status, 200)
  assert.ok(on.text.includes(`I found ${name}`))
  assert.ok(on.text.includes(`<form class="card" method="post" action="/t/${made.code}/found"`))
  assert.ok(on.text.includes('Red harness. Shy, &lt;b&gt;please&lt;/b&gt; do not chase.'), 'the note is escaped')
  assert.ok(on.text.includes(`<script>${TAG_SCRIPT}</script>`))
  assert.ok(on.text.includes('maxlength="280"'))
  clean(on.text)

  // Unknown, malformed and retired codes all answer with exactly the same page.
  const unknown = await call('GET', '/t/ZZZZZZZZZZZZ')
  const gone = await call('GET', `/t/${retired.code}`)
  const junk = await call('GET', '/t/not-a-code')
  for (const r of [unknown, gone, junk]) { assert.equal(r.status, 404); assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow') }
  assert.equal(gone.text, unknown.text)
  assert.equal(junk.text, unknown.text)
  assert.equal((await call('POST', `/t/${retired.code}/found`, { form: { message: 'hi' } })).text, (await call('POST', '/t/ZZZZZZZZZZZZ/found', { form: { message: 'hi' } })).text)
  assert.equal((await call('GET', `/t/${made.code}/nothing/here`)).status, 404)
  assert.equal((await call('GET', `/t/${made.code}/photo`)).status, 404, 'no photo was uploaded')
  // With a photo, the tag page serves it itself, so a private dog's tag still shows the dog. A retired tag does not.
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)])
  assert.equal((await call('PATCH', `/api/dogs/${t.slug}`, { token: t.owner.token, body: { photo: `data:image/png;base64,${png.toString('base64')}`, public: false } })).status, 200)
  const withPhoto = await call('GET', `/t/${made.code}`)
  assert.ok(withPhoto.text.includes(`<img class="av" src="/t/${made.code}/photo"`))
  const ph = await fetch(`${base}/t/${made.code}/photo`)
  assert.equal(ph.status, 200)
  assert.equal(ph.headers.get('content-type'), 'image/png')
  assert.match(ph.headers.get('content-security-policy'), /sandbox/)
  assert.deepEqual(Buffer.from(await ph.arrayBuffer()), png)
  assert.equal((await call('GET', `/t/${retired.code}/photo`)).status, 404)

  // The service worker served here leaves /t alone, the way it leaves /d alone.
  const sw = await call('GET', '/sw.js')
  assert.ok(sw.text.includes("u.pathname.startsWith('/t/')") && sw.text.includes("u.pathname.startsWith('/d/')"))
})

test('found reports: validation, sanitizing, form and JSON, and nothing about the owner in the HTML', async () => {
  const t = await team('found')
  const made = (await call('POST', `/api/dogs/${t.slug}/tags`, { token: t.owner.token, body: {} })).json.tag
  const p = `/t/${made.code}/found`
  // Not lost yet: nothing is stored.
  const early = await call('POST', p, { body: { message: 'Found your dog' } })
  assert.equal(early.status, 409)
  assert.equal((await call('POST', p, { form: { message: 'Found your dog' } })).status, 409)
  await call('PUT', `/api/dogs/${t.slug}/lost`, { token: t.owner.token, body: { lost: true } })

  const bad = [
    {}, { name: 'Ann' }, { message: '   ' },
    { message: 'x'.repeat(281) }, { message: 'hi', name: 'n'.repeat(41) }, { message: 'hi', contact: 'c'.repeat(121) },
    { message: 'hi', contact: 'call me maybe' }, { message: 'hi', contact: '12345' }, { message: 'hi', contact: 'a@b' },
    { lat: 35.2 }, { lng: -80.8 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: 'abc', lng: '1' }, { lat: '35.2; DROP', lng: '-80.8' }, { lat: [35.2], lng: -80.8 }, { lat: Infinity, lng: 1 },
    { message: 5 }, { message: ['a'] },
  ]
  for (const b of bad) {
    const r = await call('POST', p, { body: b })
    assert.equal(r.status, 400, JSON.stringify(b))
    assert.ok(r.json.error)
  }
  assert.equal((await call('POST', p, { raw: '{"message":' })).status, 400)
  assert.equal((await call('POST', p, { raw: JSON.stringify({ message: 'x'.repeat(5000) }) })).status, 413, 'the body is capped at 4 KB')
  assert.equal((await call('POST', p, { form: { message: 'y'.repeat(5000) } })).status, 413)
  const none = await db.query("SELECT COUNT(*) AS n FROM tag_scans WHERE dog_id = (SELECT id FROM dogs WHERE slug = $1) AND kind = 'found'", [t.slug])
  assert.equal(Number(none.rows[0].n), 0, 'nothing refused was stored')

  // A form post with an error comes back as the page, with what was typed still in it, escaped.
  const again = await call('POST', p, { form: { name: 'Ann', message: '<img src=x onerror=alert(1)>', contact: 'nope' } })
  assert.equal(again.status, 400)
  assert.ok(again.text.includes('Enter a phone number or an email address'))
  assert.ok(again.text.includes('&lt;img src=x onerror=alert(1)&gt;') && !again.text.includes('<img src=x'))

  const ok = await call('POST', p, { ua: IPHONE, form: { name: '  Ann   Marie Smith ', message: 'By the  fountain\r\nat\u0007Freedom Park <b>now</b>', contact: '(704) 555-0142', lat: '35.19381234', lng: '-80.84270' } })
  assert.equal(ok.status, 303)
  assert.equal(ok.headers.get('location'), `/t/${made.code}?sent=1`)
  const thanks = await call('GET', `/t/${made.code}?sent=1`)
  assert.ok(thanks.text.includes('Sent. Thank you'))
  for (const s of ['Zebediah', 'Quimbleton', t.ownerEmail, 'example.com', '704', 'Ann']) assert.ok(!thanks.text.includes(s), `thanks page leaks ${s}`)
  const viaJson = await call('POST', p, { body: { contact: 'Finder@Example.org' } })
  assert.equal(viaJson.status, 201)
  assert.deepEqual(viaJson.json, { ok: true })
  assert.equal((await call('POST', p, { body: { lat: 35.2, lng: -80.8 } })).status, 201, 'a location alone is enough')

  const list = await call('GET', `/api/dogs/${t.slug}/tags/scans`, { token: t.walker.token })
  assert.equal(list.status, 200)
  const found = list.json.scans.filter((s) => s.kind === 'found')
  assert.equal(found.length, 3)
  assert.equal(list.json.unread, 3)
  const first = found.find((s) => s.finderName === 'Ann')
  assert.equal(first.message, 'By the fountain at Freedom Park <b>now</b>', 'stored as plain text with control characters and line breaks collapsed')
  assert.equal(first.contact, '(704) 555-0142')
  assert.equal(first.lat, 35.19381)
  assert.equal(first.lng, -80.8427)
  assert.equal(first.device, 'Safari on iPhone or iPad')
  assert.equal(first.read, false)
  assert.ok(found.some((s) => s.contact === 'Finder@Example.org' && s.lat === null))

  // Mark as read: owner and family only, and only this dog's reports.
  const read = `/api/dogs/${t.slug}/tags/scans/${first.id}/read`
  assert.equal((await call('POST', read, { token: t.walker.token })).status, 403)
  assert.equal((await call('POST', read, { token: t.stranger.token })).status, 403)
  assert.equal((await call('POST', read)).status, 401)
  assert.equal((await call('POST', read, { token: t.family.token })).status, 200)
  assert.equal((await call('POST', `/api/dogs/${t.slug}/tags/scans/${crypto.randomUUID()}/read`, { token: t.owner.token })).status, 404)
  const after = await call('GET', `/api/dogs/${t.slug}/tags/scans`, { token: t.owner.token })
  assert.equal(after.json.unread, 2)
  assert.equal(after.json.scans.find((s) => s.id === first.id).read, true)
})

test('found reports are hard rate limited per connection', async () => {
  const l = await listen(createApp({ db, rate: { sessionMax: 1000, writeMax: 100000, readMax: 100000, foundMax: 2 } }))
  try {
    const owner = await signIn('Rate Owner', 'rate-own', l.url)
    const dog = await makeDog(owner.token, `Rate ${tag}`, {}, l.url)
    const made = (await call('POST', `/api/dogs/${dog.slug}/tags`, { token: owner.token, body: {}, from: l.url })).json.tag
    await call('PUT', `/api/dogs/${dog.slug}/lost`, { token: owner.token, body: { lost: true }, from: l.url })
    assert.equal((await call('POST', `/t/${made.code}/found`, { body: { message: 'one' }, from: l.url })).status, 201)
    assert.equal((await call('POST', `/t/${made.code}/found`, { form: { message: 'two' }, from: l.url })).status, 303)
    const third = await call('POST', `/t/${made.code}/found`, { body: { message: 'three' }, from: l.url })
    assert.equal(third.status, 429)
    assert.ok(Number(third.headers.get('retry-after')) > 0)
    const fourth = await call('POST', `/t/${made.code}/found`, { form: { message: 'four' }, from: l.url })
    assert.equal(fourth.status, 429)
    assert.match(fourth.headers.get('content-type'), /text\/html/)
    const list = await call('GET', `/api/dogs/${dog.slug}/tags/scans`, { token: owner.token, from: l.url })
    assert.equal(list.json.scans.filter((s) => s.kind === 'found').length, 2)
  } finally { await new Promise((r) => l.s.close(r)) }
})

test('scans: one per visitor per ten minutes, device family only, no IP stored, listed for the care team only', async () => {
  const t = await team('scan')
  const made = (await call('POST', `/api/dogs/${t.slug}/tags`, { token: t.owner.token, body: { label: 'Red collar' } })).json.tag
  const p = `/api/dogs/${t.slug}/tags/scans`
  assert.deepEqual((await call('GET', p, { token: t.owner.token })).json.scans, [])
  for (let i = 0; i < 3; i++) assert.equal((await call('GET', `/t/${made.code}`, { ua: IPHONE })).status, 200)
  await call('GET', `/t/${made.code}`, { ua: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' })
  await call('GET', '/t/ZZZZZZZZZZZZ', { ua: IPHONE })
  for (const who of [t.owner, t.family, t.walker, t.daycare]) {
    const r = await call('GET', p, { token: who.token })
    assert.equal(r.status, 200)
    assert.equal(r.json.scans.length, 1, 'three views in a row are one scan, and a link preview is none')
    assert.deepEqual(Object.keys(r.json.scans[0]).sort(), ['at', 'device', 'id', 'kind', 'tagLabel'])
    assert.equal(r.json.scans[0].kind, 'scan')
    assert.equal(r.json.scans[0].device, 'Safari on iPhone or iPad')
    assert.equal(r.json.scans[0].tagLabel, 'Red collar')
    assert.equal(r.json.unread, 0)
    assert.equal(r.json.canEdit, who === t.owner || who === t.family)
  }
  assert.equal((await call('GET', p, { token: t.stranger.token })).status, 403)
  assert.equal((await call('GET', p)).status, 401)

  // The table has nowhere to put an address, and what it holds has none.
  const cols = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'tag_scans'")).rows.map((r) => r.column_name)
  assert.deepEqual(cols.slice().sort(), ['agent', 'contact', 'dog_id', 'finder_name', 'id', 'kind', 'lat', 'lng', 'message', 'read_at', 'scanned_at', 'tag_id'])
  const rows = (await db.query('SELECT * FROM tag_scans')).rows
  assert.ok(rows.length > 0)
  for (const r of rows) { const s = JSON.stringify(r); assert.ok(!s.includes('127.0.0.1') && !s.includes('::1') && !s.includes('Mozilla'), s) }
})

test('Lost Dog mode: owner and family toggle it; the public page shows a banner and a link, and still no contact details', async () => {
  const t = await team('lost', { city: 'Charlotte' })
  await call('PUT', `/api/dogs/${t.slug}/registration`, { token: t.owner.token, body: FULL })
  const p = `/api/dogs/${t.slug}/lost`
  const start = await call('GET', p, { token: t.walker.token })
  assert.deepEqual(start.json, { lost: { on: false, since: null, note: '' }, canEdit: false })
  for (const who of [t.walker, t.daycare, t.stranger]) assert.equal((await call('PUT', p, { token: who.token, body: { lost: true } })).status, 403)
  assert.equal((await call('PUT', p, { body: { lost: true } })).status, 401)
  assert.equal((await call('GET', p, { token: t.stranger.token })).status, 403)
  assert.equal((await call('PUT', p, { token: t.owner.token, body: { lost: 'yes' } })).status, 400)
  assert.equal((await call('PUT', p, { token: t.owner.token, body: {} })).status, 400)
  assert.equal((await call('PUT', p, { token: t.owner.token, body: { lost: true, note: 'x'.repeat(141) } })).status, 400)
  const before = await call('GET', `/d/${t.slug}`)
  assert.ok(!before.text.includes('Reported lost'))

  const on = await call('PUT', p, { token: t.family.token, body: { lost: true, note: 'Slipped her collar near <Freedom Park>.' } })
  assert.equal(on.status, 200, on.text)
  assert.equal(on.json.lost.on, true)
  assert.equal(on.json.lost.note, 'Slipped her collar near <Freedom Park>.')
  // Saying it again keeps the first time and takes the new note.
  const again = await call('PUT', p, { token: t.owner.token, body: { lost: true, note: 'Blue harness.' } })
  assert.equal(again.json.lost.since, on.json.lost.since)
  assert.equal(again.json.lost.note, 'Blue harness.')
  // A link for the public page was made, since this dog had no tag.
  const tags = (await call('GET', `/api/dogs/${t.slug}/tags`, { token: t.owner.token })).json.tags
  assert.equal(tags.length, 1)
  assert.equal(tags[0].kind, 'link')
  await call('PUT', p, { token: t.owner.token, body: { lost: true, note: 'Blue harness.' } })
  assert.equal((await call('GET', `/api/dogs/${t.slug}/tags`, { token: t.owner.token })).json.tags.length, 1, 'only one link is ever made')

  const page = await call('GET', `/d/${t.slug}`)
  assert.equal(page.status, 200)
  assert.ok(page.text.includes('Reported lost'))
  assert.ok(page.text.includes('Blue harness.'))
  assert.ok(page.text.includes(`href="/t/${tags[0].code}"`))
  assert.ok(page.text.includes(`I found ${t.dog.name}`))
  for (const s of [...SECRETS, 'Quimbleton', t.ownerEmail, 'example.com']) assert.ok(!page.text.includes(s), `public page leaks ${s}`)
  // The public JSON carries no registration and no lost details either.
  const pub = await call('GET', `/api/public/dogs/${t.slug}`)
  for (const s of [...SECRETS, 'Quimbleton', t.ownerEmail, tags[0].code]) assert.ok(!pub.text.includes(s), `public API leaks ${s}`)
  assert.equal((await call('GET', `/api/public/dogs/${t.slug}/registration`)).status, 404)
  assert.equal((await call('GET', `/api/public/dogs/${t.slug}/tags`)).status, 404)
  // Signed-in answers that are not the registration endpoint do not carry it either.
  for (const path of [`/api/dogs/${t.slug}`, '/api/me', `/api/dogs/${t.slug}/tags/scans`, '/api/feed', '/api/pack']) {
    const r = await call('GET', path, { token: t.walker.token })
    for (const s of SECRETS) assert.ok(!r.text.includes(s), `${path} carries ${s}`)
  }
  const tagPage = await call('GET', `/t/${tags[0].code}`)
  assert.ok(tagPage.text.includes('Blue harness.') && tagPage.text.includes('<form'))

  const off = await call('PUT', p, { token: t.owner.token, body: { lost: false, note: 'ignored' } })
  assert.deepEqual(off.json.lost, { on: false, since: null, note: '' })
  assert.ok(!(await call('GET', `/d/${t.slug}`)).text.includes('Reported lost'))
  assert.ok(!(await call('GET', `/t/${tags[0].code}`)).text.includes('<form'))

  // A private dog can be lost too: its tag page works and its public page stays a 404.
  await call('PATCH', `/api/dogs/${t.slug}`, { token: t.owner.token, body: { public: false } })
  await call('PUT', p, { token: t.owner.token, body: { lost: true } })
  assert.equal((await call('GET', `/d/${t.slug}`)).status, 404)
  assert.ok((await call('GET', `/t/${tags[0].code}`)).text.includes(`I found ${t.dog.name}`))
})
