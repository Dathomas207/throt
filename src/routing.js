// Real walking routes from the public OSRM foot profile, with a geometric fallback.
// Parsing and geometry are pure functions so they can be tested without the network.
import { haversine } from './data.js'

export const DEFAULT_CENTER = [42.3852, -71.1492] // Cambridge, MA
export const OSRM_BASE = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/'
export const PACE_MIN_PER_MILE = 20
const TIMEOUT_MS = 10000
const METERS_PER_MILE = 1609.344
const EARTH_MILES = 3958.8
const STREET_FACTOR = 7.6 // routed loop length is roughly this many circle radii
const cache = new Map()

const round5 = (v) => Math.round(v * 1e5) / 1e5
export function destination(from, bearingDeg, miles) {
  const r = Math.PI / 180, d = miles / EARTH_MILES, b = bearingDeg * r, la1 = from[0] * r, lo1 = from[1] * r
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b))
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2))
  return [la2 / r, lo2 / r]
}
export function pathMiles(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i]); return d }

// n waypoints on a circle of the given radius that passes through the start point.
export function loopWaypoints(start, radiusMiles, bearingDeg, n = 3) {
  const center = destination(start, bearingDeg, radiusMiles), back = bearingDeg + 180, out = []
  for (let k = 1; k <= n; k++) out.push(destination(center, back + (k * 360) / (n + 1), radiusMiles))
  return out
}
export function osrmUrl(points) {
  return OSRM_BASE + points.map((p) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`).join(';') + '?overview=full&geometries=geojson'
}
// OSRM JSON -> { pts:[[lat,lng]...], miles, minutes }
export function parseOsrm(json) {
  if (!json || json.code !== 'Ok' || !Array.isArray(json.routes) || !json.routes.length) throw new Error('OSRM: ' + ((json && (json.message || json.code)) || 'no route'))
  const rt = json.routes[0], coords = rt.geometry && rt.geometry.coordinates
  if (!Array.isArray(coords) || coords.length < 2) throw new Error('OSRM: empty geometry')
  const pts = coords.map((c) => [round5(c[1]), round5(c[0])])
  const miles = (typeof rt.distance === 'number' ? rt.distance / METERS_PER_MILE : pathMiles(pts))
  return { pts, miles: Math.round(miles * 100) / 100, minutes: Math.max(1, Math.round(miles * PACE_MIN_PER_MILE)) }
}
// Simple circle through the start point. Used only when routing is unavailable.
export function geometricLoop(start, miles, bearingDeg = 45, n = 72) {
  const r = miles / (2 * Math.PI), center = destination(start, bearingDeg, r), back = bearingDeg + 180, pts = []
  for (let i = 0; i <= n; i++) pts.push(destination(center, back + (i * 360) / n, r).map(round5))
  pts[0] = pts[n] = start.map(round5)
  const len = pathMiles(pts)
  return { pts, miles: Math.round(len * 100) / 100, minutes: Math.max(1, Math.round(len * PACE_MIN_PER_MILE)), approximate: true }
}

async function osrm(points, opts) {
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null)
  if (!fetchImpl) throw new Error('fetch is not available')
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), opts.timeoutMs || TIMEOUT_MS)
  const onOuter = () => ctl.abort()
  if (opts.signal) { if (opts.signal.aborted) ctl.abort(); else opts.signal.addEventListener('abort', onOuter) }
  try {
    const res = await fetchImpl(osrmUrl(points), { signal: ctl.signal })
    let json = null
    try { json = await res.json() } catch (e) {}
    if (!res.ok && !(json && json.code)) { const err = new Error('OSRM HTTP ' + res.status); err.service = true; throw err }
    return parseOsrm(json)
  } catch (e) {
    // Anything that is not a clean "no route here" answer means the service itself is in trouble.
    if (!/^OSRM: /.test(String(e && e.message))) e.service = true
    throw e
  } finally { clearTimeout(timer); if (opts.signal) opts.signal.removeEventListener('abort', onOuter) }
}

// Loop of roughly `miles` that starts and ends at `start`.
// Resolves to { pts, miles, minutes, approximate, target }. Never rejects.
export async function routeLoop(start, miles, opts = {}) {
  const key = `loop:${start[0].toFixed(4)},${start[1].toFixed(4)}:${miles}`
  if (cache.has(key) && !opts.noCache) return cache.get(key)
  const tries = opts.tries || 3, b0 = opts.bearing == null ? 45 : opts.bearing
  let best = null, scale = 1
  for (let i = 0; i < tries; i++) {
    if (opts.signal && opts.signal.aborted) break
    const bearing = b0 + (i * 360) / tries, radius = (miles / STREET_FACTOR) * scale
    try {
      const r = await osrm([start, ...loopWaypoints(start, radius, bearing), start], opts)
      if (!best || Math.abs(r.miles - miles) < Math.abs(best.miles - miles)) best = r
      if (Math.abs(best.miles - miles) / miles <= 0.1) break
      // Streets made this one too long or too short: resize the circle for the next bearing.
      scale = Math.min(2.5, Math.max(0.4, scale * (miles / Math.max(0.05, r.miles))))
    } catch (e) { if (e.service) break }
  }
  if (!best) return { ...geometricLoop(start, miles, b0), target: miles }
  const out = { ...best, approximate: false, target: miles }
  cache.set(key, out)
  return out
}

// Walking route from a to b. Falls back to a straight line marked approximate.
export async function routeAB(a, b, opts = {}) {
  try { return { ...(await osrm([a, b], opts)), approximate: false } } catch (e) {
    const pts = [a.map(round5), b.map(round5)], len = pathMiles(pts)
    return { pts, miles: Math.round(len * 100) / 100, minutes: Math.max(1, Math.round(len * PACE_MIN_PER_MILE)), approximate: true }
  }
}

// One-shot location. Resolves to [lat, lng] or null; never rejects and never hangs.
export function locate(timeoutMs = 6000) {
  return new Promise((resolve) => {
    let done = false
    const end = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v) } }
    const timer = setTimeout(() => end(null), timeoutMs + 500)
    try {
      if (!navigator.geolocation) return end(null)
      navigator.geolocation.getCurrentPosition((p) => end([p.coords.latitude, p.coords.longitude]), () => end(null), { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 120000 })
    } catch (e) { end(null) }
  })
}

// Explore -> Record handoff. Kept in memory as well, in case sessionStorage is blocked.
const HANDOFF_KEY = 'trot-route'
let pending = null
export function setHandoff(route) { pending = route; try { sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(route)) } catch (e) {} }
export function takeHandoff() {
  let r = pending; pending = null
  try { const raw = sessionStorage.getItem(HANDOFF_KEY); sessionStorage.removeItem(HANDOFF_KEY); if (!r && raw) r = JSON.parse(raw) } catch (e) {}
  if (!r || typeof r !== 'object') return null
  if (r.kind === 'demo') return r.key ? r : null
  return Array.isArray(r.pts) && r.pts.length > 1 && r.miles > 0 ? r : null
}
