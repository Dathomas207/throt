import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ic, Confirm, copyText } from '../ui.jsx'
import { api } from '../api.js'
import { qrMatrix, qrPath } from '../qr.js'
import { DEMO_ID } from '../data.js'
import { DEMO_NOTE, FoundReports, LostNotice, LostToggle, TagActivity, useTagState } from './LostDog.jsx'

// Registration and ID for one dog: the microchip, licence and rabies checklist, the form behind it,
// the Trot Tag (an NFC sticker or QR code that opens a page about the dog) and the tag's activity.
// Trot files nothing with a county or a registry. It keeps what the care team types and links out.
const AAHA = 'https://www.aaha.org/for-veterinary--professionals/microchip-registry-lookup-tool-aaha-find-your-pets-microchip-registry/'
const PETDATA = 'https://www.petdata.com/for-pet-owners/chr/license-requirements'
const CMPD = 'https://www.charlottenc.gov/Animal-Care-and-Control/services/Pet-License'
const CHARLOTTE = 'Charlotte-Mecklenburg'
const REGISTRIES = ['24Petwatch', 'AKC Reunite', 'AVID', 'HomeAgain', 'PetLink']
const CHIP = { done: 'Done', missing: 'Missing', expiring: 'Expiring soon', expired: 'Expired' }
const fmtDay = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const pretty = (detail) => String(detail || '').replace(/\d{4}-\d{2}-\d{2}/, (d) => fmtDay(d))
const dayIn = (n) => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
// The same rule the server applies: 15 digits, 10 characters of 0-9 and A-F, or 9 digits.
const cleanChip = (v) => String(v || '').replace(/[\s\-.*]/g, '').toUpperCase()
const chipOk = (s) => !s || /^\d{15}$/.test(s) || /^[0-9A-F]{10}$/.test(s) || /^\d{9}$/.test(s)
const dueOf = (reg) => (reg ? reg.checklist.filter((c) => c.status === 'expiring' || c.status === 'expired') : [])
const shell = () => (typeof document !== 'undefined' && document.querySelector('.shell')) || document.body

// The demo's sample record, shaped like the API's answer. Dates are worked out from today.
function demoReg(key) {
  const r = DEMO_ID[key].registration
  const registration = { ...r, licenseExpiresOn: r.licenseExpiresIn == null ? null : dayIn(r.licenseExpiresIn), rabiesDueOn: r.rabiesDueIn == null ? null : dayIn(r.rabiesDueIn) }
  const st = (n) => (n < 0 ? 'expired' : n <= 30 ? 'expiring' : 'done')
  const dated = (key2, label, has, n, on, words) => ({ key: key2, label, status: n == null ? (has ? 'done' : 'missing') : st(n), detail: n == null ? (has ? words[3] : words[4]) : `${words[n < 0 ? 0 : n <= 30 ? 1 : 2]} ${on}` })
  return {
    registration, canEdit: true, charlotte: false,
    checklist: [
      { key: 'microchip', label: 'Microchip', status: r.microchipNumber ? 'done' : 'missing', detail: r.microchipNumber ? (r.microchipRegistry ? `Number saved. Registry: ${r.microchipRegistry}` : 'Number saved. Add the registry that holds it.') : 'No chip number saved' },
      dated('license', 'License', !!r.licenseNumber, r.licenseExpiresIn, registration.licenseExpiresOn, ['Expired on', 'Expires on', 'Current until', 'Number saved. Add the date it expires.', 'No license saved']),
      dated('rabies', 'Rabies vaccine', !!r.rabiesTag, r.rabiesDueIn, registration.rabiesDueOn, ['Was due on', 'Due on', 'Next due on', 'Tag number saved. Add the date the next vaccine is due.', 'No rabies tag or due date saved']),
    ],
  }
}
const demoState = (key) => ({ scans: DEMO_ID[key].scans.map((s) => ({ ...s, at: new Date(Date.now() - s.daysAgo * 864e5).toISOString() })), unread: 0, lost: { on: false, since: null, note: '' }, canEdit: true })
const demoTags = (key) => DEMO_ID[key].tags.map((t) => ({ ...t, kind: 'tag', active: true, url: `${location.origin}/t/${t.code}`, createdAt: new Date(Date.now() - t.daysAgo * 864e5).toISOString() }))

function DueBanner({ name, due, onOpen }) {
  if (!due.length) return null
  const worst = due.some((c) => c.status === 'expired')
  return <button type="button" className={`duebanner ${worst ? 'late' : ''}`} onClick={onOpen}><Ic n="tag" s={20} /><span className="grow"><b>{due.map((c) => `${c.label} ${c.status === 'expired' ? 'has expired' : 'is expiring soon'}`).join('. ')}</b><small>{due.map((c) => pretty(c.detail)).join(' · ')}. Open {name}'s Registration and ID.</small></span></button>
}
const EntryRow = ({ reg, onOpen }) => {
  const done = reg ? reg.checklist.filter((c) => c.status === 'done').length : null
  return <button type="button" className="rrow box idrow" onClick={onOpen}><span className="ricon"><Ic n="tag" s={20} c="#1F5AE8" /></span><span className="grow"><b>Registration and ID</b><small>{done == null ? 'Microchip, license, rabies tag and Trot Tag' : `${done} of 3 on the checklist done · Trot Tag and Lost Dog mode`}</small></span></button>
}

// The dog tab's section for a real dog: alerts, the reminder banner, the entry row and the lost toggle.
export function DogId({ real, setToast }) {
  const { dog } = real
  const [state, reload] = useTagState(dog.slug)
  const [reg, setReg] = useState(null)
  const [open, setOpen] = useState(false), [busyId, setBusyId] = useState(null)
  useEffect(() => { let on = true; setReg(null); api.registration.get(dog.slug).then((r) => { if (on) setReg(r) }, () => {}); return () => { on = false } }, [dog.slug])
  const onRead = async (s) => { setBusyId(s.id); try { await api.tags.markRead(dog.slug, s.id); await reload() } catch (e) { setToast(e.message) } setBusyId(null) }
  const onSet = async (lost, note) => {
    try { await api.tags.setLost(dog.slug, lost, note); await reload(); setToast(lost ? `${dog.name} is reported lost. The found form is open.` : `Glad ${dog.name} is home. Lost Dog mode is off.`); return '' }
    catch (e) { return e.message }
  }
  return <div className="idsec">
    <FoundReports name={dog.name} state={state} onRead={onRead} busyId={busyId} />
    <LostNotice name={dog.name} lost={state && state.lost} />
    <DueBanner name={dog.name} due={dueOf(reg)} onOpen={() => setOpen(true)} />
    <EntryRow reg={reg} onOpen={() => setOpen(true)} />
    {state && state.canEdit && <LostToggle name={dog.name} lost={state.lost} onSet={onSet} />}
    {open && createPortal(<Registration name={dog.name} slug={dog.slug} reg={reg} setReg={setReg} state={state} reload={reload} onRead={onRead} busyId={busyId} onSet={onSet} setToast={setToast} close={() => setOpen(false)} />, shell())}
  </div>
}
// The same section in the demo: sample data, and every change answers with a toast.
export function DemoDogId({ dd, setToast }) {
  const [open, setOpen] = useState(false)
  const reg = useMemo(() => demoReg(dd.key), [dd.key]), state = useMemo(() => demoState(dd.key), [dd.key])
  const no = async () => { setToast(DEMO_NOTE); return '' }
  return <div className="idsec">
    <DueBanner name={dd.dog.name} due={dueOf(reg)} onOpen={() => setOpen(true)} />
    <EntryRow reg={reg} onOpen={() => setOpen(true)} />
    <LostToggle name={dd.dog.name} lost={state.lost} onSet={no} />
    {open && createPortal(<Registration demo={dd.key} name={dd.dog.name} reg={reg} state={state} onSet={no} onRead={no} setToast={setToast} close={() => setOpen(false)} />, shell())}
  </div>
}

function Qr({ text, label }) {
  const p = useMemo(() => { const m = qrMatrix(text); return m ? qrPath(m) : null }, [text])
  if (!p) return <p className="regnote">This address is too long for a code. Use the address itself.</p>
  return <svg className="qr" role="img" aria-label={label} viewBox={`0 0 ${p.size} ${p.size}`} shapeRendering="crispEdges"><rect width={p.size} height={p.size} fill="#fff" /><path d={p.d} fill="#000" /></svg>
}

function TagCard({ t, name, demo, onRetire, setToast }) {
  const [qr, setQr] = useState(false), [ask, setAsk] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const copy = async () => setToast((await copyText(t.url)) ? 'Tag address copied' : 'Could not copy. Select the address and copy it by hand.')
  const retire = async () => { setBusy(true); const e = await onRetire(t); setBusy(false); if (e) setErr(e); else setAsk(false) }
  return <div className="hentry tagcard">
    <div className="row between g8"><span className="hb">{t.label || 'Trot Tag'}{demo && <span className="tagx">Sample</span>}{t.kind === 'link' && <span className="tagx">Public page link</span>}</span><span className="regmeta">Made {fmtDay(t.createdAt.slice(0, 10))}</span></div>
    <label className="field lightf"><span>Address to write to the tag</span><input className="linkinput" readOnly value={t.url} onFocus={(e) => e.target.select()} /></label>
    <div className="row g8"><button type="button" className="cta small" onClick={copy}>Copy address</button><button type="button" className="cta small white bordered" aria-expanded={qr} onClick={() => setQr(!qr)}>{qr ? 'Hide QR code' : 'Show QR code'}</button>{!demo && <a className="cta small white bordered" href={t.url} target="_blank" rel="noopener">Open page</a>}</div>
    {qr && <div className="qrbox"><Qr text={t.url} label={`QR code for ${name}'s tag address`} /><p className="regnote">Drawn on this phone. Print it or engrave it as a backup for phones without NFC.{demo ? ' This sample address does not open a page.' : ''}</p></div>}
    {ask ? <Confirm text="Retire this tag? Its address stops working at once and cannot be turned back on. A sticker that carries it will open a page that says no dog is linked." yes="Retire tag" busy={busy} error={err} onYes={retire} onNo={() => { setAsk(false); setErr('') }} />
      : <button type="button" className="reglink" onClick={() => setAsk(true)}>Retire this tag</button>}
  </div>
}

function Form({ reg, name, demo, onSave }) {
  const id = useId()
  const r = reg.registration
  const [f, setF] = useState({ microchipNumber: r.microchipNumber, microchipRegistry: r.microchipRegistry, licenseJurisdiction: r.licenseJurisdiction, licenseNumber: r.licenseNumber, licenseExpiresOn: r.licenseExpiresOn || '', rabiesTag: r.rabiesTag, rabiesDueOn: r.rabiesDueOn || '', akcNumber: r.akcNumber, altered: r.altered })
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const set = (k) => (e) => { setF((v) => ({ ...v, [k]: e.target.value })); setErr('') }
  const chipBad = !chipOk(cleanChip(f.microchipNumber))
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (chipBad) { setErr('Check the microchip number: 15 digits, 10 characters (digits and the letters A to F), or 9 digits.'); return }
    setBusy(true); setErr('')
    const x = await onSave({ ...f, microchipNumber: cleanChip(f.microchipNumber), licenseExpiresOn: f.licenseExpiresOn || null, rabiesDueOn: f.rabiesDueOn || null })
    setBusy(false); if (x) setErr(x)
  }
  const ro = !reg.canEdit
  const T = (k, label, extra = {}, hint) => <div className="field lightf"><label htmlFor={`${id}-${k}`}>{label}</label><input id={`${id}-${k}`} value={f[k]} onChange={set(k)} readOnly={ro} autoComplete="off" {...extra} />{hint}</div>
  return <form className="card padc" onSubmit={submit} noValidate aria-label={`${name}'s registration details`}>
    <div className="eyebrow dark">DETAILS{demo ? ' · SAMPLE DATA, NOT REAL NUMBERS' : ''}</div>
    {ro && <p className="regnote">Only the owner and family can change these. You can read them.</p>}
    {T('microchipNumber', 'Microchip number', { inputMode: 'text', maxLength: 30, 'aria-invalid': chipBad ? true : undefined, spellCheck: false }, chipBad ? <p className="ferr" role="alert">A chip number is 15 digits, 10 characters (digits and A to F), or 9 digits.</p> : <p className="fhint">On the paperwork from your vet, shelter or breeder. Spaces are fine.</p>)}
    {T('microchipRegistry', 'Microchip registry', { maxLength: 60, list: `${id}-reg`, placeholder: 'The company that holds your contact details' })}
    <datalist id={`${id}-reg`}>{REGISTRIES.map((x) => <option key={x} value={x} />)}</datalist>
    {T('licenseJurisdiction', 'License jurisdiction', { maxLength: 60, placeholder: 'City or county that issued it' })}
    {T('licenseNumber', 'License number', { maxLength: 40 })}
    {T('licenseExpiresOn', 'License expires on', { type: 'date' })}
    {T('rabiesTag', 'Rabies tag number', { maxLength: 40 })}
    {T('rabiesDueOn', 'Next rabies vaccine due on', { type: 'date' })}
    {T('akcNumber', 'AKC registration number', { maxLength: 20, placeholder: 'Leave empty if not registered' })}
    <div className="field lightf"><label htmlFor={`${id}-alt`}>Spayed or neutered</label><select id={`${id}-alt`} value={f.altered} onChange={set('altered')} disabled={ro}><option value="unknown">Not sure</option><option value="yes">Yes</option><option value="no">No</option></select></div>
    {err && <p className="formerr" role="alert">{err}</p>}
    {!ro && <button className="cta" disabled={busy}>{busy ? 'Saving' : 'Save details'}</button>}
    <p className="regnote">Only {name}'s care team can see these. They never appear on {name}'s public page or Trot Tag page.</p>
  </form>
}

export default function Registration({ demo, name, slug, reg, setReg, state, reload, onRead, busyId, onSet, setToast, close }) {
  const back = useRef(null)
  const [tags, setTags] = useState(demo ? demoTags(demo) : null), [label, setLabel] = useState(''), [making, setMaking] = useState(false), [terr, setTerr] = useState('')
  const canEdit = !!(reg && reg.canEdit)
  const loadTags = useCallback(async () => { try { setTags((await api.tags.list(slug)).tags) } catch (e) { setTerr(e.message) } }, [slug])
  useEffect(() => { if (back.current) back.current.focus() }, [])
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') close() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [close])
  useEffect(() => { if (!demo && canEdit) loadTags() }, [demo, canEdit, loadTags])
  // Turning Lost Dog mode on can make the public page's link, so the list is read again after it.
  const lostOn = !!(state && state.lost.on)
  useEffect(() => { if (!demo && canEdit && lostOn) loadTags() }, [lostOn])
  const save = async (body) => {
    if (demo) { setToast(DEMO_NOTE); return '' }
    try { setReg(await api.registration.save(slug, body)); setToast(`${name}'s details are saved`); return '' } catch (e) { return e.message }
  }
  const make = async (e) => {
    e.preventDefault()
    if (demo) { setToast(DEMO_NOTE); return }
    if (making) return
    setMaking(true); setTerr('')
    try { await api.tags.create(slug, label.trim()); setLabel(''); await loadTags(); setToast('Trot Tag made. Write its address to a sticker.') } catch (x) { setTerr(x.message) }
    setMaking(false)
  }
  const retire = async (t) => {
    if (demo) { setToast(DEMO_NOTE); return '' }
    try { await api.tags.retire(slug, t.id); await loadTags(); setToast('Tag retired'); return '' } catch (x) { return x.message }
  }
  const live = (tags || []).filter((t) => t.active), old = (tags || []).filter((t) => !t.active)
  const charlotte = !!(reg && reg.registration.licenseJurisdiction === CHARLOTTE)
  return (
    <div className="detail regscreen" role="dialog" aria-modal="true" aria-label={`${name}'s registration and ID`}>
      <header className="dhead"><button ref={back} className="round flat" aria-label="Back" onClick={close}><Ic n="back" /></button><b>Registration and ID</b><span className="round flat" aria-hidden="true" /></header>
      <div className="scroll"><div className="list">
        {!reg && <div className="card empty" role="status"><p>Fetching {name}'s details</p></div>}
        {demo && <p className="regnote padx">Sample data for {name}. Every number is made up, and changes are not saved in the demo.</p>}
        {state && <FoundReports name={name} state={state} onRead={onRead} busyId={busyId} />}
        {state && <LostNotice name={name} lost={state.lost} />}
        {reg && <section className="card padc" aria-label="Checklist">
          <div className="eyebrow dark">CHECKLIST</div>
          {reg.checklist.map((c) => <div key={c.key} className="hentry"><div className="row between g8"><span className="hb">{c.label}</span><span className={`regchip ${c.status}`}>{CHIP[c.status]}</span></div><div className="regmeta">{pretty(c.detail)}</div></div>)}
          <p className="regnote">Expiring soon means 30 days or fewer. Trot shows a reminder on {name}'s tab. It does not send emails or notifications.</p>
        </section>}
        {state && state.canEdit && <section className="card padc" aria-label="Lost Dog mode">
          <div className="eyebrow dark">LOST DOG MODE</div>
          <p className="regnote">{state.lost.on ? `On since ${new Date(state.lost.since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Anyone who taps ${name}'s Trot Tag can send the care team a message, a way to reach them and, if they choose, their location.` : `If ${name} goes missing, turn this on. Anyone who taps ${name}'s Trot Tag can then tell the care team where ${name} is. Your own contact details are never shown.`}</p>
          <LostToggle name={name} lost={state.lost} onSet={onSet} />
        </section>}
        {reg && <Form key={reg.registration.updatedAt || 'new'} reg={reg} name={name} demo={demo} onSave={save} />}
        <section className="card padc" aria-label="About microchips">
          <div className="eyebrow dark">WHAT A MICROCHIP DOES</div>
          <p className="regtext">A microchip is a tiny passive chip under the skin. It holds an ID number and nothing else. A vet or shelter reads the number with a handheld scanner held right against the dog.</p>
          <p className="regtext"><b>It cannot locate a dog.</b> It has no battery and no GPS, and phones cannot read it. The number only helps if a registry has your current phone number, so check that your details there are up to date.</p>
          <a className="cta white bordered linkout" href={AAHA} target="_blank" rel="noopener noreferrer">Check which registry holds this chip</a>
          <p className="regnote">Opens the AAHA Universal Pet Microchip Lookup. It names the registry for a chip number. It does not show owner details. Trot does not register chips or file anything with a registry. It keeps what you type here and links out.</p>
        </section>
        {charlotte && <section className="card padc" aria-label="Licensing in Charlotte-Mecklenburg">
          <div className="eyebrow dark">LICENSING IN CHARLOTTE-MECKLENBURG</div>
          <p className="regtext">In Charlotte, Mint Hill, Pineville and unincorporated Mecklenburg County, dogs four months and older must be licensed, for 1 year or 3 years. You need proof of a current rabies vaccination. PetData runs licensing for CMPD Animal Care &amp; Control, and current fees are on their site.</p>
          <a className="cta linkout" href={PETDATA} target="_blank" rel="noopener noreferrer">License or renew with PetData</a>
          <a className="reglink" href={CMPD} target="_blank" rel="noopener noreferrer">CMPD Animal Care &amp; Control pet license page</a>
          <p className="regnote">Trot does not file a license for you. After you license or renew, type the number and expiry date above so the checklist stays right.</p>
        </section>}
        {canEdit && <section className="card padc" aria-label="Trot Tag">
          <div className="eyebrow dark">TROT TAG</div>
          <p className="regtext">A Trot Tag is a web address you write to a blank NFC sticker or collar tag. Anyone who taps it with a phone sees {name}'s name, photo and breed, with no app needed. If {name} is reported lost, they also get a form to tell you where {name} is.</p>
          <p className="regtext"><b>The tag does not track location.</b> It has no battery and no GPS. You only hear from it when someone taps it. The page never shows your name, phone, email or address.</p>
          {!tags && !terr && <p className="regnote" role="status">Fetching tags</p>}
          {live.map((t) => <TagCard key={t.id} t={t} name={name} demo={!!demo} onRetire={retire} setToast={setToast} />)}
          <form className="hentry" onSubmit={make}>
            <div className="field lightf"><label htmlFor="tag-label">{live.length ? 'Make another tag' : 'Make a tag'}</label><input id="tag-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="Label, such as Blue collar" /></div>
            {terr && <p className="formerr" role="alert">{terr}</p>}
            <button className="cta small" disabled={making}>{making ? 'Making' : 'Make a Trot Tag'}</button>
          </form>
          {old.length > 0 && <p className="regnote">{old.length} retired {old.length === 1 ? 'tag' : 'tags'}. Retired addresses never work again.</p>}
          <div className="hentry">
            <div className="hb">Write the address to an NFC sticker</div>
            <ol className="steps">
              <li>Get a blank NFC sticker or a blank NFC collar tag. One that is waterproof lasts longer on a collar.</li>
              <li>Install an NFC writing app on your phone. Several free ones are in the App Store and Google Play.</li>
              <li>Tap Copy address above. In the app, choose to write a URL (web link) record and paste the address.</li>
              <li>Hold the top or back of your phone on the sticker until the app says it is written.</li>
              <li>Test it: close the app and tap the sticker. {name}'s tag page should open. The tap also shows under Tag activity.</li>
              <li>Fix the sticker to the collar or ID tag, away from metal, which can block the signal.</li>
            </ol>
            <p className="regnote">If a tag is lost or you give the collar away, retire the tag here and make a new one. The QR code holds the same address, for phones that cannot read NFC.</p>
          </div>
        </section>}
        {state && <section className="card padc" aria-label="Tag activity">
          <div className="eyebrow dark">TAG ACTIVITY</div>
          <TagActivity scans={state.scans} canEdit={state.canEdit} onRead={onRead} busyId={busyId} sample={!!demo} />
          <p className="regnote">Trot records the time and the kind of phone. It does not record who tapped the tag, and it does not store their internet address. A location appears only when a finder chooses to share it.</p>
        </section>}
      </div></div>
    </div>
  )
}
