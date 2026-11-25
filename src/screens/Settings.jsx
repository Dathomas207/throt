import React, { useEffect, useRef, useState } from 'react'
import { Ic, LEVELS, ROLE_LABEL, copyText, firstName } from '../ui.jsx'
import { DogForm } from './Welcome.jsx'
import { CONNECTIONS, PEOPLE } from '../data.js'

export const PLANS = [
  { id: 'free', name: 'Free', price: '$0', items: ['One dog', 'Phone tracking', 'Feed and paws', 'Care team of up to three', 'Public dog page', 'Story cards', 'Places map'] },
  { id: 'plus', name: 'Trot Plus', price: '$4.99 a month or $39 a year', items: ['Unlimited dogs and care team', 'Lost Dog mode with AirTag link', 'Route builder and saved routes', 'Pace and split analysis', 'Heatmap', 'Recaps', 'Health timeline with vet record upload'] },
  { id: 'pro', name: 'Trot Pro', price: '$9.99 a month or $79 a year', items: ['Everything in Plus', 'Fitness tracker connections', 'All-day activity and sleep', 'Trend alerts', 'AI coach', 'Shareable vet summary'] },
]
export const planName = (id) => (PLANS.find((p) => p.id === id) || PLANS[0]).name

function Section({ title, children, id }) {
  return <section className="card padc setsec" aria-labelledby={id}><h2 className="eyebrow dark" id={id}>{title}</h2>{children}</section>
}

// One screen for the account, tracking level, connections, plans and, in the demo, the demo tools.
// `real` is set when signed in. Everything else is the demo's local state.
export default function Settings({ close, real, setToast, plan, setPlan, level, setLevel, conn, setConn, me, setMe, reset, leaveDemo, signedIn }) {
  const back = useRef(null)
  useEffect(() => { if (back.current) back.current.focus() }, [])
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') close() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [close])
  const dog = real ? real.dog : null
  const owner = !!dog && dog.role === 'owner'
  const name = dog ? dog.name : 'Biscuit'
  const cur = real ? dog.trackingLevel || 1 : level
  const [busy, setBusy] = useState('')
  const [sheet, setSheet] = useState(null)
  const [adding, setAdding] = useState(false)
  const [naming, setNaming] = useState(null)
  const pickLevel = async (n) => {
    if (n === cur || busy) return
    if (!real) { setLevel(n); setToast(`${name} is on Level ${n}: ${LEVELS[n - 1].name}`); return }
    setBusy('level'); const ok = await real.patchDog({ tracking_level: n }); setBusy('')
    if (ok) setToast(`${name} is on Level ${n}: ${LEVELS[n - 1].name}`)
  }
  const choose = (p) => { setPlan(p.id); setToast(`${p.name} noted on this device. Billing is not live yet, so nothing is charged.`) }
  const toggle = async (key, value) => { if (busy) return; setBusy(key); const ok = await real.patchDog({ [key]: value }); setBusy(''); if (ok) setToast(key === 'public' ? (value ? `${name}'s page is public` : `${name}'s page is private`) : value ? 'Route maps are shown on the public page' : 'Route maps are hidden on the public page') }
  const saveName = async (e) => {
    e.preventDefault()
    if (!naming || naming.busy) return
    const v = naming.value.replace(/\s+/g, ' ').trim()
    if (!v) { setNaming({ ...naming, error: 'Type the name you want the team to see.' }); return }
    if (v.length > 60) { setNaming({ ...naming, error: 'Keep your name to 60 characters or fewer.' }); return }
    if (v === real.user.name) { setNaming(null); return }
    setNaming({ ...naming, busy: true, error: '' })
    const r = await real.renameMe(v)
    if (r.error) { setNaming({ ...naming, busy: false, error: r.error }); return }
    setNaming(null); setToast(`You now show as ${firstName(r.user.name)}`)
  }
  const groups = [...new Set(CONNECTIONS.map((c) => c.group))]
  const path = dog ? `/d/${dog.slug}` : '', url = dog ? location.origin + path : ''
  return (
    <div className="detail" role="dialog" aria-modal="true" aria-label="Settings">
      <header className="dhead"><button ref={back} className="round flat" aria-label="Back" onClick={close}><Ic n="back" /></button><b>Settings</b><span className="round flat" aria-hidden="true" /></header>
      <div className="scroll"><div className="list">
        <Section title="ACCOUNT" id="set-account">
          {real ? <>
            {naming
              ? <form className="wform" onSubmit={saveName} noValidate>
                <div className="field lightf"><label htmlFor="set-name">Your name</label><input id="set-name" value={naming.value} onChange={(e) => setNaming({ ...naming, value: e.target.value, error: '' })} maxLength={80} autoComplete="name" autoFocus aria-invalid={naming.error ? true : undefined} aria-describedby="set-name-note" />
                  {naming.error ? <p className="ferr" id="set-name-note" role="alert">{naming.error}</p> : <p className="fhint" id="set-name-note">Your first name is what shows next to walks you log.</p>}</div>
                <div className="row g8"><button className="cta small" type="submit" disabled={naming.busy}>{naming.busy ? 'Saving' : 'Save name'}</button><button className="cta small white bordered" type="button" onClick={() => setNaming(null)} disabled={naming.busy}>Cancel</button></div>
              </form>
              : <div className="row between g8"><span className="grow yourow"><b>{real.user.name}</b><small>Signed in as {real.user.email}. Trial sign-in, no password yet.</small></span><button className="tbtn" onClick={() => setNaming({ value: real.user.name, busy: false, error: '' })}>Edit name</button></div>}
            <button className="rrow box line signout" onClick={real.signOut}><span className="grow"><b>Sign out</b><small>Signed in as {real.user.name}, on this device</small></span></button>
            <button className="rrow box line" onClick={real.toDemo}><span className="grow"><b>Open the Biscuit demo</b><small>Sample data. Your dogs stay as they are.</small></span></button>
          </> : <>
            <p className="meta">This is the Biscuit demo. There is no account here, and everything you change stays in this browser.</p>
            {leaveDemo
              ? <><button className="rrow box line signout" onClick={leaveDemo}><span className="grow"><b>Exit demo</b><small>{signedIn ? 'Back to your own dog' : 'Back to the welcome screen'}</small></span></button>
                {!signedIn && <button className="cta small" onClick={leaveDemo}>Create a real page for my dog</button>}</>
              : <p className="meta">Real pages need the Trot server, which this copy is not connected to.</p>}
          </>}
        </Section>

        {real && <Section title={`${name.toUpperCase()}'S PUBLIC PAGE`} id="set-page">
          {dog.public && <a className="rrow" href={path} target="_blank" rel="noopener"><span className="ricon"><Ic n="link" s={20} c="#1F5AE8" /></span><span className="grow"><b>Open {name}'s public page</b><small>{url.replace(/^https?:\/\//, '')}</small></span></a>}
          {dog.public && <button className="cta small white bordered" onClick={async () => setToast((await copyText(url)) ? 'Page link copied' : 'Copy did not work here.')}>Copy page link</button>}
          {owner ? <>
            <label className="switch"><input type="checkbox" checked={dog.public} disabled={busy === 'public'} onChange={(e) => toggle('public', e.target.checked)} /><span className="grow"><b>Public page</b><small>Anyone with the link sees {name}'s photo, name, breed, bio, totals, public awards and last 10 outings, with first names only.</small></span></label>
            <label className="switch"><input type="checkbox" checked={dog.shareRoutes} disabled={busy === 'share_routes' || !dog.public} onChange={(e) => toggle('share_routes', e.target.checked)} /><span className="grow"><b>Show route maps on the public page</b><small>Off by default. Route shapes can give away where {name} lives.</small></span></label>
          </> : <p className="meta">{dog.public ? 'This page is public.' : 'This page is private.'} Only {name}'s owner can change that.</p>}
        </Section>}
        {real && <Section title="YOUR DOGS" id="set-dogs">
          {real.dogs.map((d) => <button key={d.slug} className="crow" aria-pressed={d.slug === dog.slug} onClick={() => real.switchDog(d.slug)}><span className="grow"><b>{d.name}</b><small>{d.role === 'owner' ? 'You are the owner' : `You are on the team: ${ROLE_LABEL[d.role] || d.role}`}</small></span><span className={`badge ${d.slug === dog.slug ? 'on' : ''}`}>{d.slug === dog.slug ? <><Ic n="check" s={14} />Showing</> : 'Switch'}</span></button>)}
          <button className="cta small white bordered" onClick={() => setAdding(true)}><Ic n="plus" s={18} />Add another dog</button>
        </Section>}

        <Section title={`TRACKING FOR ${name.toUpperCase()}`} id="set-tracking">
          <p className="meta">Pick how {name} is tracked. Each level adds to the one before.{real && !owner ? ` Only ${name}'s owner can change it.` : ''}</p>
          <div className="lvls" role="radiogroup" aria-label={`Tracking level for ${name}`}>
            {LEVELS.map((l) => <button key={l.n} type="button" role="radio" aria-checked={cur === l.n} className={`lvlcard ${cur === l.n ? 'on' : ''}`} disabled={(real && !owner) || busy === 'level'} onClick={() => pickLevel(l.n)}>
              <span className="row between g8"><b>Level {l.n}: {l.name}</b>{cur === l.n && <span className="badge on"><Ic n="check" s={14} />Current</span>}</span>
              <small>{l.adds}</small>
            </button>)}
          </div>
        </Section>

        <Section title="CONNECTIONS" id="set-conn">
          {real
            ? <p className="meta">None of these are connected to anything real yet. They are listed so you can see what is planned. Trot will not show numbers from a device until that device is truly connected.</p>
            : <p className="meta">These are demo connections. Each one shows what the real integration will do and what it needs.</p>}
          {groups.map((g) => <div key={g} className="conngroup"><div className="sl">{g.toUpperCase()}</div>
            {CONNECTIONS.filter((c) => c.group === g).map((c) => real
              ? <div key={c.id} className="crow"><span className="grow"><b>{c.name}</b></span><span className="badge">Coming soon</span></div>
              : <button key={c.id} className="crow" onClick={() => setSheet(c)}><span className="grow"><b>{c.name}</b><small>{conn[c.id] ? 'Connected (demo)' : 'Not connected'}</small></span><span className={`badge ${conn[c.id] ? 'on' : ''}`}>{conn[c.id] ? <><Ic n="check" s={14} />On</> : 'Connect'}</span></button>)}
          </div>)}
        </Section>

        <Section title="PLANS" id="set-plans">
          <div className="row between g8"><p className="meta grow">A preview of the plans. Billing is not live, nothing is charged, and no feature is locked.</p><span className="badge on">Current: {planName(plan)}</span></div>
          {PLANS.map((p) => <div key={p.id} className={`plan ${plan === p.id ? 'on' : ''}`}>
            <div className="row between g8"><b>{p.name}</b><span className="num">{p.price}</span></div>
            <ul>{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
            {plan === p.id ? <span className="badge on self"><Ic n="check" s={14} />Your plan on this device</span> : <button className="cta small white bordered" aria-label={`Choose plan: ${p.name}`} onClick={() => choose(p)}>Choose plan</button>}
          </div>)}
        </Section>

        {!real && <Section title="DEMO TOOLS" id="set-demo">
          <div className="sl">VIEW THE APP AS</div>
          <div className="chips wrap">{['dale', 'pat', 'sue'].map((id) => <button key={id} className={`chip flat ${me === id ? 'on' : ''}`} aria-pressed={me === id} onClick={() => { setMe(id); setToast(`Now signed in as ${PEOPLE[id].name}`) }}>{PEOPLE[id].name}</button>)}</div>
          <button className="rrow box line" onClick={reset}><span className="grow"><b>Reset demo data</b><small>Clears saved walks, paws, connections, level and plan on this device</small></span></button>
        </Section>}
      </div></div>
      {sheet && <div className="scrim" onClick={() => setSheet(null)}><div className="modal" role="dialog" aria-label={sheet.name} onClick={(e) => e.stopPropagation()}>
        <div className="grab" /><h2>{sheet.name}</h2><p>{sheet.what}</p><p className="meta"><b>For real:</b> {sheet.real}</p>
        {sheet.input && <label className="field lightf"><span>{sheet.input}</span><input placeholder="https://find.apple.com/…" /></label>}
        <button className={`cta ${conn[sheet.id] ? 'white bordered' : ''}`} onClick={() => { setConn((c) => ({ ...c, [sheet.id]: !c[sheet.id] })); setToast(conn[sheet.id] ? `${sheet.name} disconnected` : `${sheet.name} connected (demo)`); setSheet(null) }}>{conn[sheet.id] ? 'Disconnect' : 'Connect (demo)'}</button>
        <button className="cta white bordered" onClick={() => setSheet(null)}>Close</button>
      </div></div>}
      {adding && <div className="scrim" onClick={() => setAdding(false)}><div className="modal" role="dialog" aria-label="Add another dog" onClick={(e) => e.stopPropagation()}>
        <div className="grab" /><h2>Add another dog</h2>
        <DogForm light submitLabel="Create the page" onDone={async (d) => { setAdding(false); try { await real.refreshMe(d.slug); setToast(`${d.name} has a page`) } catch (e) { setToast(e.message) } }} />
        <button className="cta white bordered" onClick={() => setAdding(false)}>Cancel</button>
      </div></div>}
    </div>
  )
}
