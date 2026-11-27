// Live walks in the app: the network calls, the hooks and the small pieces of screen that Record, Explore,
// Today and Settings share. The rules for who sees what are kept by the server (server/routesLive.js).
// Everything here fails quietly: a walk that cannot be shared is still recorded.
import React, { useEffect, useRef, useState } from 'react'
import { api, hasToken, loadPhoto } from './api.js'
import { DEMO_LIVE } from './data.js'
import { Ic, DogAv } from './ui.jsx'
import { track } from './usage.js'
import { PING_MS, TODAY_POLL_MS, SHARE_LABEL, SHARE_RULES, DEMO_SHARE_NOTE, shareHelp, outFor, lastSeenText, isStale, headline, whereLine, todayLine } from './live.js'
import './live.css'

// Today -> Explore: "show me the friends who are out". Read once by Explore when it opens.
let intent = false
export const openLiveOnExplore = () => { intent = true }
export const takeLiveIntent = () => { const x = intent; intent = false; return x }

// Sample friends for the no-account demo. Fixed data from src/data.js: nothing is fetched.
export const demoLive = (dogName) => (DEMO_LIVE[String(dogName || '').toLowerCase()] || DEMO_LIVE.biscuit).map((f) => ({ ...f, demo: true }))

// Who is out now. Signed in, it asks the server every `everyMs` while this document is visible, and only
// while the screen using it is mounted. In the demo it returns the samples and never touches the network.
export function useLiveFriends({ on = true, demo, dogName, everyMs }) {
  const [list, setList] = useState(() => (on && demo ? demoLive(dogName) : []))
  const [photos, setPhotos] = useState({})
  useEffect(() => {
    if (!on) { setList([]); return }
    if (demo) { setList(demoLive(dogName)); return }
    if (!hasToken()) { setList([]); return }
    let alive = true, busy = false
    const load = async () => {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      // A list that cannot be refreshed is dropped rather than left showing where someone used to be.
      try { const r = await api.live.friends(); if (alive) setList(r && Array.isArray(r.friends) ? r.friends : []) } catch (e) { if (alive) setList([]) }
      busy = false
    }
    load()
    const t = setInterval(load, everyMs)
    const vis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', vis)
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [on, demo, dogName, everyMs])
  // Photos are fetched once each and shown from memory, like every other dog photo in the app.
  useEffect(() => {
    let alive = true
    list.forEach((f) => { if (f.photoUrl && !photos[f.photoUrl]) loadPhoto(f.photoUrl).then((src) => { if (alive) setPhotos((p) => (p[f.photoUrl] ? p : { ...p, [f.photoUrl]: src })) }, () => {}) })
    return () => { alive = false }
  }, [list])
  return list.map((f) => (f.photoUrl && photos[f.photoUrl] ? { ...f, photo: photos[f.photoUrl] } : f))
}

// The walker's choice for this walk. It starts from the account's default (off unless they changed it)
// and stays wherever the person last put it.
export function useShareChoice(account) {
  const [share, setShareState] = useState(false)
  const touched = useRef(false)
  useEffect(() => {
    if (!account || !hasToken()) return
    let on = true
    api.live.settings().then((r) => { if (on && !touched.current && r && r.shareByDefault) setShareState(true) }, () => {})
    return () => { on = false }
  }, [account])
  return [share, (v) => { touched.current = true; setShareState(!!v) }]
}

// Sends a shared walk's position. `active` is true only for a real Live GPS walk that is running with
// sharing on. The first good fix starts it, with the walk's own first point as the hidden start. After
// that the newest fix goes up about every 15 seconds. Turning it off, finishing, discarding or leaving
// the screen stops it. Nothing here throws, so a failure never touches the recording.
// status: 'off' | 'waiting' (no GPS fix yet) | 'live' | 'hidden' (near the start) | 'retry' | 'refused'
export function useLiveShare({ active, dogSlug, activity, fixes, sec }) {
  const [state, setState] = useState({ status: 'off', error: '' })
  const ref = useRef({})
  ref.current = { active, dogSlug, activity, fixes, sec }
  const run = useRef({ started: false, busy: false, lastSent: 0, refused: false })
  useEffect(() => {
    const R = run.current
    if (!active) return
    R.refused = false
    setState({ status: 'waiting', error: '' })
    const tick = async () => {
      const c = ref.current
      if (!c.active || R.busy || R.refused) return
      const fx = c.fixes
      if (!fx || !fx.length) return
      R.busy = true
      try {
        if (!R.started) {
          await api.live.start({ dog: c.dogSlug, activity: c.activity, lat: fx[0].at[0], lng: fx[0].at[1], elapsedSeconds: Math.max(0, Math.round(c.sec || 0)) })
          R.started = true; R.lastSent = 0
          track('live_share_started')
          // Turned off while the start was on its way: take it straight back down.
          if (!ref.current.active) { R.started = false; api.live.stop().catch(() => {}) }
        }
        if (R.started && ref.current.active && Date.now() - R.lastSent >= PING_MS - 600) {
          const last = ref.current.fixes[ref.current.fixes.length - 1]
          const r = await api.live.ping(last.at)
          R.lastSent = Date.now()
          if (ref.current.active) setState({ status: r && r.visible ? 'live' : 'hidden', error: '' })
        }
      } catch (e) {
        // 404: the server already ended it (ten minutes with the screen off). It starts again on the next tick.
        if (e && e.status === 404) R.started = false
        else if (e && (e.status === 400 || e.status === 403)) { R.refused = true; if (ref.current.active) setState({ status: 'refused', error: e.message || 'This walk cannot be shared.' }) }
        else if (ref.current.active) setState({ status: 'retry', error: '' })
      }
      R.busy = false
    }
    tick()
    const t = setInterval(tick, 3000)
    return () => {
      clearInterval(t)
      setState({ status: 'off', error: '' })
      if (R.started) { R.started = false; track('live_share_stopped'); api.live.stop().catch(() => {}) }
    }
  }, [active])
  // Leaving the screen or closing the page: the stop is sent in a way that survives the page going away.
  useEffect(() => {
    const bye = () => { if (run.current.started) { run.current.started = false; api.live.stopNow() } }
    window.addEventListener('pagehide', bye)
    return () => { window.removeEventListener('pagehide', bye); bye() }
  }, [])
  return state
}
const STATUS_TEXT = { waiting: 'Starts with the first good GPS fix.', live: 'Friends can see where you are now.', hidden: 'Hidden for now. You are near where you started.', retry: 'No connection. Trying again.' }

// The switch on the walk screen, before the walk and during it. `status` is given while a walk is running.
// In the demo it stays off and says why.
export function ShareToggle({ dog, account, on, onChange, dark, status }) {
  const [note, setNote] = useState(false)
  const id = dark ? 'lv-share-run' : 'lv-share-setup'
  const text = !account ? (note ? DEMO_SHARE_NOTE : shareHelp(dog)) : status && status.status === 'refused' ? status.error : on && status && STATUS_TEXT[status.status] ? STATUS_TEXT[status.status] : shareHelp(dog)
  return (
    <label className={`switch lv-share ${dark ? 'lv-dark' : ''}`}>
      <input type="checkbox" role="switch" checked={!!account && !!on} aria-describedby={id} onChange={(e) => { if (!account) { setNote(true); return } onChange(e.target.checked) }} />
      <span className="grow"><b>{SHARE_LABEL}</b><small id={id} role={(!account && note) || (status && status.status !== 'off') ? 'status' : undefined}>{text}</small></span>
    </label>
  )
}
// The indicator that stays on screen while a walk is being shared. Tapping it stops sharing.
export function SharingPill({ status, onStop }) {
  const s = status.status
  return (
    <button type="button" className={`lv-live ${s === 'live' ? '' : 'lv-wait'}`} onClick={onStop} aria-label={`${s === 'live' ? 'Sharing live with friends' : s === 'hidden' ? 'Sharing with friends, hidden near your start' : 'Sharing with friends is on'}. Tap to stop sharing`}>
      <span className="lv-dot" aria-hidden="true" /><span role="status">{s === 'hidden' ? 'Sharing, hidden here' : s === 'retry' ? 'Sharing, reconnecting' : s === 'waiting' ? 'Sharing, waiting for GPS' : 'Sharing live'}</span><b>Stop</b>
    </button>
  )
}

const LiveAv = ({ f, s = 44 }) => <DogAv name={f.name} photoUrl={f.photoUrl} demo={!!f.demo} s={s} bg="#0F1B2D" c="#C8F031" />

// Today: one quiet line when a friend is out, nothing at all when nobody is.
export function LiveNow({ demo, dogName, onOpen }) {
  const list = useLiveFriends({ demo, dogName, everyMs: TODAY_POLL_MS })
  const line = todayLine(list)
  if (!line) return null
  return (
    <button type="button" className="lv-now" onClick={onOpen} aria-label={`${line}. Opens the map with friends who are out`}>
      <span className="lv-dot" aria-hidden="true" /><span className="grow"><b>{line}</b><small>{demo ? 'Sample friends. See them on the map' : 'See friends on the map'}</small></span><Ic n="map" s={20} c="#1F5AE8" />
    </button>
  )
}

// Explore, in the list: friends who are out. One with a position opens its pin; one without is just listed.
export function LiveList({ list, demo, onPick }) {
  if (!list.length) return null
  return (
    <div className="lv-list" role="group" aria-label="Friends out now">
      <div className="row between"><h2>Friends out now</h2>{demo && <span className="tagx">Sample friends</span>}</div>
      {list.map((f) => f.position
        ? <button key={f.slug} type="button" className="rrow lv-row" onClick={() => onPick(f)}><LiveAv f={f} /><span className="grow"><b>{headline(f)}</b><small>{[outFor(f), whereLine(f), lastSeenText(f)].filter(Boolean).join(' · ')}</small></span><Ic n="map" s={18} c="#1F5AE8" /></button>
        : <div key={f.slug} className="rrow lv-row"><LiveAv f={f} /><span className="grow"><b>{headline(f)}</b><small>{outFor(f)} · Out on a walk. No position is shown near where a walk starts.</small></span></div>)}
    </div>
  )
}

// Explore, for a tapped pin. `walk` is null or { status: 'locating' | 'routing' | 'ready' | 'nofix', route, reason, help }.
export function LiveSheet({ f, close, walk, onWalk, onClearWalk }) {
  const seen = lastSeenText(f)
  return (<>
    <div className="row between top g10">
      <LiveAv f={f} s={48} />
      <div className="grow"><h2>{headline(f)}</h2><div className="meta">{[outFor(f), f.place ? `near ${f.place}` : '', f.activity && f.activity !== 'Walk' ? f.activity : ''].filter(Boolean).join(' · ')}</div>{seen && <div className="meta lv-seen">{seen}</div>}</div>
      <button className="round" aria-label={`Close ${f.name}`} onClick={close}><Ic n="x" s={18} /></button>
    </div>
    <div className="meta">{f.demo ? 'Sample friend. In the real app this is a friend whose dog and yours follow each other, shown only while they are out on a shared walk.' : `The pin is rounded to about 11 metres and moves every 20 seconds or so. It goes away when ${f.with ? `${f.with} finishes` : 'the walk ends'}.`}</div>
    {walk && (walk.status === 'locating' || walk.status === 'routing') && <div className="mload" role="status"><span className="spin" aria-hidden="true" />{walk.status === 'locating' ? 'Finding you' : 'Finding a way there'}</div>}
    {walk && walk.status === 'nofix' && <div className="mnote" role="alert"><span className="grow">{walk.help}</span><button onClick={onWalk}>Try again</button></div>}
    {walk && walk.status === 'ready' && <div className="rsum" role="status"><b>{walk.route.miles.toFixed(2)} mi</b><span>about {walk.route.minutes} min on foot to where {f.name} was just now{walk.route.approximate ? '. Straight line, not a mapped path' : ''}</span></div>}
    {walk && walk.status === 'ready'
      ? <button className="cta white bordered" onClick={onClearWalk}>Clear the route</button>
      : <button className="cta" disabled={!!walk && (walk.status === 'locating' || walk.status === 'routing')} onClick={onWalk}>Walk to them</button>}
  </>)
}

// Settings: the account default, with the rules in three short lines.
export function LiveShareSetting({ real, setToast }) {
  const [on, setOn] = useState(false), [busy, setBusy] = useState(false), [ready, setReady] = useState(!real)
  useEffect(() => {
    if (!real) return
    let alive = true
    api.live.settings().then((r) => { if (alive) { setOn(!!(r && r.shareByDefault)); setReady(true) } }, () => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [!!real])
  const change = async (v) => {
    if (!real) { setToast(DEMO_SHARE_NOTE); return }
    if (busy) return
    setBusy(true); setOn(v)
    try { const r = await api.live.setDefault(v); setOn(!!r.shareByDefault); setToast(r.shareByDefault ? 'New Live GPS walks start with sharing on' : 'New walks start with sharing off') }
    catch (e) { setOn(!v); setToast(e.message || 'That did not save. Try again.') }
    setBusy(false)
  }
  return (
    <section className="card padc setsec" aria-labelledby="set-live">
      <h2 className="eyebrow dark" id="set-live">WALKS WITH FRIENDS</h2>
      <label className="switch"><input type="checkbox" role="switch" checked={!!real && on} disabled={busy || !ready} aria-describedby="set-live-rules" onChange={(e) => change(e.target.checked)} /><span className="grow"><b>Share my walks with friends by default</b><small>Off unless you turn it on. You can still change it for each walk on the walk screen.{real ? '' : ' Needs an account. The demo shows sample friends only.'}</small></span></label>
      <ul className="lv-rules" id="set-live-rules">{SHARE_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
    </section>
  )
}
