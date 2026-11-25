// Real dog places from OpenStreetMap through the Overpass API: parks, dog-tagged bars and cafes,
// pet shops, vets, boarding, training and dog drinking water. Nothing is listed that the tags do not support.
// Parsing is kept in pure functions so it can be tested without the network.
import { PLACES, haversine } from './data.js'

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const TIMEOUT_MS = 12000
const FAST_TIMEOUT_MS = 6500 // the small first request (parks) gives up quickly
const HEDGE_MS = 1200 // how long the primary endpoint gets before the mirror is asked as well
const CACHE_MS = 10 * 60 * 1000 // younger than this, cached places are used without asking again
const OLD_MS = 24 * 60 * 60 * 1000 // older than this, cached places are flagged as old (still shown while refreshing)
const DROP_MS = 14 * OLD_MS
const MAX_CACHED_AREAS = 16
const MAX_SPAN = 0.35 // degrees. Larger views are clamped around their center.
const MAX_RESULTS = 250
const LS_PREFIX = 'trot-places1:' // bump when the stored place shape changes
const mem = new Map()

// bbox is { s, w, n, e } in degrees.
export function bboxAround(center, miles = 1.5) {
  const dLat = miles / 69, dLng = miles / (69 * Math.max(0.2, Math.cos(center[0] * Math.PI / 180)))
  return { s: center[0] - dLat, w: center[1] - dLng, n: center[0] + dLat, e: center[1] + dLng }
}
export function clampBbox(b) {
  const cLat = (b.s + b.n) / 2, cLng = (b.w + b.e) / 2
  const hLat = Math.min(b.n - b.s, MAX_SPAN) / 2, hLng = Math.min(b.e - b.w, MAX_SPAN * 1.4) / 2
  const out = { s: cLat - hLat, w: cLng - hLng, n: cLat + hLat, e: cLng + hLng }
  out.clamped = b.n - b.s > MAX_SPAN || b.e - b.w > MAX_SPAN * 1.4
  return out
}
export function bboxKey(b) { return [b.s, b.w, b.n, b.e].map((v) => v.toFixed(3)).join(',') }

// Tags that say a venue lets dogs in. A bar, cafe or restaurant is only ever listed when it carries one of these.
const DOG_OK = ['yes', 'outside', 'leashed']
const DRINK = ['bar', 'pub', 'biergarten']
const FOOD = ['cafe', 'restaurant']
// Places load in two groups so the first answer is small and fast:
//   'parks'  dog parks and dog-tagged parks, asked first with a short timeout
//   'more'   dog-tagged bars and cafes, pet shops, groomers, vets, boarding, training and dog water
//   'all'    both in one query
export function buildQuery(b, group = 'all', timeout = group === 'parks' ? 6 : 10) {
  const box = `(${b.s.toFixed(5)},${b.w.toFixed(5)},${b.n.toFixed(5)},${b.e.toFixed(5)})`
  const dog = `["dog"~"^(${DOG_OK.join('|')})$"]`
  const parks = [
    `nwr["leisure"="dog_park"]`,
    `nwr["leisure"~"^(park|nature_reserve)$"]["dog"~"^(yes|leashed|unleashed)$"]`,
  ]
  const more = [
    `nwr["amenity"~"^(${DRINK.concat(FOOD).join('|')})$"]${dog}`,
    `nwr["craft"="brewery"]${dog}`,
    `nwr["microbrewery"="yes"]${dog}`,
    `nwr["shop"~"^(pet|pet_grooming)$"]`,
    `nwr["amenity"~"^(veterinary|animal_boarding|animal_training)$"]`,
    `nwr["amenity"="drinking_water"]["dog"="yes"]`,
  ]
  const parts = group === 'parks' ? parks : group === 'more' ? more : parks.concat(more)
  return `[out:json][timeout:${timeout}];(${parts.map((q) => q + box + ';').join('')});out center tags ${MAX_RESULTS};`
}
// The box that is actually queried and cached: clamped, then grown outward to a 0.01 degree grid,
// so nearby views share one cache entry and a cached answer is exactly the answer for its key.
export function snapBbox(bbox) {
  const b = clampBbox(bbox), dn = (v) => Math.floor(v * 100 + 1e-9) / 100, up = (v) => Math.ceil(v * 100 - 1e-9) / 100
  return { s: dn(b.s), w: dn(b.w), n: up(b.n), e: up(b.e), clamped: b.clamped }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const SURFACES = { grass: 'Grass', dirt: 'Dirt', earth: 'Dirt', ground: 'Dirt', sand: 'Sand', gravel: 'Gravel', fine_gravel: 'Gravel', pebblestone: 'Gravel', woodchips: 'Wood chips', bark: 'Wood chips', mulch: 'Wood chips', asphalt: 'Paved', paved: 'Paved', concrete: 'Paved', artificial_turf: 'Artificial turf', compacted: 'Compacted' }
const listHas = (v, x) => String(v || '').split(/[;,]/).map((y) => y.trim().toLowerCase()).includes(x)

export const CATEGORIES = [
  { id: 'park', label: 'Parks', glyph: 'P', empty: 'No dog parks or dog-tagged parks on the map here yet' },
  { id: 'bar', label: 'Bars and patios', glyph: 'B', empty: 'No dog-tagged bars on the map here yet' },
  { id: 'cafe', label: 'Cafes and food', glyph: 'C', empty: 'No dog-tagged cafes or restaurants on the map here yet' },
  { id: 'shop', label: 'Shops', glyph: 'S', empty: 'No pet shops or groomers on the map here yet' },
  { id: 'vet', label: 'Vets', glyph: 'V', empty: 'No veterinary clinics on the map here yet' },
  { id: 'care', label: 'Daycare and training', glyph: 'D', empty: 'No dog boarding or training on the map here yet' },
  { id: 'water', label: 'Dog water', glyph: 'W', empty: 'No dog drinking water on the map here yet' },
  { id: 'other', label: 'Other', glyph: '+', empty: 'No other places here yet' },
]
// Which kind of dog place an OSM element is, or null when its tags do not qualify it.
// Bars, cafes and restaurants qualify only with an explicit dog tag. Boarding and training
// that name other animals only (horses, for example) are left out.
export function categoryFromTags(t = {}) {
  const dogOk = DOG_OK.includes(t.dog)
  if (t.amenity === 'drinking_water') return t.dog === 'yes' ? 'water' : null
  if (t.amenity === 'veterinary') return 'vet'
  if (t.amenity === 'animal_boarding') return !t.animal_boarding || listHas(t.animal_boarding, 'dog') ? 'care' : null
  if (t.amenity === 'animal_training') return !t.animal_training || listHas(t.animal_training, 'dog') ? 'care' : null
  if (t.shop === 'pet' || t.shop === 'pet_grooming') return 'shop'
  if (DRINK.includes(t.amenity) || t.craft === 'brewery' || t.microbrewery === 'yes') return dogOk ? 'bar' : null
  if (FOOD.includes(t.amenity)) return dogOk ? 'cafe' : null
  if (t.leisure === 'dog_park') return 'park'
  if ((t.leisure === 'park' || t.leisure === 'nature_reserve') && ['yes', 'leashed', 'unleashed'].includes(t.dog)) return 'park'
  return null
}

// Human labels derived only from tags that are present on the OSM element.
// brief leaves out what the place sheet shows as its own rows (seating, surface, wheelchair, fee, hours).
export function labelsFromTags(t = {}, brief = false) {
  const out = []
  const dogPark = t.leisure === 'dog_park'
  // leisure=dog_park is defined by OSM as an area for exercising dogs off the leash.
  if (t.dog === 'unleashed' || (dogPark && t.dog !== 'leashed')) out.push('Off-leash')
  if (t.dog === 'leashed') out.push('On leash')
  if (t.dog === 'yes' && !dogPark) out.push('Dogs allowed')
  if (t.dog === 'outside') out.push('Dogs allowed outside')
  if (!brief && t.outdoor_seating && !['no', 'none'].includes(t.outdoor_seating)) out.push('Outdoor seating')
  if (t.fenced === 'yes' || ['fence', 'wall', 'hedge'].includes(t.barrier)) out.push('Fenced')
  else if (t.fenced === 'no') out.push('No fence')
  if (t.lit === 'yes') out.push('Lit at night')
  if (t.drinking_water === 'yes') out.push('Drinking water')
  if (brief) return out.concat(t.access === 'private' ? ['Private access'] : t.access === 'customers' ? ['Customers only'] : t.access === 'permit' ? ['Permit needed'] : [])
  if (t.surface) out.push((SURFACES[t.surface] || cap(String(t.surface).replace(/_/g, ' '))) + ' surface')
  if (t.wheelchair === 'yes') out.push('Wheelchair access')
  if (t.fee === 'yes') out.push('Fee')
  if (t.access === 'private') out.push('Private access')
  else if (t.access === 'customers') out.push('Customers only')
  else if (t.access === 'permit') out.push('Permit needed')
  if (t.opening_hours) out.push(t.opening_hours === '24/7' ? 'Open 24 hours' : 'Hours: ' + String(t.opening_hours).slice(0, 40))
  return out
}
const VENUES = { bar: 'Bar', pub: 'Pub', biergarten: 'Beer garden', cafe: 'Cafe', restaurant: 'Restaurant' }
const dogSuffix = (t) => (t.dog === 'outside' ? ', dogs allowed outside' : t.dog === 'leashed' ? ', dogs on leash' : t.dog === 'unleashed' ? ', dogs off leash' : t.dog === 'yes' ? ', dogs allowed' : '')
function baseKind(t, cat) {
  if (cat === 'water') return 'Drinking water'
  if (cat === 'vet') return 'Veterinary clinic'
  if (cat === 'care') {
    const key = t.amenity === 'animal_boarding' ? 'animal_boarding' : 'animal_training'
    return (listHas(t[key], 'dog') ? 'Dog ' : 'Animal ') + (key === 'animal_boarding' ? 'boarding' : 'training')
  }
  if (cat === 'shop') return t.shop === 'pet_grooming' ? 'Pet groomer' : 'Pet shop'
  if (cat === 'bar') return t.craft === 'brewery' || t.microbrewery === 'yes' ? 'Brewery' : VENUES[t.amenity] || 'Bar'
  if (cat === 'cafe') return VENUES[t.amenity] || 'Cafe'
  if (t.leisure === 'dog_park') return 'Dog park'
  return t.leisure === 'nature_reserve' ? 'Nature reserve' : 'Park'
}
export function kindFromTags(t = {}) {
  const cat = categoryFromTags(t)
  if (t.leisure === 'dog_park' && cat === 'park') return t.fenced === 'yes' || t.barrier === 'fence' ? 'Fenced dog park' : 'Dog park'
  if (cat === 'water') return 'Drinking water for dogs'
  if (cat === 'bar' || cat === 'cafe') return baseKind(t, cat) + dogSuffix(t)
  if (cat === 'park' || cat == null) return baseKind(t, 'park') + (dogSuffix(t) || ', dogs allowed')
  return baseKind(t, cat)
}
export function nameFromTags(t = {}) {
  const n = t.name || t['name:en'] || t.official_name
  if (n) return String(n)
  return baseKind(t, categoryFromTags(t) || 'park')
}
// Only http and https links are carried through. A bare host gets https.
export function websiteFromTags(t = {}) {
  const raw = String(t.website || t['contact:website'] || '').trim().split(/[;\s]/)[0]
  if (!raw) return null
  const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw
  return /^https?:\/\/[^\s/?#]+\.[^\s/?#]+/i.test(url) ? url : null
}
export function phoneFromTags(t = {}) {
  const raw = String(t.phone || t['contact:phone'] || '').split(';')[0].trim()
  return raw && raw.replace(/\D/g, '').length >= 7 ? raw.slice(0, 30) : null
}
export function addressFromTags(t = {}) {
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ')
  return [street, t['addr:city']].filter(Boolean).join(', ') || null
}

const yesNo = (v) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : cap(String(v).replace(/_/g, ' ')).slice(0, 60))
const text = (v, n) => String(v).replace(/\s+/g, ' ').trim().slice(0, n)
// Rows for the place sheet: [{ label, value }]. A row exists only when its tag does, and values are as written in OSM.
export function detailsFromTags(t = {}) {
  const out = [], add = (label, value) => { if (value) out.push({ label, value }) }
  add('Address', addressFromTags(t))
  if (t.opening_hours) add('Hours', text(t.opening_hours, 200))
  if (t.cuisine) add('Cuisine', String(t.cuisine).split(';').map((c) => c.trim().replace(/_/g, ' ')).filter(Boolean).join(', ').slice(0, 80))
  if (t.outdoor_seating) add('Outdoor seating', yesNo(t.outdoor_seating))
  if (t.wheelchair) add('Wheelchair access', t.wheelchair === 'limited' ? 'Limited' : yesNo(t.wheelchair))
  if (t.surface) add('Surface', SURFACES[t.surface] || cap(String(t.surface).replace(/_/g, ' ')))
  if (t.fee) add('Fee', yesNo(t.fee))
  if (t.operator) add('Operator', text(t.operator, 80))
  if (t.description) add('About', text(t.description, 300))
  return out
}
const SUMMARY = { park: ['park', 'parks'], bar: ['bar or patio listed for dogs', 'bars and patios listed for dogs'], cafe: ['cafe or restaurant listed for dogs', 'cafes and restaurants listed for dogs'], shop: ['pet shop or groomer', 'pet shops and groomers'], vet: ['vet', 'vets'], care: ['boarding or training place', 'boarding and training places'], water: ['dog water point', 'dog water points'] }
// One line on what is loaded for the area, for example "Charlotte area: 14 parks, 3 dog-tagged bars and patios, 6 vets".
// Counts come only from the places passed in. Community places are counted apart from map data. Empty string when there is nothing.
// Places from public listings count with the map data. Places added by Trot members are counted apart.
export function areaSummary(places, label, nearUser = false) {
  const list = places || [], osmOnes = list.filter((p) => !p.community || p.curated), comm = list.length - osmOnes.length
  const parts = Object.keys(SUMMARY).map((k) => { const n = osmOnes.filter((p) => p.category === k).length; return n ? `${n} ${SUMMARY[k][n === 1 ? 0 : 1]}` : '' }).filter(Boolean)
  if (comm) parts.push(`${comm} added by Trot members`)
  if (!parts.length) return ''
  return (label ? `${String(label).split(',')[0].trim()} area: ` : nearUser ? 'Near you: ' : 'In this area: ') + parts.join(', ')
}
const COMMUNITY_CATS = ['park', 'bar', 'cafe', 'shop', 'vet', 'care', 'water', 'other']
export const COMMUNITY_KIND = { park: 'Park', bar: 'Bar or patio', cafe: 'Cafe or food', shop: 'Shop', vet: 'Vet', care: 'Daycare or training', water: 'Dog water', other: 'Other' }
// Places added by Trot members (from the Trot API) -> the same shape as map places, marked community:true.
// Anything malformed is dropped.
export function normalizeCommunity(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const c of list) {
    if (!c || c.id == null || typeof c.name !== 'string' || !c.name.trim() || !Array.isArray(c.at)) continue
    const lat = Number(c.at[0]), lng = Number(c.at[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue
    const category = COMMUNITY_CATS.includes(c.category) ? c.category : 'other'
    const curated = c.curated === true, src = typeof c.sourceUrl === 'string' && /^https?:\/\/[^\s]+$/i.test(c.sourceUrl.trim()) ? c.sourceUrl.trim() : null
    out.push({ id: 'community-' + c.id, cid: c.id, community: true, curated, sourceUrl: curated ? src : null, address: typeof c.address === 'string' && c.address.trim() ? c.address.trim().slice(0, 160) : null, name: c.name.trim().slice(0, 80), category, kind: COMMUNITY_KIND[category] + (curated ? ', from public listings' : ', added by a Trot member'), at: [lat, lng], tags: [], note: typeof c.note === 'string' ? c.note.slice(0, 280) : '', addedBy: typeof c.addedBy === 'string' && c.addedBy.trim() ? c.addedBy.trim().slice(0, 40) : '', confirmations: Math.max(0, Math.floor(Number(c.confirmations)) || 0), confirmed: !!c.confirmed })
  }
  return out
}
export function communityLine(p) {
  if (p.curated) return 'From public listings' + (p.confirmations > 0 ? ', confirmed by ' + p.confirmations : '')
  return `Added by ${p.addedBy || 'a Trot member'}, ${p.confirmations > 0 ? 'confirmed by ' + p.confirmations : 'not confirmed yet'}`
}
const DEDUPE_MILES = 0.05 // about 80 m
export const normName = (n) => String(n || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|and|of|at)\b/g, ' ').replace(/\s+/g, ' ').trim()
const sameName = (a, b) => { const x = normName(a), y = normName(b); return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x)))) }
// Map places plus listed and member places as one list. A listed place that is also on the map (same name,
// within about 80 m) is shown once: the listed record, which has the note, source and confirm toggle, enriched
// with what the map record knows (hours, phone, website, tags and its OpenStreetMap link).
export function mergePlaces(osmPlaces, community) {
  const osm = (osmPlaces || []).slice(), out = []
  for (const c of community || []) {
    const i = osm.findIndex((o) => haversine(o.at, c.at) <= DEDUPE_MILES && sameName(o.name, c.name))
    if (i < 0) { out.push(c); continue }
    const o = osm.splice(i, 1)[0]
    out.push({ ...c, tags: o.tags || [], chips: o.chips, details: (o.details || []).filter((d) => !(d.label === 'Address' && c.address)), website: o.website, phone: o.phone, address: c.address || o.address, osm: o.osm })
  }
  return osm.concat(out)
}
// Checks for the Add a place form. Returns { name, note, pin } with a message for each field that fails.
export function validateNewPlace({ name, note, at }) {
  const n = String(name || '').trim(), errs = {}
  if (n.length < 2) errs.name = 'Give the place a name of at least 2 characters.'
  else if (n.length > 80) errs.name = 'Keep the name to 80 characters or fewer.'
  if (String(note || '').length > 280) errs.note = 'Keep the note to 280 characters or fewer.'
  if (!Array.isArray(at)) errs.pin = 'Tap the map to drop the pin first.'
  return errs
}

// Overpass JSON -> [{ id, name, kind, category, at:[lat,lng], tags:[...], website, phone, address, osm:{type,id}, named }]
// Elements whose tags do not qualify them as a dog place are dropped, whatever the query returned.
export function parseOverpass(json) {
  if (!json || !Array.isArray(json.elements)) throw new Error('Unexpected Overpass response')
  if (!json.elements.length && json.remark && /error|timed out|timeout/i.test(json.remark)) throw new Error('Overpass: ' + json.remark)
  const seen = new Set(), out = []
  for (const el of json.elements) {
    if (!el || !el.type || el.id == null) continue
    const lat = el.lat != null ? el.lat : el.center && el.center.lat
    const lng = el.lon != null ? el.lon : el.center && el.center.lon
    if (typeof lat !== 'number' || typeof lng !== 'number') continue
    const id = `osm-${el.type}-${el.id}`
    if (seen.has(id)) continue
    const t = el.tags || {}, category = categoryFromTags(t)
    if (!category) continue
    seen.add(id)
    out.push({ id, name: nameFromTags(t), named: !!(t.name || t['name:en'] || t.official_name), kind: kindFromTags(t), category, at: [lat, lng], tags: labelsFromTags(t), chips: labelsFromTags(t, true), details: detailsFromTags(t), website: websiteFromTags(t), phone: phoneFromTags(t), address: addressFromTags(t), osm: { type: el.type, id: el.id } })
  }
  return out
}

export function samplePlaces() { return PLACES.map((p) => ({ ...p, category: 'park', sample: true })) }

async function postOverpass(url, query, fetchImpl, outer, parse = parseOverpass, timeoutMs = TIMEOUT_MS) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  const onOuter = () => ctl.abort()
  if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', onOuter) }
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: 'data=' + encodeURIComponent(query), signal: ctl.signal })
    if (!res.ok) throw new Error('Overpass HTTP ' + res.status)
    return parse(await res.json())
  } finally { clearTimeout(timer); if (outer) outer.removeEventListener('abort', onOuter) }
}
// Asks the first endpoint, and the next one too if the first has not answered after hedgeMs or has failed.
// The first good answer wins and the others are cancelled. Rejects only when every endpoint has failed.
export function raceOverpass(urls, query, fetchImpl, outer, parse, timeoutMs, hedgeMs = HEDGE_MS) {
  return new Promise((resolve, reject) => {
    const ctls = [], timers = []
    let next = 0, open = 0, done = false, firstErr = null
    const finish = (fn, v) => { if (done) return; done = true; timers.forEach(clearTimeout); ctls.forEach((c) => c.abort()); if (outer) outer.removeEventListener('abort', onOuter); fn(v) }
    const onOuter = () => finish(reject, new Error('aborted'))
    const launch = () => {
      if (done || next >= urls.length) return
      const url = urls[next++], ctl = new AbortController()
      ctls.push(ctl); open++
      if (next < urls.length) timers.push(setTimeout(launch, hedgeMs))
      postOverpass(url, query, fetchImpl, ctl.signal, parse, timeoutMs).then((v) => finish(resolve, v), (e) => {
        open--; firstErr = firstErr || e
        if (next < urls.length) launch(); else if (open === 0) finish(reject, firstErr)
      })
    }
    if (outer) { if (outer.aborted) return reject(new Error('aborted')); outer.addEventListener('abort', onOuter) }
    if (!urls.length) return reject(new Error('No Overpass endpoint'))
    launch()
  })
}

// Shared server cache. The Trot server keeps Overpass answers per map tile (GET /api/geo/:kind/:z/:x/:y), so only the
// first person to look at an area waits on Overpass. The server owns the query text: it builds it with buildQuery and
// buildTrailQuery from this file, so client and server cannot drift. On static hosting there is no such server, and
// the client asks Overpass directly as before.
export const GEO_Z = { parks: 12, more: 12, trails: 13 }
export const MAX_GEO_TILES = 9
export function tileOf(lat, lng, z) {
  const n = 2 ** z, la = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180
  return { x: Math.min(n - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n))), y: Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n))) }
}
export function tileBbox(z, x, y) {
  const n = 2 ** z, lat = (v) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * v) / n))) * 180) / Math.PI
  return { s: lat(y + 1), w: (x / n) * 360 - 180, n: lat(y), e: ((x + 1) / n) * 360 - 180 }
}
// The tiles that cover a box. More than MAX_GEO_TILES are trimmed to the 3 by 3 block around the middle, with clamped true.
export function tilesFor(b, z, max = MAX_GEO_TILES) {
  const a = tileOf(b.n, b.w, z), c = tileOf(b.s, b.e, z)
  let x0 = a.x, x1 = c.x, y0 = a.y, y1 = c.y, clamped = false
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > max) {
    const m = tileOf((b.s + b.n) / 2, (b.w + b.e) / 2, z), side = Math.max(1, Math.floor(Math.sqrt(max))), h = Math.floor(side / 2)
    x0 = Math.max(x0, m.x - h); x1 = Math.min(x1, x0 + side - 1); y0 = Math.max(y0, m.y - h); y1 = Math.min(y1, y0 + side - 1); clamped = true
  }
  const tiles = []
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ x, y })
  return { tiles, clamped }
}
const mergeGeom = (a, b) => (Array.isArray(a) && Array.isArray(b) && a.length === b.length ? a.map((g, i) => g || b[i]) : null)
// Elements from several tiles as one list, de-duplicated by type and id. A route relation is clipped differently
// in each tile, so its member geometry is combined point by point rather than one copy being thrown away.
export function mergeElements(lists) {
  const seen = new Map(), out = []
  for (const list of lists) for (const el of list || []) {
    if (!el || !el.type || el.id == null) continue
    const k = el.type + '/' + el.id, have = seen.get(k)
    if (!have) { const copy = el.type === 'relation' && Array.isArray(el.members) ? { ...el, members: el.members.map((m) => ({ ...m })) } : el; seen.set(k, copy); out.push(copy); continue }
    if (el.type !== 'relation' || !Array.isArray(el.members) || !Array.isArray(have.members)) continue
    el.members.forEach((m, i) => {
      const h = have.members[i]
      if (h && h.type === m.type && h.ref === m.ref) { const g = mergeGeom(h.geometry, m.geometry); if (g) h.geometry = g; else if (!h.geometry && m.geometry) h.geometry = m.geometry; else if (m.geometry && h.geometry && m.geometry.length !== h.geometry.length) have.members.push({ ...m }) }
      else if (m && m.geometry) have.members.push({ ...m })
    })
  }
  return out
}
const GEO_FLAG = 'trot-geo'
let geoServer = null // null until known, then true or false for this session
try { const v = sessionStorage.getItem(GEO_FLAG); if (v === '1') geoServer = true; else if (v === '0') geoServer = false } catch (e) {}
const setGeoServer = (v) => { geoServer = v; try { sessionStorage.setItem(GEO_FLAG, v ? '1' : '0') } catch (e) {} }
export function resetGeoServer() { geoServer = null; try { sessionStorage.removeItem(GEO_FLAG) } catch (e) {} }
async function geoTile(kind, z, t, fetchImpl, signal) {
  const res = await fetchImpl(`/api/geo/${kind}/${z}/${t.x}/${t.y}`, { headers: { accept: 'application/json' }, signal })
  let json = null
  if (/json/.test((res.headers && res.headers.get && res.headers.get('content-type')) || '')) { try { json = await res.json() } catch (e) {} }
  if (!res.ok || !json || !Array.isArray(json.elements)) { const err = new Error('geo HTTP ' + res.status); err.missing = !json || res.status === 404; throw err }
  return json.elements
}
// Resolves to { elements, clamped } from the server cache, or rejects so the caller can ask Overpass directly.
async function viaServer(kind, bbox, fetchImpl, signal) {
  if (geoServer === false) throw new Error('no geo server')
  const z = GEO_Z[kind], { tiles, clamped } = tilesFor(bbox, z)
  try {
    // Until the server is known to be there, one tile goes first so a static host costs a single wasted request.
    const head = geoServer ? [] : [await geoTile(kind, z, tiles[0], fetchImpl, signal)]
    if (!geoServer) setGeoServer(true)
    const rest = await Promise.all(tiles.slice(head.length).map((t) => geoTile(kind, z, t, fetchImpl, signal)))
    return { elements: mergeElements(head.concat(rest)), clamped }
  } catch (e) { if (e.missing && geoServer === null) setGeoServer(false); throw e }
}

// Place cache in localStorage, one entry per group and snapped box: { at, places }.
const lsKey = (group, key) => LS_PREFIX + group + ':' + key
function lsGet(k) { try { const v = JSON.parse(localStorage.getItem(k)); return v && typeof v.at === 'number' && Array.isArray(v.places) ? v : null } catch (e) { return null } }
function lsSet(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v))
    // Keep the newest areas only.
    const mine = Object.keys(localStorage).filter((x) => x.startsWith(LS_PREFIX)).map((x) => ({ x, at: (lsGet(x) || { at: 0 }).at })).sort((a, b) => b.at - a.at)
    mine.forEach((e, i) => { if (i >= MAX_CACHED_AREAS * 2 || Date.now() - e.at > DROP_MS) localStorage.removeItem(e.x) })
  } catch (e) {}
}
// Cached places for an area, straight away and without the network.
// Returns null or { places, at, fresh, old }. fresh entries need no refresh; old ones are more than a day old.
export function readPlaceCache(bbox, group = 'parks', now = Date.now()) {
  const k = lsKey(group, bboxKey(snapBbox(bbox))), v = mem.get(k) || lsGet(k)
  if (!v) return null
  const age = now - v.at
  if (age > DROP_MS) return null
  return { places: v.places, at: v.at, fresh: age < CACHE_MS, old: age > OLD_MS }
}
// One Overpass request for one group of one area. Resolves to { places, clamped, cached, failed, error }.
// Never rejects and never substitutes samples: when no endpoint answers, failed is true and places is empty.
//   opts.group   'parks' (default), 'more' or 'all'
//   opts.signal  cancels the request, for example when the area changes
//   opts.force   ask the network even when a fresh cache entry exists
//   opts.slow    give the parks request the long timeout (used for the one automatic retry after the quick try fails)
export async function fetchPlaces(bbox, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null)
  const group = opts.group || 'parks', b = snapBbox(bbox), k = lsKey(group, bboxKey(b))
  if (!opts.force) { const hit = readPlaceCache(bbox, group); if (hit && hit.fresh) return { places: hit.places, clamped: b.clamped, cached: true, failed: false } }
  if (!fetchImpl) return { places: [], clamped: b.clamped, cached: false, failed: true, error: 'fetch is not available' }
  try {
    let places = null
    const direct = () => raceOverpass(opts.endpoints || OVERPASS_ENDPOINTS, buildQuery(b, group), fetchImpl, opts.signal, parseOverpass, group === 'parks' && !opts.slow ? FAST_TIMEOUT_MS : TIMEOUT_MS, opts.hedgeMs)
    if (opts.server !== false && group !== 'all' && geoServer !== false) {
      // The server cache and Overpass itself run side by side: the cache gets a short head start, and whichever
      // answers first is used, so a cold or failing cache never holds the list up.
      const viaCache = viaServer(group, b, fetchImpl, opts.signal).then((r) => parseOverpass({ elements: r.elements }))
      let timer = null
      const late = new Promise((resolve, reject) => { timer = setTimeout(() => direct().then(resolve, reject), opts.headStartMs == null ? 1200 : opts.headStartMs) })
      viaCache.catch(() => {}); late.catch(() => {})
      try { places = await Promise.any([viaCache, late]) } catch (e) { if (opts.signal && opts.signal.aborted) throw e; throw (e && e.errors && e.errors[1]) || e } finally { clearTimeout(timer) }
    }
    if (!places) places = await direct()
    const entry = { at: Date.now(), places }
    mem.set(k, entry); lsSet(k, entry)
    return { places, clamped: b.clamped, cached: false, failed: false }
  } catch (e) {
    return { places: [], clamped: b.clamped, cached: false, failed: true, aborted: !!(opts.signal && opts.signal.aborted), error: String((e && e.message) || e) }
  }
}
// Logs one timing line per name, once per page load, so slow steps show up in the console.
const perfSeen = new Set()
export function perfMark(name, since = 0) {
  if (perfSeen.has(name) || typeof performance === 'undefined') return
  perfSeen.add(name)
  try { console.info(`[trot-perf] ${name} ${Math.round(performance.now() - since)} ms`) } catch (e) {}
}
export function clearPlaceCache() {
  mem.clear(); trailMem.clear()
  try { Object.keys(localStorage).filter((k) => k.startsWith(LS_PREFIX)).forEach((k) => localStorage.removeItem(k)) } catch (e) {}
  try { Object.keys(sessionStorage).filter((k) => k.startsWith(TRAIL_PREFIX)).forEach((k) => sessionStorage.removeItem(k)) } catch (e) {}
}

// Trails: named walking routes and paths from OpenStreetMap, with their geometry.
// Nothing here is invented. A trail is only listed when OSM has a name and a line for it.
const MAX_TRAIL_SPAN = 0.12 // degrees. Geometry is heavy, so the trail box is smaller than the place box.
const MAX_TRAIL_ELEMENTS = 700
export const MIN_TRAIL_MILES = 0.3
export const MAX_TRAILS = 15
const TRAIL_PREFIX = 'trot-trails:'
const trailMem = new Map()
export function clampTrailBbox(b) {
  const cLat = (b.s + b.n) / 2, cLng = (b.w + b.e) / 2
  const hLat = Math.min(b.n - b.s, MAX_TRAIL_SPAN) / 2, hLng = Math.min(b.e - b.w, MAX_TRAIL_SPAN * 1.4) / 2
  const out = { s: cLat - hLat, w: cLng - hLng, n: cLat + hLat, e: cLng + hLng }
  out.clamped = b.n - b.s > MAX_TRAIL_SPAN + 1e-9 || b.e - b.w > MAX_TRAIL_SPAN * 1.4 + 1e-9
  return out
}
// Named ways come with their whole line. Route relations can run for hundreds of miles, so their geometry is
// limited to the box and only the part on the map is sent.
export function buildTrailQuery(b, timeout = 10) {
  const c = `${b.s.toFixed(5)},${b.w.toFixed(5)},${b.n.toFixed(5)},${b.e.toFixed(5)}`
  return `[out:json][timeout:${timeout}];way["highway"~"^(path|footway|cycleway|track)$"]["name"]["foot"!="no"]["access"!="private"](${c});out tags geom ${MAX_TRAIL_ELEMENTS};relation["type"="route"]["route"~"^(hiking|foot)$"]["name"](${c});out tags geom(${c}) 60;`
}
const ptKey = (p) => p[0].toFixed(5) + ',' + p[1].toFixed(5)
const lineLen = (pts) => { let d = 0; for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i]); return d }
// Overpass geometry -> runs of [lat, lng]. Points outside a geom(bbox) come back as null and split the run.
export function geometryRuns(geom) {
  const runs = []
  let cur = []
  for (const g of geom || []) {
    if (g && typeof g.lat === 'number' && typeof g.lon === 'number') cur.push([g.lat, g.lon])
    else { if (cur.length > 1) runs.push(cur); cur = [] }
  }
  if (cur.length > 1) runs.push(cur)
  return runs
}
// Joins segments end to end into continuous chains, reversing a segment where that makes it fit.
// Returns { pts, partial }: the longest chain, and partial true when some segments could not be joined to it.
// Segments are never bridged with a made-up straight line.
export function joinSegments(segments) {
  const segs = (segments || []).filter((s) => Array.isArray(s) && s.length > 1)
  if (!segs.length) return { pts: [], partial: false }
  const used = new Array(segs.length).fill(false), chains = []
  const order = segs.map((s, i) => i).sort((a, b) => lineLen(segs[b]) - lineLen(segs[a]))
  for (const seed of order) {
    if (used[seed]) continue
    used[seed] = true
    let chain = segs[seed].slice(), grew = true
    while (grew) {
      grew = false
      for (let i = 0; i < segs.length; i++) {
        if (used[i]) continue
        const s = segs[i], head = ptKey(chain[0]), tail = ptKey(chain[chain.length - 1]), a = ptKey(s[0]), b = ptKey(s[s.length - 1])
        if (a === tail) chain = chain.concat(s.slice(1))
        else if (b === tail) chain = chain.concat(s.slice(0, -1).reverse())
        else if (b === head) chain = s.slice(0, -1).concat(chain)
        else if (a === head) chain = s.slice(1).reverse().concat(chain)
        else continue
        used[i] = true; grew = true
      }
    }
    chains.push(chain)
  }
  chains.sort((a, b) => lineLen(b) - lineLen(a))
  return { pts: chains[0], partial: chains.length > 1 }
}
const NETWORKS = { lwn: 'Local walking network', rwn: 'Regional walking network', nwn: 'National walking network', iwn: 'International walking network' }
const WAY_KIND = { path: 'Path', footway: 'Footpath', cycleway: 'Cycleway open to walkers', track: 'Track' }
// The one value every tagged piece agrees on, or null. Untagged pieces do not count against it.
function agreed(tagSets, key) { const vals = [...new Set(tagSets.map((t) => t[key]).filter(Boolean))]; return vals.length === 1 ? vals[0] : null }
// Labels shown for a trail, only from tags that are present.
export function trailLabels(t) {
  const out = []
  if (t.surface) out.push((SURFACES[t.surface] || cap(String(t.surface).replace(/_/g, ' '))) + ' surface')
  if (t.dog === 'yes') out.push('Dogs allowed')
  else if (t.dog === 'leashed') out.push('Dogs on leash')
  else if (t.dog === 'unleashed') out.push('Dogs off leash')
  if (t.operator) out.push('Run by ' + String(t.operator).slice(0, 50))
  if (t.network) out.push(NETWORKS[t.network] || String(t.network).slice(0, 50))
  return out
}
const noWalk = (t) => t.foot === 'no' || t.foot === 'private' || t.access === 'private' || t.access === 'no'
// Overpass JSON (out tags geom) -> [{ id, name, kind, pts, miles, partial, labels, osm:{type,id}, near }]
// Sorted nearest to `center` first when one is given, longest first otherwise, and capped at MAX_TRAILS.
// Trails tagged dog=no, anything not open to walkers, and anything under MIN_TRAIL_MILES are left out.
export function parseTrails(json, center) {
  if (!json || !Array.isArray(json.elements)) throw new Error('Unexpected Overpass response')
  if (!json.elements.length && json.remark && /error|timed out|timeout/i.test(json.remark)) throw new Error('Overpass: ' + json.remark)
  const out = [], names = new Set(), groups = new Map()
  const norm = (n) => String(n).trim().toLowerCase().replace(/\s+/g, ' ')
  const add = (id, name, kind, segments, tags, osm) => {
    const j = joinSegments(segments), miles = lineLen(j.pts)
    if (miles < MIN_TRAIL_MILES) return false
    out.push({ id, name: String(name).trim(), kind, pts: j.pts, miles: Math.round(miles * 100) / 100, partial: j.partial, labels: trailLabels(tags), osm })
    return true
  }
  for (const el of json.elements) {
    if (!el || el.id == null) continue
    const t = el.tags || {}
    if (el.type === 'relation') {
      if (!t.name || t.type !== 'route' || !['hiking', 'foot'].includes(t.route) || t.dog === 'no' || noWalk(t)) continue
      const segs = (el.members || []).filter((m) => m && m.type === 'way' && !['alternative', 'excursion', 'approach', 'connection'].includes(m.role)).flatMap((m) => geometryRuns(m.geometry))
      if (add(`trail-relation-${el.id}`, t.name, t.route === 'hiking' ? 'Hiking route' : 'Walking route', segs, t, { type: 'relation', id: el.id })) names.add(norm(t.name))
    } else if (el.type === 'way') {
      if (!t.name || !WAY_KIND[t.highway] || noWalk(t)) continue
      const k = norm(t.name)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(el)
    }
  }
  for (const [k, ways] of groups) {
    // A route relation of the same name already covers these ways.
    if (names.has(k) || ways.some((w) => w.tags.dog === 'no')) continue
    const tags = ways.map((w) => w.tags), kinds = [...new Set(tags.map((t) => WAY_KIND[t.highway]))]
    const merged = { surface: agreed(tags, 'surface'), dog: agreed(tags, 'dog'), operator: agreed(tags, 'operator'), network: agreed(tags, 'network') }
    const first = ways.reduce((a, b) => (a.id < b.id ? a : b))
    add(`trail-way-${first.id}`, first.tags.name, kinds.length === 1 ? kinds[0] : 'Path', ways.flatMap((w) => geometryRuns(w.geometry)), merged, { type: 'way', id: first.id })
  }
  if (center) {
    for (const tr of out) { const step = Math.max(1, Math.floor(tr.pts.length / 60)); let best = Infinity; for (let i = 0; i < tr.pts.length; i += step) best = Math.min(best, haversine(center, tr.pts[i])); tr.near = best }
    out.sort((a, b) => a.near - b.near)
  } else out.sort((a, b) => b.miles - a.miles)
  return out.slice(0, MAX_TRAILS)
}
// Resolves to { trails, clamped, cached, error }. Never rejects and never substitutes samples:
// when Overpass does not answer, trails is empty and error says why.
export async function fetchTrails(bbox, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null)
  const b = clampTrailBbox(bbox), key = bboxKey(b), center = [(b.s + b.n) / 2, (b.w + b.e) / 2]
  const hit = trailMem.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return { trails: hit.trails, clamped: b.clamped, cached: true }
  let stored = null
  try { const v = JSON.parse(sessionStorage.getItem(TRAIL_PREFIX + key)); if (v && Date.now() - v.at < CACHE_MS) stored = v } catch (e) {}
  if (stored) { trailMem.set(key, stored); return { trails: stored.trails, clamped: b.clamped, cached: true } }
  if (!fetchImpl) return { trails: [], clamped: b.clamped, cached: false, error: 'fetch is not available' }
  try {
    let trails = null, clamped = b.clamped
    if (opts.server !== false) { try { const r = await viaServer('trails', b, fetchImpl, opts.signal); trails = parseTrails({ elements: r.elements }, center); clamped = clamped || r.clamped } catch (e) { if (opts.signal && opts.signal.aborted) throw e } }
    if (trails) b.clamped = clamped
    if (!trails) trails = await raceOverpass(opts.endpoints || OVERPASS_ENDPOINTS, buildTrailQuery(b), fetchImpl, opts.signal, (j) => parseTrails(j, center), TIMEOUT_MS, opts.hedgeMs)
    const entry = { at: Date.now(), trails }
    trailMem.set(key, entry)
    try { sessionStorage.setItem(TRAIL_PREFIX + key, JSON.stringify(entry)) } catch (e) {}
    return { trails, clamped: b.clamped, cached: false }
  } catch (e) {
    return { trails: [], clamped: b.clamped, cached: false, aborted: !!(opts.signal && opts.signal.aborted), error: String((e && e.message) || e) }
  }
}
