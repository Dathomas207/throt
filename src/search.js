// Place search for Explore. Mapbox Geocoding v6 when the server has a public token, OpenStreetMap Nominatim otherwise.
// Parsing is kept in pure functions so it can be tested without the network.
import { getConfig } from './config.js'

export const MIN_QUERY = 3
export const SEARCH_LIMIT = 5
export const SEARCH_FAILED = 'Search is unavailable right now'
const TIMEOUT_MS = 8000
const okNum = (v) => typeof v === 'number' && Number.isFinite(v)
const okAt = (lat, lng) => okNum(lat) && okNum(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

export function mapboxGeocodeUrl(q, token, near) {
  const prox = near && okAt(near[0], near[1]) ? `&proximity=${near[1].toFixed(4)},${near[0].toFixed(4)}` : ''
  return `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(q)}${prox}&limit=${SEARCH_LIMIT}&access_token=${encodeURIComponent(token)}`
}
export function nominatimUrl(q) {
  return `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${SEARCH_LIMIT}&q=${encodeURIComponent(q)}`
}

// Mapbox Geocoding v6 FeatureCollection -> [{ name, detail, at:[lat,lng] }]
export function parseMapboxGeocode(json) {
  if (!json || !Array.isArray(json.features)) throw new Error('Unexpected geocoding response')
  const out = []
  for (const f of json.features) {
    const p = (f && f.properties) || {}, c = p.coordinates || {}, g = (f && f.geometry && f.geometry.coordinates) || []
    const lat = okNum(c.latitude) ? c.latitude : g[1], lng = okNum(c.longitude) ? c.longitude : g[0]
    const name = String(p.name_preferred || p.name || p.full_address || '').trim()
    if (!name || !okAt(lat, lng)) continue
    out.push({ name, detail: String(p.place_formatted || (p.full_address && p.full_address !== name ? p.full_address : '') || ''), at: [lat, lng] })
    if (out.length >= SEARCH_LIMIT) break
  }
  return out
}
// Nominatim jsonv2 array -> [{ name, detail, at:[lat,lng] }]
export function parseNominatim(json) {
  if (!Array.isArray(json)) throw new Error('Unexpected geocoding response')
  const out = []
  for (const r of json) {
    if (!r) continue
    const lat = parseFloat(r.lat), lng = parseFloat(r.lon)
    const parts = String(r.display_name || '').split(',').map((s) => s.trim()).filter(Boolean)
    const name = String(r.name || parts[0] || '').trim()
    if (!name || !okAt(lat, lng)) continue
    out.push({ name, detail: (parts[0] === name ? parts.slice(1) : parts).join(', '), at: [lat, lng] })
    if (out.length >= SEARCH_LIMIT) break
  }
  return out
}

async function getJson(url, fetchImpl, outer) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  const onOuter = () => ctl.abort()
  if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', onOuter) }
  try {
    const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: ctl.signal })
    if (!res.ok) throw new Error('Search HTTP ' + res.status)
    return await res.json()
  } finally { clearTimeout(timer); if (outer) outer.removeEventListener('abort', onOuter) }
}

// Resolves to 'live' when suggestions can be fetched while typing (Mapbox) and 'submit' otherwise.
// The public Nominatim server does not allow search-as-you-type, so it is only asked when the search is submitted.
export async function searchMode(opts = {}) {
  let token = opts.token
  if (token == null) { try { token = ((await getConfig()) || {}).mapboxToken || '' } catch (e) { token = '' } }
  return token ? 'live' : 'submit'
}

// Resolves to { results, error, needSubmit }. Never rejects.
//   opts.near [lat, lng]   biases Mapbox results toward the visible map
//   opts.submit            true when the user pressed Enter or the Search button
export async function searchPlaces(query, opts = {}) {
  const q = String(query || '').trim()
  if (q.length < MIN_QUERY) return { results: [], error: null, needSubmit: false }
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null)
  if (!fetchImpl) return { results: [], error: SEARCH_FAILED, needSubmit: false }
  let token = opts.token
  if (token == null) { try { token = ((await getConfig()) || {}).mapboxToken || '' } catch (e) { token = '' } }
  if (token) {
    try { return { results: parseMapboxGeocode(await getJson(mapboxGeocodeUrl(q, token, opts.near), fetchImpl, opts.signal)), error: null, needSubmit: false } } catch (e) {
      if (opts.signal && opts.signal.aborted) return { results: [], error: 'aborted', needSubmit: false }
    }
  }
  if (!opts.submit) return token ? { results: [], error: SEARCH_FAILED, needSubmit: false } : { results: [], error: null, needSubmit: true }
  try { return { results: parseNominatim(await getJson(nominatimUrl(q), fetchImpl, opts.signal)), error: null, needSubmit: false } } catch (e) {
    return { results: [], error: SEARCH_FAILED, needSubmit: false }
  }
}
