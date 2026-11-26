import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ic, Confirm, usePhoto } from '../ui.jsx'
import { OUTING_PHOTO_MAX } from '../photo.js'
import './photos.css'

// Photos on outings. A web app cannot browse or sync the phone's photo library on its own. What it can
// do is open the system photo picker: on an iPhone that is Photos, with the camera offered beside it.
// The person chooses the pictures, and only those are read.

// One outing photo. Addresses under /api/ are fetched with the session token; a demo photo or a
// local preview is shown straight from its address.
export function WalkImg({ p, alt = '', className = '', onLoad }) {
  const remote = /^\/api\//.test(p.url || '')
  const got = usePhoto(remote ? p.url : null)
  const src = remote ? got : p.url
  if (!src) return <span className={`wimg wait ${className}`} role="img" aria-label={alt ? `${alt} (loading)` : 'Photo loading'} />
  return <img className={`wimg ${className}`} src={src} alt={alt} width={p.w || undefined} height={p.h || undefined} loading="lazy" onLoad={onLoad} style={p.pos ? { objectPosition: p.pos } : undefined} />
}

// On a feed card: the first photo wide, and up to two more as small squares over its corner.
export function CardPhotos({ photos, title }) {
  if (!photos || !photos.length) return null
  const rest = photos.slice(1, 3)
  return (
    <span className="cphotos">
      <WalkImg p={photos[0]} alt={`Photo from ${title}`} className="cmain" />
      {rest.length > 0 && <span className="cthumbs">{rest.map((p, i) => <WalkImg key={p.id} p={p} alt={`Photo ${i + 2} from ${title}`} className="cthumb" />)}</span>}
    </span>
  )
}

// The "Add from Photos" button. `capture` is left off on purpose, so the phone offers the photo
// library (and the camera beside it) instead of going straight to the camera.
export function PhotoPicker({ onPick, room = OUTING_PHOTO_MAX, disabled, light, label = 'Add from Photos', setToast }) {
  const pick = (e) => {
    const all = [...(e.target.files || [])]
    e.target.value = ''
    if (!all.length) return
    const images = all.filter((f) => !f.type || /^image\//.test(f.type))
    const take = images.slice(0, Math.max(0, room))
    if (setToast && (images.length < all.length || take.length < images.length)) setToast(take.length < images.length ? `An outing can have up to ${OUTING_PHOTO_MAX} photos. ${take.length ? `Added the first ${take.length}.` : 'Delete one to add another.'}` : 'Only pictures can be added. The other files were left out.')
    if (take.length) onPick(take)
  }
  const full = room <= 0
  return (
    <label className={`cta small filebtn photobtn ${light ? 'white' : 'white bordered'} ${disabled || full ? 'off' : ''}`}>
      <Ic n="plus" s={18} />{full ? `${OUTING_PHOTO_MAX} photos added` : label}
      <input type="file" accept="image/*" multiple onChange={pick} disabled={disabled || full} aria-label={`${label}. Opens your photo library.`} />
    </label>
  )
}

// Picked photos waiting to go up with a new outing: small previews, each with a remove button.
export function PickStrip({ picks, onRemove }) {
  if (!picks.length) return null
  return <div className="picks" role="list" aria-label="Photos to add">{picks.map((p, i) => <span key={p.key} className="pick" role="listitem"><img src={p.url} alt={`Photo ${i + 1} to add`} /><button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => onRemove(p.key)}><Ic n="x" s={14} c="#fff" /></button></span>)}</div>
}
export const makePicks = (files) => files.map((file, i) => ({ key: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`, file, url: URL.createObjectURL(file) }))

// What each upload is doing, one row per photo: shrinking on the phone, sending with a percentage, or the
// reason it failed with a way to try again. Finished ones leave the list and show in the gallery.
const STEP = { waiting: 'Waiting', shrinking: 'Shrinking on this device', uploading: 'Uploading', error: 'Not added' }
export function UploadRows({ jobs, retry, dismiss }) {
  if (!jobs.length) return null
  return (
    <div className="card padc uprows" aria-live="polite">
      <div className="eyebrow dark">ADDING PHOTOS</div>
      {jobs.map((j, i) => (
        <div key={j.key} className="uprow">
          <img src={j.preview} alt="" />
          <div className="grow">
            <b>Photo {i + 1}{j.status === 'error' ? ' was not added' : ''}</b>
            {j.status === 'error'
              ? <small className="uperr" role="alert">{j.error}</small>
              : <><small>{STEP[j.status]}{j.status === 'uploading' ? ` ${j.pct}%` : ''}</small><span className="upbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={j.status === 'uploading' ? j.pct : 0} aria-label={`Photo ${i + 1} upload`}><i style={{ width: (j.status === 'uploading' ? j.pct : j.status === 'shrinking' ? 4 : 0) + '%' }} /></span></>}
          </div>
          {j.status === 'error' && <span className="row g8"><button className="tbtn" onClick={() => retry(j.key)}>Try again</button><button className="tbtn" onClick={() => dismiss(j.key)} aria-label={`Leave photo ${i + 1} out`}>Skip</button></span>}
        </div>
      ))}
    </div>
  )
}

// A strip that swipes sideways. Tapping a photo opens it large; the large view swipes too, and
// offers Delete to the people allowed to remove that photo.
export function Gallery({ photos, title, canDelete, onDelete }) {
  const [at, setAt] = useState(null)
  const [del, setDel] = useState({ open: false, busy: false, error: '' })
  const rail = useRef(null), closeBtn = useRef(null)
  const open = at !== null && photos[at] ? at : null
  useEffect(() => {
    if (open === null) return
    const el = rail.current
    if (el) el.scrollLeft = el.clientWidth * open
    if (closeBtn.current) closeBtn.current.focus()
    const key = (e) => { if (e.key === 'Escape') setAt(null); if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open === null])
  if (!photos.length) return null
  const step = (d) => { const el = rail.current; if (el) el.scrollTo({ left: el.clientWidth * Math.min(photos.length - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth) + d)), behavior: 'smooth' }) }
  const onScroll = () => { const el = rail.current; if (!el || !el.clientWidth) return; const i = Math.round(el.scrollLeft / el.clientWidth); if (i !== at && photos[i]) { setAt(i); setDel({ open: false, busy: false, error: '' }) } }
  const cur = open !== null ? photos[open] : null
  const remove = async () => {
    setDel({ open: true, busy: true, error: '' })
    const r = await onDelete(cur)
    if (r && r.error) { setDel({ open: true, busy: false, error: r.error }); return }
    setDel({ open: false, busy: false, error: '' }); setAt(null)
  }
  return (
    <>
      <div className={`gal ${photos.length > 1 ? 'many' : ''}`} role="list" aria-label={`${photos.length} ${photos.length === 1 ? 'photo' : 'photos'} from ${title}. Swipe to see them, tap one to view it large.`}>
        {photos.map((p, i) => <button key={p.id} role="listitem" className="galitem" onClick={() => { setDel({ open: false, busy: false, error: '' }); setAt(i) }} aria-label={`View photo ${i + 1} of ${photos.length} large`}><WalkImg p={p} alt={`Photo ${i + 1} of ${photos.length} from ${title}`} /></button>)}
      </div>
      {cur && createPortal((
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Photo ${open + 1} of ${photos.length}`}>
          <div className="lbtop"><button ref={closeBtn} className="round flat" aria-label="Close photo" onClick={() => setAt(null)}><Ic n="x" c="#fff" /></button><b>{open + 1} of {photos.length}</b><span className="round flat" aria-hidden="true" /></div>
          <div className="lbrail" ref={rail} onScroll={onScroll}>{photos.map((p, i) => <div key={p.id} className="lbslide"><WalkImg p={p} alt={`Photo ${i + 1} of ${photos.length} from ${title}`} /></div>)}</div>
          <div className="lbfoot">
            {photos.length > 1 && <div className="row g8 lbnav"><button className="cta small white" onClick={() => step(-1)} disabled={open === 0}>Previous</button><button className="cta small white" onClick={() => step(1)} disabled={open === photos.length - 1}>Next</button></div>}
            {canDelete && canDelete(cur) && (del.open
              ? <Confirm text="Delete this photo? It comes off the outing for everyone, including the public page. This cannot be undone." yes="Delete photo" no="Keep it" busy={del.busy} error={del.error} onYes={remove} onNo={() => setDel({ open: false, busy: false, error: '' })} />
              : <button className="cta small white" onClick={() => setDel({ open: true, busy: false, error: '' })}>Delete this photo</button>)}
          </div>
        </div>
      ), document.querySelector('.shell') || document.body)}
    </>
  )
}
