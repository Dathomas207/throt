import React, { useEffect, useMemo, useRef, useState } from 'react'
import TrotMap, { useHeight } from '../Map.jsx'
import { RouteThumb } from '../RouteThumb.jsx'
import { Ic } from '../ui.jsx'
import { suggestRoute, routeLeg, locateNow, locationState, locationHelp, setHandoff, fmtDist, walkMinutes, DEFAULT_CENTER } from '../routing.js'
import * as E from '../routeEdit.js'
import { useRoutes, routeActions, takeBuilderIntent, demoFavorites, demoRecents, linkId } from '../routeStore.js'
import { fetchTrails, bboxAround } from '../osm.js'
import { track, legsBucket } from '../usage.js'
import '../maps.css'

// The route builder. It opens with a suggested route already on the map, which can be changed with the
// quick controls or shaped road by road in edit mode. Favorites and recent routes sit in their own tabs.
// All the editing itself is in src/routeEdit.js; this file is the screen around it.
const MILES = [1, 2, 3, 5]
const SNAPS = ['peek', 'half', 'full']
const NO_PINS = []
const TABS = [['suggested', 'Suggested'], ['favorites', 'Favorites'], ['recent', 'Recent']]
const lastView = () => { try { const v = JSON.parse(localStorage.getItem('trot-view-v2')); if (v && Array.isArray(v.at) && Number.isFinite(v.at[0]) && Number.isFinite(v.at[1])) return v.at } catch (e) {} return null }
const router = (a, b, o) => routeLeg(a, b, o)
const times = (n) => (n > 0 ? `walked ${n} ${n === 1 ? 'time' : 'times'}` : 'not walked yet')
const dayOf = (r) => (r.startedAt ? new Date(r.startedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : r.daysAgo === 0 ? 'Today' : r.daysAgo === 1 ? 'Yesterday' : r.daysAgo > 1 ? `${r.daysAgo} days ago` : '')
const Star = ({ on, s = 22 }) => <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill={on ? '#0F1B2D' : 'none'} stroke="#0F1B2D" strokeWidth="2" strokeLinejoin="round"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17.1 6.600 20l1.100-6.100L3.200 9.600l6.100-.8z" /></svg>

function RouteRow({ r, sub, onOpen, onStar, starLabel }) {
  return (
    <div className="rtrow">
      <button className="rrow" onClick={onOpen}>
        <span className="rthumb"><RouteThumb pts={r.pts} w={120} h={90} /></span>
        <span className="grow"><b>{r.name}{r.usualFor && <span className="vtag">Usual walk</span>}</b><small>{fmtDist(r.miles)} · about {r.minutes || walkMinutes(r.miles)} min · {times(r.timesWalked)}</small>{sub && <small>{sub}</small>}</span>
      </button>
      {onStar && <button className={`starbtn ${r.favorite ? 'on' : ''}`} aria-pressed={!!r.favorite} aria-label={starLabel} onClick={onStar}><Star on={r.favorite} /></button>}
    </div>
  )
}

// account is true on a signed-in person's own screens. dogKey is the dog's address there, and its name in the demo.
export default function RouteBuilder({ setTab, setToast, dogName, dogKey, account, demoActs }) {
  const dn = dogName || 'Biscuit', dog = dogKey || dn
  const intent = useRef(null)
  if (!intent.current) intent.current = takeBuilderIntent() || {}
  const backTo = intent.current.from || 'explore'
  const store = useRoutes(!!account)
  const [tab, setTabSel] = useState(intent.current.tab || 'suggested')
  const [h, setH] = useState(() => E.makeHistory())
  const m = h.present
  const [editing, setEditing] = useState(false)
  const [sel, setSel] = useState(null)
  // The suggested route's settings. status is 'locating' | 'routing' | 'ready'; from is 'you' or 'map'.
  const [sug, setSug] = useState({ miles: 2, shape: 'loop', bearing: 45, at: null, from: null, status: 'locating', approximate: false })
  // What the map is showing: the suggestion, or one particular route from a list (shown.route).
  const [shown, setShown] = useState({ source: 'suggested', route: null, edited: false })
  const [me, setMe] = useState(null)
  const [view, setView] = useState(() => ({ at: intent.current.center || lastView() || DEFAULT_CENTER, zoom: 15, n: 1 }))
  const [fitN, setFitN] = useState(0), [focus, setFocus] = useState(null)
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [locating, setLocating] = useState(false)
  const [rename, setRename] = useState(null), [del, setDel] = useState(false), [msg, setMsg] = useState('')
  const [trails, setTrails] = useState(null)
  const [snap, setSnap] = useState('half'), [dragH, setDragH] = useState(null)
  const [rootRef, H] = useHeight(), [sheetRef, sheetH] = useHeight(), [topRef, topH] = useHeight()
  const sheetEl = useRef(null), drag = useRef(null), skipClick = useRef(false)
  const alive = useRef(true), hRef = useRef(h), sugRef = useRef(sug), ctl = useRef(null), rseq = useRef(0), sctl = useRef(null), sseq = useRef(0), center = useRef(view.at), counted = useRef(false), dirty = useRef(false), tctl = useRef(null)
  hRef.current = h; sugRef.current = sug

  // ---- the router: only pending legs are asked for, and a newer edit cancels the request before it ----
  useEffect(() => {
    const model = h.present
    if (ctl.current) ctl.current.abort()
    if (!E.hasPending(model)) { setBusy(false); return }
    const c = new AbortController(), id = ++rseq.current
    ctl.current = c; setBusy(true)
    E.resolveLegs(model, router, { signal: c.signal }).then((out) => {
      if (!alive.current || id !== rseq.current || hRef.current.present !== model) return
      setH((x) => (x.present === model ? E.replacePresent(x, out) : x)); setBusy(false)
    })
  }, [h.present])

  const suggest = async (p = {}) => {
    const { retry, ...rest } = p, next = { ...sugRef.current, ...rest }
    if (!next.at) return
    const id = ++sseq.current
    if (sctl.current) sctl.current.abort()
    const c = new AbortController(); sctl.current = c
    setSug({ ...next, status: 'routing' }); setShown({ source: 'suggested', route: null, edited: false }); setEditing(false); setSel(null); setMsg(''); setRename(null); setDel(false)
    const r = await suggestRoute(next.at, next.miles, { shape: next.shape, bearing: next.bearing, signal: c.signal, noCache: !!retry })
    if (!alive.current || id !== sseq.current) return
    setH(E.makeHistory({ points: r.points, legs: r.legs })); setSug({ ...next, status: 'ready', approximate: !!r.approximate }); setFitN((n) => n + 1)
    if (!counted.current) { counted.current = true; track('route_built') }
  }
  // A route from a list goes on the map. Its whole line is fetched first when the list only carried a thinned one.
  const openRoute = async (r0, source, o = {}) => {
    sseq.current++
    if (sctl.current) sctl.current.abort()
    const got = await routeActions.full(r0)
    if (!alive.current) return
    if (got.error) { setToast(got.error); return }
    const r = got.route
    if (!r || !r.pts || r.pts.length < 2) return
    const model = r.control ? E.modelFromControl(r.control, r.pts) : E.modelFromControl({ points: [r.pts[0], r.pts[r.pts.length - 1]], modes: ['path'] }, r.pts)
    setH(E.makeHistory(model)); setShown({ source, route: r, edited: false }); setSel(null); setMsg(''); setRename(null); setDel(false); setFitN((n) => n + 1)
    setSug((s) => (s.status === 'ready' ? s : { ...s, status: 'ready' }))
    if (o.edit) beginEdit(model, r); else setEditing(false)
  }
  useEffect(() => {
    alive.current = true
    const it = intent.current
    ;(async () => {
      if (it.open) { openRoute(it.open, it.source || 'favorite', { edit: !!it.edit }); if (it.source === 'recent') setTabSel('recent'); else if (it.source !== 'suggested') setTabSel('favorites') }
      // The location is only used when the browser has already been allowed to share it. Opening this screen never asks.
      const st = await locationState()
      if (!alive.current) return
      if (st === 'granted') {
        const r = await locateNow({ timeoutMs: 6000 })
        if (!alive.current) return
        if (r.at) { setMe(r.at); if (it.open) { setSug((s) => ({ ...s, at: r.at, from: 'you' })); return } setView((v) => ({ at: r.at, zoom: 15, n: v.n + 1 })); suggest({ at: r.at, from: 'you' }); return }
      }
      if (it.open) setSug((s) => ({ ...s, at: center.current, from: 'map' }))
      else suggest({ at: center.current, from: 'map' })
    })()
    return () => { alive.current = false; rseq.current++; sseq.current++; for (const c of [ctl, sctl, tctl]) if (c.current) c.current.abort() }
  }, [])
  // Named trails near the start, already mapped in OpenStreetMap. Looked for once the route itself is up.
  useEffect(() => {
    if (sug.status !== 'ready' || !sug.at || trails) return
    const c = new AbortController(); tctl.current = c
    setTrails({ status: 'loading', list: [] })
    fetchTrails(bboxAround(sug.at, 1.5), { signal: c.signal }).then((r) => { if (alive.current && !r.aborted) setTrails({ status: 'done', list: (r.trails || []).slice(0, 6), error: r.error }) })
  }, [sug.status, sug.at])

  const useMine = async () => {
    setLocating(true)
    const r = await locateNow({ fresh: true })
    if (!alive.current) return
    setLocating(false)
    if (r.error) { setToast(locationHelp(r.error)); return }
    setMe(r.at); setView((v) => ({ at: r.at, zoom: 15, n: v.n + 1 })); setTrails(null); suggest({ at: r.at, from: 'you' })
  }
  const fromMap = () => { setTrails(null); suggest({ at: center.current, from: 'map' }) }

  // ---- editing ----------------------------------------------------------------
  const apply = (next, keepSel) => {
    if (!next || next === m) return
    dirty.current = true
    setH((x) => E.commit(x, next)); setMsg(''); if (!keepSel) setSel(null)
    setShown((s) => (s.edited ? s : { ...s, edited: true }))
  }
  const full = () => setMsg(`A route can have up to ${E.MAX_POINTS} points. Remove one to add another.`)
  function beginEdit(model, r) {
    // A line with no control points of its own (a walked route, a trail) gets up to 12 picked along it.
    const one = model.legs.length === 1 && model.legs[0].pts.length > 2 && !(r && r.control)
    setH(E.makeHistory(one ? E.modelFromLine(E.modelLine(model), E.SIMPLIFY_MAX) : model))
    dirty.current = false
    setEditing(true); setSel(null); setMsg(''); setRename(null); setDel(false); setSnap('half')
  }
  const done = () => {
    setEditing(false); setSel(null); setMsg('')
    if (dirty.current) track('route_edited', { legs: legsBucket(m.legs.length) })
  }
  const onTap = (at) => { if (sel != null) { setSel(null); return } if (!E.canAdd(m)) { full(); return } apply(E.appendPoint(m, at)) }
  const onInsert = (leg, at) => { if (!E.canAdd(m)) { full(); return } const r = E.insertVia(m, leg, at); if (r) { apply(r.model, true); setSel(r.index) } }
  const onMove = (i, at) => apply(E.movePoint(m, i, at), true)
  const step = (fn) => { setH(fn); setSel(null); setMsg(''); dirty.current = true; setShown((s) => (s.edited ? s : { ...s, edited: true })) }
  const closed = E.isClosed(m), n = m.points.length, lastIdx = n - 1
  const selEnd = sel != null && sel === lastIdx && n > 1 && !closed
  const selName = sel == null ? '' : sel === 0 ? 'Start' : selEnd ? 'End' : `Point ${sel + 1}`

  // ---- what is on the map -----------------------------------------------------
  const line = useMemo(() => E.modelLine(m), [m])
  const miles = E.totalMiles(m), minutes = miles > 0 ? walkMinutes(miles) : 0
  const approx = E.approximateLegs(m)
  const has = line.length > 1 && miles > 0
  const rt = shown.route
  const stored = !!(rt && rt.id && rt.kind !== 'recent' && !rt.sample && !rt.trail) // a row the person owns
  const live = stored ? store.routes.find((x) => x.id === rt.id) || rt : rt // the newest copy of it, for the star and the count
  const defaultName = `${miles.toFixed(1)} mi ${closed ? (n === 3 ? 'out and back' : 'loop') : 'route'}`
  const title = rt && !shown.edited ? rt.name : stored ? live.name : defaultName
  // Where a started walk came from, for the usage count: suggested, favorite, recent, or built (anything edited or saved without a star).
  const source = shown.edited || (stored && !live.favorite) ? 'built' : stored ? 'favorite' : shown.source === 'recent' ? 'recent' : 'suggested'
  const savedWhere = account ? 'Route saved to your account' : 'Route saved on this device only. It is not on an account.'

  const start = () => {
    if (!has) return
    const id = shown.edited ? null : stored ? rt.id : rt && rt.saved ? rt.saved.id : null
    setHandoff({ kind: 'routed', name: title, place: title, pts: line, miles: Math.round(miles * 100) / 100, minutes, approximate: approx > 0 || !!(rt && rt.approximate && !shown.edited), trail: !!(rt && rt.trail && !shown.edited), ...(id ? { routeId: id, routeName: title } : {}) })
    track('route_started', { source })
    setTab('record')
  }
  const after = (res, text) => {
    if (!alive.current) return null
    setSaving(false)
    if (res.error) { setToast(res.error); return null }
    if (text) setToast(text)
    return res.route
  }
  // Save: a new built route, the changes to one already saved, or the line of a recent walk.
  const save = async (favorite = false) => {
    if (!has || saving) return
    setSaving(true)
    if (stored) {
      const r = after(await routeActions.update(rt.id, { pts: line, control: E.controlOf(m), ...(favorite ? { favorite: true } : {}) }), 'Changes saved')
      if (r) setShown({ source: shown.source, route: r, edited: false })
      return
    }
    if (rt && rt.kind === 'recent' && !shown.edited) {
      const r = after(await routeActions.saveWalk({ id: rt.walkId, name: rt.name, pts: rt.pts, dog }, { favorite }), favorite ? 'Added to your favorites' : savedWhere)
      if (r) setShown((s) => ({ ...s, route: { ...rt, saved: { id: r.id, name: r.name, favorite: r.favorite }, favorite: r.favorite } }))
      return
    }
    const keep = shown.edited || !rt // a trail or a sample that was not touched is saved as the line it is
    const r = after(await routeActions.save({ name: rt && !shown.edited ? rt.name : defaultName, pts: line, ...(keep ? { control: E.controlOf(m) } : {}), kind: 'built', favorite, dog, approximate: approx > 0, trail: !!(rt && rt.trail && !shown.edited) }), favorite ? `${savedWhere}, in your favorites` : savedWhere)
    if (r) { setShown({ source: 'favorite', route: r, edited: false }); setTabSel('favorites') }
  }
  const star = async (r) => {
    if (r.kind === 'recent') {
      if (r.saved) { const x = await routeActions.update(r.saved.id, { favorite: !r.saved.favorite }); if (x.error) setToast(x.error); else if (rt && rt.id === r.id) setShown((s) => ({ ...s, route: { ...r, saved: { ...r.saved, favorite: x.route.favorite }, favorite: x.route.favorite } })); return }
      const x = await routeActions.saveWalk({ id: r.walkId, name: r.name, pts: r.pts, dog }, { favorite: true })
      if (x.error) setToast(x.error); else { setToast('Added to your favorites'); if (rt && rt.id === r.id) setShown((s) => ({ ...s, route: { ...r, saved: { id: x.route.id, name: x.route.name, favorite: true }, favorite: true } })) }
      return
    }
    const x = await routeActions.update(r.id, { favorite: !r.favorite })
    if (x.error) setToast(x.error); else if (rt && rt.id === r.id) setShown((s) => ({ ...s, route: x.route }))
  }
  const setUsual = async () => {
    const on = live.usualFor !== dog
    const x = await routeActions.update(rt.id, { usual: on, dog, ...(on ? { favorite: true } : {}) })
    if (x.error) setToast(x.error); else { setShown((s) => ({ ...s, route: x.route })); setToast(on ? `This is now ${dn}'s usual walk` : `No longer ${dn}'s usual walk`) }
  }
  const doRename = async (e) => {
    e.preventDefault()
    const name = (rename || '').trim()
    if (!name) return
    const x = await routeActions.update(rt.id, { name })
    if (x.error) setToast(x.error); else { setShown((s) => ({ ...s, route: x.route })); setRename(null) }
  }
  const remove = async () => {
    if (!del) { setDel(true); return }
    const x = await routeActions.remove(rt.id)
    if (x.error) { setToast(x.error); return }
    setToast(`Deleted ${live.name}`); setDel(false); backToList()
  }
  const backToList = () => { setRename(null); setDel(false); setEditing(false); if (sugRef.current.at) suggest({}); else setShown({ source: 'suggested', route: null, edited: false }) }
  const pickTab = (t) => { setTabSel(t); if (rt || (t === 'suggested' && shown.source !== 'suggested')) backToList() }

  // ---- lists ------------------------------------------------------------------
  const samples = useMemo(() => (account ? [] : demoFavorites(dn)), [account, dn])
  const mineFav = store.routes.filter((r) => r.favorite), others = store.routes.filter((r) => !r.favorite)
  const hasUsual = mineFav.some((r) => r.usualFor === dog)
  const favs = [...mineFav, ...samples.map((r) => (hasUsual ? { ...r, usualFor: '' } : r))].sort((a, b) => (b.usualFor === dog) - (a.usualFor === dog))
  // In the demo a recent route that was saved or starred on this device says so, the way the account's list does.
  const recents = useMemo(() => (account ? store.recents : demoRecents(demoActs).map((r) => { const x = store.routes.find((y) => y.sourceWalkId === String(r.walkId)); return x ? { ...r, saved: { id: x.id, name: x.name, favorite: x.favorite }, favorite: x.favorite } : r })), [account, store.recents, store.routes, demoActs])
  const trailList = (trails && trails.list) || []

  // ---- sheet height: the same three snap points and handle as Explore ----------
  const snapH = { peek: 132, half: Math.max(260, Math.round(H * 0.46)), full: Math.max(300, Math.round(H * 0.86)) }
  const grab = {
    onPointerDown: (e) => { drag.current = { y: e.clientY, h: sheetEl.current ? sheetEl.current.offsetHeight : snapH[snap], moved: false }; try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {} },
    onPointerMove: (e) => { const d = drag.current; if (!d) return; const dy = d.y - e.clientY; if (Math.abs(dy) > 6) d.moved = true; if (d.moved) setDragH(Math.max(100, Math.min(snapH.full, d.h + dy))) },
    onPointerUp: (e) => {
      const d = drag.current; drag.current = null
      if (!d || !d.moved) return
      const hh = Math.max(100, Math.min(snapH.full, d.h + d.y - e.clientY))
      setSnap(SNAPS.reduce((best, s) => (Math.abs(snapH[s] - hh) < Math.abs(snapH[best] - hh) ? s : best), 'peek')); setDragH(null); skipClick.current = true
    },
    onPointerCancel: () => { drag.current = null; setDragH(null) },
    onClick: () => { if (skipClick.current) { skipClick.current = false; return } setSnap((s) => SNAPS[(SNAPS.indexOf(s) + 1) % 3]) },
    onKeyDown: (e) => { if (e.key === 'ArrowUp') { e.preventDefault(); setSnap((s) => SNAPS[Math.min(2, SNAPS.indexOf(s) + 1)]) } else if (e.key === 'ArrowDown') { e.preventDefault(); setSnap((s) => SNAPS[Math.max(0, SNAPS.indexOf(s) - 1)]) } },
  }
  const build = useMemo(() => ({ legs: m.legs, points: m.points, editing, selected: sel, fitN, focus, onMove, onSelect: (i) => setSel((s) => (s === i ? null : i)), onInsert }), [m, editing, sel, fitN, focus])
  build.onMove = onMove; build.onInsert = onInsert

  const working = sug.status !== 'ready' && shown.source === 'suggested' && !rt
  const status = sug.status === 'locating' ? 'Finding where you are' : sug.status === 'routing' ? `Finding a ${sug.miles} mile ${sug.shape === 'out' ? 'out and back' : 'loop'} on mapped paths` : shown.edited ? 'Your edited route' : `${sug.shape === 'out' ? 'Out and back' : 'Loop'} from ${sug.from === 'you' ? 'where you are' : 'the middle of the map'} · ${approx ? 'approximate' : 'on mapped paths'}`
  const dist = <div className="dist"><b>{has ? fmtDist(miles) : '0.0 mi'}</b><span>{has ? `about ${minutes} min` : 'no route yet'}</span></div>
  const starOf = (r) => (r.sample ? null : () => star(r))
  const starText = (r) => (r.favorite ? `Remove ${r.name} from favorites` : `Add ${r.name} to favorites`)

  return (
    <div className="fill rbuild" ref={rootRef}>
      <TrotMap wheel="always" pins={NO_PINS} build={build} mileLine={line.length > 1 ? line : undefined} mileMin={1} onTap={editing ? onTap : undefined} me={me} view={view} top={topH + 16} bottom={sheetH} onMove={(x) => { center.current = x.center }} className="abs" />
      <div className="over topbar" ref={topRef}>
        <div className="mbar">
          <button className="mbtn light" onClick={() => setTab(backTo)}><Ic n="back" s={18} />{backTo === 'home' ? 'Today' : 'Explore'}</button>
          {editing && sel == null && <div className="pill bhint">Drag a point. Tap the line to add one.</div>}
          {busy && <div className="pill rbusy" role="status"><span className="spin sm" aria-hidden="true" />Routing</div>}
        </div>
        {editing && sel != null && m.points[sel] && (
          <div className="selbar" role="group" aria-label={`${selName} actions`}>
            <b>{selName}</b>
            <button className="chip flat" onClick={() => apply(E.removePoint(m, sel))}>Remove</button>
            {sel > 0 && !(closed && sel === lastIdx) && <button className="chip flat" onClick={() => apply(E.makeStart(m, sel))}>Make start</button>}
            {selEnd && <button className="chip flat" disabled={!E.canAdd(m)} onClick={() => apply(E.closeLoop(m))}>Close the loop back to start</button>}
          </div>
        )}
      </div>
      <div className={`sheet snap ${dragH != null ? 'dragging' : ''}`} ref={(node) => { sheetEl.current = node; sheetRef(node) }} style={{ height: (dragH != null ? dragH : snapH[snap]) + 'px' }} data-snap={snap}>
        <button className="grabbtn" aria-label={`Resize the panel. It is at ${snap} height. Up and down arrows change it.`} {...grab}><span className="grab" /></button>
        {editing ? (<>
          <div className="row between top g10">
            <div className="grow"><h2>Edit route</h2><div className="meta" role="status">{busy ? 'Routing the changed legs on mapped paths' : n === 0 ? 'Tap the map to drop the start.' : n === 1 ? 'Tap the map again and Trot routes between the points.' : `${E.countPoints(m)} points · ${m.legs.length} ${m.legs.length === 1 ? 'leg' : 'legs'}${closed ? ' · back to the start' : ''}`}</div></div>
            {dist}
            <button className="cta small rdone" onClick={done}>Done</button>
          </div>
          <div className="loops edtools">
            <button className="chip flat" disabled={!E.canUndo(h)} onClick={() => step(E.undo)}>Undo</button>
            <button className="chip flat" disabled={!E.canRedo(h)} onClick={() => step(E.redo)}>Redo</button>
            <button className="chip flat" disabled={n < 2} onClick={() => apply(E.reverse(m))}>Reverse direction</button>
            <button className="chip flat" disabled={n === 0} onClick={() => apply(E.emptyModel())}>Clear</button>
          </div>
          {msg && <div className="mnote" role="alert"><span className="grow">{msg}</span></div>}
          {approx > 0 && !busy && <div className="mnote"><span className="grow"><b>{approx === 1 ? 'One leg is' : `${approx} legs are`} approximate.</b> The routing service did not answer, so {approx === 1 ? 'it is a straight line' : 'they are straight lines'}, not a walkable path.</span><button onClick={() => apply(E.retryApproximate(m), true)}>Retry</button></div>}
          {m.legs.length > 0 && <div className="eyebrow dark">LEGS, IN WALKING ORDER</div>}
          <ol className="legs">{m.legs.map((l, i) => (
            <li key={i} className="legrow">
              <button className="legmain" onClick={() => { setFocus({ leg: i, n: Date.now() }); if (snap === 'full') setSnap('half') }} aria-label={`Leg ${i + 1}: ${E.legLabel(l)}, ${fmtDist(l.miles)}. Show on the map`}>
                <span className="legn">{i + 1}</span>
                <span className="grow"><b>{E.legLabel(l)}</b><small>{fmtDist(l.miles)}{l.pending ? ' · routing' : l.approximate ? ' · approximate, no path found' : l.mode === 'straight' ? ' · not a mapped path' : l.roads && l.roads.filter((x) => x !== l.name).length ? ' · also ' + l.roads.filter((x) => x !== l.name).slice(0, 2).join(', ') : ''}</small></span>
              </button>
              <div className="legmode" role="group" aria-label={`How leg ${i + 1} is drawn`}>
                <button aria-pressed={l.mode === 'path'} className={l.mode === 'path' ? 'on' : ''} onClick={() => apply(E.setLegMode(m, i, 'path'), true)}>Follow paths</button>
                <button aria-pressed={l.mode === 'straight'} className={l.mode === 'straight' ? 'on' : ''} onClick={() => apply(E.setLegMode(m, i, 'straight'), true)}>Straight line</button>
              </div>
            </li>
          ))}</ol>
          {n > 1 && <div className="meta">Straight line cuts across a lawn or a field where no path is mapped. It is drawn dashed and counted in the distance.</div>}
        </>) : (<>
          <div className="row between top g10">
            <div className="grow"><h2>{rt ? title : 'Build a route'}</h2><div className="meta" role="status">{rt ? `${rt.trail ? 'Trail from OpenStreetMap' : rt.kind === 'recent' ? `Walked ${dayOf(rt)}${rt.dog ? ' with ' + rt.dog.name : ''}` : rt.sample ? 'Sample route' : rt.kind === 'walked' ? 'Saved from a walk' : 'Saved route'}${shown.edited ? ' · edited, not saved yet' : stored ? ' · ' + times(live.timesWalked) : ''}` : status}</div></div>
            {dist}
          </div>
          <div className="seg rtabs" role="tablist" aria-label="Routes">{TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => pickTab(k)}>{label}</button>)}</div>
          {rt ? (<>
            <div className="row g10 nowrap">
              <button className="cta white bordered small" onClick={backToList}>Back</button>
              <button className="cta grow" disabled={!has} onClick={start}>Start walk</button>
            </div>
            <div className="loops rtacts">
              <button className="chip flat" onClick={() => beginEdit(m, rt)}>Edit</button>
              {stored && !shown.edited && <button className="chip flat" aria-expanded={rename != null} onClick={() => setRename(rename == null ? live.name : null)}>Rename</button>}
              {stored && !shown.edited && <button className={`chip flat ${del ? 'sure' : ''}`} onClick={remove}>{del ? 'Delete it?' : 'Delete'}</button>}
              {(shown.edited || !stored) && <button className="chip flat" disabled={saving || !has || (rt.kind === 'recent' && !shown.edited && !!rt.saved)} onClick={() => save(false)}>{stored ? 'Save changes' : rt.kind === 'recent' && !shown.edited && rt.saved ? 'Saved' : shown.edited ? 'Save as a new route' : 'Save'}</button>}
              {!rt.sample && !rt.trail && !shown.edited && <button className={`starbtn ${live.favorite ? 'on' : ''}`} aria-pressed={!!live.favorite} aria-label={starText(live)} onClick={() => star(live)}><Star on={live.favorite} /></button>}
            </div>
            {rename != null && <form className="saverow" onSubmit={doRename}><label className="field lightf grow"><span>Route name</span><input value={rename} maxLength={60} autoFocus onChange={(e) => setRename(e.target.value)} /></label><button className="cta bordered small" type="submit" disabled={!rename.trim()}>Save name</button></form>}
            {stored && !shown.edited && live.favorite && <label className="lrow usual"><input type="checkbox" checked={live.usualFor === dog} onChange={setUsual} /><span>{dn}'s usual walk. Today offers it first.</span></label>}
            {rt.sample && <div className="mnote info"><span className="grow">A sample route for the demo. Edit it and save to keep your own copy on this device.</span></div>}
            {approx > 0 && <div className="mnote"><span className="grow"><b>Partly approximate.</b> {approx === 1 ? 'One leg is a straight line' : `${approx} legs are straight lines`} because the routing service did not answer.</span><button onClick={() => apply(E.retryApproximate(m), true)}>Retry</button></div>}
          </>) : tab === 'suggested' ? (<>
            <div className="loops" role="group" aria-label="Route length">{MILES.map((x) => <button key={x} className={`chip flat ${sug.miles === x && !shown.edited ? 'on' : ''}`} aria-pressed={sug.miles === x && !shown.edited} onClick={() => suggest({ miles: x })}><b>{x}</b> mi</button>)}</div>
            <div className="row g10 nowrap">
              <div className="seg shape" role="group" aria-label="Route shape"><button aria-pressed={sug.shape === 'loop'} className={sug.shape === 'loop' ? 'on' : ''} onClick={() => suggest({ shape: 'loop' })}>Loop</button><button aria-pressed={sug.shape === 'out'} className={sug.shape === 'out' ? 'on' : ''} onClick={() => suggest({ shape: 'out' })}>Out and back</button></div>
              <button className="chip flat shuffle" disabled={!sug.at} onClick={() => suggest({ bearing: (sug.bearing + 97) % 360 })}>Shuffle</button>
            </div>
            {working && <div className="mload quiet" role="status"><span className="spin sm" aria-hidden="true" />{status}</div>}
            {!working && sug.approximate && !shown.edited && <div className="mnote"><span className="grow"><b>Approximate sketch.</b> The routing service did not answer, so this is straight lines between points, not a walkable path.</span><button onClick={() => suggest({ retry: true })}>Retry</button></div>}
            <div className="row g10 nowrap rgo">
              <button className="cta white bordered small" disabled={!has} onClick={() => beginEdit(m, null)}>Edit</button>
              <button className="cta white bordered small" disabled={!has || saving} onClick={() => save(false)}>Save</button>
              <button className="cta grow" disabled={!has} onClick={start}>Start walk</button>
            </div>
            {sug.from === 'map' && !working && <div className="row g10 nowrap"><button className="cta white bordered small grow" disabled={locating} onClick={useMine}>{locating ? 'Finding you' : 'Use my location'}</button><button className="cta white bordered small grow" onClick={fromMap}>Start from map center</button></div>}
            <div className="meta">{account ? 'Saved routes stay with your account.' : 'In the demo, saved routes stay on this device only.'} Edit shapes the route road by road.</div>
            {trails && trails.status === 'loading' && <div className="mload quiet" role="status"><span className="spin sm" aria-hidden="true" />Looking for named trails nearby</div>}
            {trailList.length > 0 && <div className="eyebrow dark">NAMED TRAILS NEARBY</div>}
            {trailList.map((x) => <RouteRow key={x.id} r={{ ...x, minutes: walkMinutes(x.miles), timesWalked: 0 }} sub={`${x.kind} from OpenStreetMap, one way`} onOpen={() => openRoute({ id: 'trail:' + x.id, name: x.name, pts: x.pts, miles: x.miles, minutes: walkMinutes(x.miles), kind: 'built', trail: true, full: true }, 'suggested')} />)}
          </>) : tab === 'favorites' ? (<>
            {!store.loaded && <div className="mload quiet" role="status"><span className="spin sm" aria-hidden="true" />Fetching your routes</div>}
            {store.error && <div className="mnote"><span className="grow">{store.error}</span><button onClick={routeActions.reload}>Retry</button></div>}
            {store.loaded && favs.length === 0 && <div className="meta">No favorites yet. Tap the star on a route you like and it shows here.</div>}
            {favs.map((r) => <RouteRow key={r.id} r={r} sub={r.sample ? 'Sample route' : r.kind === 'walked' ? 'From a walk' : 'Built'} onOpen={() => openRoute(r, 'favorite')} onStar={starOf(r)} starLabel={starText(r)} />)}
            {others.length > 0 && <div className="eyebrow dark">OTHER SAVED ROUTES</div>}
            {others.map((r) => <RouteRow key={r.id} r={r} sub={r.kind === 'walked' ? 'From a walk' : 'Built'} onOpen={() => openRoute(r, 'built')} onStar={starOf(r)} starLabel={starText(r)} />)}
            {!account && <div className="meta">Routes you save in the demo stay on this device only.</div>}
          </>) : (<>
            {!store.loaded && <div className="mload quiet" role="status"><span className="spin sm" aria-hidden="true" />Fetching your walks</div>}
            {store.loaded && recents.length === 0 && <div className="meta">Nothing here yet. Record a walk with GPS and the route you took shows here, newest first.</div>}
            {recents.map((r) => <RouteRow key={r.id} r={r} sub={[dayOf(r), r.dog && r.dog.name, r.sample ? 'sample' : ''].filter(Boolean).join(' · ')} onOpen={() => openRoute(r, 'recent')} onStar={() => star(r)} starLabel={starText(r)} />)}
            {recents.length > 0 && <div className="meta">The last {recents.length === 1 ? 'route' : `${recents.length} routes`} {account ? 'you' : dn} walked. Walks along the same line count as one. Star one to keep it.</div>}
          </>)}
        </>)}
      </div>
    </div>
  )
}
