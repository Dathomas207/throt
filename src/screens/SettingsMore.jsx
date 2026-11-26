import React, { useEffect, useRef, useState } from 'react'
import { Ic, copyText } from '../ui.jsx'
import { api } from '../api.js'
import { APP_VERSION, EVENTS, localErrors, clearLocalErrors, isStandalone, optedOut } from '../usage.js'
import '../notify.css'

// The extra Settings sections: notification choices, admin metrics, the plain note about what Trot
// measures, and the Help and diagnostics page used when testing on a real phone.
function Section({ title, children, id }) {
  return <section className="card padc setsec" aria-labelledby={id}><h2 className="eyebrow dark" id={id}>{title}</h2>{children}</section>
}

// ---- notification choices -------------------------------------------------------
const PREFS = [
  ['friends', 'Friends', 'When a dog adds yours as a friend, or adds yours back.'],
  ['paws', 'Paws', 'When someone on the care team paws an outing.'],
  ['care', 'Care team', 'When someone accepts your invite, or a walker or daycare logs an outing.'],
  ['reminders', 'Reminders', 'A license or rabies date coming up, and events your dog is going to.'],
]
export function NotificationPrefs({ real, setToast }) {
  const [prefs, setPrefs] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState('')
  const alive = useRef(true)
  const load = () => { setError(''); api.notifications.prefs().then((r) => alive.current && setPrefs(r.prefs), (e) => alive.current && setError(e.message)) }
  useEffect(() => { alive.current = true; if (real) load(); return () => { alive.current = false } }, [])
  const set = async (key, on) => {
    if (busy) return
    setBusy(key); setPrefs((p) => ({ ...p, [key]: on }))
    try { const r = await api.notifications.setPrefs({ [key]: on }); if (alive.current) setPrefs(r.prefs) }
    catch (e) { if (alive.current) setPrefs((p) => ({ ...p, [key]: !on })); setToast(e.message) }
    if (alive.current) setBusy('')
  }
  return (
    <Section title="NOTIFICATIONS" id="set-notify">
      <p className="meta">These show inside Trot only, under the bell on the Today screen. No push, email or text is sent yet. Push notifications on a phone need Trot installed as an app, and will come in a later release.</p>
      {!real && <p className="meta">In the demo the bell shows samples. With an account you choose here what shows up.</p>}
      {real && error && <div className="mnote" role="alert"><span className="grow">{error}</span><button onClick={load}>Retry</button></div>}
      {real && !prefs && !error && <p className="meta" role="status">Loading</p>}
      {real && prefs && <>
        {PREFS.map(([key, label, what]) => <label key={key} className="switch"><input type="checkbox" checked={!!prefs[key]} disabled={busy === key} onChange={(e) => set(key, e.target.checked)} /><span className="grow"><b>{label}</b><small>{what}</small></span></label>)}
        <label className="switch"><input type="checkbox" checked disabled readOnly /><span className="grow"><b>Found reports</b><small>Always on. When someone reports finding your dog, you should know.</small></span></label>
      </>}
    </Section>
  )
}

// ---- admin metrics ----------------------------------------------------------------
// Small inline SVG bars. No chart library: one <rect> per day, a title on each for the exact number.
function Bars({ title, total, rows, pick, color = '#1F5AE8' }) {
  const max = Math.max(1, ...rows.map(pick)), w = 320, h = 64, gap = rows.length > 20 ? 1 : 3, bw = (w - gap * (rows.length - 1)) / rows.length
  const short = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return <div className="mchart">
    <div className="mtitle"><span>{title}</span><small>{total}</small></div>
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${title}: ${rows.map((r) => `${short(r.day)} ${pick(r)}`).join(', ')}`} preserveAspectRatio="none">
      <line x1="0" y1={h - 0.5} x2={w} y2={h - 0.5} stroke="#E3E6EB" strokeWidth="1" />
      {rows.map((r, i) => { const v = pick(r), bh = v > 0 ? Math.max(3, Math.round((v / max) * (h - 6))) : 0; return <rect key={r.day} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx="2" fill={color}><title>{`${short(r.day)}: ${v}`}</title></rect> })}
    </svg>
    <div className="mcap"><span>{short(rows[0].day)}</span><span>most in a day: {Math.max(0, ...rows.map(pick))}</span><span>{short(rows[rows.length - 1].day)}</span></div>
  </div>
}
function HBars({ rows, empty, label = (r) => r.name }) {
  if (!rows.length) return <p className="meta">{empty}</p>
  const max = Math.max(1, ...rows.map((r) => r.count))
  return <div className="hbar">{rows.map((r) => <React.Fragment key={r.key || r.name}><span>{label(r)}</span><i>{r.count}</i><div className="htrack" aria-hidden="true"><div className="hfill" style={{ width: `${Math.round((r.count / max) * 100)}%` }} /></div></React.Fragment>)}</div>
}
const when = (iso) => { const d = new Date(iso); return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` }
export function MetricsSection() {
  const [days, setDays] = useState(14), [incl, setIncl] = useState(false)
  const [m, setM] = useState(null), [error, setError] = useState('')
  const seq = useRef(0)
  const load = () => {
    const n = ++seq.current
    setError('')
    api.admin.metrics(days, incl).then((r) => { if (n === seq.current) setM(r) }, (e) => { if (n === seq.current) setError((e && e.message) || 'Metrics could not be loaded.') })
  }
  useEffect(() => { load(); return () => { seq.current++ } }, [days, incl])
  const none = m && m.totals.events === 0
  return (
    <Section title="METRICS" id="set-metrics">
      <p className="meta">Counted from Trot's own usage events, in UTC days. People whose browser asks not to be tracked are not counted, so read these as floors.</p>
      <div className="chips wrap" role="group" aria-label="Days to show">{[7, 14, 30].map((d) => <button key={d} className={`chip flat ${days === d ? 'on' : ''}`} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>)}</div>
      <label className="switch slim mswitch"><input type="checkbox" checked={incl} onChange={(e) => setIncl(e.target.checked)} /><span className="grow"><b>Include admins' own activity</b></span></label>
      {error && <div className="mnote" role="alert"><span className="grow">{error}</span><button onClick={load}>Retry</button></div>}
      {!m && !error && <p className="meta" role="status">Loading</p>}
      {none && <p className="meta">No events in the last {m.days} days yet. Numbers appear here once people use the app.</p>}
      {m && !none && <>
        <div className="kpis">
          <div className="kpi"><b>{m.totals.people}</b><small>active people</small></div>
          <div className="kpi"><b>{m.totals.signups}</b><small>new sign-ups</small></div>
          <div className="kpi"><b>{m.totals.walksSaved}</b><small>walks saved</small></div>
          <div className="kpi"><b>{m.weekTwo.rate == null ? 'n/a' : `${Math.round(m.weekTwo.rate * 100)}%`}</b><small>week-two return{m.weekTwo.rate == null ? `: not enough data (${m.weekTwo.cohort} of 5 people)` : ` (${m.weekTwo.returned} of ${m.weekTwo.cohort})`}</small></div>
        </div>
        <Bars title="Daily active people" total={`${m.totals.people} in ${m.days} days`} rows={m.daily} pick={(r) => r.active} />
        <Bars title="New sign-ups per day" total={`${m.totals.signups} total`} rows={m.daily} pick={(r) => r.signups} />
        <Bars title="Walks saved per day" total={`${m.totals.walksSaved} total`} rows={m.daily} pick={(r) => r.walksSaved} />
        <div className="sl">ACTIVATION, OF PEOPLE WHO SIGNED UP IN THIS WINDOW</div>
        {m.funnel[0].count === 0 ? <p className="meta">Nobody signed up in this window.</p> : <HBars rows={m.funnel.map((f) => ({ ...f, name: f.label }))} empty="" />}
        <div className="sl">TOP TABS</div>
        <HBars rows={m.topTabs} empty="No tab views yet." />
        <div className="sl">TOP EVENTS</div>
        <HBars rows={m.topEvents} empty="No events yet." />
      </>}
      {m && <>
        <div className="sl">CLIENT ERRORS{m.clientErrors.length ? ` (${m.totals.errors})` : ''}</div>
        {m.clientErrors.length === 0 ? <p className="meta">No client errors in this window.</p> : m.clientErrors.map((e) => <div key={e.message} className="errrow"><b>{e.message}</b><small>{e.count} {e.count === 1 ? 'time' : 'times'} · {e.kind || 'error'}{e.screen ? ` on ${e.screen}` : ''} · last seen {when(e.lastSeen)}</small></div>)}
      </>}
    </Section>
  )
}

// ---- what Trot measures -----------------------------------------------------------
export function MeasuresNote() {
  const off = optedOut()
  return (
    <Section title="WHAT TROT MEASURES" id="set-measures">
      <p className="meta">Trot counts a short list of things people do in the app, so we can see what works and fix what breaks. It is our own counter on our own server. No outside analytics or ad trackers are used, and nothing is sold or shared.</p>
      <ul className="mlist">
        <li>Counted: opening the app, which tab you look at, and actions such as starting or saving a walk, adding a friend or opening a place. There are {EVENTS.length} in all, listed in the project README.</li>
        <li>Numbers are kept as rough ranges, for example a walk of 10 to 30 minutes, never the exact figure.</li>
        <li>Not stored: your location, your IP address, your email, or anything you type. Only the kind of device and browser is kept.</li>
        <li>If something breaks, a short error message is sent with emails, ids and long numbers removed.</li>
      </ul>
      <p className="meta"><b>To opt out,</b> turn on "Do Not Track" or "Global Privacy Control" in your browser's privacy settings. Trot then sends nothing at all. {off ? 'Your browser is asking not to be tracked right now, so nothing is being sent from this device.' : 'Your browser is not asking for that right now.'}</p>
    </Section>
  )
}

// ---- help and diagnostics ---------------------------------------------------------
async function gather() {
  const nav = navigator
  let location = 'not reported by this browser'
  try { if (nav.permissions && nav.permissions.query) location = (await nav.permissions.query({ name: 'geolocation' })).state } catch (e) { /* Safari before 16 has no Permissions API for this */ }
  if (!nav.geolocation) location = 'not supported'
  let sw = 'not supported'
  try {
    if ('serviceWorker' in nav) {
      const reg = await nav.serviceWorker.getRegistration()
      sw = !reg ? 'not registered' : reg.active ? `active${nav.serviceWorker.controller ? ', controlling this page' : ''}${reg.waiting ? ', update waiting' : ''}` : reg.installing ? 'installing' : reg.waiting ? 'waiting' : 'registered'
    }
  } catch (e) { sw = 'could not be read' }
  const ua = nav.userAgent || ''
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iPhone or iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Unknown'
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Unknown'
  return [
    ['App version', APP_VERSION],
    ['Installed app', isStandalone() ? 'Yes, opened from the home screen' : 'No, running in a browser tab'],
    ['Online', nav.onLine === false ? 'No' : 'Yes'],
    ['Location permission', location],
    ['NFC reading', 'NDEFReader' in window ? 'Available' : 'Not available'],
    ['Web Share', typeof nav.share === 'function' ? 'Available' : 'Not available'],
    ['Service worker', sw],
    ['Device', `${br} on ${os}`],
    ['Screen', `${window.innerWidth} x ${window.innerHeight}`],
    ['Usage counting', optedOut() ? 'Off (browser opt-out)' : 'On'],
  ]
}
const errLine = (e) => `${e.at} · ${e.kind}${e.screen ? ` on ${e.screen}` : ''}${e.method ? ` · ${e.method} ${e.path || ''}` : ''}${e.status ? ` · ${e.status}` : ''}${e.code ? ` · code ${e.code}` : ''}${e.n > 1 ? ` · ${e.n} times` : ''}\n  ${e.message}`
// Throws while rendering, on purpose, so a tester can see that the error card and the trail both work.
function Boom() { throw new Error('Test error from Help and diagnostics') }
export function Diagnostics({ close, setToast }) {
  const back = useRef(null)
  const [facts, setFacts] = useState(null), [errors, setErrors] = useState(localErrors), [boom, setBoom] = useState(false)
  const refresh = () => { gather().then(setFacts, () => setFacts([['App version', APP_VERSION]])); setErrors(localErrors()) }
  useEffect(() => {
    if (back.current) back.current.focus()
    refresh()
    window.addEventListener('online', refresh); window.addEventListener('offline', refresh)
    return () => { window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh) }
  }, [])
  // Device facts and masked error lines only: no name, email, dog, address or location.
  const report = () => ['Trot diagnostics', new Date().toISOString(), '', ...(facts || []).map(([k, v]) => `${k}: ${v}`), '', `Recent errors on this device (${errors.length})`, ...(errors.length ? errors.map(errLine) : ['None recorded'])].join('\n')
  const copy = async () => setToast((await copyText(report())) ? 'Diagnostics copied. Paste them into a message to support.' : 'Copy did not work here. Select the text below and copy it.')
  if (boom) return <Boom />
  return (
    <div className="detail" role="dialog" aria-modal="true" aria-label="Help and diagnostics" style={{ zIndex: 12 }}>
      <header className="dhead"><button ref={back} className="round flat" aria-label="Back to Settings" onClick={close}><Ic n="back" /></button><b>Help and diagnostics</b><span className="round flat" aria-hidden="true" /></header>
      <div className="scroll"><div className="list">
        <section className="card padc">
          <p className="meta">If something looks wrong, copy this report and send it to whoever is helping you. It describes this device and app only. It has no names, emails, dogs or locations in it.</p>
          {!facts ? <p className="meta" role="status">Checking this device</p> : <dl className="dgrid">{facts.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>}
          <button className="cta" onClick={copy} disabled={!facts}>Copy diagnostics</button>
          <button className="cta small white bordered" onClick={refresh}>Check again</button>
        </section>
        <section className="card padc">
          <h2 className="eyebrow dark">RECENT ERRORS ON THIS DEVICE</h2>
          {errors.length === 0 ? <p className="meta">None recorded. That is the good answer.</p> : errors.map((e) => <div key={e.key} className="errrow"><b>{e.message}</b><small>{when(e.at)} · {e.kind}{e.screen ? ` on ${e.screen}` : ''}{e.method ? ` · ${e.method} ${e.path || ''}` : ''}{e.status ? ` · ${e.status}` : ''}{e.n > 1 ? ` · ${e.n} times` : ''}</small></div>)}
          {errors.length > 0 && <button className="cta small white bordered" onClick={() => { clearLocalErrors(); setErrors([]); setToast('Error list cleared on this device') }}>Clear this list</button>}
          <p className="meta">The last 20 are kept on this device. They are the same short, masked messages Trot sends when something breaks.</p>
        </section>
        <section className="card padc">
          <h2 className="eyebrow dark">CHECK ERROR REPORTING</h2>
          <p className="meta">This breaks this page on purpose so you can see what a crash looks like and that it gets recorded. Tap Try again afterwards.</p>
          <button className="cta small white bordered" onClick={() => setBoom(true)}>Send a test error</button>
        </section>
      </div></div>
    </div>
  )
}
