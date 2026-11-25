import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TrotMap, { useHeight } from '../Map.jsx'
import { Ic, Av } from '../ui.jsx'
import { ROUTES, haversine } from '../data.js'
import { api, hasToken } from '../api.js'
import { fetchPlaces, readPlaceCache, fetchTrails, samplePlaces, bboxAround, bboxKey, snapBbox, areaSummary, mergePlaces, normalizeCommunity, communityLine, validateNewPlace, perfMark, CATEGORIES, COMMUNITY_KIND, DOG_POLICY, AMENITY, REPORT_REASONS, CLAIM_ROLE, claimRolesFor, maintainedLine, verifiedTag, checkedLine, googleMapsUrl } from '../osm.js'
import { routeLoop, routeThrough, locate, setHandoff, loadSavedRoutes, saveRoute, deleteSavedRoute, fmtDist, walkMinutes, peekDemoRoute, resolveDemoRoute, useHereLoop, locationHelp, DEFAULT_CENTER, MAX_WAYPOINTS, MAX_SAVED } from '../routing.js'
import { searchPlaces, searchMode, MIN_QUERY } from '../search.js'
import '../maps.css'

// Water and Other have no chip of their own. They show under All.
const CHIPS = CATEGORIES.filter((c) => c.id !== 'water' && c.id !== 'other')
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]))
const JUMPS = [{ name: 'Eastover, Charlotte', at: [35.186, -80.812] }, { name: 'Charlotte, NC', at: [35.2271, -80.8431] }, { name: 'Boston, MA', at: [42.3601, -71.0589] }]
const COMM_KEY = 'trot-comm1' // the last area's listed and member places, so they show at once next time
const LOOPS = [1, 2, 3]
const MAX_PINS = 60
const DEBOUNCE_MS = 350
const BUILD_ZOOM = 15
const LOCATE_MOVE_MS = 2000 // a location that arrives later than this only adds the dot; the view is left alone
const MOVED_FRACTION = 0.3 // how far the view has to move, as a share of the screen, before "Search this area" is offered
const HOME = [35.186, -80.812] // Eastover, Charlotte: the launch area, where the listed places are
const VIEW_KEY = 'trot-view-v2', LAYERS_KEY = 'trot-layers-v2'
const LAYER_DEFAULTS = { places: true, trails: false, heat: false, community: true, saved: false }
const LAYER_LABELS = [['places', 'Places'], ['trails', 'Trails'], ['heat', 'Heatmap'], ['community', 'Community places'], ['saved', 'Saved routes']]
const SNAPS = ['peek', 'half', 'full']
const NO_BUILD = { on: false, wps: [], route: null, status: 'idle', fit: false }
const NO_GROUP = { status: 'idle', places: [], updating: false }
const samePt = (a, b) => a && b && a[0] === b[0] && a[1] === b[1]
const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)) } catch (e) { return null } }
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} }
const readView = () => { const v = readJSON(VIEW_KEY); return v && Array.isArray(v.at) && Number.isFinite(v.at[0]) && Number.isFinite(v.at[1]) && Math.abs(v.at[0]) <= 90 && Math.abs(v.at[1]) <= 180 && v.zoom >= 3 && v.zoom <= 19 ? v : null }
const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1200 }) : setTimeout(fn, 250))
const nearestMiles = (from, pts) => { let best = Infinity; for (const q of pts) { const d = haversine(from, q); if (d < best) best = d } return best }
const communityOn = () => !!(api && api.places && typeof api.places.list === 'function')

const Target = () => <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1F5AE8" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="1.5" fill="#1F5AE8" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>
const Glass = () => <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5B6472" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l5 5" /></svg>
const Stack = () => <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0F1B2D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5" /></svg>
// The same glyph and colours as the map pin, so the list doubles as the legend.
const CatDot = ({ c, community }) => <span className={`pin cat c-${c} mini ${community ? 'comm' : ''}`} aria-hidden="true"><span>{(CAT[c] || CAT.park).glyph}</span></span>
const Updating = ({ text = 'Updating' }) => <span className="upd" role="status"><span className="spin sm" aria-hidden="true" />{text}</span>

// Search field with suggestions. near() returns [lat, lng] to bias results; onChoose gets { name, detail, at }.
function PlaceSearch({ near, onChoose }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [sug, setSug] = useState(null) // { status: 'loading' | 'done', results, error, needSubmit }
  const req = useRef(0), ctl = useRef(null), alive = useRef(true), mode = useRef('submit')
  useEffect(() => { alive.current = true; searchMode().then((m) => { mode.current = m }); return () => { alive.current = false; if (ctl.current) ctl.current.abort() } }, [])
  const run = async (text, submit) => {
    const id = ++req.current
    if (ctl.current) ctl.current.abort()
    const c = new AbortController(); ctl.current = c
    setSug({ status: 'loading' })
    const r = await searchPlaces(text, { near: near(), submit, signal: c.signal })
    // A newer keystroke or a closed list makes this answer stale.
    if (!alive.current || id !== req.current) return
    setSug({ status: 'done', ...r })
  }
  useEffect(() => {
    const text = q.trim()
    req.current++
    if (ctl.current) ctl.current.abort()
    if (!open || text.length < MIN_QUERY) { setSug(null); return }
    if (mode.current !== 'live') { setSug({ status: 'done', results: [], error: null, needSubmit: true }); return }
    const t = setTimeout(() => run(text, false), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [q, open])
  const submit = (e) => { e.preventDefault(); const text = q.trim(); if (text.length >= MIN_QUERY) { setOpen(true); run(text, true) } }
  const choose = (r) => { setOpen(false); setSug(null); setQ(r.name); onChoose(r) }
  const clear = () => { setQ(''); setOpen(false); setSug(null) }
  const short = open && q.trim().length > 0 && q.trim().length < MIN_QUERY
  return (
    <form className="psearch" role="search" onSubmit={submit}>
      <label className="sr" htmlFor="place-search">Search for a place</label>
      <div className="sbox">
        <Glass />
        <input id="place-search" type="search" value={q} placeholder="Search a city, park or address" autoComplete="off" enterKeyHint="search" onChange={(e) => { setQ(e.target.value); setOpen(true) }} onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setSug(null) } }} />
        {q && <button type="button" className="sclear" aria-label="Clear search" onClick={clear}><Ic n="x" s={16} /></button>}
      </div>
      {(short || sug) && (
        <div className="sugs" aria-live="polite">
          {short && <div className="snote">Type at least {MIN_QUERY} letters</div>}
          {sug && sug.status === 'loading' && <div className="snote" role="status"><span className="spin" aria-hidden="true" />Searching</div>}
          {sug && sug.status === 'done' && sug.needSubmit && <button type="submit" className="sug go"><b>Search for "{q.trim()}"</b><small>Press Enter or tap here</small></button>}
          {sug && sug.status === 'done' && sug.error && sug.error !== 'aborted' && <div className="snote">{sug.error}</div>}
          {sug && sug.status === 'done' && !sug.error && !sug.needSubmit && sug.results.length === 0 && <div className="snote">No places match that search</div>}
          {sug && sug.status === 'done' && sug.results && sug.results.length > 0 && <ul>{sug.results.map((r, i) => <li key={i}><button type="button" className="sug" onClick={() => choose(r)}><b>{r.name}</b>{r.detail && <small>{r.detail}</small>}</button></li>)}</ul>}
        </div>
      )}
    </form>
  )
}

// `account` is set when the screen belongs to a signed-in person's own page. The demo never has it.
export default function Explore({ setTab, setToast, dogName, account }) {
  const dn = dogName || 'Biscuit'
  const t0 = useRef(performance.now()).current
  const first = useRef(readView()).current // the last area looked at, so the first paint is already there
  const [user, setUser] = useState(null)
  const [view, setView] = useState(() => ({ at: first ? first.at : HOME, zoom: first ? first.zoom : 13, n: 1 }))
  const [origin, setOrigin] = useState(first ? first.at : HOME)
  const [areaLabel, setAreaLabel] = useState('')
  const [parks, setParks] = useState(NO_GROUP) // dog parks and dog-tagged parks: the small first request
  const [more, setMore] = useState(NO_GROUP) // everything else, loaded after the first paint or when a chip needs it
  const [comm, setComm] = useState([])
  const [trails, setTrails] = useState(null) // null | { status: 'loading' | 'done', trails, error, clamped }
  const [layers, setLayers] = useState(() => ({ ...LAYER_DEFAULTS, ...(readJSON(LAYERS_KEY) || {}) }))
  const [layersOpen, setLayersOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [moved, setMoved] = useState(false)
  const [filter, setFilter] = useState('all') // 'all', a category id, or 'trails'
  const [hi, setHi] = useState(null) // highlighted place: its pin and its list row
  const [focus, setFocus] = useState(null)
  const [detail, setDetail] = useState(null) // { type: 'place' | 'trail' | 'saved' | 'here', id }
  const [loop, setLoop] = useState(null) // loop from the open place
  const here = useHereLoop() // loop from the user's own location
  const [b, setB] = useState(NO_BUILD) // route builder
  const [add, setAdd] = useState(null) // add a community place: { at, name, category, note, busy, error, tried }
  const [rname, setRname] = useState('')
  const [saved, setSaved] = useState(loadSavedRoutes)
  const [showSaved, setShowSaved] = useState(false)
  const [del, setDel] = useState(null)
  const [demoR, setDemoR] = useState({})
  const [snap, setSnap] = useState('half')
  const [dragH, setDragH] = useState(null)
  const [rootRef, H] = useHeight()
  const [sheetRef, sheetH] = useHeight()
  const [topRef, topH] = useHeight()
  const sheetEl = useRef(null), rows = useRef(new Map()), drag = useRef(null), skipClick = useRef(false)
  const setSheet = useCallback((n) => { sheetEl.current = n; sheetRef(n) }, [sheetRef])
  const bounds = useRef(null), req = useRef(0), areaCtl = useRef(null), loopReq = useRef(0), alive = useRef(true), vn = useRef(1), bReq = useRef(0), bCtl = useRef(null), lastLoad = useRef(null), wpsRef = useRef([]), touched = useRef(false), moreFor = useRef(0), commFor = useRef(0), trailsFor = useRef(0), layersRef = useRef(layers), viewTimer = useRef(null)
  layersRef.current = layers
  const goTo = (at, zoom) => setView({ at, zoom, n: ++vn.current })

  // Loading an area. Whatever is cached shows at once; the network answer replaces it when it comes.
  // The first request is the small one (parks). The rest waits until the screen has painted.
  // stay is true when the person chose the area, so a failure never moves the map to the sample places.
  const loadMore = (id) => {
    const l = lastLoad.current
    if (!l || id !== req.current || moreFor.current === id) return
    moreFor.current = id
    setMore((m) => ({ ...m, status: m.status === 'done' ? 'done' : 'loading', updating: true }))
    fetchPlaces(l.bbox, { group: 'more', signal: l.ctl.signal }).then((r) => {
      if (!alive.current || id !== req.current) return
      setMore((m) => (r.failed ? { ...m, status: 'done', updating: false, failed: m.places.length === 0, refreshFailed: m.places.length > 0 } : { status: 'done', places: r.places, updating: false }))
    })
  }
  const loadComm = (id) => {
    const l = lastLoad.current
    if (!l || id !== req.current || commFor.current === id || !communityOn()) return
    commFor.current = id
    // Listed places are few, so they are asked for across a wider area than the map data: about 6 miles each way.
    const key = bboxKey(snapBbox(l.bbox)), s = l.bbox.s - 0.09, n = l.bbox.n + 0.09, w = l.bbox.w - 0.11, e = l.bbox.e + 0.11
    const kept = readJSON(COMM_KEY)
    if (kept && kept.key === key) setComm(normalizeCommunity(kept.places))
    Promise.resolve().then(() => api.places.list({ s, w, n, e })).then((r) => { if (!alive.current || id !== req.current) return; perfMark('first-listed-places', t0); setComm(normalizeCommunity(r && r.places)); writeJSON(COMM_KEY, { key, places: (r && r.places) || [] }) }, () => {})
  }
  const loadTrails = (id = req.current) => {
    const l = lastLoad.current
    if (!l || id !== req.current || trailsFor.current === id) return
    trailsFor.current = id
    setTrails({ status: 'loading', trails: [] })
    fetchTrails(l.bbox, { signal: l.ctl.signal }).then((r) => { if (alive.current && id === req.current) setTrails({ status: 'done', trails: r.trails, error: r.error, clamped: r.clamped }) })
  }
  const load = (bbox, center, opts = {}) => {
    const id = ++req.current
    if (areaCtl.current) areaCtl.current.abort()
    const ctl = new AbortController(); areaCtl.current = ctl
    lastLoad.current = { bbox, center, stay: !!opts.stay, ctl }
    setMoved(false); setOrigin(center); setAreaLabel(opts.label || ''); setTrails(null); setComm([]); setHi(null)
    setDetail((d) => (d && d.type === 'saved' ? d : null))
    const c1 = readPlaceCache(bbox, 'parks'), c2 = readPlaceCache(bbox, 'more')
    setParks(c1 ? { status: 'done', places: c1.places, updating: !c1.fresh, old: c1.old } : { status: 'loading', places: [], updating: true })
    setMore(c2 ? { status: 'done', places: c2.places, updating: false, old: c2.old } : NO_GROUP)
    if (c1) perfMark('first-places-from-cache', t0)
    // Listed and member places come from the Trot server. They are asked for alongside the map data, never after it.
    loadComm(id)
    // The quick try gives up after about 6 seconds. If it fails, one patient retry runs behind the list, which stays usable.
    fetchPlaces(bbox, { group: 'parks', signal: ctl.signal }).then((r) => (r.failed && !r.aborted && alive.current && id === req.current ? (idle(() => loadMore(id)), fetchPlaces(bbox, { group: 'parks', signal: ctl.signal, slow: true })) : r)).then((r) => {
      if (!alive.current || id !== req.current) return
      perfMark('first-places', t0)
      if (!r.failed) setParks({ status: 'done', places: r.places, updating: false, clamped: r.clamped })
      else if (c1) setParks({ status: 'done', places: c1.places, updating: false, old: c1.old, refreshFailed: true })
      else setParks({ status: 'done', places: [], updating: false, failed: true })
      idle(() => { if (!alive.current || id !== req.current) return; loadMore(id); if (layersRef.current.trails) loadTrails(id) })
    })
  }
  useEffect(() => {
    alive.current = true
    perfMark('explore-mounted', t0)
    const c0 = first ? first.at : HOME
    load(bboxAround(c0, 2), c0, { stay: !!first })
    // Location never holds up the screen. If it comes quickly and the map has not been touched, the map goes there.
    // After that it only adds the dot.
    locate(8000).then((u) => {
      if (!alive.current || !u) return
      setUser(u)
      if (performance.now() - t0 < LOCATE_MOVE_MS && !touched.current && haversine(u, c0) > 0.2) { goTo(u, 14); load(bboxAround(u, 2), u) }
    })
    return () => { alive.current = false; req.current++; loopReq.current++; bReq.current++; if (bCtl.current) bCtl.current.abort(); if (areaCtl.current) areaCtl.current.abort(); clearTimeout(viewTimer.current) }
  }, [])
  const onMove = (x, byUser) => {
    bounds.current = x
    if (!byUser) return
    touched.current = true
    clearTimeout(viewTimer.current)
    viewTimer.current = setTimeout(() => writeJSON(VIEW_KEY, { at: x.center, zoom: x.zoom }), 400)
    // Small pans never ask again. The button appears once the view has moved a real share of the screen.
    const l = lastLoad.current
    if (l) setMoved(Math.abs(x.center[0] - l.center[0]) > MOVED_FRACTION * (x.n - x.s) || Math.abs(x.center[1] - l.center[1]) > MOVED_FRACTION * (x.e - x.w))
  }
  const choose = (at, label, zoom = 13) => { touched.current = true; clearLoop(); writeJSON(VIEW_KEY, { at, zoom }); goTo(at, zoom); load(bboxAround(at, 2), at, { stay: true, label }) }
  const nearMe = async () => {
    setLocating(true)
    const u = await locate(8000)
    if (!alive.current) return
    setLocating(false)
    if (!u) { setToast('Location is unavailable. Showing the current area.'); return }
    setUser(u); choose(u, '', 14)
  }
  const searchHere = () => { const x = bounds.current; if (x) { touched.current = true; clearLoop(); load(x, x.center, { stay: true }) } }
  const retry = () => { const l = lastLoad.current; if (l) load(l.bbox, l.center, { stay: l.stay }) }
  const clearLoop = () => { loopReq.current++; setLoop(null) }
  const setLayer = (k, v) => { const next = { ...layers, [k]: v }; setLayers(next); writeJSON(LAYERS_KEY, next); if (k === 'trails' && v && !trails) loadTrails(); if (k === 'trails' && !v && filter === 'trails') setFilter('all') }
  const pickFilter = (f) => {
    setFilter(f); setHi(null)
    if (detail && (detail.type === 'place' || detail.type === 'trail')) closeDetail()
    if (f === 'trails') { if (!layers.trails) setLayer('trails', true); else if (!trails) loadTrails() }
    else if (f !== 'all' && f !== 'park') loadMore(req.current)
  }

  // Distance from the person is only ever measured from their real location. With no location there is no distance.
  const sortFrom = user && haversine(user, origin) < 30 ? user : origin
  const all = useMemo(() => mergePlaces(layers.places ? parks.places.concat(more.places) : [], comm.filter((c) => (c.curated ? layers.places : layers.community))), [parks.places, more.places, comm, layers.places, layers.community])
  const places = useMemo(() => all
    .filter((p) => filter === 'all' || p.category === filter)
    .map((p) => ({ ...p, d: user ? haversine(user, p.at) : null, o: haversine(sortFrom, p.at) }))
    .sort((x, y) => x.o - y.o), [all, filter, user && user[0], user && user[1], sortFrom[0], sortFrom[1]])
  const pins = useMemo(() => (filter === 'trails' ? [] : places.slice(0, MAX_PINS).map((x) => (x.curated ? { ...x, community: false } : x))), [places, filter])
  const p = detail && detail.type === 'place' ? places.find((x) => x.id === detail.id) || all.find((x) => x.id === detail.id) || null : null
  const trailList = (trails && trails.trails) || []
  const trail = detail && detail.type === 'trail' ? trailList.find((x) => x.id === detail.id) || null : null
  const savedOne = detail && detail.type === 'saved' ? saved.find((x) => x.id === detail.id) || null : null
  const hereOn = !!(detail && detail.type === 'here')

  const closeDetail = () => { clearLoop(); here.clear(); setDetail(null); setDel(null); setAct(null) }
  const openPlace = (id) => { clearLoop(); setAct(null); setHi(id); setDetail({ type: 'place', id }); if (snap === 'peek') setSnap('half') }
  const openLine = (id) => { clearLoop(); const [type, ...rest] = id.split(':'); setDetail({ type, id: rest.join(':') }); setDel(null); if (snap === 'peek') setSnap('half') }
  // List and map stay linked: a row tap highlights and centers the pin, a pin tap highlights the row and scrolls to it.
  const rowTap = (x) => { if (hi === x.id) { openPlace(x.id); return } setHi(x.id); setFocus({ id: x.id, n: Date.now() }) }
  const pinTap = (x) => {
    if (b.on) { addPoint(x.at); return }
    if (add) return
    if (p) { openPlace(x.id); return }
    if (detail) closeDetail()
    setHi(x.id); if (snap === 'peek') setSnap('half')
    setTimeout(() => { const el = rows.current.get(x.id); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }) }, 60)
  }

  const buildLoop = async (miles) => {
    const id = ++loopReq.current
    setLoop({ miles, status: 'loading' })
    const route = await routeLoop(p.at, miles)
    if (!alive.current || id !== loopReq.current) return
    setLoop({ miles, status: 'ready', route })
  }
  const handoff = (h) => { setHandoff({ kind: 'routed', ...h }); setTab('record') }
  const walk = () => { const r = loop.route; handoff({ name: `${r.miles.toFixed(1)} mi loop at ${p.name}`, place: p.name, pts: r.pts, miles: r.miles, minutes: r.minutes, approximate: !!r.approximate }) }
  const demo = (key) => { setHandoff({ kind: 'demo', key }); setTab('record') }
  // Seeded sample routes are shown with the routed loop once it is known, and marked approximate until then.
  useEffect(() => {
    if (!p || !p.routes) return
    p.routes.forEach((k) => { if (!ROUTES[k]) return; setDemoR((d) => (d[k] ? d : { ...d, [k]: peekDemoRoute(k) })); resolveDemoRoute(k).then((v) => { if (alive.current && v) setDemoR((d) => ({ ...d, [k]: v })) }) })
  }, [p && p.id])

  // Loop from the person's own location. The tap asks for the location; nothing falls back to a default place.
  const loopFromHere = () => { clearLoop(); setDetail({ type: 'here' }); if (snap === 'peek') setSnap('half'); here.fromHere(2) }
  const hl = here.loop
  useEffect(() => { if (hl && hl.from === 'you' && hl.at && hl.status === 'routing') { setUser(hl.at); goTo(hl.at, 15) } }, [hl && hl.status, hl && hl.at])
  const walkHere = () => { const r = hl.route; handoff({ name: `${r.miles.toFixed(1)} mi loop from ${hl.from === 'you' ? 'here' : 'the map area'}`, place: hl.from === 'you' ? 'Loop from here' : 'Loop from the map area', pts: r.pts, miles: r.miles, minutes: r.minutes, approximate: !!r.approximate }) }

  // Route builder. Every change routes through all the waypoints again. A newer change aborts the
  // request before it and its answer is ignored.
  // wpsRef holds the newest waypoints, so two quick taps both count even before React has rendered the first.
  const reroute = async (wps) => {
    const id = ++bReq.current
    wpsRef.current = wps
    if (bCtl.current) bCtl.current.abort()
    if (wps.length < 2) { setB((s) => ({ ...s, wps, route: null, status: 'idle', fit: false })); return }
    const ctl = new AbortController(); bCtl.current = ctl
    setB((s) => ({ ...s, wps, status: 'loading', fit: false }))
    const route = await routeThrough(wps, { signal: ctl.signal })
    if (!alive.current || id !== bReq.current) return
    setB((s) => ({ ...s, route, status: 'ready' }))
  }
  const startBuild = () => {
    closeDetail(); setAdd(null); setHi(null); setLayersOpen(false); setB((s) => ({ ...s, on: true })); if (snap !== 'half') setSnap('half')
    // Street level, so taps land on individual paths rather than whole neighbourhoods.
    const x = bounds.current
    if (x && x.zoom < BUILD_ZOOM && b.wps.length === 0) goTo(x.center, BUILD_ZOOM)
  }
  const addPoint = (at) => {
    const cur = wpsRef.current
    if (cur.length >= MAX_WAYPOINTS) { setToast(`A route can have up to ${MAX_WAYPOINTS} points.`); return }
    if (samePt(cur[cur.length - 1], at)) return
    reroute([...cur, at])
  }
  const undo = () => reroute(wpsRef.current.slice(0, -1))
  const clearBuild = () => { setRname(''); reroute([]) }
  const closed = b.wps.length > 2 && samePt(b.wps[0], b.wps[b.wps.length - 1])
  const backToStart = () => { if (b.wps.length > 1 && !closed) addPoint(b.wps[0]) }
  const cancelBuild = () => { bReq.current++; if (bCtl.current) bCtl.current.abort(); wpsRef.current = []; setB(NO_BUILD); setRname(''); setDel(null) }
  const doneBuild = () => { setB((s) => ({ ...s, on: false })); setDel(null) }
  const built = b.status === 'ready' && b.route && b.route.pts.length > 1 && b.route.miles > 0 ? b.route : null
  const builtName = () => rname.trim() || `${built.miles.toFixed(1)} mi route`
  const walkBuilt = () => handoff({ name: builtName(), place: rname.trim() || 'Custom route', pts: built.pts, miles: built.miles, minutes: built.minutes, approximate: !!built.approximate })
  const keep = (route, name) => {
    const r = saveRoute(route, name)
    setSaved(r.list)
    setToast(r.ok ? (r.list.length >= MAX_SAVED ? `Route saved. Trot keeps your newest ${MAX_SAVED}.` : 'Route saved') : 'This browser would not store the route.')
  }
  const saveBuilt = () => { keep({ ...built, waypoints: b.wps }, builtName()); setShowSaved(true) }
  const loadSaved = (s) => {
    bReq.current++; if (bCtl.current) bCtl.current.abort()
    closeDetail(); setRname(s.name); wpsRef.current = s.waypoints
    setB({ on: true, wps: s.waypoints, route: s, status: 'ready', fit: true })
  }
  const removeSaved = (s) => {
    if (del !== s.id) { setDel(s.id); return }
    const r = deleteSavedRoute(s.id)
    setSaved(r.list); setDel(null); setToast(r.ok ? `Deleted ${s.name}` : 'This browser would not update saved routes.')
    if (detail && detail.type === 'saved' && detail.id === s.id) setDetail(null)
  }
  const walkLine = (x, extra) => handoff({ name: x.name, place: x.name, pts: x.pts, miles: x.miles, minutes: x.minutes || walkMinutes(x.miles), approximate: !!x.approximate, ...extra })

  // Community places. Reading works signed out. Adding and confirming need an account.
  const startAdd = () => { closeDetail(); setHi(null); setLayersOpen(false); if (snap !== 'half') setSnap('half'); setAdd({ at: null, name: '', category: filter !== 'all' && COMMUNITY_KIND[filter] ? filter : 'bar', note: '', busy: false, error: '', tried: false, signedOut: !hasToken() }) }
  const addErrs = add ? validateNewPlace(add) : {}
  const submitAdd = async (e) => {
    e.preventDefault()
    if (Object.keys(addErrs).length) { setAdd((a) => ({ ...a, tried: true })); return }
    setAdd((a) => ({ ...a, busy: true, error: '' }))
    try {
      const r = await api.places.add({ name: add.name.trim(), category: add.category, lat: add.at[0], lng: add.at[1], note: add.note.trim() })
      const [made] = normalizeCommunity([r && r.place])
      if (!alive.current) return
      if (made) { setComm((c) => [made, ...c.filter((x) => x.id !== made.id)]); if (!layers.community) setLayer('community', true); setHi(made.id); setDetail({ type: 'place', id: made.id }) }
      setAdd(null); setToast('Place added. Thank you.')
    } catch (err) { if (alive.current) setAdd((a) => a && ({ ...a, busy: false, error: (err && err.message) || 'That did not save. Try again.' })) }
  }
  const [confirming, setConfirming] = useState(false)
  const [act, setAct] = useState(null) // claim, report or edit form for the open place: { type, id, busy, error, ...fields }
  const toggleConfirm = async (x) => {
    if (confirming) return
    setConfirming(true)
    try {
      const r = await (x.confirmed ? api.places.unconfirm(x.cid) : api.places.confirm(x.cid))
      // Confirming is also what moves "Last checked" to today.
      if (alive.current && r) setComm((c) => c.map((y) => (y.id === x.id ? { ...y, confirmations: Math.max(0, Number(r.confirmations) || 0), confirmed: !!r.confirmed, ...(r.confirmed ? { lastCheckedAt: new Date().toISOString() } : {}) } : y)))
    } catch (err) { setToast((err && err.message) || 'That did not save. Try again.') }
    if (alive.current) setConfirming(false)
  }

  // Ownership: claim a listing, report a problem, and for the approved manager, edit it. All three need an
  // account. In the demo, or signed out, the tap explains that and nothing is sent.
  const canAct = !!account && hasToken()
  const NEED = { claim: 'Claiming a place', report: 'Reporting a problem', edit: 'Editing a listing' }
  const startAct = (type, x) => {
    if (!canAct) { setToast(`${NEED[type]} needs your own Trot account. Create a page for your dog first.`); setAct({ type: 'need', what: type, id: x.id }); return }
    const base = { type, id: x.id, busy: false, error: '', tried: false }
    if (type === 'claim') setAct({ ...base, role: claimRolesFor(x.category)[0], email: '', message: '' })
    else if (type === 'report') setAct({ ...base, reason: '', note: '' })
    else setAct({ ...base, dogPolicy: x.dogPolicy || 'unknown', note: x.note || '', amenities: x.amenities || [], eventNote: x.eventNote || '', website: x.ownerSite || '' })
  }
  const actErrs = !act ? {} : act.type === 'claim' ? (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(act.email.trim()) ? {} : { email: 'Type an email where we can reach you about this claim.' })
    : act.type === 'report' ? (act.reason ? {} : { reason: 'Pick what is wrong.' })
    : act.type === 'edit' ? (act.website.trim() && !/^https:\/\/[^\s]+\.[^\s]+$/i.test(act.website.trim()) ? { website: 'The website has to start with https://' } : {}) : {}
  const submitAct = async (e, x) => {
    e.preventDefault()
    if (!act || act.busy) return
    if (Object.keys(actErrs).length) { setAct({ ...act, tried: true }); return }
    setAct({ ...act, busy: true, error: '' })
    const patch = (more) => setComm((c) => c.map((y) => (y.id === x.id ? { ...y, ...more } : y)))
    try {
      if (act.type === 'claim') { await api.places.claim(x.cid, { role: act.role, contactEmail: act.email.trim(), message: act.message.trim() }); if (!alive.current) return; patch({ myClaim: 'pending' }); setToast('Claim sent. We review claims by hand.') }
      else if (act.type === 'report') { const r = await api.places.report(x.cid, { reason: act.reason, note: act.note.trim() }); if (!alive.current) return; patch({ reported: true, ...(r && r.flagged ? { flagged: true } : {}) }); setToast('Report sent. Thank you.') }
      else {
        const r = await api.places.update(x.cid, { dogPolicy: act.dogPolicy, note: act.note.trim(), amenities: act.amenities, eventNote: act.eventNote.trim(), website: act.website.trim() })
        const [made] = normalizeCommunity([r && r.place])
        if (!alive.current) return
        // Only what the manager can change is taken from the answer, so what the map added to the place stays.
        if (made) patch({ note: made.note, dogPolicy: made.dogPolicy, amenities: made.amenities, eventNote: made.eventNote, website: made.website, ownerSite: made.website, lastCheckedAt: made.lastCheckedAt })
        setToast('Listing updated')
      }
      setAct(null)
    } catch (err) { if (alive.current) setAct((a) => a && ({ ...a, busy: false, error: (err && err.message) || 'That did not save. Try again.' })) }
  }

  // Sheet height: three snap points, dragged by the handle or stepped with it from the keyboard.
  const snapH = { peek: 108, half: Math.max(220, Math.round(H * 0.44)), full: Math.max(260, Math.round(H * 0.86)) }
  const stepSnap = (dir) => setSnap((s) => SNAPS[Math.max(0, Math.min(2, SNAPS.indexOf(s) + dir))])
  const grab = {
    onPointerDown: (e) => { drag.current = { y: e.clientY, h: sheetEl.current ? sheetEl.current.offsetHeight : snapH[snap], moved: false }; try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {} },
    onPointerMove: (e) => { const d = drag.current; if (!d) return; const dy = d.y - e.clientY; if (Math.abs(dy) > 6) d.moved = true; if (d.moved) setDragH(Math.max(80, Math.min(snapH.full, d.h + dy))) },
    onPointerUp: (e) => {
      const d = drag.current; drag.current = null
      if (!d || !d.moved) return
      const h = Math.max(80, Math.min(snapH.full, d.h + d.y - e.clientY))
      setSnap(SNAPS.reduce((best, s) => (Math.abs(snapH[s] - h) < Math.abs(snapH[best] - h) ? s : best), 'peek')); setDragH(null); skipClick.current = true
    },
    onPointerCancel: () => { drag.current = null; setDragH(null) },
    onClick: () => { if (skipClick.current) { skipClick.current = false; return } setSnap((s) => SNAPS[(SNAPS.indexOf(s) + 1) % 3]) },
    onKeyDown: (e) => { if (e.key === 'ArrowUp') { e.preventDefault(); stepSnap(1) } else if (e.key === 'ArrowDown') { e.preventDefault(); stepSnap(-1) } },
  }

  const ready = loop && loop.status === 'ready'
  const pa = act && p && act.id === p.id ? act : null // the form that belongs to the open place
  // What the sheet shows in place of the list. A detail whose subject has gone (a new area, a deleted route) falls back to the list.
  const dk = b.on || add ? null : p ? 'place' : trail ? 'trail' : savedOne ? 'saved' : hereOn && here.loop ? 'here' : null
  const cat = filter === 'all' || filter === 'trails' ? null : CAT[filter]
  const grp = filter === 'park' ? parks : more // the request a category chip depends on
  const needsDogTag = filter === 'bar' || filter === 'cafe'
  const hasRoute = b.wps.length > 0
  const firstLoad = parks.status !== 'done'
  const updating = parks.updating || more.updating || parks.status === 'loading' || more.status === 'loading'
  const summary = parks.sample ? '' : areaSummary(all, areaLabel, !!user && haversine(user, origin) < 3)
  const mapRoute = hasRoute ? (b.route && b.route.pts.length > 1 ? b.route.pts : undefined) : trail ? trail.pts : savedOne ? savedOne.pts : hereOn && hl && hl.route ? hl.route.pts : ready ? loop.route.pts : undefined
  const lines = useMemo(() => (b.on || add ? [] : [
    ...(layers.trails ? trailList.filter((x) => !trail || x.id !== trail.id).map((x) => ({ id: 'trail:' + x.id, pts: x.pts, kind: 'trail' })) : []),
    ...(layers.saved ? saved.filter((x) => !savedOne || x.id !== savedOne.id).map((x) => ({ id: 'saved:' + x.id, pts: x.pts, kind: 'saved' })) : []),
  ]), [layers.trails, layers.saved, trailList, saved, trail && trail.id, savedOne && savedOne.id, b.on, !!add])
  const bHint = b.wps.length >= MAX_WAYPOINTS ? 'That is the most points one route can have.' : b.wps.length === 0 ? 'Tap the map to drop your first point.' : b.wps.length === 1 ? 'Tap again and Trot routes between the points.' : b.status === 'loading' ? 'Routing on mapped paths' : `${b.wps.length} points · ${built && built.approximate ? 'approximate, straight lines' : 'routed on mapped paths'}`
  const listHead = parks.sample ? 'Sample dog places' : cat ? cat.label : places.length ? `${places.length} dog ${places.length === 1 ? 'place' : 'places'}` : firstLoad || updating ? 'Dog places' : parks.failed ? 'No places to show' : 'Nothing mapped here yet'
  const listMeta = cat
    ? (places.length ? `${places.length} on the map here${user ? ', nearest first' : ''}${parks.sample ? ' · demo data, not live' : ''}` : grp.status !== 'done' || grp.updating ? '' : grp.failed ? 'These could not be loaded just now.' : cat.empty + '.' + (needsDogTag ? ' A place only shows here when OpenStreetMap says dogs are allowed, and few are tagged so far.' : ''))
    : parks.sample ? 'Demo data, not live' : places.length ? `From OpenStreetMap${comm.length && layers.community ? ' and Trot members' : ''}${user ? ', nearest first' : ''}` : firstLoad || updating ? '' : parks.failed ? 'Try again, move the map or search another place.' : 'No dog places in this area on OpenStreetMap. Move the map, search a city or try Near me.'
  const sheetStyle = { height: (dragH != null ? dragH : snapH[snap]) + 'px' }
  const directions = (at) => `https://www.google.com/maps/dir/?api=1&destination=${at[0].toFixed(6)},${at[1].toFixed(6)}`
  const hereNote = (l) => (l.from === 'you' ? 'starts where you are' : 'starts at the middle of the map, not your location')

  return (
    <div className="fill" ref={rootRef}>
      <TrotMap wheel="always" heat={layers.heat && !b.on && !add} pins={pins} selected={p ? p.id : hi} focus={focus} onPin={pinTap} onTap={b.on ? addPoint : add ? (at) => setAdd((a) => a && ({ ...a, at })) : undefined} waypoints={hasRoute ? b.wps : undefined} drop={add ? add.at : undefined} lines={lines} onLine={openLine} fit={!b.on || b.fit} route={mapRoute} me={user} view={view} top={topH + 16} bottom={sheetH} onMove={onMove} onUserMove={() => { touched.current = true }} className="abs" />
      <div className="over topbar" ref={topRef}>
        {b.on || add ? <div className="mbar"><div className="pill bhint">{b.on ? 'Tap the map to add points' : 'Tap the map to drop the pin'}</div></div> : (<>
          <PlaceSearch near={() => (bounds.current && bounds.current.center) || origin} onChoose={(r) => choose(r.at, r.name)} />
          <div className="chips"><button className={`chip ${filter === 'all' ? 'on' : ''}`} aria-pressed={filter === 'all'} onClick={() => pickFilter('all')}>All</button>{CHIPS.map((c) => <button key={c.id} className={`chip ${filter === c.id ? 'on' : ''}`} aria-pressed={filter === c.id} onClick={() => pickFilter(c.id)}>{c.label}</button>)}<button className={`chip ${filter === 'trails' ? 'on' : ''}`} aria-pressed={filter === 'trails'} onClick={() => pickFilter('trails')}>Trails</button></div>
          <div className="mbar">
            {moved && <button className="mbtn" onClick={searchHere}>Search this area</button>}
            <label className="jump end"><span className="sr">Jump to a city</span><select value="" onChange={(e) => { const j = JUMPS.find((x) => x.name === e.target.value); if (j) choose(j.at, j.name) }}><option value="" disabled>Jump to</option>{JUMPS.map((j) => <option key={j.name} value={j.name}>{j.name}</option>)}</select></label>
            <button className="mbtn light" onClick={nearMe} disabled={locating}>{locating ? <span className="spin" aria-hidden="true" /> : <Target />}Near me</button>
          </div>
        </>)}
      </div>
      {!b.on && !add && (
        <div className="layerbox" style={{ top: topH + 8 }}>
          <button className="layerbtn" aria-expanded={layersOpen} aria-controls="layer-panel" onClick={() => setLayersOpen(!layersOpen)}><Stack />Layers</button>
          {layersOpen && (
            <div className="layerpanel" id="layer-panel">
              <fieldset><legend>Show on the map</legend>
                {LAYER_LABELS.filter(([k]) => k !== 'community' || communityOn()).map(([k, label]) => <label key={k} className="lrow"><input type="checkbox" checked={!!layers[k]} onChange={(e) => setLayer(k, e.target.checked)} /><span>{label}</span></label>)}
              </fieldset>
              <div className="legend" aria-label="Legend">
                <b>What the pins mean</b>
                {CATEGORIES.filter((c) => c.id !== 'other').map((c) => <div key={c.id} className="lg"><CatDot c={c.id} />{c.id === 'bar' ? 'Bars and patios tagged for dogs' : c.id === 'cafe' ? 'Cafes and food tagged for dogs' : c.label}</div>)}
                {communityOn() && <div className="lg"><CatDot c="other" community />Square pin: added by a Trot member</div>}
                <div className="lg"><span className="swatch trail" />Trail from OpenStreetMap</div>
                <div className="lg"><span className="swatch saved" />Your saved route</div>
                <div className="lg"><span className="swatch heat" />Heatmap: where dogs have walked</div>
              </div>
            </div>
          )}
        </div>
      )}
      <div className={`sheet snap ${dragH != null ? 'dragging' : ''}`} ref={setSheet} style={sheetStyle} data-snap={snap}>
        <button className="grabbtn" aria-label={`Resize the panel. It is at ${snap} height. Up and down arrows change it.`} {...grab}><span className="grab" /></button>
        {b.on && (<>
          <div className="row between top g10">
            <div className="grow"><h2>Build a route</h2><div className="meta" role="status">{bHint}</div></div>
            <div className="dist"><b>{(built ? built.miles : 0).toFixed(2)} mi</b><span>{built ? `about ${built.minutes} min` : 'no route yet'}</span></div>
            <button className="round" aria-label="Cancel route" onClick={cancelBuild}><Ic n="x" s={18} /></button>
          </div>
          <div className="loops">
            <button className="chip flat" disabled={!hasRoute} onClick={undo}>Undo</button>
            <button className="chip flat" disabled={!hasRoute} onClick={clearBuild}>Clear</button>
            <button className="chip flat" disabled={b.wps.length < 2 || closed || b.wps.length >= MAX_WAYPOINTS} onClick={backToStart}>Back to start</button>
          </div>
          {built && built.approximate && <div className="mnote"><span className="grow"><b>Approximate route.</b> The routing service did not answer, so these are straight lines between your points, not walkable paths.</span><button onClick={() => reroute(b.wps)}>Retry</button></div>}
          <div className="saverow">
            <label className="field lightf grow"><span>Route name</span><input value={rname} maxLength={60} placeholder={built ? `${built.miles.toFixed(1)} mi route` : 'Morning loop'} onChange={(e) => setRname(e.target.value)} /></label>
            <button className="cta bordered small" disabled={!built} onClick={saveBuilt}>Save route</button>
          </div>
          <div className="row g10 nowrap"><button className="cta white bordered small" onClick={doneBuild}>Done</button><button className="cta grow" disabled={!built} onClick={walkBuilt}>Walk {dn} here</button></div>
          <button className="stoggle" aria-expanded={showSaved} onClick={() => setShowSaved(!showSaved)}>Saved routes ({saved.length})</button>
          {showSaved && saved.length === 0 && <div className="meta">No saved routes yet. Build one and tap Save route.</div>}
          {showSaved && saved.map((s) => (
            <div key={s.id} className="srow">
              <button className="rrow" onClick={() => loadSaved(s)}><span className="ricon"><Ic n="map" s={20} c="#1F5AE8" /></span><span className="grow"><b>{s.name}</b><small>about {s.minutes} min{s.trail ? ' · OpenStreetMap trail' : s.approximate ? ' · approximate' : ''}</small></span><span className="num">{s.miles.toFixed(1)} mi</span></button>
              <button className={`sdel ${del === s.id ? 'sure' : ''}`} aria-label={`${del === s.id ? 'Confirm delete' : 'Delete'} ${s.name}`} onClick={() => removeSaved(s)}>{del === s.id ? 'Delete?' : <Ic n="x" s={16} />}</button>
            </div>
          ))}
        </>)}
        {!b.on && add && (
          <form className="addform" onSubmit={submitAdd} noValidate>
            <div className="row between top g10"><div className="grow"><h2>Add a place</h2><div className="meta">Only add places where you know dogs are welcome. Other Trot members can confirm it.</div></div><button type="button" className="round" aria-label="Cancel adding a place" onClick={() => setAdd(null)}><Ic n="x" s={18} /></button></div>
            {add.signedOut ? <div className="mnote info"><span className="grow"><b>Create a page to add places.</b> Adding and confirming places needs your own Trot page, so each one has a name behind it.</span></div> : (<>
              <div className={`meta ${add.tried && addErrs.pin ? 'ferr' : ''}`} role={add.tried && addErrs.pin ? 'alert' : undefined}>{add.at ? 'Pin dropped. Tap the map again to move it.' : add.tried ? addErrs.pin : 'Tap the map where the place is.'}</div>
              <label className="field lightf"><span>Name</span><input value={add.name} maxLength={90} aria-invalid={!!(add.tried && addErrs.name)} aria-describedby="add-name-err" onChange={(e) => setAdd({ ...add, name: e.target.value })} />{add.tried && addErrs.name && <em id="add-name-err" className="ferr" role="alert">{addErrs.name}</em>}</label>
              <label className="field lightf"><span>Category</span><select value={add.category} onChange={(e) => setAdd({ ...add, category: e.target.value })}>{Object.entries(COMMUNITY_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="field lightf"><span>Note (optional) · {add.note.length}/280</span><textarea value={add.note} rows={2} aria-invalid={!!addErrs.note} aria-describedby="add-note-err" placeholder="Water bowls on the patio, dogs inside too" onChange={(e) => setAdd({ ...add, note: e.target.value })} />{addErrs.note && <em id="add-note-err" className="ferr" role="alert">{addErrs.note}</em>}</label>
              {add.error && <div className="mnote" role="alert"><span className="grow">{add.error}</span></div>}
              <button className="cta" type="submit" disabled={add.busy}>{add.busy ? 'Adding' : 'Add place'}</button>
            </>)}
          </form>
        )}
        {dk === 'here' && (<>
          <div className="row between top g10">
            <div className="grow"><h2>Loop from here</h2><div className="meta" role="status">{hl.status === 'locating' ? 'Finding you' : hl.status === 'routing' ? 'Building the loop on mapped paths' : hl.status === 'nofix' ? 'No location' : `${hl.route.approximate ? 'Approximate' : 'Routed on mapped paths'} · ${hereNote(hl)}`}</div></div>
            {hl.status === 'ready' && <div className="dist"><b>{hl.route.miles.toFixed(2)} mi</b><span>about {hl.route.minutes} min</span></div>}
            <button className="round" aria-label="Close loop" onClick={closeDetail}><Ic n="x" s={18} /></button>
          </div>
          {(hl.status === 'locating' || hl.status === 'routing') && <div className="mload" role="status"><span className="spin" aria-hidden="true" />{hl.status === 'locating' ? 'Finding you' : `Building a ${hl.miles} mile loop`}</div>}
          {hl.status === 'nofix' && <div className="mnote" role="alert"><span className="grow">{locationHelp(hl.reason)}</span><button onClick={() => here.fromHere(hl.miles)}>Try again</button></div>}
          {hl.status === 'nofix' && <button className="cta white bordered small wide" onClick={() => here.fromCenter((bounds.current && bounds.current.center) || origin)}>Build it from the middle of the map instead</button>}
          <div className="loops" role="group" aria-label="Loop length">{LOOPS.map((m) => <button key={m} className={`chip flat ${hl.miles === m ? 'on' : ''}`} aria-pressed={hl.miles === m} disabled={hl.status === 'locating' || hl.status === 'routing'} onClick={() => here.setMiles(m)}><b>{m}</b> mi</button>)}</div>
          {hl.status === 'ready' && hl.from !== 'you' && <div className="mnote info"><span className="grow">This loop starts at the middle of the map, not at your location.</span></div>}
          {hl.status === 'ready' && hl.route.approximate && <div className="mnote"><span className="grow"><b>Approximate loop.</b> The routing service did not answer, so this is a simple circle, not a walkable path.</span><button onClick={() => here.setMiles(hl.miles)}>Retry</button></div>}
          {hl.status === 'ready' && <div className="row g10 nowrap"><button className="cta white bordered small" onClick={here.another}>Try another loop</button><button className="cta grow" onClick={walkHere}>Walk {dn} here</button></div>}
        </>)}
        {dk === 'trail' && (<>
          <div className="row between top g10">
            <div className="grow"><h2>{trail.name}</h2><div className="meta">{trail.kind} from OpenStreetMap{trail.partial ? ' · partial' : ''}</div></div>
            <div className="dist"><b>{trail.miles.toFixed(1)} mi</b><span>{user ? fmtDist(nearestMiles(user, trail.pts)) + ' from you' : 'measured on the map'}</span></div>
            <button className="round" aria-label="Back to trails" onClick={closeDetail}><Ic n="x" s={18} /></button>
          </div>
          {trail.labels.length > 0 && <div className="tags">{trail.labels.map((t) => <span key={t}>{t}</span>)}</div>}
          {trail.partial && <div className="mnote info"><span className="grow"><b>Partial.</b> The mapped pieces of this trail do not all join up here, so this is the longest continuous stretch, not the whole trail.</span></div>}
          <div className="meta">One way, about {walkMinutes(trail.miles)} min at {dn}'s pace. The length is measured from the line shown. Check signs on the ground for dog rules.</div>
          <div className="row g10 nowrap"><button className="cta white bordered small" onClick={() => keep({ pts: trail.pts, miles: trail.miles, minutes: walkMinutes(trail.miles), waypoints: [trail.pts[0], trail.pts[trail.pts.length - 1]], trail: true }, trail.name)}>Save route</button><button className="cta grow" onClick={() => walkLine(trail, { trail: true, approximate: false })}>Walk {dn} here</button></div>
          <a className="osmlink" href={`https://www.openstreetmap.org/${trail.osm.type}/${trail.osm.id}`} target="_blank" rel="noopener noreferrer">View on OpenStreetMap</a>
        </>)}
        {dk === 'saved' && (<>
          <div className="row between top g10">
            <div className="grow"><h2>{savedOne.name}</h2><div className="meta">Saved route · {savedOne.trail ? 'trail from OpenStreetMap' : savedOne.approximate ? 'approximate, not a mapped path' : 'routed on mapped paths'}</div></div>
            <div className="dist"><b>{savedOne.miles.toFixed(1)} mi</b><span>about {savedOne.minutes} min</span></div>
            <button className="round" aria-label="Close saved route" onClick={closeDetail}><Ic n="x" s={18} /></button>
          </div>
          <button className="cta" onClick={() => walkLine(savedOne, { trail: !!savedOne.trail })}>Walk {dn} here</button>
          <div className="row g10 nowrap"><button className="cta white bordered small grow" onClick={() => loadSaved(savedOne)}>Edit in the route builder</button><button className={`sdel ${del === savedOne.id ? 'sure' : ''}`} aria-label={`${del === savedOne.id ? 'Confirm delete' : 'Delete'} ${savedOne.name}`} onClick={() => removeSaved(savedOne)}>{del === savedOne.id ? 'Delete?' : <Ic n="x" s={16} />}</button></div>
        </>)}
        {dk === 'place' && (<>
          <div className="row between top g10">
            <div className="grow"><h2>{p.name}</h2><div className="meta">{p.kind}{p.sample ? ' · sample place' : ''}</div></div>
            {p.d != null && <div className="dist"><b>{fmtDist(p.d)}</b><span>from you</span></div>}
            <button className="round" aria-label="Back to list" onClick={closeDetail}><Ic n="x" s={18} /></button>
          </div>
          {p.community && (<>
            <div className="mnote info"><span className="grow"><b>{communityLine(p)}.</b> {p.curated ? 'This comes from a public listing of dog-friendly places, not from OpenStreetMap. Rules change, so check before you go.' : 'This comes from Trot members, not from OpenStreetMap.'}</span></div>
            {p.flagged && <div className="mnote" role="note"><span className="grow"><b>Several people reported a problem here.</b> It may have closed or stopped welcoming dogs. Check before you go.</span></div>}
            <div className="pown"><b>{maintainedLine(p)}</b><span>{checkedLine(p)}</span></div>
            {p.address && !(p.details || []).some((r) => r.label === 'Address') && <div className="meta">{p.address}</div>}
            {p.note && <p className="pnote">{p.note}</p>}
            {(p.dogPolicy !== 'unknown' || p.amenities.length > 0) && <div className="tags own" aria-label="Dog policy and amenities">{p.dogPolicy !== 'unknown' && <span className="pol">{DOG_POLICY[p.dogPolicy]}</span>}{p.amenities.map((k) => <span key={k}>{AMENITY[k]}</span>)}</div>}
            {p.eventNote && <p className="pnote"><b>Events:</b> {p.eventNote}</p>}
            {hasToken() ? <button className={`cta ${p.confirmed ? '' : 'white bordered'}`} aria-pressed={p.confirmed} disabled={confirming} onClick={() => toggleConfirm(p)}>{p.confirmed ? 'Dogs welcome here · you confirmed' : 'Dogs welcome here'}</button> : <div className="meta">Create a page to confirm places.</div>}
          </>)}
          {(p.chips || p.tags).length > 0 && <div className="tags">{(p.chips || p.tags).map((t) => <span key={t}>{t}</span>)}</div>}
          {p.details && p.details.length > 0 && <dl className="pinfo">{p.details.map((r) => <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}</dl>}
          <div className="plinks">{p.website && <a href={p.website} target="_blank" rel="noopener noreferrer">Website</a>}{p.phone && <a href={'tel:' + p.phone.replace(/[^\d+]/g, '')}>Call {p.phone}</a>}{p.sourceUrl && <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer">Source</a>}<a href={directions(p.at)} target="_blank" rel="noopener noreferrer">Directions</a><a href={googleMapsUrl(p)} target="_blank" rel="noopener">Open in Google Maps</a></div>
          {p.community && (<>
            <div className="pacts">
              {p.managedByYou ? <button className="cta bordered small" aria-expanded={pa && pa.type === 'edit'} onClick={() => startAct('edit', p)}>Edit listing</button> : !p.managedBy && p.myClaim !== 'pending' && <button className="cta bordered small" aria-expanded={pa && (pa.type === 'claim' || pa.what === 'claim')} onClick={() => startAct('claim', p)}>Claim this place</button>}
              {!p.reported && <button className="cta white bordered small" aria-expanded={pa && (pa.type === 'report' || pa.what === 'report')} onClick={() => startAct('report', p)}>Report a problem</button>}
            </div>
            {p.myClaim === 'pending' && <div className="mnote info" role="status"><span className="grow"><b>Claim sent.</b> We review claims by hand.</span></div>}
            {p.reported && <div className="mnote info" role="status"><span className="grow"><b>Report sent.</b> The Trot team will take a look.</span></div>}
            {pa && pa.type === 'need' && <div className="mnote info" role="status"><span className="grow"><b>Create an account first.</b> {NEED[pa.what]} needs your own Trot page, so there is a name behind it.</span><button onClick={() => setAct(null)}>OK</button></div>}
            {pa && pa.type === 'claim' && (
              <form className="addform actform" onSubmit={(e) => submitAct(e, p)} noValidate>
                <div className="eyebrow dark">CLAIM THIS PLACE</div>
                <div className="meta">Whoever maintains a listing keeps its dog policy up to date. We check each claim by hand before it shows.</div>
                <fieldset className="radios"><legend className="sr">How are you connected to this place?</legend>{claimRolesFor(p.category).map((r) => <label key={r} className="lrow"><input type="radio" name="claim-role" checked={pa.role === r} onChange={() => setAct({ ...pa, role: r })} /><span>{CLAIM_ROLE[r]}</span></label>)}</fieldset>
                <label className="field lightf"><span>Contact email</span><input type="email" value={pa.email} maxLength={254} autoComplete="email" inputMode="email" aria-invalid={!!(pa.tried && actErrs.email)} aria-describedby="claim-email-err" onChange={(e) => setAct({ ...pa, email: e.target.value })} />{pa.tried && actErrs.email && <em id="claim-email-err" className="ferr" role="alert">{actErrs.email}</em>}</label>
                <label className="field lightf"><span>Message (optional) · {pa.message.length}/500</span><textarea value={pa.message} rows={2} maxLength={500} placeholder="Your role here, and the best way to check it" onChange={(e) => setAct({ ...pa, message: e.target.value })} /></label>
                {pa.error && <div className="mnote" role="alert"><span className="grow">{pa.error}</span></div>}
                <div className="row g10 nowrap"><button className="cta white bordered small" type="button" onClick={() => setAct(null)} disabled={pa.busy}>Cancel</button><button className="cta grow" type="submit" disabled={pa.busy}>{pa.busy ? 'Sending' : 'Send claim'}</button></div>
              </form>
            )}
            {pa && pa.type === 'report' && (
              <form className="addform actform" onSubmit={(e) => submitAct(e, p)} noValidate>
                <div className="eyebrow dark">REPORT A PROBLEM</div>
                <fieldset className="radios" aria-describedby="report-reason-err"><legend className="sr">What is wrong with this listing?</legend>{REPORT_REASONS.map(([k, label]) => <label key={k} className="lrow"><input type="radio" name="report-reason" checked={pa.reason === k} onChange={() => setAct({ ...pa, reason: k })} /><span>{label}</span></label>)}</fieldset>
                {pa.tried && actErrs.reason && <em id="report-reason-err" className="ferr" role="alert">{actErrs.reason}</em>}
                <label className="field lightf"><span>Note (optional) · {pa.note.length}/280</span><textarea value={pa.note} rows={2} maxLength={280} placeholder="What did you see?" onChange={(e) => setAct({ ...pa, note: e.target.value })} /></label>
                {pa.error && <div className="mnote" role="alert"><span className="grow">{pa.error}</span></div>}
                <div className="row g10 nowrap"><button className="cta white bordered small" type="button" onClick={() => setAct(null)} disabled={pa.busy}>Cancel</button><button className="cta grow" type="submit" disabled={pa.busy}>{pa.busy ? 'Sending' : 'Send report'}</button></div>
              </form>
            )}
            {pa && pa.type === 'edit' && (
              <form className="addform actform" onSubmit={(e) => submitAct(e, p)} noValidate>
                <div className="eyebrow dark">EDIT LISTING</div>
                <label className="field lightf"><span>Dog policy</span><select value={pa.dogPolicy} onChange={(e) => setAct({ ...pa, dogPolicy: e.target.value })}>{Object.entries(DOG_POLICY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label className="field lightf"><span>Note · {pa.note.length}/280</span><textarea value={pa.note} rows={2} maxLength={280} onChange={(e) => setAct({ ...pa, note: e.target.value })} /></label>
                <fieldset className="radios two"><legend>Amenities</legend>{Object.entries(AMENITY).map(([k, v]) => <label key={k} className="lrow"><input type="checkbox" checked={pa.amenities.includes(k)} onChange={(e) => setAct({ ...pa, amenities: e.target.checked ? [...pa.amenities, k] : pa.amenities.filter((a) => a !== k) })} /><span>{v}</span></label>)}</fieldset>
                <label className="field lightf"><span>Events (optional) · {pa.eventNote.length}/140</span><input value={pa.eventNote} maxLength={140} placeholder="Yappy hour, Thursdays 5 to 7" onChange={(e) => setAct({ ...pa, eventNote: e.target.value })} /></label>
                <label className="field lightf"><span>Website (optional)</span><input type="url" inputMode="url" value={pa.website} maxLength={300} placeholder="https://" aria-invalid={!!(pa.tried && actErrs.website)} aria-describedby="edit-site-err" onChange={(e) => setAct({ ...pa, website: e.target.value })} />{pa.tried && actErrs.website && <em id="edit-site-err" className="ferr" role="alert">{actErrs.website}</em>}</label>
                {pa.error && <div className="mnote" role="alert"><span className="grow">{pa.error}</span></div>}
                <div className="row g10 nowrap"><button className="cta white bordered small" type="button" onClick={() => setAct(null)} disabled={pa.busy}>Cancel</button><button className="cta grow" type="submit" disabled={pa.busy}>{pa.busy ? 'Saving' : 'Save listing'}</button></div>
              </form>
            )}
          </>)}
          {p.dogs != null && <div className="meta"><b>{p.dogs}</b> dogs this week (sample figure)</div>}
          {p.top && <div className="topdog"><Av t={p.top[0]} s={32} bg="#C8F031" c="#0F1B2D" /><span><b>{p.top}</b> is top dog here with {p.topVisits} visits this week (sample)</span></div>}
          <div className="eyebrow dark">BUILD A LOOP FROM THIS PLACE</div>
          <div className="loops">{LOOPS.map((m) => <button key={m} className={`chip flat ${loop && loop.miles === m ? 'on' : ''}`} aria-pressed={!!(loop && loop.miles === m)} onClick={() => buildLoop(m)}><b>{m}</b> mi loop</button>)}</div>
          {loop && loop.status === 'loading' && <div className="mload" role="status"><span className="spin" aria-hidden="true" />Routing a {loop.miles} mile loop on real paths</div>}
          {ready && <div className="rsum"><b>{loop.route.miles.toFixed(1)} mi</b><span>about {loop.route.minutes} min at {dn}'s pace · {loop.route.approximate ? 'approximate' : 'routed on mapped paths'}</span></div>}
          {ready && <button className="cta" onClick={walk}>Walk {dn} here</button>}
          {ready && loop.route.approximate && <div className="mnote"><span className="grow"><b>Approximate loop.</b> The routing service did not answer, so this is a simple circle, not a walkable path.</span><button onClick={() => buildLoop(loop.miles)}>Retry</button></div>}
          {p.routes && p.routes.length > 0 && <div className="eyebrow dark">POPULAR ROUTES (DEMO PLAYBACK)</div>}
          {(p.routes || []).filter((k) => ROUTES[k]).map((k) => { const v = demoR[k] || peekDemoRoute(k); return <button key={k} className="rrow" onClick={() => demo(k)}><span className="ricon"><Ic n="map" s={20} c="#1F5AE8" /></span><span className="grow"><b>{ROUTES[k].name}</b><small>{v.approximate ? 'Approximate line, not a mapped path' : 'On mapped paths'} · {ROUTES[k].note}</small></span><span className="num">{v.miles.toFixed(1)} mi</span></button> })}
          {p.osm && <a className="osmlink" href={`https://www.openstreetmap.org/${p.osm.type}/${p.osm.id}`} target="_blank" rel="noopener noreferrer">View on OpenStreetMap</a>}
        </>)}
        {!b.on && !add && !dk && filter === 'trails' && (<>
          <div className="row between top"><div><h2>Trails near here</h2><div className="meta">{!trails || trails.status === 'loading' ? <Updating text="Looking for named trails" /> : trails.error ? 'Trails could not be loaded just now.' : trailList.length ? `${trailList.length} named ${trailList.length === 1 ? 'trail' : 'trails'} and greenways from OpenStreetMap, nearest to the middle of the map first` : 'No named trails of 0.3 miles or more are mapped here on OpenStreetMap yet.'}</div></div></div>
          {trails && trails.status === 'done' && trails.error && <div className="mnote"><span className="grow">Nothing is shown rather than guessed.</span><button onClick={() => { trailsFor.current = 0; loadTrails() }}>Retry</button></div>}
          {trails && trails.clamped && <div className="mnote info"><span className="grow">Showing trails near the middle of the map. Zoom in and search this area for others.</span></div>}
          {trailList.map((x) => <button key={x.id} className="rrow" onClick={() => openLine('trail:' + x.id)}><span className="ricon"><Ic n="map" s={20} c="#1F5AE8" /></span><span className="grow"><b>{x.name}</b><small>{[x.kind, ...x.labels.slice(0, 2), x.partial ? 'partial' : ''].filter(Boolean).join(' · ')}</small></span><span className="num">{x.miles.toFixed(1)} mi</span></button>)}
        </>)}
        {!b.on && !add && !dk && filter !== 'trails' && (<>
          {(summary || updating) && <div className="asum">{summary && <span>{summary}</span>}{updating && <Updating />}</div>}
          {parks.sample && <div className="mnote"><span className="grow"><b>Showing sample places.</b> Live map data could not be loaded, so these are demo places around Cambridge, MA.</span><button onClick={retry}>Retry</button></div>}
          {parks.failed && <div className={places.length ? 'mnote info' : 'mnote'}><span className="grow">{places.length ? <>Showing listed places. More from OpenStreetMap could not be loaded just now.</> : <><b>Places could not be loaded.</b> The map data service did not answer for this area. Nothing is shown rather than guessed.</>}</span><button onClick={retry}>Retry</button></div>}
          {(parks.refreshFailed || more.refreshFailed) && <div className="mnote info"><span className="grow">Showing places saved from an earlier visit. They could not be refreshed just now.</span><button onClick={retry}>Retry</button></div>}
          {more.failed && !parks.failed && !parks.sample && <div className="mnote info"><span className="grow">Bars, cafes, shops and vets could not be loaded just now. Parks are shown.</span><button onClick={() => { moreFor.current = 0; loadMore(req.current) }}>Retry</button></div>}
          {parks.clamped && <div className="mnote info"><span className="grow">That is a big area. Showing places near the middle of the map. Zoom in to search more closely.</span></div>}
          <div className="row between top"><div><h2>{listHead}</h2>{listMeta && <div className="meta">{listMeta}</div>}</div></div>
          {places.slice(0, MAX_PINS).map((x) => (
            <div key={x.id} className={`prow ${hi === x.id ? 'hi' : ''}`} ref={(n) => { if (n) rows.current.set(x.id, n); else rows.current.delete(x.id) }}>
              <button className="rrow" aria-pressed={hi === x.id} onClick={() => rowTap(x)}><CatDot c={x.category} community={x.community && !x.curated} /><span className="grow"><b>{x.name}{x.community && x.managedBy && <span className="vtag">{verifiedTag(x)}</span>}</b><small>{x.community ? communityLine(x) : x.kind + (x.tags.length ? ' · ' + x.tags.slice(0, 2).join(' · ') : '')}</small>{x.curated && x.note && <small className="rnote">{x.note}</small>}{x.curated && x.address && <small className="rnote dim">{String(x.address).replace(/, NC \d{5}$/, '')}</small>}</span>{x.d != null && <span className="num">{fmtDist(x.d)}</span>}</button>
              {hi === x.id && <button className="cta bordered small" onClick={() => openPlace(x.id)}>Details</button>}
            </div>
          ))}
          {places.length > MAX_PINS && <div className="meta">{places.length - MAX_PINS} more. Zoom in or pick a category to see them.</div>}
          {layers.trails && trails && trails.status === 'done' && trailList.length > 0 && <button className="rrow" onClick={() => pickFilter('trails')}><span className="ricon"><Ic n="map" s={20} c="#1F5AE8" /></span><span className="grow"><b>Trails near here</b><small>Named trails and greenways from OpenStreetMap</small></span><span className="num">{trailList.length}</span></button>}
          <button className="cta wide" onClick={loopFromHere}>Loop from here</button>
          <div className="row g10 nowrap"><button className="cta bordered small grow" onClick={startBuild}>{built ? `Edit your route · ${built.miles.toFixed(1)} mi` : 'Build a route'}</button>{communityOn() && <button className="cta bordered small grow" onClick={startAdd}>Add a place</button>}</div>
        </>)}
      </div>
    </div>
  )
}
