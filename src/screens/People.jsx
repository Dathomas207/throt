import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Ic, Paw, Av, Stat, Range, Card, whoName, ptsOf, DogSwitch, personColor, firstName, ROLE_LABEL, copyText } from '../ui.jsx'
import { ROUTES, PLACES, DOG, PEOPLE, PACK, CONNECTIONS, WEIGHTS, HEALTH, dayLabel, fmtTime, haversine } from '../data.js'

export default function People(props) { return props.real ? <RealPeople {...props} /> : <DemoPeople {...props} /> }

const INVITE_ROLES = [['walker', 'Dog walker'], ['family', 'Family'], ['daycare', 'Daycare']]
// Signed in: the care team and each person's share of the last 7 days, from the API.
function RealPeople({ real, setToast }) {
  const { dog, dogs, team, totals } = real
  const [sheet, setSheet] = useState(false)
  const [role, setRole] = useState('walker')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const total = totals.week.minutes
  const rows = team.map((m, i) => ({ ...m, color: personColor(i)[0], ink: personColor(i)[1] })).sort((a, b) => b.week.minutes - a.week.minutes)
  const mine = (team.find((m) => m.you) || { week: { minutes: 0, outings: 0, miles: 0 }, role: '' })
  const share = total ? Math.round((mine.week.minutes / total) * 100) : 0
  const owner = dog.role === 'owner'
  const create = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try { const r = await real.createInvite(role); setLink(location.origin + r.path) } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const copy = async () => setToast((await copyText(link)) ? 'Invite link copied' : 'Copy did not work here. Select the link and copy it.')
  const close = () => { setSheet(false); setLink(''); setErr('') }
  return (
    <div className="scroll">
      <header className="top"><h1 className="h1">{dog.name}'s people</h1></header>
      <DogSwitch dogs={dogs} active={dog.slug} onPick={real.switchDog} />
      <section className="hero">
        <div className="eyebrow">YOUR LAST 7 DAYS WITH {dog.name.toUpperCase()}, {firstName(real.user.name).toUpperCase()}</div>
        <div className="row g20"><Stat light l="TIME TOGETHER" v={fmtTime(mine.week.minutes)} big={30} /><Stat light l="OUTINGS" v={mine.week.outings} big={30} /><Stat light l="MILES" v={mine.week.miles.toFixed(1)} big={30} /></div>
        {total > 0 && <div className="lovebar" aria-label={`Share of ${dog.name}'s week by person`}>{rows.filter((r) => r.week.minutes > 0).map((r) => <i key={r.id} style={{ width: (r.week.minutes / total) * 100 + '%', background: r.color === '#0F1B2D' ? '#5B6472' : r.color }} />)}</div>}
        <div className="meta lightm"><Ic n="heart" s={14} c="#C8F031" f="#C8F031" /> {total > 0 ? `You gave ${dog.name} ${share}% of the last 7 days out and about.` : `${dog.name} has no outings in the last 7 days yet.`}</div>
      </section>
      <div className="list">
        <div className="eyebrow dark padx">LAST 7 DAYS</div>
        {rows.map((r) => (
          <div key={r.id} className="card prow">
            <Av t={(r.name.trim()[0] || '?').toUpperCase()} s={44} bg={r.color} c={r.ink} sq={r.role === 'daycare'} />
            <div className="grow"><div className="row between"><b>{r.name}{r.you && <span className="you">You</span>}</b><span className="num">{total ? Math.round((r.week.minutes / total) * 100) : 0}%</span></div><div className="meta">{r.role === 'owner' ? `${dog.name}'s human` : ROLE_LABEL[r.role] || r.role}</div><div className="bar thin"><i style={{ width: (total ? (r.week.minutes / total) * 100 : 0) + '%' }} /></div><div className="meta">{r.week.outings} {r.week.outings === 1 ? 'outing' : 'outings'} · {fmtTime(r.week.minutes)} · {r.week.miles.toFixed(1)} mi</div></div>
          </div>
        ))}
        {owner
          ? <button className="rrow box" onClick={() => setSheet(true)}><span className="ricon"><Ic n="plus" s={20} c="#1F5AE8" /></span><span className="grow"><b>Invite someone</b><small>Walkers, family and daycare can join {dog.name}'s team with a link</small></span></button>
          : <p className="meta padx">Only {dog.name}'s owner can invite people.</p>}
      </div>
      {sheet && <div className="scrim" onClick={close}><div className="modal" role="dialog" aria-label={`Invite someone to ${dog.name}'s team`} onClick={(e) => e.stopPropagation()}>
        <div className="grab" /><h2>Invite someone to {dog.name}'s team</h2>
        {!link ? <>
          <p>Pick how they know {dog.name}, then send them the link.</p>
          <div className="chips wrap" role="group" aria-label="Role">{INVITE_ROLES.map(([k, l]) => <button key={k} className={`chip flat ${role === k ? 'on' : ''}`} aria-pressed={role === k} onClick={() => setRole(k)}>{l}</button>)}</div>
          {err && <p className="formerr" role="alert">{err}</p>}
          <button className="cta" onClick={create} disabled={busy}>{busy ? 'Creating' : 'Create invite link'}</button>
        </> : <>
          <label className="field lightf"><span>Invite link</span><input className="linkinput" readOnly value={link} onFocus={(e) => e.target.select()} /></label>
          <p className="meta">Works once and expires in 14 days. Anyone who has the link can join {dog.name}'s team, so send it to one person.</p>
          <button className="cta" onClick={copy}><Ic n="link" s={20} c="#0F1B2D" />Copy</button>
        </>}
        <button className="cta white bordered" onClick={close}>{link ? 'Done' : 'Cancel'}</button>
      </div></div>}
    </div>
  )
}

function DemoPeople({ week, me, setMe, setToast }) {
  const rows = Object.values(PEOPLE).map((p) => ({ ...p, ...(week.by[p.id] || { min: 0, n: 0, mi: 0 }) })).sort((a, b) => b.min - a.min)
  const mine = week.by[me] || { min: 0, n: 0, mi: 0 }
  const share = week.total ? Math.round((mine.min / week.total) * 100) : 0
  return (
    <div className="scroll">
      <header className="top"><h1 className="h1">Biscuit's people</h1></header>
      <section className="hero">
        <div className="eyebrow">YOUR WEEK WITH BISCUIT, {PEOPLE[me].name.toUpperCase()}</div>
        <div className="row g20"><Stat light l="TIME TOGETHER" v={fmtTime(mine.min)} big={30} /><Stat light l="OUTINGS" v={mine.n} big={30} /><Stat light l="MILES" v={mine.mi.toFixed(1)} big={30} /></div>
        <div className="lovebar" aria-label="Share of Biscuit's week by person">{rows.filter((r) => r.min > 0).map((r) => <i key={r.id} style={{ width: (r.min / week.total) * 100 + '%', background: r.color === '#0F1B2D' ? '#5B6472' : r.color }} />)}</div>
        <div className="meta lightm"><Ic n="heart" s={14} c="#C8F031" f="#C8F031" /> You gave Biscuit {share}% of this week's time out and about.</div>
      </section>
      <div className="list">
        <div className="eyebrow dark padx">THIS WEEK</div>
        {rows.map((r) => (
          <div key={r.id} className="card prow">
            <Av t={r.name[0]} s={44} bg={r.color} c={r.ink} sq={r.id === 'tails'} />
            <div className="grow"><div className="row between"><b>{r.name}{r.id === me && <span className="you">You</span>}</b><span className="num">{week.total ? Math.round((r.min / week.total) * 100) : 0}%</span></div><div className="meta">{r.role}</div><div className="bar thin"><i style={{ width: (week.total ? (r.min / week.total) * 100 : 0) + '%' }} /></div><div className="meta">{r.n} {r.n === 1 ? "outing" : "outings"} · {fmtTime(r.min)} · {r.mi.toFixed(1)} mi</div></div>
          </div>
        ))}
        <button className="rrow box" onClick={() => setToast('Invite link copied (demo)')}><span className="ricon"><Ic n="plus" s={20} c="#1F5AE8" /></span><span className="grow"><b>Add someone to Biscuit's team</b><small>Walkers, family, daycare, the vet</small></span></button>
        <div className="eyebrow dark padx">DEMO: VIEW THE APP AS</div>
        <div className="chips wrap padx">{['dale', 'pat', 'sue'].map((id) => <button key={id} className={`chip flat ${me === id ? 'on' : ''}`} aria-pressed={me === id} onClick={() => { setMe(id); setToast(`Now signed in as ${PEOPLE[id].name}`) }}>{PEOPLE[id].name}</button>)}</div>
      </div>
    </div>
  )
}
