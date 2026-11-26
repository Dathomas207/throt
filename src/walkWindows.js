// Turns an hourly forecast into "when is a good time to walk the dog".
// Pure functions, shared by the Today screen and the server tests.
//
// An hour is { t: ISO start time, temp: degrees F, pop: chance of rain 0 to 100 or null,
// wind: mph or null, short: forecast words, day: daytime true/false }.
//
// The score is a plain rule of thumb, not veterinary advice: comfortable air temperature,
// low chance of rain, light wind and daylight score well. Hot sunny afternoons are marked
// down hardest, because pavement in the sun runs far hotter than the air.

export const HOT_PAVEMENT_F = 85 // air temperature at which sunlit pavement is treated as a paw risk
export const TOO_HOT_F = 92
export const VERY_COLD_F = 20

const WET = /rain|shower|storm|thunder|drizzle|sleet|snow|ice|freezing/i

export function scoreHour(h) {
  if (!h || !Number.isFinite(h.temp)) return { score: 0, flags: ['unknown'] }
  const flags = []
  let s = 100
  const t = h.temp
  // Temperature: 45 to 70 is ideal. Heat costs more than cold.
  if (t > 70) s -= (t - 70) * 2.6
  if (t < 45) s -= (45 - t) * 1.6
  if (t >= TOO_HOT_F) { s -= 25; flags.push('too_hot') } else if (t >= HOT_PAVEMENT_F && h.day) { s -= 18; flags.push('hot_pavement') } else if (t >= 78) flags.push('warm')
  if (t <= VERY_COLD_F) { s -= 15; flags.push('very_cold') } else if (t <= 32) flags.push('freezing')
  // Rain: the chance when it is given, the forecast words when it is not.
  const pop = Number.isFinite(h.pop) ? h.pop : WET.test(h.short || '') ? 60 : 0
  if (pop >= 20) s -= (pop - 10) * 0.7
  if (pop >= 60) flags.push('wet'); else if (pop >= 30) flags.push('maybe_wet')
  if (/thunder|storm/i.test(h.short || '')) { s -= 30; flags.push('storm') }
  // Wind.
  if (Number.isFinite(h.wind) && h.wind > 15) { s -= (h.wind - 15) * 1.5; if (h.wind >= 25) flags.push('windy') }
  // Dark is fine, just a little less pleasant, except when it is hot: then dark is the better choice.
  if (!h.day && t < 78) { s -= 8; flags.push('dark') }
  return { score: Math.max(0, Math.min(100, Math.round(s))), flags }
}

export const grade = (score) => (score >= 75 ? 'great' : score >= 55 ? 'ok' : score >= 35 ? 'poor' : 'avoid')

// Scores every hour and groups the good ones into windows. Returns the hours with their scores,
// the best windows (longest and highest first, at most `max`), and one caution for the day if any.
export function walkWindows(hours, { max = 2, minScore = 62, span = 3, now = Date.now() } = {}) {
  const list = (Array.isArray(hours) ? hours : []).filter((h) => h && Date.parse(h.t) + 3600e3 > now).slice(0, 24).map((h) => ({ ...h, ...scoreHour(h) }))
  const windows = []
  let cur = null
  for (const h of list) {
    if (h.score >= minScore) {
      if (!cur) { cur = { start: h.t, hours: [] }; windows.push(cur) }
      cur.hours.push(h)
    } else cur = null
  }
  for (const w of windows) {
    // A long good stretch is narrowed to its best three hours, the earliest on a tie.
    if (w.hours.length > span) {
      let bi = 0, bs = -1
      for (let i = 0; i + span <= w.hours.length; i++) { const sc = w.hours.slice(i, i + span).reduce((a, h) => a + h.score, 0); if (sc > bs) { bs = sc; bi = i } }
      w.hours = w.hours.slice(bi, bi + span); w.start = w.hours[0].t
    }
    const last = w.hours[w.hours.length - 1]
    w.end = new Date(Date.parse(last.t) + 3600e3).toISOString()
    w.score = Math.round(w.hours.reduce((a, h) => a + h.score, 0) / w.hours.length)
    w.temp = Math.round(w.hours.reduce((a, h) => a + h.temp, 0) / w.hours.length)
    w.pop = Math.max(...w.hours.map((h) => (Number.isFinite(h.pop) ? h.pop : 0)))
    w.dark = w.hours.every((h) => !h.day)
  }
  // Best first: quality, then sooner. Long windows are trimmed to the best three hours when shown.
  const best = [...windows].sort((a, b) => b.score - a.score || Date.parse(a.start) - Date.parse(b.start)).slice(0, max).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  const flags = new Set(list.slice(0, 14).flatMap((h) => h.flags))
  const caution = flags.has('storm') ? 'Storms are in the forecast. Stay close to home.'
    : flags.has('too_hot') ? 'Very hot hours ahead. Keep walks short, shaded and early or late.'
      : flags.has('hot_pavement') ? 'Pavement in the sun will be hot this afternoon. Hold the back of your hand on it for a few seconds before walking on it.'
        : flags.has('very_cold') ? 'Very cold hours ahead. Keep walks short and check paws.'
          : flags.has('wet') ? 'Rain is likely for part of the day.'
            : ''
  return { hours: list, windows: best, caution, now: list[0] || null, goodNow: !!list[0] && list[0].score >= minScore }
}

// "4 PM", "4 to 6 PM", "11 AM to 1 PM", in the viewer's own time zone.
export function hourLabel(iso) {
  const d = new Date(iso), h = d.getHours()
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`
}
export function rangeLabel(startIso, endIso) {
  const a = new Date(startIso), b = new Date(endIso), ah = a.getHours(), bh = b.getHours()
  const n = (h) => (h % 12 === 0 ? 12 : h % 12), ap = (h) => (h < 12 ? 'AM' : 'PM')
  return ap(ah) === ap(bh) && a.toDateString() === b.toDateString() ? `${n(ah)} to ${n(bh)} ${ap(bh)}` : `${n(ah)} ${ap(ah)} to ${n(bh)} ${ap(bh)}`
}
export function dayWord(iso, now = Date.now()) {
  const d = new Date(iso), t = new Date(now)
  if (d.toDateString() === t.toDateString()) return d.getHours() >= 17 ? 'this evening' : d.getHours() >= 12 ? 'this afternoon' : 'this morning'
  const tm = new Date(now + 864e5)
  return d.toDateString() === tm.toDateString() ? (d.getHours() < 12 ? 'tomorrow morning' : 'tomorrow') : d.toLocaleDateString('en-US', { weekday: 'long' })
}
// One sentence for the Today card.
export function headline(name, r, now = Date.now()) {
  if (!r || !r.hours.length) return ''
  const cur = r.now
  if (!r.windows.length) return `No great stretch in the next day. Keep ${name}'s walks short${cur && cur.temp >= 78 ? ' and shaded' : ''}.`
  const w = r.windows[0], startsIn = Date.parse(w.start) - now
  const what = `${w.temp}°${w.pop >= 30 ? `, ${w.pop}% chance of rain` : ', dry'}`
  if (startsIn <= 20 * 60e3) return `Now is a good time to take ${name} out. ${what} until ${hourLabel(w.end)}.`
  const best = `${rangeLabel(w.start, w.end)} ${dayWord(w.start, now)}`
  if (r.goodNow && cur) return `Now works for ${name}: ${cur.temp}°${cur.pop >= 30 ? `, ${cur.pop}% chance of rain` : ', dry'}. Better still: ${best}.`
  return `Best time for ${name}: ${best}. ${what}.`
}
