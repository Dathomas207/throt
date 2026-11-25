// Demo data. Places and coordinates are approximate samples around Cambridge, MA.
const C = [42.3850, -71.1492]
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
  pond: { name: 'Pond perimeter loop', miles: 2.4, minutes: 48, note: 'Flat · mostly shaded · water access', pts: ring(C, 0.0055, 0.0082, 96, -2.2), via: [[42.3905, -71.1490], [42.3890, -71.1425], [42.3850, -71.1408], [42.3800, -71.1455], [42.3805, -71.1535], [42.3850, -71.1576], [42.3893, -71.1548]] },
  meadow: { name: 'Lusitania Meadow out and back', miles: 1.1, minutes: 24, note: 'Easy · off-leash stretch', pts: path([42.3829, -71.1440], [42.3868, -71.1408]).concat(path([42.3868, -71.1408], [42.3829, -71.1440]).slice(1)) },
  danehy: { name: 'Danehy Park lap', miles: 1.8, minutes: 41, note: 'Open fields · fenced dog run', pts: loop([42.3889, -71.1370], 0.0022, 0.0034, 70, 1) },
  fells: { name: 'Sheepfold and Skyline', miles: 5.9, minutes: 142, note: 'Hilly · off-leash meadow · rocky', pts: loop([42.4530, -71.1090], 0.0085, 0.011, 110, 0.4) },
}
// Distances are measured from the drawn geometry so the number always matches the line on the map.
function lineMiles(pts) { let d = 0; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], R = 3958.8, r = Math.PI / 180, x = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2; d += 2 * R * Math.asin(Math.sqrt(x)) } return d }
for (const k of Object.keys(ROUTES)) { const m = lineMiles(ROUTES[k].pts); ROUTES[k].miles = Math.round(m * 10) / 10; ROUTES[k].minutes = Math.max(5, Math.round(m * 20)) }
export const PLACES = [
  { id: 'fresh', name: 'Fresh Pond Reservation', kind: 'Dog park and trail', at: [42.3847, -71.1487], tags: ['Off-leash area', 'Water access', 'Shade', 'Quiet before 8 AM'], dogs: 38, top: 'Moose', topVisits: 9, routes: ['pond', 'meadow'] },
  { id: 'danehy', name: 'Danehy Park', kind: 'Park with dog run', at: [42.3889, -71.1370], tags: ['Fenced run', 'Open fields', 'Lights at night'], dogs: 27, top: 'Juno', topVisits: 7, routes: ['danehy'] },
  { id: 'pacific', name: 'Pacific Street Dog Park', kind: 'Fenced dog park', at: [42.3577, -71.1014], tags: ['Fenced', 'Small-dog area', 'Busy evenings'], dogs: 19, top: 'Pickle', topVisits: 11, routes: [] },
  { id: 'fells', name: 'Sheepfold, Middlesex Fells', kind: 'Off-leash meadow and trails', at: [42.4530, -71.1090], tags: ['Off-leash meadow', 'Long trails', 'Parking'], dogs: 44, top: 'Biscuit', topVisits: 3, routes: ['fells'] },
]
export const DOG = { id: 'biscuit', name: 'Biscuit', breed: 'Golden Retriever', age: '4 yrs', weight: 68, home: 'Cambridge, MA', bio: 'Swims in anything. Carries one stick per walk, minimum.', followers: 248, lifetime: 1312, streak: 12, rangeMin: 60, rangeMax: 90 }
export const PEOPLE = {
  dale: { id: 'dale', name: 'Dale', role: 'Biscuit’s human', color: '#C8F031', ink: '#0F1B2D' },
  pat: { id: 'pat', name: 'Pat', role: 'Dog walker · weekdays', color: '#1F5AE8', ink: '#FFFFFF' },
  sue: { id: 'sue', name: 'Sue', role: 'Neighbor · weekend hikes', color: '#FF8A5B', ink: '#0F1B2D' },
  tails: { id: 'tails', name: 'Happy Tails', role: 'Daycare · Thursdays', color: '#0F1B2D', ink: '#C8F031' },
}
// daysAgo 0 = today. Sample history for Biscuit.
export const SEED = [
  { id: 's1', dog: 'Biscuit', by: 'dale', type: 'Walk', title: 'Morning loop at Fresh Pond', daysAgo: 0, time: '7:14 AM', place: 'Fresh Pond', route: 'pond', miles: 2.4, minutes: 48, sniffs: 14, paws: 23, comments: 4, note: 'Found the good stick. Would not trade it for a treat.' },
  { id: 's2', dog: 'Biscuit', by: 'pat', type: 'Walk', title: 'Midday meadow sniffari', daysAgo: 1, time: '12:30 PM', place: 'Lusitania Meadow', route: 'meadow', miles: 1.1, minutes: 26, sniffs: 19, paws: 17, comments: 2, note: 'Made two new friends and one enemy (a goose).' },
  { id: 's3', dog: 'Biscuit', by: 'dale', type: 'Walk', title: 'Evening lap, extra slow', daysAgo: 1, time: '6:05 PM', place: 'Danehy Park', route: 'danehy', miles: 1.8, minutes: 44, sniffs: 11, paws: 12, comments: 1 },
  { id: 's4', dog: 'Biscuit', by: 'tails', type: 'Daycare', title: 'Daycare day with the big dogs', daysAgo: 2, time: '9:00 AM', place: 'Happy Tails', route: null, miles: 0, minutes: 190, sniffs: 0, paws: 31, comments: 6, note: 'Played hard, napped harder.' },
  { id: 's5', dog: 'Biscuit', by: 'pat', type: 'Walk', title: 'Pond loop with Pat', daysAgo: 3, time: '12:15 PM', place: 'Fresh Pond', route: 'pond', miles: 2.3, minutes: 46, sniffs: 12, paws: 14, comments: 0 },
  { id: 's6', dog: 'Biscuit', by: 'sue', type: 'Hike', title: 'Skyline scramble with Sue', daysAgo: 4, time: '8:40 AM', place: 'Middlesex Fells', route: 'fells', miles: 5.9, minutes: 142, sniffs: 33, paws: 52, comments: 9, note: 'First time at the Sheepfold. Zoomies for ten straight minutes.' },
  { id: 's7', dog: 'Biscuit', by: 'dale', type: 'Swim', title: 'Dock diving practice', daysAgo: 5, time: '4:20 PM', place: 'Fresh Pond', route: 'meadow', miles: 0.8, minutes: 35, sniffs: 5, paws: 40, comments: 5 },
  { id: 's8', dog: 'Biscuit', by: 'dale', type: 'Training', title: 'Loose-leash practice', daysAgo: 6, time: '7:30 AM', place: 'Neighborhood', route: 'danehy', miles: 0.9, minutes: 22, sniffs: 6, paws: 9, comments: 1 },
]
for (const a of SEED) { if (a.route && ROUTES[a.route] && a.type !== 'Daycare') { a.miles = ROUTES[a.route].miles; a.minutes = ROUTES[a.route].minutes } }
export const PACK = [
  { id: 'p0', dog: 'Millie', breed: 'Bernedoodle', byName: 'Dale', type: 'Play time', title: 'Backyard zoomies before dinner', daysAgo: 0, time: '4:10 PM', place: 'Home', route: null, miles: 0, minutes: 35, sniffs: 0, paws: 41, comments: 6, color: '#0F1B2D', ink: '#C8F031', note: 'Three laps of the yard, one stolen glove, zero regrets.' },
  { id: 'p1', dog: 'Moose', breed: 'Bernese Mountain Dog', byName: 'Priya', type: 'Walk', title: 'Ninth pond lap this week', daysAgo: 0, time: '6:40 AM', place: 'Fresh Pond', route: 'pond', miles: 2.4, minutes: 55, sniffs: 21, paws: 18, comments: 3, color: '#1F5AE8', ink: '#FFFFFF' },
  { id: 'p2', dog: 'Juno', breed: 'Border Collie', byName: 'Pat', type: 'Walk', title: 'Pack walk, four dogs deep', daysAgo: 0, time: '12:30 PM', place: 'Danehy Park', route: 'danehy', miles: 1.8, minutes: 41, sniffs: 9, paws: 27, comments: 4, color: '#0F1B2D', ink: '#C8F031' },
  { id: 'p3', dog: 'Pickle', breed: 'Dachshund', byName: 'Marco', type: 'Walk', title: 'Short legs, long loop', daysAgo: 1, time: '5:50 PM', place: 'Pacific Street', route: 'meadow', miles: 1.0, minutes: 31, sniffs: 24, paws: 35, comments: 7, color: '#FF8A5B', ink: '#0F1B2D' },
]
for (const x of PACK) { if (x.route && ROUTES[x.route]) { x.miles = ROUTES[x.route].miles; x.minutes = ROUTES[x.route].minutes } }
export const CONNECTIONS = [
  { id: 'tag', name: 'Trot Tag', group: 'On the collar', what: 'A small Bluetooth tag on Biscuit’s collar. Any phone on the care team that hears it credits the walk to Biscuit, so Pat and Sue never have to pick a dog.', real: 'Needs the native iPhone app and a beacon tag.', on: true },
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
