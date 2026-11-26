import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Ic, Paw } from '../ui.jsx'
import { api } from '../api.js'
import { track } from '../usage.js'
import '../notify.css'

// The in-app notification center. Signed in it reads the server's list; in the demo it shows a few
// samples that cannot be changed. Nothing here is a push, an email or a text.
const NEEDS_ACCOUNT = 'Notifications need an account. This demo shows samples only.'
const ICON = { friend_added: 'users', friend_mutual: 'users', care_invite_accepted: 'heart', care_walk_logged: 'play', found_report: 'tag', registration_due: 'file', claim_approved: 'map', claim_rejected: 'map', event_reminder: 'trophy', welcome: 'home' }
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
export function ago(iso, now = Date.now()) {
  const d = new Date(iso), s = Math.max(0, Math.round((now - d.getTime()) / 1000))
  if (Number.isNaN(d.getTime())) return ''
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} ${Math.floor(s / 86400) === 1 ? 'day' : 'days'} ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
// Sample rows for the demo, about whichever demo dog is showing.
export function demoNotifications(name, now = Date.now()) {
  const at = (h) => new Date(now - h * 3600e3).toISOString()
  return [
    { id: 'd1', kind: 'found_report', priority: 'high', title: `Someone found ${name}`, body: `A sample of what arrives when a finder taps ${name}'s Trot Tag while Lost Dog mode is on.`, createdAt: at(0.3), read: false, link: { to: 'tag' } },
    { id: 'd2', kind: 'friend_added', priority: 'normal', title: `Juniper added ${name} as a friend`, body: `Add Juniper back to see their outings in ${name}'s friends feed.`, createdAt: at(2), read: false, link: { to: 'friends' }, action: { type: 'add_back', otherName: 'Juniper', done: false } },
    { id: 'd3', kind: 'paw', priority: 'normal', title: `Pat and 2 others pawed ${name}'s outing`, body: 'Morning loop', createdAt: at(5), read: true, link: { to: 'today' } },
    { id: 'd4', kind: 'care_walk_logged', priority: 'normal', title: `Sue logged a walk for ${name}`, body: 'Midday loop · 32 min · 1.4 mi', createdAt: at(27), read: true, link: { to: 'today' } },
    { id: 'd5', kind: 'registration_due', priority: 'normal', title: `${name}'s license expires soon`, body: 'Renew it, then update the date in Registration and ID.', createdAt: at(70), read: true, link: { to: 'registration' } },
  ]
}

function Row({ n, onOpen, onRemove, onRead, onAct, busy, readOnly }) {
  const [menu, setMenu] = useState(false)
  const high = n.priority === 'high'
  // A sideways swipe opens the same small menu the button does, so nothing depends on a gesture.
  const x0 = useRef(null)
  const start = (e) => { x0.current = e.touches && e.touches[0] ? e.touches[0].clientX : null }
  const end = (e) => { const t = e.changedTouches && e.changedTouches[0]; if (x0.current != null && t && x0.current - t.clientX > 60) setMenu(true); x0.current = null }
  return <li className={`nrow ${n.read ? '' : 'unread'} ${high ? 'high' : ''}`} onTouchStart={start} onTouchEnd={end}>
    <div className="nwrap">
      <button className="nmain" onClick={() => onOpen(n)} aria-label={`${n.read ? '' : 'Unread. '}${n.title}. ${n.body}`}>
        <span className="nicon" aria-hidden="true">{n.kind === 'paw' ? <Paw s={20} c="#1F5AE8" /> : <Ic n={ICON[n.kind] || 'bell'} s={20} c={high ? '#C62828' : '#1F5AE8'} />}</span>
        <span className="ntext"><b>{n.title}</b>{n.body && <span>{n.body}</span>}<small>{ago(n.createdAt)}{n.dog && n.dog.name ? ` · ${n.dog.name}` : ''}</small></span>
        {!n.read && <span className="ndot" aria-hidden="true" />}
      </button>
      {n.action && n.action.type === 'add_back' && <div className="nact">{n.action.done
        ? <span className="badge on"><Ic n="check" s={14} />Friends with each other</span>
        : <button className="cta small" disabled={busy} onClick={() => onAct(n)}>{busy ? 'Adding' : `Add ${n.action.otherName || 'them'} back`}</button>}</div>}
      {menu && <div className="nmenu" role="group" aria-label="Notification options">
        {!n.read && <button onClick={() => { setMenu(false); onRead(n) }}>Mark read</button>}
        <button className="danger" onClick={() => { setMenu(false); onRemove(n) }}>Remove</button>
        <button onClick={() => setMenu(false)}>Cancel</button>
      </div>}
    </div>
    <button className="nmore" aria-label={`Options for: ${n.title}`} aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Ic n={menu ? 'x' : 'more'} s={20} /></button>
  </li>
}

// `go(link)` takes the person where the notification points. `onUnread(n)` keeps the bell's number in step.
export default function Notifications({ close, real, demoName, setToast, go, onUnread }) {
  const demo = !real
  const back = useRef(null), alive = useRef(true)
  const [items, setItems] = useState(demo ? demoNotifications(demoName || 'Biscuit') : null)
  const [next, setNext] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(''), [more, setMore] = useState(false)
  useEffect(() => { if (back.current) back.current.focus() }, [])
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') close() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [close])
  const load = useCallback(async () => {
    if (demo) return
    setError('')
    try { const r = await api.notifications.list(); if (!alive.current) return; setItems(r.items || []); setNext(r.nextBefore || null); onUnread(r.unread || 0) }
    catch (e) { if (alive.current) setError((e && e.message) || 'Notifications could not be loaded.') }
  }, [demo])
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false } }, [load])
  const older = async () => {
    if (!next || more) return
    setMore(true)
    try { const r = await api.notifications.list(next); if (alive.current) { setItems((l) => [...l, ...(r.items || []).filter((x) => !l.some((y) => y.id === x.id))]); setNext(r.nextBefore || null) } }
    catch (e) { setToast(e.message) }
    if (alive.current) setMore(false)
  }
  const markRead = async (n) => {
    if (demo) { setToast(NEEDS_ACCOUNT); return }
    if (n.read) return
    setItems((l) => l.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
    try { const r = await api.notifications.read([n.id]); onUnread(r.unread || 0) } catch (e) { /* the next refresh settles it */ }
  }
  const open = (n) => {
    track('notification_opened', { kind: n.kind })
    if (demo) { setToast(NEEDS_ACCOUNT); return }
    markRead(n)
    if (n.link && n.link.to) { close(); go(n.link, n) }
  }
  const remove = async (n) => {
    if (demo) { setToast(NEEDS_ACCOUNT); return }
    const before = items
    setItems((l) => l.filter((x) => x.id !== n.id))
    try { const r = await api.notifications.remove(n.id); onUnread(r.unread || 0) }
    catch (e) { if (e.status !== 404) { setItems(before); setToast(e.message) } }
  }
  const allRead = async () => {
    if (demo) { setToast(NEEDS_ACCOUNT); return }
    if (busy) return
    setBusy('all')
    try { const r = await api.notifications.readAll(); if (alive.current) { setItems((l) => l.map((x) => ({ ...x, read: true }))); onUnread(r.unread || 0) } }
    catch (e) { setToast(e.message) }
    if (alive.current) setBusy('')
  }
  const act = async (n) => {
    if (demo) { setToast(NEEDS_ACCOUNT); return }
    if (busy) return
    setBusy(n.id)
    try {
      const r = await api.friends.add(n.action.dog, n.action.other)
      if (alive.current) setItems((l) => l.map((x) => (x.id === n.id ? { ...x, read: true, action: { ...x.action, done: true } } : x)))
      setToast(`${r.friend.name} is now a friend. You will see their outings in the friends feed.`)
      if (real.friends && real.friends.reload) real.friends.reload()
      const m = await api.notifications.read([n.id]); onUnread(m.unread || 0)
    } catch (e) { setToast(e.message) }
    if (alive.current) setBusy('')
  }
  const now = new Date()
  const today = (items || []).filter((n) => sameDay(new Date(n.createdAt), now)), earlier = (items || []).filter((n) => !sameDay(new Date(n.createdAt), now))
  const unread = (items || []).filter((n) => !n.read).length
  const group = (title, list, first) => list.length > 0 && <section aria-label={title}>
    <div className="nhead"><h2>{title.toUpperCase()}</h2>{first && <button className="nall" onClick={allRead} disabled={!unread || busy === 'all'}>Mark all read</button>}</div>
    <ul className="nlist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{list.map((n) => <Row key={n.id} n={n} onOpen={open} onRemove={remove} onRead={markRead} onAct={act} busy={busy === n.id} />)}</ul>
  </section>
  return (
    <div className="detail" role="dialog" aria-modal="true" aria-label="Notifications">
      <header className="dhead"><button ref={back} className="round flat" aria-label="Back" onClick={close}><Ic n="back" /></button><b>Notifications</b><span className="round flat" aria-hidden="true" /></header>
      <div className="scroll"><div className="list">
        {demo && <p className="meta padx">Sample notifications for the demo. They cannot be changed here.</p>}
        {error && <div className="mnote" role="alert"><span className="grow">{error}</span><button onClick={load}>Retry</button></div>}
        {!items && !error && <div className="card empty" role="status"><p>Loading</p></div>}
        {items && items.length === 0 && <div className="card empty"><b>You are all caught up</b><p>New friends, paws, care team activity, found reports and reminders will show up here.</p></div>}
        {group('Today', today, true)}
        {group('Earlier', earlier, today.length === 0)}
        {next && <button className="cta white bordered" onClick={older} disabled={more}>{more ? 'Loading' : 'Show older'}</button>}
        {items && <p className="meta padx">These show inside Trot only. No push, email or text is sent yet. You can choose what shows here in Settings, under Notifications.</p>}
      </div></div>
    </div>
  )
}
