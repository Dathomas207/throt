// Real dog-friendly places from OpenStreetMap through the Overpass API.
// Parsing is kept in pure functions so it can be tested without the network.
import { PLACES } from './data.js'

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const TIMEOUT_MS = 12000
const CACHE_MS = 10 * 60 * 1000
const MAX_SPAN = 0.35 // degrees. Larger views are clamped around their center.
const MAX_RESULTS = 150
const SS_PREFIX = 'trot-osm:'
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

export function buildQuery(b) {
  const box = `(${b.s.toFixed(5)},${b.w.toFixed(5)},${b.n.toFixed(5)},${b.e.toFixed(5)})`
  return `[out:json][timeout:10];(nwr["leisure"="dog_park"]${box};nwr["leisure"~"^(park|nature_reserve)$"]["dog"~"^(yes|leashed|unleashed)$"]${box};);out center tags ${MAX_RESULTS};`
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const SURFACES = { grass: 'Grass', dirt: 'Dirt', earth: 'Dirt', ground: 'Dirt', sand: 'Sand', gravel: 'Gravel', fine_gravel: 'Gravel', pebblestone: 'Gravel', woodchips: 'Wood chips', bark: 'Wood chips', mulch: 'Wood chips', asphalt: 'Paved', paved: 'Paved', concrete: 'Paved', artificial_turf: 'Artificial turf', compacted: 'Compacted' }

// Human labels derived only from tags that are present on the OSM element.
export function labelsFromTags(t = {}) {
  const out = []
  const dogPark = t.leisure === 'dog_park'
  // leisure=dog_park is defined by OSM as an area for exercising dogs off the leash.
  if (t.dog === 'unleashed' || (dogPark && t.dog !== 'leashed')) out.push('Off-leash')
  if (t.dog === 'leashed') out.push('On leash')
  if (t.dog === 'yes' && !dogPark) out.push('Dogs allowed')
  if (t.fenced === 'yes' || ['fence', 'wall', 'hedge'].includes(t.barrier)) out.push('Fenced')
  else if (t.fenced === 'no') out.push('No fence')
  if (t.lit === 'yes') out.push('Lit at night')
  if (t.drinking_water === 'yes') out.push('Drinking water')
  if (t.surface) out.push((SURFACES[t.surface] || cap(String(t.surface).replace(/_/g, ' '))) + ' surface')
  if (t.wheelchair === 'yes') out.push('Wheelchair access')
  if (t.fee === 'yes') out.push('Fee')
  if (t.access === 'private') out.push('Private access')
  else if (t.access === 'customers') out.push('Customers only')
  else if (t.access === 'permit') out.push('Permit needed')
  if (t.opening_hours) out.push(t.opening_hours === '24/7' ? 'Open 24 hours' : 'Hours: ' + String(t.opening_hours).slice(0, 40))
  return out
}
export function kindFromTags(t = {}) {
  if (t.leisure === 'dog_park') return t.fenced === 'yes' || t.barrier === 'fence' ? 'Fenced dog park' : 'Dog park'
  const base = t.leisure === 'nature_reserve' ? 'Nature reserve' : 'Park'
  return base + (t.dog === 'leashed' ? ', dogs on leash' : t.dog === 'unleashed' ? ', dogs off leash' : ', dogs allowed')
}
export function nameFromTags(t = {}) {
  const n = t.name || t['name:en'] || t.official_name
  if (n) return String(n)
  return t.leisure === 'dog_park' ? 'Dog park' : t.leisure === 'nature_reserve' ? 'Nature reserve' : 'Park'
}

// Overpass JSON -> [{ id, name, kind, at:[lat,lng], tags:[...], osm:{type,id}, named }]
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
    seen.add(id)
    const t = el.tags || {}
    out.push({ id, name: nameFromTags(t), named: !!(t.name || t['name:en'] || t.official_name), kind: kindFromTags(t), at: [lat, lng], tags: labelsFromTags(t), osm: { type: el.type, id: el.id } })
  }
  return out
}

export function samplePlaces() { return PLACES.map((p) => ({ ...p, sample: true })) }

function ssGet(key) { try { const v = JSON.parse(sessionStorage.getItem(SS_PREFIX + key)); return v && Date.now() - v.at < CACHE_MS ? v : null } catch (e) { return null } }
function ssSet(key, v) { try { sessionStorage.setItem(SS_PREFIX + key, JSON.stringify(v)) } catch (e) {} }

async function postOverpass(url, query, fetchImpl, outer) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  const onOuter = () => ctl.abort()
  if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', onOuter) }
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: 'data=' + encodeURIComponent(query), signal: ctl.signal })
    if (!res.ok) throw new Error('Overpass HTTP ' + res.status)
    return parseOverpass(await res.json())
  } finally { clearTimeout(timer); if (outer) outer.removeEventListener('abort', onOuter) }
}

// Resolves to { places, sample, clamped, cached, error }. Never rejects:
// when every endpoint fails it returns the seeded sample places with sample:true.
export async function fetchPlaces(bbox, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null)
  const b = clampBbox(bbox), key = bboxKey(b)
  const hit = mem.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return { places: hit.places, sample: false, clamped: b.clamped, cached: true }
  const stored = ssGet(key)
  if (stored) { mem.set(key, stored); return { places: stored.places, sample: false, clamped: b.clamped, cached: true } }
  let error = fetchImpl ? null : new Error('fetch is not available')
  if (fetchImpl) {
    const query = buildQuery(b)
    for (const url of opts.endpoints || OVERPASS_ENDPOINTS) {
      if (opts.signal && opts.signal.aborted) { error = new Error('aborted'); break }
      try {
        const places = await postOverpass(url, query, fetchImpl, opts.signal)
        const entry = { at: Date.now(), places }
        mem.set(key, entry); ssSet(key, entry)
        return { places, sample: false, clamped: b.clamped, cached: false }
      } catch (e) { error = e }
    }
  }
  return { places: samplePlaces(), sample: true, clamped: false, cached: false, error: String((error && error.message) || error) }
}
export function clearPlaceCache() { mem.clear(); try { Object.keys(sessionStorage).filter((k) => k.startsWith(SS_PREFIX)).forEach((k) => sessionStorage.removeItem(k)) } catch (e) {} }
