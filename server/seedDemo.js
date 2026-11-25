// Demo accounts and dogs so the trial does not look empty: leaderboards, the pack
// feed, challenges and the heatmap all read from these until real dogs arrive.
// Runs at startup unless SEED_DEMO=0. Safe to run again: users, dogs, awards and
// team rows are keyed on fixed ids, and the walks are rebuilt each time so they
// always look recent. Every seeded user and dog carries is_demo, and the emails
// use a reserved domain that POST /api/session refuses.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { monthWindow, weekendWindow } from './routesCompete.js'

export const DEMO_DOMAIN = 'example.invalid'
const DAY = 864e5
const hex = (s) => crypto.createHash('sha256').update(s).digest('hex')
// A fixed id in the same shape as the random ones.
export const demoId = (key) => { const h = hex('trot-demo:' + key); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}` }
function rng(seed) {
  let a = parseInt(hex(seed).slice(0, 8), 16)
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const r1 = (v) => Math.round(v * 10) / 10
function lineMiles(pts) { let d = 0; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], R = 3958.8, r = Math.PI / 180, x = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2; d += 2 * R * Math.asin(Math.sqrt(x)) } return d }
// A closed, slightly wobbly loop around a park, sized so it comes out near the wanted miles.
function loop(center, miles, rand) {
  const n = 44, radiusMi = miles / (2 * Math.PI * 1.04), dLat = radiusMi / 69, dLng = radiusMi / (69 * Math.cos((center[0] * Math.PI) / 180))
  const phase = rand() * Math.PI * 2, a = 0.08 + rand() * 0.1, b = 0.04 + rand() * 0.06, squash = 0.7 + rand() * 0.5
  const pts = []
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2 + phase, w = 1 + a * Math.sin(3 * t) + b * Math.cos(5 * t)
    pts.push([Math.round((center[0] + dLat * w * squash * Math.sin(t)) * 1e5) / 1e5, Math.round((center[1] + dLng * w * Math.cos(t)) * 1e5) / 1e5])
  }
  pts[n] = pts[0].slice()
  return pts
}

// Real parks, used only as centres for made-up loops.
const PARKS = {
  boston: [['Fresh Pond', 42.3847, -71.1487], ['Danehy Park', 42.3889, -71.137], ['Boston Common', 42.355, -71.0656], ['Jamaica Pond', 42.317, -71.12], ['Arnold Arboretum', 42.2986, -71.1232]],
  // Around Eastover, Myers Park and Dilworth, plus two of the dog parks in server/seed-places.json. Approximate centres.
  charlotte: [['Freedom Park', 35.1936, -80.842], ['Eastover Park', 35.1907, -80.8128], ['Latta Park', 35.208, -80.853], ['Little Sugar Creek Greenway', 35.2105, -80.8355], ['Myers Park', 35.1855, -80.8285], ['Frazier Park Dog Park', 35.2327, -80.8585], ['Ninth Street Park', 35.2335, -80.843]],
}
const CITY = { boston: 'Boston, MA', charlotte: 'Charlotte, NC' }
// Invented people. First names only ever show.
const USERS = ['Dale', 'Nora', 'Pat', 'Sue', 'Priya', 'Hollis', 'Marco', 'Imani', 'Renata', 'Theo', 'Josie', 'Calvin', 'Mabel', 'Odette', 'Wren']
// Invented dogs. Biscuit, Moose, Juno and Pickle match the no-sign-in demo in src/data.js.
export const DEMO_DOGS = [
  { slug: 'biscuit', name: 'Biscuit', breed: 'Golden Retriever', weight: 68, bio: 'Swims in anything. Carries one stick per walk, minimum.', at: 'boston', owner: 'Dale', team: [['Pat', 'walker'], ['Sue', 'family']], weeks: 6, level: 2, mix: ['Walk', 'Walk', 'Walk', 'Swim', 'Fetch', 'Hike', 'Training'], base: 2.2 },
  { slug: 'moose', name: 'Moose', breed: 'Bernese Mountain Dog', weight: 104, bio: 'Slow starter, strong finisher. Leans on everyone he likes.', at: 'boston', owner: 'Priya', team: [['Pat', 'walker']], weeks: 6, level: 1, mix: ['Walk', 'Walk', 'Walk', 'Hike', 'Dog park'], base: 2.4 },
  { slug: 'juno', name: 'Juno', breed: 'Border Collie', weight: 41, bio: 'Herds joggers, squirrels and the occasional leaf.', at: 'boston', owner: 'Hollis', team: [['Pat', 'walker'], ['Wren', 'family']], weeks: 5, level: 3, mix: ['Run', 'Run', 'Walk', 'Agility', 'Fetch', 'Training'], base: 3.1 },
  { slug: 'pickle', name: 'Pickle', breed: 'Dachshund', weight: 11, bio: 'Short legs, long opinions.', at: 'boston', owner: 'Marco', team: [], weeks: 5, level: 1, mix: ['Walk', 'Walk', 'Play time', 'Dog park'], base: 1.0 },
  { slug: 'tansy', name: 'Tansy', breed: 'Whippet', weight: 29, bio: 'Two speeds: asleep and gone.', at: 'boston', owner: 'Imani', team: [['Theo', 'family']], weeks: 4, level: 1, mix: ['Run', 'Walk', 'Fetch', 'Play time'], base: 2.0 },
  { slug: 'millie', name: 'Millie', breed: 'Bernedoodle', weight: 55, bio: 'Fluffy, bouncy, and first to the door.', at: 'boston', owner: 'Dale', team: [['Sue', 'family'], ['Pat', 'walker']], weeks: 6, level: 2, mix: ['Play time', 'Play time', 'Walk', 'Walk', 'Hike', 'Training', 'Fetch'], base: 1.9 },
  { slug: 'waffles', name: 'Waffles', breed: 'Beagle', weight: 24, bio: 'Nose first, questions later.', at: 'charlotte', owner: 'Renata', team: [['Calvin', 'walker']], weeks: 6, level: 1, mix: ['Walk', 'Walk', 'Walk', 'Dog park', 'Training'], base: 1.6 },
  { slug: 'otis', name: 'Otis', breed: 'Labrador Retriever', weight: 78, bio: 'Has never met a puddle he did not sit in.', at: 'charlotte', owner: 'Josie', team: [['Calvin', 'walker'], ['Mabel', 'family']], weeks: 6, level: 2, mix: ['Walk', 'Walk', 'Swim', 'Fetch', 'Hike', 'Run'], base: 2.6 },
  { slug: 'clementine', name: 'Clementine', breed: 'Australian Shepherd', weight: 48, bio: 'Learns the trick before you finish explaining it.', at: 'charlotte', owner: 'Odette', team: [['Mabel', 'family']], weeks: 5, level: 1, mix: ['Agility', 'Run', 'Walk', 'Training', 'Hike'], base: 2.8 },
  { slug: 'bruno', name: 'Bruno', breed: 'Boxer', weight: 66, bio: 'Greets every walk like it is the first one ever.', at: 'charlotte', owner: 'Theo', team: [], weeks: 4, level: 1, mix: ['Walk', 'Walk', 'Play time', 'Dog park', 'Run'], base: 2.0 },
  { slug: 'fig', name: 'Fig', breed: 'Miniature Poodle', weight: 13, bio: 'Small dog, big calendar.', at: 'charlotte', owner: 'Mabel', team: [['Josie', 'family']], weeks: 4, level: 1, mix: ['Walk', 'Walk', 'Training', 'Play time'], base: 1.2 },
]
const GPS = { Walk: [2.5, 3.2, 1.9, 2], Run: [5.0, 6.4, 1.6, 6], Hike: [2.1, 2.7, 1.7, 1], Fetch: [1.2, 1.8, 3.6, 9], 'Dog park': [1.0, 1.6, 3.4, 7] }
const TIMED = { 'Play time': [20, 45, 8], Swim: [20, 40, 0], Training: [15, 30, 0], Agility: [25, 50, 10] }
const TITLES = {
  Walk: ['Morning loop', 'Evening lap', 'Midday sniffari', 'Slow lap, lots of stops'], Run: ['Tempo run', 'Easy run', 'Quick miles before work'], Hike: ['Long way round', 'Weekend ramble'],
  Fetch: ['Fetch session', 'Ball until the ball won'], 'Dog park': ['Dog park hour', 'Zoomies with friends'], 'Play time': ['Backyard play', 'Tug and chase'], Swim: ['Pond swim', 'Dock practice'],
  Training: ['Loose-leash practice', 'Recall practice'], Agility: ['Agility practice', 'Tunnels and jumps'],
}
const NOTES = ['', '', '', 'Found the good stick.', 'Met a new friend by the gate.', 'Would not come out of the water.', 'Best behaved all week.', 'Pulled the whole way home for dinner.']

// The made-up history for one dog, as plain rows. Miles are measured from the generated line.
export function demoWalks(dog, now) {
  const rand = rng('walks:' + dog.slug), parks = PARKS[dog.at], people = [dog.owner, dog.owner, ...dog.team.map((t) => t[0])]
  const today = Math.floor(now / DAY) * DAY
  const out = []
  for (let d = dog.weeks * 7 - 1; d >= 0; d--) {
    const n = rand() < 0.16 ? 0 : rand() < 0.3 ? 2 : 1
    for (let k = 0; k < n; k++) {
      const type = dog.mix[Math.floor(rand() * dog.mix.length)], park = parks[Math.floor(rand() * parks.length)]
      const who = people[Math.floor(rand() * people.length)], title = TITLES[type][Math.floor(rand() * TITLES[type].length)], note = NOTES[Math.floor(rand() * NOTES.length)]
      const hour = (k === 0 ? 11 : 21) + rand() * 2.5
      let miles = 0, minutes, route = null, avg = null, max = null, sprints = null, run = null
      if (GPS[type]) {
        const g = GPS[type], want = type === 'Fetch' || type === 'Dog park' ? 0.4 + rand() * 0.5 : dog.base * (type === 'Hike' ? 1.8 : 1) * (0.7 + rand() * 0.7)
        route = loop([park[1], park[2]], want, rand)
        miles = Math.round(lineMiles(route) * 100) / 100
        const mph = g[0] + rand() * (g[1] - g[0])
        minutes = Math.max(6, Math.round((miles / mph) * 60))
        avg = r1(miles / (minutes / 60)); max = r1(Math.min(18, avg * g[2] + 0.6 + rand())); sprints = Math.round(g[3] * (0.5 + rand()))
        run = type === 'Run' ? Math.round(minutes * 0.7) : Math.min(minutes, sprints)
      } else {
        const t = TIMED[type]
        minutes = Math.round(t[0] + rand() * (t[1] - t[0])); sprints = t[2] ? Math.round(t[2] * (0.5 + rand())) : null
      }
      const started = today - d * DAY + hour * 3600e3
      if (started + minutes * 60e3 > now - 5 * 60e3) continue
      out.push({
        id: demoId(`walk:${dog.slug}:${d}:${k}`), who, type, title: GPS[type] ? `${title} at ${park[0]}` : title, note, place: GPS[type] || type === 'Swim' ? park[0] : 'Home', miles, minutes,
        started, route, avg, max, sprints, moving: GPS[type] ? Math.round(minutes * 0.88) : null, run,
      })
    }
  }
  return out
}

// Health records and documents for Dale's dogs. Day numbers are offsets from the day of seeding.
const RECORDS = {
  biscuit: { goal: 75, docs: [['Rabies certificate (sample)', 'vaccination'], ['Annual exam summary (sample)', 'vet']], entries: [
    { kind: 'weight', value: 70.1, unit: 'lb', on: -150 }, { kind: 'weight', value: 69, unit: 'lb', on: -90 }, { kind: 'weight', value: 68.4, unit: 'lb', on: -41 }, { kind: 'weight', value: 68, unit: 'lb', on: -6 },
    { kind: 'vaccine', title: 'Rabies vaccine (3 year)', on: -980, due: 115, doc: 0 }, { kind: 'vaccine', title: 'Bordetella', on: -310, due: 55 }, { kind: 'vaccine', title: 'Flea and tick dose', on: -24, due: 6 },
    { kind: 'medication', title: 'Fish oil', detail: '1,000 mg capsule', schedule: 'Once a day with breakfast', on: -150 },
    { kind: 'vet_visit', title: 'Annual exam', detail: 'Sample Animal Hospital', on: -41, notes: 'Weight 68.4 lb. Keep trimming toward 68.', doc: 1 },
    { kind: 'condition', title: 'Chicken allergy', notes: 'Itchy paws within a day. Fish and lamb are fine.' }, { kind: 'note', notes: 'Dry both ears after every swim.' },
  ] },
  millie: { goal: 60, docs: [['Rabies certificate (sample)', 'vaccination'], ['Microchip registration (sample)', 'licence']], entries: [
    { kind: 'weight', value: 49.8, unit: 'lb', on: -150 }, { kind: 'weight', value: 52.5, unit: 'lb', on: -90 }, { kind: 'weight', value: 54.2, unit: 'lb', on: -30 }, { kind: 'weight', value: 55, unit: 'lb', on: -4 },
    { kind: 'vaccine', title: 'Rabies vaccine (1 year)', on: -330, due: 35, doc: 0 }, { kind: 'vaccine', title: 'Bordetella', on: -200, due: 165 }, { kind: 'vaccine', title: 'Heartworm preventive', on: -33, due: -3 },
    { kind: 'medication', title: 'Probiotic powder', detail: 'One scoop', schedule: 'Once a day on dinner', on: -60 },
    { kind: 'vet_visit', title: 'One-year checkup', detail: 'Sample Animal Hospital', on: -75, notes: 'Healthy. Coat needs brushing three times a week.' },
    { kind: 'condition', title: 'Sensitive stomach', notes: 'No rich treats.' }, { kind: 'note', notes: 'Scared of the vacuum. Walk her before cleaning day.' },
  ] },
}
const AWARDS = [
  ['millie', 'Puppy class graduate (sample)', 'certificate', 'Sample entry, not a real class', '', 300],
  ['biscuit', 'Novice trick dog (sample)', 'trick', 'Sample entry, not a real title', '', 40],
  ['pickle', 'Fastest short legs (sample)', 'ribbon', 'Sample entry, not a real event', 'First', 25],
  ['clementine', 'Clean agility run (sample)', 'certificate', 'Sample entry, not a real event', '', 12],
]

export async function seedDemo(db, { now = Date.now(), photoDir = '' } = {}) {
  const at = new Date(now).toISOString(), uid = (name) => demoId('user:' + name)
  for (const name of USERS) {
    await db.query('INSERT INTO users (id, name, email, created_at, is_demo) VALUES ($1, $2, $3, $4, TRUE) ON CONFLICT (id) DO NOTHING', [uid(name), name, `${name.toLowerCase()}@${DEMO_DOMAIN}`, at])
  }
  // A demo dog gets a photo when public/<slug>.jpg exists and fits the photo limit. Otherwise it shows its initial.
  const photoOf = (slug) => {
    try {
      const buf = photoDir ? fs.readFileSync(path.join(photoDir, slug + '.jpg')) : null
      if (buf && buf.length <= 300 * 1024 && buf[0] === 0xff && buf[1] === 0xd8) return { data: `data:image/jpeg;base64,${buf.toString('base64')}`, v: hex(buf).slice(0, 12) }
    } catch (e) {}
    return null
  }
  let walks = 0
  for (const dog of DEMO_DOGS) {
    const id = demoId('dog:' + dog.slug)
    const has = await db.query('SELECT slug FROM dogs WHERE id = $1', [id])
    if (has.rows[0]) {
      await db.query('UPDATE dogs SET name = $1, breed = $2, weight = $3, bio = $4, city = $5, tracking_level = $6, is_demo = TRUE WHERE id = $7', [dog.name, dog.breed, dog.weight, dog.bio, CITY[dog.at], dog.level, id])
    } else {
      // A real dog may already live at this address, so the demo dog moves along.
      let slug = dog.slug
      for (let n = 0; (await db.query('SELECT id FROM dogs WHERE slug = $1', [slug])).rows[0]; n++) slug = `${dog.slug}-demo${n ? '-' + (n + 1) : ''}`
      await db.query('INSERT INTO dogs (id, slug, name, breed, age, weight, bio, is_public, share_routes, created_by, created_at, city, tracking_level, is_demo) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, TRUE, $8, $9, $10, $11, TRUE)',
        [id, slug, dog.name, dog.breed, '', dog.weight, dog.bio, uid(dog.owner), at, CITY[dog.at], dog.level])
    }
    const photo = photoOf(dog.slug)
    if (photo) await db.query('UPDATE dogs SET photo = $1, photo_v = $2 WHERE id = $3', [photo.data, photo.v, id])
    // The team is exactly what the list above says, so a change there (such as a new owner) takes effect on the next start.
    await db.query('UPDATE dogs SET created_by = $1 WHERE id = $2', [uid(dog.owner), id])
    const all = USERS.map(uid)
    await db.query(`DELETE FROM memberships WHERE dog_id = $1 AND user_id IN (${all.map((_, i) => `$${i + 2}`).join(', ')})`, [id, ...all])
    for (const [name, role] of [[dog.owner, 'owner'], ...dog.team]) {
      await db.query('INSERT INTO memberships (user_id, dog_id, role, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, dog_id) DO NOTHING', [uid(name), id, role, at])
    }
    const rows = demoWalks(dog, now)
    await db.tx(async (t) => {
      const old = await t.query('SELECT id FROM walks WHERE dog_id = $1', [id])
      if (old.rows.length) {
        const ph = old.rows.map((_, i) => `$${i + 1}`).join(', ')
        await t.query(`DELETE FROM paws WHERE walk_id IN (${ph})`, old.rows.map((r) => r.id))
        await t.query('DELETE FROM walks WHERE dog_id = $1', [id])
      }
      for (let i = 0; i < rows.length; i += 20) {
        const chunk = rows.slice(i, i + 20), params = []
        const values = chunk.map((w) => {
          const b = params.length
          params.push(w.id, id, uid(w.who), w.type, w.title, w.note, w.place, w.miles, w.minutes, 0, new Date(w.started).toISOString(), w.route ? JSON.stringify(w.route) : null, at, w.avg, w.max, w.sprints, w.moving, w.run)
          return `(${[...Array(18)].map((_, j) => `$${b + j + 1}`).join(', ')})`
        })
        await t.query(`INSERT INTO walks (id, dog_id, user_id, type, title, note, place, miles, minutes, sniffs, started_at, route, created_at, avg_speed, max_speed, sprints, moving_minutes, run_minutes) VALUES ${values.join(', ')}`, params)
      }
      // A few paws on the newest outings, from other demo people.
      const others = USERS.filter((n) => n !== dog.owner)
      for (const [i, w] of rows.slice(-3).entries()) {
        for (let k = 0; k <= i; k++) await t.query('INSERT INTO paws (walk_id, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (walk_id, user_id) DO NOTHING', [w.id, uid(others[(i * 3 + k + dog.name.length) % others.length]), at])
      }
    })
    walks += rows.length
    const joins = [['month-25', monthWindow(now).key], DEMO_DOGS.indexOf(dog) % 2 ? ['weekend-long', weekendWindow(now).key] : ['play-120', monthWindow(now).key]]
    for (const [key, period] of joins) await db.query('INSERT INTO challenge_joins (dog_id, challenge_key, period_key, joined_at) VALUES ($1, $2, $3, $4) ON CONFLICT (dog_id, challenge_key, period_key) DO NOTHING', [id, key, period, at])
  }
  for (const [slug, title, kind, event, placement, daysAgo] of AWARDS) {
    const dog = DEMO_DOGS.find((d) => d.slug === slug)
    await db.query('INSERT INTO awards (id, dog_id, title, kind, event_name, placement, awarded_on, notes, is_public, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9, $10) ON CONFLICT (id) DO NOTHING',
      [demoId('award:' + slug), demoId('dog:' + slug), title, kind, event, placement, new Date(now - daysAgo * DAY).toISOString().slice(0, 10), 'Made up for the demo.', uid(dog.owner), at])
  }
  // Dale's two dogs, Biscuit and Millie, also get health records and a couple of documents.
  for (const [slug, h] of Object.entries(RECORDS)) {
    const dogId = demoId('dog:' + slug), by = uid('Dale'), day = (off) => new Date(now + off * DAY).toISOString().slice(0, 10)
    const docIds = {}
    for (const [i, d] of h.docs.entries()) {
      const pdf = Buffer.from(`%PDF-1.4\n% Trot demo document: ${d[0]}. Made up for the demo.\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`)
      docIds[i] = demoId(`doc:${slug}:${i}`)
      await db.query('INSERT INTO documents (id, dog_id, name, category, content_type, size_bytes, data, notes, uploaded_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING', [docIds[i], dogId, d[0], d[1], 'application/pdf', pdf.length, pdf.toString('base64'), 'Sample file made for the demo.', by, at])
    }
    for (const [i, e] of h.entries.entries()) {
      await db.query('INSERT INTO health_entries (id, dog_id, kind, title, value, unit, occurred_on, due_on, detail, schedule, notes, document_id, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT (id) DO NOTHING',
        [demoId(`health:${slug}:${i}`), dogId, e.kind, e.title || '', e.value == null ? null : e.value, e.unit || null, e.on == null ? null : day(e.on), e.due == null ? null : day(e.due), e.detail || '', e.schedule || '', e.notes || '', e.doc == null ? null : docIds[e.doc], by, at])
    }
    await db.query('UPDATE dogs SET goal_minutes = $1 WHERE id = $2 AND goal_minutes IS NULL', [h.goal, dogId])
  }
  return { users: USERS.length, dogs: DEMO_DOGS.length, walks }
}

// SEED_DEMO=remove takes the demo dogs and people out again.
export async function removeDemo(db) {
  const dogs = (await db.query('SELECT id FROM dogs WHERE is_demo = TRUE')).rows.map((r) => r.id)
  for (const id of dogs) {
    await db.tx(async (t) => {
      const ws = (await t.query('SELECT id FROM walks WHERE dog_id = $1', [id])).rows.map((r) => r.id)
      if (ws.length) await t.query(`DELETE FROM paws WHERE walk_id IN (${ws.map((_, i) => `$${i + 1}`).join(', ')})`, ws)
      for (const table of ['walks', 'awards', 'challenge_joins', 'memberships', 'event_entries', 'health_entries', 'health_shares', 'documents', 'invites']) await t.query(`DELETE FROM ${table} WHERE dog_id = $1`, [id])
      await t.query('DELETE FROM dogs WHERE id = $1', [id])
    })
  }
  await db.query('DELETE FROM paws WHERE user_id IN (SELECT id FROM users WHERE is_demo = TRUE)')
  await db.query('DELETE FROM users WHERE is_demo = TRUE')
  return dogs.length
}
