// "Delete my account", opened from the bottom of Settings. Two steps: what is deleted, then proof that
// the person asking is the account's owner. With email codes on, the proof is a fresh code sent to the
// account's email. With them off, it is the email typed out. The server checks either one again.
import React, { useEffect, useRef, useState } from 'react'
import { Ic } from '../ui.jsx'
import { api } from '../api.js'
import { CodeInput, useEmailCodes, useCountdown, clock, RESEND_SECONDS, CODE_LENGTH } from './CodeEntry.jsx'

export default function DeleteAccount({ real, close }) {
  const codes = useEmailCodes()
  const [step, setStep] = useState('what')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [code, setCode] = useState('')
  const [typed, setTyped] = useState('')
  const [tries, setTries] = useState(0)
  const resend = useCountdown()
  const back = useRef(null)
  useEffect(() => { if (back.current) back.current.focus() }, [step])
  const email = real.user.email
  const owned = real.dogs.filter((d) => d.role === 'owner').map((d) => d.name)
  const helping = real.dogs.filter((d) => d.role !== 'owner').map((d) => d.name)
  const names = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}` : l[0])

  const sendCode = async (again) => {
    if (busy) return
    setBusy(true); setErr(''); setInfo('')
    try {
      await api.auth.start(email)
      setCode(''); setStep('proof'); setTries((n) => n + 1); resend.start(RESEND_SECONDS)
      if (again) setInfo('We sent a new code. The older one no longer works.')
    } catch (e) {
      if (e.status === 429 && e.retryAfter) resend.start(e.retryAfter)
      setErr(e.message)
    }
    setBusy(false)
  }
  const next = () => { if (codes) sendCode(false); else { setErr(''); setStep('proof') } }
  const ready = codes ? code.length === CODE_LENGTH : typed.trim().toLowerCase() === email.toLowerCase()
  const remove = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!ready) { setErr(codes ? 'Enter the 6 digit code from the email.' : `Type ${email} to confirm.`); return }
    setBusy(true); setErr(''); setInfo('')
    try {
      await api.auth.deleteAccount(codes ? { code } : { email: typed })
      await real.accountDeleted()
    } catch (e2) { if (codes) { setCode(''); setTries((n) => n + 1) } setErr(e2.message); setBusy(false) }
  }
  return (
    <div className="detail delacct" role="dialog" aria-modal="true" aria-label="Delete my account">
      <header className="dhead"><button ref={back} className="round flat" aria-label={step === 'what' ? 'Back to Settings' : 'Back'} onClick={() => { if (busy) return; if (step === 'what') close(); else { setErr(''); setInfo(''); setStep('what') } }}><Ic n="back" /></button><b>Delete my account</b><span className="round flat" aria-hidden="true" /></header>
      <div className="scroll"><div className="list">
        {step === 'what' && <section className="card padc setsec" aria-labelledby="del-what">
          <h2 className="eyebrow dark" id="del-what">WHAT IS DELETED</h2>
          <p className="meta">Deleting your account removes these from Trot for good:</p>
          <ul className="dellist">
            <li>Your account: your name, your email ({email}) and your sign-in on every device.</li>
            <li>{owned.length ? `Dogs you own (${names(owned)})` : 'Dogs you own'}: the page, walks, photos, health records, documents, awards, tags and friends. A dog with another owner or a family member on its care team is not deleted. It stays with them.</li>
            <li>Your own things: saved routes, notifications, settings, paws, and places and events you added that nobody else relies on.</li>
            <li>{helping.length ? `Your place on other care teams (${names(helping)})` : 'Your place on other care teams'}: you are taken off the team. Walks you logged for those dogs stay in the dog's history, shown as from a former member, without your name.</li>
          </ul>
          <p className="delwarn" role="note"><b>This cannot be undone.</b> Nobody at Trot can bring a deleted account or dog back.</p>
          {err && <p className="formerr" role="alert">{err}</p>}
          <button className="cta danger" disabled={busy || codes === null} onClick={next}>{busy ? 'Sending a code' : 'Continue'}</button>
          <button className="cta white bordered" disabled={busy} onClick={close}>Keep my account</button>
          {codes && <p className="meta">Next we email a 6 digit code to {email} to make sure it is you.</p>}
        </section>}
        {step === 'proof' && <form className="card padc setsec" aria-labelledby="del-proof" onSubmit={remove} noValidate>
          <h2 className="eyebrow dark" id="del-proof">CONFIRM IT IS YOU</h2>
          {codes ? <>
            <p className="meta" id="del-help">We emailed a code to <b>{email}</b>. It expires in 10 minutes. Enter it to delete your account.</p>
            <div className="field lightf"><label htmlFor="del-code">6 digit code</label>
              <CodeInput id="del-code" value={code} onChange={(v) => { setCode(v); if (err) setErr('') }} invalid={!!err} describedBy={err ? 'del-err' : 'del-help'} focusKey={tries} disabled={busy} /></div>
          </> : <>
            <p className="meta" id="del-help">Type your email, <b>{email}</b>, to delete your account.</p>
            <div className="field lightf"><label htmlFor="del-email">Your email</label>
              <input id="del-email" type="email" value={typed} onChange={(e) => { setTyped(e.target.value); if (err) setErr('') }} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="email" maxLength={254} aria-invalid={err ? true : undefined} aria-describedby={err ? 'del-err' : 'del-help'} disabled={busy} /></div>
          </>}
          {err && <p className="formerr" id="del-err" role="alert">{err}</p>}
          {info && !err && <p className="meta" role="status">{info}</p>}
          <p className="delwarn" role="note"><b>This cannot be undone.</b></p>
          <button className="cta danger" type="submit" disabled={busy}>{busy ? 'Deleting' : 'Delete my account for good'}</button>
          {codes && <button className="cta small white bordered" type="button" disabled={busy || resend.left > 0} onClick={() => sendCode(true)}>{resend.left > 0 ? `Resend the code in ${clock(resend.left)}` : 'Resend the code'}</button>}
          <button className="cta white bordered" type="button" disabled={busy} onClick={close}>Keep my account</button>
        </form>}
      </div></div>
    </div>
  )
}
