import React, { useEffect, useMemo, useRef, useState } from 'react'
import TrotMap from '../Map.jsx'
import { Ic, Paw, Av, Stat, Range, Card, whoName, ptsOf } from '../ui.jsx'
import { ROUTES, PLACES, DOG, PEOPLE, PACK, CONNECTIONS, WEIGHTS, HEALTH, dayLabel, fmtTime, haversine } from '../data.js'

const SPEED = 40
export default function Record({ me, conn, setTab, saveWalk, todayMin, setToast }) {
  const first = (() => { try { const k = sessionStorage.getItem('trot-route'); sessionStorage.removeItem('trot-route'); return k && ROUTES[k] ? k : 'pond' } catch (e) { return 'pond' } })
  const [mode, setMode] = useState('setup')
  const [type, setType] = useState('Walk')
  const [rk, setRk] = useState(first)
  const [paused, setPaused] = useState(false)
  const [sec, setSec] = useState(0)
  const [gps, setGps] = useState([])
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const live = rk === 'gps', r = ROUTES[rk]
  const watch = useRef(null), dist = useRef(0)
  useEffect(() => {
    if (mode !== 'run' || paused) return
    const t = setInterval(() => setSec((s) => s + (live ? 1 : SPEED) * 0.25), 250)
    return () => clearInterval(t)
  }, [mode, paused, live])
  useEffect(() => {
    if (mode !== 'run' || !live) return
    try {
      watch.current = navigator.geolocation.watchPosition((p) => setGps((g) => { const n = [p.coords.latitude, p.coords.longitude]; if (g.length) dist.current += haversine(g[g.length - 1], n); return [...g, n] }), () => { setToast('Location is unavailable here. Use a demo route.'); setMode('setup'); setRk('pond') }, { enableHighAccuracy: true, maximumAge: 2000 })
    } catch (e) { setToast('Location is unavailable here. Use a demo route.'); setMode('setup'); setRk('pond') }
    return () => { try { navigator.geolocation.clearWatch(watch.current) } catch (e) {} }
  }, [mode, live])
  const total = live ? 0 : r.minutes * 60
  const prog = live ? 0 : Math.min(1, sec / total)
  const idx = live ? null : Math.floor(prog * (r.pts.length - 1))
  const miles = live ? dist.current : r.miles * prog
  const sniffs = Math.floor((sec / 60) / 3.4)
  useEffect(() => { if (!live && mode === 'run' && prog >= 1) finish() }, [prog])
  const pace = miles > 0.05 ? fmtTime(sec / 60 / miles) + ' /mi' : '--'
  const finish = () => { setPaused(true); const h = new Date().getHours(); setTitle(`${h < 11 ? 'Morning' : h < 15 ? 'Midday' : h < 19 ? 'Evening' : 'Night'} ${type.toLowerCase()}${live ? '' : ' at ' + r.name.split(' ')[0] + ' ' + (r.name.split(' ')[1] || '')}`.trim()); setMode('done') }
  const save = () => {
    const a = { id: 'm' + Date.now(), dog: 'Biscuit', by: me, type, title: title || type, daysAgo: 0, time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), place: live ? 'Live GPS' : r.name, route: live ? null : rk, pts: live ? gps : r.pts.slice(0, Math.max(2, idx + 1)), miles: Math.round(miles * 100) / 100, minutes: sec / 60, sniffs, paws: 0, comments: 0, note }
    saveWalk(a)
  }
  const meP = PEOPLE[me]
  if (mode === 'setup') return (
    <div className="scroll pad">
      <header className="row g10"><button className="round" aria-label="Close" onClick={() => setTab('home')}><Ic n="x" /></button><h1 className="h1">Walk Biscuit</h1></header>
      <div className="who"><Av t="B" s={64} bg="#C8F031" c="#0F1B2D" /><div className="plus">+</div><Av t={meP.name[0]} s={44} bg={meP.color} c={meP.ink} /><div><div className="dogname">Biscuit</div><div className="meta">going out with {meP.name}</div></div></div>
      {conn.tag && <div className="hint"><Ic n="tag" s={18} c="#1F5AE8" />Trot Tag heard nearby. Biscuit was added automatically.</div>}
      <div className="eyebrow dark">ACTIVITY</div>
      <div className="chips wrap">{['Walk', 'Hike', 'Run', 'Swim', 'Fetch', 'Training', 'Dog park'].map((t) => <button key={t} className={`chip flat ${type === t ? 'on' : ''}`} aria-pressed={type === t} onClick={() => setType(t)}>{t}</button>)}</div>
      <div className="eyebrow dark">ROUTE</div>
      {Object.entries(ROUTES).map(([k, x]) => <button key={k} className={`rrow box ${rk === k ? 'on' : ''}`} aria-pressed={rk === k} onClick={() => setRk(k)}><span className="ricon"><Ic n="map" s={20} c="#1F5AE8" /></span><span className="grow"><b>{x.name}</b><small>Demo playback · {x.note}</small></span><span className="num">{x.miles} mi</span></button>)}
      <button className={`rrow box ${live ? 'on' : ''}`} aria-pressed={live} onClick={() => setRk('gps')}><span className="ricon"><Ic n="play" s={18} c="#1F5AE8" /></span><span className="grow"><b>Live GPS</b><small>Records your real location. Works in the deployed app.</small></span></button>
      <Range min={todayMin} />
      <button className="cta sticky" onClick={() => { setSec(0); dist.current = 0; setGps([]); setPaused(false); setMode('run') }}>Start</button>
    </div>
  )
  return (
    <div className="fill navy">
      <TrotMap route={live ? gps : r.pts} upto={live ? null : idx} live className="abs" interactive={false} />
      <div className="over topbar row g8">
        <div className="pill"><Av t="B" s={30} />Biscuit{conn.tag && <Ic n="tag" s={16} c="#1F5AE8" />}</div>
        <div className="pill">with {meP.name}</div>
        {!live && <div className="pill dark">Demo ×{SPEED}</div>}
      </div>
      <div className="panel">
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
