// Hourly forecast for the Today screen's "best time to walk" card.
//
// Source: the US National Weather Service (api.weather.gov), which is free, needs no key and
// covers the United States only. Outside the US, or when the service does not answer, the
// endpoint says so and the app simply leaves the card out.
//
// Privacy: the position is rounded to two decimals (about a kilometre) before it is used or
// cached, nothing about the caller is stored, and the forecast is cached in memory only.

const NWS = 'https://api.weather.gov'
const AGENT = 'Trot/1.0 (dog walking app; hourly forecast for walk timing; contact via the site this runs on)'
export const WEATHER = { pointTtlMs: 24 * 3600e3, hourlyTtlMs: 30 * 60e3, staleMs: 6 * 3600e3, timeoutMs: 8000, hours: 36, windowMs: 60e3, max: 30 }

const mph = (v) => { const m = /(\d+)(?:\s*to\s*(\d+))?\s*mph/i.exec(String(v || '')); return m ? Number(m[2] || m[1]) : null }
const toF = (t, unit) => (unit === 'C' ? Math.round((t * 9) / 5 + 32) : t)

// The part of an NWS hourly period the app uses.
export function slimPeriod(p) {
  if (!p || typeof p.startTime !== 'string' || !Number.isFinite(p.temperature)) return null
  const pop = p.probabilityOfPrecipitation && Number.isFinite(p.probabilityOfPrecipitation.value) ? p.probabilityOfPrecipitation.value : null
  return { t: new Date(p.startTime).toISOString(), temp: toF(p.temperature, p.temperatureUnit), pop, wind: mph(p.windSpeed), short: String(p.shortForecast || '').slice(0, 60), day: p.isDaytime !== false }
}

export function registerWeather(kit, { fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const { api, limiter, limited } = kit
  const limit = limiter({ windowMs: WEATHER.windowMs, max: WEATHER.max })
  const points = new Map(), hourly = new Map(), busy = new Map()
  const get = async (url) => {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), WEATHER.timeoutMs)
    try {
      const r = await fetchImpl(url, { headers: { 'User-Agent': AGENT, Accept: 'application/geo+json' }, signal: ctl.signal })
      if (!r.ok) { const e = new Error('weather ' + r.status); e.status = r.status; throw e }
      return await r.json()
    } finally { clearTimeout(timer) }
  }
  async function load(key, lat, lng) {
    let pt = points.get(key)
    if (!pt || pt.at + WEATHER.pointTtlMs < now()) {
      const j = await get(`${NWS}/points/${lat},${lng}`)
      const p = (j && j.properties) || {}
      if (typeof p.forecastHourly !== 'string' || !p.forecastHourly.startsWith(NWS + '/')) throw new Error('weather point')
      const rl = (p.relativeLocation && p.relativeLocation.properties) || {}
      pt = { at: now(), url: p.forecastHourly, place: rl.city ? `${rl.city}${rl.state ? ', ' + rl.state : ''}` : '' }
      points.set(key, pt)
      if (points.size > 5000) points.delete(points.keys().next().value)
    }
    const j = await get(pt.url)
    const hours = (((j && j.properties) || {}).periods || []).map(slimPeriod).filter(Boolean).slice(0, WEATHER.hours)
    if (!hours.length) throw new Error('weather hours')
    const out = { place: pt.place, hours, updatedAt: new Date(now()).toISOString(), source: 'National Weather Service' }
    hourly.set(key, { at: now(), out })
    if (hourly.size > 5000) hourly.delete(hourly.keys().next().value)
    return out
  }
  api.get('/weather', async (req, res) => {
    const r = limit('ip:' + (req.ip || ''))
    if (!r.ok) return limited(res, r)
    const lat = Math.round(Number(req.query.lat) * 100) / 100, lng = Math.round(Number(req.query.lng) * 100) / 100
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return res.status(400).json({ error: 'Send lat and lng.' })
    const key = `${lat},${lng}`, hit = hourly.get(key)
    res.set('Cache-Control', 'public, max-age=600')
    if (hit && hit.at + WEATHER.hourlyTtlMs > now()) return res.json(hit.out)
    try {
      if (!busy.has(key)) busy.set(key, load(key, lat, lng).finally(() => busy.delete(key)))
      res.json(await busy.get(key))
    } catch (e) {
      // An older forecast is better than none for a few hours. A 404 from the points lookup means outside the US.
      if (hit && hit.at + WEATHER.staleMs > now()) return res.json({ ...hit.out, stale: true })
      res.set('Cache-Control', 'no-store')
      res.status(e && e.status === 404 ? 404 : 502).json({ error: e && e.status === 404 ? 'No forecast for this place. The forecast covers the United States only.' : 'The forecast is not available right now.' })
    }
  })
}
