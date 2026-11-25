import React, { createContext, useContext } from 'react'
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
export const Paw = ({ s = 22, c = 'currentColor', f = 'none' }) => { const w = s <= 32 ? 7.500 : 5; return <svg aria-hidden="true" width={s} height={s} viewBox="6 10 88 78" fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><g transform="rotate(-9 50 50)"><path d="M33 27C38 22 44 20 50 20C56 20 62 22 67 27M33 60C34 71 41 79 50 79C59 79 66 71 67 60" /><path d="M33 27C24 24 15 30 15 44C15 58 19 70 26 71C31 71 33 66 33 60V40" fill={f} /><path d="M67 27C76 24 85 30 85 44C85 58 81 70 74 71C69 71 67 66 67 60V40" fill={f} /><path d="M50 66v2M50 68c-2 4-7 4-9 1M50 68c2 4 7 4 9 1" strokeWidth={w * 0.8} /><circle cx="42" cy="46" r="2.500" fill={c} /><circle cx="58" cy="46" r="2.500" fill={c} /><path d="M46 58h8l-4 4.500z" fill={c} strokeWidth="3" /></g></svg> }
export const Av = ({ t, s = 40, bg = '#0F1B2D', c = '#C8F031', sq }) => <span className="av" style={{ width: s, height: s, background: bg, color: c, fontSize: s * 0.42, borderRadius: sq ? 10 : '50%' }}>{t}</span>
export const Stat = ({ l, v, big, light }) => <div className={`stat ${light ? 'light' : ''}`}><div className="sl">{l}</div><div className="sv" style={big ? { fontSize: big } : null}>{v}</div></div>
export const whoName = (a) => a.byName || (PEOPLE[a.by] ? PEOPLE[a.by].name : '')
export const ptsOf = (a) => a.pts || (a.route && ROUTES[a.route] ? ROUTES[a.route].pts : null)

// The 60 to 90 minute range is a sample set for Biscuit. Signed-in mode turns it
// off for real dogs through this context, so every screen that shows it agrees.
export const RangeOff = createContext(false)
export function Range({ min, light }) {
  if (useContext(RangeOff)) return null
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
  const p = a.real ? { name: a.byName || '?', color: a.byColor, ink: a.byInk } : PEOPLE[a.by], pts = ptsOf(a), n = a.paws + (pawed[a.id] ? 1 : 0)
  return (
    <article className="card">
      <button className="cardtop" onClick={() => setOpen(a)}>
        <div className="row g10">
          <Av t={a.dog[0]} bg={a.color || '#0F1B2D'} c={a.ink || '#C8F031'} />
          <div className="grow"><div className="dogname">{a.dog}</div><div className="meta">{a.type === 'Daycare' ? 'at' : 'with'} <b>{whoName(a)}</b> · {whenOf(a)}{a.place ? ` · ${a.place}` : ''}</div></div>
          {p && <Av t={p.name[0]} s={28} bg={p.color} c={p.ink} />}
        </div>
        <div className="title">{a.title}</div>
        <div className="row g28">{a.miles > 0 && <Stat l="DISTANCE" v={a.miles.toFixed(1) + ' mi'} />}<Stat l="TIME" v={fmtTime(a.minutes)} />{a.sniffs > 0 && <Stat l="SNIFF STOPS" v={a.sniffs} />}</div>
        {a.note && <p className="note">{a.note}</p>}
      </button>
      {pts && <button className="thumbbtn" aria-label={`Open map for ${a.title}`} onClick={() => setOpen(a)}><RouteThumb pts={pts} /></button>}
      <div className="row actions">
        <button className={`act ${pawed[a.id] ? 'on' : ''}`} aria-pressed={!!pawed[a.id]} onClick={() => paw(a.id)}><Paw s={20} f={pawed[a.id] ? '#1F5AE8' : 'none'} c={pawed[a.id] ? '#1F5AE8' : 'currentColor'} />{n} {n === 1 ? 'paw' : 'paws'}</button>
        {a.comments != null && <button className="act" onClick={() => setOpen(a)}><Ic n="chat" s={20} />{a.comments}</button>}
        <button className="act end" aria-label="Share" onClick={() => setOpen(a)}><Ic n="share" s={20} /></button>
      </div>
    </article>
  )
}

// ---- signed-in mode helpers --------------------------------------------------
export const whenOf = (a) => a.when || `${dayLabel(a.daysAgo)} ${a.time}`
export const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || ''
const COLORS = [['#C8F031', '#0F1B2D'], ['#1F5AE8', '#FFFFFF'], ['#FF8A5B', '#0F1B2D'], ['#0F1B2D', '#C8F031'], ['#5B6472', '#FFFFFF']]
export const personColor = (i) => COLORS[(i < 0 ? 1 : i) % COLORS.length]
export const ROLE_LABEL = { owner: 'Owner', walker: 'Dog walker', family: 'Family', daycare: 'Daycare' }
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
export const daysAgoOf = (isoDate) => Math.max(0, Math.round((dayStart(new Date()) - dayStart(new Date(isoDate))) / 864e5))
// Turns a walk from the API into the activity shape the cards, the detail view and
// the story card already use. `paws` leaves out the viewer's own paw, because the
// screens add it back from the `pawed` map.
export function toAct(w, team) {
  const d = new Date(w.startedAt), daysAgo = daysAgoOf(w.startedAt)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const [byColor, byInk] = personColor(team ? team.findIndex((m) => m.id === w.by.id) : -1)
  return {
    real: true, id: w.id, dog: w.dog.name, dogSlug: w.dog.slug, by: w.by.id, byName: firstName(w.by.name), byColor, byInk,
    type: w.type, title: w.title, daysAgo, time, when: daysAgo > 6 ? `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}` : null,
    place: w.place, route: null, pts: w.route && w.route.length > 1 ? w.route : null, miles: w.miles, minutes: w.minutes, sniffs: w.sniffs,
    paws: w.paws - (w.pawed ? 1 : 0), comments: null, note: w.note,
  }
}
export function DogSwitch({ dogs, active, onPick }) {
  if (!dogs || dogs.length < 2) return null
  return (
    <div className="dogswitch" role="group" aria-label="Switch dog">
      {dogs.map((d) => <button key={d.slug} className={`chip flat ${d.slug === active ? 'on' : ''}`} aria-pressed={d.slug === active} onClick={() => onPick(d.slug)}>{d.name}</button>)}
    </div>
  )
}
export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true } catch (e) {}
  try {
    const el = document.createElement('textarea'); el.value = t; el.setAttribute('readonly', ''); el.style.position = 'fixed'; el.style.opacity = '0'
    document.body.appendChild(el); el.select(); const ok = document.execCommand('copy'); el.remove(); return ok
  } catch (e) { return false }
}
