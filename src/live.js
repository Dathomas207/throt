// Live walks: the small rules and words the screens share. No network code and no React here, so
// server/live.test.js can import it. The privacy rules themselves are kept by the server
// (server/routesLive.js); this file only decides what the app offers and says.

export const PING_MS = 15000 // how often a shared walk sends its newest position
export const POLL_MS = 20000 // how often Explore asks who is out
export const TODAY_POLL_MS = 60000 // the Today line asks less often
export const STALE_SECONDS = 90 // after this long without an update the pin turns grey

// Sharing is only ever offered for a real Live GPS walk on a signed-in account. Demo playback of a
// planned or sample route, timed sessions and the no-account demo can never share.
export const canShareLive = ({ account, live, timed } = {}) => !!account && !!live && !timed

export const SHARE_LABEL = 'Share this walk with friends'
export const shareHelp = (dog) => `Mutual friends can see where you and ${dog} are until you finish. Hidden near where you start.`
export const DEMO_SHARE_NOTE = 'Sharing a walk needs an account. This demo shows sample friends only.'
// The three lines under the setting.
export const SHARE_RULES = [
  'Only friends whose dog and yours follow each other can see you, and only while a Live GPS walk is running.',
  'Your position is hidden within 150 metres of where you start and of your usual start.',
  'Only your latest position is kept. It is deleted when you finish, or after 10 minutes without an update.',
]

const mins = (n) => `${n} min`
export const outFor = (f) => mins(Math.max(1, Math.round(Number(f.minutesOut) || 0)))
// "Last seen 3 min ago", or '' while the friend is still sending.
export const lastSeenText = (f) => (Number(f.lastSeenSeconds) > STALE_SECONDS ? `Last seen ${mins(Math.max(2, Math.round(f.lastSeenSeconds / 60)))} ago` : '')
export const isStale = (f) => Number(f.lastSeenSeconds) > STALE_SECONDS
export const headline = (f) => (f.with ? `${f.name} is out with ${f.with}` : `${f.name} is out`)
// One line for a list row: where, or just that they are out.
export const whereLine = (f) => (!f.position ? 'Out on a walk' : f.place ? `near ${f.place}` : 'On the map')
// The Today line. '' when nobody is out, so the screen stays quiet.
export function todayLine(list) {
  const n = (list || []).length
  if (!n) return ''
  const at = list.find((f) => f.position && f.place && !isStale(f))
  if (n === 1) return at ? `${at.name} is at ${at.place} now` : `${list[0].name} is out on a walk now`
  return at ? `${at.name} is at ${at.place} now, and ${n - 1} more ${n - 1 === 1 ? 'friend is' : 'friends are'} out` : `${n} friends are out now`
}

// ---- following a planned route on a real walk ----
export const OFF_ROUTE_M = 60 // further than this from the planned line reads as "Off the planned route"
// Distance in metres from a [lat, lng] point to the nearest part of a line of [lat, lng] points.
export function metresToLine(at, pts) {
  if (!at || !pts || !pts.length) return Infinity
  const k = Math.cos((at[0] * Math.PI) / 180), M = 111195
  const xy = (p) => [(p[1] - at[1]) * k * M, (p[0] - at[0]) * M]
  let best = Infinity, a = xy(pts[0])
  if (pts.length === 1) return Math.hypot(a[0], a[1])
  for (let i = 1; i < pts.length; i++) {
    const b = xy(pts[i]), dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len)) : 0
    const d = Math.hypot(a[0] + t * dx, a[1] + t * dy)
    if (d < best) best = d
    a = b
  }
  return best
}
// Plain words for why a walk has no GPS, and what the person can do instead.
export function noGpsText(reason) {
  if (reason === 'denied') return 'Location is turned off for Trot, so this walk cannot be tracked. Allow location for this site in your browser settings and try again, or record it without GPS.'
  if (reason === 'unsupported') return 'This browser cannot share a location, so this walk cannot be tracked. You can still record it without GPS.'
  if (reason === 'timeout') return 'No GPS fix arrived. Try again somewhere with a clearer view of the sky, or record this walk without GPS.'
  return 'Your location is unavailable right now, so this walk cannot be tracked. Try again, or record it without GPS.'
}
