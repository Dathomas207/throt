import React, { useEffect, useState } from 'react'
import WelcomeHero from './WelcomeHero.jsx'
import { Paw } from '../ui.jsx'
import { api, setToken, pendingInvite, clearInvite } from '../api.js'

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

export default function Welcome({ user, onDemo, onReady, notice }) {
  const [step, setStep] = useState(user ? 'dog' : 'start')
  const [returning, setReturning] = useState(false)
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
  const signIn = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr('')
    try {
      const s = await api.post('/session', { name: f.name, email: f.email })
      setToken(s.token)
      const joined = await acceptPendingInvite()
      const me = await api.get('/me')
      if (me.dogs.length) onReady(me, joined.slug, joined.error)
      else { setErr(joined.error || ''); setBusy(false); setStep('dog') }
    } catch (e2) { setErr(e2.message); setBusy(false) }
  }
  const dogDone = async (dog) => {
    try { onReady(await api.get('/me'), dog.slug) } catch (e) { setErr(e.message) }
  }
  return (
    <div className="welcome scroll">
      <div className="wbrand"><div className="wlogo">TROT</div><p className="wtag">Every walk counts.</p></div>
      {step === 'start' && <WelcomeHero />}
      {step === 'start' && (
        <div className="wform">
          {token && inv && inv.dead && <p className="formerr" role="alert">This invite link has expired or was already used. Ask for a new one.</p>}
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
          <p className="wp">{returning ? 'Use the same email as before.' : 'Your first name is what others on the team will see, as in "with Pat".'}</p>
          <label className="field"><span>Your name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={60} autoComplete="name" /></label>
          <label className="field"><span>Email</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required maxLength={254} autoComplete="email" inputMode="email" /></label>
          <p className="wnote">Trial sign-in. No password yet.</p>
          {err && <p className="formerr" role="alert">{err}</p>}
          <button className="cta" type="submit" disabled={busy}>{busy ? 'Signing in' : 'Continue'}</button>
          <button className="wlink" type="button" onClick={() => { setErr(''); setStep('start') }}>Back</button>
        </form>
      )}
      {step === 'dog' && (
        <div className="wform">
          <h1 className="wh">Now, your dog</h1>
          <p className="wp">This makes a page for your dog. You can add walkers and family after.</p>
          {err && <p className="formerr" role="alert">{err}</p>}
          <DogForm onDone={dogDone} />
          <p className="wnote">The page is public by default: name, breed, bio, totals and recent outings, with no maps. You can make it private in Settings.</p>
          <button className="wlink" onClick={onDemo}>Try the Biscuit demo instead</button>
        </div>
      )}
    </div>
  )
}
