import React, { useEffect, useMemo, useRef, useState } from 'react'
import TrotMap, { useHeight } from '../Map.jsx'
import { Ic, Av, Stat, Range } from '../ui.jsx'
import { ROUTES, PEOPLE, ACTIVITY_TYPES, activityType, fmtTime, haversine } from '../data.js'
import { takeHandoff, loadSavedRoutes, deleteSavedRoute, pathMiles, lineUpTo, peekDemoRoute, resolveDemoRoute, useHereLoop, locationHelp, DEFAULT_CENTER } from '../routing.js'
import { trackStats, speedStats, demoSamples, distAt, samplesUpTo, activityStats, defaultTitle, MAX_ACCURACY_M, SPIKE_MPH } from '../metrics.js'
import { PhotoPicker, PickStrip, makePicks } from './Photos.jsx'
import { OUTING_PHOTO_MAX } from '../photo.js'
import '../maps.css'

const SPEED = 40
const LOOPS = [1, 2, 3]
const MIN_STEP_M = 4 // ignore movement smaller than this to cut jitter
const METERS_PER_MILE = 1609.344
const STALE_FIX_MS = 6000 // no fix for this long reads as standing still
// Daycare is logged by the daycare, not recorded by the person holding the phone.
const TYPES = ACTIVITY_TYPES.filter((t) => t.id !== 'Daycare')
// One small line icon per activity type, drawn for Trot.
const TYPE_ICON = {
  Walk: 'M13.5 5a1.5 1.5 0 1 0-3 0 1.500 1.500 0 0 0 3 0M12 8.500l-3 4 3 2v6M12 8.500l3 3h3M9 21l1.500-4.500',
  Run: 'M16.500 5a1.500 1.500 0 1 0-3 0 1.500 1.500 0 0 0 3 0M8 9.500l4.500-1.500 3 3 3 1M12.500 8l-2 5 3 2.500-1 5.500M10.500 13l-4 2M2 9h3M1.500 13h2.500',
  Hike: 'M2 20l7-12 4 7 2-3 7 8zM9 8l1.500 2.500',
  'Play time': 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M5.500 6c3 2.500 3.500 8 1.500 12M18.500 6c-3 2.500-3.500 8-1.500 12',
  Fetch: 'M3 20l9-9M10.500 9.500l4 4M12 11l5-5M3 9c4-6 12-7 18-2M18 3.500l3 3.500-4.500 1',
  'Dog park': 'M8 13V21M8 13a4.500 4.500 0 1 1 0-9 4.500 4.500 0 0 1 0 9M13 21v-5M17 21v-5M21 21v-5M11 18h11M2 21h20',
  Swim: 'M2 16c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 20.500c2-2 4-2 6 0s4 2 6 0 4-2 6 0M8 11.500l4-4 3.500 3.500M19 6.500a1.500 1.500 0 1 0-3 0 1.500 1.500 0 0 0 3 0',
  Training: 'M21 12a9 9 0 1 1-9-9M16 12a4 4 0 1 1-4-4M12 12l8-8M16.500 4H20v3.500',
  Agility: 'M5 21V7M19 21V7M5 10.500h14M5 15h14M8 5c2.500-2.500 6-2.500 8.500 .5M16.500 2.500v3h-3',
}
const TypeIc = ({ id, s = 18, c = 'currentColor' }) => <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={TYPE_ICON[id] || TYPE_ICON.Walk} /></svg>
const lastViewCenter = () => { try { const v = JSON.parse(localStorage.getItem('trot-view-v2')); if (v && Array.isArray(v.at) && Number.isFinite(v.at[0]) && Number.isFinite(v.at[1])) return v.at } catch (e) {} return null }
const mph = (v) => (Number(v) || 0).toFixed(1) + ' mph'

export default function Record({ me, conn, setTab, saveWalk, todayMin, setToast, meName, dogName, publicDog }) {
  const [hand] = useState(() => { const h = takeHandoff(); return h && h.kind === 'demo' && !ROUTES[h.key] ? null : h })
  const [mode, setMode] = useState('setup')
  const [type, setType] = useState('Walk')
  // rk is 'handoff' (route from Explore), 'loop' (loop from here), 'gps', 'saved:<id>' (a saved route), or a demo key from ROUTES.
  const [rk, setRk] = useState(() => (!hand ? 'pond' : hand.kind === 'demo' ? hand.key : 'handoff'))
  const here = useHereLoop(), loop = here.loop
  const [saved, setSaved] = useState(loadSavedRoutes)
  const [del, setDel] = useState(null)
  const [demoR, setDemoR] = useState(() => Object.fromEntries(Object.keys(ROUTES).map((k) => [k, peekDemoRoute(k)])))
  const [paused, setPaused] = useState(false)
  const [sec, setSec] = useState(0)
  const [fixes, setFixes] = useState([]) // live track: [{ t, at, acc, gap }]
  const [weak, setWeak] = useState(false)
  const [follow, setFollow] = useState(true)
  const [taps, setTaps] = useState(0) // sprints counted by hand in a timed session
  const [placeName, setPlaceName] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  // Photos picked on the finish step. They are sent after the outing is saved, so a slow or failed photo never holds up the save.
  const [picks, setPicks] = useState([])
  const picksRef = useRef([])
  picksRef.current = picks
  useEffect(() => () => { picksRef.current.forEach((p) => { try { URL.revokeObjectURL(p.url) } catch (e) {} }) }, [])
  const unpick = (key) => setPicks((ps) => { const p = ps.find((x) => x.key === key); if (p) { try { URL.revokeObjectURL(p.url) } catch (e) {} } return ps.filter((x) => x.key !== key) })
  const [panelRef, panelH] = useHeight()
  const T = activityType(type), timed = !T.gps
  const live = !timed && rk === 'gps'
  const watch = useRef(null), last = useRef(null), count = useRef(0), pausedRef = useRef(false), gapNext = useRef(false), alive = useRef(true), lock = useRef(null)
  pausedRef.current = paused
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  // Seeded routes that carry `via` are swapped for the routed loop once it is known.
  useEffect(() => {
    Object.keys(ROUTES).forEach((k) => { if (ROUTES[k].via && demoR[k] && demoR[k].approximate) resolveDemoRoute(k).then((v) => { if (alive.current && v && !v.approximate) setDemoR((d) => ({ ...d, [k]: v })) }) })
  }, [])
  const loopRoute = useMemo(() => (loop && loop.status === 'ready' ? { ...loop.route, name: `${loop.route.miles.toFixed(1)} mi loop from ${loop.from === 'you' ? 'here' : 'the map area'}`, place: loop.from === 'you' ? 'Loop from here' : 'Loop from the map area' } : null), [loop && loop.route])
  const savedSel = rk.startsWith('saved:') ? saved.find((x) => 'saved:' + x.id === rk) || null : null
  const savedRoute = useMemo(() => (savedSel ? { ...savedSel, place: savedSel.name } : null), [savedSel])
  const demoKey = !timed && !live && rk !== 'handoff' && rk !== 'loop' && !rk.startsWith('saved:') && ROUTES[rk] ? rk : null
  const demoRoute = useMemo(() => (demoKey ? { ...ROUTES[demoKey], ...(demoR[demoKey] || {}) } : null), [demoKey, demoR])
  const r = timed || live ? null : rk === 'handoff' ? hand : rk === 'loop' ? loopRoute : rk.startsWith('saved:') ? savedRoute : demoRoute
  // Distance comes from the line that is drawn, nothing else. Playback timing is made from that length.
  const lineMi = useMemo(() => (r ? pathMiles(r.pts) : 0), [r && r.pts])
  const sim = useMemo(() => (r ? demoSamples(lineMi) : null), [r && r.pts])
  const simTotal = sim ? sim[sim.length - 1].t : 0
  const gps = useMemo(() => fixes.map((f) => f.at), [fixes])
  const running = mode === 'run' && !paused
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setSec((s) => s + (live || timed ? 1 : SPEED) * 0.25), 250)
    return () => clearInterval(t)
  }, [running, live, timed])
  useEffect(() => {
    if (mode !== 'run' || !live) return
    const bail = () => { setToast('Location is unavailable here. Use a demo route.'); setMode('setup'); setRk('pond') }
    const onFix = (p) => {
      if (pausedRef.current) { gapNext.current = true; return }
      if (!(p.coords.accuracy <= MAX_ACCURACY_M)) { setWeak(true); return }
      const at = [p.coords.latitude, p.coords.longitude], t = p.timestamp || Date.now(), l = last.current
      if (l) {
        const step = haversine(l.at, at), dt = (t - l.t) / 1000
        if (step * METERS_PER_MILE < MIN_STEP_M) return
        // A jump no dog or person could make is a GPS error. It is kept off the line and out of the speeds.
        if (!gapNext.current && dt > 0 && (step / dt) * 3600 > SPIKE_MPH) return
      }
      const f = { t, at, acc: p.coords.accuracy, gap: gapNext.current }
      gapNext.current = false; last.current = f; count.current++
      setWeak(false); setFixes((g) => [...g, f])
    }
    // A lost signal in the middle of a walk should not throw the recording away.
    const onErr = (e) => { if (count.current === 0 || (e && e.code === 1)) bail(); else setWeak(true) }
    try { watch.current = navigator.geolocation.watchPosition(onFix, onErr, { enableHighAccuracy: true, maximumAge: 2000 }) } catch (e) { bail() }
    return () => { try { navigator.geolocation.clearWatch(watch.current) } catch (e) {} }
  }, [mode, live])
  useEffect(() => {
    // Keep the screen awake while recording, where the browser supports it.
    if (mode !== 'run') return
    let off = false
    const ask = async () => {
      try {
        if (off || lock.current || !navigator.wakeLock || document.visibilityState !== 'visible') return
        const l = await navigator.wakeLock.request('screen')
        if (off) { l.release().catch(() => {}); return }
        lock.current = l
        l.addEventListener('release', () => { if (lock.current === l) lock.current = null })
      } catch (e) {}
    }
    const onVis = () => { if (document.visibilityState === 'visible') ask() }
    ask(); document.addEventListener('visibilitychange', onVis)
    return () => { off = true; document.removeEventListener('visibilitychange', onVis); const l = lock.current; lock.current = null; if (l) { try { l.release().catch(() => {}) } catch (e) {} } }
  }, [mode])

  // The running distance is the length of the part of the line drawn so far.
  const walked = useMemo(() => (!live && r && mode !== 'setup' ? lineUpTo(r.pts, distAt(sim, sec)) : null), [r && r.pts, sec, mode, live])
  const miles = timed ? 0 : live ? pathMiles(gps) : walked ? pathMiles(walked) : 0
  const st = useMemo(() => (timed ? null : live ? trackStats(fixes) : sim ? speedStats(samplesUpTo(sim, sec)) : null), [timed, live, fixes, sim, sec])
  const lastFix = fixes[fixes.length - 1]
  const current = !st || paused ? 0 : live ? (lastFix && Date.now() - lastFix.t < STALE_FIX_MS ? st.current : 0) : st.current
  const sprints = timed ? taps : st ? st.sprints : 0
  useEffect(() => { if (!live && !timed && mode === 'run' && sim && sec >= simTotal) finish() }, [sec])
  const pace = miles > 0.05 ? fmtTime(sec / 60 / miles) + ' /mi' : '--'
  const titlePlace = timed ? placeName.trim() : live || rk === 'loop' ? '' : demoKey ? r.name.split(' ')[0] + ' ' + (r.name.split(' ')[1] || '') : (r && r.place) || ''
  const finish = () => { setPaused(true); setTitle(defaultTitle(T.label, titlePlace)); setMode('done') }
  const save = () => {
    const base = { id: 'm' + Date.now(), dog: dogName || 'Biscuit', by: me, type, title: title || T.label, daysAgo: 0, time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), paws: 0, comments: 0, note, sniffs: 0, minutes: sec / 60 }
    const files = picks.map((p) => p.file)
    if (timed) { saveWalk({ ...base, place: placeName.trim(), route: null, pts: null, miles: 0, avgSpeed: 0, maxSpeed: 0, sprints: taps, movingMinutes: sec / 60, runMinutes: 0 }, files); return }
    saveWalk({ ...base, place: live ? 'Live GPS' : r.place || r.name, route: demoKey, pts: live ? (gps.length > 1 ? gps : null) : walked, miles: Math.round(miles * 100) / 100, ...activityStats(st, sec / 60) }, files)
  }
  const removeSaved = (x) => {
    if (del !== x.id) { setDel(x.id); return }
    const out = deleteSavedRoute(x.id)
    setSaved(out.list); setDel(null)
    if (rk === 'saved:' + x.id) setRk('pond')
    setToast(out.ok ? `Deleted ${x.name}` : 'This browser would not update saved routes.')
  }
  const start = () => { setSec(0); last.current = null; count.current = 0; gapNext.current = false; setFixes([]); setWeak(false); setPaused(false); setFollow(true); setTaps(0); setMode('run') }
  const canStart = timed || live || !!r
  const meP = { ...(PEOPLE[me] || PEOPLE.dale), ...(meName ? { name: meName } : {}) }
  const dn = dogName || 'Biscuit'
  const selMiles = loop ? loop.miles : 2
  const loopBusy = !!loop && (loop.status === 'locating' || loop.status === 'routing')
  const counts = T.stats.includes('sprints')

  if (mode === 'setup') return (
    <div className="scroll pad">
      <header className="row g10"><button className="round" aria-label="Close" onClick={() => setTab('home')}><Ic n="x" /></button><h1 className="h1">{T.gps ? `Walk ${dn}` : `${T.label} with ${dn}`}</h1></header>
      <div className="who"><Av t={dn[0]} s={64} bg="#C8F031" c="#0F1B2D" /><div className="plus">+</div><Av t={meP.name[0]} s={44} bg={meP.color} c={meP.ink} /><div><div className="dogname">{dn}</div><div className="meta">going out with {meP.name}</div></div></div>
      <div className="eyebrow dark">ACTIVITY</div>
      <div className="chips wrap">{TYPES.map((t) => <button key={t.id} className={`chip flat tchip ${type === t.id ? 'on' : ''}`} aria-pressed={type === t.id} onClick={() => setType(t.id)}><TypeIc id={t.id} />{t.label}</button>)}</div>
      {timed && (<>
        <div className="eyebrow dark">TIMED SESSION</div>
        <div className="rrow box lbox"><div className="meta">{T.label} is timed, not tracked on the map. Start the timer, pause when you stop, and finish when you are done.{counts ? ' Tap the sprint button each time ' + dn + ' takes off.' : ''}</div>
          <label className="field lightf"><span>Where (optional)</span><input value={placeName} maxLength={60} placeholder="Back yard, the pond, training hall" onChange={(e) => setPlaceName(e.target.value)} /></label></div>
      </>)}
      {!timed && (<>
        <div className="eyebrow dark">ROUTE</div>
        {hand && hand.kind === 'routed' && <button className={`rrow box ${rk === 'handoff' ? 'on' : ''}`} aria-pressed={rk === 'handoff'} onClick={() => setRk('handoff')}><span className="ricon"><Ic n="map" s={20} c="#1F5AE8" /></span><span className="grow"><b>{hand.name}</b><small>From Explore · {hand.trail ? 'trail from OpenStreetMap' : hand.approximate ? 'approximate, not a mapped path' : 'routed on mapped paths'} · about {hand.minutes} min</small></span><span className="num">{hand.miles.toFixed(1)} mi</span></button>}
        <div className={`rrow box lbox ${rk === 'loop' ? 'on' : ''}`}>
          <button className="cta" disabled={loopBusy} onClick={() => { setRk('loop'); here.fromHere(selMiles) }}>{loop && loop.status === 'locating' ? <><span className="spin" aria-hidden="true" />Finding you</> : loop && loop.status === 'routing' ? <><span className="spin" aria-hidden="true" />Building the loop</> : 'Loop from here'}</button>
          <div className="loops" role="group" aria-label="Loop length">{LOOPS.map((m) => <button key={m} className={`chip flat ${selMiles === m ? 'on' : ''}`} aria-pressed={selMiles === m} disabled={loopBusy} onClick={() => { setRk('loop'); here.setMiles(m) }}><b>{m}</b> mi</button>)}</div>
          {!loop && <div className="meta">Uses your location right now and builds a 2 mile loop on mapped paths. Pick 1 or 3 miles for a different length.</div>}
          {loop && loop.status === 'nofix' && <div className="mnote" role="alert"><span className="grow"><b>No location.</b> {locationHelp(loop.reason)}</span></div>}
          {loop && loop.status === 'nofix' && <button className="cta white bordered small" onClick={() => here.fromCenter(lastViewCenter() || DEFAULT_CENTER)}>{lastViewCenter() ? 'Build it from the last map area instead' : 'Build it from Eastover, Charlotte instead'}</button>}
          {loop && loop.status === 'ready' && (<>
            <TrotMap route={loop.route.pts} me={loop.from === 'you' ? loop.at : undefined} className="lmap" />
            <div className="rsum"><b>{loop.route.miles.toFixed(2)} mi</b><span>about {loop.route.minutes} min · {loop.route.approximate ? 'approximate' : 'routed on mapped paths'} · {loop.from === 'you' ? 'starts where you are' : 'starts at the map area, not your location'}</span></div>
            {loop.from !== 'you' && <div className="mnote info"><span className="grow">This loop does not start from your location. It starts from {lastViewCenter() ? 'the last area you looked at on the map' : 'the default spot in Cambridge, MA'}.</span></div>}
            {loop.route.approximate && <div className="mnote"><span className="grow"><b>Approximate loop.</b> The routing service did not answer, so this is a simple circle, not a walkable path.</span><button onClick={() => here.setMiles(loop.miles)}>Retry</button></div>}
            <button className="cta white bordered small" onClick={here.another}>Try another loop</button>
          </>)}
        </div>
        <button className={`rrow box ${live ? 'on' : ''}`} aria-pressed={live} onClick={() => setRk('gps')}><span className="ricon"><Ic n="play" s={18} c="#1F5AE8" /></span><span className="grow"><b>Live GPS</b><small>Records your real location and keeps the screen awake. Works in the deployed app.</small></span></button>
        {saved.length > 0 && <div className="eyebrow dark">SAVED ROUTES</div>}
        {saved.map((x) => (
          <div key={x.id} className={`rrow box srow ${rk === 'saved:' + x.id ? 'on' : ''}`}>
            <button className="rrow" aria-pressed={rk === 'saved:' + x.id} onClick={() => setRk('saved:' + x.id)}><span className="ricon"><Ic n="map" s={20} c="#1F5AE8" /></span><span className="grow"><b>{x.name}</b><small>{x.trail ? 'Trail from OpenStreetMap' : 'Built in Explore · ' + (x.approximate ? 'approximate, not a mapped path' : 'routed on mapped paths')} · about {x.minutes} min</small></span><span className="num">{x.miles.toFixed(1)} mi</span></button>
            <button className={`sdel ${del === x.id ? 'sure' : ''}`} aria-label={`${del === x.id ? 'Confirm delete' : 'Delete'} ${x.name}`} onClick={() => removeSaved(x)}>{del === x.id ? 'Delete?' : <Ic n="x" s={16} />}</button>
          </div>
        ))}
        <div className="eyebrow dark">DEMO PLAYBACK (SAMPLE ROUTES)</div>
        {Object.entries(ROUTES).map(([k, x]) => { const v = demoR[k] || x; return <button key={k} className={`rrow box ${rk === k ? 'on' : ''}`} aria-pressed={rk === k} onClick={() => setRk(k)}><span className="ricon"><Ic n="map" s={20} c="#1F5AE8" /></span><span className="grow"><b>{x.name}</b><small>{v.approximate ? 'Approximate line, not a mapped path' : 'Demo route on mapped paths'} · {x.note}</small></span><span className="num">{v.miles.toFixed(1)} mi</span></button> })}
      </>)}
      <Range min={todayMin} />
      <button className="cta sticky" disabled={!canStart} onClick={start}>{canStart ? (timed ? 'Start timer' : 'Start') : rk === 'loop' && loopBusy ? 'Building route' : 'Start'}</button>
    </div>
  )
  const doneForm = (<>
    <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    {timed && <label className="field"><span>Where (optional)</span><input value={placeName} maxLength={60} onChange={(e) => setPlaceName(e.target.value)} /></label>}
    <label className="field"><span>How did {dn} do?</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Found a stick, met a friend…" /></label>
    <div className="photorow">
      <div className="row g8"><PhotoPicker light onPick={(files) => setPicks((ps) => [...ps, ...makePicks(files)].slice(0, OUTING_PHOTO_MAX))} room={OUTING_PHOTO_MAX - picks.length} setToast={setToast} /><span className="meta lightm">{picks.length ? `${picks.length} of ${OUTING_PHOTO_MAX} chosen` : `Optional, up to ${OUTING_PHOTO_MAX}`}</span></div>
      <PickStrip picks={picks} onRemove={unpick} />
      <p className="meta lightm">Opens your photo library so you can choose. Photos are added after the outing is saved{publicDog ? `, and show on ${dn}'s public page` : ''}.</p>
    </div>
    <div className="row g12"><button className="cta white grow" onClick={() => setTab('home')}>Discard</button><button className="cta grow" onClick={save}>Save to {dn}</button></div>
  </>)
  if (timed) return (
    <div className="fill navy tsession">
      <div className="over topbar row g8"><div className="pill"><Av t={dn[0]} s={30} />{dn}</div><div className="pill">with {meP.name}</div><div className="pill dark"><TypeIc id={type} s={16} c="#C8F031" />{T.label}</div></div>
      <div className="tbody">
        <div className="center"><div className="sl lightl">{mode === 'run' ? (paused ? 'PAUSED' : 'TIME') : 'TOTAL TIME'}</div><div className="clock huge" role="timer">{fmtTime(sec / 60)}</div></div>
        {counts && mode === 'run' && <button className="sprintbtn" onClick={() => setTaps((n) => n + 1)} aria-label={`Count a sprint. ${taps} so far`}><b>{taps}</b><span>{taps === 1 ? 'sprint' : 'sprints'} · tap to add one</span></button>}
        {counts && mode === 'done' && <div className="grid3"><Stat light l="SPRINTS" v={taps} big={24} /></div>}
      </div>
      <div className="panel">
        {mode === 'run' ? (<>
          <Range min={todayMin + sec / 60} light />
          <div className="row g12"><button className="cta grow" onClick={() => setPaused(!paused)}><Ic n={paused ? 'play' : 'pause'} c="#0F1B2D" />{paused ? 'Resume' : 'Pause'}</button><button className="cta white grow" onClick={finish}>Finish</button></div>
        </>) : (<>
          <div className="row between"><h2 className="white">Nice one, {dn}</h2><div className="num white">{fmtTime(sec / 60)}</div></div>
          {doneForm}
        </>)}
      </div>
    </div>
  )
  const TILE = { distance: ['DISTANCE', miles.toFixed(2) + ' mi'], pace: ['PACE', pace], speed: ['SPEED', mph(current)], maxSpeed: ['TOP SPEED', mph(st ? st.maxSpeed : 0)] }
  // The type decides which tiles lead. Sprints join once there is one.
  const tiles = [...new Set([...T.stats.filter((k) => TILE[k]), 'distance', 'speed', 'maxSpeed'])]
  return (
    <div className="fill navy">
      <TrotMap route={live ? gps : r.pts} walked={live ? undefined : walked} live follow={follow} onUserMove={() => setFollow(false)} wheel="always" bottom={panelH} top={70} className="abs" />
      <div className="over topbar row g8">
        <div className="pill"><Av t={dn[0]} s={30} />{dn}{conn.tag && <Ic n="tag" s={16} c="#1F5AE8" />}</div>
        <div className="pill">with {meP.name}</div>
        {!live && <div className="pill dark">Demo ×{SPEED}</div>}
        {live && mode === 'run' && (weak || gps.length === 0) && <div className="pill gpswait" role="status">Waiting for a good GPS fix</div>}
        {!follow && <button className="mbtn" onClick={() => setFollow(true)}>Recenter</button>}
      </div>
      <div className="panel" ref={panelRef}>
        {mode === 'run' ? (<>
          <div className="center"><div className="sl lightl">TIME</div><div className="clock" role="timer">{fmtTime(sec / 60)}</div></div>
          <div className="grid3">{tiles.map((k) => <Stat key={k} light l={TILE[k][0]} v={TILE[k][1]} big={22} />)}{sprints > 0 && <Stat light l="SPRINTS" v={sprints} big={22} />}</div>
          <Range min={todayMin + sec / 60} light />
          <div className="row g12"><button className="cta grow" onClick={() => setPaused(!paused)}><Ic n={paused ? 'play' : 'pause'} c="#0F1B2D" />{paused ? 'Resume' : 'Pause'}</button><button className="cta white grow" onClick={finish}>Finish</button></div>
        </>) : (<>
          <div className="row between"><h2 className="white">Nice one, {dn}</h2><div className="num white">{miles.toFixed(2)} mi · {fmtTime(sec / 60)}</div></div>
          <div className="grid3"><Stat light l="AVG SPEED" v={mph(st ? st.avgSpeed : 0)} big={20} /><Stat light l="TOP SPEED" v={mph(st ? st.maxSpeed : 0)} big={20} /><Stat light l="SPRINTS" v={sprints} big={20} /><Stat light l="MOVING TIME" v={fmtTime((st ? Math.min(sec, st.movingSec) : 0) / 60)} big={20} /><Stat light l="RUN TIME" v={fmtTime((st ? st.runSec : 0) / 60)} big={20} /></div>
          <p className="speednote">Speeds are measured from the phone carried on the walk, so they are your speed together, not {dn}'s own. A connected collar is needed for that.{!live ? ' This was demo playback, so the timing is simulated.' : ''}</p>
          {doneForm}
        </>)}
      </div>
    </div>
  )
}
