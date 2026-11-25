import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Ic, Paw, Av, Stat, Range, Card, whoName, ptsOf } from '../ui.jsx'
import { ROUTES, PLACES, DOG, PEOPLE, PACK, CONNECTIONS, WEIGHTS, HEALTH, dayLabel, fmtTime, haversine } from '../data.js'

export default function DogTab({ acts, week, todayMin, pawed, paw, setOpen, conn, setConn, setToast, reset }) {
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
