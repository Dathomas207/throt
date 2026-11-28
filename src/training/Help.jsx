// Ways out of Trot from a lesson: a video search, free articles, trainer directories, trainers from
// Trot's own places index, a practice reminder for the calendar, and sharing an earned badge.
// Everything that leaves the app is a plain link: it opens in a new tab on the website and in Safari
// inside the iPhone app (Capacitor hands any outside address to iOS). No outside script, frame, font
// or picture is loaded here.
import React, { useEffect, useId, useState } from 'react'
import { api } from '../api.js'
import { copyText } from '../ui.jsx'
import { isNative, siteUrl } from '../native/platform.js'
import { videoSearchUrl, articlesFor, DIRECTORIES, isTrainerPlace, trainerKind } from './links.js'
import { practiceIcs, icsFileName, REMINDER_DAYS, REMINDER_DEFAULT, sessionCount } from './ics.js'
import './help.css'

const Out = ({ href, children, label, className = 'tr-out' }) => <a className={className} href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>{children}<span className="tr-ext" aria-hidden="true">↗</span></a>
const checkedOn = (iso) => { const d = new Date(`${iso}T12:00:00`); return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) }

// ---- the lesson's "Learn more and get help" card ---------------------------------------------------
export function LearnMore({ skill, lesson, name, goTrainers }) {
  const video = videoSearchUrl(skill.id), reads = articlesFor(skill.id)
  return <section className="card padc tr-help" aria-label="Learn more and get help">
    <b>Learn more and get help</b>
    <div className="sl">WATCH A DEMONSTRATION</div>
    <Out href={video} label={`Search YouTube for videos on ${skill.name}. Opens outside Trot`}>Search YouTube: {skill.name.toLowerCase()} with rewards</Out>
    <p className="meta">A YouTube search for reward-based videos. Trot does not choose or check the results, so skip any that use force or a harsh tone.</p>
    {reads.length > 0 && <>
      <div className="sl">READ MORE</div>
      <ul className="tr-reads">{reads.map((a) => <li key={a.url}><Out href={a.url} label={`${a.title}, ${a.source}. Opens outside Trot`}><span className="grow"><b>{a.title}</b><small>{a.source} · link checked {checkedOn(a.checked)}</small></span></Out></li>)}</ul>
    </>}
    <div className="sl">GET HELP</div>
    <button type="button" className="rrow box tr-helprow" onClick={goTrainers}><span className="grow"><b>Find a trainer</b><small>Certified trainer directories, and trainers listed in Trot near you</small></span></button>
    <Reminder skill={skill} lesson={lesson} name={name} />
    <p className="meta">Outside sites are run by their own organizations. Trot is not affiliated with them.</p>
  </section>
}

// ---- a calendar file for short practice sessions ---------------------------------------------------
// On the website the file downloads. Inside the iPhone app a web view cannot save a file this way, so
// there the button shares the file through the share sheet when the phone offers it, and is hidden when not.
const canShareFile = () => { try { return typeof navigator.canShare === 'function' && typeof File !== 'undefined' && navigator.canShare({ files: [new File(['x'], 'x.ics', { type: 'text/calendar' })] }) } catch (e) { return false } }
export function Reminder({ skill, lesson, name }) {
  const id = useId()
  const [open, setOpen] = useState(false), [time, setTime] = useState('18:00'), [days, setDays] = useState(REMINDER_DEFAULT.days), [every, setEvery] = useState(1), [msg, setMsg] = useState('')
  const viaShare = isNative
  if (viaShare && !canShareFile()) return null
  const make = async () => {
    const [h, m] = time.split(':').map(Number)
    const text = practiceIcs({ skillId: skill.id, skillName: skill.name, minutes: lesson.minutes, hour: h, minute: m, days, every, start: new Date(), now: new Date(), url: siteUrl('/') })
    const fname = icsFileName(skill.id)
    if (viaShare) {
      try { await navigator.share({ files: [new File([text], fname, { type: 'text/calendar' })], title: `Practice: ${skill.name}` }); setMsg('Shared. Choose Calendar to add it.') } catch (e) { if (!e || e.name !== 'AbortError') setMsg('Could not share the file on this phone.') }
      return
    }
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }))
      const a = document.createElement('a'); a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      setMsg(`Saved ${fname}. Open it to add ${sessionCount(days, every)} sessions to your calendar.`)
    } catch (e) { setMsg('Your browser blocked the download.') }
  }
  if (!open) return <button type="button" className="cta small white bordered tr-remind" onClick={() => setOpen(true)}>Add a practice reminder</button>
  return <div className="tr-remindf" role="group" aria-label="Practice reminder">
    <b>Practice reminder for {skill.name}</b>
    <div className="field lightf"><label htmlFor={`${id}-t`}>Time of day</label><input id={`${id}-t`} type="time" value={time} onChange={(e) => setTime(e.target.value || '18:00')} /></div>
    <div className="tr-f"><span className="sl">FOR HOW MANY DAYS</span><div className="chips wrap" role="group" aria-label="For how many days">{REMINDER_DAYS.map((d) => <button key={d} type="button" className={`chip flat ${days === d ? 'on' : ''}`} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>)}</div></div>
    <div className="tr-f"><span className="sl">HOW OFTEN</span><div className="chips wrap" role="group" aria-label="How often">{[[1, 'Every day'], [2, 'Every other day']].map(([v, l]) => <button key={v} type="button" className={`chip flat ${every === v ? 'on' : ''}`} aria-pressed={every === v} onClick={() => setEvery(v)}>{l}</button>)}</div></div>
    <p className="meta">{sessionCount(days, every)} sessions of about {lesson.minutes} minutes for {name}. The file stays on your device; Trot does not see your calendar.</p>
    <div className="row g8"><button type="button" className="cta small" onClick={make}>{viaShare ? 'Share calendar file' : 'Download calendar file'}</button><button type="button" className="cta small white bordered" onClick={() => { setOpen(false); setMsg('') }}>Close</button></div>
    {msg && <p className="meta" role="status">{msg}</p>}
  </div>
}

// ---- Find a trainer ------------------------------------------------------------------------------------
const HOME = [35.186, -80.812] // Eastover, Charlotte, as on Today
function lastCenter() {
  try { const v = JSON.parse(localStorage.getItem('trot-view-v2')); if (v && Array.isArray(v.at) && Number.isFinite(v.at[0]) && Number.isFinite(v.at[1])) return v.at } catch (e) { /* no saved map position */ }
  return HOME
}
const R = 3958.8, rad = (d) => (d * Math.PI) / 180
const miles = (a, b) => { const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)) }

export function TrainersView({ hasApi = true }) {
  const [list, setList] = useState(null), [err, setErr] = useState(false)
  useEffect(() => {
    let on = true
    const c = lastCenter()
    if (!api.places || !hasApi) { setList([]); return }
    api.places.list({ s: c[0] - 0.35, n: c[0] + 0.35, w: c[1] - 0.45, e: c[1] + 0.45 }).then((r) => {
      if (!on) return
      const found = (r && r.places || []).filter((p) => Array.isArray(p.at) && isTrainerPlace(p)).map((p) => ({ ...p, mi: miles(c, p.at) })).sort((a, b) => a.mi - b.mi).slice(0, 10)
      setList(found)
    }, () => { if (on) { setErr(true); setList([]) } })
    return () => { on = false }
  }, [hasApi])
  return <div className="list">
    <div className="card padc"><p className="tr-goal">Short lessons cover everyday manners. For fear, aggression, guarding, distress when left alone or any bite history, work with a qualified professional.</p></div>
    <section className="card padc" aria-label="Trainers near you">
      <b>Trainers near you</b>
      <p className="meta">From Trot's places index, around the last area you looked at on the map. Listings say they offer training; Trot has not checked their methods or credentials. Ask how they reward dogs before you book.</p>
      {list === null ? <p className="meta" role="status">Looking for trainers nearby</p>
        : list.length === 0 ? <p className="meta">{err ? 'The places index did not answer. The directories below cover every area.' : 'No trainers are listed in Trot near here yet. The directories below cover every area.'}</p>
          : <ul className="tr-trainers">{list.map((p) => <li key={p.id}>
            <div className="row between g8"><b>{p.name}</b><span className="meta">{p.mi < 10 ? p.mi.toFixed(1) : Math.round(p.mi)} mi</span></div>
            <small className="tr-kind">{trainerKind(p)}</small>
            {p.note && <p className="meta">{p.note}</p>}
            {p.address && <p className="meta">{p.address}</p>}
            {p.sourceUrl && <Out href={p.sourceUrl} label={`Listing source for ${p.name}. Opens outside Trot`}>Listing source</Out>}
          </li>)}</ul>}
    </section>
    <section className="card padc" aria-label="Certified trainer directories">
      <b>Certified trainer directories</b>
      <p className="meta">Each directory is run by the organization that grants the credential. Trot is not affiliated with any of them.</p>
      <ul className="tr-dirs">{DIRECTORIES.map((d) => <li key={d.id}>
        <Out href={d.url} label={`${d.full} directory. Opens outside Trot`}><span className="grow"><b>{d.name}</b><small>{d.full}</small></span></Out>
        <p className="meta">{d.means}</p>
      </li>)}</ul>
    </section>
  </div>
}

// ---- share an earned badge ----------------------------------------------------------------------------
// The link is the dog's public page on the website (never capacitor://localhost), and only when that
// page is public. Otherwise the text goes alone.
export function ShareBadge({ b, name, real, setToast }) {
  const share = async () => {
    if (!real) { setToast('Sharing needs an account. Demo badges are sample progress.'); return }
    const url = real.dog.public ? siteUrl(`/d/${real.dog.slug}`) : ''
    const text = `${name} earned the "${b.name}" training badge on Trot. Self-reported by ${name}'s family.`
    try {
      if (typeof navigator.share === 'function') { await navigator.share({ title: `${name} on Trot`, text, ...(url ? { url } : {}) }); return }
    } catch (e) { if (e && e.name === 'AbortError') return }
    const ok = await copyText(url ? `${text} ${url}` : text)
    setToast(ok ? (url ? 'Copied the badge and the link to the public page' : `Copied. ${name}'s page is private, so no link was added.`) : 'Could not copy')
  }
  return <button type="button" className="tbtn tr-share" onClick={share} aria-label={`Share the ${b.name} badge`}>Share</button>
}
