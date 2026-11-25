import React from 'react'
import { RouteThumb } from './Map.jsx'
import { ROUTES, DOG, PEOPLE, dayLabel, fmtTime } from './data.js'

const P = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z', map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  users: 'M9 11.5a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7zM2.500 20c.5-4 3-6 6.500-6s6 2 6.500 6M16 5a3.500 3.500 0 0 1 0 7M18.500 14.500c1.800.8 2.800 2.600 3 5.500',
  back: 'M15 5l-7 7 7 7', share: 'M12 15V3M8 7l4-4 4 4M5 12v8h14v-8', chat: 'M4 5h16v11H9l-5 4z', plus: 'M12 5v14M5 12h14', check: 'M5 12.500l4.500 4.500L19 7.500',
  tag: 'M3 12V4h8l10 10-8 8zM7.500 9.250a.75.75 0 1 0 0-1.500.75.75 0 0 0 0 1.500z', pause: 'M8 5v14M16 5v14', play: 'M7 4l13 8-13 8z', x: 'M6 6l12 12M18 6L6 18', link: 'M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1',
  heart: 'M12 20s-7-4.400-7-10a4 4 0 0 1 7-2.600A4 4 0 0 1 19 10c0 5.600-7 10-7 10z',
}
export const Ic = ({ n, s = 22, c = 'currentColor', f = 'none' }) => <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill={f} stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={P[n]} /></svg>
export const Paw = ({ s = 22, c = 'currentColor', f = 'none' }) => <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round"><path d="M7.200 7.600C5.600 5.900 3 6.600 3 9.600c0 2.300 1.300 4 3.600 4.300" /><path d="M16.800 7.600C18.400 5.900 21 6.600 21 9.600c0 2.300-1.300 4-3.600 4.300" /><path d="M7 9.200C7 6.300 9.200 4.300 12 4.300s5 2 5 4.900v4.300c0 3.400-2.200 6.200-5 6.200s-5-2.800-5-6.200z" fill={f} /><circle cx="10" cy="10.800" r=".7" fill={f === 'none' ? c : '#fff'} stroke={f === 'none' ? c : '#fff'} /><circle cx="14" cy="10.800" r=".7" fill={f === 'none' ? c : '#fff'} stroke={f === 'none' ? c : '#fff'} /><path d="M10.800 14.200h2.400L12 15.600z" fill={f === 'none' ? c : '#fff'} stroke={f === 'none' ? c : '#fff'} /><path d="M12 15.600v1.300" stroke={f === 'none' ? c : '#fff'} /></svg>
export const Av = ({ t, s = 40, bg = '#0F1B2D', c = '#C8F031', sq }) => <span className="av" style={{ width: s, height: s, background: bg, color: c, fontSize: s * 0.42, borderRadius: sq ? 10 : '50%' }}>{t}</span>
export const Stat = ({ l, v, big, light }) => <div className={`stat ${light ? 'light' : ''}`}><div className="sl">{l}</div><div className="sv" style={big ? { fontSize: big } : null}>{v}</div></div>
export const whoName = (a) => a.byName || (PEOPLE[a.by] ? PEOPLE[a.by].name : '')
export const ptsOf = (a) => a.pts || (a.route && ROUTES[a.route] ? ROUTES[a.route].pts : null)

export function Range({ min, light }) {
  const pct = Math.min(100, Math.round((min / DOG.rangeMax) * 100))
  const msg = min < DOG.rangeMin ? `${DOG.rangeMin - Math.round(min)} min to go` : min <= DOG.rangeMax ? 'In the sweet spot' : 'Plenty for today. Time to rest.'
  return (
    <div className={`range ${light ? 'light' : ''}`}>
      <div className="row between"><span>Today's healthy range</span><span><b>{Math.round(min)}</b> of {DOG.rangeMin} to {DOG.rangeMax} min · {msg}</span></div>
      <div className="bar"><i style={{ width: pct + '%', background: min > DOG.rangeMax ? '#FF8A5B' : undefined }} /><em style={{ left: (DOG.rangeMin / DOG.rangeMax) * 100 + '%' }} /></div>
    </div>
  )
}

export function Card({ a, pawed, paw, setOpen }) {
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
