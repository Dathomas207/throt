import React, { useEffect, useRef, useState } from 'react'
import TrotMap, { useHeight } from '../Map.jsx'
import { Ic, Av, Stat, Range } from '../ui.jsx'
import { ROUTES, PEOPLE, fmtTime, haversine } from '../data.js'
import { routeLoop, locate, takeHandoff, DEFAULT_CENTER } from '../routing.js'
import '../maps.css'

const SPEED = 40
const LOOPS = [1, 2, 3]
const MAX_ACCURACY_M = 40 // ignore GPS fixes less certain than this
const MIN_STEP_M = 4 // ignore movement smaller than this to cut jitter
const METERS_PER_MILE = 1609.344
export default function Record({ me, conn, setTab, saveWalk, todayMin, setToast }) {
  const [hand] = useState(() => { const h = takeHandoff(); return h && h.kind === 'demo' && !ROUTES[h.key] ? null : h })
  const [mode, setMode] = useState('setup')
  const [type, setType] = useState('Walk')
  // rk is 'handoff' (route from Explore), 'loop' (loop from here), 'gps', or a demo key from ROUTES.
  const [rk, setRk] = useState(() => (!hand ? 'pond' : hand.kind === 'demo' ? hand.key : 'handoff'))
  const [loop, setLoop] = useState(null)
  const [paused, setPaused] = useState(false)
  const [sec, setSec] = useState(0)
  const [gps, setGps] = useState([])
  const [weak, setWeak] = useState(false)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [panelRef, panelH] = useHeight()
  const live = rk === 'gps'
  const r = live ? null : rk === 'handoff' ? hand : rk === 'loop' ? (loop && loop.status === 'ready' ? loop.route : null) : ROUTES[rk]
  const watch = useRef(null), dist = useRef(0), last = useRef(null), fixes = useRef(0), pausedRef = useRef(false), here = useRef(null), loopReq = useRef(0), alive = useRef(true), lock = useRef(null)
  pausedRef.current = paused
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (mode !== 'run' || paused) return
    const t = setInterval(() => setSec((s) => s + (live ? 1 : SPEED) * 0.25), 250)
    return () => clearInterval(t)
  }, [mode, paused, live])
  useEffect(() => {
    if (mode !== 'run' || !live) return
    const bail = () => { setToast('Location is unavailable here. Use a demo route.'); setMode('setup'); setRk('pond') }
    const onFix = (p) => {
      if (pausedRef.current) { last.current = null; return }
      if (!(p.coords.accuracy <= MAX_ACCURACY_M)) { setWeak(true); return }
      const n = [p.coords.latitude, p.coords.longitude]
      if (last.current) {
        const step = haversine(last.current, n)
        if (step * METERS_PER_MILE < MIN_STEP_M) return
        dist.current += step
      }
      last.current = n; fixes.current++
      setWeak(false); setGps((g) => [...g, n])
    }
    // A lost signal in the middle of a walk should not throw the recording away.
    const onErr = (e) => { if (fixes.current === 0 || (e && e.code === 1)) bail(); else setWeak(true) }
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
  const buildLoop = async (miles) => {
    const id = ++loopReq.current
    setRk('loop'); setLoop({ miles, status: 'loading' })
    if (!here.current) here.current = await locate(6000)
    const start = here.current || DEFAULT_CENTER
    const rt = await routeLoop(start, miles)
    if (!alive.current || id !== loopReq.current) return
    setLoop({ miles, status: 'ready', located: !!here.current, route: { ...rt, name: `${rt.miles.toFixed(1)} mi loop from ${here.current ? 'here' : 'Cambridge'}`, place: here.current ? 'Loop from here' : 'Cambridge loop' } })
  }
  const total = r ? r.minutes * 60 : 0
  const prog = r ? Math.min(1, sec / total) : 0
  const idx = r ? Math.floor(prog * (r.pts.length - 1)) : null
  const miles = live ? dist.current : r ? r.miles * prog : 0
  const sniffs = Math.floor((sec / 60) / 3.4)
  useEffect(() => { if (!live && mode === 'run' && prog >= 1) finish() }, [prog])
  const pace = miles > 0.05 ? fmtTime(sec / 60 / miles) + ' /mi' : '--'
  const demoKey = !live && rk !== 'handoff' && rk !== 'loop' ? rk : null
  const titleAt = live || rk === 'loop' ? '' : demoKey ? r.name.split(' ')[0] + ' ' + (r.name.split(' ')[1] || '') : r.place || ''
  const finish = () => { setPaused(true); const h = new Date().getHours(); setTitle(`${h < 11 ? 'Morning' : h < 15 ? 'Midday' : h < 19 ? 'Evening' : 'Night'} ${type.toLowerCase()}${titleAt ? ' at ' + titleAt : ''}`.trim()); setMode('done') }
  const save = () => {
    const a = { id: 'm' + Date.now(), dog: 'Biscuit', by: me, type, title: title || type, daysAgo: 0, time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), place: live ? 'Live GPS' : r.place || r.name, route: demoKey, pts: live ? (gps.length > 1 ? gps : null) : r.pts.slice(0, Math.max(2, idx + 1)), miles: Math.round(miles * 100) / 100, minutes: sec / 60, sniffs, paws: 0, comments: 0, note }
    saveWalk(a)
  }
  const start = () => { setSec(0); dist.current = 0; last.current = null; fixes.current = 0; setGps([]); setWeak(false); setPaused(false); setMode('run') }
  const canStart = live || !!r
  const meP = PEOPLE[me]
  if (mode === 'setup') return (
    <div className="scroll pad">
      <header className="row g10"><button className="round" aria-label="Close" onClick={() => setTab('home')}><Ic n="x" /></button><h1 className="h1">Walk Biscuit</h1></header>
      <div className="who"><Av t="B" s={64} bg="#C8F031" c="#0F1B2D" /><div className="plus">+</div><Av t={meP.name[0]} s={44} bg={meP.color} c={meP.ink} /><div><div className="dogname">Biscuit</div><div className="meta">going out with {meP.name}</div></div></div>
      {conn.tag && <div className="hint"><Ic n="tag" s={18} c="#1F5AE8" />Trot Tag heard nearby. Biscuit was added automatically.</div>}
      <div className="eyebrow dark">ACTIVITY</div>
      <div className="chips wrap">{['Walk', 'Hike', 'Run', 'Swim', 'Fetch', 'Training', 'Dog park'].map((t) => <button key={t} className={`chip flat ${type === t ? 'on' : ''}`} aria-pressed={type === t} onClick={() => setType(t)}>{t}</button>)}</div>
      <div className="eyebrow dark">ROUTE</div>
      {hand && hand.kind === 'routed' && <button className={`rrow box ${rk === 'handoff' ? 'on' : ''}`} aria-pressed={rk === 'handoff'} onClick={() => setRk('handoff')}><span className="ricon"><Ic n="map" s={20} c="#1F5AE8" /></span><span className="grow"><b>{hand.name}</b><small>From Explore · {hand.approximate ? 'approximate loop, not a mapped path' : 'routed on mapped paths'} · about {hand.minutes} min</small></span><span className="num">{hand.miles.toFixed(1)} mi</span></button>}
      <div className={`rrow box lbox ${rk === 'loop' ? 'on' : ''}`}>
        <div className="row g12"><span className="ricon"><Ic n="map" s={20} c="#1F5AE8" /></span><span className="grow"><b>Loop from here</b><small>A real walking loop from your location, routed on mapped paths.</small></span>{rk === 'loop' && loop && loop.status === 'ready' && <span className="num">{loop.route.miles.toFixed(1)} mi</span>}</div>
        <div className="loops">{LOOPS.map((m) => <button key={m} className={`chip flat ${rk === 'loop' && loop && loop.miles === m ? 'on' : ''}`} aria-pressed={!!(rk === 'loop' && loop && loop.miles === m)} onClick={() => buildLoop(m)}><b>{m}</b> mi</button>)}</div>
        {rk === 'loop' && loop && loop.status === 'loading' && <div className="mload" role="status"><span className="spin" aria-hidden="true" />Building a {loop.miles} mile loop</div>}
        {rk === 'loop' && loop && loop.status === 'ready' && !loop.located && <div className="mnote info"><span className="grow">Location is unavailable, so this loop starts from the default spot in Cambridge, MA.</span></div>}
        {rk === 'loop' && loop && loop.status === 'ready' && loop.route.approximate && <div className="mnote"><span className="grow"><b>Approximate loop.</b> The routing service did not answer, so this is a simple circle, not a walkable path.</span><button onClick={() => buildLoop(loop.miles)}>Retry</button></div>}
      </div>
      <button className={`rrow box ${live ? 'on' : ''}`} aria-pressed={live} onClick={() => setRk('gps')}><span className="ricon"><Ic n="play" s={18} c="#1F5AE8" /></span><span className="grow"><b>Live GPS</b><small>Records your real location and keeps the screen awake. Works in the deployed app.</small></span></button>
      <div className="eyebrow dark">DEMO PLAYBACK (SAMPLE ROUTES)</div>
      {Object.entries(ROUTES).map(([k, x]) => <button key={k} className={`rrow box ${rk === k ? 'on' : ''}`} aria-pressed={rk === k} onClick={() => setRk(k)}><span className="ricon"><Ic n="map" s={20} c="#1F5AE8" /></span><span className="grow"><b>{x.name}</b><small>Sample route, not a mapped path · {x.note}</small></span><span className="num">{x.miles} mi</span></button>)}
      <Range min={todayMin} />
      <button className="cta sticky" disabled={!canStart} onClick={start}>{canStart ? 'Start' : rk === 'loop' && loop ? 'Building route' : 'Start'}</button>
    </div>
  )
  return (
    <div className="fill navy">
      <TrotMap route={live ? gps : r.pts} upto={live ? null : idx} live bottom={panelH} className="abs" interactive={false} />
      <div className="over topbar row g8">
        <div className="pill"><Av t="B" s={30} />Biscuit{conn.tag && <Ic n="tag" s={16} c="#1F5AE8" />}</div>
        <div className="pill">with {meP.name}</div>
        {!live && <div className="pill dark">Demo ×{SPEED}</div>}
        {live && mode === 'run' && (weak || gps.length === 0) && <div className="pill gpswait" role="status">Waiting for a good GPS fix</div>}
      </div>
      <div className="panel" ref={panelRef}>
        {mode === 'run' ? (<>
          <div className="center"><div className="sl lightl">TIME</div><div className="clock">{fmtTime(sec / 60)}</div></div>
          <div className="grid3"><Stat light l="DISTANCE" v={miles.toFixed(2) + ' mi'} big={24} /><Stat light l="PACE" v={pace} big={24} /><Stat light l="SNIFF STOPS" v={sniffs} big={24} /></div>
          <Range min={todayMin + sec / 60} light />
          <div className="row g12"><button className="cta grow" onClick={() => setPaused(!paused)}><Ic n={paused ? 'play' : 'pause'} c="#0F1B2D" />{paused ? 'Resume' : 'Pause'}</button><button className="cta white grow" onClick={finish}>Finish</button></div>
        </>) : (<>
          <div className="row between"><h2 className="white">Nice one, Biscuit</h2><div className="num white">{miles.toFixed(2)} mi · {fmtTime(sec / 60)}</div></div>
          <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="field"><span>How did Biscuit do?</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Found a stick, met a friend…" /></label>
          <div className="row g12"><button className="cta white grow" onClick={() => setTab('home')}>Discard</button><button className="cta grow" onClick={save}>Save to Biscuit</button></div>
        </>)}
      </div>
    </div>
  )
}
