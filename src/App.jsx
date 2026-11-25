import React, { useEffect, useMemo, useRef, useState } from 'react'
import TrotMap, { RouteThumb } from './Map.jsx'
import { ROUTES, PLACES, DOG, PEOPLE, SEED, PACK, CONNECTIONS, WEIGHTS, HEALTH, dayLabel, fmtTime, haversine } from './data.js'
import { drawCard, shareCard } from './share.js'

const P = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z', map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  users: 'M9 11.5a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7zM2.500 20c.5-4 3-6 6.500-6s6 2 6.500 6M16 5a3.500 3.500 0 0 1 0 7M18.500 14.500c1.800.8 2.800 2.600 3 5.500',
  back: 'M15 5l-7 7 7 7', share: 'M12 15V3M8 7l4-4 4 4M5 12v8h14v-8', chat: 'M4 5h16v11H9l-5 4z', plus: 'M12 5v14M5 12h14', check: 'M5 12.500l4.500 4.500L19 7.500',
  tag: 'M3 12V4h8l10 10-8 8zM7.500 9.250a.75.75 0 1 0 0-1.500.75.75 0 0 0 0 1.500z', pause: 'M8 5v14M16 5v14', play: 'M7 4l13 8-13 8z', x: 'M6 6l12 12M18 6L6 18', link: 'M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1',
  heart: 'M12 20s-7-4.400-7-10a4 4 0 0 1 7-2.600A4 4 0 0 1 19 10c0 5.600-7 10-7 10z',
}
const Ic = ({ n, s = 22, c = 'currentColor', f = 'none' }) => <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill={f} stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={P[n]} /></svg>
const Paw = ({ s = 22, c = 'currentColor', f = 'none' }) => <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill={f} stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="11" r="1.800" /><circle cx="10" cy="6.500" r="1.800" /><circle cx="14" cy="6.500" r="1.800" /><circle cx="18" cy="11" r="1.800" /><path d="M12 12c-3 0-5 2.500-5 4.800 0 1.600 1.300 2.200 2.600 2.200.9 0 1.600-.5 2.400-.5s1.500.5 2.400.5c1.300 0 2.600-.6 2.600-2.200 0-2.300-2-4.800-5-4.800z" /></svg>
const Av = ({ t, s = 40, bg = '#0F1B2D', c = '#C8F031', sq }) => <span className="av" style={{ width: s, height: s, background: bg, color: c, fontSize: s * 0.42, borderRadius: sq ? 10 : '50%' }}>{t}</span>
const Stat = ({ l, v, big, light }) => <div className={`stat ${light ? 'light' : ''}`}><div className="sl">{l}</div><div className="sv" style={big ? { fontSize: big } : null}>{v}</div></div>
const KEY = 'trot-demo-v1'
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch (e) { return {} } }
const whoName = (a) => a.byName || (PEOPLE[a.by] ? PEOPLE[a.by].name : '')
const ptsOf = (a) => a.pts || (a.route && ROUTES[a.route] ? ROUTES[a.route].pts : null)

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
  const ctx = { me, setMe, acts, week, todayMin, pawed, paw, conn, setConn, setOpen, setTab, setToast, mine, setMine }
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

function Range({ min, light }) {
  const pct = Math.min(100, Math.round((min / DOG.rangeMax) * 100))
  const msg = min < DOG.rangeMin ? `${DOG.rangeMin - Math.round(min)} min to go` : min <= DOG.rangeMax ? 'In the sweet spot' : 'Plenty for today. Time to rest.'
  return (
    <div className={`range ${light ? 'light' : ''}`}>
      <div className="row between"><span>Today's healthy range</span><span><b>{Math.round(min)}</b> of {DOG.rangeMin} to {DOG.rangeMax} min · {msg}</span></div>
      <div className="bar"><i style={{ width: pct + '%', background: min > DOG.rangeMax ? '#FF8A5B' : undefined }} /><em style={{ left: (DOG.rangeMin / DOG.rangeMax) * 100 + '%' }} /></div>
    </div>
  )
}

function Card({ a, pawed, paw, setOpen }) {
  const p = PEOPLE[a.by], pts = ptsOf(a), n = a.paws + (pawed[a.id] ? 1 : 0)
  return (
    <article className="card">
      <button className="cardtop" onClick={() => setOpen(a)}>
        <div className="row g10">
          <Av t={a.dog[0]} bg={a.color || '#0F1B2D'} c={a.ink || '#C8F031'} />
          <div className="grow"><div className="dogname">{a.dog}</div><div className="meta">{a.type === 'Daycare' ? 'at' : 'with'} <b>{whoName(a)}</b> · {dayLabel(a.daysAgo)} {a.time} · {a.place}</div></div>
          {p && <Av t={p.name[0]} s={28} bg={p.color} c={p.ink} />}
        </div>
        <div className="title">{a.title}</div>
        <div className="row g28">{a.miles > 0 && <Stat l="DISTANCE" v={a.miles.toFixed(1) + ' mi'} />}<Stat l="TIME" v={fmtTime(a.minutes)} />{a.sniffs > 0 && <Stat l="SNIFF STOPS" v={a.sniffs} />}</div>
        {a.note && <p className="note">{a.note}</p>}
      </button>
      {pts && <button className="thumbbtn" aria-label={`Open map for ${a.title}`} onClick={() => setOpen(a)}><RouteThumb pts={pts} /></button>}
      <div className="row actions">
        <button className={`act ${pawed[a.id] ? 'on' : ''}`} aria-pressed={!!pawed[a.id]} onClick={() => paw(a.id)}><Paw s={20} f={pawed[a.id] ? '#1F5AE8' : 'none'} c={pawed[a.id] ? '#1F5AE8' : 'currentColor'} />{n} paws</button>
        <button className="act" onClick={() => setOpen(a)}><Ic n="chat" s={20} />{a.comments}</button>
        <button className="act end" aria-label="Share" onClick={() => setOpen(a)}><Ic n="share" s={20} /></button>
      </div>
    </article>
  )
}

function Home({ acts, week, todayMin, pawed, paw, setOpen, setTab, me }) {
  const [feed, setFeed] = useState('biscuit')
  const list = feed === 'biscuit' ? acts : [...PACK, ...acts].sort((a, b) => a.daysAgo - b.daysAgo)
  return (
    <div className="scroll">
      <header className="top"><div className="logo">TROT</div><div className="meta">Signed in as {PEOPLE[me].name}</div></header>
      <section className="hero">
        <div className="row g14"><Av t="B" s={56} bg="#C8F031" c="#0F1B2D" /><div className="grow"><div className="eyebrow">BISCUIT THIS WEEK</div><div className="row g20"><Stat light l="MILES" v={week.miles.toFixed(1)} /><Stat light l="OUTINGS" v={week.walks} /><Stat light l="STREAK" v={DOG.streak + ' d'} /></div></div></div>
        <Range min={todayMin} light />
        <button className="cta" onClick={() => setTab('record')}><Paw s={22} c="#0F1B2D" />Walk Biscuit</button>
      </section>
      <div className="seg" role="tablist"><button role="tab" aria-selected={feed === 'biscuit'} className={feed === 'biscuit' ? 'on' : ''} onClick={() => setFeed('biscuit')}>Biscuit</button><button role="tab" aria-selected={feed === 'pack'} className={feed === 'pack' ? 'on' : ''} onClick={() => setFeed('pack')}>The pack</button></div>
      <div className="list">{list.map((a) => <Card key={a.id} a={a} pawed={pawed} paw={paw} setOpen={setOpen} />)}</div>
    </div>
  )
}

function Explore({ setTab, setToast }) {
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

const SPEED = 40
function Record({ me, conn, setTab, setMine, setOpen, todayMin, setToast }) {
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
    setMine((m) => [a, ...m]); setTab('home'); setOpen(a)
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

function People({ week, me, setMe, setToast }) {
  const rows = Object.values(PEOPLE).map((p) => ({ ...p, ...(week.by[p.id] || { min: 0, n: 0, mi: 0 }) })).sort((a, b) => b.min - a.min)
  const mine = week.by[me] || { min: 0, n: 0, mi: 0 }
  const share = week.total ? Math.round((mine.min / week.total) * 100) : 0
  return (
    <div className="scroll">
      <header className="top"><h1 className="h1">Biscuit's people</h1></header>
      <section className="hero">
        <div className="eyebrow">YOUR WEEK WITH BISCUIT, {PEOPLE[me].name.toUpperCase()}</div>
        <div className="row g20"><Stat light l="TIME TOGETHER" v={fmtTime(mine.min)} big={30} /><Stat light l="OUTINGS" v={mine.n} big={30} /><Stat light l="MILES" v={mine.mi.toFixed(1)} big={30} /></div>
        <div className="lovebar" aria-label="Share of Biscuit's week by person">{rows.filter((r) => r.min > 0).map((r) => <i key={r.id} style={{ width: (r.min / week.total) * 100 + '%', background: r.color === '#0F1B2D' ? '#5B6472' : r.color }} />)}</div>
        <div className="meta lightm"><Ic n="heart" s={14} c="#C8F031" f="#C8F031" /> You gave Biscuit {share}% of this week's time out and about.</div>
      </section>
      <div className="list">
        <div className="eyebrow dark padx">THIS WEEK</div>
        {rows.map((r) => (
          <div key={r.id} className="card prow">
            <Av t={r.name[0]} s={44} bg={r.color} c={r.ink} sq={r.id === 'tails'} />
            <div className="grow"><div className="row between"><b>{r.name}{r.id === me && <span className="you">You</span>}</b><span className="num">{week.total ? Math.round((r.min / week.total) * 100) : 0}%</span></div><div className="meta">{r.role}</div><div className="bar thin"><i style={{ width: (week.total ? (r.min / week.total) * 100 : 0) + '%' }} /></div><div className="meta">{r.n} {r.n === 1 ? "outing" : "outings"} · {fmtTime(r.min)} · {r.mi.toFixed(1)} mi</div></div>
          </div>
        ))}
        <button className="rrow box" onClick={() => setToast('Invite link copied (demo)')}><span className="ricon"><Ic n="plus" s={20} c="#1F5AE8" /></span><span className="grow"><b>Add someone to Biscuit's team</b><small>Walkers, family, daycare, the vet</small></span></button>
        <div className="eyebrow dark padx">DEMO: VIEW THE APP AS</div>
        <div className="chips wrap padx">{['dale', 'pat', 'sue'].map((id) => <button key={id} className={`chip flat ${me === id ? 'on' : ''}`} aria-pressed={me === id} onClick={() => { setMe(id); setToast(`Now signed in as ${PEOPLE[id].name}`) }}>{PEOPLE[id].name}</button>)}</div>
      </div>
    </div>
  )
}

function DogTab({ acts, week, todayMin, pawed, paw, setOpen, conn, setConn, setToast, reset }) {
  const [sub, setSub] = useState('Activity')
  const [sheet, setSheet] = useState(null)
  const [vet, setVet] = useState(false)
  const days = [...Array(7)].map((_, i) => { const d = 6 - i; return { d, min: acts.filter((a) => a.daysAgo === d && a.type !== 'Daycare').reduce((s, a) => s + a.minutes, 0), l: new Date(Date.now() - d * 864e5).toLocaleDateString('en-US', { weekday: 'narrow' }) } })
  const max = Math.max(...days.map((d) => d.min), 1)
  const lo = Math.min(...WEIGHTS.map((w) => w[1])) - 0.5, hi = Math.max(...WEIGHTS.map((w) => w[1])) + 0.5
  const groups = [...new Set(CONNECTIONS.map((c) => c.group))]
  return (
    <div className="scroll">
      <section className="prof">
        <div className="row g16"><div className="photo">[PHOTO]</div><div className="grow"><div className="bigname">BISCUIT</div><div className="lightm">{DOG.breed} · {DOG.age} · {DOG.weight} lb</div><div className="lightm">{DOG.home}</div></div></div>
        <p className="lightm bio">{DOG.bio}</p>
        <div className="row g20"><Stat light l="FOLLOWERS" v={DOG.followers} big={20} /><Stat light l="LIFETIME" v={DOG.lifetime.toLocaleString() + ' mi'} big={20} /><Stat light l="STREAK" v={DOG.streak + ' d'} big={20} /></div>
      </section>
      <div className="subtabs" role="tablist">{['Activity', 'Health', 'Connections'].map((t) => <button key={t} role="tab" aria-selected={sub === t} className={sub === t ? 'on' : ''} onClick={() => setSub(t)}>{t}</button>)}</div>
      {sub === 'Activity' && <div className="list">
        <div className="card padc"><div className="row between"><b>This week</b><span className="meta">{week.miles.toFixed(1)} mi · {week.walks} outings</span></div><div className="bars">{days.map((d) => <div key={d.d}><i style={{ height: Math.max(4, (d.min / max) * 70), background: d.d === 0 ? '#1F5AE8' : '#C6D4F7' }} /><span>{d.l}</span></div>)}</div></div>
        {acts.map((a) => <Card key={a.id} a={a} pawed={pawed} paw={paw} setOpen={setOpen} />)}
      </div>}
      {sub === 'Health' && <div className="list">
        <div className="card padc"><Range min={todayMin} /><p className="meta">Range is a sample set from breed, age and weight. It is not veterinary advice.</p></div>
        <div className="card padc"><div className="row between"><b>Weight</b><span className="num">{DOG.weight} lb</span></div>
          <svg viewBox="0 0 320 90" className="chart" role="img" aria-label="Weight over six months, down from 70.1 to 68.0 pounds"><polyline fill="none" stroke="#1F5AE8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={WEIGHTS.map((w, i) => `${20 + i * 56},${12 + (1 - (w[1] - lo) / (hi - lo)) * 50}`).join(' ')} />{WEIGHTS.map((w, i) => <g key={w[0]}><circle cx={20 + i * 56} cy={12 + (1 - (w[1] - lo) / (hi - lo)) * 50} r="4" fill="#fff" stroke="#1F5AE8" strokeWidth="2.500" /><text x={20 + i * 56} y="86" textAnchor="middle" fontSize="11" fill="#5B6472">{w[0]}</text></g>)}</svg>
          <p className="meta">Down 2.1 lb since June, on track for the target the vet set.</p></div>
        <div className="card padc"><b>Care timeline</b>{[...(vet ? [{ t: 'Uploaded record: wellness visit', d: 'Just now · weight 68.0 lb, 2 vaccines read (sample)', ok: true }] : []), ...HEALTH].map((h) => <div key={h.t} className="hrow"><span className={`dot ${h.ok ? '' : 'warn'}`} /><div className="grow"><div className="hb">{h.t}</div><div className="meta">{h.d}</div></div></div>)}
          <label className="upload"><Ic n="plus" s={18} />Upload a vet record<input type="file" accept=".pdf,image/*" onChange={() => { setVet(true); setToast('Sample record added. Real extraction comes later.') }} /></label></div>
      </div>}
      {sub === 'Connections' && <div className="list">
        <p className="meta padx">These are demo connections. Each one shows what the real integration will do and what it needs.</p>
        {groups.map((g) => <div key={g} className="card padc"><div className="eyebrow dark">{g.toUpperCase()}</div>{CONNECTIONS.filter((c) => c.group === g).map((c) => <button key={c.id} className="crow" onClick={() => setSheet(c)}><span className="grow"><b>{c.name}</b><small>{conn[c.id] ? 'Connected (demo)' : 'Not connected'}</small></span><span className={`badge ${conn[c.id] ? 'on' : ''}`}>{conn[c.id] ? <><Ic n="check" s={14} />On</> : 'Connect'}</span></button>)}</div>)}
        <button className="rrow box" onClick={reset}><span className="grow"><b>Reset demo data</b><small>Clears saved walks, paws and connections on this device</small></span></button>
      </div>}
      {sheet && <div className="scrim" onClick={() => setSheet(null)}><div className="modal" role="dialog" aria-label={sheet.name} onClick={(e) => e.stopPropagation()}>
        <div className="grab" /><h2>{sheet.name}</h2><p>{sheet.what}</p><p className="meta"><b>For real:</b> {sheet.real}</p>
        {sheet.input && <label className="field lightf"><span>{sheet.input}</span><input placeholder="https://find.apple.com/…" /></label>}
        <button className={`cta ${conn[sheet.id] ? 'white bordered' : ''}`} onClick={() => { setConn((c) => ({ ...c, [sheet.id]: !c[sheet.id] })); setToast(conn[sheet.id] ? `${sheet.name} disconnected` : `${sheet.name} connected (demo)`); setSheet(null) }}>{conn[sheet.id] ? 'Disconnect' : 'Connect (demo)'}</button>
      </div></div>}
    </div>
  )
}

function Detail({ a, close, pawed, paw, conn, setToast }) {
  const pts = ptsOf(a), p = PEOPLE[a.by]
  const [img, setImg] = useState('')
  useEffect(() => { const go = () => { try { setImg(drawCard(a).toDataURL('image/png')) } catch (e) {} }; (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(go, go) }, [a])
  const share = async () => { const r = await shareCard(a); setToast(r === 'shared' ? 'Shared' : r === 'saved' ? 'Story card saved. Add it to your Instagram story.' : r === 'cancelled' ? '' : 'Sharing is blocked in this preview. It works in the deployed app.') }
  return (
    <div className="detail" role="dialog" aria-label={a.title}>
      <header className="dhead"><button className="round flat" aria-label="Back" onClick={close}><Ic n="back" /></button><b>{a.type}</b><button className="round flat" aria-label="Share" onClick={share}><Ic n="share" /></button></header>
      <div className="scroll">
        {pts ? <TrotMap route={pts} className="dmap" /> : <div className="dmap nomap">No route for this one. Biscuit was busy playing.</div>}
        <div className="list">
          <div className="padx"><div className="row g10"><Av t={a.dog[0]} s={48} bg={a.color || '#0F1B2D'} c={a.ink || '#C8F031'} /><div><div className="dogname big">{a.dog}</div><div className="meta">{a.type === 'Daycare' ? 'at' : 'with'} <b>{whoName(a)}</b>{p ? ` · ${p.role}` : ''}</div></div></div>
            <h1 className="dtitle">{a.title}</h1><div className="meta">{dayLabel(a.daysAgo)} {a.time} · {a.place}</div>{a.note && <p className="note">{a.note}</p>}</div>
          <div className="card padc grid3"><Stat l="DISTANCE" v={a.miles ? a.miles.toFixed(2) + ' mi' : '--'} /><Stat l="TIME" v={fmtTime(a.minutes)} /><Stat l="PACE" v={a.miles > 0.05 ? fmtTime(a.minutes / a.miles) + ' /mi' : '--'} /><Stat l="SNIFF STOPS" v={a.sniffs} /><Stat l="PAWS" v={a.paws + (pawed[a.id] ? 1 : 0)} /><Stat l="OF DAILY RANGE" v={Math.round((a.minutes / DOG.rangeMax) * 100) + '%'} /></div>
          <button className={`cta ${pawed[a.id] ? 'white bordered' : ''}`} onClick={() => paw(a.id)}><Paw s={20} c="#0F1B2D" f={pawed[a.id] ? '#0F1B2D' : 'none'} />{pawed[a.id] ? 'Paw given' : 'Give a paw'}</button>
          <div className="storycard">{img ? <img src={img} alt={`Story card for ${a.title}`} /> : <div className="ph" />}<div><b>Story card ready</b><p>Sized for Instagram Stories, with the route, who Biscuit went with, and the stats.</p><button className="cta small" onClick={share}>{conn.instagram ? 'Share to Instagram' : 'Save story card'}</button></div></div>
        </div>
      </div>
    </div>
  )
}
