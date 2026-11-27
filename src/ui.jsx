import React, { createContext, useContext, useEffect, useState } from 'react'
import { RouteThumb } from './RouteThumb.jsx'
import { ROUTES, DOG as BISCUIT, PEOPLE, dayLabel, fmtTime, activityType } from './data.js'
import { loadPhoto, peekPhoto } from './api.js'
import { Portrait, hasPortrait, DemoPhoto, hasDemoPhoto } from './portraits.jsx'
import { CardPhotos } from './screens/Photos.jsx'

const P = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z', map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  users: 'M9 11.5a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7zM2.500 20c.5-4 3-6 6.500-6s6 2 6.500 6M16 5a3.500 3.500 0 0 1 0 7M18.500 14.500c1.800.8 2.800 2.600 3 5.500',
  back: 'M15 5l-7 7 7 7', share: 'M12 15V3M8 7l4-4 4 4M5 12v8h14v-8', chat: 'M4 5h16v11H9l-5 4z', plus: 'M12 5v14M5 12h14', check: 'M5 12.500l4.500 4.500L19 7.500',
  tag: 'M3 12V4h8l10 10-8 8zM7.500 9.250a.75.75 0 1 0 0-1.500.75.75 0 0 0 0 1.500z', pause: 'M8 5v14M16 5v14', play: 'M7 4l13 8-13 8z', x: 'M6 6l12 12M18 6L6 18', link: 'M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.500 20h7M10 17h4',
  file: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  heart: 'M12 20s-7-4.400-7-10a4 4 0 0 1 7-2.600A4 4 0 0 1 19 10c0 5.600-7 10-7 10z',
  bell: 'M6 9.500a6 6 0 0 1 12 0c0 5 2 6.500 2 6.500H4s2-1.500 2-6.500zM10 19.500a2 2 0 0 0 4 0',
  more: 'M12 6.500v.01M12 12v.01M12 17.500v.01',
}
export const Ic = ({ n, s = 22, c = 'currentColor', f = 'none' }) => <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill={f} stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={P[n]} /></svg>
export const Paw = ({ s = 22, c = 'currentColor', f = 'none' }) => { const w = s <= 32 ? 7.500 : 5; return <svg aria-hidden="true" width={s} height={s} viewBox="6 10 88 78" fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><g transform="rotate(-9 50 50)"><path d="M33 27C38 22 44 20 50 20C56 20 62 22 67 27M33 60C34 71 41 79 50 79C59 79 66 71 67 60" /><path d="M33 27C24 24 15 30 15 44C15 58 19 70 26 71C31 71 33 66 33 60V40" fill={f} /><path d="M67 27C76 24 85 30 85 44C85 58 81 70 74 71C69 71 67 66 67 60V40" fill={f} /><path d="M50 66v2M50 68c-2 4-7 4-9 1M50 68c2 4 7 4 9 1" strokeWidth={w * 0.8} /><circle cx="42" cy="46" r="2.500" fill={c} /><circle cx="58" cy="46" r="2.500" fill={c} /><path d="M46 58h8l-4 4.500z" fill={c} strokeWidth="3" /></g></svg> }
// The one avatar. By default it shows a letter. With `src` it shows an image (give
// it `alt`), and with children it shows artwork such as a demo portrait.
export const Av = ({ t, s = 40, bg = '#0F1B2D', c = '#C8F031', sq, src, alt = '', ring, children }) => {
  const style = { width: s, height: s, background: bg, color: c, fontSize: s * 0.42, borderRadius: sq ? 10 : '50%' }
  const cls = `av${ring ? ' ring' : ''}`
  if (src) return <img className={cls} src={src} alt={alt} width={s} height={s} style={style} />
  return <span className={`${cls}${children ? ' avart' : ''}`} style={style}>{children || t}</span>
}
// Resolves a photoUrl from the API to something an <img> can show. Empty until it loads.
export function usePhoto(url) {
  const [src, setSrc] = useState(() => (url ? peekPhoto(url) : ''))
  useEffect(() => {
    if (!url) { setSrc(''); return }
    const hit = peekPhoto(url)
    setSrc(hit)
    if (hit) return
    let on = true
    loadPhoto(url).then((u) => { if (on) setSrc(u) }, () => {})
    return () => { on = false }
  }, [url])
  return src
}
// A dog's avatar: the uploaded photo when signed in, an illustrated portrait in
// the demo, and the dog's initial otherwise.
export function DogAv({ name, photoUrl, demo, ...rest }) {
  const src = usePhoto(demo ? null : photoUrl)
  const label = String(name || '').trim()
  const art = demo && hasPortrait(label)
  return <Av t={(label[0] || 'D').toUpperCase()} src={src} alt={src ? `Photo of ${label}` : ''} {...rest}>{art ? <Portrait name={label} /> : null}</Av>
}
export const Stat = ({ l, v, big, light }) => <div className={`stat ${light ? 'light' : ''}`}><div className="sl">{l}</div><div className="sv" style={big ? { fontSize: big } : null}>{v}</div></div>
export const whoName = (a) => a.byName || (PEOPLE[a.by] ? PEOPLE[a.by].name : '')
export const ptsOf = (a) => a.pts || (a.route && ROUTES[a.route] ? ROUTES[a.route].pts : null)

// The 60 to 90 minute range is a sample set for Biscuit. Signed-in mode turns it
// off for real dogs through this context, so every screen that shows it agrees.
export const RangeOff = createContext(false)
export function Range({ min, light, dog }) {
  if (useContext(RangeOff)) return null
  const DOG = dog || BISCUIT
  const pct = Math.min(100, Math.round((min / DOG.rangeMax) * 100))
  const msg = min < DOG.rangeMin ? `${DOG.rangeMin - Math.round(min)} min to go` : min <= DOG.rangeMax ? 'In the sweet spot' : 'Plenty for today. Time to rest.'
  return (
    <div className={`range ${light ? 'light' : ''}`}>
      <div className="row between"><span>Today's healthy range</span><span><b>{Math.round(min)}</b> of {DOG.rangeMin} to {DOG.rangeMax} min · {msg}</span></div>
      <div className="bar"><i style={{ width: pct + '%', background: min > DOG.rangeMax ? '#FF8A5B' : undefined }} /><em style={{ left: (DOG.rangeMin / DOG.rangeMax) * 100 + '%' }} /></div>
    </div>
  )
}

export function Card({ a, pawed, paw, setOpen, onDog }) {
  const p = a.real ? { name: a.byName || '?', color: a.byColor, ink: a.byInk } : PEOPLE[a.by], pts = ptsOf(a), n = a.paws + (pawed[a.id] ? 1 : 0)
  return (
    <article className="card">
      {onDog && <button className="cardhead" onClick={() => onDog(a)} aria-label={`Open ${a.dog}'s profile`}>
        <DogAv name={a.dog} photoUrl={a.dogPhoto} demo={!a.real} bg={a.color || '#0F1B2D'} c={a.ink || '#C8F031'} />
        <span className="grow"><span className="dogname">{a.dog}</span><span className="meta">{a.type === 'Daycare' ? 'at' : 'with'} <b>{whoName(a)}</b> · {whenOf(a)}{a.place ? ` · ${a.place}` : ''}</span></span>
        {p && <Av t={p.name[0]} s={28} bg={p.color} c={p.ink} />}
      </button>}
      <button className="cardtop" onClick={() => setOpen(a)}>
        {!onDog && <div className="row g10">
          <DogAv name={a.dog} photoUrl={a.dogPhoto} demo={!a.real} bg={a.color || '#0F1B2D'} c={a.ink || '#C8F031'} />
          <div className="grow"><div className="dogname">{a.dog}</div><div className="meta">{a.type === 'Daycare' ? 'at' : 'with'} <b>{whoName(a)}</b> · {whenOf(a)}{a.place ? ` · ${a.place}` : ''}</div></div>
          {p && <Av t={p.name[0]} s={28} bg={p.color} c={p.ink} />}
        </div>}
        <div className="title"><TypeIc t={a.type} />{a.title}{a.dogDemo && <span className="tagx">Demo dog</span>}</div>
        <CardPhotos photos={a.photos} title={a.title} />
        <div className="row g28 wraprow">{statsOf(a).slice(0, 4).map(([l, v]) => <Stat key={l} l={l} v={v} />)}</div>
        {a.note && <p className="note">{a.note}</p>}
      </button>
      {!a.real && hasDemoPhoto(a.id) && <button className="thumbbtn" aria-label={`Open ${a.title}`} onClick={() => setOpen(a)}><DemoPhoto id={a.id} /></button>}
      {pts && <button className="thumbbtn" aria-label={`Open map for ${a.title}`} onClick={() => setOpen(a)}><RouteThumb pts={pts} /></button>}
      <div className="row actions">
        <button className={`act ${pawed[a.id] ? 'on' : ''}`} aria-pressed={!!pawed[a.id]} onClick={() => paw(a.id)}><Paw s={20} f={pawed[a.id] ? '#1F5AE8' : 'none'} c={pawed[a.id] ? '#1F5AE8' : 'currentColor'} />{n} {n === 1 ? 'paw' : 'paws'}</button>
        {a.comments != null && <button className="act" onClick={() => setOpen(a)}><Ic n="chat" s={20} />{a.comments}</button>}
        <button className="act end" aria-label="Share" onClick={() => setOpen(a)}><Ic n="share" s={20} /></button>
      </div>
    </article>
  )
}

// ---- activity types: a small line icon each, and the stats that suit the type ----
const TYPE_PATH = {
  Walk: 'M5 19c2-6 5-9 8-9s4 2 6 2M9 6.500a1.500 1.500 0 1 0 0-.01M15 4.500a1.500 1.500 0 1 0 0-.01', Run: 'M4 18l4-5 3 2 3-6 6 3M17 5.500a1.500 1.500 0 1 0 0-.01', Hike: 'M3 19l6-11 4 6 2-3 6 8z',
  'Play time': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.500 9c5 0 9 4 9 11.500M20.500 15c-5 0-9-4-9-11.500', Fetch: 'M4 14a8 8 0 0 1 16 0M4 14h16M12 6V3M8 18l-2 3M16 18l2 3',
  'Dog park': 'M4 20V9M10 20V9M16 20V9M20 20V11M2 13h20M4 9l3-4 3 4M10 9l3-4 3 4', Swim: 'M3 16c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 20c2-2 4-2 6 0s4 2 6 0 4-2 6 0M8 12l4-4 4 2M17 6.500a1.500 1.500 0 1 0 0-.01',
  Training: 'M12 3l2.500 5.500 6 .700-4.500 4 1.300 5.800L12 16l-5.300 3 1.300-5.800-4.500-4 6-.700z', Agility: 'M4 20V8M20 20V8M4 12h16M9 12c0-5 6-5 6 0', Daycare: 'M4 11l8-7 8 7v9H4zM10 20v-5h4v5',
}
export const TypeIc = ({ t, s = 18, c = '#1F5AE8' }) => <svg className="typeic" aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={TYPE_PATH[t] || TYPE_PATH.Walk} /></svg>
const has = (v) => v != null && Number(v) > 0
const mph = (v) => Number(v).toFixed(1) + ' mph'
// Label and value pairs for an outing, in the order its type asks for. A stat with
// no value is left out, never shown as zero or a dash. Daycare shows time only.
export function statsOf(a, full) {
  const t = activityType(a.type), timed = !t.gps || a.type === 'Daycare'
  const all = {
    distance: !timed && has(a.miles) ? ['DISTANCE', a.miles.toFixed(full ? 2 : 1) + ' mi'] : null,
    time: ['TIME', fmtTime(a.minutes)],
    pace: !timed && a.miles > 0.05 ? ['PACE', fmtTime(a.minutes / a.miles) + ' /mi'] : null,
    maxSpeed: a.type !== 'Daycare' && has(a.maxSpeed) ? ['TOP SPEED', mph(a.maxSpeed)] : null,
    avgSpeed: a.type !== 'Daycare' && has(a.avgSpeed) ? ['AVG SPEED', mph(a.avgSpeed)] : null,
    sprints: a.type !== 'Daycare' && has(a.sprints) ? ['SPRINTS', a.sprints] : null,
    moving: a.type !== 'Daycare' && has(a.movingMinutes) ? ['MOVING TIME', fmtTime(a.movingMinutes)] : null,
  }
  if (a.type === 'Daycare') return [all.time]
  const order = full ? [...new Set([...t.stats, 'distance', 'time', 'pace', 'avgSpeed', 'maxSpeed', 'sprints', 'moving'])] : t.stats
  return order.map((k) => all[k]).filter(Boolean)
}
export const SPEED_NOTE = 'Speeds are measured from the phone carried on the walk, so they are the pair\'s speed, not the dog\'s own. A connected collar is needed for that.'
export const LEVELS = [
  { n: 1, name: 'iPhone', adds: 'Phone GPS: routes, distance, pace, and who walked the dog.' },
  { n: 2, name: 'AirTag', adds: 'Adds Lost Dog mode with Apple\'s Share Item Location link. The AirTag adds no statistics, because Apple shares no AirTag data with other apps. You create the link in Find My when the dog is lost, and it expires after seven days.' },
  { n: 3, name: 'Fitness tracker', adds: 'A connected collar adds the dog\'s own steps, all-day activity and sleep. Trot is not connected to any real tracker yet.' },
]
export const LevelBadge = ({ n }) => { const l = LEVELS.find((x) => x.n === n) || LEVELS[0]; return <span className="lvl">Level {l.n} · {l.name}</span> }
// The bell beside the gear. `n` is the unread count; over 99 shows as 99+.
export const Bell = ({ onClick, n = 0 }) => <button type="button" className="round flat bellbtn" aria-label={n > 0 ? `Notifications, ${n} unread` : 'Notifications'} onClick={onClick}><Ic n="bell" s={24} c="#0F1B2D" />{n > 0 && <span className="bcount" aria-hidden="true">{n > 99 ? '99+' : n}</span>}</button>
export const Gear = ({ onClick, light }) => <button type="button" className={`round gear ${light ? 'flat lightgear' : 'flat'}`} aria-label="Settings" onClick={onClick}><Ic n="gear" s={24} c={light ? '#fff' : '#0F1B2D'} /></button>

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
    real: true, id: w.id, dog: w.dog.name, dogSlug: w.dog.slug, dogPhoto: w.dog.photoUrl || null, dogDemo: !!w.dog.isDemo, avgSpeed: w.avgSpeed, maxSpeed: w.maxSpeed, sprints: w.sprints, movingMinutes: w.movingMinutes, byYou: !!w.by.you, by: w.by.id, byName: firstName(w.by.name), byColor, byInk,
    type: w.type, title: w.title, daysAgo, time, when: daysAgo > 6 ? `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}` : null,
    place: w.place, route: null, pts: w.route && w.route.length > 1 ? w.route : null, miles: w.miles, minutes: w.minutes, sniffs: w.sniffs,
    paws: w.paws - (w.pawed ? 1 : 0), comments: null, note: w.note, photos: w.photos || [], routeId: w.routeId || null,
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

// A confirm step that sits in the page, for removing or deleting something.
export function Confirm({ text, yes, no = 'Keep', busy, error, onYes, onNo }) {
  return (
    <div className="confirm" role="group" aria-label="Please confirm">
      <p>{text}</p>
      {error && <p className="formerr" role="alert">{error}</p>}
      <div className="row g8"><button type="button" className="cta small dark" onClick={onYes} disabled={busy}>{busy ? 'Working' : yes}</button><button type="button" className="cta small white bordered" onClick={onNo} disabled={busy}>{no}</button></div>
    </div>
  )
}
