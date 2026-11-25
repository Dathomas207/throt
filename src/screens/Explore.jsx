import React, { useEffect, useMemo, useRef, useState } from 'react'
import TrotMap, { useHeight } from '../Map.jsx'
import { Ic, Av } from '../ui.jsx'
import { ROUTES, haversine } from '../data.js'
import { fetchPlaces, bboxAround } from '../osm.js'
import { routeLoop, locate, setHandoff, DEFAULT_CENTER } from '../routing.js'
import '../maps.css'

const FILTERS = ['All', 'Off-leash', 'Fenced', 'Water']
const LOOPS = [1, 2, 3]
const MAX_PINS = 60
const fmtDist = (mi) => (mi < 0.1 ? Math.max(10, Math.round((mi * 5280) / 10) * 10) + ' ft' : mi.toFixed(mi < 10 ? 1 : 0) + ' mi')

const Target = () => <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1F5AE8" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="1.5" fill="#1F5AE8" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>

export default function Explore({ setTab, setToast, dogName }) {
  const [user, setUser] = useState(null)
  const [view, setView] = useState(null)
  const [res, setRes] = useState(null)
  const [loading, setLoading] = useState(true)
  const [locating, setLocating] = useState(false)
  const [moved, setMoved] = useState(false)
  const [origin, setOrigin] = useState(DEFAULT_CENTER)
  const [sel, setSel] = useState(null)
  const [filter, setFilter] = useState('All')
  const [loop, setLoop] = useState(null)
  const [sheetRef, sheetH] = useHeight()
  const bounds = useRef(null), req = useRef(0), loopReq = useRef(0), alive = useRef(true), vn = useRef(0)
  const goTo = (at, zoom) => setView({ at, zoom, n: ++vn.current })

  const load = async (bbox, center) => {
    const id = ++req.current
    setLoading(true); setMoved(false); setOrigin(center)
    const r = await fetchPlaces(bbox)
    if (!alive.current || id !== req.current) return
    setRes(r); setLoading(false)
    setSel((s) => (r.places.some((p) => p.id === s) ? s : null))
    // The sample places are around Cambridge, so move the map to where they are.
    // The center sits south of them so the pins land above the sheet.
    if (r.sample) { setOrigin(DEFAULT_CENTER); goTo([42.3, -71.128], 11) }
  }
  useEffect(() => {
    alive.current = true
    ;(async () => {
      const u = await locate(5000)
      if (!alive.current) return
      const c = u || DEFAULT_CENTER
      if (u) setUser(u)
      goTo(c, 13); load(bboxAround(c, 2), c)
    })()
    return () => { alive.current = false; req.current++; loopReq.current++ }
  }, [])
  const nearMe = async () => {
    setLocating(true)
    const u = await locate(8000)
    if (!alive.current) return
    setLocating(false)
    if (!u) { setToast('Location is unavailable. Showing the current area.'); return }
    setUser(u); clearLoop(); goTo(u, 14); load(bboxAround(u, 2), u)
  }
  const searchHere = () => { const b = bounds.current; if (b) load(b, b.center) }
  const retry = () => { const b = bounds.current; if (b && !res.sample) load(b, b.center); else { const c = user || DEFAULT_CENTER; goTo(c, 13); load(bboxAround(c, 2), c) } }
  const clearLoop = () => { loopReq.current++; setLoop(null) }
  const pick = (id) => { if (id !== sel) clearLoop(); setSel(id) }

  const from = user || origin
  const places = useMemo(() => {
    const f = filter.toLowerCase()
    return ((res && res.places) || [])
      .filter((p) => filter === 'All' || (p.tags.join(' ') + ' ' + p.kind).toLowerCase().includes(f))
      .map((p) => ({ ...p, d: haversine(from, p.at) }))
      .sort((a, b) => a.d - b.d)
  }, [res, filter, from[0], from[1]])
  const pins = useMemo(() => places.slice(0, MAX_PINS), [places])
  const p = places.find((x) => x.id === sel) || null

  const buildLoop = async (miles) => {
    const id = ++loopReq.current
    setLoop({ miles, status: 'loading' })
    const route = await routeLoop(p.at, miles)
    if (!alive.current || id !== loopReq.current) return
    setLoop({ miles, status: 'ready', route })
  }
  const walk = () => {
    const r = loop.route
    setHandoff({ kind: 'routed', name: `${r.miles.toFixed(1)} mi loop at ${p.name}`, place: p.name, pts: r.pts, miles: r.miles, minutes: r.minutes, approximate: !!r.approximate })
    setTab('record')
  }
  const demo = (key) => { setHandoff({ kind: 'demo', key }); setTab('record') }
  const ready = loop && loop.status === 'ready'
  const total = res ? res.places.length : 0

  return (
    <div className="fill">
      <TrotMap pins={pins} selected={p ? p.id : null} onPin={(x) => pick(x.id)} route={ready ? loop.route.pts : undefined} me={user} view={view} bottom={sheetH} onMove={(b, byUser) => { bounds.current = b; if (byUser) setMoved(true) }} className="abs" />
      <div className="over topbar">
        <div className="chips">{FILTERS.map((f) => <button key={f} className={`chip ${filter === f ? 'on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}</div>
        <div className="mbar">
          {moved && !loading && <button className="mbtn" onClick={searchHere}>Search this area</button>}
          <button className="mbtn light end" onClick={nearMe} disabled={locating}>{locating ? <span className="spin" aria-hidden="true" /> : <Target />}Near me</button>
        </div>
      </div>
      <div className="sheet" ref={sheetRef} aria-live="polite">
        <div className="grab" />
        {loading && <div className="mload" role="status"><span className="spin" aria-hidden="true" />Finding dog-friendly places on the map</div>}
        {!loading && res && res.sample && <div className="mnote"><span className="grow"><b>Showing sample places.</b> Live map data could not be loaded, so these are demo places around Cambridge, MA.</span><button onClick={retry}>Retry</button></div>}
        {!loading && res && res.clamped && <div className="mnote info"><span className="grow">That is a big area. Showing places near the middle of the map. Zoom in to search more closely.</span></div>}
        {!loading && res && !p && (<>
          <div className="row between top"><div><h2>{res.sample ? 'Sample dog places' : total === 0 ? 'Nothing mapped here yet' : `${total} dog-friendly ${total === 1 ? 'place' : 'places'}`}</h2><div className="meta">{res.sample ? 'Demo data, not live' : total === 0 ? 'No dog parks or dog-tagged parks in this area on OpenStreetMap. Move the map or try Near me.' : filter === 'All' ? 'From OpenStreetMap, nearest first' : `${places.length} match ${filter}`}</div></div></div>
          {places.slice(0, 4).map((x) => <button key={x.id} className="rrow" onClick={() => pick(x.id)}><span className="ricon"><Ic n="map" s={20} c="#1F5AE8" /></span><span className="grow"><b>{x.name}</b><small>{x.kind}{x.tags.length ? ' · ' + x.tags.slice(0, 2).join(' · ') : ''}</small></span><span className="num">{fmtDist(x.d)}</span></button>)}
          {total > 0 && places.length === 0 && <div className="meta">No places here match {filter}. Try All.</div>}
        </>)}
        {!loading && p && (<>
          <div className="row between top g10">
            <div className="grow"><h2>{p.name}</h2><div className="meta">{p.kind}{p.sample ? ' · sample place' : ''}</div></div>
            <div className="dist"><b>{fmtDist(p.d)}</b><span>{user ? 'from you' : 'from map center'}</span></div>
            <button className="round" aria-label="Back to list" onClick={() => pick(null)}><Ic n="x" s={18} /></button>
          </div>
          {p.tags.length > 0 && <div className="tags">{p.tags.map((t) => <span key={t}>{t}</span>)}</div>}
          {p.dogs != null && <div className="meta"><b>{p.dogs}</b> dogs this week (sample figure)</div>}
          {p.top && <div className="topdog"><Av t={p.top[0]} s={32} bg="#C8F031" c="#0F1B2D" /><span><b>{p.top}</b> is top dog here with {p.topVisits} visits this week (sample)</span></div>}
          <div className="eyebrow dark">BUILD A LOOP FROM HERE</div>
          <div className="loops">{LOOPS.map((m) => <button key={m} className={`chip flat ${loop && loop.miles === m ? 'on' : ''}`} aria-pressed={!!(loop && loop.miles === m)} onClick={() => buildLoop(m)}><b>{m}</b> mi loop</button>)}</div>
          {loop && loop.status === 'loading' && <div className="mload" role="status"><span className="spin" aria-hidden="true" />Routing a {loop.miles} mile loop on real paths</div>}
          {ready && <div className="rsum"><b>{loop.route.miles.toFixed(1)} mi</b><span>about {loop.route.minutes} min at {dogName || 'Biscuit'}'s pace · {loop.route.approximate ? 'approximate' : 'routed on mapped paths'}</span></div>}
          {ready && <button className="cta" onClick={walk}>Walk {dogName || 'Biscuit'} here</button>}
          {ready && loop.route.approximate && <div className="mnote"><span className="grow"><b>Approximate loop.</b> The routing service did not answer, so this is a simple circle, not a walkable path.</span><button onClick={() => buildLoop(loop.miles)}>Retry</button></div>}
          {!loop && <div className="meta">Pick a loop length to preview a route, then start the walk.</div>}
          {p.routes && p.routes.length > 0 && <div className="eyebrow dark">SAMPLE ROUTES (DEMO PLAYBACK)</div>}
          {(p.routes || []).map((k) => <button key={k} className="rrow" onClick={() => demo(k)}><span className="ricon"><Ic n="map" s={20} c="#1F5AE8" /></span><span className="grow"><b>{ROUTES[k].name}</b><small>{ROUTES[k].note}</small></span><span className="num">{ROUTES[k].miles} mi</span></button>)}
          {p.osm && <a className="osmlink" href={`https://www.openstreetmap.org/${p.osm.type}/${p.osm.id}`} target="_blank" rel="noopener noreferrer">View on OpenStreetMap</a>}
        </>)}
      </div>
    </div>
  )
}
