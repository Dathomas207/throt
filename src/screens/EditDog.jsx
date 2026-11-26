import React, { useId, useState } from 'react'
import { Av, usePhoto } from '../ui.jsx'
import { squareJpeg } from '../photo.js'

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// The same rules the server applies, checked here first so mistakes show next to the field.
export function checkDog(f) {
  const e = {}
  const name = f.name.trim()
  if (!name) e.name = 'Give your dog a name.'
  else if (name.length > 40) e.name = 'Keep the name to 40 characters or fewer.'
  if (f.breed.trim().length > 60) e.breed = 'Keep the breed to 60 characters or fewer.'
  if (f.birthday) {
    const d = new Date(f.birthday + 'T00:00:00')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.birthday) || Number.isNaN(d.getTime())) e.birthday = 'Pick a date, or clear it.'
    else if (f.birthday > today()) e.birthday = 'A birthday cannot be in the future.'
    else if (d.getFullYear() < new Date().getFullYear() - 39) e.birthday = 'That birthday is too long ago.'
  } else if (f.age.trim().length > 20) e.age = 'Keep the age to 20 characters or fewer, such as "4 yrs".'
  const w = f.weight.trim()
  if (w !== '' && (!/^\d+(\.\d+)?$/.test(w) || Number(w) < 0.5 || Number(w) > 400)) e.weight = 'Weight should be a number of pounds from 0.5 to 400.'
  if (f.bio.trim().length > 280) e.bio = 'Keep the bio to 280 characters or fewer.'
  if (f.city !== undefined && f.city.trim().length > 60) e.city = 'Keep the city to 60 characters or fewer.'
  const g = f.goal === undefined ? '' : f.goal.trim()
  if (g !== '' && (!/^\d+$/.test(g) || Number(g) < 10 || Number(g) > 300)) e.goal = 'The goal should be a whole number of minutes from 10 to 300, or empty.'
  return e
}

function Field({ label, error, hint, children }) {
  const id = useId()
  const note = error ? `${id}-e` : hint ? `${id}-h` : undefined
  return (
    <div className="field lightf">
      <label htmlFor={id}>{label}</label>
      {React.cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': note })}
      {error ? <p className="ferr" id={`${id}-e`} role="alert">{error}</p> : hint ? <p className="fhint" id={`${id}-h`}>{hint}</p> : null}
    </div>
  )
}

// Owner only. `onSave(body)` sends the changed fields and answers { error } when the server says no.
export default function EditDog({ dog, onSave, onClose }) {
  const [f, setF] = useState({
    name: dog.name, breed: dog.breed || '', birthday: dog.birthday || '', age: dog.birthday ? '' : dog.age || '',
    weight: dog.weight == null ? '' : String(dog.weight), bio: dog.bio || '', public: !!dog.public, shareRoutes: !!dog.shareRoutes,
    city: dog.city || '', goal: dog.goalMinutes == null ? '' : String(dog.goalMinutes), leaderboards: dog.leaderboards !== false,
  })
  // undefined leaves the photo alone, null removes it, a data URL replaces it.
  const [photo, setPhoto] = useState(undefined)
  const [photoErr, setPhotoErr] = useState('')
  const [reading, setReading] = useState(false)
  const [errs, setErrs] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const current = usePhoto(dog.photoUrl)
  const shown = photo === undefined ? current : photo || ''
  const set = (k) => (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setF((x) => ({ ...x, [k]: v })); if (errs[k]) setErrs((x) => ({ ...x, [k]: undefined })); if (err) setErr('') }

  const pick = async (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    setReading(true); setPhotoErr('')
    try { setPhoto(await squareJpeg(file)) } catch (e2) { setPhotoErr(e2.message || 'That photo did not work. Try another one.') }
    setReading(false)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy || reading) return
    const found = checkDog(f)
    setErrs(found)
    if (Object.keys(found).length) { setErr('Fix the highlighted fields, then save again.'); return }
    const body = {}
    const name = f.name.trim(), breed = f.breed.trim(), bio = f.bio.trim(), age = f.age.trim()
    const weight = f.weight.trim() === '' ? null : Number(f.weight)
    if (name !== dog.name) body.name = name
    if (breed !== (dog.breed || '')) body.breed = breed
    if (bio !== (dog.bio || '')) body.bio = bio
    if ((f.birthday || null) !== (dog.birthday || null)) body.birthday = f.birthday || null
    // With a birthday the age is worked out from it. Without one the typed age is what shows.
    if (!f.birthday && (dog.birthday || age !== (dog.age || ''))) body.age = age
    if (weight !== (dog.weight == null ? null : dog.weight)) body.weight = weight
    if (f.public !== !!dog.public) body.public = f.public
    if (f.shareRoutes !== !!dog.shareRoutes) body.shareRoutes = f.shareRoutes
    if (f.city.trim() !== (dog.city || '')) body.city = f.city.trim()
    const goal = f.goal.trim() === '' ? null : Number(f.goal)
    if (goal !== (dog.goalMinutes == null ? null : dog.goalMinutes)) body.goal_minutes = goal
    if (f.leaderboards !== (dog.leaderboards !== false)) body.leaderboards = f.leaderboards
    if (photo !== undefined && !(photo === null && !dog.photoUrl)) body.photo = photo
    if (!Object.keys(body).length) { onClose(); return }
    setBusy(true); setErr('')
    const r = await onSave(body)
    if (r && r.error) { setErr(r.error); setBusy(false) }
  }

  const initial = (f.name.trim()[0] || 'D').toUpperCase()
  return (
    <div className="scrim" onClick={busy ? undefined : onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Edit ${dog.name}'s profile`} onClick={(e) => e.stopPropagation()}>
        <div className="grab" /><h2>Edit {dog.name}'s profile</h2>
        <form className="wform" onSubmit={submit} noValidate>
          <div className="photopick">
            <Av t={initial} s={84} bg="#0F1B2D" c="#C8F031" src={shown} alt={shown ? `Photo of ${f.name.trim() || dog.name}` : ''} />
            <div className="grow pickcol">
              <label className="cta small white bordered filebtn">{reading ? 'Reading photo' : shown ? 'Change photo' : 'Add from Photos'}<input type="file" accept="image/*" onChange={pick} disabled={busy || reading} aria-describedby="photo-note" /></label>
              {shown && <button type="button" className="tbtn" onClick={() => { setPhoto(null); setPhotoErr('') }} disabled={busy}>Remove photo</button>}
            </div>
          </div>
          {photoErr ? <p className="ferr" id="photo-note" role="alert">{photoErr}</p> : <p className="fhint" id="photo-note">Opens your photo library, or the camera if you choose it. Cropped to a square and shrunk on this device before it is sent. {f.public ? `Shown on ${dog.name}'s public page.` : 'Only the care team sees it while the page is private.'}</p>}
          <Field label="Dog's name" error={errs.name}><input value={f.name} onChange={set('name')} maxLength={60} autoComplete="off" /></Field>
          <Field label="Breed (optional)" error={errs.breed}><input value={f.breed} onChange={set('breed')} maxLength={80} autoComplete="off" /></Field>
          <Field label="Birthday (optional)" error={errs.birthday} hint={f.birthday ? 'Age is worked out from the birthday.' : 'Not sure of the date? Leave this empty and type an age below.'}><input type="date" value={f.birthday} onChange={set('birthday')} max={today()} /></Field>
          {!f.birthday && <Field label="Age (optional)" error={errs.age} hint={'For example "4 yrs" or "8 mos".'}><input value={f.age} onChange={set('age')} maxLength={30} autoComplete="off" /></Field>}
          <Field label="Weight in pounds (optional)" error={errs.weight}><input value={f.weight} onChange={set('weight')} inputMode="decimal" maxLength={8} autoComplete="off" /></Field>
          <Field label="City (optional)" error={errs.city} hint={'For example "Charlotte, NC". Used for the city leaderboard.'}><input value={f.city} onChange={set('city')} maxLength={60} autoComplete="off" /></Field>
          <Field label="Daily activity goal in minutes (optional)" error={errs.goal} hint="Your own number, from 10 to 300. Not a recommendation and not veterinary advice."><input value={f.goal} onChange={set('goal')} inputMode="numeric" maxLength={3} autoComplete="off" /></Field>
          <Field label="Bio (optional)" error={errs.bio} hint={`${f.bio.trim().length} of 280`}><textarea value={f.bio} onChange={set('bio')} rows={3} maxLength={400} /></Field>
          <label className="switch"><input type="checkbox" checked={f.public} onChange={set('public')} /><span className="grow"><b>Public page</b><small>Anyone with the link sees {dog.name}'s photo, name, breed, bio, totals and last 10 outings, with first names only.</small></span></label>
          <label className="switch"><input type="checkbox" checked={f.public && f.shareRoutes} disabled={!f.public} onChange={set('shareRoutes')} /><span className="grow"><b>Show route maps on the public page</b><small>Route shapes can give away where {dog.name} lives.</small></span></label>
          <label className="switch"><input type="checkbox" checked={f.leaderboards} onChange={set('leaderboards')} /><span className="grow"><b>Show on leaderboards</b><small>Public dogs only. Turn this off to keep {dog.name} off every board. Owner names never show.</small></span></label>
          <p className="fhint">{dog.name}'s page address stays the same if the name changes, so links already shared keep working.</p>
          {err && <p className="formerr" role="alert">{err}</p>}
          <button className="cta" type="submit" disabled={busy || reading}>{busy ? 'Saving' : 'Save profile'}</button>
          <button className="cta white bordered" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        </form>
      </div>
    </div>
  )
}
