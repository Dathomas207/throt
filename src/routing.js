import { useEffect, useRef, useState } from 'react'
import { getConfig } from './config.js'
// Real walking routes from the public OSRM foot profile, with a geometric fallback.
// Parsing and geometry are pure functions so they can be tested without the network.
import { haversine, ROUTES } from './data.js'

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
// Length in miles of a line of [lat, lng] points. Every distance shown for a drawn line comes from this,
// so the number always matches the line on the map.
export function pathMiles(pts) { let d = 0; for (let i = 1; i < (pts ? pts.length : 0); i++) d += haversine(pts[i - 1], pts[i]); return d }
export const walkMinutes = (miles) => Math.max(1, Math.round(miles * PACE_MIN_PER_MILE))
// The first `miles` of a line, ending on an interpolated point, so pathMiles(lineUpTo(pts, x)) is x.
export function lineUpTo(pts, miles) {
  if (!pts || !pts.length) return []
  const out = [pts[0]]
  let d = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], step = haversine(a, b)
    if (d + step <= miles) { out.push(b); d += step; continue }
    const t = step > 0 ? Math.max(0, (miles - d) / step) : 0
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    break
  }
  if (out.length < 2) out.push(pts[0])
  return out
}
// Miles for display: feet (to the nearest 10) under a tenth of a mile, one decimal up to 10 miles, whole miles beyond.
export function fmtDist(mi) {
  if (!Number.isFinite(mi) || mi < 0) return ''
  if (mi < 0.1) return Math.max(10, Math.round((mi * 5280) / 10) * 10) + ' ft'
  return mi.toFixed(mi < 9.95 ? 1 : 0) + ' mi'
}

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
  // miles is the length of the geometry that gets drawn. The router's own figure is kept alongside for reference.
  const miles = pathMiles(pts)
  return { pts, miles: Math.round(miles * 100) / 100, minutes: Math.max(1, Math.round(miles * PACE_MIN_PER_MILE)), routerMiles: typeof rt.distance === 'number' ? Math.round((rt.distance / METERS_PER_MILE) * 100) / 100 : null }
}
// Simple circle through the start point. Used only when routing is unavailable.
export function geometricLoop(start, miles, bearingDeg = 45, n = 72) {
  const r = miles / (2 * Math.PI), center = destination(start, bearingDeg, r), back = bearingDeg + 180, pts = []
  for (let i = 0; i <= n; i++) pts.push(destination(center, back + (i * 360) / n, r).map(round5))
  pts[0] = pts[n] = start.map(round5)
  const len = pathMiles(pts)
  return { pts, miles: Math.round(len * 100) / 100, minutes: Math.max(1, Math.round(len * PACE_MIN_PER_MILE)), approximate: true }
}

async function osrmVia(url, points, opts) {
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null)
  if (!fetchImpl) throw new Error('fetch is not available')
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), opts.timeoutMs || TIMEOUT_MS)
  const onOuter = () => ctl.abort()
  if (opts.signal) { if (opts.signal.aborted) ctl.abort(); else opts.signal.addEventListener('abort', onOuter) }
  try {
    const res = await fetchImpl(url, { signal: ctl.signal })
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

export function mapboxUrl(points, token) {
  return 'https://api.mapbox.com/directions/v5/mapbox/walking/' + points.map((p) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`).join(';') + '?overview=full&geometries=geojson&access_token=' + encodeURIComponent(token)
}
// Mapbox walking directions when a token is configured, the public OSRM server otherwise or on failure.
async function osrm(points, opts) {
  if (!opts.fetchImpl) {
    let token = ''
    try { token = ((await getConfig()) || {}).mapboxToken || '' } catch (e) {}
    if (token) { try { return await osrmVia(mapboxUrl(points, token), points, opts) } catch (e) { if (!e.service) throw e } }
  }
  return osrmVia(osrmUrl(points), points, opts)
}

// Loop of roughly `miles` that starts and ends at `start`.
// Resolves to { pts, miles, minutes, approximate, target }. Never rejects.
export async function routeLoop(start, miles, opts = {}) {
  const key = `loop:${start[0].toFixed(4)},${start[1].toFixed(4)}:${miles}:${opts.bearing == null ? 45 : opts.bearing}`
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

// Walking route through every point in order (two or more). Mapbox first, OSRM second, and straight
// segments marked approximate as the last resort. Resolves to { pts, miles, minutes, approximate }. Never rejects.
export const MAX_WAYPOINTS = 25 // the Mapbox walking profile takes at most 25 coordinates per request
export function straightThrough(points) {
  const pts = points.map((p) => p.map(round5)), len = pathMiles(pts)
  return { pts, miles: Math.round(len * 100) / 100, minutes: pts.length > 1 ? Math.max(1, Math.round(len * PACE_MIN_PER_MILE)) : 0, approximate: pts.length > 1 }
}
export async function routeThrough(points, opts = {}) {
  const wps = (points || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).slice(0, MAX_WAYPOINTS)
  if (wps.length < 2) return straightThrough(wps)
  try { return { ...(await osrm(wps, opts)), approximate: false } } catch (e) { return straightThrough(wps) }
}

// Seeded demo routes are drawn shapes. One that carries `via` (points around the real place) is resolved once
// through the walking router as a closed loop, so the demo follows mapped paths. The answer is kept in memory
// and in localStorage. Until it resolves, or when routing fails, the seeded line is returned marked approximate.
const DEMO_KEY = 'trot-demo-route1:'
const demoMem = new Map(), demoBusy = new Map()
const seededRoute = (key) => { const r = ROUTES[key]; return r ? { pts: r.pts, miles: r.miles, minutes: r.minutes, approximate: true } : null }
const okLine = (v) => v && Array.isArray(v.pts) && v.pts.length > 1 && v.pts.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) && v.miles > 0
// What is known right now, without the network: the routed loop if it is cached, the seeded line otherwise. Null for an unknown key.
export function peekDemoRoute(key) {
  if (demoMem.has(key)) return demoMem.get(key)
  const r = ROUTES[key]
  if (!r) return null
  if (Array.isArray(r.via) && r.via.length > 1) {
    try { const v = JSON.parse(localStorage.getItem(DEMO_KEY + key)); if (okLine(v) && v.n === r.via.length) { const out = { pts: v.pts, miles: v.miles, minutes: v.minutes, approximate: false }; demoMem.set(key, out); return out } } catch (e) {}
  }
  return seededRoute(key)
}
// Promise of { pts, miles, minutes, approximate } for a seeded route key. Never rejects. Resolves to null for an unknown key.
export function resolveDemoRoute(key, opts = {}) {
  const r = ROUTES[key]
  if (!r) return Promise.resolve(null)
  const known = peekDemoRoute(key)
  if (!known.approximate || !Array.isArray(r.via) || r.via.length < 2) return Promise.resolve(known)
  if (demoBusy.has(key)) return demoBusy.get(key)
  const p = routeThrough([...r.via, r.via[0]], opts).then((rt) => {
    demoBusy.delete(key)
    if (rt.approximate || !okLine(rt)) return seededRoute(key)
    const out = { pts: rt.pts, miles: rt.miles, minutes: rt.minutes, approximate: false }
    demoMem.set(key, out)
    try { localStorage.setItem(DEMO_KEY + key, JSON.stringify({ ...out, n: r.via.length })) } catch (e) {}
    return out
  }, () => { demoBusy.delete(key); return seededRoute(key) })
  demoBusy.set(key, p)
  return p
}

// Saved routes from the route builder, newest first, kept in localStorage.
export const SAVED_KEY = 'trot-saved-routes'
export const MAX_SAVED = 20
const MAX_SAVED_PTS = 1500
const okPt = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
export function thin(pts, max = MAX_SAVED_PTS) {
  if (pts.length <= max) return pts
  const out = []
  for (let i = 0; i < max; i++) out.push(pts[Math.round((i * (pts.length - 1)) / (max - 1))])
  return out
}
// Drops anything that is not a usable route and caps the list.
export function cleanSaved(list) {
  if (!Array.isArray(list)) return []
  return list.filter((r) => r && typeof r === 'object' && r.id && Array.isArray(r.pts) && r.pts.length > 1 && r.pts.every(okPt) && r.miles > 0)
    .map((r) => ({ id: String(r.id), name: String(r.name || 'My route').slice(0, 60), miles: r.miles, minutes: Math.max(1, Math.round(r.minutes) || 1), pts: r.pts, waypoints: Array.isArray(r.waypoints) && r.waypoints.every(okPt) ? r.waypoints : [r.pts[0], r.pts[r.pts.length - 1]], approximate: !!r.approximate, trail: !!r.trail, at: r.at || 0 }))
    .slice(0, MAX_SAVED)
}
export function addSaved(list, route, name) {
  // The stored distance is measured from the stored line, so a thinned line never carries a stale number.
  const pts = thin(route.pts), miles = Math.round(pathMiles(pts) * 100) / 100
  const entry = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(name || '').trim() || `${miles.toFixed(1)} mi route`, miles, minutes: walkMinutes(miles), pts, waypoints: route.waypoints, approximate: !!route.approximate, trail: !!route.trail, at: Date.now() }
  return cleanSaved([entry, ...cleanSaved(list)])
}
export function loadSavedRoutes() { try { return cleanSaved(JSON.parse(localStorage.getItem(SAVED_KEY))) } catch (e) { return [] } }
function storeSaved(list) { try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); return true } catch (e) { return false } }
// Both resolve to { list, ok }. ok is false when the browser refused to store the list.
export function saveRoute(route, name) { const list = addSaved(loadSavedRoutes(), route, name); return { list, ok: storeSaved(list) } }
export function deleteSavedRoute(id) { const list = loadSavedRoutes().filter((r) => r.id !== id); return { list, ok: storeSaved(list) } }

// The last good fix is remembered for the session, so "Loop from here" answers faster the second time.
const FIX_KEY = 'trot-fix'
const FIX_MAX_AGE_MS = 5 * 60 * 1000
let lastFix = null
function rememberFix(at, accuracy) { lastFix = { at, accuracy: accuracy == null ? null : accuracy, t: Date.now() }; try { sessionStorage.setItem(FIX_KEY, JSON.stringify(lastFix)) } catch (e) {} }
export function lastKnownFix(maxAgeMs = FIX_MAX_AGE_MS) {
  let f = lastFix
  if (!f) { try { f = JSON.parse(sessionStorage.getItem(FIX_KEY)) } catch (e) {} }
  return f && Array.isArray(f.at) && Number.isFinite(f.at[0]) && Number.isFinite(f.at[1]) && Date.now() - f.t < maxAgeMs ? f : null
}
// Location asked for right now, from a tap. High accuracy first, then one low-accuracy retry, inside timeoutMs overall.
// Resolves to { at:[lat,lng], accuracy, cached } or { error: 'denied' | 'timeout' | 'unavailable' | 'unsupported' }.
// Never rejects, never hangs, and never substitutes a default place.
export function locateNow(opts = {}) {
  const total = opts.timeoutMs || 10000
  const known = opts.fresh ? null : lastKnownFix()
  if (known) return Promise.resolve({ at: known.at, accuracy: known.accuracy, cached: true })
  return new Promise((resolve) => {
    const t0 = Date.now()
    let done = false
    const end = (v) => { if (done) return; done = true; clearTimeout(timer); if (v.at) rememberFix(v.at, v.accuracy); resolve(v) }
    const timer = setTimeout(() => end({ error: 'timeout' }), total)
    const ok = (p) => end({ at: [p.coords.latitude, p.coords.longitude], accuracy: p.coords.accuracy, cached: false })
    const why = (e) => (e && e.code === 1 ? 'denied' : e && e.code === 3 ? 'timeout' : 'unavailable')
    try {
      const geo = typeof navigator !== 'undefined' && navigator.geolocation
      if (!geo) return end({ error: 'unsupported' })
      const low = () => { const left = total - (Date.now() - t0) - 200; if (left < 500) return end({ error: 'timeout' }); geo.getCurrentPosition(ok, (e) => end({ error: why(e) }), { enableHighAccuracy: false, timeout: left, maximumAge: 60000 }) }
      geo.getCurrentPosition(ok, (e) => { if (why(e) === 'denied') end({ error: 'denied' }); else low() }, { enableHighAccuracy: true, timeout: Math.round(total * 0.6), maximumAge: 10000 })
    } catch (e) { end({ error: 'unavailable' }) }
  })
}
// Plain words for why there is no location, and what to do about it.
export function locationHelp(reason) {
  if (reason === 'denied') return 'Location is off for this site. Turn it on in Settings, Safari, Location, or pick a place on the map.'
  if (reason === 'timeout') return 'Your location did not arrive in time. Check that Location Services is on and try again somewhere with a clearer view of the sky, or pick a place on the map.'
  if (reason === 'unsupported') return 'This browser cannot share a location. Pick a place on the map instead.'
  return 'Your location is unavailable right now. Check that Location Services is on and try again, or pick a place on the map.'
}
// "Loop from here" for Record and Explore. loop is null or
// { miles, status: 'locating' | 'routing' | 'ready' | 'nofix', at, from: 'you' | 'map', bearing, route, reason }.
export function useHereLoop() {
  const [loop, setLoop] = useState(null)
  const req = useRef(0), alive = useRef(true), cur = useRef(null)
  cur.current = loop
  useEffect(() => { alive.current = true; return () => { alive.current = false; req.current++ } }, [])
  const route = async (at, from, miles, bearing) => {
    const id = ++req.current
    setLoop({ miles, status: 'routing', at, from, bearing })
    const rt = await routeLoop(at, miles, { bearing })
    if (!alive.current || id !== req.current) return
    setLoop({ miles, status: 'ready', at, from, bearing, route: rt })
  }
  // Asks for the location now (call it from the tap) and builds the loop from that exact point.
  const fromHere = async (miles = 2) => {
    const id = ++req.current
    setLoop({ miles, status: 'locating' })
    const r = await locateNow()
    if (!alive.current || id !== req.current) return
    if (r.error) { setLoop({ miles, status: 'nofix', reason: r.error }); return }
    route(r.at, 'you', miles, 45)
  }
  const setMiles = (miles) => { const l = cur.current; if (l && l.at) route(l.at, l.from, miles, l.bearing == null ? 45 : l.bearing); else fromHere(miles) }
  const another = () => { const l = cur.current; if (l && l.at) route(l.at, l.from, l.miles, ((l.bearing == null ? 45 : l.bearing) + 97) % 360) }
  // Only for when the person chooses it after location failed. The result is labelled as not their location.
  const fromCenter = (center) => { const l = cur.current; route(center, 'map', l ? l.miles : 2, 45) }
  const clear = () => { req.current++; setLoop(null) }
  return { loop, fromHere, setMiles, another, fromCenter, clear }
}

// One-shot location. Resolves to [lat, lng] or null; never rejects and never hangs.
export function locate(timeoutMs = 6000) {
  return new Promise((resolve) => {
    let done = false
    const end = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v) } }
    const timer = setTimeout(() => end(null), timeoutMs + 500)
    try {
      if (!navigator.geolocation) return end(null)
      navigator.geolocation.getCurrentPosition((p) => { rememberFix([p.coords.latitude, p.coords.longitude], p.coords.accuracy); end([p.coords.latitude, p.coords.longitude]) }, () => end(null), { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 120000 })
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
