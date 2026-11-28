import React, { useEffect, useState } from 'react'
import WelcomeHero from './WelcomeHero.jsx'
import { Paw } from '../ui.jsx'
import './friends.css'
import { api, setToken, getAuthConfig, pendingInvite, clearInvite, pendingFriend, clearFriend } from '../api.js'
import { CodeInput, useEmailCodes, useCountdown, clock, RESEND_SECONDS, CODE_LENGTH } from './CodeEntry.jsx'

// Accepts a pending invite for the signed-in person. Returns the dog's slug, or
// null with a message when the link is no longer good.
export async function acceptPendingInvite() {
  const t = pendingInvite()
  if (!t) return { slug: null }
  try {
    const r = await api.post(`/invites/${t}/accept`)
    clearInvite()
    return { slug: r.dog.slug, name: r.dog.name, already: r.already }
  } catch (e) {
    if (e.status && e.status !== 401 && e.status !== 429) clearInvite()
    return { slug: null, error: e.message }
  }
}

export function DogForm({ onDone, submitLabel = 'Create the page', light }) {
  const [f, setF] = useState({ name: '', breed: '', weight: '', bio: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    const w = f.weight.trim() === '' ? null : Number(f.weight)
    if (w !== null && (!Number.isFinite(w) || w < 0.5 || w > 400)) { setErr('Weight should be a number of pounds from 0.5 to 400.'); return }
    setBusy(true); setErr('')
    try {
      const r = await api.post('/dogs', { name: f.name, breed: f.breed, weight: w, bio: f.bio })
      onDone(r.dog)
    } catch (e2) { setErr(e2.message); setBusy(false) }
  }
  const cls = `field ${light ? 'lightf' : ''}`
  return (
    <form className="wform" onSubmit={submit}>
      <label className={cls}><span>Dog's name</span><input value={f.name} onChange={set('name')} required maxLength={40} autoComplete="off" /></label>
      <label className={cls}><span>Breed (optional)</span><input value={f.breed} onChange={set('breed')} maxLength={60} autoComplete="off" /></label>
      <label className={cls}><span>Weight in pounds (optional)</span><input value={f.weight} onChange={set('weight')} inputMode="decimal" maxLength={6} autoComplete="off" /></label>
      <label className={cls}><span>Bio (optional)</span><textarea value={f.bio} onChange={set('bio')} maxLength={280} rows={3} placeholder="Swims in anything. Carries one stick per walk." /></label>
      {err && <p className="formerr" role="alert">{err}</p>}
      <button className="cta" type="submit" disabled={busy}>{busy ? 'Saving' : submitLabel}</button>
    </form>
  )
}

// `signInFirst` opens straight on "Sign back in", with `notice` saying why (an old session was ended).
// `flash` is a line for the first screen, shown after an account was deleted.
export default function Welcome({ user, onDemo, onReady, notice, signInFirst, flash }) {
  const [step, setStep] = useState(user ? 'dog' : signInFirst ? 'account' : 'start')
  const [returning, setReturning] = useState(!!signInFirst)
  // Sign-in with an emailed code, when the server has it turned on. Otherwise the name-and-email sign-in.
  const known = useEmailCodes(signInFirst ? true : undefined)
  const [forced, setForced] = useState(false)
  const codes = forced || known === true
  const [code, setCode] = useState('')
  const [ticket, setTicket] = useState('')
  const [info, setInfo] = useState('')
  const [tries, setTries] = useState(0)
  const resend = useCountdown()
  const [f, setF] = useState({ name: '', email: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(notice || '')
  const [inv, setInv] = useState(null)
  const [token] = useState(pendingInvite)
  useEffect(() => {
    if (!token) return
    let on = true
    // A dead link is dropped right away so it does not bring this screen back on every load.
    api.get(`/invites/${token}`).then((r) => { if (!r.open) clearInvite(); if (on) setInv({ ...r, dead: !r.open }) }, (e) => { if (e.status === 404) clearInvite(); if (on) setInv({ open: false, dead: true }) })
    return () => { on = false }
  }, [token])
  const invited = !!(token && inv && inv.open)
  // Arrived from an "Add as a friend" link. The link is kept until this person is signed in with a dog.
  const [friend, setFriend] = useState(null)
  useEffect(() => {
    const f = pendingFriend()
    if (!f) return
    let on = true
    api.friends.publicDog(f).then((r) => on && setFriend(r.dog.name), (e) => { if (e.status === 404) clearFriend() })
    return () => { on = false }
  }, [])
  const friendNote = friend && <p className="wnote fnote" role="status">You can add {friend} as a friend once you are signed in{user ? ' and have a dog page of your own' : ''}. We will ask you right after.</p>
  // Signed in: join the team an invite was for, then go to the app, or to the dog step when there is no dog yet.
  const entered = async (s) => {
    setToken(s.token)
    const joined = await acceptPendingInvite()
    const me = await api.get('/me')
    if (me.dogs.length) onReady(me, joined.slug, joined.error)
    else { setErr(joined.error || ''); setBusy(false); setStep('dog') }
  }
  // Asks for a code to be emailed. The answer is the same whether or not the email has a page.
  const sendCode = async (again) => {
    setBusy(true); setErr(''); setInfo('')
    try {
      await api.auth.start(f.email)
      setCode(''); setStep('code'); setTries((n) => n + 1); resend.start(RESEND_SECONDS)
      if (again) setInfo('We sent a new code. The older one no longer works.')
    } catch (e2) {
      if (e2.status === 429 && e2.retryAfter) resend.start(e2.retryAfter)
      setErr(e2.message)
    }
    setBusy(false)
  }
  const signIn = async (e) => {
    e.preventDefault()
    if (busy) return
    let useCodes = codes
    if (known === null && !forced) { setBusy(true); useCodes = (await getAuthConfig()).emailCodes; if (useCodes) setForced(true) }
    if (useCodes) return sendCode(false)
    setBusy(true); setErr('')
    try {
      await entered(await api.post('/session', { name: f.name, email: f.email }))
    } catch (e2) {
      // The server turned email codes on since this page was loaded.
      if (e2.code === 'email_code_required') { setForced(true); return sendCode(false) }
      setErr(e2.message); setBusy(false)
    }
  }
  const needsName = !returning || invited
  const verify = async (value) => {
    const v = typeof value === 'string' ? value : code
    if (busy) return
    if (v.length !== CODE_LENGTH) { setErr('Enter the 6 digit code from the email.'); return }
    setBusy(true); setErr(''); setInfo('')
    try {
      const s = await api.auth.verify(f.email, v, needsName ? f.name : '')
      if (s.needName) { setTicket(s.ticket); setBusy(false); setStep('name'); return }
      await entered(s)
    } catch (e2) { setCode(''); setTries((n) => n + 1); setErr(e2.message); setBusy(false) }
  }
  const finishName = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr('')
    try { await entered(await api.auth.complete(ticket, f.name)) }
    catch (e2) {
      setBusy(false)
      // The 15 minutes to add a name ran out. Back to the email, with the reason.
      if (e2.code === 'ticket_expired') { setTicket(''); setStep('account') }
      setErr(e2.message)
    }
  }
  const otherEmail = () => { setErr(''); setInfo(''); setCode(''); setStep('account') }
  const dogDone = async (dog) => {
    try { onReady(await api.get('/me'), dog.slug) } catch (e) { setErr(e.message) }
  }
  return (
    <div className="welcome scroll">
      <div className="wbrand"><div className="wlogo">TROT</div><p className="wtag">Every walk counts.</p></div>
      {step === 'start' && <WelcomeHero />}
      {step === 'start' && (
        <div className="wform">
          {flash && <p className="wnote fnote" role="status">{flash}</p>}
          {token && inv && inv.dead && <p className="formerr" role="alert">This invite link has expired or was already used. Ask for a new one.</p>}
          {friendNote}
          {invited
            ? <><h1 className="wh">{inv.dogName} wants you on the team</h1><p className="wp">Sign in to join {inv.dogName}'s care team. Walks you take together count toward {inv.dogName}'s week.</p>
              <button className="cta" onClick={() => setStep('account')}><Paw s={22} c="#0F1B2D" />Join {inv.dogName}'s team</button></>
            : <><h1 className="wh">A page for your dog</h1><p className="wp">Record walks, see who your dog went out with, and share one page that shows it all.</p>
              <button className="cta" onClick={() => { setReturning(false); setStep('account') }}><Paw s={22} c="#0F1B2D" />Create my dog's page</button></>}
          <button className="cta white" onClick={onDemo}>Try the Biscuit demo</button>
          {!invited && <button className="wlink" onClick={() => { setReturning(true); setStep('account') }}>I already have a page. Sign back in.</button>}
        </div>
      )}
      {step === 'account' && (
        <form className="wform" onSubmit={signIn}>
          <h1 className="wh">{invited ? `Join ${inv.dogName}'s team` : returning ? 'Sign back in' : 'First, you'}</h1>
          <p className="wp">{returning && codes && !invited ? 'Use the same email as before. We will send it a code.' : returning ? 'Use the same email as before.' : 'Your first name is what others on the team will see, as in "with Pat".'}</p>
          {(!codes || needsName) && <label className="field"><span>Your name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={60} autoComplete="name" /></label>}
          <label className="field"><span>Email</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required maxLength={254} autoComplete="email" inputMode="email" /></label>
          <p className="wnote">{codes ? 'We will email you a 6 digit code to sign in. There is no password.' : 'Trial sign-in. No password yet.'}</p>
          {friendNote}
          {err && <p className="formerr" role="alert">{err}</p>}
          <button className="cta" type="submit" disabled={busy}>{codes ? (busy ? 'Sending the code' : 'Email me a code') : busy ? 'Signing in' : 'Continue'}</button>
          <button className="wlink" type="button" onClick={() => { setErr(''); setStep('start') }}>Back</button>
        </form>
      )}
      {step === 'code' && (
        <form className="wform" onSubmit={(e) => { e.preventDefault(); verify() }} noValidate>
          <h1 className="wh">Check your email</h1>
          <p className="wp" id="code-help">We emailed a code to <b className="wmail">{f.email.trim()}</b>. It expires in 10 minutes.</p>
          <div className="field"><label htmlFor="signin-code">6 digit code</label>
            <CodeInput id="signin-code" value={code} onChange={(v) => { setCode(v); if (err) setErr('') }} onFull={verify} invalid={!!err} describedBy={err ? 'code-err' : 'code-help'} focusKey={tries} /></div>
          {err && <p className="formerr" id="code-err" role="alert">{err}</p>}
          {info && !err && <p className="wnote fnote" role="status">{info}</p>}
          <button className="cta" type="submit" disabled={busy}>{busy ? 'Checking' : 'Continue'}</button>
          <button className="wlink" type="button" disabled={busy || resend.left > 0} onClick={() => sendCode(true)}>{resend.left > 0 ? `Resend the code in ${clock(resend.left)}` : 'Resend the code'}</button>
          <button className="wlink" type="button" onClick={otherEmail}>Use a different email</button>
          <p className="wnote">No email after a minute? Look in spam or junk, and check the address above for typos.</p>
        </form>
      )}
      {step === 'name' && (
        <form className="wform" onSubmit={finishName}>
          <h1 className="wh">One more thing: your name</h1>
          <p className="wp">There is no page for {f.email.trim()} yet, so this starts a new one. Your first name is what others on the team will see, as in "with Pat".</p>
          <label className="field"><span>Your name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={60} autoComplete="name" autoFocus /></label>
          {err && <p className="formerr" role="alert">{err}</p>}
          <button className="cta" type="submit" disabled={busy}>{busy ? 'Saving' : 'Continue'}</button>
          <button className="wlink" type="button" onClick={otherEmail}>Use a different email</button>
        </form>
      )}
      {step === 'dog' && (
        <div className="wform">
          <h1 className="wh">Now, your dog</h1>
          <p className="wp">This makes a page for your dog. You can add walkers and family after.</p>
          {friendNote}
          {err && <p className="formerr" role="alert">{err}</p>}
          <DogForm onDone={dogDone} />
          <p className="wnote">The page is public by default: name, breed, bio, totals and recent outings, with no maps. You can make it private in Settings.</p>
          <button className="wlink" onClick={onDemo}>Try the Biscuit demo instead</button>
        </div>
      )}
    </div>
  )
}
