// Training extras: the lesson demonstrations (script data), the practice reminder calendar file and the
// outside link data. Pure checks, no server. Loaded by server/index.js under `node --test server/`.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { SKILL_IDS } from '../src/training/skills.js'
import { LESSONS } from '../src/training/content.js'
import { SCRIPTS, scriptFor } from '../src/training/animScripts.js'
import { POSES, PROP_NAMES, flatten, blend } from '../src/training/poses.js'
import { practiceIcs, icsFileName, sessionCount } from '../src/training/ics.js'
import { ARTICLES, DIRECTORIES, LINKS_CHECKED, videoSearchUrl, searchQuery, isTrainerPlace, trainerKind } from '../src/training/links.js'

const HANDS = ['fist', 'treat', 'palm', 'point', 'toy', 'bag', 'towel']
const BGS = ['in', 'street', 'yard', 'park', 'trail', 'patio']
// Words a caption must never use: the lessons are reward-based, and the drawings follow them.
const HARSH = /\b(push|pushing|jerk|yank|pop|drag|correct|correction|punish|scold|shock|prong|choke|force|alpha|dominan)/i
const dash = /[\u2014\u2013]/

test('demonstrations: every skill has a script of 3 to 5 beats, each tied to a real lesson step', () => {
  assert.deepEqual(Object.keys(SCRIPTS).sort(), [...SKILL_IDS].sort())
  for (const id of SKILL_IDS) {
    const beats = scriptFor(id), steps = LESSONS[id].steps.length
    assert.ok(beats.length >= 3 && beats.length <= 5, `${id}: ${beats.length} beats`)
    for (const [i, b] of beats.entries()) {
      const where = `${id} beat ${i + 1}`
      assert.ok(Number.isInteger(b.step) && b.step >= 0 && b.step < steps, `${where}: step ${b.step} of ${steps}`)
      assert.ok(typeof b.cap === 'string' && b.cap.length >= 10 && b.cap.length <= 90, `${where}: caption length ${b.cap && b.cap.length}`)
      assert.ok(!dash.test(b.cap), `${where}: dash in caption`)
      assert.ok(!HARSH.test(b.cap), `${where}: harsh wording: ${b.cap}`)
      assert.ok(/[.!"]$/.test(b.cap), `${where}: caption ends without a full stop`)
      assert.ok(POSES[b.dog.p], `${where}: unknown pose ${b.dog.p}`)
      if (b.dog2) assert.ok(POSES[b.dog2.p], `${where}: unknown pose for the other dog`)
      assert.ok(BGS.includes(b.bg), `${where}: backdrop ${b.bg}`)
      for (const k of Object.keys(b.props || {})) assert.ok(PROP_NAMES.includes(k), `${where}: unknown prop ${k}`)
      if (b.hand) assert.ok(HANDS.includes(b.hand.k), `${where}: hand ${b.hand.k}`)
      if (b.leash) assert.ok(['loose', 'tight', 'line'].includes(b.leash), `${where}: leash ${b.leash}`)
      if (b.say) assert.ok(b.say.length <= 14 && !dash.test(b.say), `${where}: cue ${b.say}`)
      // Every value the drawing reads is a finite number.
      const { v } = flatten(b)
      for (const [key, n] of Object.entries(v)) assert.ok(Number.isFinite(n), `${where}: ${key} is ${n}`)
    }
  }
})

test('demonstrations: what is shown matches the lesson', () => {
  for (const id of SKILL_IDS) {
    const beats = scriptFor(id)
    // A treat is eaten only with a hand there to give it, and the marker comes before or with the treat.
    for (const b of beats) if (b.treat === 'mouth') assert.ok(b.hand, `${id}: a treat with no hand`)
    // A tight leash only ever appears with the person standing still: never a tug while walking.
    for (const b of beats) if (b.leash === 'tight') assert.ok(!b.walk, `${id}: tight leash while walking`)
    // A long line clips to a harness, never a collar.
    for (const b of beats) if (b.leash === 'line') assert.ok(b.dog.harness, `${id}: long line on a collar`)
  }
  // Skills whose lesson says not to touch or move the dog into place show no hand on the dog's body.
  const hands = scriptFor('sit').map((b) => b.hand && b.hand.k)
  assert.ok(hands.every((k) => !k || ['treat', 'palm', 'point', 'fist'].includes(k)))
  // The tricks that use a lure end with an empty hand signal or a cue word.
  for (const id of ['sit', 'down', 'spin', 'bow', 'roll-over']) assert.ok(scriptFor(id).some((b) => b.say || (b.hand && ['palm', 'point'].includes(b.hand.k))), id)
  // Every recall script says the cue once, as the lessons do, and every lesson with a marker shows it.
  for (const id of ['come-indoors', 'come-in-yard', 'long-line-recall', 'recall-from-distraction']) assert.equal(scriptFor(id).filter((b) => b.say === 'Come!').length, 1, id)
  for (const id of SKILL_IDS) if (LESSONS[id].steps.some((s) => /"Yes"/.test(s))) assert.ok(scriptFor(id).some((b) => b.yes), `${id}: no marker shown`)
})

test('demonstrations: blending two beats stays between them', () => {
  const [a, b] = scriptFor('sit').map(flatten)
  const mid = blend(a, b, 0.5)
  for (const key of Object.keys(b.v)) {
    const lo = Math.min(a.v[key], b.v[key]), hi = Math.max(a.v[key], b.v[key])
    assert.ok(mid.v[key] >= lo - 1e-9 && mid.v[key] <= hi + 1e-9, key)
  }
  assert.deepEqual(blend(a, b, 1).v, b.v)
})

test('practice reminder: a valid calendar file with one repeating event at the chosen local time', () => {
  const ics = practiceIcs({ skillId: 'sit', skillName: 'Sit, then stay; okay', minutes: 3, hour: 18, minute: 0, days: 7, every: 1, start: new Date(2026, 10, 28, 9), now: new Date(Date.UTC(2026, 10, 28, 14, 5, 9)), url: 'https://trot-app.onrender.com/' })
  const lines = ics.split('\r\n')
  assert.equal(lines[0], 'BEGIN:VCALENDAR'); assert.equal(lines.at(-2), 'END:VCALENDAR'); assert.equal(lines.at(-1), '')
  assert.ok(!/[^\r]\n/.test(ics), 'bare line feed')
  for (const l of lines) assert.ok(new TextEncoder().encode(l).length <= 75, `long line: ${l}`)
  const unfolded = ics.replace(/\r\n /g, '')
  assert.match(unfolded, /\r\nDTSTART:20261128T180000\r\n/)
  assert.match(unfolded, /\r\nDTEND:20261128T180300\r\n/)
  assert.match(unfolded, /\r\nRRULE:FREQ=DAILY;INTERVAL=1;COUNT=7\r\n/)
  assert.match(unfolded, /\r\nDTSTAMP:20261128T140509Z\r\n/)
  assert.match(unfolded, /\r\nSUMMARY:Practice: Sit\\, then stay\\; okay\r\n/)
  assert.match(unfolded, /\r\nUID:trot-practice-sit-20261128T180000@trot-app\r\n/)
  assert.equal((unfolded.match(/BEGIN:VEVENT/g) || []).length, 1)
  assert.match(unfolded, /BEGIN:VALARM\r\nACTION:DISPLAY/)
  // Every other day over 7 days is 4 sessions; numbers are clamped.
  assert.match(practiceIcs({ skillId: 'down', skillName: 'Down', days: 7, every: 2, start: new Date(2026, 0, 31), now: new Date(0) }), /RRULE:FREQ=DAILY;INTERVAL=2;COUNT=4\r\n/)
  assert.match(practiceIcs({ skillId: 'down', skillName: 'Down', start: new Date(2026, 0, 31), now: new Date(0), hour: 99, minute: -5 }), /DTSTART:20260131T230000/)
  assert.equal(sessionCount(7, 2), 4); assert.equal(sessionCount(14, 1), 14)
  assert.equal(icsFileName('roll-over'), 'trot-practice-roll-over.ics'); assert.equal(icsFileName('../x'), 'trot-practice-x.ics')
  assert.ok(!dash.test(ics))
})

test('outside links: a video search for every skill, checked articles and directories, no em dashes', () => {
  for (const id of SKILL_IDS) {
    const u = new URL(videoSearchUrl(id))
    assert.equal(u.origin + u.pathname, 'https://www.youtube.com/results')
    assert.equal(u.searchParams.get('search_query'), searchQuery(id))
    assert.match(searchQuery(id), /positive reinforcement|safely|cooperative care/)
  }
  assert.match(LINKS_CHECKED, /^\d{4}-\d{2}-\d{2}$/)
  for (const [id, list] of Object.entries(ARTICLES)) {
    assert.ok(SKILL_IDS.includes(id), id)
    assert.ok(list.length >= 1 && list.length <= 2, id)
    for (const a of list) {
      const u = new URL(a.url)
      assert.equal(u.protocol, 'https:'); assert.ok(a.source && a.title, id); assert.equal(a.checked, LINKS_CHECKED)
      assert.ok(!/youtube|youtu\.be/.test(u.host), 'no video embeds or ids')
      assert.ok(!dash.test(a.title + a.source), a.title)
    }
  }
  assert.ok(DIRECTORIES.length >= 4)
  for (const d of DIRECTORIES) { assert.equal(new URL(d.url).protocol, 'https:'); assert.ok(d.means.length > 40 && !dash.test(d.means + d.full)); assert.ok(!/affiliat|partner of trot|recommended by trot/i.test(d.means)) }
})

test('find a trainer: only listings that say they train, with an address or a source', () => {
  const places = JSON.parse(fs.readFileSync(new URL('./seed-places.json', import.meta.url), 'utf8')).places
  const found = places.filter(isTrainerPlace)
  assert.ok(found.length >= 10)
  for (const p of found) assert.ok(p.address || p.source_url)
  // A note that only cites a trainer's guide is not a trainer.
  assert.ok(!places.filter((p) => /trainer's/.test(p.note)).some(isTrainerPlace))
  assert.equal(isTrainerPlace({ name: 'Dog School', note: 'Dog training classes.', category: 'care' }), false, 'no address or source')
  assert.equal(isTrainerPlace({ name: 'Dog School', note: 'Dog training classes.', category: 'care', address: '1 Main St' }), true)
  assert.equal(trainerKind({ category: 'care', note: 'Dog training facility.' }), 'Trainer')
  assert.equal(trainerKind({ category: 'care', note: 'Dog daycare, boarding and training.' }), 'Daycare with training')
  assert.equal(trainerKind({ category: 'shop', note: 'Pet shop, plus training classes.' }), 'Also offers training')
})
