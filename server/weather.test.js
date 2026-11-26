import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { scoreHour, walkWindows, headline, grade } from '../src/walkWindows.js'
import { registerWeather, slimPeriod } from './routesWeather.js'

const at = (h, d = 0) => new Date(Date.UTC(2026, 6, 10 + d, h)).toISOString()
const hr = (h, temp, o = {}) => ({ t: at(h), temp, pop: 0, wind: 5, short: 'Sunny', day: true, ...o })

test('walk scoring: mild dry daylight is great, hot sun and storms are not', () => {
  assert.equal(grade(scoreHour(hr(14, 60)).score), 'great')
  const hot = scoreHour(hr(20, 90))
  assert.ok(hot.flags.includes('hot_pavement') && hot.score < 50, JSON.stringify(hot))
  assert.ok(!scoreHour(hr(3, 90, { day: false })).flags.includes('hot_pavement'))
  assert.ok(scoreHour(hr(14, 96)).flags.includes('too_hot'))
  const storm = scoreHour(hr(14, 65, { pop: 80, short: 'Thunderstorms' }))
  assert.ok(storm.flags.includes('storm') && storm.score < 30)
  assert.ok(scoreHour(hr(14, 10)).flags.includes('very_cold'))
  assert.ok(scoreHour(hr(2, 55, { day: false })).score < scoreHour(hr(14, 55)).score)
  assert.deepEqual(scoreHour({ t: at(1), temp: NaN }), { score: 0, flags: ['unknown'] })
  // No rain chance given: the forecast words stand in.
  assert.ok(scoreHour(hr(14, 60, { pop: null, short: 'Light Rain' })).score < scoreHour(hr(14, 60, { pop: null })).score)
})

test('walk windows: a hot afternoon pushes the pick to morning and evening, with a pavement caution', () => {
  const now = Date.parse(at(10))
  const temps = [72, 76, 82, 86, 90, 92, 91, 88, 84, 79, 74, 70, 68, 66]
  const hours = temps.map((t, i) => hr(10 + i, t, { day: 10 + i < 24 }))
  const r = walkWindows(hours, { now })
  assert.equal(r.hours.length, temps.length)
  assert.ok(r.windows.length >= 1 && r.windows.length <= 2)
  for (const w of r.windows) for (const h of w.hours) assert.ok(h.temp < 85, 'no window in the heat')
  assert.match(r.caution, /hot/i)
  assert.match(headline('Biscuit', r, now), /Biscuit/)
  // Hours already over are dropped, and nothing good means an honest line.
  assert.equal(walkWindows(hours, { now: Date.parse(at(15)) }).hours[0].t, at(15))
  const bad = walkWindows([hr(10, 97), hr(11, 98)], { now })
  assert.equal(bad.windows.length, 0)
  assert.match(headline('Biscuit', bad, now), /short/)
  assert.equal(headline('Biscuit', walkWindows([], { now }), now), '')
})

test('weather endpoint: rounds the position, caches, reads NWS periods, and fails plainly', async () => {
  const calls = []
  let fail = false, clock = Date.parse(at(10))
  const fetchImpl = async (url, o) => {
    calls.push(url)
    assert.match(o.headers['User-Agent'], /Trot/)
    if (fail) return { ok: false, status: 503, json: async () => ({}) }
    if (url.includes('/points/0,0')) return { ok: false, status: 404, json: async () => ({}) }
    if (url.includes('/points/')) return { ok: true, status: 200, json: async () => ({ properties: { forecastHourly: 'https://api.weather.gov/gridpoints/GSP/1,2/forecast/hourly', relativeLocation: { properties: { city: 'Charlotte', state: 'NC' } } } }) }
    return { ok: true, status: 200, json: async () => ({ properties: { periods: [
      { startTime: '2026-07-10T06:00:00-04:00', temperature: 68, temperatureUnit: 'F', probabilityOfPrecipitation: { value: 20 }, windSpeed: '5 to 10 mph', shortForecast: 'Mostly Sunny', isDaytime: true },
      { startTime: '2026-07-10T07:00:00-04:00', temperature: 20, temperatureUnit: 'C', probabilityOfPrecipitation: { value: null }, windSpeed: '3 mph', shortForecast: 'Sunny', isDaytime: true },
      { startTime: 'x', temperature: 'warm' },
    ] } }) }
  }
  const app = express(), api = express.Router()
  registerWeather({ api, limiter: () => () => ({ ok: true }), limited: (res) => res.status(429).end() }, { fetchImpl, now: () => clock })
  app.use('/api', api)
  const s = app.listen(0), base = `http://127.0.0.1:${s.address().port}/api/weather`
  try {
    const a = await (await fetch(base + '?lat=35.18649&lng=-80.81231')).json()
    assert.equal(a.place, 'Charlotte, NC')
    assert.equal(a.source, 'National Weather Service')
    assert.deepEqual(a.hours, [
      { t: '2026-07-10T10:00:00.000Z', temp: 68, pop: 20, wind: 10, short: 'Mostly Sunny', day: true },
      { t: '2026-07-10T11:00:00.000Z', temp: 68, pop: null, wind: 3, short: 'Sunny', day: true },
    ])
    assert.ok(calls[0].endsWith('/points/35.19,-80.81'), calls[0])
    // A nearby position within the same rounding is served from memory.
    const n = calls.length
    await fetch(base + '?lat=35.1871&lng=-80.8139')
    assert.equal(calls.length, n)
    // After the cache window the forecast is fetched again, and a failure falls back to the last good copy.
    clock += 31 * 60e3; fail = true
    const st = await (await fetch(base + '?lat=35.19&lng=-80.81')).json()
    assert.equal(st.stale, true)
    assert.equal((await fetch(base + '?lat=40&lng=-75')).status, 502)
    fail = false
    assert.equal((await fetch(base + '?lat=0&lng=0')).status, 404)
    assert.equal((await fetch(base + '?lat=abc&lng=1')).status, 400)
    assert.equal(slimPeriod(null), null)
  } finally { await new Promise((r) => s.close(r)) }
})
