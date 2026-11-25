import React, { useEffect, useRef, useState } from 'react'
import { Paw } from '../ui.jsx'
import './welcome.css'

// A small live scene for the landing screen: a walk draws itself on a map, the dog trots along it,
// the stats count up, and tapping the dog gives it a paw.
const ROUTE = 'M46 168 C30 120 62 78 110 72 C150 66 168 104 204 96 C246 86 262 44 296 58 C326 70 318 122 286 142 C250 164 214 138 176 158 C136 180 84 204 46 168 Z'
const WALKERS = [{ n: 'Dale', bg: '#C8F031', ink: '#0F1B2D' }, { n: 'Pat', bg: '#1F5AE8', ink: '#FFFFFF' }, { n: 'Sue', bg: '#FF8A5B', ink: '#0F1B2D' }]
const STOPS = [0.18, 0.41, 0.63, 0.86]
const LOOP_MS = 9000

export default function WelcomeHero() {
  const path = useRef(null)
  const [t, setT] = useState(0)
  const [lap, setLap] = useState(0)
  const [pos, setPos] = useState({ x: 46, y: 168 })
  const [stops, setStops] = useState([])
  const [paws, setPaws] = useState(23)
  const [bursts, setBursts] = useState([])
  const [boop, setBoop] = useState(false)
  useEffect(() => {
    const el = path.current; if (!el) return
    const len = el.getTotalLength()
    setStops(STOPS.map((s) => { const p = el.getPointAtLength(s * len); return { s, x: p.x, y: p.y } }))
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still) { const p = el.getPointAtLength(0.72 * len); setT(0.72); setPos({ x: p.x, y: p.y }); return }
    let raf, start = performance.now(), last = 0, laps = 0
    const tick = (now) => {
      raf = requestAnimationFrame(tick)
      if (now - last < 33) return
      last = now
      const e = now - start, n = Math.floor(e / LOOP_MS), k = Math.min(1, ((e % LOOP_MS) / LOOP_MS) / 0.9)
      if (n !== laps) { laps = n; setLap(n) }
      const p = el.getPointAtLength(k * len)
      setT(k); setPos({ x: p.x, y: p.y })
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  const give = () => {
    const id = Date.now() + Math.random()
    setPaws((n) => n + 1); setBoop(true)
    setBursts((b) => [...b.slice(-5), { id, dx: Math.round(Math.random() * 40 - 20) }])
    setTimeout(() => setBoop(false), 420)
    setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 900)
  }
  const w = WALKERS[lap % WALKERS.length]
  const min = 48 * t, mm = Math.floor(min), ss = String(Math.floor((min - mm) * 60)).padStart(2, '0')
  return (
    <div className="whero">
      <div className="wscene">
        <svg viewBox="0 0 340 230" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
          <rect width="340" height="230" fill="#16263F" />
          <path d="M-10 40 C60 10 130 60 200 26 S320 -6 350 22 V-10 H-10z" fill="#1B3A3C" />
          <path d="M-10 200 C70 176 150 226 350 190 V240 H-10z" fill="#1B3A3C" />
          <ellipse cx="178" cy="124" rx="52" ry="22" fill="#1D3F73" />
          <path d="M-10 214 H350 M84 -10 V240 M262 -10 V240" stroke="#FFFFFF" strokeOpacity=".06" strokeWidth="6" />
          <path d={ROUTE} fill="none" stroke="#FFFFFF" strokeOpacity=".14" strokeWidth="4" strokeDasharray="2 8" strokeLinecap="round" />
          <path ref={path} d={ROUTE} pathLength="1" fill="none" stroke="#C8F031" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1" strokeDashoffset={1 - t} />
          {stops.filter((s) => t >= s.s).map((s) => <g key={s.s}><circle cx={s.x} cy={s.y} r="9" fill="#C8F031" fillOpacity=".18" /><circle cx={s.x} cy={s.y} r="4" fill="#FFFFFF" /></g>)}
          <circle cx="46" cy="168" r="6" fill="#FFFFFF" stroke="#0F1B2D" strokeWidth="3" />
        </svg>
        <div className="wchip" key={lap}><span className="wav" style={{ background: w.bg, color: w.ink }}>{w.n[0]}</span><span><b>Biscuit</b> with {w.n}</span></div>
        <button className={`wdog ${boop ? 'boop' : ''}`} style={{ left: (pos.x / 340) * 100 + '%', top: (pos.y / 230) * 100 + '%' }} onClick={give} aria-label="Give Biscuit a paw">
          <Paw s={26} c="#0F1B2D" />
          {bursts.map((b) => <span key={b.id} className="wplus" style={{ '--dx': b.dx + 'px' }}>+1</span>)}
        </button>
      </div>
      <div className="wstats">
        <div><span>DISTANCE</span><b>{(2.4 * t).toFixed(1)} mi</b></div>
        <div><span>TIME</span><b>{mm}:{ss}</b></div>
        <div><span>SNIFF STOPS</span><b>{stops.filter((s) => t >= s.s).length}</b></div>
        <div aria-live="polite"><span>PAWS</span><b>{paws}</b></div>
      </div>
      <p className="whint">Tap Biscuit to give a paw.</p>
    </div>
  )
}
