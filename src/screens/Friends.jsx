import React, { useEffect, useRef, useState } from 'react'
import { Ic, DogAv, Confirm, copyText, daysAgoOf } from '../ui.jsx'
import { api, clearFriend } from '../api.js'
import { PACK, DEMO_BOARD, DEMO_DOGS, DEMO_FRIENDS, DEMO_MUTUAL, dayLabel } from '../data.js'
import './friends.css'
import { track } from '../usage.js'

// Dog friends. A dog follows other dogs: "friends" here means the dogs this dog follows, and when both
// follow each other the app says "Friends with each other". Trot is a web app, so it cannot read the
// phone's contacts. Friends are found by dog name, from dogs nearby, or by sending an invite link.
export const NO_CONTACTS = 'Trot is a web app, so it cannot read your phone\'s contacts. Find friends by dog name, pick from dogs nearby, or send your invite link.'
const NEEDS_ACCOUNT = 'Friends need an account. This demo shows sample friends only.'

// One short line about a friend's last outing: "Out today with Pat", "Last out Tuesday".
export function friendLine(o) {
  if (!o) return 'No outings yet'
  const d = o.daysAgo != null ? o.daysAgo : daysAgoOf(o.startedAt)
  if (d === 0) return o.with ? `Out today ${o.type === 'Daycare' ? 'at' : 'with'} ${o.with}` : 'Out today'
  if (d === 1) return 'Last out yesterday'
  if (d < 7) return `Last out ${dayLabel(d)}`
  return `Last out ${new Date(o.startedAt || Date.now() - d * 864e5).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}
const sub = (f) => [f.breed, f.city].filter(Boolean).join(' · ')
const FAv = ({ f, s = 56 }) => <DogAv name={f.name} photoUrl={f.photoUrl} demo={!!f.demo} s={s} bg="#0F1B2D" c="#C8F031" />

// ---- the two sources: the API when signed in, static samples in the demo -------------
// Both give the screens the same model: { dogName, friends, suggestions, canManage, invite, add, remove, search, openDog, open, demo }.
export function realFriendsModel(real, setToast) {
  const f = real.friends
  return {
    dogName: real.dog.name, demo: false, loading: !f.loaded, friends: f.list, suggestions: f.suggestions, canManage: f.canManage, invite: f.invite, isPublic: real.dog.public,
    open: f.open, add: f.add, remove: f.remove,
    search: async (q) => (await api.friends.search(q, real.dog.slug)).dogs,
    openDog: (d) => window.open(`/d/${d.slug}`, '_blank', 'noopener'),
    hrefOf: (d) => `/d/${d.slug}`,
    setToast,
  }
}
const demoBreed = (name) => { const own = Object.values(DEMO_DOGS).find((d) => d.dog.name === name); const p = PACK.find((x) => x.dog === name), b = DEMO_BOARD.find((x) => x.name === name); return own ? own.dog.breed : (p && p.breed) || (b && b.breed) || '' }
const demoLast = (name) => {
  const own = Object.values(DEMO_DOGS).find((d) => d.dog.name === name)
  const a = own ? own.seed[0] : PACK.find((x) => x.dog === name)
  return a ? { daysAgo: a.daysAgo, type: a.type, title: a.title, place: a.place, with: a.byName || (a.by ? a.by[0].toUpperCase() + a.by.slice(1) : '') } : null
}
const demoDogItem = (name, me) => ({ key: name, slug: name, name, breed: demoBreed(name), city: 'Charlotte, NC', demo: true, lastOuting: demoLast(name), mutual: (DEMO_MUTUAL[me] || []).includes(name), sameCity: true })
export function demoFriendsModel(dd, { setToast, onDog, open }) {
  const names = DEMO_FRIENDS[dd.key] || []
  const others = [...new Set([...PACK.map((x) => x.dog), ...DEMO_BOARD.map((x) => x.name), ...Object.values(DEMO_DOGS).map((d) => d.dog.name)])].filter((n) => n !== dd.dog.name && !names.includes(n))
  const needs = async () => { setToast(NEEDS_ACCOUNT); return { error: NEEDS_ACCOUNT, soft: true } }
  return {
    dogName: dd.dog.name, demo: true, loading: false, friends: names.map((n) => demoDogItem(n, dd.key)), suggestions: others.map((n) => demoDogItem(n, dd.key)), canManage: true, invite: null, isPublic: true,
    open, add: needs, remove: needs,
    search: async (q) => [...names, ...others].filter((n) => n.toLowerCase().startsWith(q.toLowerCase())).slice(0, 10).map((n) => ({ ...demoDogItem(n, dd.key), following: names.includes(n) })),
    openDog: (d) => onDog(d.name), hrefOf: null, setToast,
  }
}
// The demo's Friends feed: sample outings from the selected dog's friends.
export function demoFriendActs(dd) {
  const names = DEMO_FRIENDS[dd.key] || []
  const own = Object.values(DEMO_DOGS).filter((d) => d.key !== dd.key && names.includes(d.dog.name)).flatMap((d) => d.seed.slice(0, 3))
  const seen = new Set(own.map((a) => a.id))
  return [...own, ...PACK.filter((x) => names.includes(x.dog) && !seen.has(x.id))].sort((a, b) => a.daysAgo - b.daysAgo)
}

// A friend's avatar and name open that dog's page: the public page when signed in, the sample profile in the demo.
function DogLink({ m, d, className, children, label }) {
  const text = label || `Open ${d.name}'s ${m.demo ? 'profile' : 'public page'}`
  return m.hrefOf ? <a className={className} href={m.hrefOf(d)} target="_blank" rel="noopener" aria-label={text}>{children}</a> : <button type="button" className={className} onClick={() => m.openDog(d)} aria-label={text}>{children}</button>
}

// ---- Today: a row of friends, or a few suggestions when there are none yet ---------------
export function FriendsRow({ m }) {
  const [busy, setBusy] = useState('')
  if (m.loading) return null
  const add = async (d) => { if (busy) return; setBusy(d.slug); await m.add(d); setBusy('') }
  const some = m.friends.length > 0
  const ideas = m.suggestions.slice(0, 3)
  if (!some && !ideas.length && !m.canManage) return null
  return (
    <section className="tsec" aria-label={`${m.dogName}'s friends`}>
      <div className="row between thead"><h2>{m.dogName}'s friends</h2><button className="tlink" onClick={m.open}>{some ? 'All friends' : 'Find friends'}</button></div>
      {some
        ? <div className="tscroll frow">{m.friends.map((f) => (
          <DogLink key={f.slug} m={m} d={f} className="tfriend" label={`${f.name}. ${friendLine(f.lastOuting)}. Opens ${f.name}'s ${m.demo ? 'profile' : 'public page'}`}>
            <FAv f={f} s={60} /><b>{f.name}</b><small>{friendLine(f.lastOuting)}</small>
          </DogLink>
        ))}<button className="tfriend addmore" onClick={m.open} aria-label="Find more friends"><span className="fplus"><Ic n="plus" s={22} c="#1F5AE8" /></span><b>Find friends</b><small>By name or link</small></button></div>
        : <div className="fempty">
          <p className="meta">{m.dogName} has no friends on Trot yet.{ideas.length && m.canManage ? (ideas.some((d) => d.sameCity) ? ' Here are a few dogs nearby.' : ' Here are a few dogs on Trot.') : ''}</p>
          {m.canManage && ideas.map((d) => (
            <div key={d.slug} className="card fsug">
              <DogLink m={m} d={d} className="fwho"><FAv f={d} s={44} /><span className="grow"><b>{d.name}{d.isDemo && <span className="tagx">Demo dog</span>}</b><small>{sub(d) || friendLine(d.lastOuting)}</small></span></DogLink>
              <button className="cta small" onClick={() => add(d)} disabled={!!busy} aria-label={`Add ${d.name} as a friend`}>{busy === d.slug ? 'Adding' : 'Add'}</button>
            </div>
          ))}
          {!m.canManage && <p className="meta">Only the owner and family can add friends for {m.dogName}.</p>}
        </div>}
    </section>
  )
}

// "Add friend" / "Friends" on another dog's card or profile sheet.
export function FriendToggle({ m, d, small = true }) {
  const [busy, setBusy] = useState(false)
  if (!m || m.loading || !m.canManage) return null
  const on = m.friends.some((f) => f.slug === d.slug)
  const go = async () => { if (busy) return; setBusy(true); await (on ? m.remove(d) : m.add(d)); setBusy(false) }
  return <button type="button" className={`cta ${small ? 'small' : ''} ftoggle ${on ? 'white bordered' : ''}`} aria-pressed={on} onClick={go} disabled={busy} aria-label={on ? `${m.dogName} and ${d.name} are friends. Tap to remove` : `Add ${d.name} as a friend of ${m.dogName}`}>{on ? <><Ic n="check" s={16} />Friends</> : <><Ic n="plus" s={16} />Add friend</>}</button>
}

// ---- the Friends screen: list, search, suggestions and the invite link -------------------
function Row({ m, d, action }) {
  return (
    <div className="frowitem">
      <DogLink m={m} d={d} className="fwho"><FAv f={d} s={44} /><span className="grow"><b>{d.name}{d.isDemo && <span className="tagx">Demo dog</span>}</b><small>{sub(d)}</small><small>{d.mutual ? 'Friends with each other · ' : d.followsYou ? `Added ${m.dogName} as a friend · ` : ''}{friendLine(d.lastOuting)}</small></span></DogLink>
      {action}
    </div>
  )
}
export default function FriendsScreen({ m, close }) {
  const back = useRef(null)
  const [q, setQ] = useState(''), [found, setFound] = useState(null), [searching, setSearching] = useState(false), [serr, setSerr] = useState('')
  const [ask, setAsk] = useState(null), [busy, setBusy] = useState('')
  useEffect(() => { if (back.current) back.current.focus() }, [])
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') close() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [close])
  // Search waits for a pause in typing, so one name is one request, not one per letter.
  const term = q.replace(/\s+/g, ' ').trim()
  useEffect(() => {
    setSerr('')
    if (term.length < 2) { setFound(null); setSearching(false); return }
    let on = true
    setSearching(true)
    const t = setTimeout(() => { m.search(term).then((list) => { if (on) { setFound(list); setSearching(false) } }, (e) => { if (on) { setSerr(e.message); setFound(null); setSearching(false) } }) }, 350)
    return () => { on = false; clearTimeout(t) }
  }, [term, m.friends.length])
  const add = async (d) => { if (busy) return; setBusy(d.slug); await m.add(d); setBusy('') }
  const remove = async () => {
    const a = ask
    if (!a || a.busy) return
    setAsk({ ...a, busy: true, error: '' })
    const r = await m.remove(a.d)
    if (r && r.error && !r.soft) { setAsk({ ...a, busy: false, error: r.error }); return }
    setAsk(null)
  }
  const isFriend = (d) => m.friends.some((f) => f.slug === d.slug)
  const addBtn = (d) => (m.canManage ? (isFriend(d) || d.following ? <span className="fdone"><Ic n="check" s={16} c="#1F5AE8" />Friends</span> : <button className="cta small" onClick={() => add(d)} disabled={!!busy} aria-label={`Add ${d.name} as a friend`}>{busy === d.slug ? 'Adding' : 'Add'}</button>) : null)
  const copy = async () => { const ok = await copyText(m.invite.url); if (ok) track('invite_link_copied'); m.setToast(ok ? 'Invite link copied' : 'Copy did not work here. Select the link and copy it.') }
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const share = async () => { try { await navigator.share({ title: `${m.dogName} on Trot`, text: `Add ${m.dogName} as a friend on Trot`, url: m.invite.url }) } catch (e) { if (!e || e.name !== 'AbortError') copy() } }
  return (
    <div className="detail" role="dialog" aria-modal="true" aria-label={`${m.dogName}'s friends`}>
      <header className="dhead"><button ref={back} className="round flat" aria-label="Back" onClick={close}><Ic n="back" /></button><b>{m.dogName}'s friends</b><span className="round flat" aria-hidden="true" /></header>
      <div className="scroll">
        <div className="list">
          {m.demo && <p className="meta padx">Sample friends for the demo. Adding and removing friends needs an account.</p>}
          {!m.canManage && <p className="meta padx">Only the owner and family can change {m.dogName}'s friends. You can still see them.</p>}
          <div className="card padc">
            <div className="eyebrow dark">FRIENDS{m.friends.length ? ` · ${m.friends.length}` : ''}</div>
            {m.loading && <p className="meta" role="status">Fetching {m.dogName}'s friends</p>}
            {!m.loading && m.friends.length === 0 && <p className="meta">No friends yet. Friends are the dogs {m.dogName} follows. Their outings show up under Friends on the Today screen.</p>}
            {m.friends.map((f) => (
              <div key={f.slug} className="fblock">
                <Row m={m} d={f} action={m.canManage && !(ask && ask.d.slug === f.slug) ? <button className="tbtn" onClick={() => setAsk({ d: f })} aria-label={`Remove ${f.name} from ${m.dogName}'s friends`}>Remove</button> : null} />
                {ask && ask.d.slug === f.slug && <Confirm text={`Remove ${f.name} from ${m.dogName}'s friends? ${f.name}'s outings leave the Friends feed. ${f.name}'s people are not told.`} yes="Remove friend" no="Keep" busy={ask.busy} error={ask.error} onYes={remove} onNo={() => setAsk(null)} />}
              </div>
            ))}
          </div>
          <div className="card padc">
            <div className="eyebrow dark">FIND A DOG BY NAME</div>
            <div className="field lightf"><label htmlFor="friend-q">Dog's name</label><input id="friend-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={40} autoComplete="off" placeholder="Type at least 2 letters" aria-describedby="friend-q-note" /></div>
            <p className="fhint" id="friend-q-note">{NO_CONTACTS} Only dogs with a public page can be found.</p>
            {serr && <p className="formerr" role="alert">{serr}</p>}
            <div aria-live="polite">
              {searching && <p className="meta">Searching</p>}
              {!searching && found && found.length === 0 && <p className="meta">No public dog has a name starting with "{term}". Check the spelling, or send your invite link instead.</p>}
              {!searching && found && found.map((d) => <Row key={d.slug} m={m} d={d} action={addBtn(d)} />)}
            </div>
          </div>
          {m.suggestions.length > 0 && <div className="card padc">
            <div className="eyebrow dark">SUGGESTIONS</div>
            <p className="meta">Public dogs {m.dogName} does not follow yet. Dogs in the same city come first, then the ones that were out most recently.</p>
            {m.suggestions.map((d) => <Row key={d.slug} m={m} d={d} action={addBtn(d)} />)}
          </div>}
          <div className="card padc">
            <div className="eyebrow dark">INVITE LINK</div>
            {m.invite ? <>
              <p className="meta">Send this to a friend. It opens {m.dogName}'s public page with an "Add {m.dogName} as a friend" button, so their dog can follow {m.dogName}. To follow them back, add their dog here.</p>
              <label className="field lightf"><span>{m.dogName}'s invite link</span><input className="linkinput" readOnly value={m.invite.url} onFocus={(e) => e.target.select()} /></label>
              <div className="row g8"><button className="cta small" onClick={copy}><Ic n="link" s={18} c="#0F1B2D" />Copy link</button>{canShare && <button className="cta small white bordered" onClick={share}><Ic n="share" s={18} />Share</button>}</div>
            </> : m.demo
              ? <p className="meta">With an account, {m.dogName} gets a link to send to friends. It opens {m.dogName}'s public page with an "Add {m.dogName} as a friend" button.</p>
              : <p className="meta">{m.dogName}'s page is private, so there is no link to send and other dogs cannot follow {m.dogName}. The owner can make the page public in Settings.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- arriving from an invite link: /?friend=<address> ------------------------------------
// Asks which of this person's dogs is making friends, then adds the follow. Only dogs they own or are family to can.
export function FriendConfirm({ target, real, done }) {
  const mine = real.dogs.filter((d) => (d.role === 'owner' || d.role === 'family') && d.slug !== target.slug)
  const [pick, setPick] = useState(() => (mine.find((d) => d.slug === real.dog.slug) || mine[0] || {}).slug)
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const from = mine.find((d) => d.slug === pick)
  const own = real.dogs.some((d) => d.slug === target.slug)
  const leave = () => { clearFriend(); done('') }
  const go = async () => {
    if (busy || !from) return
    setBusy(true); setErr('')
    const r = await real.friends.add(target, from.slug, { quiet: true })
    if (r.error) { setErr(r.error); setBusy(false); return }
    clearFriend()
    done(r.friend.mutual ? `${from.name} and ${target.name} are now friends with each other` : `${target.name} is now one of ${from.name}'s friends`)
  }
  return (
    <div className="scrim" onClick={busy ? undefined : leave}><div className="modal" role="dialog" aria-modal="true" aria-label={`Add ${target.name} as a friend`} onClick={(e) => e.stopPropagation()}>
      <div className="grab" />
      <div className="row g14"><DogAv name={target.name} photoUrl={target.photoUrl} s={64} bg="#0F1B2D" c="#C8F031" /><div className="grow"><h2>{from ? `Make ${from.name} friends with ${target.name}?` : `Add ${target.name} as a friend`}</h2><p className="meta">{[target.breed, target.city].filter(Boolean).join(' · ')}</p></div></div>
      {from ? <>
        {mine.length > 1 && <><p>Which of your dogs is making friends?</p><div className="chips wrap" role="group" aria-label="Your dog">{mine.map((d) => <button key={d.slug} className={`chip flat ${d.slug === pick ? 'on' : ''}`} aria-pressed={d.slug === pick} onClick={() => setPick(d.slug)}>{d.name}</button>)}</div></>}
        <p>{target.name}'s public outings will show under Friends on {from.name}'s Today screen. {target.name}'s people are not told, and you can remove the friend at any time.</p>
        {err && <p className="formerr" role="alert">{err}</p>}
        <button className="cta" onClick={go} disabled={busy}>{busy ? 'Adding' : 'Add friend'}</button>
      </> : <p>{own ? `${target.name} is your own dog. A dog cannot be its own friend, and you have no other dog here to add ${target.name} to.` : `Only a dog's owner or family can add friends for it. Ask the owner of the dog you walk to add ${target.name}.`}</p>}
      <button className="cta white bordered" onClick={leave} disabled={busy}>{from ? 'Not now' : 'Close'}</button>
    </div></div>
  )
}
