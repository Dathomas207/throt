import React, { useEffect, useMemo, useRef, useState } from 'react'
import TrotMap from '../Map.jsx'
import { Ic, Paw, Av, Stat, Range, Card, whoName, ptsOf } from '../ui.jsx'
import { ROUTES, PLACES, DOG, PEOPLE, PACK, CONNECTIONS, WEIGHTS, HEALTH, dayLabel, fmtTime, haversine } from '../data.js'

export default function Explore({ setTab, setToast }) {
  const [sel, setSel] = useState('fresh')
  const [filter, setFilter] = useState('All')
  const filters = ['All', 'Off-leash', 'Fenced', 'Water']
  const pins = PLACES.filter((p) => filter === 'All' || p.tags.join(' ').toLowerCase().includes(filter.toLowerCase()))
  const p = PLACES.find((x) => x.id === sel) || pins[0]
  return (
    <div className="fill">
      <TrotMap pins={pins} selected={p && p.id} onPin={(x) => setSel(x.id)} className="abs" />
      <div className="over topbar"><div className="chips">{filters.map((f) => <button key={f} className={`chip ${filter === f ? 'on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}</div></div>
      {p && (
        <div className="sheet">
          <div className="grab" />
          <div className="row between top"><div><h2>{p.name}</h2><div className="meta">{p.kind}</div></div><div className="count"><b>{p.dogs}</b><span>dogs this week</span></div></div>
          <div className="tags">{p.tags.map((t) => <span key={t}>{t}</span>)}</div>
          <div className="topdog"><Av t={p.top[0]} s={32} bg="#C8F031" c="#0F1B2D" /><span><b>{p.top}</b> is top dog here with {p.topVisits} visits this week</span></div>
          {p.routes.length > 0 && <div className="eyebrow dark">POPULAR ROUTES</div>}
          {p.routes.map((k) => <button key={k} className="rrow" onClick={() => { try { sessionStorage.setItem('trot-route', k) } catch (e) {} setTab('record') }}><span className="ricon"><Ic n="map" s={20} c="#1F5AE8" /></span><span className="grow"><b>{ROUTES[k].name}</b><small>{ROUTES[k].note}</small></span><span className="num">{ROUTES[k].miles} mi</span></button>)}
          <button className="cta" onClick={() => { try { sessionStorage.setItem('trot-route', p.routes[0] || 'pond') } catch (e) {} setTab('record') }}>Walk Biscuit here</button>
        </div>
      )}
    </div>
  )
}
