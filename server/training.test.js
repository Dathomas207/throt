// Training: the bundled lessons (lint), the badge and streak rules (pure functions), and the API.
// Loaded by server/index.js under `node --test server/`. Uses its own pg-mem database.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createDb } from './db.js'
import { createApp } from './app.js'
import { NOTIFY_KINDS, NOTIFY_GROUPS } from './routesNotifications.js'
import { USAGE_EVENTS, cleanProps } from './routesUsage.js'
import { levelOf } from './routesTraining.js'
import { TRACKS, SKILLS, SKILL_IDS, skillOf, trackOf, computeBadges, newlyEarned, badgeKey, trackTier, practiceStreak, nextUp, selfCheck, selfReported, CHECK_COUNT, PATIO_PRO, TRAIL_READY, PLACE_IDS } from '../src/training/skills.js'
import { LESSONS, LESSON_LIST, PRIMER, PUPPY_NOTE, PRO_NOTE, TITLES_NOTE, CARE_NOTE, TRACK_NOTES } from '../src/training/content.js'
import { badgeSvg } from '../src/training/badgeArt.js'

let db, server, base
const tag = crypto.randomBytes(4).toString('hex')
const mail = (n) => `${n}-${tag}@example.com`
const RATE = { sessionMax: 100000, writeMax: 100000, readMax: 100000, searchMax: 100000, usageMax: 100000 }
const DAY = 864e5

before(async () => {
  db = await createDb()
  server = createApp({ db, rate: RATE }).listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => { await new Promise((r) => server.close(r)); await db.close() })

async function call(method, p, { token, body } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(base + p, { method, headers, redirect: 'manual', body: body !== undefined ? JSON.stringify(body) : undefined })
  const txt = await res.text()
  let json = null
  try { json = JSON.parse(txt) } catch (e) {}
  return { status: res.status, json, text: txt }
}
const signIn = async (name, n) => { const r = await call('POST', '/api/session', { body: { name, email: mail(n) } }); assert.ok(r.status === 200 || r.status === 201, r.text); return { token: r.json.token, id: r.json.user.id, name } }
const makeDog = async (token, name) => { const r = await call('POST', '/api/dogs', { token, body: { name, breed: 'Mixed', weight: 40, bio: '' } }); assert.equal(r.status, 201, r.text); return r.json.dog }
const join = async (owner, slug, role, name, n) => {
  const inv = await call('POST', `/api/dogs/${slug}/invites`, { token: owner.token, body: { role } })
  assert.equal(inv.status, 201, inv.text)
  const u = await signIn(name, n)
  assert.equal((await call('POST', `/api/invites/${inv.json.token}/accept`, { token: u.token })).status, 200)
  return u
}
const S = (skillId, extra = {}) => ({ skillId, minutes: 3, repsOk: 4, repsTotal: 5, place: 'home', note: '', ...extra })
const log = (u, slug, skillId, extra, q = '') => call('POST', `/api/dogs/${slug}/training/sessions${q}`, { token: u.token, body: S(skillId, extra) })
const YES = [true, true, true]
const confirm = (u, slug, skillId, level, checks = YES) => call('POST', `/api/dogs/${slug}/training/skills/${skillId}/level`, { token: u.token, body: { level, checks } })
const get = async (u, slug, q = '') => { const r = await call('GET', `/api/dogs/${slug}/training${q}`, { token: u.token }); assert.equal(r.status, 200, r.text); return r.json }
const inbox = async (u) => (await call('GET', '/api/notifications', { token: u.token })).json.items.filter((i) => i.kind === 'training_badge')
// Takes one skill to a level through the API: practice, then the family's confirmation.
async function reach(u, slug, skillId, level) {
  assert.equal((await log(u, slug, skillId)).status, 201)
  if (level >= 2) assert.equal((await confirm(u, slug, skillId, 2)).status, 200)
  if (level >= 3) { assert.equal((await log(u, slug, skillId, { place: 'out' })).status, 201); assert.equal((await confirm(u, slug, skillId, 3)).status, 200) }
}
const all = (ids, level) => Object.fromEntries(ids.map((id) => [id, level]))
const ids = (trackId) => trackOf(trackId).skills.map((s) => s.id)
const byId = (list) => Object.fromEntries(list.map((b) => [b.id, b]))

// ---- content lint -----------------------------------------------------------------
const BANNED = ['punish', 'correction', 'choke', 'prong', 'shock', 'e-collar', 'alpha', 'dominance']
const everyString = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => everyString(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => everyString(x, out)); return out }

test('training content: six tracks of 5 to 7 skills, unique ids, and a lesson for exactly the shared skill list', () => {
  assert.deepEqual(TRACKS.map((t) => t.id), ['foundations', 'loose-leash', 'recall', 'out-and-about', 'trail-park', 'tricks'])
  for (const t of TRACKS) { assert.ok(t.skills.length >= 5 && t.skills.length <= 7, t.id); assert.ok(t.blurb && TRACK_NOTES[t.id], t.id) }
  assert.equal(new Set(SKILL_IDS).size, SKILL_IDS.length)
  for (const id of SKILL_IDS) assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  assert.deepEqual(Object.keys(LESSONS).sort(), [...SKILL_IDS].sort())
  assert.deepEqual(LESSON_LIST.map((l) => l.id), SKILL_IDS)
  for (const id of [...PATIO_PRO, ...TRAIL_READY]) assert.ok(skillOf(id), id)
  assert.equal(skillOf('heel-perfectly'), null)
})

test('training content: every skill has every field, 4 to 7 steps, a 3 to 5 minute session and a checkable pass standard', () => {
  for (const s of SKILLS) {
    const l = LESSONS[s.id], where = s.id
    assert.ok(typeof l.goal === 'string' && l.goal.length > 15 && !l.goal.includes('\n'), where + ' goal')
    assert.ok(Array.isArray(l.need) && l.need.length >= 1 && l.need.every((x) => typeof x === 'string' && x), where + ' need')
    assert.ok(Array.isArray(l.steps) && l.steps.length >= 4 && l.steps.length <= 7, `${where} has ${l.steps.length} steps`)
    for (const st of l.steps) assert.ok(typeof st === 'string' && st.length > 10 && st.length < 260, where + ' step length')
    assert.ok(typeof l.easier === 'string' && l.easier.length > 10, where + ' easier')
    assert.ok(typeof l.harder === 'string' && l.harder.length > 10, where + ' harder')
    assert.ok(Array.isArray(l.mistakes) && l.mistakes.length >= 2, where + ' mistakes')
    assert.ok(Number.isInteger(l.minutes) && l.minutes >= 3 && l.minutes <= 5, where + ' minutes')
    // A pass standard has to carry a number a person can count against.
    for (const k of ['home', 'out']) assert.ok(typeof l.pass[k] === 'string' && /\d/.test(l.pass[k]) && l.pass[k].length > 20, `${where} pass.${k}`)
    const qs = [...selfCheck(2, l.pass, 'Rex'), ...selfCheck(3, l.pass, 'Rex')]
    assert.equal(qs.length, CHECK_COUNT * 2)
    assert.ok(qs[0].includes(l.pass.home) && qs[CHECK_COUNT].includes(l.pass.out) && qs.every((q) => q.endsWith('?')))
  }
})

test('training content: reward-based wording only, no em dashes, no certification claims, and the safety notes are there', () => {
  const strings = everyString({ LESSONS, PRIMER, PUPPY_NOTE, PRO_NOTE, TITLES_NOTE, CARE_NOTE, TRACK_NOTES, TRACKS, badges: computeBadges({}).map((b) => [b.name, b.how]) })
  assert.ok(strings.length > 400)
  for (const s of strings) {
    const low = s.toLowerCase()
    for (const w of BANNED) assert.ok(!low.includes(w), `"${w}" in: ${s}`)
    assert.ok(!/[—–]/.test(s), `dash in: ${s}`)
    assert.ok(!/\b(certified dog|trot certified|guarantee)/i.test(s), `claim in: ${s}`)
  }
  // The professional-help note names every case, points to a kind of professional and names no business.
  for (const w of ['fear', 'aggression', 'guarding', 'left alone', 'bite history', 'certified trainer', 'veterinary behaviorist']) assert.ok(PRO_NOTE.toLowerCase().includes(w), w)
  assert.match(TITLES_NOTE, /not a certification/); assert.match(TITLES_NOTE, /own evaluators/); assert.match(TITLES_NOTE, /Awards/)
  assert.match(PUPPY_NOTE, /vet/); assert.match(PUPPY_NOTE, /vaccination/)
  assert.ok(PRIMER.sections.length >= 5 && ['Timing', 'Rate of reward', 'End on a win', 'When to stop'].every((h) => PRIMER.sections.some((x) => x.h === h)))
  // Off-leash work is always conditional, with a long line first.
  for (const id of ['recall', 'trail-park']) assert.match(TRACK_NOTES[id], /legal and safe/)
  for (const id of ['recall-from-distraction', 'trail-check-ins']) { assert.match(LESSONS[id].note, /legal and safe/); assert.ok(LESSONS[id].need.some((n) => /long line/i.test(n))) }
})

// ---- badge rules (pure) --------------------------------------------------------------
test('training badges: a skill badge appears at level 2 and upgrades at level 3', () => {
  const at = (v) => byId(computeBadges({ levels: { sit: v }, sessions: 1 }))['skill:sit']
  assert.deepEqual([at(0).earned, at(1).earned], [false, false])
  assert.deepEqual([at(2).earned, at(2).tier, at(2).name], [true, 'reliable', 'Sit: reliable at home'])
  assert.deepEqual([at(3).earned, at(3).tier, at(3).name], [true, 'proofed', 'Sit: proofed in public'])
  assert.notEqual(badgeKey(at(2)), badgeKey(at(3)))
  // The upgrade counts as newly earned; an unchanged badge does not.
  assert.deepEqual(newlyEarned(computeBadges({ levels: { sit: 2 } }), computeBadges({ levels: { sit: 3 } })).map((b) => b.id), ['skill:sit'])
  assert.deepEqual(newlyEarned(computeBadges({ levels: { sit: 2 } }), computeBadges({ levels: { sit: 2 } })), [])
  assert.deepEqual(newlyEarned(computeBadges({ levels: { sit: 3 } }), computeBadges({ levels: { sit: 2 } })), [])
  assert.deepEqual(newlyEarned(computeBadges({ levels: all(ids('recall'), 3) }), computeBadges({ levels: all(ids('recall'), 2) })), [])
  const list = computeBadges({})
  assert.equal(list.length, TRACKS.length + SKILLS.length + 6)
  assert.equal(new Set(list.map((b) => b.id)).size, list.length)
  assert.ok(list.every((b) => !b.earned && b.tier === null && b.how && b.target > 0))
})

test('training badges: track tiers are Bronze at half, Silver at all reliable, Gold at all proofed', () => {
  for (const t of TRACKS) {
    const n = t.skills.length, half = Math.ceil(n / 2), sk = t.skills.map((s) => s.id)
    const tier = (levels) => byId(computeBadges({ levels }))[`track:${t.id}`]
    assert.equal(tier(all(sk.slice(0, half - 1), 3)).tier, null, t.id)
    assert.equal(tier(all(sk.slice(0, half - 1), 3)).earned, false)
    assert.equal(tier(all(sk.slice(0, half), 2)).tier, 'bronze', t.id)
    assert.equal(tier(all(sk.slice(0, n - 1), 3)).tier, 'bronze', t.id)
    assert.equal(tier({ ...all(sk, 2) }).tier, 'silver', t.id)
    assert.equal(tier({ ...all(sk, 3), [sk[0]]: 2 }).tier, 'silver', t.id)
    assert.equal(tier(all(sk, 3)).tier, 'gold', t.id)
    assert.equal(tier(all(sk, 3)).name, `${t.name} Gold`)
    // Level 1 (learning) never counts.
    assert.equal(tier(all(sk, 1)).tier, null)
    assert.deepEqual(trackTier(t, all(sk.slice(0, half), 2)), { tier: 'bronze', at2: half, at3: 0, n })
  }
  // Foundations has 6 skills (Bronze at 3), Recall has 5 (Bronze at 3).
  assert.equal(byId(computeBadges({ levels: all(ids('foundations').slice(0, 2), 2) }))['track:foundations'].tier, null)
  assert.equal(byId(computeBadges({ levels: all(ids('recall').slice(0, 2), 2) }))['track:recall'].tier, null)
})

test('training badges: first session, 7 day streak, 30 sessions, Patio pro, Trail ready and Good neighbor', () => {
  const b = (state) => byId(computeBadges(state))
  assert.equal(b({ sessions: 0 })['cross:first-session'].earned, false)
  assert.equal(b({ sessions: 1 })['cross:first-session'].earned, true)
  assert.equal(b({ sessions: 40, bestStreak: 6 })['cross:streak-7'].earned, false)
  assert.equal(b({ bestStreak: 7 })['cross:streak-7'].earned, true)
  assert.equal(b({ sessions: 29 })['cross:sessions-30'].earned, false)
  assert.deepEqual([b({ sessions: 29 })['cross:sessions-30'].progress, b({ sessions: 31 })['cross:sessions-30'].progress], [29, 30])
  assert.equal(b({ sessions: 30 })['cross:sessions-30'].earned, true)
  assert.deepEqual(PATIO_PRO, ['patio-settle', 'leave-it', 'polite-greeting'])
  assert.equal(b({ levels: all(PATIO_PRO, 2) })['cross:patio-pro'].earned, false)
  assert.equal(b({ levels: { ...all(PATIO_PRO, 3), 'leave-it': 2 } })['cross:patio-pro'].earned, false)
  assert.equal(b({ levels: all(PATIO_PRO, 3) })['cross:patio-pro'].earned, true)
  assert.deepEqual(TRAIL_READY, ['recall-from-distraction', 'trail-check-ins', 'leave-wildlife'])
  assert.equal(b({ levels: all(TRAIL_READY.slice(0, 2), 3) })['cross:trail-ready'].earned, false)
  assert.equal(b({ levels: all(TRAIL_READY, 3) })['cross:trail-ready'].earned, true)
  const f = ids('foundations'), l = ids('loose-leash')
  assert.equal(b({ levels: all(f, 3) })['cross:good-neighbor'].earned, false)
  assert.equal(b({ levels: { ...all(f, 2), ...all(l.slice(1), 2) } })['cross:good-neighbor'].earned, false)
  assert.equal(b({ levels: { ...all(f, 2), ...all(l, 2) } })['cross:good-neighbor'].earned, true)
  // Gold counts as at least Silver.
  assert.equal(b({ levels: { ...all(f, 3), ...all(l, 2) } })['cross:good-neighbor'].earned, true)
})

test('training badge art: fixed shapes only, and a locked badge is an outline', () => {
  for (const x of computeBadges({ levels: all(SKILL_IDS, 3), sessions: 30, bestStreak: 7 })) { const svg = badgeSvg(x); assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>') && !/undefined|NaN/.test(svg), x.id) }
  assert.match(badgeSvg({ group: 'skill', tier: null, glyph: 'block', earned: false }), /stroke-dasharray="4 3"/)
  assert.ok(!badgeSvg({ group: '<script>', tier: '"><script>', glyph: '<x>', earned: true }, '9;"').includes('script'))
  assert.match(badgeSvg({ group: 'cross', tier: 'special', glyph: 'thirty', earned: true }), /font-style="italic"[^>]*>30</)
})

// ---- streaks and the next-up suggestion (pure) ------------------------------------------
test('training streak: days follow the time zone the browser reports', () => {
  const at = (d, h, m = 0) => Date.UTC(2026, 2, d, h, m)
  // 03:30 UTC on the 11th is still the evening of the 10th in New York (tz 240 in March, daylight time).
  const times = [at(9, 22), at(11, 3, 30), at(11, 23)]
  const now = at(12, 1)
  // UTC: practice on the 9th and 11th, "today" is the 12th. The run is one day long and still alive from yesterday.
  assert.deepEqual(practiceStreak(times, now, 0), { current: 1, best: 1, today: false })
  // New York: the same three sessions fall on the 9th, 10th and 11th, and it is still the 11th.
  assert.deepEqual(practiceStreak(times, now, 240), { current: 3, best: 3, today: true })
  // Tokyo (tz -540): they fall on the 10th, 11th and 12th.
  assert.deepEqual(practiceStreak(times, now, -540), { current: 3, best: 3, today: true })
  // A gap of a full day ends the current run, and the best run is kept.
  const week = [...Array(7)].map((_, i) => at(1 + i, 12))
  assert.deepEqual(practiceStreak(week, at(20, 12), 0), { current: 0, best: 7, today: false })
  assert.deepEqual(practiceStreak([...week, at(19, 9)], at(20, 12), 0), { current: 1, best: 7, today: false })
  // Two sessions on one day count once.
  assert.deepEqual(practiceStreak([at(5, 8), at(5, 20)], at(5, 21), 0), { current: 1, best: 1, today: true })
  assert.deepEqual(practiceStreak([], now, 0), { current: 0, best: 0, today: false })
})

test('training next up: Foundations first, then the easiest unpassed skill in the most recent track', () => {
  assert.equal(nextUp({}, null).skillId, 'name-response')
  assert.equal(nextUp({ 'name-response': 2, sit: 1 }, null).skillId, 'sit')
  // The newest session was in Recall, so the suggestion stays there.
  assert.equal(nextUp({ 'name-response': 2, 'come-indoors': 2 }, 'come-indoors').skillId, 'come-in-yard')
  // That track is all reliable at home: back to the first gap from Foundations onward.
  assert.equal(nextUp({ ...all(ids('recall'), 2), 'name-response': 2 }, 'emergency-recall').skillId, 'sit')
  // Everything reliable at home: the first skill not yet proofed in public.
  assert.equal(nextUp({ ...all(SKILL_IDS, 2), 'name-response': 3 }, null).skillId, 'sit')
  assert.equal(nextUp(all(SKILL_IDS, 3), 'sit'), null)
  assert.deepEqual([levelOf(0, 0), levelOf(0, 3), levelOf(2, 0), levelOf(3, 9), levelOf(1, 0)], [0, 1, 2, 3, 0])
})

// ---- API: who can do what ----------------------------------------------------------------
test('training API: the care team can read and log, only owner and family confirm, outsiders get nothing', async () => {
  const own = await signIn('Olive Owner', 'p-own'), dog = await makeDog(own.token, 'Pepper')
  const fam = await join(own, dog.slug, 'family', 'Fern Family', 'p-fam')
  const wal = await join(own, dog.slug, 'walker', 'Walt Walker', 'p-wal')
  const day = await join(own, dog.slug, 'daycare', 'Happy Tails Daycare', 'p-day')
  const out = await signIn('Otto Outsider', 'p-out')
  const p = `/api/dogs/${dog.slug}/training`
  assert.equal((await call('GET', p)).status, 401)
  assert.equal((await call('POST', `${p}/sessions`, { body: S('sit') })).status, 401)
  assert.equal((await call('GET', p, { token: out.token })).status, 403)
  assert.equal((await log(out, dog.slug, 'sit')).status, 403)
  assert.equal((await confirm(out, dog.slug, 'sit', 2)).status, 403)
  assert.equal((await call('GET', '/api/dogs/no-such-dog/training', { token: own.token })).status, 404)

  const empty = await get(own, dog.slug)
  assert.deepEqual([empty.role, empty.canConfirm, empty.sessions.length, empty.totals.sessions], ['owner', true, 0, 0])
  assert.deepEqual(empty.progress, {})
  assert.equal(empty.next.skillId, 'name-response')
  assert.equal(empty.selfReported, "Self-reported by Pepper's family")
  assert.ok(empty.badges.every((b) => !b.earned))

  // Everyone on the team can log practice.
  for (const u of [own, fam, wal, day]) assert.equal((await log(u, dog.slug, 'sit', { note: `by ${u.name}` })).status, 201)
  const st = await get(wal, dog.slug)
  assert.deepEqual([st.role, st.canConfirm, st.totals.sessions, st.progress.sit.level, st.progress.sit.sessions], ['walker', false, 4, 1, 4])
  // First names for people, the whole name for a daycare.
  assert.deepEqual(st.sessions.map((s) => s.by).sort(), ['Fern', 'Happy Tails Daycare', 'Olive', 'Walt'])
  assert.deepEqual(st.sessions.filter((s) => s.mine).map((s) => s.by), ['Walt'])
  assert.equal((await get(day, dog.slug)).canConfirm, false)

  // Walkers and daycare cannot confirm a level, even with every answer a yes.
  for (const u of [wal, day]) { const r = await confirm(u, dog.slug, 'sit', 2); assert.equal(r.status, 403, r.text); assert.match(r.json.error, /owner or family/) }
  assert.equal((await get(own, dog.slug)).progress.sit.level, 1)
  // Family can.
  const ok = await confirm(fam, dog.slug, 'sit', 2)
  assert.equal(ok.status, 200, ok.text)
  assert.deepEqual([ok.json.level, ok.json.progress.sit.level, ok.json.progress.sit.passedBy], [2, 2, 'Fern'])
  assert.deepEqual(ok.json.newBadges.map((b) => b.id), ['skill:sit'])

  // Deleting: the author or the owner. Family cannot delete a walker's session, and an outsider sees a 403.
  const mine = (await get(wal, dog.slug)).sessions.find((s) => s.mine), theirs = (await get(fam, dog.slug)).sessions.find((s) => s.by === 'Happy Tails Daycare')
  assert.deepEqual([mine.canDelete, (await get(fam, dog.slug)).sessions.find((s) => s.id === mine.id).canDelete, (await get(own, dog.slug)).sessions.every((s) => s.canDelete)], [true, false, true])
  assert.equal((await call('DELETE', `/api/training/sessions/${mine.id}`, { token: fam.token })).status, 403)
  assert.equal((await call('DELETE', `/api/training/sessions/${mine.id}`, { token: out.token })).status, 403)
  assert.equal((await call('DELETE', `/api/training/sessions/${mine.id}`)).status, 401)
  assert.equal((await call('DELETE', `/api/training/sessions/${mine.id}`, { token: wal.token })).status, 200)
  assert.equal((await call('DELETE', `/api/training/sessions/${mine.id}`, { token: wal.token })).status, 404)
  assert.equal((await call('DELETE', `/api/training/sessions/${theirs.id}`, { token: own.token })).status, 200)
  assert.equal((await call('DELETE', '/api/training/sessions/not-an-id', { token: own.token })).status, 404)
  const after = await get(own, dog.slug)
  // A confirmed level stays when sessions are deleted.
  assert.deepEqual([after.totals.sessions, after.progress.sit.level], [2, 2])
})

test('training API: sessions are validated against the bundled skill list and the limits', async () => {
  const own = await signIn('Vera Valid', 'v-own'), dog = await makeDog(own.token, 'Vinnie'), other = await makeDog(own.token, 'Other')
  const badOnes = [
    [{ skillId: 'heel-perfectly' }, /not a skill/], [{ skillId: 42 }, /not a skill/], [{ skillId: '' }, /not a skill/], [{ skillId: 'constructor' }, /not a skill/],
    [{ minutes: 0 }, /Minutes/], [{ minutes: 61 }, /Minutes/], [{ minutes: 2.5 }, /whole number/], [{ minutes: '3' }, /number/],
    [{ repsTotal: 0 }, /Tries/], [{ repsTotal: 51 }, /Tries/], [{ repsOk: 6, repsTotal: 5 }, /cannot be more/], [{ repsOk: -1 }, /Successful/],
    [{ place: 'park' }, /Place must be one of: home, yard, out/], [{ place: undefined }, /Place/],
    [{ note: 'x'.repeat(141) }, /140 characters/], [{ note: 7 }, /text/],
    [{ at: 'yesterday-ish' }, /ISO date/], [{ at: new Date(Date.now() + DAY).toISOString() }, /future/], [{ at: new Date(Date.now() - 40 * DAY).toISOString() }, /30 days/],
    [{ walkId: 'nope' }, /Training outing/], [{ walkId: crypto.randomUUID() }, /Training outing/],
  ]
  for (const [extra, re] of badOnes) { const r = await log(own, dog.slug, extra.skillId === undefined ? 'sit' : extra.skillId, extra); assert.equal(r.status, 400, JSON.stringify(extra) + r.text); assert.match(r.json.error, re) }
  assert.equal((await call('POST', `/api/dogs/${dog.slug}/training/sessions`, { token: own.token, body: [] })).status, 400)
  assert.equal((await get(own, dog.slug)).totals.sessions, 0)
  for (const id of ['nope', 'SIT', 'toString']) assert.equal((await confirm(own, dog.slug, id, 2)).status, 404, id)

  // Every bundled skill and every place is accepted, and a 140 character note is kept whole.
  assert.deepEqual(PLACE_IDS, ['home', 'yard', 'out'])
  const note = 'n'.repeat(140)
  const r = await log(own, dog.slug, 'touch', { place: 'yard', minutes: 5, repsOk: 0, repsTotal: 50, note: `  ${note}  ` })
  assert.equal(r.status, 201, r.text)
  assert.deepEqual([r.json.session.skillId, r.json.session.place, r.json.session.minutes, r.json.session.repsOk, r.json.session.repsTotal, r.json.session.note, r.json.session.walkId], ['touch', 'yard', 5, 0, 50, note, null])
  assert.equal((await log(own, dog.slug, SKILL_IDS[SKILL_IDS.length - 1], { place: 'out' })).status, 201)

  // "Share to days": the session may point at this person's own Training outing for this dog, and nothing else.
  const mk = async (slug, type) => (await call('POST', `/api/dogs/${slug}/walks`, { token: own.token, body: { type, title: 'Sit practice', note: '', place: '', miles: 0, minutes: 4 } })).json.walk
  const tw = await mk(dog.slug, 'Training'), plain = await mk(dog.slug, 'Walk'), elsewhere = await mk(other.slug, 'Training')
  assert.equal(tw.type, 'Training')
  assert.equal((await log(own, dog.slug, 'sit', { walkId: plain.id })).status, 400)
  assert.equal((await log(own, dog.slug, 'sit', { walkId: elsewhere.id })).status, 400)
  const linked = await log(own, dog.slug, 'sit', { walkId: tw.id })
  assert.deepEqual([linked.status, linked.json.session.walkId], [201, tw.id])
  const pal = await join(own, dog.slug, 'walker', 'Wes Walker', 'v-wal')
  assert.equal((await log(pal, dog.slug, 'sit', { walkId: tw.id })).status, 400)
  // Totals add up, and the newest session is first.
  const st = await get(own, dog.slug)
  assert.deepEqual([st.totals.sessions, st.totals.minutes, st.sessions[0].id], [3, 5 + 3 + 3, linked.json.session.id])
})

test('training API: level rules: practice first, yes to every check, level 2 before 3, and public practice for 3', async () => {
  const own = await signIn('Lena Levels', 'l-own'), dog = await makeDog(own.token, 'Lark')
  const err = async (level, checks, re, status = 400) => { const r = await confirm(own, dog.slug, 'down', level, checks); assert.equal(r.status, status, r.text); assert.match(r.json.error, re) }
  // Nothing logged yet.
  await err(2, YES, /Log a practice session/)
  await err(3, YES, /before "Proofed out and about"/)
  await err(1, YES, /first practice session/)
  for (const lv of [0, 4, 2.5, '2', null]) assert.equal((await confirm(own, dog.slug, 'down', lv)).status, 400, String(lv))
  assert.equal((await log(own, dog.slug, 'down')).status, 201)
  assert.equal((await get(own, dog.slug)).progress.down.level, 1)
  // Level 3 needs level 2 first, however the questions are answered.
  await err(3, YES, /has to be confirmed as "Reliable at home"/)
  // Every self-check answer has to be a yes.
  for (const checks of [null, {}, [], [true, true], [true, false, true], [true, true, 'yes'], [true, true, true, true], 'yes']) await err(2, checks, /Answer yes to all 3/)
  assert.equal((await get(own, dog.slug)).progress.down.level, 1)
  const two = await confirm(own, dog.slug, 'down', 2)
  assert.deepEqual([two.status, two.json.level, two.json.newBadges.map((b) => `${b.id}@${b.tier}`).join()], [200, 2, 'skill:down@reliable'])
  assert.ok(two.json.progress.down.passedAt && two.json.progress.down.passedBy === 'Lena')
  // Asking for the level it already has changes nothing and earns nothing.
  const again = await confirm(own, dog.slug, 'down', 2, [])
  assert.deepEqual([again.status, again.json.level, again.json.newBadges.length], [200, 2, 0])
  // Level 3 needs practice logged out and about, then the checks.
  await err(3, YES, /out and about/)
  assert.equal((await log(own, dog.slug, 'down', { place: 'yard' })).status, 201)
  await err(3, YES, /out and about/)
  assert.equal((await log(own, dog.slug, 'down', { place: 'out' })).status, 201)
  await err(3, [true, true, false], /Answer yes to all 3/)
  const three = await confirm(own, dog.slug, 'down', 3)
  assert.deepEqual([three.status, three.json.level, three.json.newBadges.map((b) => `${b.id}@${b.tier}`).join()], [200, 3, 'skill:down@proofed'])
  assert.equal(byId(three.json.badges)['skill:down'].name, 'Down: proofed in public')
  // Stepping back down needs no checks and earns nothing; back to Learning clears the confirmation.
  const back = await confirm(own, dog.slug, 'down', 2, undefined)
  assert.deepEqual([back.status, back.json.level, back.json.newBadges.length, byId(back.json.badges)['skill:down'].tier], [200, 2, 0, 'reliable'])
  const learn = await confirm(own, dog.slug, 'down', 1, undefined)
  assert.deepEqual([learn.status, learn.json.level, learn.json.progress.down.passedAt, byId(learn.json.badges)['skill:down'].earned], [200, 1, null, false])
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM training_progress WHERE dog_id = $1', [dog.id])).rows[0].n, 0)
})

test('training API: badges are earned from the log and the levels, and join the existing earned badges list', async () => {
  const own = await signIn('Bea Badges', 'b-own'), dog = await makeDog(own.token, 'Bramble')
  const first = await log(own, dog.slug, 'name-response')
  assert.deepEqual(first.json.newBadges.map((b) => b.id), ['cross:first-session'])
  assert.deepEqual((await log(own, dog.slug, 'name-response')).json.newBadges, [])
  const f = ids('foundations')
  await reach(own, dog.slug, f[0], 2); await reach(own, dog.slug, f[1], 2)
  assert.equal(byId((await get(own, dog.slug)).badges)['track:foundations'].tier, null)
  // The third of six skills reliable at home is half the track: Bronze, with the skill badge.
  assert.equal((await log(own, dog.slug, f[2])).status, 201)
  const bronze = await confirm(own, dog.slug, f[2], 2)
  assert.deepEqual(bronze.json.newBadges.map((b) => `${b.id}@${b.tier}`).sort(), [`skill:${f[2]}@reliable`, 'track:foundations@bronze'])
  for (const id of f.slice(3)) await reach(own, dog.slug, id, 2)
  let b = byId((await get(own, dog.slug)).badges)
  assert.deepEqual([b['track:foundations'].tier, b['track:foundations'].name, b['cross:good-neighbor'].earned, b['cross:good-neighbor'].progress], ['silver', 'Foundations Silver', false, 1])
  for (const id of ids('loose-leash')) await reach(own, dog.slug, id, 2)
  b = byId((await get(own, dog.slug)).badges)
  assert.deepEqual([b['track:loose-leash'].tier, b['cross:good-neighbor'].earned], ['silver', true])
  // Gold: the whole track proofed in public. The last confirmation earns the skill upgrade and the tier together.
  for (const id of f) { assert.equal((await log(own, dog.slug, id, { place: 'out' })).status, 201); if (id !== f[5]) assert.equal((await confirm(own, dog.slug, id, 3)).status, 200) }
  const gold = await confirm(own, dog.slug, f[5], 3)
  assert.deepEqual(gold.json.newBadges.map((x) => `${x.id}@${x.tier}`).sort(), [`skill:${f[5]}@proofed`, 'track:foundations@gold'])
  // Patio pro and Trail ready, through the API.
  for (const id of ['patio-settle', 'leave-it']) await reach(own, dog.slug, id, 3)
  assert.equal(byId((await get(own, dog.slug)).badges)['cross:patio-pro'].earned, false)
  assert.equal((await log(own, dog.slug, 'polite-greeting', { place: 'out' })).status, 201)
  assert.ok((await confirm(own, dog.slug, 'polite-greeting', 3)).json.newBadges.some((x) => x.id === 'cross:patio-pro'))
  for (const id of TRAIL_READY) await reach(own, dog.slug, id, 3)
  b = byId((await get(own, dog.slug)).badges)
  assert.deepEqual([b['cross:patio-pro'].earned, b['cross:trail-ready'].earned], [true, true])
  // 30 sessions in all.
  const have = (await get(own, dog.slug)).totals.sessions
  assert.ok(have >= 30 && b['cross:sessions-30'].earned, String(have))

  // The existing earned badges list (the Awards section) carries the earned training badges, labelled self-reported.
  const aw = await call('GET', `/api/dogs/${dog.slug}/awards`, { token: own.token })
  const tb = aw.json.badges.filter((x) => x.kind === 'training')
  assert.ok(tb.length >= 15 && tb.every((x) => x.earned && x.selfReported && x.how === "Training badge. Self-reported by Bramble's family."))
  assert.ok(tb.some((x) => x.name === 'Foundations Gold') && tb.some((x) => x.name === 'Sit: proofed in public') && tb.some((x) => x.name === 'Good neighbor'))
  assert.ok(aw.json.badges.some((x) => x.kind !== 'training'), 'the walk badges are still there')
  // A dog with no practice adds nothing to that list.
  const quiet = await makeDog(own.token, 'Quiet')
  assert.ok((await call('GET', `/api/dogs/${quiet.slug}/awards`, { token: own.token })).json.badges.every((x) => x.kind !== 'training'))
})

test('training API: the practice streak counts days in a row, in the time zone sent with the request', async () => {
  const own = await signIn('Stella Streak', 's-own'), dog = await makeDog(own.token, 'Scout')
  const now = Date.now()
  // Noon UTC on each of the last 7 UTC days, oldest first. The newest is yesterday when it is before noon now.
  const noon = (ago) => Math.floor(now / DAY) * DAY + 12 * 3600e3 - ago * DAY
  const start = noon(0) > now ? 1 : 0
  let last
  for (let i = 6; i >= 0; i--) { last = await log(own, dog.slug, 'spin', { at: new Date(noon(start + i)).toISOString() }, '?tz=0'); assert.equal(last.status, 201, last.text) }
  assert.deepEqual([last.json.streak.current, last.json.streak.best], [7, 7])
  assert.ok(last.json.newBadges.some((b) => b.id === 'cross:streak-7'))
  const utc = await get(own, dog.slug, '?tz=0')
  assert.deepEqual([utc.streak.best, byId(utc.badges)['cross:streak-7'].earned], [7, true])
  // With no tz the days are UTC days.
  assert.deepEqual((await get(own, dog.slug)).streak, utc.streak)
  // The same sessions seen from a zone 13 hours ahead still land on 7 different days.
  assert.equal((await get(own, dog.slug, '?tz=-780')).streak.best, 7)
  // A nonsense tz falls back to UTC, and a huge one is clamped.
  assert.equal((await get(own, dog.slug, '?tz=abc')).streak.best, 7)
  assert.equal((await get(own, dog.slug, '?tz=99999')).streak.best, 7)
  // Two more sessions on an already counted day do not lengthen it.
  await log(own, dog.slug, 'spin', { at: new Date(noon(start + 2) + 60e3).toISOString() }, '?tz=0')
  assert.equal((await get(own, dog.slug, '?tz=0')).streak.best, 7)
})

test('training API: the public page shows earned badges as self-reported, and never notes, sessions or names', async () => {
  const own = await signIn('Priya Public', 'u-own'), dog = await makeDog(own.token, 'Pixel')
  const SECRET = 'Front door code 4471, practised with Nana'
  assert.equal((await log(own, dog.slug, 'sit', { note: SECRET })).status, 201)
  assert.equal((await confirm(own, dog.slug, 'sit', 2)).status, 200)
  // Private dog: no public page at all.
  assert.equal((await call('PATCH', `/api/dogs/${dog.slug}`, { token: own.token, body: { public: false } })).status, 200)
  assert.equal((await call('GET', `/d/${dog.slug}`)).status, 404)
  assert.equal((await call('GET', `/api/public/dogs/${dog.slug}`)).status, 404)
  assert.equal((await call('PATCH', `/api/dogs/${dog.slug}`, { token: own.token, body: { public: true } })).status, 200)
  const page = await call('GET', `/d/${dog.slug}`)
  assert.equal(page.status, 200)
  assert.match(page.text, /TRAINING BADGES/)
  assert.match(page.text, /Self-reported by Pixel&#39;s family|Self-reported by Pixel's family/)
  assert.match(page.text, /Sit: reliable at home/); assert.match(page.text, /First session/)
  assert.match(page.text, /does not check or certify/)
  for (const leak of [SECRET, '4471', 'Nana', 'Priya', 'repsOk', 'minutes":', 'Not started']) assert.ok(!page.text.includes(leak), leak)
  // Locked badges are not listed.
  assert.ok(!page.text.includes('Patio pro') && !page.text.includes('Down'))
  const pub = await call('GET', `/api/public/dogs/${dog.slug}`)
  assert.deepEqual(pub.json.dog.training.label, "Self-reported by Pixel's family")
  assert.deepEqual(pub.json.dog.training.badges.map((b) => b.name).sort(), ['First session', 'Sit: reliable at home'])
  assert.deepEqual(Object.keys(pub.json.dog.training.badges[0]).sort(), ['glyph', 'group', 'id', 'name', 'tier'])
  assert.ok(!JSON.stringify(pub.json).includes('4471') && !('sessions' in pub.json.dog.training))
  // A public dog with no badges has no training section.
  const plain = await makeDog(own.token, 'Plain')
  await call('PATCH', `/api/dogs/${plain.slug}`, { token: own.token, body: { public: true } })
  assert.ok(!(await call('GET', `/d/${plain.slug}`)).text.includes('TRAINING BADGES'))
  assert.equal((await call('GET', `/api/public/dogs/${plain.slug}`)).json.dog.training, null)
})

test('training notifications: owner and family hear about a badge someone else earned, never the person who did it', async () => {
  assert.ok(NOTIFY_KINDS.includes('training_badge') && NOTIFY_GROUPS.reminders.includes('training_badge'))
  const own = await signIn('Nora Notify', 'n-own'), dog = await makeDog(own.token, 'Noodle')
  const fam = await join(own, dog.slug, 'family', 'Felix Family', 'n-fam')
  const wal = await join(own, dog.slug, 'walker', 'Wren Walker', 'n-wal')
  // The walker logs the first session: owner and family are told, the walker is not.
  assert.deepEqual((await log(wal, dog.slug, 'sit', { note: 'a private note' })).json.newBadges.map((b) => b.id), ['cross:first-session'])
  const o1 = await inbox(own), f1 = await inbox(fam)
  assert.deepEqual([o1.length, f1.length, (await inbox(wal)).length], [1, 1, 0])
  assert.equal(o1[0].title, 'Noodle earned a training badge: First session')
  assert.equal(o1[0].body, "Wren logged a practice session. Self-reported by Noodle's family.")
  assert.deepEqual(o1[0].link, { to: 'training', dog: dog.slug })
  assert.ok(!JSON.stringify(o1).includes('private note'))
  // A session that earns nothing sends nothing.
  await log(wal, dog.slug, 'sit')
  assert.equal((await inbox(own)).length, 1)
  // The owner confirms a level: family is told, the owner is not.
  assert.equal((await confirm(own, dog.slug, 'sit', 2)).status, 200)
  const f2 = await inbox(fam)
  assert.deepEqual([(await inbox(own)).length, f2.length, (await inbox(wal)).length], [1, 2, 0])
  assert.equal(f2[0].title, 'Noodle earned a training badge: Sit: reliable at home')
  assert.match(f2[0].body, /^Nora confirmed a level\./)
  // Stepping back and confirming again does not send the same badge twice.
  await confirm(own, dog.slug, 'sit', 1, undefined); await confirm(own, dog.slug, 'sit', 2)
  assert.equal((await inbox(fam)).length, 2)
  // The family member confirms the upgrade: now the owner is told and the family member is not.
  await log(fam, dog.slug, 'sit', { place: 'out' })
  assert.equal((await confirm(fam, dog.slug, 'sit', 3)).status, 200)
  assert.deepEqual([(await inbox(own)).length, (await inbox(fam)).length], [2, 2])
  assert.equal((await inbox(own))[0].title, 'Noodle earned a training badge: Sit: proofed in public')
  // The Reminders switch covers it.
  assert.equal((await call('PUT', '/api/notifications/prefs', { token: own.token, body: { reminders: false } })).status, 200)
  await log(fam, dog.slug, 'down'); assert.equal((await confirm(fam, dog.slug, 'down', 2)).status, 200)
  assert.equal((await inbox(own)).length, 2)
})

test('training usage events are on the server whitelist with fixed-word props only', () => {
  for (const n of ['training_opened', 'training_session_logged', 'training_level_confirmed', 'training_badge_earned']) assert.ok(USAGE_EVENTS[n], n)
  assert.deepEqual(cleanProps('training_session_logged', { track: 'foundations', place: 'home', note: 'secret', skill: 'sit' }), { track: 'foundations', place: 'home' })
  assert.deepEqual(cleanProps('training_level_confirmed', { level: 2, checks: [true] }), { level: 2 })
  assert.deepEqual(cleanProps('training_badge_earned', { tier: 'bronze', name: 'x' }), { tier: 'bronze' })
  assert.deepEqual(cleanProps('training_opened', { anything: 1 }), {})
})
