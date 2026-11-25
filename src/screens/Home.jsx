import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Ic, Paw, Av, Stat, Range, Card, whoName, ptsOf, DogSwitch } from '../ui.jsx'
import { ROUTES, PLACES, DOG, PEOPLE, PACK, CONNECTIONS, WEIGHTS, HEALTH, dayLabel, fmtTime, haversine } from '../data.js'

export default function Home(props) { return props.real ? <RealHome {...props} /> : <DemoHome {...props} /> }

// Signed in: the feed and the week come from the API. No pack, streak or daily
// range here, because there is no real data behind them yet.
function RealHome({ real, acts, pawed, paw, setOpen, setTab }) {
  const { dog, dogs, totals, user } = real
  const many = dogs.length > 1
  return (
    <div className="scroll">
      <header className="top"><div className="logo">TROT</div><div className="meta">Signed in as {user.name}</div></header>
      <DogSwitch dogs={dogs} active={dog.slug} onPick={real.switchDog} />
      <section className="hero">
        <div className="row g14"><Av t={(dog.name.trim()[0] || 'D').toUpperCase()} s={56} bg="#C8F031" c="#0F1B2D" /><div className="grow"><div className="eyebrow">{dog.name.toUpperCase()}, LAST 7 DAYS</div><div className="row g20"><Stat light l="MILES" v={totals.week.miles.toFixed(1)} /><Stat light l="OUTINGS" v={totals.week.outings} /><Stat light l="TIME OUT" v={fmtTime(totals.week.minutes)} /></div></div></div>
        <button className="cta" onClick={() => setTab('record')}><Paw s={22} c="#0F1B2D" />Walk {dog.name}</button>
      </section>
      {many && <div className="seg" role="tablist"><button role="tab" aria-selected={real.scope === 'dog'} className={real.scope === 'dog' ? 'on' : ''} onClick={() => real.setScope('dog')}>{dog.name}</button><button role="tab" aria-selected={real.scope === 'all'} className={real.scope === 'all' ? 'on' : ''} onClick={() => real.setScope('all')}>All my dogs</button></div>}
      <div className="list">
        {acts.length === 0 && <div className="card empty"><b>No outings yet</b><p>{dog.name}'s first walk will show up here. Tap Walk {dog.name} to record one.</p></div>}
        {acts.map((a) => <Card key={a.id} a={a} pawed={pawed} paw={paw} setOpen={setOpen} />)}
        {real.hasMore && <button className="cta white bordered" onClick={real.more} disabled={real.loadingMore}>{real.loadingMore ? 'Loading' : 'Show older outings'}</button>}
      </div>
    </div>
  )
}

function DemoHome({ acts, week, todayMin, pawed, paw, setOpen, setTab, me }) {
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
