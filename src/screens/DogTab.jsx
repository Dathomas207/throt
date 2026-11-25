import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Ic, Paw, Av, DogAv, Stat, Range, Card, whoName, ptsOf, DogSwitch, daysAgoOf, ROLE_LABEL, copyText } from '../ui.jsx'
import EditDog from './EditDog.jsx'
import { DogForm } from './Welcome.jsx'
import { ROUTES, PLACES, DOG, PEOPLE, PACK, CONNECTIONS, WEIGHTS, HEALTH, dayLabel, fmtTime, haversine } from '../data.js'

export default function DogTab(props) { return props.real ? <RealDogTab {...props} /> : <DemoDogTab {...props} /> }

// Signed in: profile, totals and walks from the API. Health, followers and streak
// have no real data yet, so they are left out or shown as empty.
function RealDogTab({ real, pawed, paw, setOpen, setToast }) {
  const { dog, dogs, totals, weekWalks, dogActs, user } = real
  const [sub, setSub] = useState('Activity')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState('')
  const owner = dog.role === 'owner'
  const days = [...Array(7)].map((_, i) => { const d = 6 - i; return { d, min: weekWalks.filter((w) => daysAgoOf(w.startedAt) === d && w.type !== 'Daycare').reduce((s, w) => s + w.minutes, 0), l: new Date(Date.now() - d * 864e5).toLocaleDateString('en-US', { weekday: 'narrow' }) } })
  const max = Math.max(...days.map((d) => d.min), 1)
  const path = `/d/${dog.slug}`
  const url = location.origin + path
  const facts = [dog.breed, dog.age, dog.weight ? `${dog.weight} lb` : ''].filter(Boolean).join(' · ')
  const toggle = async (key, value) => { if (busy) return; setBusy(key); const ok = await real.patchDog({ [key]: value }); setBusy(''); if (ok) setToast(key === 'public' ? (value ? `${dog.name}'s page is public` : `${dog.name}'s page is private`) : value ? 'Route maps are shown on the public page' : 'Route maps are hidden on the public page') }
  return (
    <div className="scroll">
      <section className="prof">
        <div className="row g16"><DogAv name={dog.name} photoUrl={dog.photoUrl} s={92} ring bg="#2A3A52" c="#C8F031" /><div className="grow"><div className="bigname">{dog.name.toUpperCase()}</div>{facts && <div className="lightm">{facts}</div>}</div></div>
        {dog.bio && <p className="lightm bio">{dog.bio}</p>}
        {owner && <button className="cta small editbtn" onClick={() => setEditing(true)}>Edit profile</button>}
        <div className="row g20"><Stat light l="LIFETIME" v={totals.lifetime.miles.toFixed(1) + ' mi'} big={20} /><Stat light l="OUTINGS" v={totals.lifetime.outings} big={20} /><Stat light l="LAST 7 DAYS" v={totals.week.miles.toFixed(1) + ' mi'} big={20} /></div>
        {dog.public
          ? <a className="publink" href={path} target="_blank" rel="noopener"><Ic n="link" s={18} c="#C8F031" /><span className="grow"><b>{dog.name}'s public page</b><small>{url.replace(/^https?:\/\//, '')}</small></span></a>
          : <div className="publink off"><Ic n="link" s={18} c="#AEB7C4" /><span className="grow"><b>{dog.name}'s page is private</b><small>{owner ? 'Turn it on in Settings to share it' : 'Only the care team can see it'}</small></span></div>}
      </section>
      <div className="subtabs" role="tablist">{['Activity', 'Health', 'Settings'].map((t) => <button key={t} role="tab" aria-selected={sub === t} className={sub === t ? 'on' : ''} onClick={() => setSub(t)}>{t}</button>)}</div>
      {sub === 'Activity' && <div className="list">
        <div className="card padc"><div className="row between"><b>Last 7 days</b><span className="meta">{totals.week.miles.toFixed(1)} mi · {totals.week.outings} {totals.week.outings === 1 ? 'outing' : 'outings'}</span></div><div className="bars">{days.map((d) => <div key={d.d}><i style={{ height: Math.max(4, (d.min / max) * 70), background: d.d === 0 ? '#1F5AE8' : '#C6D4F7' }} /><span>{d.l}</span></div>)}</div></div>
        {dogActs.length === 0 && <div className="card empty"><b>No outings yet</b><p>{dog.name}'s walks will be listed here.</p></div>}
        {dogActs.map((a) => <Card key={a.id} a={a} pawed={pawed} paw={paw} setOpen={setOpen} />)}
      </div>}
      {sub === 'Health' && <div className="list">
        <div className="card empty"><b>No health records yet</b><p>Weight history, vaccines and a daily activity range are not part of this trial. Nothing is shown here until there is real data for {dog.name}.</p></div>
      </div>}
      {sub === 'Settings' && <div className="list">
        <div className="card padc"><div className="eyebrow dark">PUBLIC PAGE</div>
          {dog.public && <a className="rrow" href={path} target="_blank" rel="noopener"><span className="ricon"><Ic n="link" s={20} c="#1F5AE8" /></span><span className="grow"><b>Open {dog.name}'s public page</b><small>{url.replace(/^https?:\/\//, '')}</small></span></a>}
          {dog.public && <button className="cta small white bordered" onClick={async () => setToast((await copyText(url)) ? 'Page link copied' : 'Copy did not work here.')}>Copy page link</button>}
          {owner ? <>
            <label className="switch"><input type="checkbox" checked={dog.public} disabled={busy === 'public'} onChange={(e) => toggle('public', e.target.checked)} /><span className="grow"><b>Public page</b><small>Anyone with the link sees {dog.name}'s photo, name, breed, bio, totals and last 10 outings, with first names only.</small></span></label>
            <label className="switch"><input type="checkbox" checked={dog.shareRoutes} disabled={busy === 'share_routes' || !dog.public} onChange={(e) => toggle('share_routes', e.target.checked)} /><span className="grow"><b>Show route maps on the public page</b><small>Off by default. Route shapes can give away where {dog.name} lives.</small></span></label>
          </> : <p className="meta">{dog.public ? 'This page is public.' : 'This page is private.'} Only {dog.name}'s owner can change that.</p>}
        </div>
        <div className="card padc"><div className="eyebrow dark">YOUR DOGS</div>
          {dogs.map((d) => <button key={d.slug} className="crow" aria-pressed={d.slug === dog.slug} onClick={() => real.switchDog(d.slug)}><span className="grow"><b>{d.name}</b><small>{d.role === 'owner' ? 'You are the owner' : `You are on the team: ${ROLE_LABEL[d.role] || d.role}`}</small></span><span className={`badge ${d.slug === dog.slug ? 'on' : ''}`}>{d.slug === dog.slug ? <><Ic n="check" s={14} />Showing</> : 'Switch'}</span></button>)}
          <button className="cta small white bordered" onClick={() => setAdding(true)}><Ic n="plus" s={18} />Add another dog</button>
        </div>
        <div className="card padc"><div className="eyebrow dark">ACCOUNT</div>
          <p className="meta">Signed in as <b>{user.name}</b> ({user.email}). Trial sign-in. No password yet.</p>
          <button className="rrow box line" onClick={real.toDemo}><span className="grow"><b>Open the Biscuit demo</b><small>Sample data. Your dogs stay as they are.</small></span></button>
          <button className="rrow box line" onClick={real.signOut}><span className="grow"><b>Sign out</b><small>On this device</small></span></button>
        </div>
      </div>}
      {editing && owner && <EditDog dog={dog} onClose={() => setEditing(false)} onSave={async (body) => { const r = await real.saveProfile(body); if (!r.error) { setEditing(false); setToast(`${r.dog.name}'s profile is saved`) } return r }} />}
      {adding && <div className="scrim" onClick={() => setAdding(false)}><div className="modal" role="dialog" aria-label="Add another dog" onClick={(e) => e.stopPropagation()}>
        <div className="grab" /><h2>Add another dog</h2>
        <DogForm light submitLabel="Create the page" onDone={async (d) => { setAdding(false); try { await real.refreshMe(d.slug); setToast(`${d.name} has a page`) } catch (e) { setToast(e.message) } }} />
        <button className="cta white bordered" onClick={() => setAdding(false)}>Cancel</button>
      </div></div>}
    </div>
  )
}

function DemoDogTab({ acts, week, todayMin, pawed, paw, setOpen, conn, setConn, setToast, reset, leaveDemo, signedIn }) {
  const [sub, setSub] = useState('Activity')
  const [sheet, setSheet] = useState(null)
  const [vet, setVet] = useState(false)
  const days = [...Array(7)].map((_, i) => { const d = 6 - i; return { d, min: acts.filter((a) => a.daysAgo === d && a.type !== 'Daycare').reduce((s, a) => s + a.minutes, 0), l: new Date(Date.now() - d * 864e5).toLocaleDateString('en-US', { weekday: 'narrow' }) } })
  const max = Math.max(...days.map((d) => d.min), 1)
  const lo = Math.min(...WEIGHTS.map((w) => w[1])) - 0.5, hi = Math.max(...WEIGHTS.map((w) => w[1])) + 0.5
  const groups = [...new Set(CONNECTIONS.map((c) => c.group))]
  return (
    <div className="scroll">
      <section className="prof">
        <div className="row g16"><DogAv name="Biscuit" demo s={92} ring /><div className="grow"><div className="bigname">BISCUIT</div><div className="lightm">{DOG.breed} · {DOG.age} · {DOG.weight} lb</div><div className="lightm">{DOG.home}</div></div></div>
        <p className="lightm bio">{DOG.bio}</p>
        <div className="row g20"><Stat light l="FOLLOWERS" v={DOG.followers} big={20} /><Stat light l="LIFETIME" v={DOG.lifetime.toLocaleString() + ' mi'} big={20} /><Stat light l="STREAK" v={DOG.streak + ' d'} big={20} /></div>
      </section>
      <div className="subtabs" role="tablist">{['Activity', 'Health', 'Connections'].map((t) => <button key={t} role="tab" aria-selected={sub === t} className={sub === t ? 'on' : ''} onClick={() => setSub(t)}>{t}</button>)}</div>
      {sub === 'Activity' && <div className="list">
        <div className="card padc"><div className="row between"><b>This week</b><span className="meta">{week.miles.toFixed(1)} mi · {week.walks} outings</span></div><div className="bars">{days.map((d) => <div key={d.d}><i style={{ height: Math.max(4, (d.min / max) * 70), background: d.d === 0 ? '#1F5AE8' : '#C6D4F7' }} /><span>{d.l}</span></div>)}</div></div>
        {acts.map((a) => <Card key={a.id} a={a} pawed={pawed} paw={paw} setOpen={setOpen} />)}
      </div>}
      {sub === 'Health' && <div className="list">
        <div className="card padc"><Range min={todayMin} /><p className="meta">Range is a sample set from breed, age and weight. It is not veterinary advice.</p></div>
        <div className="card padc"><div className="row between"><b>Weight</b><span className="num">{DOG.weight} lb</span></div>
          <svg viewBox="0 0 320 90" className="chart" role="img" aria-label="Weight over six months, down from 70.1 to 68.0 pounds"><polyline fill="none" stroke="#1F5AE8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={WEIGHTS.map((w, i) => `${20 + i * 56},${12 + (1 - (w[1] - lo) / (hi - lo)) * 50}`).join(' ')} />{WEIGHTS.map((w, i) => <g key={w[0]}><circle cx={20 + i * 56} cy={12 + (1 - (w[1] - lo) / (hi - lo)) * 50} r="4" fill="#fff" stroke="#1F5AE8" strokeWidth="2.500" /><text x={20 + i * 56} y="86" textAnchor="middle" fontSize="11" fill="#5B6472">{w[0]}</text></g>)}</svg>
          <p className="meta">Down 2.1 lb since June, on track for the target the vet set.</p></div>
        <div className="card padc"><b>Care timeline</b>{[...(vet ? [{ t: 'Uploaded record: wellness visit', d: 'Just now · weight 68.0 lb, 2 vaccines read (sample)', ok: true }] : []), ...HEALTH].map((h) => <div key={h.t} className="hrow"><span className={`dot ${h.ok ? '' : 'warn'}`} /><div className="grow"><div className="hb">{h.t}</div><div className="meta">{h.d}</div></div></div>)}
          <label className="upload"><Ic n="plus" s={18} />Upload a vet record<input type="file" accept=".pdf,image/*" onChange={() => { setVet(true); setToast('Sample record added. Real extraction comes later.') }} /></label></div>
      </div>}
      {sub === 'Connections' && <div className="list">
        <p className="meta padx">These are demo connections. Each one shows what the real integration will do and what it needs.</p>
        {groups.map((g) => <div key={g} className="card padc"><div className="eyebrow dark">{g.toUpperCase()}</div>{CONNECTIONS.filter((c) => c.group === g).map((c) => <button key={c.id} className="crow" onClick={() => setSheet(c)}><span className="grow"><b>{c.name}</b><small>{conn[c.id] ? 'Connected (demo)' : 'Not connected'}</small></span><span className={`badge ${conn[c.id] ? 'on' : ''}`}>{conn[c.id] ? <><Ic n="check" s={14} />On</> : 'Connect'}</span></button>)}</div>)}
        <button className="rrow box" onClick={reset}><span className="grow"><b>Reset demo data</b><small>Clears saved walks, paws and connections on this device</small></span></button>
        {leaveDemo && <button className="rrow box" onClick={leaveDemo}><span className="grow"><b>{signedIn ? 'Back to my dog' : 'Create my dog\'s page'}</b><small>{signedIn ? 'Leave the Biscuit demo' : 'Leave the demo and set up a real page for your dog'}</small></span></button>}
      </div>}
      {sheet && <div className="scrim" onClick={() => setSheet(null)}><div className="modal" role="dialog" aria-label={sheet.name} onClick={(e) => e.stopPropagation()}>
        <div className="grab" /><h2>{sheet.name}</h2><p>{sheet.what}</p><p className="meta"><b>For real:</b> {sheet.real}</p>
        {sheet.input && <label className="field lightf"><span>{sheet.input}</span><input placeholder="https://find.apple.com/…" /></label>}
        <button className={`cta ${conn[sheet.id] ? 'white bordered' : ''}`} onClick={() => { setConn((c) => ({ ...c, [sheet.id]: !c[sheet.id] })); setToast(conn[sheet.id] ? `${sheet.name} disconnected` : `${sheet.name} connected (demo)`); setSheet(null) }}>{conn[sheet.id] ? 'Disconnect' : 'Connect (demo)'}</button>
      </div></div>}
    </div>
  )
}
