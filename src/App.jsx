import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Ic, Paw, Av, DogAv, RangeOff, toAct } from './ui.jsx'
import { PEOPLE, SEED, CONNECTIONS, ACTIVITY_TYPES, DEMO_DOGS, demoDogByName } from './data.js'
import DemoDogSheet from './screens/DemoDogSheet.jsx'
import { api, probe, hasToken, setAuthLost, signOut, takeInviteFromUrl, pendingInvite, primePhoto } from './api.js'
import Home from './screens/Home.jsx'
import Explore from './screens/Explore.jsx'
import Record from './screens/Record.jsx'
import People from './screens/People.jsx'
import DogTab from './screens/DogTab.jsx'
import Detail from './screens/Detail.jsx'
import Welcome, { acceptPendingInvite } from './screens/Welcome.jsx'
import Settings from './screens/Settings.jsx'
import Compete from './screens/Compete.jsx'

const PLAN = 'trot-plan'

const KEY = 'trot-demo-v1'
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch (e) { return {} } }
const MODE = 'trot-mode', DOGKEY = 'trot-dog'
const getLS = (k) => { try { return localStorage.getItem(k) } catch (e) { return null } }
const setLS = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch (e) {} }
const WALK_TYPES = ACTIVITY_TYPES.map((t) => t.id)

// Decides between three paths:
//   demo    the seeded Biscuit demo. The only path when no API is reachable.
//   welcome first load with an API: try the demo or create a dog's page.
//   real    signed in, every screen driven by the API.
export default function App() {
  const [phase, setPhase] = useState('boot')
  const [hasApi, setHasApi] = useState(false)
  const [me, setMe] = useState(null)
  const [slug, setSlug] = useState(null)
  const [notice, setNotice] = useState('')

  const enter = useCallback((m, pick, note) => {
    setMe(m)
    const want = pick || getLS(DOGKEY)
    const s = m.dogs.find((d) => d.slug === want) ? want : m.dogs[0] && m.dogs[0].slug
    setSlug(s || null); setLS(DOGKEY, s || null); setLS(MODE, null)
    setNotice(note || '')
    setPhase(m.dogs.length ? 'real' : 'welcome')
  }, [])

  useEffect(() => {
    let on = true
    ;(async () => {
      const invite = takeInviteFromUrl()
      const ok = await probe()
      if (!on) return
      if (!ok) { setPhase('demo'); return }
      setHasApi(true)
      setAuthLost(() => { setMe(null); setNotice('Your session ended. Sign in again.'); setPhase('welcome') })
      if (hasToken()) {
        try {
          const joined = await acceptPendingInvite()
          const m = await api.get('/me')
          if (on) enter(m, joined.slug, joined.error)
          return
        } catch (e) {
          if (!on) return
          if (e.status !== 401) { setNotice(e.message); setPhase('welcome'); return }
        }
      }
      setPhase(!invite && getLS(MODE) === 'demo' ? 'demo' : 'welcome')
    })()
    return () => { on = false }
  }, [enter])

  const toDemo = () => { setLS(MODE, 'demo'); setPhase('demo') }
  const toWelcome = () => { setLS(MODE, null); setNotice(''); setPhase(me && me.dogs.length ? 'real' : 'welcome') }
  const out = async () => { await signOut(); setMe(null); setSlug(null); setLS(DOGKEY, null); setNotice(''); setPhase('welcome') }

  if (phase === 'boot') return <div className="shell"><div className="welcome splash" role="status" aria-label="Loading Trot"><div className="wlogo">TROT</div></div></div>
  if (phase === 'welcome') return <div className="shell"><main className="screen"><Welcome user={me} notice={notice} onDemo={toDemo} onReady={enter} /></main></div>
  if (phase === 'real' && me && slug) return <RealApp key={me.user.id} me={me} setMe={setMe} slug={slug} pickDog={(s) => { setSlug(s); setLS(DOGKEY, s) }} notice={notice} signOut={out} toDemo={toDemo} />
  return <DemoApp leaveDemo={hasApi ? toWelcome : null} signedIn={!!(me && me.dogs.length)} hasApi={hasApi} />
}

// ---- the Biscuit demo: seeded data, state in localStorage, no backend ---------
function DemoApp({ leaveDemo, signedIn, hasApi }) {
  const saved = useMemo(load, [])
  const [tab, setTab] = useState('home')
  const [me, setMe] = useState(saved.me || 'dale')
  const [mine, setMine] = useState(saved.mine || [])
  const [pawed, setPawed] = useState(saved.pawed || {})
  const [conn, setConn] = useState(saved.conn || Object.fromEntries(CONNECTIONS.map((c) => [c.id, !!c.on])))
  const [open, setOpen] = useState(null)
  const [toast, setToast] = useState('')
  const [dk, setDk] = useState(DEMO_DOGS[saved.dk] ? saved.dk : 'biscuit')
  const dd = DEMO_DOGS[dk]
  // The demo's tracking level and plan choice live in this browser only.
  const [level, setLevel] = useState([1, 2, 3].includes(saved.level) ? saved.level : 1)
  const [plan, setPlanState] = useState(getLS(PLAN) || 'free')
  const setPlan = (p) => { setPlanState(p); setLS(PLAN, p) }
  const [settings, setSettings] = useState(false)
  const [compete, setCompete] = useState(null)
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ me, mine, pawed, conn, level, dk })) } catch (e) {} }, [me, mine, pawed, conn, level, dk])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t) }, [toast])
  // The demo has two dogs, Biscuit and Millie. Every screen shows the selected one.
  const [sheetDog, setSheetDog] = useState(null)
  const acts = useMemo(() => [...mine.filter((a) => (a.dog || 'Biscuit') === dd.dog.name), ...dd.seed], [mine, dd])
  const week = useMemo(() => {
    const by = {}; let total = 0
    acts.filter((a) => a.daysAgo <= 6).forEach((a) => { const p = by[a.by] || (by[a.by] = { min: 0, n: 0, mi: 0 }); p.min += a.minutes; p.n += 1; p.mi += a.miles; total += a.minutes })
    return { by, total, miles: acts.filter((a) => a.daysAgo <= 6).reduce((s, a) => s + a.miles, 0), walks: acts.filter((a) => a.daysAgo <= 6).length }
  }, [acts])
  const todayMin = acts.filter((a) => a.daysAgo === 0 && a.type !== 'Daycare').reduce((s, a) => s + a.minutes, 0)
  const paw = (id) => setPawed((p) => ({ ...p, [id]: !p[id] }))
  const saveWalk = (a0) => { const a = { ...a0, dog: dd.dog.name }; setMine((m) => [a, ...m]); setTab('home'); setOpen(a) }
  // A tapped dog: one of the two demo dogs opens its own profile, any other opens a sample profile sheet.
  const onDog = (a) => { const name = typeof a === 'string' ? a : a.dog; const d = demoDogByName(name); if (d) { setDk(d.key); setOpen(null); setCompete(null); setTab('dog') } else setSheetDog(name) }
  const ctx = { saveWalk, me, setMe, acts, week, todayMin, pawed, paw, conn, setConn, setOpen, setTab, setToast, mine, setMine, level, dd, setDk, onDog, openSettings: () => setSettings(true), openCompete: (t) => setCompete(t || 'boards') }
  const reset = () => { setMine([]); setPawed({}); setMe('dale'); setConn(Object.fromEntries(CONNECTIONS.map((c) => [c.id, !!c.on]))); setLevel(1); setPlan('free'); setDk('biscuit'); setLS('trot-demo-joins', null); setToast('Demo reset') }
  return (
    <div className="shell">
      <main className="screen">
        {tab === 'home' && <Home {...ctx} />}
        {tab === 'explore' && <Explore {...ctx} dogName={dd.dog.name} />}
        {tab === 'record' && <Record {...ctx} dogName={dd.dog.name} />}
        {tab === 'people' && <People {...ctx} />}
        {tab === 'dog' && <DogTab {...ctx} />}
      </main>
      {tab !== 'record' && (
        <nav className="tabs" aria-label="Main">
          <Tab on={tab === 'home'} l="Home" i="home" go={() => setTab('home')} />
          <Tab on={tab === 'explore'} l="Explore" i="map" go={() => setTab('explore')} />
          <button className="rec" aria-label={`Walk ${dd.dog.name}`} onClick={() => setTab('record')}><Paw s={28} c="#0F1B2D" /></button>
          <Tab on={tab === 'people'} l="People" i="users" go={() => setTab('people')} />
          <button className={`tab ${tab === 'dog' ? 'on' : ''}`} onClick={() => setTab('dog')}><DogAv name={dd.dog.name} demo s={24} bg={tab === 'dog' ? '#0F1B2D' : '#5B6472'} c="#fff" /><span>{dd.dog.name}</span></button>
        </nav>
      )}
      {compete && <Compete close={() => setCompete(null)} start={compete} acts={acts} setToast={setToast} hasApi={hasApi} demoName={dd.dog.name} onDog={onDog} />}
      {sheetDog && <DemoDogSheet name={sheetDog} close={() => setSheetDog(null)} />}
      {settings && <Settings close={() => setSettings(false)} demoName={dd.dog.name} setToast={setToast} plan={plan} setPlan={setPlan} level={level} setLevel={setLevel} conn={conn} setConn={setConn} me={me} setMe={setMe} reset={reset} leaveDemo={leaveDemo} signedIn={signedIn} />}
      {open && <Detail a={open} {...ctx} dogName={dd.dog.name} close={() => setOpen(null)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

// ---- signed in: a real dog, a real team, walks saved through the API ----------
const thinTo = (pts, max) => {
  if (pts.length <= max) return pts
  const out = []
  for (let i = 0; i < max; i++) out.push(pts[Math.round((i * (pts.length - 1)) / (max - 1))])
  return out
}
const clamp = (v, hi) => Math.min(hi, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : 0))

function RealApp({ me, setMe, slug, pickDog, notice, signOut: doSignOut, toDemo }) {
  const [tab, setTab] = useState('home')
  const [open, setOpen] = useState(null)
  const [toast, setToast] = useState(notice || '')
  const [data, setData] = useState(null)
  const [feed, setFeed] = useState({ walks: [], cursor: null, loaded: false, more: false })
  const [scope, setScope] = useState('dog')
  const [patch, setPatch] = useState({})
  const [err, setErr] = useState('')
  const saving = useRef(false), seq = useRef(0)
  const [settings, setSettings] = useState(false)
  const [compete, setCompete] = useState(null)
  const [plan, setPlanState] = useState(getLS(PLAN) || 'free')
  const setPlan = (p) => { setPlanState(p); setLS(PLAN, p) }
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3200); return () => clearTimeout(t) }, [toast])
  const dogs = me.dogs
  const all = scope === 'all' && dogs.length > 1

  const reload = useCallback(async () => {
    const n = ++seq.current
    try {
      const [d, f] = await Promise.all([api.get(`/dogs/${slug}`), api.get(all ? '/feed' : `/feed?dog=${slug}`)])
      if (n !== seq.current) return
      setData(d); setFeed({ walks: f.walks, cursor: f.nextCursor, loaded: true, more: false }); setPatch({}); setErr('')
    } catch (e) { if (n === seq.current && e.status !== 401) setErr(e.message) }
  }, [slug, all])
  useEffect(() => { reload() }, [reload])
  const switchDog = (s) => { if (s === slug) return; setData(null); setFeed({ walks: [], cursor: null, loaded: false, more: false }); setOpen(null); pickDog(s) }
  const more = async () => {
    if (!feed.cursor || feed.more) return
    setFeed((f) => ({ ...f, more: true }))
    try {
      const f = await api.get(`/feed?cursor=${encodeURIComponent(feed.cursor)}${all ? '' : `&dog=${slug}`}`)
      setFeed((old) => ({ walks: [...old.walks, ...f.walks.filter((w) => !old.walks.some((o) => o.id === w.id))], cursor: f.nextCursor, loaded: true, more: false }))
    } catch (e) { setFeed((f) => ({ ...f, more: false })); setToast(e.message) }
  }

  const team = data ? data.team : []
  // Walk lists carry the dog's name and photo as they were when the list was
  // fetched. The dog list in `me` is updated the moment a profile is saved, so it wins.
  const fix = (w0) => {
    const d = dogs.find((x) => x.slug === w0.dog.slug)
    const w = d && (d.name !== w0.dog.name || d.photoUrl !== w0.dog.photoUrl) ? { ...w0, dog: { ...w0.dog, name: d.name, photoUrl: d.photoUrl } } : w0
    return patch[w.id] ? { ...w, ...patch[w.id] } : w
  }
  const acts = useMemo(() => feed.walks.map((w) => toAct(fix(w), team)), [feed.walks, patch, team, dogs])
  const dogActs = useMemo(() => (data ? data.walks.map((w) => toAct(fix(w), team)) : []), [data, patch, team, dogs])
  const pawed = useMemo(() => {
    const m = {}
    ;[...feed.walks, ...(data ? data.walks : [])].forEach((w) => { m[w.id] = !!fix(w).pawed })
    Object.entries(patch).forEach(([id, p]) => { m[id] = !!p.pawed })
    return m
  }, [feed.walks, data, patch])
  const known = (id) => { const w = feed.walks.find((x) => x.id === id) || (data && data.walks.find((x) => x.id === id)); return w ? fix(w) : patch[id] }
  const paw = async (id) => {
    const cur = known(id)
    if (!cur) return
    const on = !cur.pawed
    // Show it at once, then settle on what the server says.
    setPatch((p) => ({ ...p, [id]: { paws: cur.paws + (on ? 1 : -1), pawed: on } }))
    try {
      const r = on ? await api.post(`/walks/${id}/paw`) : await api.del(`/walks/${id}/paw`)
      setPatch((p) => ({ ...p, [id]: { paws: r.paws, pawed: r.pawed } }))
    } catch (e) { setPatch((p) => ({ ...p, [id]: { paws: cur.paws, pawed: cur.pawed } })); setToast(e.message) }
  }

  const dog = data ? data.dog : dogs.find((d) => d.slug === slug) || dogs[0]
  const saveWalk = async (a) => {
    if (saving.current) return
    saving.current = true
    try {
      const pts = Array.isArray(a.pts) ? thinTo(a.pts.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => [p[0], p[1]]), 5000) : []
      const r = await api.post(`/dogs/${slug}/walks`, {
        type: WALK_TYPES.includes(a.type) ? a.type : 'Walk',
        title: String(a.title || a.type || 'Walk').trim().slice(0, 80) || 'Walk',
        note: String(a.note || '').trim().slice(0, 500),
        place: String(a.place || '').trim().slice(0, 80),
        miles: clamp(a.miles, 200), minutes: clamp(a.minutes, 1440),
        // Performance statistics are sent only when the recorder measured them.
        ...(a.avgSpeed > 0 ? { avgSpeed: clamp(a.avgSpeed, 40) } : {}), ...(a.maxSpeed > 0 ? { maxSpeed: Math.max(clamp(a.maxSpeed, 40), a.avgSpeed > 0 ? clamp(a.avgSpeed, 40) : 0) } : {}), ...(a.sprints > 0 ? { sprints: Math.round(clamp(a.sprints, 500)) } : {}),
        ...(a.movingMinutes > 0 ? { movingMinutes: Math.min(clamp(a.movingMinutes, 1440), clamp(a.minutes, 1440)) } : {}),
        route: pts.length > 1 ? pts : null,
      })
      await reload()
      setTab('home'); setOpen(toAct(r.walk, team)); setToast(`Saved to ${dog.name}`)
    } catch (e) { setToast(e.status ? `Not saved. ${e.message}` : 'Not saved. Check your connection and tap Save again.') } finally { saving.current = false }
  }
  const refreshMe = async (pick) => { const m = await api.get('/me'); setMe(m); if (pick) switchDog(pick); return m }
  const patchDog = async (body) => {
    try { const r = await api.patch(`/dogs/${slug}`, body); setData((d) => (d ? { ...d, dog: r.dog } : d)); refreshMe().catch(() => {}); return true }
    catch (e) { setToast(e.message); return false }
  }
  const createInvite = (role) => api.post(`/dogs/${slug}/invites`, { role })
  // Saves the edit form. Answers { dog } or { error } so the form can show the reason inline.
  const saveProfile = async (body) => {
    try {
      const r = await api.patch(`/dogs/${slug}`, body)
      if (typeof body.photo === 'string' && r.dog.photoUrl) primePhoto(r.dog.photoUrl, body.photo)
      setData((d) => (d ? { ...d, dog: r.dog } : d))
      setMe((m) => ({ ...m, dogs: m.dogs.map((d) => (d.slug === r.dog.slug ? { ...d, ...r.dog } : d)) }))
      return { dog: r.dog }
    } catch (e) { return { error: e.message } }
  }
  const renameMe = async (name) => {
    try { const r = await api.patch('/me', { name }); setMe((m) => ({ ...m, user: r.user })); reload(); return { user: r.user } }
    catch (e) { return { error: e.message } }
  }
  const listInvites = () => api.get(`/dogs/${slug}/invites`)
  const cancelInvite = async (id) => { try { await api.del(`/dogs/${slug}/invites/${id}`); return {} } catch (e) { return { error: e.message, status: e.status } } }
  const removeMember = async (id) => { try { await api.del(`/dogs/${slug}/members/${id}`); await reload(); return {} } catch (e) { return { error: e.message } } }
  const deleteWalk = async (id) => {
    try { await api.del(`/walks/${id}`) } catch (e) { if (e.status !== 404) return { error: e.message } }
    setOpen(null); setToast('Outing deleted'); await reload(); return {}
  }

  if (!data) return (
    <div className="shell"><div className="welcome splash" role="status">
      <div className="wlogo">TROT</div>
      {err ? <><p className="formerr" role="alert">{err}</p><button className="cta" onClick={reload}>Try again</button><button className="wlink" onClick={doSignOut}>Sign out</button></> : <p className="wtag">Fetching {dog ? dog.name : 'your dog'}</p>}
    </div></div>
  )
  const todayMin = data.weekWalks.filter((w) => w.type !== 'Daycare' && new Date(w.startedAt).toDateString() === new Date().toDateString()).reduce((s, w) => s + w.minutes, 0)
  const real = { user: me.user, dogs, dog, totals: data.totals, team, weekWalks: data.weekWalks, dogActs, switchDog, scope: scope === 'pack' ? 'pack' : all ? 'all' : 'dog', setScope, reload, hasMore: !!feed.cursor, more, loadingMore: feed.more, createInvite, patchDog, saveProfile, renameMe, listInvites, cancelInvite, removeMember, deleteWalk, refreshMe, signOut: doSignOut, toDemo, hasPendingInvite: !!pendingInvite() }
  // A tapped dog: one of your own opens its profile here, any other opens its public page.
  const onDog = (a) => { if (dogs.some((d) => d.slug === a.dogSlug)) { setOpen(null); switchDog(a.dogSlug); setTab('dog') } else window.open(`/d/${a.dogSlug}`, '_blank', 'noopener') }
  const ctx = { real, acts, pawed, paw, setOpen, setTab, setToast, conn: {}, onDog, openSettings: () => setSettings(true), openCompete: (t) => setCompete(t || 'boards') }
  return (
    <RangeOff.Provider value={true}>
      <div className="shell">
        <main className="screen">
          {tab === 'home' && <Home {...ctx} />}
          {tab === 'explore' && <Explore setTab={setTab} setToast={setToast} dogName={dog.name} />}
          {/* Record looks `me` up in the demo PEOPLE table, so it stays a valid demo id. meName and dogName carry the real names. */}
          {tab === 'record' && <Record me="dale" conn={{}} setTab={setTab} saveWalk={saveWalk} todayMin={todayMin} setToast={setToast} meName={me.user.name} dogName={dog.name} />}
          {tab === 'people' && <People {...ctx} />}
          {tab === 'dog' && <DogTab {...ctx} />}
        </main>
        {tab !== 'record' && (
          <nav className="tabs" aria-label="Main">
            <Tab on={tab === 'home'} l="Home" i="home" go={() => setTab('home')} />
            <Tab on={tab === 'explore'} l="Explore" i="map" go={() => setTab('explore')} />
            <button className="rec" aria-label={`Walk ${dog.name}`} onClick={() => setTab('record')}><Paw s={28} c="#0F1B2D" /></button>
            <Tab on={tab === 'people'} l="People" i="users" go={() => setTab('people')} />
            <button className={`tab ${tab === 'dog' ? 'on' : ''}`} onClick={() => setTab('dog')}><DogAv name={dog.name} photoUrl={dog.photoUrl} s={24} bg={tab === 'dog' ? '#0F1B2D' : '#5B6472'} c="#fff" /><span className="tabname">{dog.name}</span></button>
          </nav>
        )}
        {compete && <Compete close={() => setCompete(null)} start={compete} real={real} setToast={setToast} />}
        {settings && <Settings close={() => setSettings(false)} real={real} setToast={setToast} plan={plan} setPlan={setPlan} />}
        {open && <Detail a={open} {...ctx} dogName={dog.name} close={() => setOpen(null)} />}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </RangeOff.Provider>
  )
}
const Tab = ({ on, l, i, go }) => <button className={`tab ${on ? 'on' : ''}`} onClick={go}><Ic n={i} /><span>{l}</span></button>
