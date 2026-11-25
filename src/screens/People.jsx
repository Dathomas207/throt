import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Ic, Paw, Av, Stat, Range, Card, whoName, ptsOf } from '../ui.jsx'
import { ROUTES, PLACES, DOG, PEOPLE, PACK, CONNECTIONS, WEIGHTS, HEALTH, dayLabel, fmtTime, haversine } from '../data.js'

export default function People({ week, me, setMe, setToast }) {
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
