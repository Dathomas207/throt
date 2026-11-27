// Pure editing functions for the route builder. No React and no network: the router is passed in,
// so every function here can be tested with a fake one.
//
// A model is { points, legs }. points are the control points in walking order ([lat, lng]); a loop
// repeats its first point as its last. legs[i] joins points[i] to points[i + 1]:
//   { mode: 'path' | 'straight', pts, miles, name, roads, kind, pending, approximate }
// A 'path' leg follows mapped paths from the router. A 'straight' leg is a straight line, for a lawn
// or a field with no mapped path. A pending leg is waiting for the router and holds a straight placeholder.
// An approximate leg is a 'path' leg the router could not answer for.
const EARTH = 3958.8, RAD = Math.PI / 180
export const MAX_POINTS = 25
export const HISTORY_STEPS = 40
export const SIMPLIFY_MAX = 12

const r5 = (v) => Math.round(v * 1e5) / 1e5
const pt = (p) => [r5(p[0]), r5(p[1])]
export function miles(a, b) {
  const dLat = (b[0] - a[0]) * RAD, dLng = (b[1] - a[1]) * RAD
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH * Math.asin(Math.sqrt(x))
}
export function lineMiles(pts) { let d = 0; for (let i = 1; i < (pts ? pts.length : 0); i++) d += miles(pts[i - 1], pts[i]); return d }
export const samePt = (a, b) => !!a && !!b && Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6

export const straightLeg = (a, b) => ({ mode: 'straight', pts: [pt(a), pt(b)], miles: miles(a, b), name: '' })
const pendingLeg = (a, b, mode = 'path') => (mode === 'straight' ? straightLeg(a, b) : { mode: 'path', pts: [pt(a), pt(b)], miles: miles(a, b), name: '', pending: true })
const failedLeg = (a, b) => ({ mode: 'path', pts: [pt(a), pt(b)], miles: miles(a, b), name: '', approximate: true })
const withLine = (leg, pts) => ({ ...leg, pts, miles: lineMiles(pts) })

export const emptyModel = () => ({ points: [], legs: [] })
export const isClosed = (m) => m.points.length > 2 && samePt(m.points[0], m.points[m.points.length - 1])
// Control points a person placed. The closing point of a loop is the start again, so it is not counted twice.
export const countPoints = (m) => m.points.length - (isClosed(m) ? 1 : 0)
export const canAdd = (m) => countPoints(m) < MAX_POINTS
export const totalMiles = (m) => m.legs.reduce((s, l) => s + l.miles, 0)
export const hasPending = (m) => m.legs.some((l) => l.pending)
export const approximateLegs = (m) => m.legs.filter((l) => l.approximate).length
// One line for the whole route, with the shared point between two legs kept once.
export function modelLine(m) {
  const out = []
  for (const l of m.legs) for (const p of l.pts) if (!out.length || !samePt(out[out.length - 1], p)) out.push(p)
  if (!out.length && m.points.length) out.push(m.points[0])
  return out
}
// What is stored with a saved route so it can be edited again: the control points and each leg's mode.
export const controlOf = (m) => ({ points: m.points.map(pt), modes: m.legs.map((l) => l.mode) })
// "Path" or "Unnamed road" when the router gave no name. The router's own word for the way decides, when it has one.
export const legLabel = (l) => (l.mode === 'straight' ? 'Straight line' : l.name || (l.kind === 'road' ? 'Unnamed road' : 'Path'))

// ---- geometry ---------------------------------------------------------------
// The closest point to p on the segment a-b, on a flat map of the small area around a.
function project(p, a, b) {
  const k = Math.cos(a[0] * RAD), bx = (b[1] - a[1]) * k, by = b[0] - a[0], px = (p[1] - a[1]) * k, py = p[0] - a[0]
  const len2 = bx * bx + by * by, t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0
  const at = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  return { t, at, d: miles(p, at) }
}
// { i, t, at, d }: segment index, position along it, the point itself and how far p is from it in miles.
export function nearestOnLine(pts, p, from = 0) {
  let best = null
  for (let i = Math.max(0, from); i < pts.length - 1; i++) { const r = project(p, pts[i], pts[i + 1]); if (!best || r.d < best.d) best = { i, ...r } }
  return best || { i: 0, t: 0, at: pts[0] || p, d: pts[0] ? miles(p, pts[0]) : 0 }
}
export function nearestOnRoute(m, p) {
  let best = null
  m.legs.forEach((l, leg) => { if (l.pts.length < 2) return; const r = nearestOnLine(l.pts, p); if (!best || r.d < best.d) best = { leg, ...r } })
  return best
}
// Cuts a line at a point on segment i. Both halves include the cut point.
export function splitLine(pts, i, at) {
  const c = pt(at), a = pts.slice(0, i + 1), b = pts.slice(i + 1)
  if (!samePt(a[a.length - 1], c)) a.push(c)
  if (!b.length || !samePt(b[0], c)) b.unshift(c)
  if (a.length < 2) a.push(c)
  if (b.length < 2) b.push(c)
  return [a, b]
}

// ---- edits ------------------------------------------------------------------
// Every edit returns a new model. Legs that need the router come back pending; resolveLegs fills them in.
// Legs the edit did not touch keep their geometry, so nothing else is asked for again.

// A new via point on leg `legIndex`, at the spot on the line nearest to `at`. The line is cut in two where
// it is, so nothing is requested. Returns { model, index } with the new point's index, or null at the cap.
export function insertVia(m, legIndex, at) {
  const leg = m.legs[legIndex]
  if (!leg || !canAdd(m)) return null
  const n = nearestOnLine(leg.pts, at), [a, b] = splitLine(leg.pts, n.i, n.at)
  const points = m.points.slice(), legs = m.legs.slice()
  points.splice(legIndex + 1, 0, pt(n.at))
  legs.splice(legIndex, 1, withLine(leg, a), withLine(leg, b))
  return { model: { points, legs }, index: legIndex + 1 }
}
// Moves point i. Only the legs on either side of it go back to the router.
export function movePoint(m, i, at) {
  if (i < 0 || i >= m.points.length) return m
  const P = pt(at), points = m.points.slice(), last = points.length - 1
  const moved = isClosed(m) && (i === 0 || i === last) ? [0, last] : [i]
  moved.forEach((k) => { points[k] = P })
  const legs = m.legs.map((l, k) => (moved.some((j) => k === j - 1 || k === j) ? pendingLeg(points[k], points[k + 1], l.mode) : l))
  return { points, legs }
}
// A tap away from the line: a new point at the end, or before the return leg of a loop.
export function appendPoint(m, at) {
  if (!canAdd(m)) return m
  const P = pt(at), n = m.points.length
  if (!n) return { points: [P], legs: [] }
  if (samePt(m.points[n - 1], P)) return m
  if (isClosed(m)) {
    const points = m.points.slice(), legs = m.legs.slice(), back = legs[legs.length - 1]
    points.splice(n - 1, 0, P)
    legs.splice(legs.length - 1, 1, pendingLeg(points[n - 2], P), pendingLeg(P, points[n], back.mode))
    return { points, legs }
  }
  return { points: [...m.points, P], legs: [...m.legs, pendingLeg(m.points[n - 1], P)] }
}
const tidy = (m) => (m.points.length === 2 && samePt(m.points[0], m.points[1]) ? { points: [m.points[0]], legs: [] } : m)
export function removePoint(m, i) {
  const n = m.points.length
  if (i < 0 || i >= n) return m
  if (n <= 1) return emptyModel()
  if (isClosed(m) && (i === 0 || i === n - 1)) {
    // The start of a loop goes: the next point becomes the start and the loop closes back to it.
    if (n <= 3) return { points: [m.points[1]], legs: [] }
    const points = m.points.slice(1, n - 1)
    points.push(points[0])
    return tidy({ points, legs: [...m.legs.slice(1, -1), pendingLeg(points[points.length - 2], points[0], m.legs[n - 2].mode)] })
  }
  if (i === 0) return tidy({ points: m.points.slice(1), legs: m.legs.slice(1) })
  if (i === n - 1) return tidy({ points: m.points.slice(0, -1), legs: m.legs.slice(0, -1) })
  const points = m.points.filter((_, k) => k !== i)
  const mode = m.legs[i - 1].mode === 'straight' && m.legs[i].mode === 'straight' ? 'straight' : 'path'
  return tidy({ points, legs: [...m.legs.slice(0, i - 1), pendingLeg(points[i - 1], points[i], mode), ...m.legs.slice(i + 1)] })
}
// Starts the route from point i, keeping the order the points are visited in. A loop only turns, so
// nothing is requested. An open route gains a leg from its old end to its old start and loses the leg into i.
export function makeStart(m, i) {
  const n = m.points.length
  if (i <= 0 || i >= n) return m
  if (isClosed(m)) {
    if (i === n - 1) return m
    return { points: [...m.points.slice(i, n - 1), ...m.points.slice(0, i), m.points[i]], legs: [...m.legs.slice(i), ...m.legs.slice(0, i)] }
  }
  return { points: [...m.points.slice(i), ...m.points.slice(0, i)], legs: [...m.legs.slice(i), pendingLeg(m.points[n - 1], m.points[0]), ...m.legs.slice(0, i - 1)] }
}
export function closeLoop(m) {
  const n = m.points.length
  if (n < 2 || isClosed(m) || !canAdd(m)) return m
  return { points: [...m.points, m.points[0]], legs: [...m.legs, pendingLeg(m.points[n - 1], m.points[0])] }
}
// The same line walked the other way. Nothing is requested.
export function reverse(m) {
  return { points: m.points.slice().reverse(), legs: m.legs.slice().reverse().map((l) => ({ ...l, pts: l.pts.slice().reverse(), ...(l.roads ? { roads: l.roads.slice().reverse() } : {}) })) }
}
export function setLegMode(m, i, mode) {
  const l = m.legs[i]
  if (!l || (mode !== 'path' && mode !== 'straight') || (l.mode === mode && !l.approximate)) return m
  return { points: m.points, legs: m.legs.map((x, k) => (k === i ? pendingLeg(m.points[i], m.points[i + 1], mode) : x)) }
}
// Asks again for the legs the router could not answer for.
export const retryApproximate = (m) => ({ points: m.points, legs: m.legs.map((l, i) => (l.approximate ? pendingLeg(m.points[i], m.points[i + 1], 'path') : l)) })

// Fills in the pending legs. router(a, b, { signal }) resolves to { pts, name, roads, kind } or rejects.
// A leg the router fails on becomes a straight line marked approximate. Resolves to the new model; never rejects.
export async function resolveLegs(m, router, opts = {}) {
  if (!hasPending(m)) return m
  const legs = await Promise.all(m.legs.map(async (l, i) => {
    if (!l.pending) return l
    const a = m.points[i], b = m.points[i + 1]
    try {
      const r = await router(a, b, opts)
      if (!r || !Array.isArray(r.pts) || r.pts.length < 2) return failedLeg(a, b)
      return { mode: 'path', pts: r.pts, miles: lineMiles(r.pts), name: r.name || '', ...(r.roads && r.roads.length ? { roads: r.roads } : {}), ...(r.kind ? { kind: r.kind } : {}) }
    } catch (e) { return failedLeg(a, b) }
  }))
  return { points: m.points, legs }
}

// ---- undo and redo ----------------------------------------------------------
export const makeHistory = (present = emptyModel(), limit = HISTORY_STEPS) => ({ past: [], present, future: [], limit })
export const commit = (h, next) => (next === h.present ? h : { ...h, past: [...h.past, h.present].slice(-h.limit), present: next, future: [] })
// The router's answer for the step just made. It replaces that step; it is not a step of its own.
export const replacePresent = (h, next) => ({ ...h, present: next })
export const canUndo = (h) => h.past.length > 0
export const canRedo = (h) => h.future.length > 0
export const undo = (h) => (canUndo(h) ? { ...h, past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future].slice(0, h.limit) } : h)
export const redo = (h) => (canRedo(h) ? { ...h, past: [...h.past, h.present].slice(-h.limit), present: h.future[0], future: h.future.slice(1) } : h)

// ---- from a stored line back to something editable ----------------------------
// Douglas-Peucker. Returns the indexes of the points kept, first and last always among them.
export function simplify(pts, tolMiles) {
  const n = pts.length
  if (n <= 2) return pts.map((_, i) => i)
  const keep = new Uint8Array(n), stack = [[0, n - 1]]
  keep[0] = keep[n - 1] = 1
  while (stack.length) {
    const [a, b] = stack.pop()
    let far = -1, max = tolMiles
    for (let i = a + 1; i < b; i++) { const d = project(pts[i], pts[a], pts[b]).d; if (d > max) { max = d; far = i } }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]) }
  }
  const out = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i)
  return out
}
// The finest simplification with at most `max` points.
export function simplifyTo(pts, max = SIMPLIFY_MAX) {
  if (pts.length <= max) return pts.map((_, i) => i)
  let lo = 0, hi = Math.max(lineMiles(pts), 1e-6), best = simplify(pts, hi)
  for (let k = 0; k < 28; k++) {
    const mid = (lo + hi) / 2, idx = simplify(pts, mid)
    if (idx.length <= max) { best = idx; hi = mid } else lo = mid
  }
  // A loop simplified all the way down would be its start twice. Keep the far side of it.
  if (best.length < 3 && samePt(pts[0], pts[pts.length - 1])) {
    let far = 1, d = 0
    for (let i = 1; i < pts.length - 1; i++) { const x = miles(pts[0], pts[i]); if (x > d) { d = x; far = i } }
    best = [0, far, pts.length - 1]
  }
  return best
}
// A recorded or saved line with no control points: a few are picked along it by simplification, and each
// leg keeps the stretch of the original line between two of them. Nothing is requested.
export function modelFromLine(line, max = SIMPLIFY_MAX) {
  const pts = (line || []).map(pt).filter((p, i, all) => i === 0 || !samePt(all[i - 1], p))
  if (pts.length < 2) return pts.length ? { points: [pts[0]], legs: [] } : emptyModel()
  const idx = simplifyTo(pts, max)
  return { points: idx.map((i) => pts[i]), legs: idx.slice(1).map((i, k) => ({ mode: 'path', pts: pts.slice(idx[k], i + 1), miles: lineMiles(pts.slice(idx[k], i + 1)), name: '' })) }
}
// A saved route with its control points: the stored line is cut at each of them in turn. Legs stored as
// straight are drawn straight. With no line, every path leg comes back pending.
const NEAR = 0.02 // miles: close enough to call it the place on the line
export function modelFromControl(control, line) {
  const points = ((control && control.points) || []).map(pt), modes = (control && control.modes) || []
  if (points.length < 2) return points.length ? { points, legs: [] } : emptyModel()
  const pts = (line || []).map(pt)
  if (pts.length < 2) return { points, legs: points.slice(1).map((p, i) => pendingLeg(points[i], p, modes[i] === 'straight' ? 'straight' : 'path')) }
  const legs = []
  let rest = pts
  for (let k = 1; k < points.length; k++) {
    let piece
    if (k === points.length - 1) piece = rest
    else {
      // The first place the line comes close to this point, so a line that passes it twice is cut at the right pass.
      let best = null
      for (let i = 0; i < rest.length - 1; i++) {
        const r = project(points[k], rest[i], rest[i + 1])
        if (!best || r.d < best.d) best = { i, ...r }
        else if (best.d < NEAR && r.d > best.d + NEAR * 1.5) break
      }
      const [a, b] = splitLine(rest, best.i, best.at)
      piece = a; rest = b
    }
    legs.push(modes[k - 1] === 'straight' ? straightLeg(points[k - 1], points[k]) : { mode: 'path', pts: piece.length > 1 ? piece : [points[k - 1], points[k]], miles: lineMiles(piece.length > 1 ? piece : [points[k - 1], points[k]]), name: '' })
  }
  return { points, legs }
}
