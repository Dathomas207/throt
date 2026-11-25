import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Ic, Paw, Av, DogAv, Stat, Range, Card, whoName, ptsOf, DogSwitch, Gear, TypeIc, usePhoto } from '../ui.jsx'
import { api } from '../api.js'
import { HomeAlerts } from './LostDog.jsx'
import { ROUTES, PLACES, DOG, PEOPLE, PACK, CONNECTIONS, WEIGHTS, HEALTH, dayLabel, fmtTime, haversine, DEMO_DOGS, demoDogByName } from '../data.js'

export default function Home(props) { return props.real ? <RealHome {...props} /> : <DemoHome {...props} /> }

// Signed in: the feed and the week come from the API. No pack, streak or daily
// range here, because there is no real data behind them yet.
// An outing from another public dog. It shows what that dog's public page shows and opens that page.
function PackCard({ w }) {
  const src = usePhoto(w.dog.photoUrl)
  const d = new Date(w.startedAt)
  return <article className="card"><a className="cardtop packcard" href={`/d/${w.dog.slug}`} target="_blank" rel="noopener" aria-label={`${w.dog.name}: ${w.title}. Opens ${w.dog.name}'s public page`}>
    <div className="row g10"><Av t={(w.dog.name[0] || 'D').toUpperCase()} src={src} alt="" /><div className="grow"><div className="dogname">{w.dog.name}{w.dog.isDemo && <span className="tagx">Demo dog</span>}</div><div className="meta">{w.type === 'Daycare' ? 'at' : 'with'} <b>{w.with}</b> · {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{w.place ? ` · ${w.place}` : ''}</div></div></div>
    <div className="title"><TypeIc t={w.type} />{w.title}</div>
    <div className="row g28 wraprow">{w.miles > 0 && w.type !== 'Daycare' && <Stat l="DISTANCE" v={w.miles.toFixed(1) + ' mi'} />}<Stat l="TIME" v={fmtTime(w.minutes)} />{w.maxSpeed > 0 && w.type !== 'Daycare' && <Stat l="TOP SPEED" v={w.maxSpeed.toFixed(1) + ' mph'} />}</div>
    {w.note && <p className="note">{w.note}</p>}
  </a></article>
}
const CompeteCard = ({ open, name }) => <button className="rrow box competecard" onClick={() => open('boards')}><span className="ricon"><Ic n="trophy" s={20} c="#1F5AE8" /></span><span className="grow"><b>Compete</b><small>Leaderboards, challenges and events for {name}</small></span></button>

function RealHome({ real, acts, pawed, paw, setOpen, setTab, setToast, openSettings, openCompete, onDog }) {
  const { dog, dogs, totals, user } = real
  const many = dogs.length > 1
  const [pack, setPack] = useState(null)
  const scope = real.scope === 'pack' ? 'pack' : real.scope
  useEffect(() => { if (scope === 'pack' && !pack) api.boards.pack().then((r) => setPack(r.walks), () => setPack([])) }, [scope])
  return (
    <div className="scroll">
      <header className="top"><div className="logo">TROT</div><div className="row g8"><div className="meta">Signed in as {user.name}</div><Gear onClick={openSettings} /></div></header>
      <DogSwitch dogs={dogs} active={dog.slug} onPick={real.switchDog} />
      <HomeAlerts real={real} setToast={setToast} />
      <section className="hero">
        <div className="row g14"><button className="doglink" aria-label={`Open ${dog.name}'s profile`} onClick={() => setTab('dog')}><DogAv name={dog.name} photoUrl={dog.photoUrl} s={56} bg="#C8F031" c="#0F1B2D" /></button><div className="grow"><div className="eyebrow">{dog.name.toUpperCase()}, LAST 7 DAYS</div><div className="row g20"><Stat light l="MILES" v={totals.week.miles.toFixed(1)} /><Stat light l="OUTINGS" v={totals.week.outings} /><Stat light l="TIME OUT" v={fmtTime(totals.week.minutes)} /></div></div></div>
        <button className="cta" onClick={() => setTab('record')}><Paw s={22} c="#0F1B2D" />Walk {dog.name}</button>
      </section>
      <CompeteCard open={openCompete} name={dog.name} />
      <div className="seg" role="tablist"><button role="tab" aria-selected={scope === 'dog'} className={scope === 'dog' ? 'on' : ''} onClick={() => real.setScope('dog')}>{dog.name}</button>{many && <button role="tab" aria-selected={scope === 'all'} className={scope === 'all' ? 'on' : ''} onClick={() => real.setScope('all')}>All my dogs</button>}<button role="tab" aria-selected={scope === 'pack'} className={scope === 'pack' ? 'on' : ''} onClick={() => real.setScope('pack')}>The pack</button></div>
      {scope === 'pack' ? <div className="list">
        <p className="meta padx">Recent outings from other public dogs on Trot. Demo dogs are made up and labelled.</p>
        {!pack && <div className="card empty" role="status"><p>Fetching the pack</p></div>}
        {pack && pack.length === 0 && <div className="card empty"><b>Nobody else yet</b><p>Outings from other public dogs will show up here.</p></div>}
        {pack && pack.map((w) => <PackCard key={w.id} w={w} />)}
      </div> : <div className="list">
        {acts.length === 0 && <div className="card empty"><b>No outings yet</b><p>{dog.name}'s first walk will show up here. Tap Walk {dog.name} to record one.</p></div>}
        {acts.map((a) => <Card key={a.id} a={a} pawed={pawed} paw={paw} setOpen={setOpen} onDog={onDog} />)}
        {real.hasMore && <button className="cta white bordered" onClick={real.more} disabled={real.loadingMore}>{real.loadingMore ? 'Loading' : 'Show older outings'}</button>}
      </div>}
    </div>
  )
}

const DemoSwitch = ({ dd, setDk }) => <div className="dogswitch" role="group" aria-label="Switch dog">{Object.values(DEMO_DOGS).map((d) => <button key={d.key} className={`chip flat ${d.key === dd.key ? 'on' : ''}`} aria-pressed={d.key === dd.key} onClick={() => setDk(d.key)}>{d.dog.name}</button>)}</div>

function DemoHome({ acts, week, todayMin, pawed, paw, setOpen, setTab, me, openSettings, openCompete, dd, setDk, onDog }) {
  const [feed, setFeed] = useState('biscuit')
  const D = dd.dog
  // Dale's own dogs are never in "the pack".
  const list = feed === 'biscuit' ? acts : [...PACK.filter((x) => !demoDogByName(x.dog)), ...acts].sort((a, b) => a.daysAgo - b.daysAgo)
  return (
    <div className="scroll">
      <header className="top"><div className="logo">TROT</div><div className="row g8"><div className="meta">Demo, viewing as {PEOPLE[me].name}</div><Gear onClick={openSettings} /></div></header>
      <DemoSwitch dd={dd} setDk={setDk} />
      <section className="hero">
        <div className="row g14"><button className="doglink" aria-label={`Open ${D.name}'s profile`} onClick={() => setTab('dog')}><DogAv name={D.name} demo s={56} bg="#C8F031" c="#0F1B2D" /></button><div className="grow"><div className="eyebrow">{D.name.toUpperCase()} THIS WEEK</div><div className="row g20"><Stat light l="MILES" v={week.miles.toFixed(1)} /><Stat light l="OUTINGS" v={week.walks} /><Stat light l="STREAK" v={D.streak + ' d'} /></div></div></div>
        <Range min={todayMin} light dog={D} />
        <button className="cta" onClick={() => setTab('record')}><Paw s={22} c="#0F1B2D" />Walk {D.name}</button>
      </section>
      <CompeteCard open={openCompete} name={D.name} />
      <div className="seg" role="tablist"><button role="tab" aria-selected={feed === 'biscuit'} className={feed === 'biscuit' ? 'on' : ''} onClick={() => setFeed('biscuit')}>{D.name}</button><button role="tab" aria-selected={feed === 'pack'} className={feed === 'pack' ? 'on' : ''} onClick={() => setFeed('pack')}>The pack</button></div>
      <div className="list">{list.map((a) => <Card key={a.id} a={a} pawed={pawed} paw={paw} setOpen={setOpen} onDog={onDog} />)}</div>
    </div>
  )
}
