import React, { useEffect, useState } from 'react'
import { Ic, Paw, DogAv } from '../ui.jsx'
import { api } from '../api.js'
import { haversine } from '../data.js'
import './today.css'

// The home screen is the dog's day, not a dashboard: a greeting, what the dog could do
// today, places to go, what is coming up, then the journal of outings below.

const HOME = [35.186, -80.812] // Eastover, Charlotte: the launch area
const KIND = { park: 'Park', bar: 'Bar or patio', cafe: 'Cafe or food', shop: 'Pet shop', vet: 'Vet', care: 'Daycare or grooming', water: 'Water', other: 'Place' }
const LETTER = { park: 'P', bar: 'B', cafe: 'C', shop: 'S', vet: 'V', care: 'D', water: 'W', other: '•' }

export function greeting(now = new Date()) {
  const h = now.getHours()
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Winding down'
}
// A plain suggestion for this time of day. No weather or health claims: only the clock.
export function nudge(name, now = new Date()) {
  const h = now.getHours()
  if (h < 5) return `${name} is probably asleep. Tomorrow is a new walk.`
  if (h < 9) return `Parks are quiet this early. A good time to get ${name} out.`
  if (h < 12) return `Still time for a proper morning walk with ${name}.`
  if (h < 14) return `A short midday loop keeps ${name}'s afternoon calmer.`
  if (h < 17) return `Patios are open. Take ${name} along for the afternoon.`
  if (h < 20) return `Evening walk time. ${name} has been waiting.`
  return `One last short trip outside before ${name} settles in.`
}

function lastCenter() {
  try { const v = JSON.parse(localStorage.getItem('trot-view-v2')); if (v && Array.isArray(v.at) && Number.isFinite(v.at[0]) && Number.isFinite(v.at[1])) return v.at } catch (e) { /* no saved map position */ }
  return HOME
}
const miles = (a, b) => haversine(a, b)
const fmtMi = (m) => (m < 0.1 ? 'Right here' : m < 10 ? m.toFixed(1) + ' mi' : Math.round(m) + ' mi')
const day = (s) => { const d = new Date(String(s).slice(0, 10) + 'T12:00:00'); return Number.isNaN(d.getTime()) ? null : d }

// The big greeting card. `status` is one line about today; children are extra rows (a progress bar, alerts).
export function TodayHero({ name, photoUrl, demo, status, onWalk, onDog, children }) {
  return (
    <section className="today">
      <div className="row g14">
        <button className="doglink" aria-label={`Open ${name}'s profile`} onClick={onDog}><DogAv name={name} photoUrl={photoUrl} demo={demo} s={76} bg="#C8F031" c="#0F1B2D" /></button>
        <div className="grow"><div className="eyebrow">{greeting().toUpperCase()}</div><h1 className="tname">{name}</h1>{status && <div className="tstatus">{status}</div>}</div>
      </div>
      <p className="tnudge">{nudge(name)}</p>
      {children}
      <button className="cta" onClick={onWalk}><Paw s={22} c="#0F1B2D" />Take {name} out</button>
    </section>
  )
}

// Four ways into the rest of the dog's life.
export function TodayTiles({ name, setTab, openCompete }) {
  const tiles = [
    ['Go somewhere', 'Parks, patios and shops', 'map', () => setTab('explore')],
    ['Plan a route', 'A loop from where you are', 'play', () => setTab('record')],
    [`${name}'s care`, 'Health, ID and documents', 'heart', () => setTab('dog')],
    ['Join in', 'Events and challenges', 'trophy', () => openCompete('events')],
  ]
  return <div className="ttiles">{tiles.map(([t, s, ic, go]) => <button key={t} className="ttile" onClick={go}><span className="ticon"><Ic n={ic} s={20} c="#1F5AE8" /></span><b>{t}</b><small>{s}</small></button>)}</div>
}

// Listed places near the last map position (or Eastover), and the next few events. Both come
// from Trot's own index, so they show without the slow live map lookup. Nothing is shown when
// the server has nothing: no invented places or events.
export function TodayIdeas({ name, setTab, openCompete, hasApi = true }) {
  const [places, setPlaces] = useState(null), [events, setEvents] = useState(null)
  useEffect(() => {
    if (!hasApi) return
    let on = true
    const c = lastCenter()
    api.places.list({ s: c[0] - 0.06, n: c[0] + 0.06, w: c[1] - 0.075, e: c[1] + 0.075 }).then((r) => {
      if (!on) return
      const list = (r.places || []).filter((p) => Array.isArray(p.at) && ['park', 'bar', 'cafe', 'water'].includes(p.category)).map((p) => ({ ...p, mi: miles(c, p.at) })).sort((a, b) => a.mi - b.mi)
      // A mix for the day: the nearest of each kind first, then whatever else is close.
      const seen = new Set(), first = [], rest = []
      for (const p of list) { if (!seen.has(p.category)) { seen.add(p.category); first.push(p) } else rest.push(p) }
      setPlaces([...first, ...rest].slice(0, 8))
    }, () => on && setPlaces([]))
    const today = new Date(), iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    api.events.list({ from: iso, near: [Math.round(c[0] * 1e3) / 1e3, Math.round(c[1] * 1e3) / 1e3] }).then((r) => on && setEvents((r.events || []).slice(0, 3)), () => on && setEvents([]))
    return () => { on = false }
  }, [hasApi])
  if (!hasApi) return null
  return (
    <>
      {places && places.length > 0 && <section className="tsec">
        <div className="row between thead"><h2>Take {name} somewhere</h2><button className="tlink" onClick={() => setTab('explore')}>See the map</button></div>
        <div className="tscroll">{places.map((p) => <button key={p.id} className="tplace" onClick={() => setTab('explore')}>
          <span className="row g8"><span className="ticon small" aria-hidden="true">{LETTER[p.category] || '•'}</span><span className="tkind">{KIND[p.category] || 'Place'}</span><span className="tmi">{fmtMi(p.mi)}</span></span>
          <b>{p.name}</b>
          {p.note && <small>{p.note}</small>}
        </button>)}</div>
      </section>}
      {events && events.length > 0 && <section className="tsec">
        <div className="row between thead"><h2>Coming up</h2><button className="tlink" onClick={() => openCompete('events')}>All events</button></div>
        <div className="card">{events.map((e) => { const d = day(e.startsOn); return <button key={e.id} className="tevent" onClick={() => openCompete('events')}>
          <span className="tdate">{d ? <><i>{d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</i><b>{d.getDate()}</b></> : <b>?</b>}</span>
          <span className="grow"><b>{e.name}</b><small>{[e.venue, e.region].filter(Boolean).join(' · ')}</small></span>
        </button> })}</div>
      </section>}
    </>
  )
}
