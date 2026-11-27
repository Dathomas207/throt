import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Ic, Paw, Av, DogAv, RangeOff, toAct } from './ui.jsx'
import { PEOPLE, SEED, CONNECTIONS, ACTIVITY_TYPES, DEMO_DOGS, demoDogByName } from './data.js'
import DemoDogSheet from './screens/DemoDogSheet.jsx'
import { api, probe, hasToken, setAuthLost, signOut, takeInviteFromUrl, pendingInvite, primePhoto, takeFriendFromUrl, pendingFriend, clearFriend } from './api.js'
import { fitJpeg, OUTING_PHOTO_MAX } from './photo.js'
import FriendsScreen, { FriendConfirm, realFriendsModel, demoFriendsModel } from './screens/Friends.jsx'
import Home from './screens/Home.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { TrainingHost, openTraining } from './training/host.jsx'
import { routeActions, migrateLocalRoutes, resetRoutes, linkId } from './routeStore.js'
import { track, usageReady, setUsageMode, setUsageDog, setScreen, isStandalone, minutesBucket, milesBucket, captureError } from './usage.js'
// The map screens and the sheets load on demand, so the Today screen appears without the map library.
// Each one sits in its own error boundary, so a screen that breaks shows a calm card and the rest of the app keeps working.
function onDemand(load, fallback, name, kind = 'screen') { const C = lazy(load); return function OnDemand(props) { return <ErrorBoundary name={name} kind={kind} onClose={props.close}><Suspense fallback={fallback}><C {...props} /></Suspense></ErrorBoundary> } }
// Fetched shortly after the first screen is up, so the first tap on a tab does not wait.
const warmScreens = () => { for (const f of [loadExplore, loadRecord, loadBuilder, loadDetail, loadCompete, loadSettings, loadNotifications]) f().catch(() => {}) }
const loadExplore = () => import('./screens/Explore.jsx')
const loadRecord = () => import('./screens/Record.jsx')
const loadBuilder = () => import('./screens/RouteBuilder.jsx')
const loadDetail = () => import('./screens/Detail.jsx')
const loadSettings = () => import('./screens/Settings.jsx')
const loadCompete = () => import('./screens/Compete.jsx')
const loadNotifications = () => import('./screens/Notifications.jsx')
const Explore = onDemand(loadExplore, <div className="scroll"><div className="card empty" role="status"><p>Loading</p></div></div>, 'explore')
const Record = onDemand(loadRecord, <div className="scroll"><div className="card empty" role="status"><p>Loading</p></div></div>, 'record')
const RouteBuilder = onDemand(loadBuilder, <div className="scroll"><div className="card empty" role="status"><p>Loading</p></div></div>, 'build')
import People from './screens/People.jsx'
import DogTab from './screens/DogTab.jsx'
const Detail = onDemand(loadDetail, null, 'outing', 'sheet')
import Welcome, { acceptPendingInvite } from './screens/Welcome.jsx'
const Settings = onDemand(loadSettings, null, 'settings', 'sheet')
const Compete = onDemand(loadCompete, null, 'compete', 'sheet')
const Notifications = onDemand(loadNotifications, null, 'notifications', 'sheet')
// The screen name that goes with an error: the open sheet if there is one, otherwise the tab.
const screenOf = (tab, sheets) => { for (const [name, on] of sheets) if (on) return name; return tab }

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
  useEffect(() => { const t = setTimeout(warmScreens, 1200); return () => clearTimeout(t) }, [])
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
      // A friend link (/?friend=<dog>) waits in sessionStorage until someone is signed in with a dog of their own.
      const friend = takeFriendFromUrl()
      const ok = await probe()
      if (!on) return
      // Usage counting only runs against a real Trot API. On static hosting it stays a no-op.
      usageReady(ok)
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
      setPhase(!invite && !friend && getLS(MODE) === 'demo' ? 'demo' : 'welcome')
    })()
    return () => { on = false }
  }, [enter])

  const toDemo = () => { setLS(MODE, 'demo'); setPhase('demo') }
  // One app_open per mode per page load: the demo, or a signed-in dog.
  const opened = useRef({})
  useEffect(() => {
    const mode = phase === 'demo' ? 'demo' : phase === 'real' && me && slug ? 'signed_in' : null
    if (!mode || opened.current[mode]) return
    opened.current[mode] = true
    track('app_open', { mode, standalone: isStandalone() })
  }, [phase, me, slug])
  const toWelcome = () => { setLS(MODE, null); setNotice(''); setPhase(me && me.dogs.length ? 'real' : 'welcome') }
  const out = async () => { await signOut(); setMe(null); setSlug(null); setLS(DOGKEY, null); setNotice(''); setPhase('welcome') }

  // The demo saves nothing, so usage.js only counts looking around while it is showing.
  setUsageMode(phase === 'demo' || (phase === 'real' && !(me && slug)) ? 'demo' : 'real')
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
  // Photos picked in the demo are previews held by this tab only, so they are dropped from anything saved earlier.
  const [mine, setMine] = useState(() => (saved.mine || []).map((a) => (a.photos ? { ...a, photos: undefined } : a)))
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
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ me, mine: mine.map((a) => (a.photos ? { ...a, photos: undefined } : a)), pawed, conn, level, dk })) } catch (e) {} }, [me, mine, pawed, conn, level, dk])
  const [friendsOpen, setFriendsOpen] = useState(false)
  // The bell in the demo: sample notifications, read-only. The badge clears for this visit once they are looked at.
  const [notes, setNotes] = useState(false), [noteCount, setNoteCount] = useState(2)
  useEffect(() => { track('tab_view', { tab }) }, [tab])
  useEffect(() => { setScreen(screenOf(tab, [['outing', open], ['notifications', notes], ['settings', settings], ['compete', compete], ['friends', friendsOpen]])) }, [tab, open, notes, settings, compete, friendsOpen])
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
  // With `stay`, Record keeps the screen to offer "Save this route" and opens the outing itself afterwards.
  const saveWalk = (a0, files, { stay } = {}) => {
    // In the demo a picked photo is only previewed from this device. Nothing is uploaded.
    const photos = (files || []).slice(0, OUTING_PHOTO_MAX).map((f, i) => ({ id: `${a0.id}-p${i}`, url: URL.createObjectURL(f), local: true }))
    const a = { ...a0, dog: dd.dog.name, ...(photos.length ? { photos } : {}) }
    setMine((m) => [a, ...m]); if (!stay) { setTab('home'); setOpen(a) }
    if (a.routeId) routeActions.walked(a.routeId)
    if (photos.length) setToast('Photos are previewed here only. Saving them needs an account.')
    return a
  }
  // A tapped dog: one of the two demo dogs opens its own profile, any other opens a sample profile sheet.
  const onDog = (a) => { const name = typeof a === 'string' ? a : a.dog; const d = demoDogByName(name); if (d) { setDk(d.key); setOpen(null); setCompete(null); setTab('dog') } else setSheetDog(name) }
  const ctx = { saveWalk, openOuting: (a) => { setTab('home'); setOpen(a) }, me, setMe, acts, week, todayMin, pawed, paw, conn, setConn, setOpen, setTab, setToast, mine, setMine, level, dd, setDk, onDog, openSettings: () => setSettings(true), openCompete: (t) => setCompete(t || 'boards'), openFriends: () => setFriendsOpen(true), unread: noteCount, openNotifications: () => { setNotes(true); setNoteCount(0) } }
  const reset = () => { setMine([]); setPawed({}); setMe('dale'); setConn(Object.fromEntries(CONNECTIONS.map((c) => [c.id, !!c.on]))); setLevel(1); setPlan('free'); setDk('biscuit'); setLS('trot-demo-joins', null); setToast('Demo reset') }
  return (
    <div className="shell">
      <main className="screen">
        <ErrorBoundary key={tab} name={tab}>
          {tab === 'home' && <Home {...ctx} hasApi={hasApi} />}
          {tab === 'explore' && <Explore {...ctx} dogName={dd.dog.name} />}
          {tab === 'record' && <Record {...ctx} dogName={dd.dog.name} />}
          {tab === 'build' && <RouteBuilder setTab={setTab} setToast={setToast} dogName={dd.dog.name} dogKey={dd.dog.name} demoActs={acts} />}
          {tab === 'people' && <People {...ctx} />}
          {tab === 'dog' && <DogTab {...ctx} />}
        </ErrorBoundary>
      </main>
      {tab !== 'record' && tab !== 'build' && (
        <nav className="tabs" aria-label="Main">
          <Tab on={tab === 'home'} l="Today" i="home" go={() => setTab('home')} dot={noteCount > 0} />
          <Tab on={tab === 'explore'} l="Explore" i="map" go={() => setTab('explore')} />
          <button className="rec" aria-label={`Walk ${dd.dog.name}`} onClick={() => setTab('record')}><Paw s={28} c="#0F1B2D" /></button>
          <Tab on={tab === 'people'} l="People" i="users" go={() => setTab('people')} />
          <button className={`tab ${tab === 'dog' ? 'on' : ''}`} onClick={() => setTab('dog')}><DogAv name={dd.dog.name} demo s={24} bg={tab === 'dog' ? '#0F1B2D' : '#5B6472'} c="#fff" /><span>{dd.dog.name}</span></button>
        </nav>
      )}
      {compete && <Compete close={() => setCompete(null)} start={compete} acts={acts} setToast={setToast} hasApi={hasApi} demoName={dd.dog.name} onDog={onDog} />}
      {friendsOpen && <FriendsScreen m={demoFriendsModel(dd, { setToast, onDog: (n) => { setFriendsOpen(false); onDog(n) }, open: () => {} })} close={() => setFriendsOpen(false)} />}
      {sheetDog && <DemoDogSheet name={sheetDog} close={() => setSheetDog(null)} fm={demoFriendsModel(dd, { setToast, onDog, open: () => {} })} />}
      {notes && <Notifications close={() => setNotes(false)} demoName={dd.dog.name} setToast={setToast} />}
      <TrainingHost dd={dd} setToast={setToast} setTab={setTab} />
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
  // ---- notifications: the unread count arrives with /api/me, then is checked every minute while the app is visible, and on focus ----
  const [unread, setUnread] = useState(me.unread || 0)
  const [notes, setNotes] = useState(false)
  const [regNonce, setRegNonce] = useState(0), [placeFocus, setPlaceFocus] = useState(null)
  useEffect(() => {
    let on = true
    const check = () => { if (document.visibilityState === 'hidden') return; api.notifications.unread().then((n) => { if (on) setUnread(n) }, () => {}) }
    const t = setInterval(check, 60000)
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check)
    return () => { on = false; clearInterval(t); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check) }
  }, [])
  useEffect(() => { setUsageDog(slug); return () => setUsageDog(null) }, [slug])
  useEffect(() => { track('tab_view', { tab }) }, [tab])
  useEffect(() => { setScreen(screenOf(tab, [['outing', open], ['notifications', notes], ['settings', settings], ['compete', compete]])) }, [tab, open, notes, settings, compete])
  const all = scope === 'all' && dogs.length > 1

  // ---- dog friends: the active dog's list, a few suggestions, and the invite link ----
  const [fr, setFr] = useState({ loaded: false, list: [], suggestions: [], canManage: false, invite: null })
  const [frRev, setFrRev] = useState(0)
  const [friendsOpen, setFriendsOpen] = useState(false)
  const [friendAsk, setFriendAsk] = useState(null)
  const frSeq = useRef(0)
  const loadFriends = useCallback(async () => {
    const n = ++frSeq.current
    try {
      const [l, s] = await Promise.all([api.friends.list(slug), api.friends.suggestions(slug)])
      if (n === frSeq.current) setFr({ loaded: true, list: l.friends, suggestions: s.suggestions, canManage: l.canManage, invite: l.invite })
    } catch (e) { if (n === frSeq.current) setFr((f) => ({ ...f, loaded: true })) }
  }, [slug])
  useEffect(() => { setFr({ loaded: false, list: [], suggestions: [], canManage: false, invite: null }); loadFriends() }, [loadFriends])
  // `from` is the dog doing the following: the active dog unless the invite sheet picked another.
  const addFriend = async (d, from = slug, { quiet } = {}) => {
    try {
      const r = await api.friends.add(from, d.slug)
      if (from === slug) await loadFriends()
      setFrRev((n) => n + 1)
      if (!quiet) setToast(r.friend.mutual ? `${dog.name} and ${r.friend.name} are now friends with each other` : `${r.friend.name} is now one of ${dog.name}'s friends`)
      return { friend: r.friend }
    } catch (e) { if (!quiet) setToast(e.message); return { error: e.message } }
  }
  const removeFriend = async (d) => {
    try { await api.friends.remove(slug, d.slug); await loadFriends(); setFrRev((n) => n + 1); setToast(`${d.name} is no longer one of ${dog.name}'s friends`); return {} }
    catch (e) { return { error: e.message } }
  }
  // Someone arrived from an "Add as a friend" link. The dog is looked up by its public page, then the person confirms.
  useEffect(() => {
    const f = pendingFriend()
    if (!f) return
    let on = true
    api.friends.publicDog(f).then((r) => { if (on) setFriendAsk({ slug: r.dog.slug, name: r.dog.name, breed: r.dog.breed, city: r.dog.city, photoUrl: r.dog.photoUrl }) },
      (e) => { if (e.status === 404) { clearFriend(); if (on) setToast('That friend link is for a dog page that is private or no longer there.') } })
    return () => { on = false }
  }, [])

  // ---- outing photos: each picked file is shrunk here, then sent, one at a time ----
  const [jobs, setJobs] = useState([])
  const [photoRev, setPhotoRev] = useState(0)
  const jobSeq = useRef(0), queue = useRef(Promise.resolve()), reloadNow = useRef(() => {})
  const setJob = (key, p) => setJobs((js) => js.map((j) => (j.key === key ? { ...j, ...p } : j)))
  const dropJob = (key) => setJobs((js) => { const j = js.find((x) => x.key === key); if (j) { try { URL.revokeObjectURL(j.preview) } catch (e) {} } return js.filter((x) => x.key !== key) })
  const runJob = async (job) => {
    setJob(job.key, { status: 'shrinking', pct: 0, error: '' })
    try {
      let shot
      // A photo the phone could not read or shrink is recorded by its message only. The picture never leaves the device.
      try { shot = await fitJpeg(job.file) } catch (e) { captureError('photo', (e && e.message) || 'Photo could not be processed'); throw e }
      setJob(job.key, { status: 'uploading' })
      await api.photos.upload(job.walkId, shot.dataUrl, (pct) => setJob(job.key, { pct }))
      dropJob(job.key)
      setPhotoRev((n) => n + 1)
      return true
    } catch (e) { setJob(job.key, { status: 'error', error: e.message || 'That photo did not work. Try another one.' }); return false }
  }
  // Never awaited by the save: the outing is already stored when the first photo starts.
  const addPhotos = (walkId, files) => {
    const fresh = files.slice(0, OUTING_PHOTO_MAX).map((file) => ({ key: `j${++jobSeq.current}`, walkId, file, preview: URL.createObjectURL(file), status: 'waiting', pct: 0, error: '' }))
    if (!fresh.length) return
    track('photo_added', { count: fresh.length })
    setJobs((js) => [...js, ...fresh])
    queue.current = queue.current.then(async () => { let ok = 0; for (const j of fresh) if (await runJob(j)) ok++; if (ok) reloadNow.current() })
  }
  const retryPhoto = (key) => { const j = jobs.find((x) => x.key === key); if (j) queue.current = queue.current.then(async () => { if (await runJob(j)) reloadNow.current() }) }
  const deletePhoto = async (walkId, id) => {
    try { await api.photos.remove(walkId, id) } catch (e) { if (e.status !== 404) return { error: e.message } }
    setPhotoRev((n) => n + 1); setToast('Photo deleted'); reload(); return {}
  }

  const reload = useCallback(async () => {
    const n = ++seq.current
    try {
      const [d, f] = await Promise.all([api.get(`/dogs/${slug}`), api.get(all ? '/feed' : `/feed?dog=${slug}`)])
      if (n !== seq.current) return
      setData(d); setFeed({ walks: f.walks, cursor: f.nextCursor, loaded: true, more: false }); setPatch({}); setErr('')
    } catch (e) { if (n === seq.current && e.status !== 401) setErr(e.message) }
  }, [slug, all])
  useEffect(() => { reload() }, [reload])
  reloadNow.current = reload
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
  // Routes saved on this device before signing in are copied to the account, once.
  useEffect(() => { let on = true; resetRoutes(true); migrateLocalRoutes(me.user.id).then((n) => { if (on && n) setToast(`${n} ${n === 1 ? 'route' : 'routes'} saved on this device ${n === 1 ? 'is' : 'are'} now on your account`) }, () => {}); return () => { on = false } }, [])
  // With `stay`, Record keeps the screen to offer "Save this route" and opens the outing itself afterwards.
  const saveWalk = async (a, files, { stay } = {}) => {
    if (saving.current) return null
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
        // Started from one of this person's saved routes: the server links the outing to it and counts the walk.
        ...(linkId(a.routeId) ? { routeId: linkId(a.routeId) } : {}),
      })
      track('walk_saved', { type: r.walk.type, minutes: minutesBucket(r.walk.minutes), miles: milesBucket(r.walk.miles), photos: Math.min(OUTING_PHOTO_MAX, (files || []).length), had_gps: pts.length > 1 })
      await reload()
      const act = toAct(r.walk, team)
      if (!stay) { setTab('home'); setOpen(act) }
      setToast(`Saved to ${dog.name}`)
      // Recent routes and how often a saved route was walked come from outings, so they are read again.
      if (pts.length > 1) routeActions.walked(null)
      // Photos go up after the outing is saved. A photo that fails never undoes the save.
      if (files && files.length) addPhotos(r.walk.id, files)
      return act
    } catch (e) { setToast(e.status ? `Not saved. ${e.message}` : 'Not saved. Check your connection and tap Save again.'); return null } finally { saving.current = false }
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
    try { const r = await api.patch('/me', { name }); setMe((m) => ({ ...m, user: { ...m.user, ...r.user } })); reload(); return { user: r.user } }
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
  const real = { user: me.user, dogs, dog, totals: data.totals, team, weekWalks: data.weekWalks, dogActs, switchDog, scope: scope === 'pack' || scope === 'friends' ? scope : all ? 'all' : 'dog', setScope,
    friends: { ...fr, rev: frRev, add: addFriend, remove: removeFriend, open: () => setFriendsOpen(true), reload: () => { loadFriends(); setFrRev((n) => n + 1) } },
    photos: { jobs, rev: photoRev, add: addPhotos, retry: retryPhoto, dismiss: dropJob, remove: deletePhoto }, reload, hasMore: !!feed.cursor, more, loadingMore: feed.more, createInvite, patchDog, saveProfile, renameMe, listInvites, cancelInvite, removeMember, deleteWalk, refreshMe, signOut: doSignOut, toDemo, hasPendingInvite: !!pendingInvite() }
  // A tapped dog: one of your own opens its profile here, any other opens its public page.
  const onDog = (a) => { if (dogs.some((d) => d.slug === a.dogSlug)) { setOpen(null); switchDog(a.dogSlug); setTab('dog') } else window.open(`/d/${a.dogSlug}`, '_blank', 'noopener') }
  // Where a tapped notification goes. A dog named in the link becomes the one showing first, when it is one of yours.
  const follow = async (link) => {
    const mine = link.dog && dogs.some((d) => d.slug === link.dog)
    if (mine && link.dog !== slug && link.to !== 'outing') switchDog(link.dog)
    if (link.to === 'friends') { setTab('home'); setFriendsOpen(true) }
    else if (link.to === 'outing') {
      try { const r = await api.get(`/walks/${link.id}`); setOpen(toAct(r.walk, team)) }
      catch (e) { setToast(e.status === 404 ? 'That outing is no longer there.' : e.message) }
    } else if (link.to === 'registration' || link.to === 'tag') { setTab('dog'); setRegNonce((n) => n + 1) }
    else if (link.to === 'dog') setTab('dog')
    else if (link.to === 'people') setTab('people')
    else if (link.to === 'events') setCompete('events')
    else if (link.to === 'training') { setTab('home'); openTraining() }
    else if (link.to === 'place') {
      // Explore opens where it was last looking, so the place's own position is written there first.
      if (Array.isArray(link.at) && Number.isFinite(link.at[0]) && Number.isFinite(link.at[1])) setLS('trot-view-v2', JSON.stringify({ at: link.at, zoom: 16 }))
      setPlaceFocus({ id: link.id, n: Date.now() }); setTab('explore')
    } else setTab('home')
  }
  const ctx = { real, acts, pawed, paw, setOpen, setTab, setToast, conn: {}, onDog, openSettings: () => setSettings(true), openCompete: (t) => setCompete(t || 'boards'), unread, openNotifications: () => setNotes(true), regNonce }
  return (
    <RangeOff.Provider value={true}>
      <div className="shell">
        <main className="screen">
          <ErrorBoundary key={tab} name={tab}>
          {tab === 'home' && <Home {...ctx} />}
          {tab === 'explore' && <Explore setTab={setTab} setToast={setToast} dogName={dog.name} dogKey={dog.slug} account focusPlace={placeFocus} />}
          {/* Record looks `me` up in the demo PEOPLE table, so it stays a valid demo id. meName and dogName carry the real names. */}
          {tab === 'record' && <Record me="dale" conn={{}} setTab={setTab} saveWalk={saveWalk} openOuting={(a) => { setTab('home'); setOpen(a) }} todayMin={todayMin} setToast={setToast} meName={me.user.name} dogName={dog.name} publicDog={!!dog.public} account />}
          {tab === 'build' && <RouteBuilder setTab={setTab} setToast={setToast} dogName={dog.name} dogKey={dog.slug} account />}
          {tab === 'people' && <People {...ctx} />}
          {tab === 'dog' && <DogTab {...ctx} />}
          </ErrorBoundary>
        </main>
        {tab !== 'record' && tab !== 'build' && (
          <nav className="tabs" aria-label="Main">
            <Tab on={tab === 'home'} l="Today" i="home" go={() => setTab('home')} dot={unread > 0} />
            <Tab on={tab === 'explore'} l="Explore" i="map" go={() => setTab('explore')} />
            <button className="rec" aria-label={`Walk ${dog.name}`} onClick={() => setTab('record')}><Paw s={28} c="#0F1B2D" /></button>
            <Tab on={tab === 'people'} l="People" i="users" go={() => setTab('people')} />
            <button className={`tab ${tab === 'dog' ? 'on' : ''}`} onClick={() => setTab('dog')}><DogAv name={dog.name} photoUrl={dog.photoUrl} s={24} bg={tab === 'dog' ? '#0F1B2D' : '#5B6472'} c="#fff" /><span className="tabname">{dog.name}</span></button>
          </nav>
        )}
        {compete && <Compete close={() => setCompete(null)} start={compete} real={real} setToast={setToast} />}
        {friendsOpen && <FriendsScreen m={realFriendsModel(real, setToast)} close={() => setFriendsOpen(false)} />}
        {notes && <Notifications close={() => setNotes(false)} real={real} setToast={setToast} go={follow} onUnread={setUnread} />}
        <TrainingHost real={real} setToast={setToast} setTab={setTab} />
        {settings && <Settings close={() => setSettings(false)} real={real} setToast={setToast} plan={plan} setPlan={setPlan} />}
        {open && <Detail a={open} {...ctx} dogName={dog.name} close={() => setOpen(null)} />}
        {friendAsk && <FriendConfirm target={friendAsk} real={real} done={(msg) => { setFriendAsk(null); if (msg) setToast(msg) }} />}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </RangeOff.Provider>
  )
}
// `dot` marks the Today tab while there are unread notifications.
const Tab = ({ on, l, i, go, dot }) => <button className={`tab ${on ? 'on' : ''}`} onClick={go} aria-label={dot ? `${l}, unread notifications` : undefined}><span className="tabic"><Ic n={i} />{dot && <span className="tabdot" aria-hidden="true" />}</span><span>{l}</span></button>
