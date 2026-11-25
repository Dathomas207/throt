// Demo data. Places and coordinates are approximate samples around Eastover and Dilworth in Charlotte, NC.
const C = [35.1945, -80.8415]
function loop(center, rLat, rLng, n = 90, phase = 0) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2 + phase
    const w = 1 + 0.12 * Math.sin(3 * t) + 0.06 * Math.cos(5 * t)
    pts.push([center[0] + rLat * w * Math.sin(t), center[1] + rLng * w * Math.cos(t)])
  }
  return pts
}
// A plain ellipse sized to sit outside the pond's shoreline. It is still an approximation:
// `via` lists points around the pond so the walking router can replace it with the real path.
function ring(center, rLat, rLng, n = 96, phase = 0) {
  const pts = []
  for (let i = 0; i <= n; i++) { const t = (i / n) * Math.PI * 2 + phase; pts.push([center[0] + rLat * Math.sin(t), center[1] + rLng * Math.cos(t)]) }
  return pts
}
function path(a, b, n = 40, bend = 0.0012) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    pts.push([a[0] + (b[0] - a[0]) * t + bend * Math.sin(t * Math.PI * 3), a[1] + (b[1] - a[1]) * t + bend * Math.sin(t * Math.PI * 2)])
  }
  return pts
}
export const ROUTES = {
  pond: { name: 'Freedom Park loop', miles: 1.2, minutes: 24, note: 'Flat · paved · around the lake', pts: loop([35.1945, -80.8415], 0.0026, 0.0036, 96, -2.2) },
  meadow: { name: 'Eastover Park out and back', miles: 0.8, minutes: 16, note: 'Easy · grassy creekside', pts: path([35.1974, -80.8147], [35.2012, -80.8128], 40, 0.0004).concat(path([35.2012, -80.8128], [35.1974, -80.8147], 40, 0.0004).slice(1)) },
  danehy: { name: 'Latta Park lap', miles: 0.9, minutes: 18, note: 'Shaded · neighborhood park', pts: loop([35.2080, -80.8530], 0.0016, 0.0022, 70, 1) },
  fells: { name: 'Little Sugar Creek Greenway, Midtown to Freedom Park', miles: 2.6, minutes: 52, note: 'Paved greenway · leashed', pts: path([35.2135, -80.8356], [35.1967, -80.8391], 60, 0.0006).concat(path([35.1967, -80.8391], [35.2135, -80.8356], 60, 0.0006).slice(1)) },
}
// Distances are measured from the drawn geometry so the number always matches the line on the map.
function lineMiles(pts) { let d = 0; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], R = 3958.8, r = Math.PI / 180, x = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2; d += 2 * R * Math.asin(Math.sqrt(x)) } return d }
for (const k of Object.keys(ROUTES)) { const m = lineMiles(ROUTES[k].pts); ROUTES[k].miles = Math.round(m * 10) / 10; ROUTES[k].minutes = Math.max(5, Math.round(m * 20)) }
export const PLACES = [
  { id: 'fresh', name: 'Freedom Park', kind: 'Park with a lake loop', at: [35.1967, -80.8391], tags: ['Leashed', 'Paved loop', 'Shade', 'Quiet before 8 AM'], dogs: 38, top: 'Moose', topVisits: 9, routes: ['pond', 'fells'] },
  { id: 'danehy', name: 'Latta Park', kind: 'Neighborhood park', at: [35.2080, -80.8530], tags: ['Leashed', 'Shade', 'Open lawn'], dogs: 27, top: 'Juno', topVisits: 7, routes: ['danehy'] },
  { id: 'pacific', name: 'Frazier Park Dog Park', kind: 'Fenced dog park', at: [35.2333, -80.8576], tags: ['Fenced', 'Small-dog area', 'Busy evenings'], dogs: 19, top: 'Pickle', topVisits: 11, routes: [] },
  { id: 'fells', name: 'Eastover Park', kind: 'Park on Briar Creek', at: [35.1974, -80.8147], tags: ['Leashed', 'Open grass', 'Walking paths'], dogs: 44, top: 'Biscuit', topVisits: 3, routes: ['meadow'] },
]
export const DOG = { id: 'biscuit', name: 'Biscuit', breed: 'Golden Retriever', age: '4 yrs', weight: 68, home: 'Charlotte, NC', bio: 'Swims in anything. Carries one stick per walk, minimum.', followers: 248, lifetime: 1312, streak: 12, rangeMin: 60, rangeMax: 90 }
export const PEOPLE = {
  dale: { id: 'dale', name: 'Dale', role: 'Biscuit’s human', color: '#C8F031', ink: '#0F1B2D' },
  pat: { id: 'pat', name: 'Pat', role: 'Dog walker · weekdays', color: '#1F5AE8', ink: '#FFFFFF' },
  sue: { id: 'sue', name: 'Sue', role: 'Neighbor · weekend hikes', color: '#FF8A5B', ink: '#0F1B2D' },
  tails: { id: 'tails', name: 'Happy Tails', role: 'Daycare · Thursdays', color: '#0F1B2D', ink: '#C8F031' },
}
// daysAgo 0 = today. Sample history for Biscuit.
export const SEED = [
  { id: 's1', dog: 'Biscuit', by: 'dale', type: 'Walk', title: 'Morning loop at Freedom Park', daysAgo: 0, time: '7:14 AM', place: 'Freedom Park', route: 'pond', miles: 2.4, minutes: 48, sniffs: 14, paws: 23, comments: 4, note: 'Found the good stick. Would not trade it for a treat.' },
  { id: 's2', dog: 'Biscuit', by: 'pat', type: 'Walk', title: 'Midday Eastover sniffari', daysAgo: 1, time: '12:30 PM', place: 'Eastover Park', route: 'meadow', miles: 1.1, minutes: 26, sniffs: 19, paws: 17, comments: 2, note: 'Made two new friends and one enemy (a goose).' },
  { id: 's3', dog: 'Biscuit', by: 'dale', type: 'Walk', title: 'Evening lap, extra slow', daysAgo: 1, time: '6:05 PM', place: 'Latta Park', route: 'danehy', miles: 1.8, minutes: 44, sniffs: 11, paws: 12, comments: 1 },
  { id: 's4', dog: 'Biscuit', by: 'tails', type: 'Daycare', title: 'Daycare day with the big dogs', daysAgo: 2, time: '9:00 AM', place: 'Happy Tails', route: null, miles: 0, minutes: 190, sniffs: 0, paws: 31, comments: 6, note: 'Played hard, napped harder.' },
  { id: 's5', dog: 'Biscuit', by: 'pat', type: 'Walk', title: 'Park loop with Pat', daysAgo: 3, time: '12:15 PM', place: 'Freedom Park', route: 'pond', miles: 2.3, minutes: 46, sniffs: 12, paws: 14, comments: 0 },
  { id: 's6', dog: 'Biscuit', by: 'sue', type: 'Hike', title: 'Greenway miles with Sue', daysAgo: 4, time: '8:40 AM', place: 'Little Sugar Creek Greenway', route: 'fells', miles: 5.9, minutes: 142, sniffs: 33, paws: 52, comments: 9, note: 'First time doing the whole greenway stretch. Slept the entire afternoon.' },
  { id: 's7', dog: 'Biscuit', by: 'dale', type: 'Swim', title: 'Kiddie pool laps', daysAgo: 5, time: '4:20 PM', place: 'Home', route: null, miles: 0, minutes: 35, sniffs: 5, paws: 40, comments: 5 },
  { id: 's8', dog: 'Biscuit', by: 'dale', type: 'Training', title: 'Loose-leash practice', daysAgo: 6, time: '7:30 AM', place: 'Neighborhood', route: 'danehy', miles: 0.9, minutes: 22, sniffs: 6, paws: 9, comments: 1 },
]
for (const a of SEED) { if (a.route && ROUTES[a.route] && a.type !== 'Daycare') { a.miles = ROUTES[a.route].miles; a.minutes = ROUTES[a.route].minutes } }
export const PACK = [
  { id: 'p0', dog: 'Millie', breed: 'Bernedoodle', byName: 'Dale', type: 'Play time', title: 'Backyard zoomies before dinner', daysAgo: 0, time: '4:10 PM', place: 'Home', route: null, miles: 0, minutes: 35, sniffs: 0, paws: 41, comments: 6, color: '#0F1B2D', ink: '#C8F031', note: 'Three laps of the yard, one stolen glove, zero regrets.' },
  { id: 'p1', dog: 'Moose', breed: 'Bernese Mountain Dog', byName: 'Priya', type: 'Walk', title: 'Ninth park lap this week', daysAgo: 0, time: '6:40 AM', place: 'Freedom Park', route: 'pond', miles: 2.4, minutes: 55, sniffs: 21, paws: 18, comments: 3, color: '#1F5AE8', ink: '#FFFFFF' },
  { id: 'p2', dog: 'Juno', breed: 'Border Collie', byName: 'Pat', type: 'Walk', title: 'Pack walk, four dogs deep', daysAgo: 0, time: '12:30 PM', place: 'Latta Park', route: 'danehy', miles: 1.8, minutes: 41, sniffs: 9, paws: 27, comments: 4, color: '#0F1B2D', ink: '#C8F031' },
  { id: 'p3', dog: 'Pickle', breed: 'Dachshund', byName: 'Marco', type: 'Walk', title: 'Short legs, long loop', daysAgo: 1, time: '5:50 PM', place: 'Pacific Street', route: 'meadow', miles: 1.0, minutes: 31, sniffs: 24, paws: 35, comments: 7, color: '#FF8A5B', ink: '#0F1B2D' },
]
for (const x of PACK) { if (x.route && ROUTES[x.route]) { x.miles = ROUTES[x.route].miles; x.minutes = ROUTES[x.route].minutes } }
export const CONNECTIONS = [
  { id: 'tag', name: 'Trot Tag', group: 'On the collar', what: 'A tap tag (NFC) on Biscuit’s collar. Anyone who finds Biscuit can tap it with a phone to open the found page. It does not track location.', real: 'Works today with a blank NFC sticker. Set it up under Registration and ID.', on: true },
  { id: 'airtag', name: 'Apple AirTag', group: 'On the collar', what: 'Apple does not let other apps read an AirTag. Paste the Share Item Location link from Find My and Trot attaches it to a Lost Dog alert.', real: 'Works today with a pasted link.', input: 'Share Item Location link' },
  { id: 'collar', name: 'Fi or Tractive collar', group: 'On the collar', what: 'Imports GPS walks, steps and rest from a smart collar.', real: 'Needs a partner agreement with the collar maker.' },
  { id: 'instagram', name: 'Instagram', group: 'Sharing', what: 'Sends Biscuit’s story card straight to Instagram Stories.', real: 'Uses the phone share sheet; no approval needed.', on: true },
  { id: 'strava', name: 'Strava', group: 'Activity', what: 'Imports your own walks and runs so Biscuit gets credit for them.', real: 'Uses Strava’s OAuth API. Imported data stays private to you under their terms.' },
  { id: 'garmin', name: 'Garmin Connect', group: 'Activity', what: 'Brings in activities you tagged with a Garmin dog profile.', real: 'Needs Garmin developer program access.' },
  { id: 'health', name: 'Apple Health', group: 'Activity', what: 'Reads your walking workouts to fill in walks you forgot to record.', real: 'Needs the native iPhone app.' },
  { id: 'alltrails', name: 'AllTrails', group: 'Places', what: 'Attach an AllTrails link to any saved route. Trot’s own maps come from OpenStreetMap.', real: 'Links only. AllTrails has no public API.' },
  { id: 'vet', name: 'Vet records', group: 'Health', what: 'Upload a PDF or photo from the vet. Trot reads vaccines, weights and notes into Biscuit’s health timeline.', real: 'Demo adds a sample record. Real version uses AI extraction.', upload: true },
]
export const WEIGHTS = [['Jun', 70.1], ['Jul', 69.6], ['Aug', 69.0], ['Sep', 68.8], ['Oct', 68.4], ['Nov', 68.0]]
export const HEALTH = [
  { t: 'Rabies vaccine', d: 'Due Mar 2027', ok: true },
  { t: 'Bordetella', d: 'Due Jan 2027', ok: true },
  { t: 'Flea and tick dose', d: 'Due in 6 days', ok: false },
  { t: 'Annual exam', d: 'Oct 2026 · sample record', ok: true },
]
export function dayLabel(d) { return d === 0 ? 'Today' : d === 1 ? 'Yesterday' : new Date(Date.now() - d * 864e5).toLocaleDateString('en-US', { weekday: 'long' }) }
export function fmtTime(min) { const m = Math.floor(min), s = Math.round((min - m) * 60); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}` }
export function haversine(a, b) { const R = 3958.8, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)) }

// Pace statistics for the demo walks. Speeds come from the phone carried on the walk, in miles per hour.
const BURST = { 'Play time': [2.6, 8], Agility: [2.4, 10], Walk: [1.9, 2], Hike: [1.7, 1], Run: [1.6, 6], Swim: [1.5, 0], Fetch: [2.6, 9], Training: [1.8, 3], 'Dog park': [2.4, 7], Daycare: [0, 0] }
for (const a of [...SEED, ...PACK]) {
  const hrs = a.minutes / 60, avg = a.miles > 0 && hrs > 0 ? a.miles / hrs : 0, b = BURST[a.type] || BURST.Walk
  a.avgSpeed = Math.round(avg * 10) / 10
  a.maxSpeed = avg ? Math.round(Math.min(14, avg * b[0] + 1.2) * 10) / 10 : 0
  a.sprints = avg ? b[1] : 0
  a.movingMinutes = Math.round(a.minutes * 0.88)
}

// Activity types. `gps` types record a route; the others are timed sessions. `stats` lists what to show first.
export const ACTIVITY_TYPES = [
  { id: 'Walk', label: 'Walk', gps: true, stats: ['distance', 'time', 'maxSpeed'] },
  { id: 'Run', label: 'Run', gps: true, stats: ['distance', 'pace', 'maxSpeed', 'sprints'] },
  { id: 'Hike', label: 'Hike', gps: true, stats: ['distance', 'time', 'maxSpeed'] },
  { id: 'Play time', label: 'Play time', gps: false, stats: ['time', 'sprints'] },
  { id: 'Fetch', label: 'Fetch', gps: true, stats: ['time', 'sprints', 'maxSpeed'] },
  { id: 'Dog park', label: 'Dog park', gps: true, stats: ['time', 'sprints', 'maxSpeed'] },
  { id: 'Swim', label: 'Swim', gps: false, stats: ['time'] },
  { id: 'Training', label: 'Training', gps: false, stats: ['time'] },
  { id: 'Agility', label: 'Agility', gps: false, stats: ['time', 'sprints'] },
  { id: 'Daycare', label: 'Daycare', gps: false, stats: ['time'] },
]
export const activityType = (id) => ACTIVITY_TYPES.find((t) => t.id === id) || ACTIVITY_TYPES[0]

// ---- demo health, documents, awards and boards for Biscuit (appended) --------
// Sample data, consistent with WEIGHTS and HEALTH above. Dates are offsets from today so they never go stale.
export const DEMO_HEALTH = {
  // Weekly minutes for the seven weeks before this one, oldest first. This week comes from the demo walks.
  weeks: [352, 371, 340, 388, 365, 394, 379],
  vaccines: [
    { t: 'Flea and tick dose', given: -24, due: 6 },
    { t: 'Bordetella', given: -310, due: 55 },
    { t: 'Rabies vaccine (3 year)', given: -980, due: 115 },
    { t: 'Heartworm preventive', given: -20, due: 10 },
  ],
  meds: [{ t: 'Fish oil', dose: '1,000 mg capsule', schedule: 'Once a day with breakfast', start: -150 }, { t: 'Ear drops', dose: '4 drops, left ear', schedule: 'Twice a day', start: -40, end: -30 }],
  visits: [{ on: -41, clinic: 'Sample Animal Hospital', reason: 'Annual exam', notes: 'Weight 68.4 lb. Asked to keep trimming toward 68. Left ear treated for ten days.' }, { on: -232, clinic: 'Sample Animal Hospital', reason: 'Torn dewclaw', notes: 'Trimmed and wrapped. Healed in two weeks.' }],
  conditions: [{ t: 'Chicken allergy', notes: 'Itchy paws within a day. Fish and lamb are fine.' }, { t: 'Ear infections after swimming', notes: 'Dry both ears after every swim.' }],
  notes: ['Carsick on drives over an hour. No breakfast before long trips.'],
  // Shown only at tracking level 3, and labelled as sample data.
  tracker: { steps: 11840, restHours: 13.5, days: [9200, 12100, 15300, 8700, 11900, 13400, 11840] },
}
export const DEMO_DOCS = [
  { id: 'd1', name: 'Rabies certificate 2024', category: 'vaccination', size: 184000, daysAgo: 400 },
  { id: 'd2', name: 'Annual exam summary', category: 'vet', size: 412000, daysAgo: 41 },
  { id: 'd3', name: 'City dog licence', category: 'licence', size: 96000, daysAgo: 200 },
  { id: 'd4', name: 'Pet insurance policy', category: 'insurance', size: 733000, daysAgo: 300 },
]
export const DEMO_AWARDS = [
  { id: 'a1', title: 'Novice trick dog', kind: 'trick', eventName: 'Sample entry, not a real title', placement: '', daysAgo: 40 },
  { id: 'a2', title: 'Fastest retrieve', kind: 'ribbon', eventName: 'Sample entry, not a real event', placement: 'First', daysAgo: 95 },
]
// Sample dogs for the demo boards, beside Biscuit and the pack above. Weekly miles, minutes, outings and top speed.
export const DEMO_BOARD = [
  { name: 'Moose', breed: 'Bernese Mountain Dog', miles: 16.8, minutes: 385, outings: 9, top_speed: 6.1 },
  { name: 'Juno', breed: 'Border Collie', miles: 21.4, minutes: 330, outings: 8, top_speed: 13.2 },
  { name: 'Pickle', breed: 'Dachshund', miles: 6.2, minutes: 190, outings: 7, top_speed: 5.4 },
  { name: 'Millie', breed: 'Bernedoodle', miles: 9.7, minutes: 300, outings: 8, top_speed: 9.8 },
  { name: 'Tansy', breed: 'Whippet', miles: 12.9, minutes: 205, outings: 6, top_speed: 17.5 },
  { name: 'Waffles', breed: 'Beagle', miles: 11.3, minutes: 280, outings: 7, top_speed: 7.0 },
  { name: 'Otis', breed: 'Golden Retriever', miles: 14.1, minutes: 310, outings: 6, top_speed: 8.3 },
]
export const DEMO_CHALLENGES = [
  { key: 'month-25', name: '25-mile month', description: 'Cover 25 miles together this month.', unit: 'mi', target: 25, daysLeft: 6, base: 11.4 },
  { key: 'explorer-5', name: 'Explorer', description: 'Walk in 5 different places this month.', unit: 'places', target: 5, daysLeft: 6, base: 0 },
  { key: 'team-3', name: 'Whole team', description: 'Get walked by 3 different people this month.', unit: 'people', target: 3, daysLeft: 6, base: 0 },
]

// ---- Millie, the demo's second dog (appended) --------------------------------
// Dale's other dog. Her pack entry p0 above is listed here as one of her own activities.
export const MILLIE = { id: 'millie', name: 'Millie', breed: 'Bernedoodle', age: '2 yrs', weight: 55, home: 'Charlotte, NC', bio: 'Fluffy, bouncy, and first to the door. Believes every glove is a toy.', followers: 96, lifetime: 412, streak: 5, rangeMin: 60, rangeMax: 100 }
const perf = (a, avg, max, sprints) => ({ ...a, avgSpeed: avg, maxSpeed: max, sprints, movingMinutes: Math.round(a.minutes * 0.88), sniffs: 0 })
export const MILLIE_SEED = [
  perf({ ...PACK.find((x) => x.id === 'p0'), by: 'dale', byName: undefined, color: undefined, ink: undefined }, 0, 0, 8),
  perf({ id: 'm2', dog: 'Millie', by: 'pat', type: 'Walk', title: 'Lunch loop with Pat', daysAgo: 1, time: '12:40 PM', place: 'Latta Park', route: 'danehy', miles: ROUTES.danehy.miles, minutes: ROUTES.danehy.minutes, paws: 12, comments: 1 }, 3.0, 6.9, 2),
  perf({ id: 'm3', dog: 'Millie', by: 'dale', type: 'Play time', title: 'Tug of war, best of five', daysAgo: 2, time: '6:30 PM', place: 'Home', route: null, miles: 0, minutes: 25, paws: 18, comments: 2, note: 'Won three. Claims she won five.' }, 0, 0, 6),
  perf({ id: 'm4', dog: 'Millie', by: 'sue', type: 'Hike', title: 'Greenway miles with Sue', daysAgo: 3, time: '9:10 AM', place: 'Little Sugar Creek Greenway', route: 'fells', miles: ROUTES.fells.miles, minutes: ROUTES.fells.minutes, paws: 33, comments: 4, note: 'First real hill. Carried a stick the whole way down.' }, 2.5, 7.8, 1),
  perf({ id: 'm5', dog: 'Millie', by: 'dale', type: 'Walk', title: 'Eastover out and back', daysAgo: 4, time: '7:20 AM', place: 'Eastover Park', route: 'meadow', miles: ROUTES.meadow.miles, minutes: ROUTES.meadow.minutes, paws: 9, comments: 0 }, 2.9, 6.4, 2),
  perf({ id: 'm6', dog: 'Millie', by: 'dale', type: 'Training', title: 'Leave it, with gloves', daysAgo: 5, time: '5:45 PM', place: 'Home', route: null, miles: 0, minutes: 20, paws: 14, comments: 3, note: 'Two gloves survived.' }, 0, 0, 0),
  perf({ id: 'm7', dog: 'Millie', by: 'pat', type: 'Walk', title: 'Park loop with Pat', daysAgo: 6, time: '12:20 PM', place: 'Freedom Park', route: 'pond', miles: ROUTES.pond.miles, minutes: ROUTES.pond.minutes, paws: 11, comments: 1 }, 3.0, 7.1, 3),
]
const MILLIE_HEALTH = {
  weeks: [262, 281, 250, 296, 270, 288, 301],
  vaccines: [{ t: 'Flea and tick dose', given: -12, due: 18 }, { t: 'Bordetella', given: -200, due: 165 }, { t: 'Rabies vaccine (1 year)', given: -330, due: 35 }, { t: 'Heartworm preventive', given: -33, due: -3 }],
  meds: [{ t: 'Probiotic powder', dose: 'One scoop', schedule: 'Once a day on dinner', start: -60 }],
  visits: [{ on: -75, clinic: 'Sample Animal Hospital', reason: 'One-year checkup', notes: 'Weight 54.2 lb. Healthy. Coat needs brushing three times a week.' }, { on: -180, clinic: 'Sample Animal Hospital', reason: 'Ate a glove', notes: 'Passed it on her own. Keep gloves off the floor.' }],
  conditions: [{ t: 'Sensitive stomach', notes: 'No rich treats. Plain kibble for training rewards.' }],
  notes: ['Scared of the vacuum. Walk her before cleaning day.'],
  tracker: { steps: 9460, restHours: 14.5, days: [8100, 10300, 7600, 12800, 9900, 8700, 9460] },
}
const MILLIE_WEIGHTS = [['Jun', 49.8], ['Jul', 51.2], ['Aug', 52.5], ['Sep', 53.4], ['Oct', 54.2], ['Nov', 55.0]]
const MILLIE_DOCS = [
  { id: 'md1', name: 'Rabies certificate 2026', category: 'vaccination', size: 171000, daysAgo: 330 },
  { id: 'md2', name: 'One-year checkup summary', category: 'vet', size: 388000, daysAgo: 75 },
  { id: 'md3', name: 'Microchip registration', category: 'licence', size: 88000, daysAgo: 600 },
]
const MILLIE_AWARDS = [
  { id: 'ma1', title: 'Puppy class graduate', kind: 'certificate', eventName: 'Sample entry, not a real class', placement: '', daysAgo: 420 },
  { id: 'ma2', title: 'Best sit-stay', kind: 'ribbon', eventName: 'Sample entry, not a real event', placement: 'Second', daysAgo: 60 },
]
// Everything the demo screens need for one dog, so each screen can show whichever dog is selected.
export const DEMO_DOGS = {
  biscuit: { key: 'biscuit', dog: DOG, seed: SEED, health: DEMO_HEALTH, weights: WEIGHTS, weightNote: 'Down 2.1 lb since June, on track for the target the vet set.', docs: DEMO_DOCS, awards: DEMO_AWARDS, people: ['dale', 'pat', 'sue', 'tails'] },
  millie: { key: 'millie', dog: MILLIE, seed: MILLIE_SEED, health: MILLIE_HEALTH, weights: MILLIE_WEIGHTS, weightNote: 'Up 5.2 lb since June. Still growing, and right where the vet expected.', docs: MILLIE_DOCS, awards: MILLIE_AWARDS, people: ['dale', 'pat', 'sue'] },
}
export const demoDogByName = (name) => Object.values(DEMO_DOGS).find((d) => d.dog.name === name) || null

// ---- registration and ID, Trot Tag and tag activity samples (appended) -------
// Every number here is made up and labelled as a sample on screen. None belongs to a real chip, licence or tag.
// dueIn and expiresIn are days from today, so the demo always shows one item expiring soon.
export const DEMO_ID = {
  biscuit: {
    registration: { microchipNumber: '999000000000123', microchipRegistry: 'Sample Registry', licenseJurisdiction: 'Charlotte-Mecklenburg', licenseNumber: 'SAMPLE-0001', licenseExpiresIn: 18, rabiesTag: 'SAMPLE-4410', rabiesDueIn: 210, akcNumber: 'SAMPLE0001', altered: 'yes' },
    tags: [{ id: 'bt1', label: 'Collar tag', code: 'SAMPLETAG234', daysAgo: 60 }],
    scans: [
      { id: 'bs1', kind: 'scan', daysAgo: 2, tagLabel: 'Collar tag', device: 'Safari on iPhone or iPad' },
      { id: 'bs2', kind: 'found', daysAgo: 40, tagLabel: 'Collar tag', device: 'Chrome on Android', finderName: 'Sam', message: 'Sample report. Sitting by the park gate with a stick, very polite.', contact: 'sample@example.com', lat: 35.1936, lng: -80.8427, read: true },
    ],
  },
  millie: {
    registration: { microchipNumber: '999000000000456', microchipRegistry: '', licenseJurisdiction: 'Charlotte-Mecklenburg', licenseNumber: '', licenseExpiresIn: null, rabiesTag: 'SAMPLE-7702', rabiesDueIn: 35, akcNumber: '', altered: 'yes' },
    tags: [{ id: 'mt1', label: 'Harness tag', code: 'SAMPLETAG567', daysAgo: 21 }],
    scans: [
      { id: 'ms1', kind: 'scan', daysAgo: 1, tagLabel: 'Harness tag', device: 'Chrome on Android' },
      { id: 'ms2', kind: 'scan', daysAgo: 9, tagLabel: 'Harness tag', device: 'Safari on iPhone or iPad' },
    ],
  },
}
