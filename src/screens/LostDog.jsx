import React, { useCallback, useEffect, useId, useState } from 'react'
import { Ic, Confirm } from '../ui.jsx'
import { api } from '../api.js'
import '../registration.css'

// Shared pieces for Lost Dog mode and tag activity: the red "someone found your dog" banner,
// the lost notice, the lost toggle and the activity list. Home and the dog tab both use them.
export const DEMO_NOTE = 'This is the demo, so nothing is saved. Create an account to use this with your own dog.'
// A plain link that any maps app or browser can open. No Google API or key is involved.
export const mapsUrl = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`
export const whenOf = (iso) => { const d = new Date(iso); return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` }
// The server only stores a contact that looks like an email address or a phone number.
const contactHref = (c) => (c.includes('@') ? `mailto:${c}` : `tel:${c.replace(/[^\d+]/g, '')}`)

// Scans, found reports and the Lost Dog state for one dog. Checked again every minute while the screen is open.
export function useTagState(slug) {
  const [state, setState] = useState(null)
  const load = useCallback(async () => { try { const r = await api.tags.scans(slug); setState(r); return r } catch (e) { return null } }, [slug])
  useEffect(() => {
    setState(null); load()
    const t = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') load() }, 60000)
    return () => clearInterval(t)
  }, [load])
  return [state, load]
}

function Report({ s, canEdit, onRead, busy }) {
  return <>
    {s.finderName && <p><b>From {s.finderName}</b></p>}
    {s.message && <p className="foundmsg">{s.message}</p>}
    {s.contact && <p>Reach them at <a href={contactHref(s.contact)}>{s.contact}</a></p>}
    {s.lat == null && <p className="foundmeta">No location was shared.</p>}
    <div className="row g8">
      {s.lat != null && <a className="cta small white" href={mapsUrl(s.lat, s.lng)} target="_blank" rel="noopener noreferrer"><Ic n="map" s={18} />Open in maps</a>}
      {canEdit && !s.read && <button type="button" className="cta small white bordered" onClick={() => onRead(s)} disabled={busy}>{busy ? 'Working' : 'Mark as read'}</button>}
    </div>
  </>
}

// The red banner: one block per unread found report, newest first.
export function FoundReports({ name, state, onRead, busyId }) {
  const unread = state ? state.scans.filter((s) => s.kind === 'found' && !s.read) : []
  if (!unread.length) return null
  return <section className="foundbanner" role="alert" aria-label={`Found reports for ${name}`}>
    {unread.slice(0, 3).map((s) => <div key={s.id} className="foundone"><div className="foundhead">Someone found {name}</div><div className="foundmeta">{whenOf(s.at)}{s.tagLabel ? ` · ${s.tagLabel}` : ''}</div><Report s={s} canEdit={state.canEdit} onRead={onRead} busy={busyId === s.id} /></div>)}
    {unread.length > 3 && <p className="foundmeta">{unread.length - 3} more in Tag activity, under Registration and ID.</p>}
    {!state.canEdit && <p className="foundmeta">The owner or family can mark these as read.</p>}
  </section>
}

export function LostNotice({ name, lost }) {
  if (!lost || !lost.on) return null
  return <div className="lostnotice" role="status"><b>{name} is reported lost</b><span>Since {whenOf(lost.since)}. The found form is open on {name}'s Trot Tag page.{lost.note ? ` Note for finders: ${lost.note}` : ''}</span></div>
}

// "Report <name> lost" and "<name> is home", each behind a confirm step. onSet(lost, note) answers an error message or ''.
export function LostToggle({ name, lost, onSet }) {
  const id = useId()
  const [ask, setAsk] = useState(false), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const go = async (on) => { setBusy(true); setErr(''); const e = await onSet(on, on ? note.trim() : ''); setBusy(false); if (e) setErr(e); else { setAsk(false); setNote('') } }
  if (lost && lost.on) return <div className="losttoggle">
    {ask ? <Confirm text={`Turn off Lost Dog mode? The found form closes and the Reported lost banner comes off ${name}'s pages.`} yes={`${name} is home`} no="Not yet" busy={busy} error={err} onYes={() => go(false)} onNo={() => { setAsk(false); setErr('') }} />
      : <button type="button" className="cta small dark" onClick={() => setAsk(true)}>{name} is home</button>}
  </div>
  return <div className="losttoggle">
    {ask ? <div className="confirm" role="group" aria-label="Please confirm">
      <p>Report {name} lost? Anyone who taps {name}'s Trot Tag gets an "I found {name}" form, and {name}'s public page shows a Reported lost banner if the page is public. Your name, phone, email and address are never shown.</p>
      <div className="field lightf"><label htmlFor={id}>Note for finders (optional)</label><textarea id={id} value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} placeholder="Red harness. Shy, please do not chase." /><p className="fhint">{140 - note.length} characters left. Do not put your phone number or address here.</p></div>
      {err && <p className="formerr" role="alert">{err}</p>}
      <div className="row g8"><button type="button" className="cta small lostbtn" onClick={() => go(true)} disabled={busy}>{busy ? 'Working' : `Report ${name} lost`}</button><button type="button" className="cta small white bordered" onClick={() => { setAsk(false); setErr('') }} disabled={busy}>Cancel</button></div>
    </div> : <div className="row g8"><button type="button" className="cta small lostbtn" onClick={() => setAsk(true)}>Report {name} lost</button><span className="plusnote">Included in Trot Plus</span></div>}
  </div>
}

// Every tag page view and found report, newest first.
export function TagActivity({ scans, canEdit, onRead, busyId, sample }) {
  if (!scans.length) return <p className="regnote">Nothing yet. When someone taps the tag or opens its address, it shows up here with the time and the kind of phone. Trot does not record who they are or where they are.</p>
  return <div>{scans.map((s) => <div key={s.id} className="hentry">
    <div className="row between g8"><span className="hb">{s.kind === 'found' ? 'Found report' : 'Tag scanned'}{sample && <span className="tagx">Sample</span>}</span>{s.kind === 'found' && !s.read && <span className="regchip expired">Unread</span>}</div>
    <div className="regmeta">{[whenOf(s.at), s.tagLabel, s.device].filter(Boolean).join(' · ')}</div>
    {s.kind === 'found' && <div className="actreport"><Report s={s} canEdit={canEdit} onRead={onRead} busy={busyId === s.id} /></div>}
  </div>)}</div>
}

// What a real dog's care team needs on Home: unread found reports and the lost notice.
export function HomeAlerts({ real, setToast }) {
  const { dog } = real
  const [state, reload] = useTagState(dog.slug)
  const [busyId, setBusyId] = useState(null)
  const onRead = async (s) => { setBusyId(s.id); try { await api.tags.markRead(dog.slug, s.id); await reload() } catch (e) { setToast(e.message) } setBusyId(null) }
  if (!state || (!state.lost.on && !state.unread)) return null
  return <div className="idsec home"><FoundReports name={dog.name} state={state} onRead={onRead} busyId={busyId} /><LostNotice name={dog.name} lost={state.lost} /></div>
}
