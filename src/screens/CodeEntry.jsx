// The pieces the two code screens share: sign-in (Welcome.jsx) and account deletion (DeleteAccount.jsx).
import React, { useEffect, useRef, useState } from 'react'
import { getAuthConfig } from '../api.js'

export const CODE_LENGTH = 6
// Seconds before "Resend the code" can be tapped again. The server has its own limit on top of this.
export const RESEND_SECONDS = 30
const digits = (v) => String(v || '').replace(/\D/g, '').slice(0, CODE_LENGTH)
// From pasted text: a run of exactly six digits when there is one ("Your code is 123 456. It expires in 10 minutes."), else the first six.
const pasted = (t) => { const m = /(?<!\d)\d{6}(?!\d)/.exec(String(t).replace(/(\d)[ -](?=\d)/g, '$1')); return m ? m[0] : digits(t) }

// Whether sign-in uses emailed codes. null until the server has answered.
export function useEmailCodes(hint) {
  const [on, setOn] = useState(hint === true ? true : null)
  useEffect(() => { let live = true; getAuthConfig().then((c) => { if (live) setOn((was) => was === true || c.emailCodes) }); return () => { live = false } }, [])
  return on
}

// A countdown in whole seconds. start(n) begins it, left is what remains.
export function useCountdown() {
  const [until, setUntil] = useState(0)
  const [, tick] = useState(0)
  useEffect(() => {
    if (until <= Date.now()) return
    const t = setInterval(() => { tick((n) => n + 1); if (until <= Date.now()) clearInterval(t) }, 500)
    return () => clearInterval(t)
  }, [until])
  return { left: Math.max(0, Math.ceil((until - Date.now()) / 1000)), start: (seconds) => setUntil(Date.now() + Math.max(1, seconds) * 1000) }
}
export const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// One field for the whole code. The phone offers the code from the email above the keyboard
// (autocomplete="one-time-code"), and a paste of "123 456" or of the whole sentence from the email
// keeps just the digits. `onFull` is called once all six are in.
export function CodeInput({ id, value, onChange, onFull, invalid, describedBy, disabled, focusKey }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.focus() }, [focusKey])
  const take = (raw) => { const v = digits(raw); onChange(v); if (v.length === CODE_LENGTH && v !== value && onFull) onFull(v) }
  return (
    <input ref={ref} id={id} className="codein" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" enterKeyHint="done"
      autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="000000" value={value} disabled={disabled}
      aria-invalid={invalid ? true : undefined} aria-describedby={describedBy}
      onChange={(e) => take(e.target.value)}
      onPaste={(e) => { const t = e.clipboardData && e.clipboardData.getData('text'); if (t && /\d/.test(t)) { e.preventDefault(); take(pasted(t)) } }} />
  )
}
