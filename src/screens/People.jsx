import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Ic, Paw, Av, Stat, Range, Card, whoName, ptsOf, DogSwitch, personColor, firstName, ROLE_LABEL, copyText, Confirm } from '../ui.jsx'
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
  const owner = dog.role === 'owner'
  const total = totals.week.minutes
  const rows = team.map((m, i) => ({ ...m, color: personColor(i)[0], ink: personColor(i)[1] })).sort((a, b) => b.week.minutes - a.week.minutes)
  const mine = (team.find((m) => m.you) || { week: { minutes: 0, outings: 0, miles: 0 }, role: '' })
  const share = total ? Math.round((mine.week.minutes / total) * 100) : 0
  // Open invites, for the owner. `ask` is the row waiting on a confirm step.
  const [invites, setInvites] = useState([])
  const [ask, setAsk] = useState(null)
  const loadInvites = async () => { if (!owner) { setInvites([]); return } try { setInvites((await real.listInvites()).invites) } catch (e) {} }
  useEffect(() => { setAsk(null); loadInvites() }, [dog.slug, owner])
  const create = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try { const r = await real.createInvite(role); setLink(location.origin + r.path); loadInvites() } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const confirmAsk = async () => {
    const a = ask
    if (!a || a.busy) return
    setAsk({ ...a, busy: true, error: '' })
    const r = a.kind === 'member' ? await real.removeMember(a.id) : await real.cancelInvite(a.id)
    if (a.kind === 'invite') await loadInvites()
    // An invite that is already gone (used or expired) counts as done.
    if (r.error && r.status !== 404) { setAsk({ ...a, busy: false, error: r.error }); return }
    setAsk(null)
    setToast(a.kind === 'member' ? `${firstName(a.name)} is off ${dog.name}'s team` : 'Invite cancelled. That link no longer works.')
  }
  // Your own display name.
  const [naming, setNaming] = useState(null)
  const saveName = async (e) => {
    e.preventDefault()
    if (!naming || naming.busy) return
    const name = naming.value.replace(/\s+/g, ' ').trim()
    if (!name) { setNaming({ ...naming, error: 'Type the name you want the team to see.' }); return }
    if (name.length > 60) { setNaming({ ...naming, error: 'Keep your name to 60 characters or fewer.' }); return }
    if (name === real.user.name) { setNaming(null); return }
    setNaming({ ...naming, busy: true, error: '' })
    const r = await real.renameMe(name)
    if (r.error) { setNaming({ ...naming, busy: false, error: r.error }); return }
    setNaming(null); setToast(`You now show as ${firstName(r.user.name)}`)
  }
  const day = (v) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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
          <div key={r.id} className="card"><div className="prow">
            <Av t={(r.name.trim()[0] || '?').toUpperCase()} s={44} bg={r.color} c={r.ink} sq={r.role === 'daycare'} />
            <div className="grow"><div className="row between"><b>{r.name}{r.you && <span className="you">You</span>}</b><span className="num">{total ? Math.round((r.week.minutes / total) * 100) : 0}%</span></div><div className="meta">{r.role === 'owner' ? `${dog.name}'s human` : ROLE_LABEL[r.role] || r.role}</div><div className="bar thin"><i style={{ width: (total ? (r.week.minutes / total) * 100 : 0) + '%' }} /></div><div className="meta">{r.week.outings} {r.week.outings === 1 ? 'outing' : 'outings'} · {fmtTime(r.week.minutes)} · {r.week.miles.toFixed(1)} mi</div></div>
          </div>
            {owner && !r.you && r.role !== 'owner' && (ask && ask.kind === 'member' && ask.id === r.id
              ? <div className="rowfoot"><Confirm text={`Remove ${r.name} from ${dog.name}'s team? They lose access to ${dog.name}'s walks and routes. Walks they already logged stay on ${dog.name}'s page.`} yes={`Remove ${firstName(r.name)}`} no="Keep" busy={ask.busy} error={ask.error} onYes={confirmAsk} onNo={() => setAsk(null)} /></div>
              : <div className="rowfoot"><button className="tbtn" onClick={() => setAsk({ kind: 'member', id: r.id, name: r.name })}>Remove {firstName(r.name)} from the team</button></div>)}
          </div>
        ))}
        {owner && invites.length > 0 && <div className="card padc"><div className="eyebrow dark">INVITES NOT USED YET</div>
          {invites.map((i) => <div key={i.id} className="invrow">
            <div className="row between g8"><span className="grow"><b>{ROLE_LABEL[i.role] || i.role} invite</b><small>Made {day(i.createdAt)} · expires {day(i.expiresAt)}</small></span>
              {!(ask && ask.kind === 'invite' && ask.id === i.id) && <button className="tbtn" aria-label={`Cancel the ${ROLE_LABEL[i.role] || i.role} invite made ${day(i.createdAt)}`} onClick={() => setAsk({ kind: 'invite', id: i.id })}>Cancel invite</button>}</div>
            {ask && ask.kind === 'invite' && ask.id === i.id && <Confirm text="Cancel this invite? The link stops working at once. Nobody already on the team is affected." yes="Cancel invite" no="Keep it" busy={ask.busy} error={ask.error} onYes={confirmAsk} onNo={() => setAsk(null)} />}
          </div>)}
        </div>}
        {owner
          ? <button className="rrow box" onClick={() => setSheet(true)}><span className="ricon"><Ic n="plus" s={20} c="#1F5AE8" /></span><span className="grow"><b>Invite someone</b><small>Walkers, family and daycare can join {dog.name}'s team with a link</small></span></button>
          : <p className="meta padx">Only {dog.name}'s owner can invite people.</p>}
        <div className="card padc"><div className="eyebrow dark">YOU</div>
          {naming
            ? <form className="wform" onSubmit={saveName} noValidate>
              <div className="field lightf"><label htmlFor="me-name">Your name</label><input id="me-name" value={naming.value} onChange={(e) => setNaming({ ...naming, value: e.target.value, error: '' })} maxLength={80} autoComplete="name" autoFocus aria-invalid={naming.error ? true : undefined} aria-describedby="me-name-note" />
                {naming.error ? <p className="ferr" id="me-name-note" role="alert">{naming.error}</p> : <p className="fhint" id="me-name-note">Your first name is what shows next to {dog.name}'s walks, as in "with {firstName(naming.value) || 'Pat'}".</p>}</div>
              <div className="row g8"><button className="cta small" type="submit" disabled={naming.busy}>{naming.busy ? 'Saving' : 'Save name'}</button><button className="cta small white bordered" type="button" onClick={() => setNaming(null)} disabled={naming.busy}>Cancel</button></div>
            </form>
            : <div className="row between g8"><span className="grow yourow"><b>{real.user.name}</b><small>Shows as "with {firstName(real.user.name)}" on walks you log</small></span><button className="tbtn" onClick={() => setNaming({ value: real.user.name, busy: false, error: '' })}>Edit name</button></div>}
          <button className="rrow box line" onClick={real.signOut}><span className="grow"><b>Sign out</b><small>On this device</small></span></button>
        </div>
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
