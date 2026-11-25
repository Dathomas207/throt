import React, { useCallback, useEffect, useId, useState } from 'react'
import { Ic, Confirm, copyText, TypeIc, SPEED_NOTE } from '../ui.jsx'
import { api } from '../api.js'
import { DOG, WEIGHTS, DEMO_HEALTH } from '../data.js'
import { Range } from '../ui.jsx'

const today = (off = 0) => { const d = new Date(Date.now() + off * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const fmtDay = (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')
const short = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const DUE = { overdue: ['Overdue', 'warn'], due_soon: ['Due soon', 'soon'] }
const TYPE_COLORS = ['#1F5AE8', '#0F1B2D', '#C8F031', '#FF8A5B', '#5B6472', '#8FB0F5', '#9AA3B0']

// What each kind of entry asks for. Keys match the API.
const FORMS = {
  weight: { add: 'Add a weight', fields: [{ k: 'value', label: 'Weight', type: 'number', req: 'Type a weight.' }, { k: 'unit', label: 'Unit', type: 'select', options: [['lb', 'lb'], ['kg', 'kg']] }, { k: 'occurredOn', label: 'Date', type: 'date', req: 'Pick the date.', max: true }] },
  vaccine: { add: 'Add a vaccine or preventive', fields: [{ k: 'title', label: 'Vaccine or preventive', req: 'Type its name.' }, { k: 'occurredOn', label: 'Date given (optional)', type: 'date', max: true }, { k: 'dueOn', label: 'Next due (optional)', type: 'date' }, { k: 'documentId', label: 'Certificate (optional)', type: 'doc' }] },
  medication: { add: 'Add a medication', fields: [{ k: 'title', label: 'Name', req: 'Type its name.' }, { k: 'detail', label: 'Dose (optional)', hint: 'For example "50 mg" or "1 tablet".' }, { k: 'schedule', label: 'Schedule (optional)', hint: 'For example "Twice a day with food".' }, { k: 'occurredOn', label: 'Start date (optional)', type: 'date' }, { k: 'dueOn', label: 'End date (optional)', type: 'date' }] },
  vet_visit: { add: 'Add a vet visit', fields: [{ k: 'occurredOn', label: 'Date', type: 'date', req: 'Pick the date.', max: true }, { k: 'detail', label: 'Clinic (optional)' }, { k: 'title', label: 'Reason', req: 'Say what the visit was for.' }, { k: 'notes', label: 'Notes (optional)', type: 'area' }] },
  condition: { add: 'Add a condition or allergy', fields: [{ k: 'title', label: 'Condition or allergy', req: 'Type its name.' }, { k: 'notes', label: 'Notes (optional)', type: 'area' }] },
  note: { add: 'Add a note', fields: [{ k: 'notes', label: 'Note', type: 'area', req: 'Type the note.' }] },
}

function EntryForm({ kind, entry, docs, onSave, onCancel }) {
  const id = useId()
  const cfg = FORMS[kind]
  const [f, setF] = useState(() => Object.fromEntries(cfg.fields.map((x) => [x.k, entry ? (x.k === 'documentId' ? (entry.document ? entry.document.id : '') : entry[x.k] == null ? '' : String(entry[x.k])) : x.k === 'unit' ? 'lb' : x.k === 'occurredOn' && x.req ? today() : ''])))
  const [errs, setErrs] = useState({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setErrs((x) => ({ ...x, [k]: undefined })); setErr('') }
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    const found = {}
    for (const x of cfg.fields) {
      const v = String(f[x.k]).trim()
      if (x.req && !v) found[x.k] = x.req
      else if (x.type === 'number' && v && !(Number(v) > 0)) found[x.k] = 'Type a number above zero.'
      else if (x.max && v > today(1)) found[x.k] = 'That date is in the future.'
    }
    if (f.occurredOn && f.dueOn && f.dueOn < f.occurredOn) found.dueOn = 'This cannot be before the first date.'
    setErrs(found)
    if (Object.keys(found).length) { setErr('Fix the highlighted fields, then save again.'); return }
    const body = { kind }
    for (const x of cfg.fields) { const v = String(f[x.k]).trim(); body[x.k] = x.type === 'number' ? Number(v) : x.type === 'date' || x.type === 'doc' ? v || null : v }
    setBusy(true)
    const r = await onSave(body)
    if (r && r.error) { setErr(r.error); setBusy(false) }
  }
  return (
    <form className="wform hform" onSubmit={submit} noValidate aria-label={entry ? 'Edit entry' : cfg.add}>
      {cfg.fields.map((x) => {
        if (x.type === 'doc' && !(docs && docs.length)) return null
        const fid = `${id}-${x.k}`, note = errs[x.k] ? `${fid}-e` : x.hint ? `${fid}-h` : undefined
        const common = { id: fid, value: f[x.k], onChange: set(x.k), 'aria-invalid': errs[x.k] ? true : undefined, 'aria-describedby': note }
        return <div key={x.k} className="field lightf"><label htmlFor={fid}>{x.label}</label>
          {x.type === 'select' ? <select {...common}>{x.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            : x.type === 'doc' ? <select {...common}><option value="">None</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
              : x.type === 'area' ? <textarea {...common} rows={3} maxLength={1000} />
                : <input {...common} type={x.type === 'date' ? 'date' : 'text'} inputMode={x.type === 'number' ? 'decimal' : undefined} maxLength={x.type === 'date' ? undefined : 80} autoComplete="off" />}
          {errs[x.k] ? <p className="ferr" id={`${fid}-e`} role="alert">{errs[x.k]}</p> : x.hint ? <p className="fhint" id={`${fid}-h`}>{x.hint}</p> : null}
        </div>
      })}
      {err && <p className="formerr" role="alert">{err}</p>}
      <div className="row g8"><button className="cta small" type="submit" disabled={busy}>{busy ? 'Saving' : 'Save'}</button><button className="cta small white bordered" type="button" onClick={onCancel} disabled={busy}>Cancel</button></div>
    </form>
  )
}

// One list with its add form, and edit and delete on each row.
function Section({ kind, title, entries, empty, row, docs, act, children }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [ask, setAsk] = useState(null)
  const del = async (e) => { setAsk({ id: e.id, busy: true }); const r = await act.remove(e); if (r && r.error) setAsk({ id: e.id, busy: false, error: r.error }); else setAsk(null) }
  return (
    <section className="card padc" aria-label={title}>
      <div className="row between g8"><b>{title}</b>{!adding && <button className="tbtn" onClick={() => { setAdding(true); setEditing(null) }}>{FORMS[kind].add}</button>}</div>
      {children}
      {entries.length === 0 && !adding && <p className="meta">{empty}</p>}
      {adding && <EntryForm kind={kind} docs={docs} onCancel={() => setAdding(false)} onSave={async (b) => { const r = await act.add(b); if (!r.error) setAdding(false); return r }} />}
      {entries.map((e) => editing === e.id
        ? <EntryForm key={e.id} kind={kind} entry={e} docs={docs} onCancel={() => setEditing(null)} onSave={async (b) => { const r = await act.update(e, b); if (!r.error) setEditing(null); return r }} />
        : <div key={e.id} className="hentry">
          {row(e)}
          {e.document && <button className="tbtn doclink" onClick={() => act.openDoc(e.document)}><Ic n="file" s={16} />{e.document.name}</button>}
          {e.canEdit && (ask && ask.id === e.id
            ? <Confirm text="Delete this entry? This cannot be undone." yes="Delete" no="Keep it" busy={ask.busy} error={ask.error} onYes={() => del(e)} onNo={() => setAsk(null)} />
            : <div className="row g8"><button className="tbtn" aria-label={`Edit ${e.title || title}`} onClick={() => { setEditing(e.id); setAdding(false) }}>Edit</button><button className="tbtn" aria-label={`Delete ${e.title || title}`} onClick={() => setAsk({ id: e.id })}>Delete</button></div>)}
        </div>)}
    </section>
  )
}

export function WeeksChart({ weeks, label }) {
  const max = Math.max(...weeks.map((w) => w.minutes), 1), W = 320, H = 110, bw = 28, gap = (W - bw * weeks.length) / (weeks.length - 1 || 1)
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={label}>
        {weeks.map((w, i) => { const h = Math.max(3, (w.minutes / max) * 78), x = i * (bw + gap); return <g key={i}><rect x={x} y={88 - h} width={bw} height={h} rx="5" fill={i === weeks.length - 1 ? '#1F5AE8' : '#C6D4F7'} /><text x={x + bw / 2} y="104" textAnchor="middle" fontSize="10" fill="#5B6472">{w.tick}</text></g> })}
      </svg>
      <table className="sr"><caption>{label}</caption><thead><tr><th>Week starting</th><th>Minutes</th></tr></thead><tbody>{weeks.map((w, i) => <tr key={i}><td>{w.tick}</td><td>{w.minutes}</td></tr>)}</tbody></table>
    </>
  )
}
function WeightChart({ history }) {
  const vs = history.map((h) => h.value), lo = Math.min(...vs) - 0.5, hi = Math.max(...vs) + 0.5, n = history.length
  const x = (i) => 20 + (i * 280) / (n - 1), y = (v) => 12 + (1 - (v - lo) / (hi - lo)) * 50
  const first = history[0], last = history[n - 1]
  return <svg viewBox="0 0 320 90" className="chart" role="img" aria-label={`Weight from ${first.value} ${first.unit} on ${fmtDay(first.on)} to ${last.value} ${last.unit} on ${fmtDay(last.on)}, ${n} entries`}>
    <polyline fill="none" stroke="#1F5AE8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={history.map((h, i) => `${x(i)},${y(h.value)}`).join(' ')} />
    {history.map((h, i) => <g key={i}><circle cx={x(i)} cy={y(h.value)} r="4" fill="#fff" stroke="#1F5AE8" strokeWidth="2.5" />{(n <= 6 || i === 0 || i === n - 1) && <text x={x(i)} y="86" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize="11" fill="#5B6472">{short(h.on)}</text>}</g>)}
  </svg>
}
function TypeTable({ byType, caption }) {
  const total = byType.reduce((s, t) => s + t.minutes, 0)
  if (!total) return null
  return <>
    <div className="stack" aria-hidden="true">{byType.map((t, i) => <i key={t.type} style={{ width: (t.minutes / total) * 100 + '%', background: TYPE_COLORS[i % TYPE_COLORS.length] }} />)}</div>
    <table className="ttable"><caption className="sr">{caption}</caption><thead className="sr"><tr><th>Type</th><th>Minutes</th></tr></thead><tbody>{byType.map((t, i) => <tr key={t.type}><td><span className="sw" style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }} /><TypeIc t={t.type} s={16} c="#0F1B2D" /> {t.type}</td><td className="num">{t.minutes} min</td></tr>)}</tbody></table>
  </>
}
const Tile = ({ l, v, s }) => <div className="tile"><div className="sl">{l}</div><div className="sv">{v}</div>{s && <div className="meta">{s}</div>}</div>

// ---- signed in: everything here is real, entered by the team or worked out from saved walks ----
export function RealHealth({ real, setToast }) {
  const { dog } = real
  const owner = dog.role === 'owner'
  const [data, setData] = useState(null)
  const [docs, setDocs] = useState([])
  const [err, setErr] = useState('')
  const load = useCallback(async () => { try { setData(await api.health.get(dog.slug)); setErr('') } catch (e) { setErr(e.message) } }, [dog.slug, real.totals.lifetime.outings])
  useEffect(() => { setData(null); load(); api.documents.list(dog.slug).then((r) => setDocs(r.documents), () => {}) }, [load])
  const wrap = (fn, done) => async (...a) => { try { await fn(...a); await load(); if (done) setToast(done); return {} } catch (e) { return { error: e.message } } }
  const act = {
    add: wrap((b) => api.health.add(dog.slug, b), 'Saved'), update: wrap((e, b) => api.health.update(e.id, b), 'Saved'), remove: wrap((e) => api.health.remove(e.id), 'Entry deleted'),
    openDoc: async (d) => { try { window.open(await api.documents.open(d.id), '_blank', 'noopener') } catch (e) { setToast(e.message) } },
  }
  // goal
  const [goal, setGoal] = useState(null)
  const saveGoal = async (e) => {
    e.preventDefault()
    const v = goal.value.trim(), n = Number(v)
    if (v !== '' && (!/^\d+$/.test(v) || n < 10 || n > 300)) { setGoal({ ...goal, error: 'Type a whole number of minutes from 10 to 300, or leave it empty for no goal.' }); return }
    setGoal({ ...goal, busy: true, error: '' })
    const r = await real.saveProfile({ goal_minutes: v === '' ? null : n })
    if (r.error) { setGoal({ ...goal, busy: false, error: r.error }); return }
    setGoal(null); await load(); setToast(v === '' ? 'Goal cleared' : `Daily goal set to ${n} minutes`)
  }
  // share with the vet
  const [shares, setShares] = useState([])
  const [link, setLink] = useState('')
  const [sbusy, setSbusy] = useState(false)
  const [ask, setAsk] = useState(null)
  const loadShares = useCallback(async () => { if (!owner) return; try { setShares((await api.health.shares(dog.slug)).shares) } catch (e) {} }, [dog.slug, owner])
  useEffect(() => { setLink(''); loadShares() }, [loadShares])
  const share = async () => { if (sbusy) return; setSbusy(true); try { const r = await api.health.share(dog.slug); setLink(location.origin + r.path); await loadShares() } catch (e) { setToast(e.message) } setSbusy(false) }
  const revoke = async (id) => { setAsk({ id, busy: true }); try { await api.health.revoke(dog.slug, id); setAsk(null); setLink(''); await loadShares(); setToast('Vet link turned off. It no longer opens.') } catch (e) { setAsk({ id, busy: false, error: e.message }) } }

  if (!data) return <div className="list"><div className="card empty" role="status">{err ? <><p className="formerr" role="alert">{err}</p><button className="cta small" onClick={load}>Try again</button></> : <p>Fetching {dog.name}'s health records</p>}</div></div>
  const s = data.summary, a = s.activity, of = (k) => data.entries.filter((e) => e.kind === k)
  const recent = (x, y) => ((x.occurredOn || '') < (y.occurredOn || '') ? 1 : -1)
  const vax = of('vaccine').sort((x, y) => ((x.dueOn || '9999') < (y.dueOn || '9999') ? -1 : 1))
  const weeks = a.weeks.map((w) => ({ minutes: w.minutes, tick: short(w.start) }))
  const pct = a.changePercent.minutes
  const none = a.weeks.every((w) => w.outings === 0)
  return (
    <div className="list">
      <section className="card padc" aria-label="Activity health">
        <div className="row between"><b>Activity health</b><span className="meta">From saved walks</span></div>
        {none ? <p className="meta">No walks in the last 8 weeks. Save a walk and {dog.name}'s activity shows up here.</p> : <>
          <div className="tiles">
            <Tile l="LAST 7 DAYS" v={`${a.last7.minutes} min`} s={`${a.last7.miles.toFixed(1)} mi`} />
            <Tile l="4-WEEK AVERAGE" v={`${a.previousWeeklyAverage.minutes} min`} s={pct == null ? 'Nothing earlier to compare' : `${pct > 0 ? 'Up' : pct < 0 ? 'Down' : 'Level,'} ${Math.abs(pct)}% this week`} />
            <Tile l="ACTIVE DAYS" v={`${a.activeDays} of 7`} />
            <Tile l="STREAK" v={`${a.streakDays} ${a.streakDays === 1 ? 'day' : 'days'}`} />
            {a.last7.topSpeed != null && <Tile l="TOP SPEED THIS WEEK" v={`${a.last7.topSpeed.toFixed(1)} mph`} />}
            {a.last7.sprints > 0 && <Tile l="SPRINTS THIS WEEK" v={a.last7.sprints} />}
          </div>
          <WeeksChart weeks={weeks} label={`Minutes out each week for the last 8 weeks. This week ${a.last7.minutes}, the 4 weeks before averaged ${a.previousWeeklyAverage.minutes}.`} />
          <div className="sl">THIS WEEK BY TYPE</div>
          <TypeTable byType={a.last7.byType} caption="Minutes in the last 7 days by activity type" />
          {(a.longestWalk || a.bestTopSpeed) && <p className="meta"><b>Personal bests:</b>{a.bestTopSpeed ? ` fastest top speed ${a.bestTopSpeed.mph.toFixed(1)} mph on ${fmtDay(a.bestTopSpeed.on)}.` : ''}{a.longestWalk ? ` Longest outing ${a.longestWalk.minutes} min${a.longestWalk.miles > 0 ? `, ${a.longestWalk.miles.toFixed(1)} mi` : ''}, on ${fmtDay(a.longestWalk.on)}.` : ''}</p>}
          {(a.last7.topSpeed != null || a.bestTopSpeed) && <p className="meta">{SPEED_NOTE}</p>}
          <p className="meta">Daycare days are left out of these numbers.</p>
        </>}
      </section>

      <section className="card padc" aria-label="Daily goal">
        <div className="row between g8"><b>Daily goal</b>{owner && !goal && <button className="tbtn" onClick={() => setGoal({ value: s.goal.minutes ? String(s.goal.minutes) : '', busy: false, error: '' })}>{s.goal.minutes ? 'Change goal' : 'Set a goal'}</button>}</div>
        {goal ? <form className="wform hform" onSubmit={saveGoal} noValidate>
          <div className="field lightf"><label htmlFor="goal-min">Minutes out each day</label><input id="goal-min" inputMode="numeric" value={goal.value} onChange={(e) => setGoal({ ...goal, value: e.target.value, error: '' })} maxLength={3} aria-invalid={goal.error ? true : undefined} aria-describedby="goal-note" autoFocus />
            {goal.error ? <p className="ferr" id="goal-note" role="alert">{goal.error}</p> : <p className="fhint" id="goal-note">From 10 to 300. Leave it empty for no goal.</p>}</div>
          <div className="row g8"><button className="cta small" type="submit" disabled={goal.busy}>{goal.busy ? 'Saving' : 'Save goal'}</button><button className="cta small white bordered" type="button" onClick={() => setGoal(null)}>Cancel</button></div>
        </form> : s.goal.minutes
          ? <div className="range"><div className="row between"><span>Today</span><span><b>{s.goal.todayMinutes}</b> of {s.goal.minutes} min · {s.goal.todayMinutes >= s.goal.minutes ? 'Goal met' : `${s.goal.minutes - s.goal.todayMinutes} min to go`}</span></div><div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={s.goal.minutes} aria-valuenow={Math.min(s.goal.todayMinutes, s.goal.minutes)} aria-label="Today's progress toward the daily goal"><i style={{ width: s.goal.percent + '%' }} /></div></div>
          : <p className="meta">{owner ? `No goal yet. Set the number of minutes you want ${dog.name} out each day.` : `No goal yet. ${dog.name}'s owner can set one.`}</p>}
        <p className="meta">The goal is the owner's own number. Trot does not work out a healthy range from breed or weight, and nothing here is veterinary advice.</p>
      </section>

      {dog.trackingLevel === 3 && <section className="card padc" aria-label="Fitness tracker"><b>Fitness tracker</b><p className="meta">{dog.name} is on Level 3, but no tracker is connected yet, because Trot does not connect to any real tracker so far. Once one is connected, {dog.name}'s own steps, all-day activity and sleep will appear here. Until then this card stays empty.</p></section>}

      <Section kind="weight" title="Weight" entries={of('weight').sort(recent)} empty={`No weights yet. Add ${dog.name}'s first weight to start a trend.`} act={act}
        row={(e) => <div className="row between g8"><span className="hb">{e.value} {e.unit}</span><span className="meta">{fmtDay(e.occurredOn)}</span></div>}>
        {s.weight && s.weight.history.length > 1 && <><WeightChart history={s.weight.history} /><p className="meta">{s.weight.change.value === 0 ? 'No change' : `${s.weight.change.value > 0 ? 'Up' : 'Down'} ${Math.abs(s.weight.change.value)} ${s.weight.change.unit}`} since {fmtDay(s.weight.change.since)}.</p></>}
        {s.weight && s.weight.history.length === 1 && <p className="meta">Add one more weight to see a trend.</p>}
      </Section>
      <Section kind="vaccine" title="Vaccines and preventives" entries={vax} docs={docs} empty="Nothing recorded yet. Add a vaccine or a preventive and when it is next due." act={act}
        row={(e) => <><div className="row between g8"><span className="hb">{e.title}</span>{DUE[e.status] && <span className={`flag ${DUE[e.status][1]}`}>{DUE[e.status][0]}</span>}</div><div className="meta">{[e.occurredOn && `Given ${fmtDay(e.occurredOn)}`, e.dueOn && `Next due ${fmtDay(e.dueOn)}`].filter(Boolean).join(' · ') || 'No dates yet'}</div></>} />
      <Section kind="medication" title="Medications" entries={of('medication')} empty="No medications recorded." act={act}
        row={(e) => <><span className="hb">{e.title}</span><div className="meta">{[e.detail, e.schedule].filter(Boolean).join(' · ')}</div><div className="meta">{[e.occurredOn && `From ${fmtDay(e.occurredOn)}`, e.dueOn && `until ${fmtDay(e.dueOn)}`].filter(Boolean).join(' ')}</div></>} />
      <Section kind="vet_visit" title="Vet visits" entries={of('vet_visit').sort(recent)} empty="No vet visits recorded." act={act}
        row={(e) => <><div className="row between g8"><span className="hb">{e.title}</span><span className="meta">{fmtDay(e.occurredOn)}</span></div>{e.detail && <div className="meta">{e.detail}</div>}{e.notes && <p className="note">{e.notes}</p>}</>} />
      <Section kind="condition" title="Conditions and allergies" entries={of('condition')} empty="None recorded." act={act}
        row={(e) => <><span className="hb">{e.title}</span>{e.notes && <p className="note">{e.notes}</p>}</>} />
      <Section kind="note" title="Notes" entries={of('note')} empty="No notes yet. Anything the whole care team should know goes here." act={act}
        row={(e) => <><p className="note">{e.notes}</p><div className="meta">{e.addedBy} · {new Date(e.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div></>} />

      <section className="card padc" aria-label="Share with the vet">
        <b>Share with the vet</b>
        <p className="meta">A print-friendly summary of {dog.name}'s activity, weight, vaccines, medications, conditions and recent visits. Anyone with the link can open it, it stops working after 14 days, and you can turn it off sooner. Notes and people's names stay out of it.</p>
        {owner ? <>
          {link && <><label className="field lightf"><span>Vet link</span><input className="linkinput" readOnly value={link} onFocus={(e) => e.target.select()} /></label>
            <div className="row g8 wraprow"><button className="cta small" onClick={async () => setToast((await copyText(link)) ? 'Vet link copied' : 'Copy did not work here. Select the link and copy it.')}>Copy link</button><a className="cta small white bordered" href={link} target="_blank" rel="noopener">Open the summary</a></div>
            <p className="meta">This is the only time the link is shown. Copy it now.</p></>}
          <button className="cta small white bordered" onClick={share} disabled={sbusy}>{sbusy ? 'Creating' : shares.length ? 'Create another vet link' : 'Create a vet link'}</button>
          {shares.map((x) => <div key={x.id} className="invrow"><div className="row between g8"><span className="grow"><b>Vet link</b><small>Made {short(x.createdAt.slice(0, 10))} · stops working {short(x.expiresAt.slice(0, 10))}</small></span>{!(ask && ask.id === x.id) && <button className="tbtn" onClick={() => setAsk({ id: x.id })}>Turn off</button>}</div>
            {ask && ask.id === x.id && <Confirm text="Turn this link off? It stops opening at once." yes="Turn off" no="Keep it" busy={ask.busy} error={ask.error} onYes={() => revoke(x.id)} onNo={() => setAsk(null)} />}</div>)}
        </> : <p className="meta">Only {dog.name}'s owner can create a vet link.</p>}
      </section>
    </div>
  )
}

// ---- demo: Biscuit's sample health records ------------------------------------
export function DemoHealth({ acts, todayMin, level, setToast }) {
  const [vet, setVet] = useState(false)
  const H = DEMO_HEALTH
  const week = acts.filter((a) => a.daysAgo <= 6 && a.type !== 'Daycare')
  const min = Math.round(week.reduce((s, a) => s + a.minutes, 0)), mi = week.reduce((s, a) => s + a.miles, 0)
  const avg = Math.round(H.weeks.slice(-4).reduce((s, v) => s + v, 0) / 4), pct = Math.round(((min - avg) / avg) * 100)
  const weeks = [...H.weeks, min].map((m, i, all) => ({ minutes: m, tick: short(today(-(all.length - 1 - i) * 7 - 6)) }))
  const types = {}; week.forEach((a) => { types[a.type] = (types[a.type] || 0) + Math.round(a.minutes) })
  const top = Math.max(0, ...week.map((a) => a.maxSpeed || 0)), sprints = week.reduce((s, a) => s + (a.sprints || 0), 0)
  const lo = Math.min(...WEIGHTS.map((w) => w[1])) - 0.5, hi = Math.max(...WEIGHTS.map((w) => w[1])) + 0.5
  const status = (due) => (due < 0 ? 'overdue' : due <= 30 ? 'due_soon' : null)
  const T = H.tracker, tmax = Math.max(...T.days)
  return (
    <div className="list">
      <section className="card padc" aria-label="Activity health">
        <div className="row between"><b>Activity health</b><span className="tagx">Sample</span></div>
        <div className="tiles">
          <Tile l="LAST 7 DAYS" v={`${min} min`} s={`${mi.toFixed(1)} mi`} /><Tile l="4-WEEK AVERAGE" v={`${avg} min`} s={`${pct >= 0 ? 'Up' : 'Down'} ${Math.abs(pct)}% this week`} />
          <Tile l="ACTIVE DAYS" v={`${new Set(week.map((a) => a.daysAgo)).size} of 7`} /><Tile l="STREAK" v={`${DOG.streak} days`} />
          {top > 0 && <Tile l="TOP SPEED THIS WEEK" v={`${top.toFixed(1)} mph`} />}{sprints > 0 && <Tile l="SPRINTS THIS WEEK" v={sprints} />}
        </div>
        <WeeksChart weeks={weeks} label={`Sample minutes out each week for the last 8 weeks. This week ${min}, the 4 weeks before averaged ${avg}.`} />
        <div className="sl">THIS WEEK BY TYPE</div>
        <TypeTable byType={Object.entries(types).map(([type, minutes]) => ({ type, minutes })).sort((a, b) => b.minutes - a.minutes)} caption="Minutes this week by activity type" />
        <p className="meta">{SPEED_NOTE}</p>
      </section>
      <div className="card padc"><Range min={todayMin} /><p className="meta">Range is a sample set from breed, age and weight. It is not veterinary advice.</p></div>
      {level === 3 && <section className="card padc" aria-label="Fitness tracker, sample data">
        <div className="row between"><b>From the collar</b><span className="tagx">Sample data</span></div>
        <div className="tiles"><Tile l="STEPS TODAY" v={T.steps.toLocaleString()} /><Tile l="REST, LAST 24 HOURS" v={`${T.restHours} h`} /></div>
        <div className="sl">ALL-DAY ACTIVITY, LAST 7 DAYS</div>
        <div className="bars" role="img" aria-label={`Sample steps for the last 7 days: ${T.days.join(', ')}`}>{T.days.map((d, i) => <div key={i}><i style={{ height: Math.max(4, (d / tmax) * 70), background: i === 6 ? '#1F5AE8' : '#C6D4F7' }} /><span>{new Date(Date.now() - (6 - i) * 864e5).toLocaleDateString('en-US', { weekday: 'narrow' })}</span></div>)}</div>
        <p className="meta">This is what Level 3 adds once a real collar is connected. No tracker is connected, so these numbers are made up.</p>
      </section>}
      <div className="card padc"><div className="row between"><b>Weight</b><span className="num">{DOG.weight} lb</span></div>
        <svg viewBox="0 0 320 90" className="chart" role="img" aria-label="Weight over six months, down from 70.1 to 68.0 pounds"><polyline fill="none" stroke="#1F5AE8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={WEIGHTS.map((w, i) => `${20 + i * 56},${12 + (1 - (w[1] - lo) / (hi - lo)) * 50}`).join(' ')} />{WEIGHTS.map((w, i) => <g key={w[0]}><circle cx={20 + i * 56} cy={12 + (1 - (w[1] - lo) / (hi - lo)) * 50} r="4" fill="#fff" stroke="#1F5AE8" strokeWidth="2.5" /><text x={20 + i * 56} y="86" textAnchor="middle" fontSize="11" fill="#5B6472">{w[0]}</text></g>)}</svg>
        <p className="meta">Down 2.1 lb since June, on track for the target the vet set.</p></div>
      <div className="card padc"><div className="row between"><b>Vaccines and preventives</b><span className="tagx">Sample</span></div>
        {H.vaccines.slice().sort((a, b) => a.due - b.due).map((v) => <div key={v.t} className="hentry"><div className="row between g8"><span className="hb">{v.t}</span>{status(v.due) && <span className={`flag ${DUE[status(v.due)][1]}`}>{DUE[status(v.due)][0]}</span>}</div><div className="meta">Given {fmtDay(today(v.given))} · Next due {fmtDay(today(v.due))}</div></div>)}</div>
      <div className="card padc"><div className="row between"><b>Medications</b><span className="tagx">Sample</span></div>
        {H.meds.map((m) => <div key={m.t} className="hentry"><span className="hb">{m.t}</span><div className="meta">{m.dose} · {m.schedule}</div><div className="meta">From {fmtDay(today(m.start))}{m.end ? ` until ${fmtDay(today(m.end))}` : ''}</div></div>)}</div>
      <div className="card padc"><div className="row between"><b>Vet visits</b><span className="tagx">Sample</span></div>
        {[...(vet ? [{ on: 0, clinic: 'Uploaded record', reason: 'Wellness visit', notes: 'Weight 68.0 lb, 2 vaccines read (sample).' }] : []), ...H.visits].map((v) => <div key={v.reason + v.on} className="hentry"><div className="row between g8"><span className="hb">{v.reason}</span><span className="meta">{fmtDay(today(v.on))}</span></div><div className="meta">{v.clinic}</div><p className="note">{v.notes}</p></div>)}
        <label className="upload"><Ic n="plus" s={18} />Upload a vet record<input type="file" accept=".pdf,image/*" onChange={() => { setVet(true); setToast('Sample record added. Real extraction comes later.') }} /></label></div>
      <div className="card padc"><div className="row between"><b>Conditions and allergies</b><span className="tagx">Sample</span></div>{H.conditions.map((c) => <div key={c.t} className="hentry"><span className="hb">{c.t}</span><p className="note">{c.notes}</p></div>)}</div>
      <div className="card padc"><div className="row between"><b>Notes</b><span className="tagx">Sample</span></div>{H.notes.map((n) => <p key={n} className="note">{n}</p>)}</div>
    </div>
  )
}
