// The numbers behind the lesson demonstrations: the dog's poses, and how a beat from animScripts.js
// becomes a flat set of values that two beats can blend between. Pure, with no JSX, so
// server/training-extras.test.js can check every script against it. cast.jsx draws from these values.

export const W = 320, H = 190, GROUND = 168

// Each pose: body, neck, head and tail as [x, y, rotation], legs as [x, y, upper angle, lower angle].
// Front near (fn) and far (ff), hind near (hn) and far (hf). y is up from the ground, so negative.
export const POSES = {
  stand: { b: [0, -50, 0], n: [26, -56, 22], h: [40, -76, 0], t: [-34, -56, 0], fn: [22, -43, 0, 0], ff: [28, -43, 4, -2], hn: [-24, -44, -12, 14], hf: [-18, -44, -6, 10] },
  sit: { b: [-6, -38, -34], n: [20, -60, 6], h: [28, -88, -4], t: [-38, -10, -84], fn: [16, -42, -2, 2], ff: [22, -42, 0, 2], hn: [-22, -24, -82, 86], hf: [-16, -24, -78, 84] },
  down: { b: [-4, -18, 0], n: [26, -24, 34], h: [42, -42, 0], t: [-38, -14, -84], fn: [22, -20, -32, -58], ff: [28, -20, -28, -62], hn: [-22, -20, -86, 84], hf: [-16, -20, -80, 82] },
  rest: { b: [-4, -17, 0], n: [28, -20, 62], h: [48, -24, 14], t: [-38, -12, -86], fn: [22, -18, -34, -56], ff: [28, -18, -30, -60], hn: [-22, -18, -86, 84], hf: [-16, -18, -80, 82] },
  sniff: { b: [0, -50, 6], n: [30, -46, 70], h: [52, -48, 38], t: [-34, -58, -8], fn: [22, -43, 4, -4], ff: [28, -43, 8, -6], hn: [-24, -46, -12, 14], hf: [-18, -46, -6, 10] },
  lookUp: { b: [-6, -38, -34], n: [20, -60, -4], h: [24, -90, -30], t: [-38, -10, -84], fn: [16, -42, -2, 2], ff: [22, -42, 0, 2], hn: [-22, -24, -82, 86], hf: [-16, -24, -78, 84] },
  lookStand: { b: [0, -50, 0], n: [26, -58, 8], h: [36, -80, -28], t: [-34, -58, -14], fn: [22, -43, 0, 0], ff: [28, -43, 4, -2], hn: [-24, -44, -12, 14], hf: [-18, -44, -6, 10] },
  pawUp: { b: [-6, -38, -34], n: [20, -60, 6], h: [28, -88, -4], t: [-38, -10, -84], fn: [16, -44, -78, -12], ff: [22, -42, 0, 2], hn: [-22, -24, -82, 86], hf: [-16, -24, -78, 84] },
  bow: { b: [0, -38, 22], n: [28, -30, 58], h: [48, -34, 6], t: [-32, -60, 30], fn: [22, -22, -36, -54], ff: [28, -22, -30, -60], hn: [-26, -46, -8, 10], hf: [-20, -46, -4, 8] },
  side: { b: [0, -16, 0], n: [26, -20, 70], h: [48, -22, 16], t: [-38, -12, -84], fn: [20, -8, -150, 30], ff: [28, -6, -130, 20], hn: [-20, -8, -160, 40], hf: [-12, -6, -140, 30] },
  run: { b: [0, -52, -4], n: [28, -58, 30], h: [44, -76, 8], t: [-36, -60, -30], fn: [22, -45, -20, -10], ff: [28, -45, 22, 10], hn: [-24, -46, -24, 30], hf: [-18, -46, 20, -6] },
}
export const WALKS = { stand: 1, lookStand: 1, run: 1.5, sniff: 0.6 }
const PARTS = ['b', 'n', 'h', 't'], LEGS = ['fn', 'ff', 'hn', 'hf']

// Where the nose is, in the dog's own frame, for placing a hand at it.
export function noseOf(pose, headOver) {
  const h = (headOver || POSES[pose].h)
  const a = (h[2] * Math.PI) / 180
  return [h[0] + 26 * Math.cos(a), h[1] + 26 * Math.sin(a)]
}
export const toScene = (d, p) => {
  // Rolls turn about the middle of the body, 22 above the ground.
  const r = ((d.r || 0) * Math.PI) / 180, sx = p[0] * (d.f || 1) * (d.sc || 1), sy = p[1] * (d.sc || 1) + 22
  return [d.x + sx * Math.cos(r) - sy * Math.sin(r), GROUND + (d.y || 0) - 22 + sx * Math.sin(r) + sy * Math.cos(r)]
}

// ---- one beat to a flat set of numbers plus the things that only switch ------------------------------
// A beat (see animScripts.js) says what is on stage. Values are copied into a flat object keyed by name
// so two beats blend by plain arithmetic.
export function flatten(beat) {
  const v = {}, k = {}
  const dog = (pre, d) => {
    const P = POSES[d.p] || POSES.stand
    v[pre + 'x'] = d.x; v[pre + 'y'] = d.y || 0; v[pre + 'r'] = d.r || 0; v[pre + 'f'] = d.f || 1; v[pre + 'sc'] = d.sc || 1; v[pre + 'o'] = 1
    v[pre + 'hf'] = d.look === 'back' ? -1 : 1
    for (const part of PARTS) { const val = part === 'h' && d.head ? d.head : P[part]; val.forEach((n, i) => { v[`${pre}${part}${i}`] = n }) }
    for (const leg of LEGS) { const val = (d.legs && d.legs[leg]) || P[leg]; val.forEach((n, i) => { v[`${pre}${leg}${i}`] = n }) }
    k[pre + 'p'] = d.p || 'stand'; k[pre + 'carry'] = d.carry || null; k[pre + 'harness'] = !!d.harness
  }
  dog('d_', beat.dog)
  if (beat.dog2) dog('e_', { sc: 0.72, ...beat.dog2 }); else v.e_o = 0
  const person = beat.person === false ? null : { x: 262, ...(beat.person || {}) }
  v.px = person ? person.x : 340; v.py = person ? person.y || 0 : 0; v.po = person ? 1 : 0; v.pf = person && person.f === -1 ? -1 : 1
  k.seat = !!(person && person.seat)
  const helper = beat.helper || null
  v.qx = helper ? helper.x : -40; v.qo = helper ? 1 : 0
  // The hand: in scene numbers, or `at: 'nose'` with an offset from the dog's nose.
  const hand = beat.hand || null
  if (hand) {
    let hx = hand.x, hy = hand.y
    if (hand.at === 'nose' || hand.at === 'chest' || hand.at === 'floor') {
      const d = beat.dog, n = noseOf(d.p || 'stand', d.head)
      const base = hand.at === 'nose' ? n : hand.at === 'chest' ? [n[0] - 8, n[1] + 30] : [n[0] - 4, -6]
      ;[hx, hy] = toScene({ ...d }, [base[0] + (hand.dx || 0) * (d.f || 1), base[1] + (hand.dy || 0)])
    }
    v.hx = hx; v.hy = hy; v.ho = 1
  } else { v.hx = v.px - 18; v.hy = 96; v.ho = 0 }
  k.hand = hand ? hand.k || 'fist' : null
  const h2 = beat.hand2 || null
  v.gx2 = h2 ? h2.x : v.qx + 20; v.gy2 = h2 ? h2.y : 100; v.go2 = h2 ? 1 : 0; k.hand2 = h2 ? h2.k || 'fist' : null
  // The ground slides by for walking beats, so the cast can walk in place.
  v.gx = beat.gx || 0
  const props = beat.props || {}
  for (const name of PROP_NAMES) {
    const p = props[name]
    v['o_' + name] = p === undefined || p === false || p === null ? 0 : 1
    const n = typeof p === 'number' ? p : p && typeof p === 'object' ? p.x : undefined
    v['x_' + name] = n === undefined ? DEFAULT_X[name] : n
    if (p && typeof p === 'object' && 'y' in p) v['y_' + name] = p.y; else v['y_' + name] = 0
    if (p && typeof p === 'object' && 'v' in p) v['v_' + name] = p.v; else v['v_' + name] = 0
  }
  k.leash = beat.leash || null
  k.say = beat.say || null; k.yes = !!beat.yes; k.treat = beat.treat || null; k.path = beat.path || null
  k.bg = beat.bg || 'in'; k.walk = !!beat.walk
  return { v, k }
}
export const PROP_NAMES = ['door', 'mat', 'car', 'stairs', 'elevator', 'post', 'tree', 'water', 'ball', 'toy', 'box', 'squirrel', 'table', 'fence', 'bike', 'bowl', 'chew', 'floorTreat']
const DEFAULT_X = { door: 250, mat: 150, car: 238, stairs: 120, elevator: 232, post: 262, tree: 52, water: 236, ball: 120, toy: 170, box: 214, squirrel: 292, table: 282, fence: 0, bike: 296, bowl: 220, chew: 200, floorTreat: 200 }

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
// Blend two flat beats. `t` runs 0 to 1.
export function blend(a, b, t) {
  const e = ease(Math.max(0, Math.min(1, t))), v = {}
  for (const key in b.v) { const x = a.v[key], y = b.v[key]; v[key] = typeof x === 'number' && typeof y === 'number' ? x + (y - x) * e : y }
  // Things that switch do so partway through, so a marker pops as the move lands.
  return { v, k: t >= 0.55 ? b.k : { ...a.k, bg: b.k.bg }, t, moving: t < 1, from: a }
}

export const P3 = (v, pre, part) => [v[`${pre}${part}0`], v[`${pre}${part}1`], v[`${pre}${part}2`]]
export const P4 = (v, pre, leg) => [v[`${pre}${leg}0`], v[`${pre}${leg}1`], v[`${pre}${leg}2`], v[`${pre}${leg}3`]]
