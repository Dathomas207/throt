import React, { useCallback, useEffect, useId, useState } from 'react'
import { Ic, Confirm } from '../ui.jsx'
import { api } from '../api.js'

const KINDS = [['ribbon', 'Ribbon'], ['title', 'Title'], ['certificate', 'Certificate'], ['trick', 'Trick'], ['other', 'Other']]
const date = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
// Original shapes in the Trot palette: a rosette for ribbons, a medal for titles, a scroll for certificates, a star for tricks.
export function AwardArt({ kind, s = 44 }) {
  return <svg aria-hidden="true" width={s} height={s} viewBox="0 0 48 48" className="awardart">
    {kind === 'ribbon' ? <><path d="M17 26l-5 18 8-5 4 7 4-7 8 5-5-18z" fill="#1F5AE8" /><circle cx="24" cy="18" r="14" fill="#C8F031" stroke="#0F1B2D" strokeWidth="2.5" /><circle cx="24" cy="18" r="7" fill="#0F1B2D" /></>
      : kind === 'title' ? <><path d="M16 2h16l-4 16h-8z" fill="#1F5AE8" /><circle cx="24" cy="30" r="14" fill="#C8F031" stroke="#0F1B2D" strokeWidth="2.5" /><path d="M24 22l2.500 5 5.500.800-4 3.900.900 5.500-4.900-2.600-4.900 2.600.900-5.500-4-3.900 5.500-.800z" fill="#0F1B2D" /></>
        : kind === 'certificate' ? <><rect x="6" y="8" width="36" height="28" rx="4" fill="#fff" stroke="#0F1B2D" strokeWidth="2.5" /><path d="M13 17h22M13 23h14" stroke="#1F5AE8" strokeWidth="2.5" strokeLinecap="round" /><circle cx="33" cy="34" r="7" fill="#C8F031" stroke="#0F1B2D" strokeWidth="2.5" /></>
          : <><circle cx="24" cy="24" r="20" fill="#0F1B2D" /><path d="M24 10l4 9 10 1.200-7.500 6.800 2.200 9.800L24 31.500 15.300 36.800l2.200-9.800L10 20.200 20 19z" fill="#C8F031" /></>}
  </svg>
}
// Trot's own badges look different from recorded awards: a hexagon, filled when earned, an outline when locked.
function Badge({ b }) {
  const pct = Math.min(100, Math.round((b.progress / b.target) * 100))
  return <li className={`tbadge ${b.earned ? 'on' : ''}`}>
    <svg aria-hidden="true" width="40" height="44" viewBox="0 0 40 44"><path d="M20 2l16 9v22l-16 9-16-9V11z" fill={b.earned ? '#C8F031' : 'none'} stroke={b.earned ? '#0F1B2D' : '#9AA3B0'} strokeWidth="2.5" strokeDasharray={b.earned ? undefined : '4 3'} />{b.earned && <path d="M12 22l6 6 11-12" fill="none" stroke="#0F1B2D" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}</svg>
    <span className="grow"><b>{b.name}</b><small>{b.earned ? 'Earned' : `${b.how} ${b.progress} of ${b.target} ${b.unit}`}</small>{!b.earned && <span className="bar thin" role="progressbar" aria-valuemin={0} aria-valuemax={b.target} aria-valuenow={b.progress} aria-label={`Progress toward ${b.name}`}><i style={{ width: pct + '%' }} /></span>}</span>
  </li>
}
const AwardRow = ({ a, children, sample }) => <div className="hentry"><div className="row g12"><AwardArt kind={a.kind} /><div className="grow"><div className="hb">{a.title}{sample && <span className="tagx">Sample</span>}{a.public && <span className="tagx">On public page</span>}</div><div className="meta">{[a.placement, a.eventName, a.awardedOn && date(a.awardedOn)].filter(Boolean).join(' · ')}</div></div></div>{children}</div>

export function DemoAwards({ acts, dd }) {
  const DOG = dd.dog
  const w = acts.filter((a) => a.type !== 'Daycare'), mi = Math.round(w.reduce((s, a) => s + a.miles, 0) * 10) / 10
  const b = (name, how, progress, target, unit) => ({ id: name, name, how, progress: Math.min(progress, target), target, unit, earned: progress >= target })
  const badges = [b('First walk', 'Save one walk.', w.length, 1, 'walk'), b('7-day streak', 'Walk 7 days in a row.', DOG.streak, 7, 'days'), b('25 miles', 'Cover 25 miles in all.', DOG.lifetime, 25, 'mi'), b('5 places', 'Walk in 5 different places.', new Set(w.map((a) => a.place).filter(Boolean)).size, 5, 'places'), b('3 walkers', 'Get walked by 3 different people.', new Set(w.map((a) => a.by)).size, 3, 'people'), b('2,000 miles', 'Cover 2,000 miles in all.', DOG.lifetime, 2000, 'mi')]
  return <section className="card padc" aria-label="Awards and badges">
    <b>Awards</b>
    {dd.awards.map((a) => <AwardRow key={a.id} sample a={{ ...a, awardedOn: new Date(Date.now() - a.daysAgo * 864e5).toISOString().slice(0, 10) }} />)}
    <div className="sl">TROT BADGES, EARNED FROM WALKS</div>
    <ul className="tbadges">{badges.map((x) => <Badge key={x.id} b={x} />)}</ul>
  </section>
}

export function RealAwards({ real, setToast }) {
  const { dog } = real
  const owner = dog.role === 'owner'
  const id = useId()
  const [data, setData] = useState(null), [adding, setAdding] = useState(false), [ask, setAsk] = useState(null)
  const blank = { title: '', kind: 'ribbon', eventName: '', placement: '', awardedOn: '', public: false }
  const [f, setF] = useState(blank), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const load = useCallback(async () => { try { setData(await api.awards.list(dog.slug)) } catch (e) {} }, [dog.slug, real.totals.lifetime.outings])
  useEffect(() => { setData(null); load() }, [load])
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!f.title.trim()) { setErr('Say what the award is.'); return }
    if (f.awardedOn && f.awardedOn > todayStr()) { setErr('The date cannot be in the future.'); return }
    setBusy(true); setErr('')
    try { await api.awards.add(dog.slug, { ...f, title: f.title.trim(), awardedOn: f.awardedOn || null }); setF(blank); setAdding(false); await load(); setToast('Award added') } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  const del = async (a) => { setAsk({ id: a.id, busy: true }); try { await api.awards.remove(a.id); setAsk(null); await load(); setToast('Award deleted') } catch (x) { setAsk({ id: a.id, busy: false, error: x.message }) } }
  const pub = async (a, on) => { try { await api.awards.update(a.id, { public: on }); await load(); setToast(on ? 'Shown on the public page' : 'Hidden from the public page') } catch (x) { setToast(x.message) } }
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })); setErr('') }
  if (!data) return null
  const earned = data.badges.filter((b) => b.earned), locked = data.badges.filter((b) => !b.earned)
  return <section className="card padc" aria-label="Awards and badges">
    <div className="row between g8"><b>Awards</b>{!adding && <button className="tbtn" onClick={() => setAdding(true)}>Add an award</button>}</div>
    {data.awards.length === 0 && !adding && <p className="meta">Titles, ribbons and certificates {dog.name} has earned go here. Nothing is recorded yet.</p>}
    {adding && <form className="wform hform" onSubmit={submit} noValidate aria-label="Add an award">
      <div className="field lightf"><label htmlFor={`${id}-t`}>Award</label><input id={`${id}-t`} value={f.title} onChange={set('title')} maxLength={80} autoComplete="off" autoFocus /></div>
      <div className="field lightf"><label htmlFor={`${id}-k`}>Kind</label><select id={`${id}-k`} value={f.kind} onChange={set('kind')}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <div className="field lightf"><label htmlFor={`${id}-e`}>Event (optional)</label><input id={`${id}-e`} value={f.eventName} onChange={set('eventName')} maxLength={100} autoComplete="off" /></div>
      <div className="field lightf"><label htmlFor={`${id}-p`}>Placement (optional)</label><input id={`${id}-p`} value={f.placement} onChange={set('placement')} maxLength={60} autoComplete="off" /></div>
      <div className="field lightf"><label htmlFor={`${id}-d`}>Date (optional)</label><input id={`${id}-d`} type="date" value={f.awardedOn} onChange={set('awardedOn')} max={todayStr()} /></div>
      {owner && <label className="switch slim"><input type="checkbox" checked={f.public} onChange={set('public')} /><span className="grow"><b>Show on {dog.name}'s public page</b><small>Off unless you tick it.</small></span></label>}
      {err && <p className="formerr" role="alert">{err}</p>}
      <div className="row g8"><button className="cta small" type="submit" disabled={busy}>{busy ? 'Saving' : 'Save award'}</button><button className="cta small white bordered" type="button" onClick={() => { setAdding(false); setErr('') }}>Cancel</button></div>
    </form>}
    {data.awards.map((a) => <AwardRow key={a.id} a={a}>
      {owner && <label className="switch slim"><input type="checkbox" checked={a.public} onChange={(e) => pub(a, e.target.checked)} /><span className="grow"><b>Show on the public page</b></span></label>}
      {a.canEdit && (ask && ask.id === a.id ? <Confirm text={`Delete "${a.title}"?`} yes="Delete" no="Keep it" busy={ask.busy} error={ask.error} onYes={() => del(a)} onNo={() => setAsk(null)} /> : <button className="tbtn" aria-label={`Delete ${a.title}`} onClick={() => setAsk({ id: a.id })}>Delete</button>)}
    </AwardRow>)}
    <div className="sl">TROT BADGES, EARNED FROM WALKS</div>
    <ul className="tbadges">{[...earned, ...locked].map((b) => <Badge key={b.id} b={b} />)}</ul>
  </section>
}
