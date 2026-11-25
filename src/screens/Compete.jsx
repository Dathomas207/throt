import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Ic, Av, DogAv, Confirm, usePhoto } from '../ui.jsx'
import { api } from '../api.js'
import { DEMO_BOARD, DEMO_CHALLENGES } from '../data.js'

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const day = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const METRICS = [['miles', 'Miles', 'mi'], ['minutes', 'Minutes', 'min'], ['outings', 'Outings', ''], ['top_speed', 'Top speed', 'mph']]
const KINDS = [['conformation', 'Conformation show'], ['agility', 'Agility'], ['obedience', 'Obedience'], ['rally', 'Rally'], ['fun_match', 'Fun match'], ['meetup', 'Meetup'], ['class', 'Class'], ['other', 'Other']]
const kindLabel = (k) => (KINDS.find((x) => x[0] === k) || KINDS[7])[1]
const fmtVal = (v, m) => { const u = METRICS.find((x) => x[0] === m)[2]; return `${m === 'miles' || m === 'top_speed' ? Number(v).toFixed(1) : v}${u ? ' ' + u : ''}` }
const Seg = ({ label, value, set, options }) => <div className="chips wrap" role="group" aria-label={label}>{options.map(([k, l]) => <button key={k} className={`chip flat ${value === k ? 'on' : ''}`} aria-pressed={value === k} onClick={() => set(k)}>{l}</button>)}</div>
function BoardAv({ r }) { const src = usePhoto(r.photoUrl); return <Av t={(r.name[0] || 'D').toUpperCase()} s={36} src={src} alt="" /> }

// One hub for leaderboards, challenges and events. Signed in it reads the API. In the demo the boards
// and challenges are samples built from the demo walks, and the events are the real curated list.
export default function Compete({ close, real, acts, setToast, start = 'boards', hasApi }) {
  const back = useRef(null)
  const [tab, setTab] = useState(start)
  useEffect(() => { if (back.current) back.current.focus() }, [])
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') close() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [close])
  return (
    <div className="detail" role="dialog" aria-modal="true" aria-label="Compete">
      <header className="dhead"><button ref={back} className="round flat" aria-label="Back" onClick={close}><Ic n="back" /></button><b>Compete</b><span className="round flat" aria-hidden="true" /></header>
      <div className="subtabs" role="tablist">{[['boards', 'Leaderboards'], ['challenges', 'Challenges'], ['events', 'Events']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      <div className="scroll">
        {tab === 'boards' && (real ? <RealBoards real={real} /> : <DemoBoards acts={acts} />)}
        {tab === 'challenges' && (real ? <RealChallenges real={real} setToast={setToast} /> : <DemoChallenges acts={acts} setToast={setToast} />)}
        {tab === 'events' && <Events real={real} setToast={setToast} hasApi={real ? true : hasApi} />}
      </div>
    </div>
  )
}

function Rows({ rows, metric, link }) {
  return <ol className="board">{rows.map((r) => {
    const inner = <><span className="rk num">{r.rank}</span>{link ? <BoardAv r={r} /> : <DogAv name={r.name} demo s={36} />}<span className="grow"><b>{r.name}{r.you && <span className="you">Your dog</span>}{r.isDemo && <span className="tagx">Demo dog</span>}</b><small>{r.breed}</small></span><span className="num">{fmtVal(r.value, metric)}</span></>
    return <li key={r.slug || r.name} className={r.you ? 'me' : ''}>{link ? <a className="brow" href={`/d/${r.slug}`} target="_blank" rel="noopener" aria-label={`${r.name}, rank ${r.rank}, ${fmtVal(r.value, metric)}. Opens the public page`}>{inner}</a> : <div className="brow">{inner}</div>}</li>
  })}</ol>
}

function RealBoards({ real }) {
  const { dog } = real
  const [period, setPeriod] = useState('week'), [metric, setMetric] = useState('miles'), [scope, setScope] = useState('all')
  const [data, setData] = useState(null), [err, setErr] = useState('')
  const scopes = [['all', 'All dogs'], ...(dog.breed ? [['breed', dog.breed]] : []), ...(dog.city ? [['city', dog.city]] : []), ...(dog.weight ? [['size', 'Same size']] : [])]
  useEffect(() => {
    let on = true
    setErr('')
    api.boards.get({ period, metric, scope, dog: dog.slug }).then((r) => { if (on) setData(r) }, (e) => { if (on) { setErr(e.message); setData(null) } })
    return () => { on = false }
  }, [period, metric, scope, dog.slug, real.totals.lifetime.outings])
  const NOTE = { private: `${dog.name}'s page is private, so ${dog.name} is not on the boards.`, opted_out: `${dog.name} is switched off the boards in Edit profile.`, no_walks: `${dog.name} has nothing on this board yet for this ${period}.`, not_in_scope: `${dog.name} is not part of this group.` }
  return <div className="list">
    <div className="card padc">
      <Seg label="Period" value={period} set={setPeriod} options={[['week', 'This week'], ['month', 'This month']]} />
      <Seg label="Metric" value={metric} set={setMetric} options={METRICS.map(([k, l]) => [k, l])} />
      <Seg label="Dogs" value={scope} set={setScope} options={scopes} />
      {!dog.city && <p className="meta">Add a city in Edit profile to get a city board.</p>}
    </div>
    {err && <p className="formerr" role="alert">{err}</p>}
    {data && <div className="card padc" aria-live="polite">
      <div className="row between g8"><b>{data.scopeLabel}</b><span className="meta">{data.period.label}</span></div>
      {data.total === 0 ? <div className="empty"><b>Nobody is on this board yet</b><p>Save a walk with {dog.name} and it starts here.</p></div> : <Rows rows={data.rows} metric={metric} link />}
      {data.total > 0 && data.few && <p className="meta">Only {data.total} {data.total === 1 ? 'dog' : 'dogs'} on this board so far, so the ranks do not mean much yet.</p>}
      {data.you && !data.you.inTop && <p className="meta"><b>{dog.name}</b> is number {data.you.rank} with {fmtVal(data.you.value, metric)}.</p>}
      {data.youNote && <p className="meta">{NOTE[data.youNote]}</p>}
      <p className="meta">Public dogs only, from saved walks, in UTC weeks and months. Daycare days are left out. Demo dogs are made up and labelled.{metric === 'top_speed' ? ' Top speed is the phone\'s speed on the walk, so it is the pair\'s speed, not the dog\'s own.' : ''}</p>
    </div>}
  </div>
}
function DemoBoards({ acts }) {
  const [metric, setMetric] = useState('miles')
  const w = acts.filter((a) => a.daysAgo <= 6 && a.type !== 'Daycare')
  const mine = { name: 'Biscuit', breed: 'Golden Retriever', you: true, miles: Math.round(w.reduce((s, a) => s + a.miles, 0) * 10) / 10, minutes: Math.round(w.reduce((s, a) => s + a.minutes, 0)), outings: w.length, top_speed: Math.max(0, ...w.map((a) => a.maxSpeed || 0)) }
  const sorted = [mine, ...DEMO_BOARD].map((d) => ({ ...d, value: d[metric] })).sort((a, b) => b.value - a.value)
  const rows = sorted.map((r, i) => ({ ...r, rank: sorted.findIndex((x) => x.value === r.value) + 1 }))
  return <div className="list">
    <div className="card padc"><Seg label="Metric" value={metric} set={setMetric} options={METRICS.map(([k, l]) => [k, l])} /></div>
    <div className="card padc"><div className="row between g8"><b>This week</b><span className="tagx">Sample</span></div><Rows rows={rows} metric={metric} />
      <p className="meta">A sample board. Biscuit's number comes from the demo walks, and the other dogs are made up.</p></div>
  </div>
}

function ChallengeCard({ c, onJoin, onLeave, busy, sample, name }) {
  const pct = Math.min(100, Math.round((c.progress / c.target) * 100))
  return <div className="card padc">
    <div className="row between g8"><b>{c.name}</b>{sample ? <span className="tagx">Sample</span> : c.completed && c.joined ? <span className="badge on"><Ic n="check" s={14} />Done</span> : null}</div>
    <p className="meta">{c.description}</p>
    {c.joined && <><div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={c.target} aria-valuenow={Math.min(c.progress, c.target)} aria-label={`${name}'s progress in ${c.name}`}><i style={{ width: pct + '%' }} /></div>
      <div className="row between"><span className="meta"><b>{c.progress}</b> of {c.target} {c.unit}</span><span className="meta">{c.completed ? 'Completed. The badge is on the profile.' : c.started === false ? `Starts in ${c.startsInDays} ${c.startsInDays === 1 ? 'day' : 'days'}` : `${c.daysLeft} ${c.daysLeft === 1 ? 'day' : 'days'} left`}</span></div></>}
    {!c.joined && <p className="meta">{c.started === false ? `Starts in ${c.startsInDays} ${c.startsInDays === 1 ? 'day' : 'days'}` : `${c.daysLeft} ${c.daysLeft === 1 ? 'day' : 'days'} left`}{c.joinedDogs != null ? ` · ${c.joinedDogs} ${c.joinedDogs === 1 ? 'dog' : 'dogs'} in` : ''}</p>}
    {c.joined ? <button className="cta small white bordered" disabled={busy} onClick={() => onLeave(c)} aria-label={`Leave ${c.name}`}>Leave</button> : <button className="cta small" disabled={busy} onClick={() => onJoin(c)} aria-label={`Join ${c.name}`}>Join with {name}</button>}
  </div>
}
function RealChallenges({ real, setToast }) {
  const { dog } = real
  const [list, setList] = useState(null), [busy, setBusy] = useState(''), [err, setErr] = useState('')
  const load = useCallback(() => api.boards.challenges(dog.slug).then((r) => { setList(r.challenges); setErr('') }, (e) => setErr(e.message)), [dog.slug, real.totals.lifetime.outings])
  useEffect(() => { load() }, [load])
  const go = (join) => async (c) => { setBusy(c.key); try { const r = join ? await api.boards.join(dog.slug, c.key) : await api.boards.leave(dog.slug, c.key); setList((l) => l.map((x) => (x.key === c.key ? r.challenge : x))); setToast(join ? `${dog.name} is in: ${c.name}` : `${dog.name} left ${c.name}`) } catch (e) { setToast(e.message) } setBusy('') }
  return <div className="list">
    {err && <p className="formerr" role="alert">{err}</p>}
    {!list && !err && <div className="card empty" role="status"><p>Fetching challenges</p></div>}
    {list && list.map((c) => <ChallengeCard key={c.key} c={c} name={dog.name} busy={busy === c.key} onJoin={go(true)} onLeave={go(false)} />)}
    {list && <p className="meta padx">Progress is worked out from {dog.name}'s saved walks inside each window (UTC) and is never stored. Finishing a challenge you joined earns its badge.</p>}
  </div>
}
function DemoChallenges({ acts, setToast }) {
  const [joined, setJoined] = useState(() => { try { return JSON.parse(localStorage.getItem('trot-demo-joins')) || { 'month-25': true } } catch (e) { return { 'month-25': true } } })
  useEffect(() => { try { localStorage.setItem('trot-demo-joins', JSON.stringify(joined)) } catch (e) {} }, [joined])
  const w = acts.filter((a) => a.type !== 'Daycare')
  const prog = { 'month-25': Math.round((DEMO_CHALLENGES[0].base + w.reduce((s, a) => s + a.miles, 0)) * 10) / 10, 'explorer-5': new Set(w.map((a) => a.place).filter(Boolean)).size, 'team-3': new Set(w.map((a) => a.by)).size }
  return <div className="list">
    {DEMO_CHALLENGES.map((d) => { const c = { ...d, progress: Math.min(prog[d.key], 999), joined: !!joined[d.key], completed: prog[d.key] >= d.target }; return <ChallengeCard key={d.key} c={c} name="Biscuit" sample onJoin={() => { setJoined((j) => ({ ...j, [d.key]: true })); setToast(`Biscuit is in: ${d.name} (demo)`) }} onLeave={() => { setJoined((j) => ({ ...j, [d.key]: false })); setToast(`Biscuit left ${d.name} (demo)`) }} /> })}
    <p className="meta padx">Sample challenges. Biscuit's progress comes from the demo walks, and joining is kept in this browser only.</p>
  </div>
}

function EventForm({ onDone, onCancel }) {
  const id = useId()
  const [f, setF] = useState({ name: '', kind: 'meetup', startsOn: '', endsOn: '', venue: '', city: '', region: '', url: '', description: '' })
  const [pin, setPin] = useState(null), [errs, setErrs] = useState({}), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setErrs((x) => ({ ...x, [k]: undefined })); setErr('') }
  const locate = () => { if (!navigator.geolocation) { setErr('This browser cannot share a location.'); return } navigator.geolocation.getCurrentPosition((p) => setPin([p.coords.latitude, p.coords.longitude]), () => setErr('Location was not shared. The event is still fine without it.')) }
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    const x = {}
    if (f.name.trim().length < 2) x.name = 'Give the event a name.'
    if (!f.startsOn) x.startsOn = 'Pick the start date.'
    else if (f.startsOn < todayStr()) x.startsOn = 'The start date is in the past.'
    if (f.endsOn && f.endsOn < f.startsOn) x.endsOn = 'The end date is before the start date.'
    if (!f.city.trim()) x.city = 'Say which city or town.'
    if (f.url.trim() && !/^https?:\/\/\S+\.\S+/.test(f.url.trim())) x.url = 'The link must start with http:// or https://.'
    setErrs(x)
    if (Object.keys(x).length) { setErr('Fix the highlighted fields, then save again.'); return }
    setBusy(true)
    try { const r = await api.events.add({ ...f, name: f.name.trim(), endsOn: f.endsOn || null, url: f.url.trim() || null, ...(pin ? { lat: pin[0], lng: pin[1] } : {}) }); onDone(r.event) } catch (e2) { setErr(e2.message); setBusy(false) }
  }
  const F = (k, label, props = {}, hint) => <div className="field lightf"><label htmlFor={`${id}-${k}`}>{label}</label>{props.area ? <textarea id={`${id}-${k}`} value={f[k]} onChange={set(k)} rows={3} maxLength={600} /> : <input id={`${id}-${k}`} value={f[k]} onChange={set(k)} autoComplete="off" aria-invalid={errs[k] ? true : undefined} aria-describedby={errs[k] || hint ? `${id}-${k}-n` : undefined} {...props} />}{errs[k] ? <p className="ferr" id={`${id}-${k}-n`} role="alert">{errs[k]}</p> : hint ? <p className="fhint" id={`${id}-${k}-n`}>{hint}</p> : null}</div>
  return <form className="wform" onSubmit={submit} noValidate aria-label="Add an event">
    {F('name', 'Event name', { maxLength: 100 })}
    <div className="field lightf"><label htmlFor={`${id}-kind`}>Kind</label><select id={`${id}-kind`} value={f.kind} onChange={set('kind')}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
    {F('startsOn', 'Start date', { type: 'date', min: todayStr() })}
    {F('endsOn', 'End date (optional)', { type: 'date', min: f.startsOn || todayStr() })}
    {F('venue', 'Venue (optional)', { maxLength: 100 })}
    {F('city', 'City or town', { maxLength: 60 })}
    {F('region', 'State or region (optional)', { maxLength: 40 })}
    {F('url', 'Link (optional)', { maxLength: 300, inputMode: 'url', placeholder: 'https://' }, 'The organiser\'s page, so people can check the details.')}
    {F('description', 'Details (optional)', { area: true })}
    <div className="row g8 wraprow"><button type="button" className="cta small white bordered" onClick={locate}>{pin ? 'Location added' : 'Add my current location'}</button>{pin && <button type="button" className="tbtn" onClick={() => setPin(null)}>Remove location</button>}</div>
    <p className="fhint">A location lets the event show up for people searching nearby. Only add events you know are really happening.</p>
    {err && <p className="formerr" role="alert">{err}</p>}
    <button className="cta" type="submit" disabled={busy}>{busy ? 'Saving' : 'Add event'}</button>
    <button className="cta white bordered" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
  </form>
}

function Events({ real, setToast, hasApi }) {
  const dog = real ? real.dog : null
  const [list, setList] = useState(null), [mine, setMine] = useState([]), [err, setErr] = useState(''), [near, setNear] = useState(null), [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(''), [ask, setAsk] = useState(null), [result, setResult] = useState(null), [offer, setOffer] = useState(null)
  const load = useCallback(async () => {
    if (!hasApi) return
    try { const r = await api.events.list({ from: todayStr(), near }); setList(r.events); setErr(''); if (dog) setMine((await api.events.forDog(dog.slug)).events) } catch (e) { setErr(e.message) }
  }, [hasApi, near, dog && dog.slug])
  useEffect(() => { load() }, [load])
  if (!hasApi) return <div className="list"><div className="card empty"><b>Events need the Trot server</b><p>This copy of the demo runs without it, so there is no calendar to show. No sample events are shown in its place.</p></div></div>
  const locate = () => { if (!navigator.geolocation) { setToast('This browser cannot share a location.'); return } navigator.geolocation.getCurrentPosition((p) => setNear([Math.round(p.coords.latitude * 1e3) / 1e3, Math.round(p.coords.longitude * 1e3) / 1e3]), () => setToast('Location was not shared, so all upcoming events are shown.')) }
  const entryOf = (e) => (dog ? e.entries.find((x) => x.dog === dog.slug) : null)
  const mark = async (e, body) => { setBusy(e.id); try { await api.events.mark(e.id, dog.slug, body); await load(); return true } catch (x) { setToast(x.message); return false } finally { setBusy('') } }
  const unmark = async (e) => { setBusy(e.id); try { await api.events.unmark(e.id, dog.slug); await load() } catch (x) { setToast(x.message) } setBusy('') }
  const remove = async (e) => { setAsk({ id: e.id, busy: true }); try { await api.events.remove(e.id); setAsk(null); await load(); setToast('Event deleted') } catch (x) { setAsk({ id: e.id, busy: false, error: x.message }) } }
  const saveResult = async (ev) => { ev.preventDefault(); const text = result.value.trim(); if (!text) { setResult({ ...result, error: 'Type the result, such as a placement or a title earned.' }); return } const e = result.event; if (await mark(e, { status: 'attended', result: text })) { setResult(null); setOffer({ event: e, text }) } }
  const toAward = async () => { const { event: e, text } = offer; try { await api.awards.add(dog.slug, { title: text, kind: 'ribbon', eventName: e.name, awardedOn: (e.endsOn || e.startsOn) > todayStr() ? todayStr() : e.endsOn || e.startsOn }); setOffer(null); setToast(`Added to ${dog.name}'s awards`) } catch (x) { setToast(x.message) } }
  const card = (e, past) => {
    const en = entryOf(e)
    return <article key={e.id} className="card padc">
      <div className="row between g8"><span className="meta">{kindLabel(e.kind)}</span>{e.curated && <span className="tagx">From public listings</span>}</div>
      <div className="title">{e.name}</div>
      <div className="meta"><b>{day(e.startsOn)}{e.endsOn && e.endsOn !== e.startsOn ? ` to ${day(e.endsOn)}` : ''}</b> · {[e.venue, e.city, e.region].filter(Boolean).join(', ')}</div>
      {e.description && <p className="note">{e.description}</p>}
      {e.curated && <p className="meta">Dates can change. Check with the organiser.</p>}
      {(e.sourceUrl || e.url) && <a className="tbtn" href={e.sourceUrl || e.url} target="_blank" rel="noopener noreferrer">{e.curated ? 'Open the source listing' : 'Open the event page'}</a>}
      <div className="meta">{e.going} {e.going === 1 ? 'dog' : 'dogs'} going{e.addedBy ? ` · added by ${e.addedBy}` : ''}</div>
      {dog && en && <div className="meta"><b>{dog.name}</b>: {en.status === 'attended' ? `went${en.result ? `, result: ${en.result}` : ''}` : en.status}</div>}
      {dog && result && result.event.id === e.id
        ? <form className="wform hform" onSubmit={saveResult} noValidate><div className="field lightf"><label htmlFor={`res-${e.id}`}>{dog.name}'s result</label><input id={`res-${e.id}`} value={result.value} onChange={(x) => setResult({ ...result, value: x.target.value, error: '' })} maxLength={120} autoFocus aria-invalid={result.error ? true : undefined} />{result.error && <p className="ferr" role="alert">{result.error}</p>}</div><div className="row g8"><button className="cta small" type="submit" disabled={busy === e.id}>Save result</button><button className="cta small white bordered" type="button" onClick={() => setResult(null)}>Cancel</button></div></form>
        : dog && <div className="row g8 wraprow">
          {!en && !past && <button className="cta small" disabled={busy === e.id} onClick={async () => { if (await mark(e, { status: 'going' })) setToast(`${dog.name} is going`) }} aria-label={`Mark ${dog.name} as going to ${e.name}`}>{dog.name} is going</button>}
          {en && <button className="cta small white bordered" onClick={() => setResult({ event: e, value: en.result || '' })} aria-label={`Record a result for ${e.name}`}>{en.result ? 'Change result' : 'Record a result'}</button>}
          {en && <button className="tbtn" disabled={busy === e.id} onClick={() => unmark(e)} aria-label={`Take ${dog.name} off ${e.name}`}>Not going</button>}
        </div>}
      {offer && offer.event.id === e.id && <div className="confirm" role="group" aria-label="Add to awards"><p>Add "{offer.text}" to {dog.name}'s awards?</p><div className="row g8"><button className="cta small dark" onClick={toAward}>Add to awards</button><button className="cta small white bordered" onClick={() => setOffer(null)}>Not now</button></div></div>}
      {e.mine && (ask && ask.id === e.id ? <Confirm text="Delete this event? Dogs marked as going are taken off it." yes="Delete event" no="Keep it" busy={ask.busy} error={ask.error} onYes={() => remove(e)} onNo={() => setAsk(null)} /> : <button className="tbtn" onClick={() => setAsk({ id: e.id })} aria-label={`Delete ${e.name}`}>Delete event</button>)}
    </article>
  }
  const upcomingIds = new Set((list || []).map((e) => e.id))
  const earlier = mine.filter((e) => !upcomingIds.has(e.id))
  return <div className="list">
    <div className="card padc">
      <p className="meta">A community calendar of shows, classes and meetups. There is no open public feed of dog shows, so events are added by people, plus a short list taken from public listings.</p>
      <div className="row g8 wraprow">{near ? <button className="cta small white bordered" onClick={() => setNear(null)}>Show all upcoming</button> : <button className="cta small white bordered" onClick={locate}>Only within 60 miles of me</button>}
        {real && !adding && <button className="cta small" onClick={() => setAdding(true)}><Ic n="plus" s={18} />Add an event</button>}</div>
      {!real && <p className="meta">Create a page for your own dog to add events and mark your dog as going.</p>}
    </div>
    {adding && <div className="card padc"><b>Add an event</b><EventForm onCancel={() => setAdding(false)} onDone={async (e) => { setAdding(false); await load(); setToast(`${e.name} is on the calendar`) }} /></div>}
    {err && <p className="formerr" role="alert">{err}</p>}
    {!list && !err && <div className="card empty" role="status"><p>Fetching events</p></div>}
    {list && list.length === 0 && <div className="card empty"><b>No events added near you yet</b><p>Add the first one.</p></div>}
    {list && list.map((e) => card(e, false))}
    {earlier.length > 0 && <><div className="eyebrow dark padx">{dog.name.toUpperCase()}'S EARLIER EVENTS</div>{earlier.map((e) => card(e, true))}</>}
  </div>
}
