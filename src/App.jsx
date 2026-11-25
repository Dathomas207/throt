import React, { useEffect, useMemo, useState } from 'react'
import { Ic, Paw, Av } from './ui.jsx'
import { PEOPLE, SEED, CONNECTIONS } from './data.js'
import Home from './screens/Home.jsx'
import Explore from './screens/Explore.jsx'
import Record from './screens/Record.jsx'
import People from './screens/People.jsx'
import DogTab from './screens/DogTab.jsx'
import Detail from './screens/Detail.jsx'

const KEY = 'trot-demo-v1'
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch (e) { return {} } }

export default function App() {
  const saved = useMemo(load, [])
  const [tab, setTab] = useState('home')
  const [me, setMe] = useState(saved.me || 'dale')
  const [mine, setMine] = useState(saved.mine || [])
  const [pawed, setPawed] = useState(saved.pawed || {})
  const [conn, setConn] = useState(saved.conn || Object.fromEntries(CONNECTIONS.map((c) => [c.id, !!c.on])))
  const [open, setOpen] = useState(null)
  const [toast, setToast] = useState('')
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ me, mine, pawed, conn })) } catch (e) {} }, [me, mine, pawed, conn])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t) }, [toast])
  const acts = useMemo(() => [...mine, ...SEED], [mine])
  const week = useMemo(() => {
    const by = {}; let total = 0
    acts.filter((a) => a.daysAgo <= 6).forEach((a) => { const p = by[a.by] || (by[a.by] = { min: 0, n: 0, mi: 0 }); p.min += a.minutes; p.n += 1; p.mi += a.miles; total += a.minutes })
    return { by, total, miles: acts.filter((a) => a.daysAgo <= 6).reduce((s, a) => s + a.miles, 0), walks: acts.filter((a) => a.daysAgo <= 6).length }
  }, [acts])
  const todayMin = acts.filter((a) => a.daysAgo === 0 && a.type !== 'Daycare').reduce((s, a) => s + a.minutes, 0)
  const paw = (id) => setPawed((p) => ({ ...p, [id]: !p[id] }))
  const saveWalk = (a) => { setMine((m) => [a, ...m]); setTab('home'); setOpen(a) }
  const ctx = { saveWalk, me, setMe, acts, week, todayMin, pawed, paw, conn, setConn, setOpen, setTab, setToast, mine, setMine }
  const reset = () => { setMine([]); setPawed({}); setMe('dale'); setConn(Object.fromEntries(CONNECTIONS.map((c) => [c.id, !!c.on]))); setToast('Demo reset') }
  return (
    <div className="shell">
      <main className="screen">
        {tab === 'home' && <Home {...ctx} />}
        {tab === 'explore' && <Explore {...ctx} />}
        {tab === 'record' && <Record {...ctx} />}
        {tab === 'people' && <People {...ctx} />}
        {tab === 'dog' && <DogTab {...ctx} reset={reset} />}
      </main>
      {tab !== 'record' && (
        <nav className="tabs" aria-label="Main">
          <Tab on={tab === 'home'} l="Home" i="home" go={() => setTab('home')} />
          <Tab on={tab === 'explore'} l="Explore" i="map" go={() => setTab('explore')} />
          <button className="rec" aria-label="Walk Biscuit" onClick={() => setTab('record')}><Paw s={28} c="#0F1B2D" /></button>
          <Tab on={tab === 'people'} l="People" i="users" go={() => setTab('people')} />
          <button className={`tab ${tab === 'dog' ? 'on' : ''}`} onClick={() => setTab('dog')}><Av t="B" s={24} bg={tab === 'dog' ? '#0F1B2D' : '#5B6472'} c="#fff" /><span>Biscuit</span></button>
        </nav>
      )}
      {open && <Detail a={open} {...ctx} close={() => setOpen(null)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
const Tab = ({ on, l, i, go }) => <button className={`tab ${on ? 'on' : ''}`} onClick={go}><Ic n={i} /><span>{l}</span></button>
