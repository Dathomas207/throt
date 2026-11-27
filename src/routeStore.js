// Saved routes for every screen that shows them: the route builder, Explore, Record, an outing's page and Today.
// Signed in, they live on the account (GET/POST/PATCH/DELETE /api/routes). In the demo and signed out they
// live in this browser's localStorage, under the same key the first route builder used.
// One copy is kept here and every screen is told when it changes.
import { useEffect, useState } from 'react'
import { api } from './api.js'
import { ROUTES } from './data.js'
import { loadSavedRoutes, cleanSaved, addSaved, storeSaved, thin, peekDemoRoute, pathMiles, walkMinutes } from './routing.js'
import { track } from './usage.js'

export const SAVE_POINTS = 2000 // the server's cap on one route's line
const MOVED_KEY = 'trot-routes-moved'
const ID_RE = /^[0-9a-f-]{36}$/
const EMPTY = { mode: null, loaded: false, routes: [], recents: [], error: '' }
let S = EMPTY, seq = 0
const subs = new Set()
const set = (p) => { S = { ...S, ...p }; subs.forEach((f) => f(S)) }
const modeOf = (account) => (account ? 'account' : 'local')

// Every screen sees one shape, wherever the route is kept:
// { id, name, kind, pts, miles, minutes, favorite, usualFor, dog, sourceWalkId, timesWalked, lastWalkedAt, control, full, local }
// usualFor is the dog (its address, or its name in the demo) this is the usual walk for, or ''.
// Lists from the account carry a thinned line and no control points until fullRoute() fetches the rest.
const fromServer = (r, full) => ({ id: r.id, name: r.name, kind: r.kind, pts: r.points, miles: r.miles, minutes: r.minutes, favorite: !!r.favorite, usualFor: r.usual && r.dog ? r.dog.slug : '', dog: r.dog || null, sourceWalkId: r.sourceWalkId || null, timesWalked: r.timesWalked || 0, lastWalkedAt: r.lastWalkedAt || null, control: full ? r.control || null : null, editable: !!r.editable, distance: r.distance, full: !!full, local: false })
const fromLocal = (r) => ({ ...r, usualFor: r.usualFor || '', dog: r.dog ? { slug: r.dog, name: r.dog } : null, sourceWalkId: r.sourceWalkId || null, lastWalkedAt: r.lastWalkedAt ? new Date(r.lastWalkedAt).toISOString() : null, editable: !!r.control, full: true, local: true })
const fromRecent = (r) => ({ id: r.id, kind: 'recent', walkId: r.walkId, name: r.name, pts: r.points, miles: r.miles, minutes: r.minutes, startedAt: r.startedAt, dog: r.dog, timesWalked: r.timesWalked, saved: r.saved || null, favorite: !!(r.saved && r.saved.favorite), full: false, local: false })
const isSavedId = (id) => ID_RE.test(String(id || ''))

export async function loadRoutes(account) {
  const mode = modeOf(account), n = ++seq
  if (S.mode !== mode) set({ ...EMPTY, mode })
  if (!account) { set({ loaded: true, routes: loadSavedRoutes().map(fromLocal), recents: [], error: '' }); return }
  try {
    const [a, r] = await Promise.all([api.get('/routes'), api.get('/routes?filter=recent')])
    if (n === seq) set({ loaded: true, routes: a.routes.map((x) => fromServer(x, false)), recents: r.routes.map(fromRecent), error: '' })
  } catch (e) { if (n === seq) set({ loaded: true, error: (e && e.message) || 'Saved routes could not be loaded.' }) }
}
// Forgets what is held and reads it again. Called when a different person signs in, so nobody sees the last person's routes.
export function resetRoutes(account) { seq++; S = { ...EMPTY }; subs.forEach((f) => f(S)); return loadRoutes(account) }
// { mode, loaded, routes, recents, error }. account is true on a signed-in person's own screens, false in the demo.
export function useRoutes(account) {
  const [s, setS] = useState(S)
  const mode = modeOf(account)
  useEffect(() => {
    subs.add(setS); setS(S)
    if (S.mode !== mode || !S.loaded) loadRoutes(account)
    return () => { subs.delete(setS) }
  }, [mode])
  return s.mode === mode ? s : { ...EMPTY, mode }
}
const isAccount = () => S.mode === 'account'
const put = (route) => set({ routes: [route, ...S.routes.filter((x) => x.id !== route.id).map((x) => (route.usualFor && x.usualFor === route.usualFor ? { ...x, usualFor: '' } : x))] })
const fail = (e) => ({ error: (e && e.message) || 'That did not save. Try again.' })
const refreshRecents = () => { const n = seq; api.get('/routes?filter=recent').then((r) => { if (n === seq && isAccount()) set({ recents: r.routes.map(fromRecent) }) }, () => {}) }
const writeLocal = (list) => { const clean = cleanSaved(list), ok = storeSaved(clean); set({ routes: clean.map(fromLocal) }); return ok }
const NO_ROOM = 'This browser would not store the route.'

// Each action resolves to { route } or { error }, and never rejects.
export const routeActions = {
  // input: { name, pts, control, favorite, kind, dog, sourceWalkId, approximate, trail }
  async save(input) {
    const pts = thin(input.pts, SAVE_POINTS)
    if (isAccount()) {
      try {
        const r = await api.post('/routes', { name: input.name || '', points: pts, ...(input.control ? { control: input.control } : {}), favorite: !!input.favorite, kind: input.kind === 'walked' ? 'walked' : 'built', ...(input.dog ? { dog: input.dog } : {}) })
        const route = fromServer(r.route, true)
        put(route); track('route_saved', { kind: route.kind }); if (route.favorite) track('route_favorited')
        return { route }
      } catch (e) { return fail(e) }
    }
    const list = addSaved(loadSavedRoutes(), { ...input, pts, dog: input.dog || '', lastWalkedAt: input.lastWalkedAt || 0 }, input.name)
    if (!writeLocal(list)) return { error: NO_ROOM }
    return { route: fromLocal(list[0]) }
  },
  // patch: { name, favorite, usual, dog, pts, control }. usual needs dog: the dog it is the usual walk for.
  async update(id, patch) {
    if (isAccount()) {
      try {
        const body = { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.favorite !== undefined ? { favorite: !!patch.favorite } : {}), ...(patch.usual !== undefined ? { usual: !!patch.usual, ...(patch.usual ? { dog: patch.dog } : {}) } : {}), ...(patch.pts ? { points: thin(patch.pts, SAVE_POINTS), control: patch.control || null } : {}) }
        const r = await api.patch(`/routes/${id}`, body)
        const route = fromServer(r.route, true)
        put(route); if (patch.favorite === true) track('route_favorited'); if (patch.favorite !== undefined) refreshRecents()
        return { route }
      } catch (e) { return fail(e) }
    }
    let out = null
    const list = loadSavedRoutes().map((x) => {
      if (x.id !== id) return patch.usual && x.usualFor === patch.dog ? { ...x, usualFor: '' } : x
      const next = { ...x, ...(patch.name !== undefined ? { name: String(patch.name).trim().slice(0, 60) || x.name } : {}), ...(patch.favorite !== undefined ? { favorite: !!patch.favorite } : {}) }
      if (patch.pts) { next.pts = thin(patch.pts, SAVE_POINTS); next.miles = Math.round(pathMiles(next.pts) * 100) / 100; next.minutes = walkMinutes(next.miles); next.control = patch.control || null; next.waypoints = patch.control ? patch.control.points : [next.pts[0], next.pts[next.pts.length - 1]] }
      if (patch.usual !== undefined) { next.usualFor = patch.usual ? String(patch.dog || '') : ''; if (patch.usual) next.favorite = true }
      if (!next.favorite) next.usualFor = ''
      out = next
      return next
    })
    if (!out) return { error: 'That route is no longer saved here.' }
    if (!writeLocal(list)) return { error: NO_ROOM }
    return { route: fromLocal(cleanSaved([out])[0]) }
  },
  async remove(id) {
    if (isAccount()) {
      try { await api.del(`/routes/${id}`) } catch (e) { if (e.status !== 404) return fail(e) }
      set({ routes: S.routes.filter((x) => x.id !== id) }); refreshRecents()
      return { ok: true }
    }
    return writeLocal(loadSavedRoutes().filter((x) => x.id !== id)) ? { ok: true } : { error: 'This browser would not update saved routes.' }
  },
  // Keeps the line of an outing. Signed in, the server reads the line from the outing itself. In the demo it comes from `walk.pts`.
  async saveWalk(walk, { favorite = false } = {}) {
    if (isAccount()) {
      try {
        const r = await api.post(`/walks/${walk.id}/route`, { favorite: !!favorite })
        const route = fromServer(r.route, true)
        put(route); refreshRecents()
        if (!r.already) track('route_saved', { kind: 'walked' }); if (favorite) track('route_favorited')
        return { route }
      } catch (e) { return fail(e) }
    }
    const had = loadSavedRoutes().find((x) => x.sourceWalkId === String(walk.id))
    if (had) return favorite && !had.favorite ? routeActions.update(had.id, { favorite: true }) : { route: fromLocal(had) }
    if (!walk.pts || walk.pts.length < 2) return { error: 'This outing has no route to save.' }
    return routeActions.save({ name: walk.name, pts: walk.pts, kind: 'walked', favorite, dog: walk.dog || '', sourceWalkId: String(walk.id), timesWalked: 1, lastWalkedAt: Date.now() })
  },
  // The whole line and the control points of a route from a list. A recent route's line is read from its outing.
  async full(r) {
    if (!r || r.full || !isAccount()) return { route: r }
    try {
      if (r.kind === 'recent') { const w = await api.get(`/walks/${r.walkId}`); return { route: { ...r, pts: w.walk.route && w.walk.route.length > 1 ? w.walk.route : r.pts, full: true } } }
      const x = await api.get(`/routes/${r.id}`)
      return { route: fromServer(x.route, true) }
    } catch (e) { return fail(e) }
  },
  // After an outing that followed a saved route. The account counts it on the server, so this only reads the new count.
  walked(id) {
    if (isAccount()) { loadRoutes(true); return }
    if (!id) return
    writeLocal(loadSavedRoutes().map((x) => (x.id === id ? { ...x, timesWalked: (x.timesWalked || 0) + 1, lastWalkedAt: Date.now() } : x)))
  },
  reload: () => loadRoutes(isAccount()),
}
// The id to send with a new outing so the server links it to a saved route. Local routes have no server id.
export const linkId = (id) => (isSavedId(id) ? id : null)

// Routes saved on this device before signing in are copied to the account once per person. The server
// matches each one by the id it had here, so a repeat makes no second copy. Resolves to how many were added.
export async function migrateLocalRoutes(userId) {
  let done = {}
  try { done = JSON.parse(localStorage.getItem(MOVED_KEY)) || {} } catch (e) {}
  if (!userId || done[userId]) return 0
  let n = 0
  for (const r of loadSavedRoutes()) {
    try {
      const x = await api.post('/routes', { clientId: r.id, name: r.name, points: thin(r.pts, SAVE_POINTS), ...(r.control ? { control: r.control } : {}), favorite: !!r.favorite, kind: r.kind })
      if (!x.already) n++
    } catch (e) {
      // The server could not be reached or is busy: stop and try again on the next sign-in. A route it refuses is skipped.
      if (!e.status || e.status >= 500 || e.status === 429 || e.status === 401) return n
    }
  }
  try { localStorage.setItem(MOVED_KEY, JSON.stringify({ ...done, [userId]: Date.now() })) } catch (e) {}
  if (n) loadRoutes(true)
  return n
}

// What the builder should do when it opens: { from: tab to go back to, center, open: route, source, edit, tab }.
let intent = null
export const setBuilderIntent = (x) => { intent = x || null }
export const takeBuilderIntent = () => { const x = intent; intent = null; return x }

// ---- the demo's sample routes -------------------------------------------------
// Around Freedom Park, Eastover Park, Latta Park and the Little Sugar Creek Greenway. They are shown, never stored.
const sampleOf = (k) => { const r = ROUTES[k], v = peekDemoRoute(k) || r; return { key: k, name: r.name, pts: v.pts, miles: v.miles, minutes: v.minutes, approximate: !!v.approximate } }
export function demoFavorites(dogName) {
  return ['pond', 'danehy'].filter((k) => ROUTES[k]).map((k, i) => ({ ...sampleOf(k), id: 'demo:' + k, kind: 'built', favorite: true, usualFor: i === 0 ? dogName : '', dog: { slug: dogName, name: dogName }, timesWalked: i === 0 ? 14 : 6, lastWalkedAt: null, control: null, full: true, local: true, sample: true }))
}
// The demo dog's outings that have a line, newest first, one row per route.
export function demoRecents(acts) {
  const out = []
  for (const a of acts || []) {
    const key = typeof a.route === 'string' && ROUTES[a.route] ? a.route : null
    const pts = key ? sampleOf(key).pts : Array.isArray(a.pts) && a.pts.length > 1 ? a.pts : null
    if (!pts || a.type === 'Daycare') continue
    const had = key && out.find((x) => x.key === key)
    if (had) { had.timesWalked++; continue }
    out.push({ id: 'walk:' + a.id, kind: 'recent', walkId: a.id, key, name: a.title, pts, miles: key ? sampleOf(key).miles : Math.round(pathMiles(pts) * 100) / 100, minutes: Math.max(1, Math.round(a.minutes) || walkMinutes(pathMiles(pts))), daysAgo: a.daysAgo, dog: { slug: a.dog, name: a.dog }, timesWalked: 1, saved: null, favorite: false, full: true, local: true, sample: !!key })
    if (out.length >= 10) break
  }
  return out
}
// The usual walk for a dog: the person's own choice, or in the demo the sample one until they choose.
export function usualFor(routes, dog, demoName) {
  return routes.find((r) => r.usualFor && r.usualFor === dog) || (demoName ? demoFavorites(demoName).find((r) => r.usualFor) : null) || null
}
