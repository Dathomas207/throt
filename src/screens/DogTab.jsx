import React, { useState } from 'react'
import { Ic, DogAv, Stat, Card, daysAgoOf, Gear, LevelBadge, TypeIc } from '../ui.jsx'
import EditDog from './EditDog.jsx'
import { RealHealth, DemoHealth } from './Health.jsx'
import { RealDocuments, DemoDocuments } from './Documents.jsx'
import { RealAwards, DemoAwards } from './Awards.jsx'
import { DogId, DemoDogId } from './Registration.jsx'
import { DEMO_DOGS } from '../data.js'

export default function DogTab(props) { return props.real ? <RealDogTab {...props} /> : <DemoDogTab {...props} /> }

const TABS = ['Activity', 'Health', 'Documents']
const Subtabs = ({ sub, setSub }) => <div className="subtabs" role="tablist">{TABS.map((t) => <button key={t} role="tab" aria-selected={sub === t} className={sub === t ? 'on' : ''} onClick={() => setSub(t)}>{t}</button>)}</div>
// Chips for the activity types this dog actually has, so a filter never leads to an empty list.
function TypeFilter({ acts, type, setType }) {
  const types = [...new Set(acts.map((a) => a.type))]
  if (types.length < 2) return null
  return <div className="chips typefilter" role="group" aria-label="Filter by activity type"><button className={`chip flat ${type === '' ? 'on' : ''}`} aria-pressed={type === ''} onClick={() => setType('')}>All</button>{types.map((t) => <button key={t} className={`chip flat ${type === t ? 'on' : ''}`} aria-pressed={type === t} onClick={() => setType(t)}><TypeIc t={t} s={16} c={type === t ? '#fff' : '#0F1B2D'} />{t}</button>)}</div>
}
function WeekBars({ days, title, meta }) {
  const max = Math.max(...days.map((d) => d.min), 1)
  return <div className="card padc"><div className="row between"><b>{title}</b><span className="meta">{meta}</span></div><div className="bars" role="img" aria-label={`Minutes out each day: ${days.map((d) => `${d.name} ${Math.round(d.min)}`).join(', ')}`}>{days.map((d) => <div key={d.d}><i style={{ height: Math.max(4, (d.min / max) * 70), background: d.d === 0 ? '#1F5AE8' : '#C6D4F7' }} /><span>{d.l}</span></div>)}</div></div>
}
const dayOf = (d) => ({ l: new Date(Date.now() - d * 864e5).toLocaleDateString('en-US', { weekday: 'narrow' }), name: new Date(Date.now() - d * 864e5).toLocaleDateString('en-US', { weekday: 'long' }) })

// Signed in: profile, totals, walks, health records, documents and awards from the API.
function RealDogTab({ real, pawed, paw, setOpen, setToast, openSettings, regNonce }) {
  const { dog, totals, weekWalks, dogActs } = real
  const [sub, setSub] = useState('Activity')
  const [editing, setEditing] = useState(false)
  const [type, setType] = useState('')
  const owner = dog.role === 'owner'
  const days = [...Array(7)].map((_, i) => { const d = 6 - i; return { d, ...dayOf(d), min: weekWalks.filter((w) => daysAgoOf(w.startedAt) === d && w.type !== 'Daycare').reduce((s, w) => s + w.minutes, 0) } })
  const path = `/d/${dog.slug}`
  const url = location.origin + path
  const facts = [dog.breed, dog.age, dog.weight ? `${dog.weight} lb` : '', dog.city].filter(Boolean).join(' · ')
  const shown = type && dogActs.some((a) => a.type === type) ? dogActs.filter((a) => a.type === type) : dogActs
  return (
    <div className="scroll">
      <section className="prof">
        <div className="row g16 top"><DogAv name={dog.name} photoUrl={dog.photoUrl} s={92} ring bg="#2A3A52" c="#C8F031" /><div className="grow"><div className="bigname">{dog.name.toUpperCase()}</div>{facts && <div className="lightm">{facts}</div>}<LevelBadge n={dog.trackingLevel} /></div><Gear light onClick={openSettings} /></div>
        {dog.bio && <p className="lightm bio">{dog.bio}</p>}
        {owner && <button className="cta small editbtn" onClick={() => setEditing(true)}>Edit profile</button>}
        <div className="row g20"><Stat light l="LIFETIME" v={totals.lifetime.miles.toFixed(1) + ' mi'} big={20} /><Stat light l="OUTINGS" v={totals.lifetime.outings} big={20} /><Stat light l="LAST 7 DAYS" v={totals.week.miles.toFixed(1) + ' mi'} big={20} /></div>
        {dog.public
          ? <a className="publink" href={path} target="_blank" rel="noopener"><Ic n="link" s={18} c="#C8F031" /><span className="grow"><b>{dog.name}'s public page</b><small>{url.replace(/^https?:\/\//, '')}</small></span></a>
          : <button className="publink off" onClick={openSettings}><Ic n="link" s={18} c="#AEB7C4" /><span className="grow"><b>{dog.name}'s page is private</b><small>{owner ? 'Turn it on in Settings to share it' : 'Only the care team can see it'}</small></span></button>}
      </section>
      <DogId real={real} setToast={setToast} autoOpen={regNonce} />
      <Subtabs sub={sub} setSub={setSub} />
      {sub === 'Activity' && <div className="list">
        <WeekBars days={days} title="Last 7 days" meta={`${totals.week.miles.toFixed(1)} mi · ${totals.week.outings} ${totals.week.outings === 1 ? 'outing' : 'outings'}`} />
        <RealAwards real={real} setToast={setToast} />
        <TypeFilter acts={dogActs} type={type} setType={setType} />
        {dogActs.length === 0 && <div className="card empty"><b>No outings yet</b><p>{dog.name}'s walks will be listed here.</p></div>}
        {shown.map((a) => <Card key={a.id} a={a} pawed={pawed} paw={paw} setOpen={setOpen} />)}
      </div>}
      {sub === 'Health' && <RealHealth real={real} setToast={setToast} />}
      {sub === 'Documents' && <RealDocuments real={real} setToast={setToast} />}
      {editing && owner && <EditDog dog={dog} onClose={() => setEditing(false)} onSave={async (body) => { const r = await real.saveProfile(body); if (!r.error) { setEditing(false); setToast(`${r.dog.name}'s profile is saved`) } return r }} />}
    </div>
  )
}

function DemoDogTab({ acts, week, todayMin, pawed, paw, setOpen, setToast, openSettings, level, dd, setDk }) {
  const DOG = dd.dog
  const [sub, setSub] = useState('Activity')
  const [type, setType] = useState('')
  const days = [...Array(7)].map((_, i) => { const d = 6 - i; return { d, ...dayOf(d), min: acts.filter((a) => a.daysAgo === d && a.type !== 'Daycare').reduce((s, a) => s + a.minutes, 0) } })
  const shown = type && acts.some((a) => a.type === type) ? acts.filter((a) => a.type === type) : acts
  return (
    <div className="scroll">
      <section className="prof">
        <div className="dogswitch inprof" role="group" aria-label="Switch dog">{Object.values(DEMO_DOGS).map((d) => <button key={d.key} className={`chip flat ${d.key === dd.key ? 'on' : ''}`} aria-pressed={d.key === dd.key} onClick={() => setDk(d.key)}>{d.dog.name}</button>)}</div>
        <div className="row g16 top"><DogAv name={DOG.name} demo s={92} ring /><div className="grow"><div className="bigname">{DOG.name.toUpperCase()}</div><div className="lightm">{DOG.breed} · {DOG.age} · {DOG.weight} lb</div><div className="lightm">{DOG.home}</div><LevelBadge n={level} /></div><Gear light onClick={openSettings} /></div>
        <p className="lightm bio">{DOG.bio}</p>
        <div className="row g20"><Stat light l="FOLLOWERS" v={DOG.followers} big={20} /><Stat light l="LIFETIME" v={DOG.lifetime.toLocaleString() + ' mi'} big={20} /><Stat light l="STREAK" v={DOG.streak + ' d'} big={20} /></div>
      </section>
      <DemoDogId dd={dd} setToast={setToast} />
      <Subtabs sub={sub} setSub={setSub} />
      {sub === 'Activity' && <div className="list">
        <WeekBars days={days} title="This week" meta={`${week.miles.toFixed(1)} mi · ${week.walks} outings`} />
        <DemoAwards acts={acts} dd={dd} />
        <TypeFilter acts={acts} type={type} setType={setType} />
        {shown.map((a) => <Card key={a.id} a={a} pawed={pawed} paw={paw} setOpen={setOpen} />)}
      </div>}
      {sub === 'Health' && <DemoHealth acts={acts} todayMin={todayMin} level={level} setToast={setToast} dd={dd} />}
      {sub === 'Documents' && <DemoDocuments dd={dd} />}
    </div>
  )
}
