import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Ic, Confirm } from '../ui.jsx'
import { api } from '../api.js'
import { track } from '../usage.js'
import { TRACKS, skillOf, trackOf, LEVELS, LEVEL_SHORT, PLACES, TRAINING_LIMITS, CHECK_COUNT, selfCheck, trackTier } from '../training/skills.js'
import { LESSONS, PRIMER, PUPPY_NOTE, CARE_NOTE, PRO_NOTE, TITLES_NOTE, TRACK_NOTES } from '../training/content.js'
import { demoTraining } from '../training/demo.js'
import { BadgeArt, TrainIcon, streakText } from '../training/Row.jsx'
import { trainingChanged } from '../training/host.jsx'
import './training.css'

const NEEDS_ACCOUNT = 'That needs an account. The demo saves nothing.'
const PLACE_NAME = Object.fromEntries(PLACES)
const TIER = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' }
const when = (iso) => { const d = new Date(iso), t = new Date(); return d.toDateString() === t.toDateString() ? 'Today' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
const levelIn = (data, id) => (data && data.progress[id] ? data.progress[id].level : 0)

// How much of a track is reliable at home (blue) and proofed in public (volt), with the count in the middle.
function Ring({ at2, at3, n, s = 52 }) {
  const r = 20, c = 2 * Math.PI * r, arc = (v) => `${(c * v) / n} ${c}`
  return <svg className="tr-ring" width={s} height={s} viewBox="0 0 48 48" role="img" aria-label={`${at2} of ${n} skills reliable at home, ${at3} proofed in public`}>
    <circle cx="24" cy="24" r={r} fill="none" stroke="#E3E6EB" strokeWidth="5" />
    {at2 > 0 && <circle cx="24" cy="24" r={r} fill="none" stroke="#1F5AE8" strokeWidth="5" strokeLinecap="round" strokeDasharray={arc(at2)} transform="rotate(-90 24 24)" />}
    {at3 > 0 && <circle cx="24" cy="24" r={r} fill="none" stroke="#C8F031" strokeWidth="5" strokeLinecap="round" strokeDasharray={arc(at3)} transform="rotate(-90 24 24)" />}
    <text x="24" y="29" textAnchor="middle" className="tr-ringn">{at2}/{n}</text>
  </svg>
}
const LevelPill = ({ level }) => <span className={`tr-pill l${level}`}><i aria-hidden="true">{[1, 2, 3].map((n) => <em key={n} className={level >= n ? 'on' : ''} />)}</i>{LEVEL_SHORT[level]}</span>
const Note = ({ children, pro }) => <p className={`tr-note ${pro ? 'pro' : ''}`}>{children}</p>
const Stepper = ({ label, value, set, min, max }) => <div className="tr-step" role="group" aria-label={label}>
  <button type="button" aria-label={`Fewer: ${label}`} disabled={value <= min} onClick={() => set(Math.max(min, value - 1))}>−</button>
  <span className="num" aria-live="polite">{value}</span>
  <button type="button" aria-label={`More: ${label}`} disabled={value >= max} onClick={() => set(Math.min(max, value + 1))}>+</button>
</div>

// One screen, five views: the track list, a track, a skill's lesson, the badge wall and the primer.
// Signed in it reads and writes the API. In the demo everything is browsable and nothing is saved.
export default function Training({ close, start = {}, real, dd, setToast, goAwards }) {
  const name = real ? real.dog.name : dd.dog.name, slug = real ? real.dog.slug : null
  const [data, setData] = useState(() => (real ? null : demoTraining(dd.key, dd.dog.name)))
  const [err, setErr] = useState('')
  const [fresh, setFresh] = useState([])
  const [stack, setStack] = useState(() => [{ v: 'tracks' }, ...(start.skill && skillOf(start.skill) ? [{ v: 'skill', id: start.skill }] : start.view === 'badges' ? [{ v: 'badges' }] : [])])
  const view = stack[stack.length - 1]
  const backRef = useRef(null), scroller = useRef(null)
  const go = (x) => { setFresh([]); setStack((s) => [...s, x]) }
  const back = useCallback(() => { setFresh([]); if (stack.length > 1) setStack((s) => s.slice(0, -1)); else close() }, [stack.length, close])
  const load = useCallback(async () => { if (!real) return; try { setData(await api.training.get(slug)); setErr('') } catch (e) { setErr(e.message) } }, [slug, !real])
  useEffect(() => { load(); track('training_opened') }, [load])
  useEffect(() => { if (backRef.current) backRef.current.focus() }, [])
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0 }, [stack.length])
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') back() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [back])
  // Every write answers with the whole summary, so the screen settles on what the server says.
  const apply = (r) => {
    const { session, newBadges, skillId, level, ...rest } = r
    setData(rest); setFresh(newBadges || []); trainingChanged()
    for (const b of newBadges || []) track('training_badge_earned', { tier: b.tier })
    return newBadges || []
  }
  const sk = view.v === 'skill' ? skillOf(view.id) : null
  const title = view.v === 'track' ? trackOf(view.id).name : sk ? sk.name : view.v === 'badges' ? 'Badges' : view.v === 'primer' ? PRIMER.title : 'Training'
  const ctx = { data, name, slug, real, go, apply, setToast, reload: load, goAwards }
  return (
    <div className="detail tr" role="dialog" aria-modal="true" aria-label={`Training: ${title}`}>
      <header className="dhead"><button ref={backRef} className="round flat" aria-label={stack.length > 1 ? 'Back' : 'Close training'} onClick={back}><Ic n="back" /></button><b>{title}</b><span className="round flat" aria-hidden="true" /></header>
      <div className="scroll" ref={scroller}>
        {!data ? <div className="list"><div className="card empty" role="status">{err ? <><p className="formerr" role="alert">{err}</p><button className="cta small" onClick={load}>Try again</button></> : <p>Fetching {name}'s training</p>}</div></div>
          : view.v === 'track' ? <TrackView t={trackOf(view.id)} {...ctx} />
            : sk ? <SkillView key={sk.id} skill={sk} fresh={fresh} {...ctx} />
              : view.v === 'badges' ? <BadgeWall {...ctx} />
                : view.v === 'primer' ? <Primer />
                  : <TrackList {...ctx} />}
      </div>
    </div>
  )
}

function TrackList({ data, name, go }) {
  const next = data.next, earned = data.badges.filter((b) => b.earned).length
  const levels = Object.fromEntries(Object.entries(data.progress).map(([id, p]) => [id, p.level]))
  return <div className="list">
    <section className="tr-next" aria-label="Next up">
      <div className="eyebrow">NEXT UP FOR {name.toUpperCase()}</div>
      {next ? <>
        <div className="tr-nextname">{next.name}</div>
        <div className="lightm">{next.trackName} · {LEVELS[next.level]} · about {LESSONS[next.skillId].minutes} minutes</div>
        <button className="cta" onClick={() => go({ v: 'skill', id: next.skillId })}>{next.level > 0 ? 'Continue' : 'Start'}</button>
      </> : <div className="lightm">Every skill is proofed out and about. A little practice keeps it that way.</div>}
      <div className="tr-stats"><span><b className="num">{data.streak.current}</b> day streak</span><span><b className="num">{data.totals.sessions}</b> {data.totals.sessions === 1 ? 'session' : 'sessions'}</span><span><b className="num">{earned}</b> {earned === 1 ? 'badge' : 'badges'}</span></div>
    </section>
    {data.demo && <Note>This is sample progress for {name}. Everything is browsable, and nothing you tap here is saved.</Note>}
    <h2 className="tr-h">Tracks</h2>
    {TRACKS.map((t) => {
      const tt = trackTier(t, levels), started = t.skills.filter((s) => (levels[s.id] || 0) > 0).length
      return <button key={t.id} className="rrow box tr-track" onClick={() => go({ v: 'track', id: t.id })} aria-label={`${t.name}. ${tt.at2} of ${tt.n} skills reliable at home${tt.tier ? `. ${TIER[tt.tier]} badge` : ''}`}>
        <Ring at2={tt.at2} at3={tt.at3} n={tt.n} />
        <span className="grow"><b>{t.name}{tt.tier && <span className={`tr-tier ${tt.tier}`}>{TIER[tt.tier]}</span>}</b><small>{t.blurb}</small><small>{started === 0 ? `${tt.n} skills` : `${started} of ${tt.n} started · ${tt.at2} reliable at home`}</small></span>
      </button>
    })}
    <button className="rrow box" onClick={() => go({ v: 'badges' })}><span className="ricon"><TrainIcon /></span><span className="grow"><b>Badges</b><small>{earned} earned · see what each one needs</small></span></button>
    <button className="rrow box" onClick={() => go({ v: 'primer' })}><span className="ricon"><Ic n="file" s={20} c="#1F5AE8" /></span><span className="grow"><b>{PRIMER.title}</b><small>Timing, rewards, short sessions and when to stop</small></span></button>
    <Note pro>{PRO_NOTE}</Note>
  </div>
}

function TrackView({ t, data, name, go, goAwards }) {
  const badge = data.badges.find((b) => b.id === `track:${t.id}`)
  return <div className="list">
    <div className="card padc">
      <div className="row g12"><BadgeArt b={badge} s={52} /><div className="grow"><b>{badge.earned ? badge.name : `${t.name} badge`}</b><div className="meta">{badge.tier === 'gold' ? `Gold. ${badge.how}` : `Next: ${badge.how} ${badge.progress} of ${badge.target} so far.`}</div></div></div>
      <p className="meta">{t.blurb} {TRACK_NOTES[t.id]}</p>
    </div>
    <ol className="tr-skills">{t.skills.map((s, i) => {
      const level = levelIn(data, s.id), p = data.progress[s.id]
      return <li key={s.id}><button className="rrow box" onClick={() => go({ v: 'skill', id: s.id })}>
        <span className="tr-n num" aria-hidden="true">{i + 1}</span>
        <span className="grow"><b>{s.name}</b><small>{LESSONS[s.id].goal}</small><LevelPill level={level} />{p && p.sessions > 0 && <small>{p.sessions} {p.sessions === 1 ? 'session' : 'sessions'} · last {when(p.lastAt)}</small>}</span>
      </button></li>
    })}</ol>
    <Note pro>{PRO_NOTE}</Note>
    {(t.id === 'foundations' || t.id === 'loose-leash') && <Note>{TITLES_NOTE} <button className="tbtn inline" onClick={goAwards}>Go to {name}'s Awards</button></Note>}
  </div>
}

function SkillView({ skill, data, name, slug, real, apply, setToast, fresh, reload }) {
  const l = LESSONS[skill.id], t = trackOf(skill.track)
  const p = data.progress[skill.id] || { level: 0, sessions: 0, outSessions: 0 }
  const history = data.sessions.filter((s) => s.skillId === skill.id)
  const [ask, setAsk] = useState(null)
  const del = async (s) => {
    setAsk({ id: s.id, busy: true })
    try { await api.training.removeSession(s.id); setAsk(null); await reload(); trainingChanged(); setToast('Session deleted') } catch (e) { setAsk({ id: s.id, busy: false, error: e.message }) }
  }
  return <div className="list">
    <div className="card padc">
      <div className="sl">{t.name.toUpperCase()}</div>
      <p className="tr-goal">{l.goal}</p>
      <ol className="tr-levels" aria-label={`Level: ${LEVELS[p.level]}`}>{LEVELS.map((x, i) => <li key={x} className={i === p.level ? 'on' : i < p.level ? 'done' : ''} aria-current={i === p.level ? 'step' : undefined}><i aria-hidden="true" />{x}</li>)}</ol>
    </div>
    {fresh.length > 0 && <div className="card padc tr-fresh" role="status"><b>{fresh.length === 1 ? 'New badge' : 'New badges'}</b>{fresh.map((b) => <div key={b.id} className="row g12"><BadgeArt b={{ ...b, earned: true }} s={40} /><span className="grow"><b>{b.name}</b><small className="meta">{data.selfReported}</small></span></div>)}</div>}
    <LogPanel skill={skill} lesson={l} history={history} name={name} slug={slug} real={real} apply={apply} setToast={setToast} reload={real ? real.reload : null} />
    <section className="card padc" aria-label="Lesson">
      <div className="row between"><b>The lesson</b><span className="meta">About {l.minutes} minutes</span></div>
      <div className="sl">YOU WILL NEED</div>
      <ul className="tr-need">{l.need.map((x) => <li key={x}>{x}</li>)}</ul>
      <div className="sl">STEPS</div>
      <ol className="tr-steps">{l.steps.map((x, i) => <li key={i}><span className="num" aria-hidden="true">{i + 1}</span><span>{x}</span></li>)}</ol>
      <div className="tr-two"><div><div className="sl">MAKE IT EASIER</div><p>{l.easier}</p></div><div><div className="sl">MAKE IT HARDER</div><p>{l.harder}</p></div></div>
      <div className="sl">COMMON MISTAKES</div>
      <ul className="tr-need">{l.mistakes.map((x) => <li key={x}>{x}</li>)}</ul>
      {l.note && <Note>{l.note}</Note>}
    </section>
    <section className="card padc" aria-label="Pass standard">
      <b>Pass standard</b>
      <div className="tr-pass"><span className="tr-pill l2">{LEVELS[2]}</span><p>{l.pass.home}.</p></div>
      <div className="tr-pass"><span className="tr-pill l3">{LEVELS[3]}</span><p>{l.pass.out}.</p></div>
      <SelfCheck skill={skill} lesson={l} p={p} data={data} name={name} slug={slug} real={real} apply={apply} setToast={setToast} />
    </section>
    <section className="card padc" aria-label="Practice history">
      <div className="row between"><b>Practice history</b><span className="meta">{history.length ? `${history.length} ${history.length === 1 ? 'session' : 'sessions'}` : ''}</span></div>
      {history.length === 0 && <p className="meta">No practice logged for this skill yet.</p>}
      {history.slice(0, 20).map((s) => <div key={s.id} className="tr-hist">
        <div className="row between g8"><span><b>{when(s.at)}</b> · {s.minutes} min · {s.repsOk} of {s.repsTotal} · {PLACE_NAME[s.place]}</span><span className="meta">{s.by}</span></div>
        {s.note && <p className="meta">{s.note}</p>}
        {s.canDelete && (ask && ask.id === s.id ? <Confirm text="Delete this session?" yes="Delete" no="Keep it" busy={ask.busy} error={ask.error} onYes={() => del(s)} onNo={() => setAsk(null)} /> : <button className="tbtn" aria-label={`Delete the session from ${when(s.at)}`} onClick={() => setAsk({ id: s.id })}>Delete</button>)}
      </div>)}
    </section>
    <Note>{CARE_NOTE}</Note>
    <Note pro>{PRO_NOTE}</Note>
  </div>
}

// Two taps for the usual case: "Log a session" opens it with the lesson's defaults filled in, "Save session" stores it.
function LogPanel({ skill, lesson, history, name, slug, real, apply, setToast, reload }) {
  const id = useId()
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const [minutes, setMinutes] = useState(lesson.minutes), [ok, setOk] = useState(4), [total, setTotal] = useState(5)
  const [place, setPlace] = useState(history[0] ? history[0].place : 'home'), [note, setNote] = useState(''), [share, setShare] = useState(false)
  const setTot = (v) => { setTotal(v); if (ok > v) setOk(v) }
  const save = async () => {
    if (busy) return
    if (!real) { setToast(NEEDS_ACCOUNT); return }
    setBusy(true); setErr('')
    let walk = null
    try {
      // "Share to days" makes a Training outing first, with no GPS and without the note, which stays in the practice log.
      if (share) walk = (await api.post(`/dogs/${slug}/walks`, { type: 'Training', title: `${skill.name} practice`, note: '', place: '', miles: 0, minutes })).walk
      const r = await api.training.log(slug, { skillId: skill.id, minutes, repsOk: ok, repsTotal: total, place, note: note.trim(), ...(walk ? { walkId: walk.id } : {}) })
      track('training_session_logged', { track: skill.track, place })
      const got = apply(r)
      setOpen(false); setNote(''); setShare(false)
      setToast(got.length ? `Logged. New badge: ${got[0].name}` : walk ? `Logged, and shared to ${name}'s days` : 'Practice logged')
      if (walk && reload) reload()
    } catch (e) {
      // The session did not save, so the outing made for it is taken back.
      if (walk) { try { await api.del(`/walks/${walk.id}`) } catch (e2) {} }
      setErr(e.status ? e.message : 'Not saved. Check your connection and try again.')
    }
    setBusy(false)
  }
  if (!open) return <button className="cta" onClick={() => setOpen(true)}>Log a session</button>
  return <section className="card padc tr-log" aria-label="Log a session">
    <b>Log a session</b>
    <div className="tr-f"><span className="sl">MINUTES</span><div className="chips wrap" role="group" aria-label="Minutes">{[...new Set([2, 3, 4, 5, 10, lesson.minutes])].sort((a, b) => a - b).map((m) => <button key={m} type="button" className={`chip flat ${minutes === m ? 'on' : ''}`} aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{m}</button>)}</div></div>
    <div className="tr-f"><span className="sl">TRIES THAT WORKED</span><div className="row g8"><Stepper label="Tries that worked" value={ok} set={setOk} min={0} max={total} /><span className="meta">out of</span><Stepper label="Tries in all" value={total} set={setTot} min={1} max={TRAINING_LIMITS.reps} /></div></div>
    <div className="tr-f"><span className="sl">WHERE</span><div className="chips wrap" role="group" aria-label="Where">{PLACES.map(([k, label]) => <button key={k} type="button" className={`chip flat ${place === k ? 'on' : ''}`} aria-pressed={place === k} onClick={() => setPlace(k)}>{label}</button>)}</div></div>
    <div className="field lightf"><label htmlFor={`${id}-n`}>Note (optional, only the care team sees it)</label><input id={`${id}-n`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={TRAINING_LIMITS.note} autoComplete="off" /></div>
    <label className="switch slim"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /><span className="grow"><b>Share to {name}'s days</b><small>Adds a Training outing to the feed. The note is not shared.</small></span></label>
    {err && <p className="formerr" role="alert">{err}</p>}
    <div className="row g8"><button className="cta small" onClick={save} disabled={busy}>{busy ? 'Saving' : 'Save session'}</button><button className="cta small white bordered" type="button" onClick={() => { setOpen(false); setErr('') }}>Cancel</button></div>
  </section>
}

// The family's own honest check against the pass standard. Every answer has to be a yes.
function SelfCheck({ skill, lesson, p, data, name, slug, real, apply, setToast }) {
  const [openFor, setOpenFor] = useState(0), [ans, setAns] = useState([]), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const target = p.level === 1 ? 2 : p.level === 2 ? 3 : 0
  const send = async (level, checks) => {
    if (busy) return
    if (!real) { setToast(NEEDS_ACCOUNT); return }
    setBusy(true); setErr('')
    try {
      const r = await api.training.setLevel(slug, skill.id, level, checks)
      if (checks) track('training_level_confirmed', { level })
      const got = apply(r)
      setOpenFor(0); setAns([])
      setToast(got.length ? `New badge: ${got[0].name}` : `${skill.name} is now "${LEVELS[r.level]}"`)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  if (!data.canConfirm) return <Note>Only {name}'s owner or family can confirm a level. Your practice still counts toward it.</Note>
  if (p.level === 0) return <Note>Log a first session to start. A level is confirmed with a short self-check once {name} meets the standard.</Note>
  const needsOut = target === 3 && !(p.outSessions > 0)
  const qs = target ? selfCheck(target, lesson.pass, name) : []
  const yes = qs.length > 0 && qs.every((_, i) => ans[i] === true), anyNo = ans.some((v) => v === false)
  return <div className="tr-check">
    {p.level === 3 && <p className="meta"><b>{LEVELS[3]}.</b> Confirmed{p.passedBy ? ` by ${p.passedBy}` : ''}. Nice work, both of you.</p>}
    {target > 0 && openFor !== target && <>
      {needsOut ? <p className="meta">To confirm "{LEVELS[3]}", first log a session with Where set to Out and about.</p>
        : <button className="cta small dark" onClick={() => { setOpenFor(target); setAns([]); setErr('') }}>Check for "{LEVELS[target]}"</button>}
    </>}
    {target > 0 && openFor === target && <div className="tr-qs" role="group" aria-label={`Self-check for ${LEVELS[target]}`}>
      <p className="meta">Answer honestly. {CHECK_COUNT} yes answers confirm the level. This is your own report, not a certification.</p>
      {qs.map((q, i) => <div key={i} className="tr-q"><p>{q}</p><div className="row g8">
        <button type="button" className={`chip flat ${ans[i] === true ? 'on' : ''}`} aria-pressed={ans[i] === true} onClick={() => setAns((a) => { const n = [...a]; n[i] = true; return n })}>Yes</button>
        <button type="button" className={`chip flat ${ans[i] === false ? 'on' : ''}`} aria-pressed={ans[i] === false} onClick={() => setAns((a) => { const n = [...a]; n[i] = false; return n })}>Not yet</button>
      </div></div>)}
      {anyNo && <p className="meta">Not yet is a fine answer. A few more short sessions, then check again.</p>}
      {err && <p className="formerr" role="alert">{err}</p>}
      <div className="row g8"><button className="cta small" disabled={!yes || busy} onClick={() => send(target, qs.map(() => true))}>{busy ? 'Saving' : `Confirm: ${LEVEL_SHORT[target]}`}</button><button className="cta small white bordered" type="button" onClick={() => { setOpenFor(0); setErr('') }}>Cancel</button></div>
    </div>}
    {p.level >= 2 && openFor === 0 && <>
      {err && <p className="formerr" role="alert">{err}</p>}
      <button className="tbtn" disabled={busy} onClick={() => send(p.level - 1, null)}>Step back to "{LEVELS[p.level - 1]}"</button>
    </>}
  </div>
}

function BadgeWall({ data, name, goAwards }) {
  const groups = [['track', 'Track badges', 'Bronze at half a track reliable at home, Silver at the whole track, Gold when the whole track is proofed in public.'], ['cross', 'Practice and places', 'For showing up, and for sets of skills that go together.'], ['skill', 'Skill badges', 'One per skill at "Reliable at home", upgraded at "Proofed out and about".']]
  const earned = data.badges.filter((b) => b.earned).length
  return <div className="list">
    <div className="card padc"><b>{earned} of {data.badges.length} earned</b><p className="meta"><b>{data.selfReported}.</b> {TITLES_NOTE}</p><button className="tbtn" onClick={goAwards}>Go to {name}'s Awards</button></div>
    {groups.map(([g, title, sub]) => <section key={g} className="card padc" aria-label={title}>
      <b>{title}</b><p className="meta">{sub}</p>
      <ul className="tr-wall">{data.badges.filter((b) => b.group === g).map((b) => <li key={b.id} className={b.earned ? 'on' : ''}>
        <BadgeArt b={b} s={g === 'skill' ? 44 : 52} />
        <b>{b.name}</b>
        <small>{b.earned ? (b.group === 'track' && b.tier !== 'gold' ? `Earned. Next: ${b.how}` : b.group === 'skill' && b.tier === 'reliable' ? 'Earned. Proof it in public to upgrade.' : 'Earned') : `Locked. ${b.how}${b.group !== 'skill' && b.target > 1 && b.progress > 0 ? ` ${b.progress} of ${b.target} so far.` : ''}`}</small>
      </li>)}</ul>
    </section>)}
  </div>
}

function Primer() {
  return <div className="list">
    <div className="card padc"><p className="tr-goal">{PRIMER.intro}</p></div>
    {PRIMER.sections.map((s) => <section key={s.h} className="card padc"><b>{s.h}</b><p className="tr-p">{s.p}</p></section>)}
    <section className="card padc"><b>A note on puppies</b><p className="tr-p">{PUPPY_NOTE}</p></section>
    <section className="card padc"><b>Heat, age and comfort</b><p className="tr-p">{CARE_NOTE}</p></section>
    <Note pro>{PRO_NOTE}</Note>
  </div>
}
