// Performance statistics for a recorded outing: moving time, average and top speed, sprints and run time.
// Everything here is a pure function of a timestamped track, so it can be tested without a phone.
// Speeds are in mph. They describe the phone that was carried, which is the pair's speed, not the dog's own.
import { haversine } from './data.js'

export const MOVING_MPH = 0.6 // slower than this counts as standing still
export const RUN_MPH = 4.5 // faster than this counts as running
export const SPRINT_MPH = 6 // a sprint holds at least this, smoothed
export const SPRINT_MIN_SEC = 4 // for at least this long
export const SPRINT_GAP_SEC = 10 // and starts at least this long after the last counted sprint ended
export const SPIKE_MPH = 25 // an implied speed above this is a GPS jump, not movement
export const MAX_ACCURACY_M = 40 // fixes less certain than this are ignored
export const SMOOTH_SEC = 5 // speeds are averaged over about this much track
const GAP_SEC = 30 // longer than this between fixes is a pause or a lost signal, not movement
export const round1 = (v) => Math.round((Number(v) || 0) * 10) / 10

// Fixes [{ t: ms, at: [lat, lng], acc: metres, gap: true after a pause }] -> samples [{ t: seconds, d: miles so far, gap }]
// Fixes with poor accuracy and fixes that imply an impossible speed are dropped.
export function cleanTrack(fixes) {
  const out = []
  let last = null, d = 0, gap = false
  for (const f of fixes || []) {
    if (!f || !Array.isArray(f.at) || !Number.isFinite(f.t)) continue
    if (f.gap) gap = true
    if (f.acc != null && !(f.acc <= MAX_ACCURACY_M)) continue
    if (last) {
      const dt = (f.t - last.t) / 1000
      if (dt <= 0) continue
      const step = haversine(last.at, f.at)
      if (!gap && (step / dt) * 3600 > SPIKE_MPH) continue
      if (!gap) d += step
    }
    out.push({ t: f.t / 1000, d, gap: gap && !!last })
    last = f; gap = false
  }
  return out
}
// Samples [{ t: seconds, d: cumulative miles, gap }] -> { movingSec, avgSpeed, maxSpeed, sprints, runSec, current }
// current is the smoothed speed at the last sample.
export function speedStats(samples) {
  const s = samples || []
  let movingSec = 0, movingMiles = 0, maxSpeed = 0, runSec = 0, sprints = 0, current = 0
  let burstStart = null, burstCounted = false, lastSprintEnd = -Infinity
  const endBurst = (t) => { if (burstCounted) lastSprintEnd = t; burstStart = null; burstCounted = false }
  let from = 0 // first sample of the current unbroken stretch
  for (let i = 1; i < s.length; i++) {
    const dt = s[i].t - s[i - 1].t, step = s[i].d - s[i - 1].d
    if (s[i].gap || dt > GAP_SEC || dt <= 0) { endBurst(s[i - 1].t); from = i; current = 0; continue }
    const mph = (step / dt) * 3600
    if (mph > MOVING_MPH) { movingSec += dt; movingMiles += step }
    // Smoothed speed: distance over roughly the last SMOOTH_SEC of this stretch.
    let j = i - 1
    while (j > from && s[i].t - s[j].t < SMOOTH_SEC) j--
    const smooth = ((s[i].d - s[j].d) / (s[i].t - s[j].t)) * 3600
    current = smooth
    if (smooth > maxSpeed) maxSpeed = smooth
    if (smooth > RUN_MPH) runSec += dt
    if (smooth >= SPRINT_MPH) {
      if (burstStart == null) burstStart = s[i - 1].t
      if (!burstCounted && s[i].t - burstStart >= SPRINT_MIN_SEC && burstStart - lastSprintEnd >= SPRINT_GAP_SEC) { sprints++; burstCounted = true }
    } else if (burstStart != null) endBurst(s[i - 1].t)
  }
  return { movingSec, avgSpeed: movingSec > 0 ? (movingMiles / movingSec) * 3600 : 0, maxSpeed, sprints, runSec, current }
}
export const trackStats = (fixes) => speedStats(cleanTrack(fixes))

// Demo playback has no real timing, so a believable one is made from the route length alone:
// a steady walk with a few faster stretches at fixed fractions of the way. Same route, same numbers, every time.
export const DEMO_BASE_MPH = 3
export const DEMO_BURSTS = [{ from: 0.18, to: 0.2, mph: 7.5 }, { from: 0.46, to: 0.47, mph: 5.2 }, { from: 0.62, to: 0.645, mph: 8.2 }, { from: 0.88, to: 0.9, mph: 7 }]
export function demoSpeedAt(frac) { const b = DEMO_BURSTS.find((x) => frac >= x.from && frac < x.to); return b ? b.mph : DEMO_BASE_MPH + 0.35 * Math.sin(frac * 40) }
// One sample a second from start to finish: [{ t, d }] with the last d exactly `miles`.
export function demoSamples(miles) {
  const out = [{ t: 0, d: 0 }]
  if (!(miles > 0)) return out
  let d = 0, t = 0
  while (d < miles && t < 86400) { t++; d = Math.min(miles, d + demoSpeedAt(d / miles) / 3600); out.push({ t, d }) }
  return out
}
// Miles covered at time t (seconds) along samples, interpolated.
export function distAt(samples, t) {
  const s = samples || []
  if (!s.length || t <= s[0].t) return s.length ? s[0].d : 0
  const last = s[s.length - 1]
  if (t >= last.t) return last.d
  let lo = 0, hi = s.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid].t <= t) lo = mid; else hi = mid }
  const a = s[lo], b = s[hi]
  return a.d + ((b.d - a.d) * (t - a.t)) / (b.t - a.t)
}
// The samples up to time t, ending on an interpolated one, for statistics part of the way through playback.
export function samplesUpTo(samples, t) {
  const s = samples || []
  let n = 0
  while (n < s.length && s[n].t <= t) n++
  const out = s.slice(0, n)
  if (n > 0 && n < s.length && t > s[n - 1].t) out.push({ t, d: distAt(s, t) })
  return out
}
// The saved-activity fields for a set of statistics. Speeds in mph to one decimal.
export function activityStats(st, totalMinutes) {
  return { avgSpeed: round1(st.avgSpeed), maxSpeed: round1(st.maxSpeed), sprints: st.sprints || 0, movingMinutes: Math.min(totalMinutes, st.movingSec / 60), runMinutes: st.runSec / 60 }
}
const PART = (h) => (h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night')
// "Evening run", "Afternoon play time at Fresh Pond"
export function defaultTitle(label, place, hour = new Date().getHours()) { return `${PART(hour)} ${String(label || 'walk').toLowerCase()}${place ? ' at ' + place : ''}` }
