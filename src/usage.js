// First-party usage counts and client error capture. Nothing here talks to anyone but the Trot server.
//
// What is kept out, on purpose:
// - Nothing is sent when the browser says Do Not Track or Global Privacy Control, or when there is no Trot API.
// - No coordinates, no request bodies, no text a person typed. Numbers go as buckets ("10_30"), not exact values.
// - An error message is cut to 200 characters and has emails, tokens, ids and long digit runs masked before it
//   leaves the device. The server masks it again.
// The last 20 errors are also kept on this device only, for the Help and diagnostics screen.

// The full list. The server keeps the same one (USAGE_EVENTS in server/routesUsage.js) and drops anything else.
export const EVENTS = ['app_open', 'sign_up', 'sign_in', 'dog_created', 'tab_view', 'walk_started', 'walk_saved', 'walk_discarded', 'photo_added', 'friend_added', 'friend_removed', 'invite_link_copied', 'care_invite_sent', 'care_invite_accepted', 'place_opened', 'place_confirmed', 'place_claim_sent', 'place_reported', 'route_built', 'route_edited', 'route_saved', 'route_favorited', 'route_started', 'loop_from_here', 'event_marked', 'tag_created', 'lost_mode_on', 'lost_mode_off', 'registration_saved', 'plan_viewed', 'notification_opened', 'location_permission', 'training_opened', 'training_session_logged', 'training_level_confirmed', 'training_badge_earned', 'client_error']
// The demo saves nothing, so it only counts looking around. Sign-ups, walks, friends and the rest are real accounts only.
const DEMO_OK = new Set(['app_open', 'tab_view', 'training_opened', 'walk_started', 'walk_discarded', 'place_opened', 'route_built', 'route_edited', 'route_started', 'loop_from_here', 'plan_viewed', 'notification_opened', 'location_permission', 'client_error'])

/* global __APP_VERSION__ */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'dev'
const ANON = 'trot-anon', ERRORS = 'trot-errors'
const BATCH = 20, MAX_BYTES = 3600, WAIT_MS = 4000, HOLD = 60
const nav = typeof navigator !== 'undefined' ? navigator : {}
const win = typeof window !== 'undefined' ? window : {}

// The browser's own opt-out. Checked on every call, so changing the setting takes effect without a reload.
export function optedOut() {
  try { return nav.globalPrivacyControl === true || nav.doNotTrack === '1' || nav.doNotTrack === 'yes' || win.doNotTrack === '1' || nav.msDoNotTrack === '1' } catch (e) { return false }
}
export const isStandalone = () => { try { return !!(nav.standalone === true || (win.matchMedia && win.matchMedia('(display-mode: standalone)').matches)) } catch (e) { return false } }

let base = '', getToken = () => null
let ready = null // null until the API probe answers, then true or false
let demo = false, dog = null, screen = 'boot'
let queue = [], timer = null
export function configureUsage(o) { base = o.base || ''; getToken = o.getToken || getToken }
// Called once the app knows whether a real Trot API is there. Without one, everything queued is dropped.
export function usageReady(ok) { ready = !!ok; if (!ready) queue = []; else schedule() }
export function setUsageMode(mode) { demo = mode === 'demo' }
export function setUsageDog(slug) { dog = slug || null }
export function setScreen(name) { screen = String(name || '').slice(0, 30) || screen }
export const currentScreen = () => screen

function anonId() {
  try {
    let id = localStorage.getItem(ANON)
    if (!id || !/^[A-Za-z0-9_-]{8,40}$/.test(id)) {
      const b = new Uint8Array(12); crypto.getRandomValues(b)
      id = 'a' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
      localStorage.setItem(ANON, id)
    }
    return id
  } catch (e) { return null }
}
export const minutesBucket = (m) => (!(m >= 0) ? 'unknown' : m < 10 ? 'under_10' : m < 30 ? '10_30' : m < 60 ? '30_60' : 'over_60')
// How many legs a route had when its edit was finished.
export const legsBucket = (n) => (!(n > 0) ? 'none' : n < 3 ? '1_2' : n < 6 ? '3_5' : n < 11 ? '6_10' : 'over_10')
export const milesBucket = (m) => (!(m > 0) ? 'none' : m < 1 ? 'under_1' : m < 3 ? '1_3' : m < 5 ? '3_5' : 'over_5')

// Queue one event. Safe to call anywhere: it never throws and never waits on the network.
export function track(name, props) {
  try {
    if (!EVENTS.includes(name) || ready === false || optedOut() || (demo && !DEMO_OK.has(name))) return
    queue.push({ name, props: props || {}, t: Date.now(), dog: demo ? null : dog })
    if (queue.length > HOLD) queue.splice(0, queue.length - HOLD)
    schedule()
  } catch (e) { /* counting must never break the app */ }
}
function schedule() { if (ready === true && !timer && queue.length) timer = setTimeout(() => { timer = null; flush() }, WAIT_MS) }
function send(body) {
  const url = base + '/api/usage'
  // text/plain keeps sendBeacon a simple request. It cannot set headers, so the session token rides in the body.
  try { if (nav.sendBeacon && nav.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return } catch (e) { /* fall through to fetch */ }
  try { fetch(url, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain;charset=UTF-8' } }).catch(() => {}) } catch (e) { /* nothing to do */ }
}
export function flush() {
  try {
    if (ready !== true || !queue.length) return
    if (optedOut()) { queue = []; return }
    const token = getToken(), anon = token ? null : anonId(), now = Date.now()
    if (!token && !anon) { queue = []; return }
    while (queue.length) {
      let take = queue.slice(0, BATCH), body = ''
      // Stay under the server's 4 KB cap: send fewer events rather than a body that is refused.
      for (;;) {
        body = JSON.stringify({ v: APP_VERSION, ...(token ? { auth: token } : { anon }), events: take.map((e) => ({ name: e.name, props: e.props, ...(e.dog ? { dog: e.dog } : {}), ago: Math.max(0, now - e.t) })) })
        if (body.length <= MAX_BYTES || take.length <= 1) break
        take = take.slice(0, Math.ceil(take.length / 2))
      }
      queue.splice(0, take.length)
      if (body.length <= MAX_BYTES) send(body)
    }
  } catch (e) { queue = [] }
}

// ---- client errors ------------------------------------------------------------
export function maskText(v, max = 200) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/g, '[email]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/-?\d{1,3}\.\d{4,}/g, '[n]')
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}\b/g, '[token]')
    .replace(/\d{6,}/g, '[digits]')
    .replace(/\s+/g, ' ').trim().slice(0, max)
}
// "/dogs/biscuit-2/walks?x=1" becomes "/dogs/:id/walks". Only these fixed words of the API's paths are kept.
const FIXED = new Set(['api', 'dogs', 'walks', 'routes', 'route', 'photos', 'photo', 'friends', 'feed', 'suggestions', 'search', 'me', 'session', 'places', 'confirm', 'claim', 'report', 'events', 'entries', 'awards', 'health', 'shares', 'documents', 'file', 'registration', 'tags', 'scans', 'read', 'lost', 'invites', 'accept', 'members', 'challenges', 'leaderboards', 'pack', 'notifications', 'prefs', 'usage', 'admin', 'metrics', 'claims', 'reports', 'approve', 'reject', 'resolve', 'public', 'geo', 'config', 'heat', 'paw', 'parks', 'more'])
export function pathPattern(v) {
  const p = String(v == null ? '' : v).split(/[?#]/)[0].slice(0, 200)
  return p.split('/').map((seg, i) => (seg === '' && i === 0 ? '' : FIXED.has(seg) ? seg : ':id')).join('/').slice(0, 80)
}
const seen = new Map() // this session: key -> { props, total, sent }
export function localErrors() { try { const v = JSON.parse(localStorage.getItem(ERRORS)); return Array.isArray(v) ? v.slice(0, 20) : [] } catch (e) { return [] } }
export function clearLocalErrors() { try { localStorage.removeItem(ERRORS) } catch (e) { /* private mode */ } }
function remember(key, props) {
  try {
    const list = localErrors(), now = new Date().toISOString()
    const old = list.find((x) => x.key === key)
    const next = old ? [{ ...old, n: (old.n || 1) + 1, at: now }, ...list.filter((x) => x !== old)] : [{ key, at: now, n: 1, ...props, v: APP_VERSION }, ...list]
    localStorage.setItem(ERRORS, JSON.stringify(next.slice(0, 20)))
  } catch (e) { /* private mode */ }
}
// kind is one of: window, promise, render, api, geo, photo. extra may carry method, path, status, code and screen.
// The same error is sent once per session; how many more times it happened goes out when the page is hidden.
export function captureError(kind, message, extra = {}) {
  try {
    const props = { message: maskText(message) || 'Unknown error', kind, screen: extra.screen || screen }
    if (extra.method) props.method = String(extra.method).toUpperCase()
    if (extra.path) props.path = pathPattern(extra.path)
    if (Number.isFinite(extra.status)) props.status = extra.status
    if (Number.isFinite(extra.code)) props.code = extra.code
    const key = [kind, props.message, props.method || '', props.path || '', props.status || '', props.code || ''].join('|')
    remember(key, props)
    const s = seen.get(key)
    if (s) { s.total += 1; return }
    seen.set(key, { props, total: 1, sent: 1 })
    track('client_error', props)
  } catch (e) { /* reporting an error must not cause one */ }
}
function sendRepeats() {
  for (const s of seen.values()) if (s.total > s.sent) { track('client_error', { ...s.props, n: s.total - s.sent }); s.sent = s.total }
}
// Location: the permission answer is counted once per session per answer, and a failure is recorded by its code only.
const said = new Set()
export function locationPermission(state) { if (said.has(state)) return; said.add(state); track('location_permission', { state }) }
export function geoError(e, where) {
  const code = e && Number.isFinite(e.code) ? e.code : 0
  if (code === 1) locationPermission('denied')
  captureError('geo', code === 1 ? 'Location permission denied' : code === 2 ? 'Location unavailable' : code === 3 ? 'Location timed out' : 'Location error', { code, ...(where ? { screen: where } : {}) })
}

let installed = false
export function installErrorCapture() {
  if (installed || !win.addEventListener) return
  installed = true
  win.addEventListener('error', (e) => {
    // A failed image or script tag also fires "error", with no message. Those are not app errors.
    if (!e || (!e.message && !e.error)) return
    captureError('window', (e.error && e.error.message) || e.message)
  })
  win.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason
    // A failed API call is recorded where it happens (5xx and network only), so it is not counted again here.
    if (r && typeof r === 'object' && typeof r.status === 'number') return
    captureError('promise', (r && r.message) || String(r == null ? 'Unhandled rejection' : r))
  })
  const bye = () => { sendRepeats(); if (timer) { clearTimeout(timer); timer = null } flush() }
  win.addEventListener('pagehide', bye)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') bye() })
}
