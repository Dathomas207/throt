import React, { useEffect, useRef, useState } from 'react'
import { Ic, Av, Stat, Card, Confirm, toAct, firstName, ROLE_LABEL } from '../ui.jsx'
import { api } from '../api.js'
import { PEOPLE, fmtTime } from '../data.js'

const ROLES = [['walker', 'Dog walker'], ['family', 'Family'], ['daycare', 'Daycare']]
// One person's time with the dog. Signed in it comes from the API, with no email anywhere.
// In the demo it is worked out from the demo walks.
export default function Person({ person, close, real, acts, week, pawed, paw, setOpen, setToast }) {
  const back = useRef(null)
  useEffect(() => { if (back.current) back.current.focus() }, [])
  const [data, setData] = useState(null), [err, setErr] = useState(''), [ask, setAsk] = useState(null), [role, setRole] = useState(person.role), [busy, setBusy] = useState(false)
  const dogName = real ? real.dog.name : 'Biscuit'
  useEffect(() => {
    if (!real) return
    let on = true
    api.team.person(real.dog.slug, person.id).then((r) => { if (on) { setData(r); setRole(r.member.role) } }, (e) => { if (on) setErr(e.message) })
    return () => { on = false }
  }, [real && real.dog.slug, person.id])
  let m, list
  if (real) {
    m = data ? data.member : null
    list = data ? data.walks.map((w) => toAct(w, real.team)) : []
  } else {
    const all = acts.filter((a) => a.by === person.id), wk = all.filter((a) => a.daysAgo <= 6)
    const sum = (xs) => ({ outings: xs.length, minutes: xs.reduce((s, a) => s + a.minutes, 0), miles: xs.reduce((s, a) => s + a.miles, 0) })
    m = { name: person.name, role: person.role, week: sum(wk), lifetime: sum(all), sharePercent: week.total ? Math.round((sum(wk).minutes / week.total) * 100) : 0 }
    list = all
  }
  const owner = real && real.dog.role === 'owner' && m && !m.you && m.role !== 'owner'
  const saveRole = async () => { if (busy || role === m.role) return; setBusy(true); try { await api.team.setRole(real.dog.slug, person.id, role); setData((d) => ({ ...d, member: { ...d.member, role } })); real.reload(); setToast(`${firstName(m.name)} is now: ${ROLE_LABEL[role]}`) } catch (e) { setToast(e.message) } setBusy(false) }
  const remove = async () => { setAsk({ busy: true }); const r = await real.removeMember(person.id); if (r.error) { setAsk({ busy: false, error: r.error }); return } setToast(`${firstName(m.name)} is off ${dogName}'s team`); close() }
  return (
    <div className="detail" role="dialog" aria-modal="true" aria-label={person.name}>
      <header className="dhead"><button ref={back} className="round flat" aria-label="Back" onClick={close}><Ic n="back" /></button><b>{firstName(person.name)} and {dogName}</b><span className="round flat" aria-hidden="true" /></header>
      <div className="scroll">
        {err && <div className="list"><p className="formerr" role="alert">{err}</p></div>}
        {!m && !err && <div className="list"><div className="card empty" role="status"><p>Fetching {firstName(person.name)}'s walks</p></div></div>}
        {m && <>
          <section className="hero">
            <div className="row g14"><Av t={(m.name.trim()[0] || '?').toUpperCase()} s={56} bg={person.color} c={person.ink} sq={m.role === 'daycare' || person.id === 'tails'} /><div className="grow"><div className="bigname small">{m.name}</div><div className="lightm">{real ? (m.role === 'owner' ? `${dogName}'s human` : ROLE_LABEL[m.role] || m.role) : m.role}{m.you ? ' · You' : ''}</div></div></div>
            <div className="eyebrow">LAST 7 DAYS</div>
            <div className="row g20"><Stat light l="OUTINGS" v={m.week.outings} /><Stat light l="TIME TOGETHER" v={fmtTime(m.week.minutes)} /><Stat light l="MILES" v={m.week.miles.toFixed(1)} /></div>
            <div className="eyebrow">{real ? 'ALL TIME' : 'IN THIS DEMO'}</div>
            <div className="row g20"><Stat light l="OUTINGS" v={m.lifetime.outings} /><Stat light l="TIME TOGETHER" v={fmtTime(m.lifetime.minutes)} /><Stat light l="MILES" v={m.lifetime.miles.toFixed(1)} /></div>
            <div className="meta lightm"><Ic n="heart" s={14} c="#C8F031" f="#C8F031" /> {firstName(m.name)} gave {dogName} {m.sharePercent}% of the last 7 days out and about.</div>
          </section>
          <div className="list">
            {owner && <div className="card padc"><div className="eyebrow dark">MANAGE</div>
              <div className="field lightf"><label htmlFor="person-role">Role on {dogName}'s team</label><select id="person-role" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <button className="cta small" onClick={saveRole} disabled={busy || role === m.role}>{busy ? 'Saving' : 'Change role'}</button>
              {ask ? <Confirm text={`Remove ${m.name} from ${dogName}'s team? They lose access to ${dogName}'s walks and routes. Walks they already logged stay on ${dogName}'s page.`} yes={`Remove ${firstName(m.name)}`} no="Keep" busy={ask.busy} error={ask.error} onYes={remove} onNo={() => setAsk(null)} />
                : <button className="tbtn" onClick={() => setAsk({})}>Remove {firstName(m.name)} from the team</button>}
            </div>}
            <div className="eyebrow dark padx">OUTINGS WITH {dogName.toUpperCase()}</div>
            {list.length === 0 && <div className="card empty"><b>No outings yet</b><p>{firstName(m.name)}'s walks with {dogName} will be listed here.</p></div>}
            {list.map((a) => <Card key={a.id} a={a} pawed={pawed} paw={paw} setOpen={setOpen} />)}
          </div>
        </>}
      </div>
    </div>
  )
}
