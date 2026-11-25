import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Ic, Paw, Av, Stat, Range, Card, whoName, ptsOf } from '../ui.jsx'
import { ROUTES, PLACES, DOG, PEOPLE, PACK, CONNECTIONS, WEIGHTS, HEALTH, dayLabel, fmtTime, haversine } from '../data.js'

export default function Home({ acts, week, todayMin, pawed, paw, setOpen, setTab, me }) {
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
