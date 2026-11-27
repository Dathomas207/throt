import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Ic, Paw, Av, DogAv, Stat, Range, Card, whoName, ptsOf, DogSwitch, Gear, Bell, TypeIc, usePhoto } from '../ui.jsx'
import { api } from '../api.js'
import { HomeAlerts } from './LostDog.jsx'
import { TodayHero, TodayTiles, TodayIdeas, TodayRoutes, useTodayRoutes } from './Today.jsx'
import WalkTimes from './WalkTimes.jsx'
import { TrainingRow } from '../training/Row.jsx'
import { FriendsRow, FriendToggle, realFriendsModel, demoFriendsModel, demoFriendActs } from './Friends.jsx'
import { CardPhotos } from './Photos.jsx'
import { ROUTES, PLACES, DOG, PEOPLE, PACK, CONNECTIONS, WEIGHTS, HEALTH, dayLabel, fmtTime, haversine, DEMO_DOGS, demoDogByName } from '../data.js'

export default function Home(props) { return props.real ? <RealHome {...props} /> : <DemoHome {...props} /> }

// Signed in: the feed and the week come from the API. No pack, streak or daily
// range here, because there is no real data behind them yet.
// An outing from another public dog. It shows what that dog's public page shows and opens that page.
function PackCard({ w, fm }) {
  const src = usePhoto(w.dog.photoUrl)
  const d = new Date(w.startedAt)
  return <article className="card"><a className="cardtop packcard" href={`/d/${w.dog.slug}`} target="_blank" rel="noopener" aria-label={`${w.dog.name}: ${w.title}. Opens ${w.dog.name}'s public page`}>
    <div className="row g10"><Av t={(w.dog.name[0] || 'D').toUpperCase()} src={src} alt="" /><div className="grow"><div className="dogname">{w.dog.name}{w.dog.isDemo && <span className="tagx">Demo dog</span>}</div><div className="meta">{w.type === 'Daycare' ? 'at' : 'with'} <b>{w.with}</b> · {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{w.place ? ` · ${w.place}` : ''}</div></div></div>
    <div className="title"><TypeIc t={w.type} />{w.title}</div>
    <CardPhotos photos={w.photos} title={w.title} />
    <div className="row g28 wraprow">{w.miles > 0 && w.type !== 'Daycare' && <Stat l="DISTANCE" v={w.miles.toFixed(1) + ' mi'} />}<Stat l="TIME" v={fmtTime(w.minutes)} />{w.maxSpeed > 0 && w.type !== 'Daycare' && <Stat l="TOP SPEED" v={w.maxSpeed.toFixed(1) + ' mph'} />}</div>
    {w.note && <p className="note">{w.note}</p>}
  </a>{fm && fm.canManage && <div className="packfoot"><FriendToggle m={fm} d={w.dog} /></div>}</article>
}
const CompeteCard = ({ open, name }) => <button className="rrow box competecard" onClick={() => open('boards')}><span className="ricon"><Ic n="trophy" s={20} c="#1F5AE8" /></span><span className="grow"><b>Compete</b><small>Leaderboards, challenges and events for {name}</small></span></button>

function RealHome({ real, acts, pawed, paw, setOpen, setTab, setToast, openSettings, openCompete, onDog, unread, openNotifications }) {
  const { dog, dogs, totals, user } = real
  const many = dogs.length > 1
  const [pack, setPack] = useState(null)
  const scope = real.scope
  useEffect(() => { if (scope === 'pack' && !pack) api.boards.pack().then((r) => setPack(r.walks), () => setPack([])) }, [scope])
  const fm = realFriendsModel(real, setToast)
  // The friends feed is fetched when its tab opens, and again whenever a friend is added or removed.
  const [ff, setFf] = useState(null)
  useEffect(() => {
    if (scope !== 'friends') return
    let on = true
    setFf(null)
    api.friends.feed(dog.slug).then((r) => on && setFf(r.walks), () => on && setFf([]))
    return () => { on = false }
  }, [scope, dog.slug, real.friends.rev])
  const tr = useTodayRoutes({ account: true, dogKey: dog.slug, name: dog.name, setTab, setToast })
  const usual = tr.usual && { name: tr.usual.name, miles: tr.usual.miles, onStart: () => tr.startRoute(tr.usual) }
  // The newest outing photo of this dog, for the banner behind the greeting.
  const banner = (real.dogActs.find((a) => a.photos && a.photos.length) || { photos: [] }).photos[0]
  return (
    <div className="scroll">
      <header className="top"><div className="logo">TROT</div><div className="row g8"><div className="meta">Signed in as {user.name}</div><Bell n={unread} onClick={openNotifications} /><Gear onClick={openSettings} /></div></header>
      <DogSwitch dogs={dogs} active={dog.slug} onPick={real.switchDog} />
      <HomeAlerts real={real} setToast={setToast} />
      <TodayHero name={dog.name} photoUrl={dog.photoUrl} banner={banner} usual={usual} onWalk={() => setTab('record')} onDog={() => setTab('dog')} status={totals.week.outings > 0 ? `${totals.week.outings} ${totals.week.outings === 1 ? 'outing' : 'outings'} and ${totals.week.miles.toFixed(1)} miles in the last 7 days` : 'No outings in the last 7 days yet'} />
      <WalkTimes name={dog.name} onWalk={() => setTab('record')} />
      <TodayRoutes t={tr} />
      <TodayTiles name={dog.name} setTab={setTab} openCompete={openCompete} plan={tr.build} />
      <TrainingRow real={real} />
      <FriendsRow m={fm} />
      <TodayIdeas name={dog.name} setTab={setTab} openCompete={openCompete} />
      <div className="tjournal"><h2>{dog.name}'s days</h2></div>
      <div className={`seg ${many ? 'four' : ''}`} role="tablist"><button role="tab" aria-selected={scope === 'dog'} className={scope === 'dog' ? 'on' : ''} onClick={() => real.setScope('dog')}>{dog.name}</button>{many && <button role="tab" aria-selected={scope === 'all'} className={scope === 'all' ? 'on' : ''} onClick={() => real.setScope('all')}>{'All my dogs'}</button>}<button role="tab" aria-selected={scope === 'friends'} className={scope === 'friends' ? 'on' : ''} onClick={() => real.setScope('friends')}>Friends</button><button role="tab" aria-selected={scope === 'pack'} className={scope === 'pack' ? 'on' : ''} onClick={() => real.setScope('pack')}>The pack</button></div>
      {scope === 'pack' ? <div className="list">
        <p className="meta padx">Recent outings from other public dogs on Trot. Demo dogs are made up and labelled.</p>
        {!pack && <div className="card empty" role="status"><p>Fetching the pack</p></div>}
        {pack && pack.length === 0 && <div className="card empty"><b>Nobody else yet</b><p>Outings from other public dogs will show up here.</p></div>}
        {pack && pack.map((w) => <PackCard key={w.id} w={w} fm={fm} />)}
      </div> : scope === 'friends' ? <div className="list">
        <p className="meta padx">Recent outings from {dog.name}'s friends. Only what each dog's public page shows.</p>
        {!ff && <div className="card empty" role="status"><p>Fetching friends' outings</p></div>}
        {ff && ff.length === 0 && <div className="card empty"><b>{fm.friends.length ? 'Nothing from friends yet' : `${dog.name} has no friends yet`}</b><p>{fm.friends.length ? `When ${dog.name}'s friends go out, their outings show up here.` : 'Find dogs by name, pick from dogs nearby, or send an invite link.'}</p><button className="cta small" onClick={fm.open}>Find friends</button></div>}
        {ff && ff.map((w) => <PackCard key={w.id} w={w} fm={fm} />)}
      </div> : <div className="list">
        {acts.length === 0 && <div className="card empty"><b>No outings yet</b><p>{dog.name}'s first walk will show up here. Tap Walk {dog.name} to record one.</p></div>}
        {acts.map((a) => <Card key={a.id} a={a} pawed={pawed} paw={paw} setOpen={setOpen} onDog={onDog} />)}
        {real.hasMore && <button className="cta white bordered" onClick={real.more} disabled={real.loadingMore}>{real.loadingMore ? 'Loading' : 'Show older outings'}</button>}
      </div>}
    </div>
  )
}

const DemoSwitch = ({ dd, setDk }) => <div className="dogswitch" role="group" aria-label="Switch dog">{Object.values(DEMO_DOGS).map((d) => <button key={d.key} className={`chip flat ${d.key === dd.key ? 'on' : ''}`} aria-pressed={d.key === dd.key} onClick={() => setDk(d.key)}>{d.dog.name}</button>)}</div>

function DemoHome({ acts, week, todayMin, pawed, paw, setOpen, setTab, setToast, me, openSettings, openCompete, openFriends, dd, setDk, onDog, hasApi, unread, openNotifications }) {
  const [feed, setFeed] = useState('biscuit')
  const D = dd.dog
  const fm = demoFriendsModel(dd, { setToast, onDog, open: openFriends })
  const banner = (acts.find((a) => a.photos && a.photos.length) || { photos: [] }).photos[0]
  const tr = useTodayRoutes({ account: false, dogKey: D.name, name: D.name, acts, setTab, setToast })
  const usual = tr.usual && { name: tr.usual.name, miles: tr.usual.miles, onStart: () => tr.startRoute(tr.usual) }
  // Dale's own dogs are never in "the pack".
  const list = feed === 'biscuit' ? acts : feed === 'friends' ? demoFriendActs(dd) : [...PACK.filter((x) => !demoDogByName(x.dog)), ...acts].sort((a, b) => a.daysAgo - b.daysAgo)
  return (
    <div className="scroll">
      <header className="top"><div className="logo">TROT</div><div className="row g8"><div className="meta">Demo, viewing as {PEOPLE[me].name}</div><Bell n={unread} onClick={openNotifications} /><Gear onClick={openSettings} /></div></header>
      <DemoSwitch dd={dd} setDk={setDk} />
      <TodayHero name={D.name} demo banner={banner} usual={usual} onWalk={() => setTab('record')} onDog={() => setTab('dog')} status={`${week.walks} outings and ${week.miles.toFixed(1)} miles this week · ${D.streak} day streak`}><Range min={todayMin} light dog={D} /></TodayHero>
      <WalkTimes name={D.name} hasApi={hasApi} onWalk={() => setTab('record')} />
      <TodayRoutes t={tr} />
      <TodayTiles name={D.name} setTab={setTab} openCompete={openCompete} plan={tr.build} />
      <TrainingRow dd={dd} />
      <FriendsRow m={fm} />
      <TodayIdeas name={D.name} setTab={setTab} openCompete={openCompete} hasApi={hasApi} />
      <div className="tjournal"><h2>{D.name}'s days</h2></div>
      <div className="seg" role="tablist"><button role="tab" aria-selected={feed === 'biscuit'} className={feed === 'biscuit' ? 'on' : ''} onClick={() => setFeed('biscuit')}>{D.name}</button><button role="tab" aria-selected={feed === 'friends'} className={feed === 'friends' ? 'on' : ''} onClick={() => setFeed('friends')}>Friends</button><button role="tab" aria-selected={feed === 'pack'} className={feed === 'pack' ? 'on' : ''} onClick={() => setFeed('pack')}>The pack</button></div>
      <div className="list">{feed === 'friends' && <p className="meta padx">Sample outings from {D.name}'s friends.</p>}{list.map((a) => <Card key={a.id} a={a} pawed={pawed} paw={paw} setOpen={setOpen} onDog={onDog} />)}</div>
    </div>
  )
}
