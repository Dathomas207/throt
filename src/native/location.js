// Location for recording a walk.
//
// On the website this is navigator.geolocation.watchPosition and nothing else.
// Inside the iPhone app it uses @capacitor-community/background-geolocation, so the
// route keeps being drawn while the phone is locked or Trot is in the background.
//
// Two ways to call it:
//
//   import { startWatch } from './native/location.js'
//   const stop = startWatch({
//     onFix: ({ lat, lng, accuracy, time, speed, heading, altitude }) => { ... },
//     onError: ({ code, message }) => { ... },   // code: 'denied' | 'unavailable' | 'timeout' | 'unsupported'
//   })
//   stop()
//
// or as a drop-in for the browser API (same callbacks, same shapes as GeolocationPosition
// and GeolocationPositionError), which is what the walk screen uses today:
//
//   import { watchPosition, clearWatch } from './native/location.js'
//   const id = watchPosition(onFix, onErr, { enableHighAccuracy: true, maximumAge: 2000 })
//   clearWatch(id)
//
// Permission on the iPhone: the first watch asks for "While Using the App". Trot never
// asks for "Always". iOS keeps delivering fixes in the background to an app that started
// them while it was open, has the location background mode, and shows the blue location
// indicator, which is what happens here. Pass { always: true } only if a later feature
// truly needs location when no walk is being recorded.
import { isNative } from './platform.js'

// Shown by Android in its ongoing notification. iOS shows its own blue indicator instead.
const BACKGROUND_TITLE = 'Trot is recording a walk'
const BACKGROUND_MESSAGE = 'Your route is being saved. Open Trot to finish the walk.'

let pluginPromise = null
// Tests hand in a stand-in for the native plugin.
export function _setPlugin(p) { pluginPromise = p ? Promise.resolve(p) : null }
function plugin() {
  if (!pluginPromise) pluginPromise = import('@capacitor/core').then(({ registerPlugin }) => registerPlugin('BackgroundGeolocation'))
  return pluginPromise
}

const fromPlugin = (l) => ({ lat: l.latitude, lng: l.longitude, accuracy: l.accuracy, time: l.time || Date.now(), speed: l.speed == null ? null : l.speed, heading: l.bearing == null ? null : l.bearing, altitude: l.altitude == null ? null : l.altitude })
const fromBrowser = (p) => ({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, time: p.timestamp || Date.now(), speed: p.coords.speed == null ? null : p.coords.speed, heading: p.coords.heading == null || Number.isNaN(p.coords.heading) ? null : p.coords.heading, altitude: p.coords.altitude == null ? null : p.coords.altitude })
const BROWSER_CODES = { 1: 'denied', 2: 'unavailable', 3: 'timeout' }

function startNative({ onFix, onError, distanceFilter = 0, always = false }) {
  let stopped = false
  const ids = new Set()
  let lastTime = 0, background = false
  const remove = (p, id) => { ids.delete(id); p.removeWatcher({ id }).catch(() => {}) }
  const fail = (err) => {
    if (stopped) return
    const denied = err && err.code === 'NOT_AUTHORIZED'
    if (onError) onError({ code: denied ? 'denied' : 'unavailable', message: denied ? 'Location is turned off for Trot. Turn it on in Settings to record a route.' : (err && err.message) || 'No location yet.' })
  }
  const add = (p, options, after) => p.addWatcher(options, (loc, err) => {
    if (stopped) return
    if (err) return fail(err)
    if (!loc) return
    const fix = fromPlugin(loc)
    // Two watchers overlap for a moment during the hand-over below. Each fix is passed on once.
    if (fix.time > lastTime) { lastTime = fix.time; onFix(fix) }
    if (after) after()
  }).then((id) => { if (stopped) p.removeWatcher({ id }).catch(() => {}); else ids.add(id); return id })

  plugin().then(async (p) => {
    if (stopped) return
    const base = { stale: false, distanceFilter }
    if (always) {
      // Asks for "Always". Not used by the walk screen.
      await add(p, { ...base, requestPermissions: true, backgroundTitle: BACKGROUND_TITLE, backgroundMessage: BACKGROUND_MESSAGE })
      return
    }
    // Step 1: a foreground watcher. This is the one that asks for "While Using the App".
    let firstId = null
    const handOver = () => {
      if (background || stopped) return
      background = true
      // Step 2, once the first fix proves permission was given: a watcher that is allowed to run in
      // the background, added without asking for anything more. Then the first watcher is dropped.
      add(p, { ...base, requestPermissions: false, backgroundTitle: BACKGROUND_TITLE, backgroundMessage: BACKGROUND_MESSAGE })
        .then(() => { if (firstId) remove(p, firstId) })
        .catch(() => { background = false })
    }
    firstId = await add(p, { ...base, requestPermissions: true }, handOver)
  }).catch((e) => { if (!stopped && onError) onError({ code: 'unsupported', message: (e && e.message) || 'Location is not available.' }) })

  return () => {
    if (stopped) return
    stopped = true
    plugin().then((p) => { for (const id of [...ids]) remove(p, id) }).catch(() => {})
  }
}

function startBrowser({ onFix, onError, enableHighAccuracy = true, maximumAge = 2000, timeout }) {
  const geo = typeof navigator !== 'undefined' && navigator.geolocation
  if (!geo) { if (onError) onError({ code: 'unsupported', message: 'This browser cannot share a location.' }); return () => {} }
  const options = { enableHighAccuracy, maximumAge }
  if (timeout !== undefined) options.timeout = timeout
  const id = geo.watchPosition((p) => onFix(fromBrowser(p)), (e) => { if (onError) onError({ code: BROWSER_CODES[e && e.code] || 'unavailable', message: (e && e.message) || '' }) }, options)
  return () => { try { geo.clearWatch(id) } catch (e) { /* already gone */ } }
}

// Start watching. Returns a function that stops it. Safe to call the stop function twice.
// The second argument exists for the tests, which run the iPhone path against a stand-in plugin.
export function startWatch(options, { native = isNative } = {}) {
  if (!options || typeof options.onFix !== 'function') throw new TypeError('startWatch needs an onFix callback.')
  return native ? startNative(options) : startBrowser(options)
}

// Opens the iPhone Settings page for Trot, for the "location is off" message. Does nothing on the website.
export async function openLocationSettings() {
  if (!isNative) return false
  try { await (await plugin()).openSettings(); return true } catch (e) { return false }
}

// ---- drop-in for navigator.geolocation.watchPosition ----------------------------
// On the website these two hand straight through to the browser, so nothing changes there.
const NATIVE_CODES = { denied: 1, unavailable: 2, timeout: 3, unsupported: 2 }
const stops = new Map()
let nextId = 1
export function watchPosition(onFix, onErr, options) {
  if (!isNative) return navigator.geolocation.watchPosition(onFix, onErr, options)
  const id = 'native-' + nextId++
  stops.set(id, startNative({
    onFix: (f) => onFix({ coords: { latitude: f.lat, longitude: f.lng, accuracy: f.accuracy, altitude: f.altitude, altitudeAccuracy: null, heading: f.heading, speed: f.speed }, timestamp: f.time }),
    onError: (e) => { if (onErr) onErr({ code: NATIVE_CODES[e.code] || 2, message: e.message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) },
  }))
  return id
}
export function clearWatch(id) {
  if (stops.has(id)) { const stop = stops.get(id); stops.delete(id); stop(); return }
  try { navigator.geolocation.clearWatch(id) } catch (e) { /* nothing to clear */ }
}
