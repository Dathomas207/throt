import React, { useEffect, useMemo, useRef, useState } from 'react'
import TrotMap from '../Map.jsx'
import { drawCard, shareCard } from '../share.js'
import { Ic, Paw, Av, DogAv, Stat, Range, Card, whoName, ptsOf, whenOf, Confirm, statsOf, SPEED_NOTE, TypeIc } from '../ui.jsx'
import { DemoPhoto, hasDemoPhoto } from '../portraits.jsx'
import { api } from '../api.js'
import { Gallery, PhotoPicker, UploadRows, makePicks } from './Photos.jsx'
import { OUTING_PHOTO_MAX } from '../photo.js'
import { peekDemoRoute, resolveDemoRoute } from '../routing.js'
import { ROUTES, PLACES, DOG, PEOPLE, PACK, CONNECTIONS, WEIGHTS, HEALTH, dayLabel, fmtTime, haversine } from '../data.js'

export default function Detail({ a, close, pawed, paw, conn, setToast, setTab, dogName, real }) {
  const p = a.real ? null : PEOPLE[a.by]
  // Lists carry a thinned route. A saved walk's full route is fetched when it opens.
  const [full, setFull] = useState(null)
  // Lists carry the first three photos. The full set, and which ones this person added, come with the outing itself.
  // It is fetched again whenever a photo finishes uploading or is deleted.
  const [shots, setShots] = useState(null)
  const photoRev = real ? real.photos.rev : 0
  useEffect(() => { setFull(null); setShots(null) }, [a.id])
  useEffect(() => {
    if (!a.real) return
    let on = true
    api.get(`/walks/${a.id}`).then((r) => { if (!on) return; if (r.walk.route && r.walk.route.length > 1) setFull(r.walk.route); setShots(r.walk.photos || []) }, () => {})
    return () => { on = false }
  }, [a.id, a.real, photoRev])
  // In the demo a picked photo is shown from this device only. Nothing is uploaded.
  const [local, setLocal] = useState([])
  useEffect(() => { setLocal([]) }, [a.id])
  const team = a.real && real ? real.dogs.find((d) => d.slug === a.dogSlug) : null
  const photos = a.real ? shots || a.photos || [] : [...(a.photos || []), ...local]
  const jobs = a.real && real ? real.photos.jobs.filter((j) => j.walkId === a.id) : []
  const room = OUTING_PHOTO_MAX - photos.length - jobs.length
  const canAdd = a.real ? !!team : !!setTab && a.dog === (dogName || 'Biscuit')
  const pickPhotos = (files) => {
    if (a.real) { real.photos.add(a.id, files); return }
    setLocal((l) => [...l, ...makePicks(files).map((p) => ({ id: p.key, url: p.url, local: true }))])
    setToast('Previewed on this device only. Saving photos needs an account.')
  }
  const canDeletePhoto = (p) => (a.real ? !!team && (p.mine || team.role === 'owner' || team.role === 'family') : !!p.local)
  const deletePhoto = async (p) => { if (a.real) return real.photos.remove(a.id, p.id); setLocal((l) => l.filter((x) => x.id !== p.id)); return {} }
  // Demo activities carry a sketched line. It is swapped for one on real paths when the router answers.
  const demoKey = typeof a.route === 'string' && ROUTES[a.route] ? a.route : null
  const [routed, setRouted] = useState(() => (demoKey ? peekDemoRoute(demoKey) : null))
  useEffect(() => { if (!demoKey) return; let on = true; resolveDemoRoute(demoKey).then((v) => { if (on && v) setRouted(v) }); return () => { on = false } }, [demoKey])
  const pts = full || (routed && !routed.approximate ? routed.pts : ptsOf(a))
  const sketch = !!demoKey && !full && (!routed || routed.approximate)
  const mine = !!setTab && a.dog === (dogName || 'Biscuit')
  const [img, setImg] = useState('')
  // The person who logged the outing can delete it, and so can the dog's owner.
  const canDelete = !!(a.real && real && (a.byYou || (real.dogs.find((d) => d.slug === a.dogSlug) || {}).role === 'owner'))
  const [del, setDel] = useState({ open: false, busy: false, error: '' })
  const remove = async () => {
    setDel({ open: true, busy: true, error: '' })
    const r = await real.deleteWalk(a.id)
    if (r && r.error) setDel({ open: true, busy: false, error: r.error })
  }
  const av = <DogAv name={a.dog} photoUrl={a.dogPhoto} demo={!a.real} s={48} bg={a.color || '#0F1B2D'} c={a.ink || '#C8F031'} />
  useEffect(() => { const go = () => { try { setImg(drawCard(a).toDataURL('image/png')) } catch (e) {} }; (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(go, go) }, [a])
  const share = async () => { const r = await shareCard(a); setToast(r === 'shared' ? 'Shared' : r === 'saved' ? 'Story card saved. Add it to your Instagram story.' : r === 'cancelled' ? '' : 'Sharing is blocked in this preview. It works in the deployed app.') }
  return (
    <div className="detail" role="dialog" aria-label={a.title}>
      <header className="dhead"><button className="round flat" aria-label="Back" onClick={close}><Ic n="back" /></button><b className="row g8"><TypeIc t={a.type} c="#0F1B2D" />{a.type}</b><button className="round flat" aria-label="Share" onClick={share}><Ic n="share" /></button></header>
      <div className="scroll">
        {pts ? <><TrotMap route={pts} className="dmap" />{sketch && <div className="sketchnote">Sample route, drawn as an approximate line. It is not a recorded walk.</div>}</> : <div className="dmap nomap">No route for this one. {a.dog} was busy playing.</div>}
        <div className="list">
          <div className="padx"><div className="row g10">{mine ? <button className="doglink" aria-label={`Open ${a.dog}'s profile`} onClick={() => { close(); setTab('dog') }}>{av}</button> : av}<div>{mine ? <button className="dogname big doglink" onClick={() => { close(); setTab('dog') }}>{a.dog}</button> : <div className="dogname big">{a.dog}</div>}<div className="meta">{a.type === 'Daycare' ? 'at' : 'with'} <b>{whoName(a)}</b>{p ? ` · ${p.role}` : ''}</div></div></div>
            <h1 className="dtitle">{a.title}</h1><div className="meta">{whenOf(a)}{a.place ? ` · ${a.place}` : ''}</div>{a.note && <p className="note">{a.note}</p>}</div>
          {!a.real && hasDemoPhoto(a.id) && <div className="card"><DemoPhoto id={a.id} /></div>}
          <Gallery photos={photos} title={a.title} canDelete={canDeletePhoto} onDelete={deletePhoto} />
          {a.real && real && <UploadRows jobs={jobs} retry={real.photos.retry} dismiss={real.photos.dismiss} />}
          {canAdd && <div className="photorow padx">
            <PhotoPicker onPick={pickPhotos} room={room} setToast={setToast} />
            <p className="fhint">{photos.length ? `${photos.length} of ${OUTING_PHOTO_MAX} photos. ` : ''}Opens your photo library so you can choose. Trot cannot browse your photos on its own. Each photo is shrunk on this device first, which also leaves out its location data.{a.real ? (team && team.public ? ` Photos show on ${a.dog}'s public page.` : '') : ' In the demo nothing is uploaded.'}</p>
          </div>}
          <div className="card padc grid3">{statsOf(routed && !routed.approximate && !full && a.miles > 0 ? { ...a, miles: routed.miles, avgSpeed: a.minutes > 0 ? routed.miles / (a.minutes / 60) : a.avgSpeed } : a, true).map(([l, v]) => <Stat key={l} l={l} v={v} />)}<Stat l="PAWS" v={a.paws + (pawed[a.id] ? 1 : 0)} />{!a.real && <Stat l="OF DAILY RANGE" v={Math.round((a.minutes / DOG.rangeMax) * 100) + '%'} />}</div>
          {(a.maxSpeed > 0 || a.avgSpeed > 0) && a.type !== 'Daycare' && <p className="meta padx">{SPEED_NOTE}</p>}
          <button className={`cta ${pawed[a.id] ? 'white bordered' : ''}`} onClick={() => paw(a.id)}><Paw s={20} c="#0F1B2D" f={pawed[a.id] ? '#0F1B2D' : 'none'} />{pawed[a.id] ? 'Paw given' : 'Give a paw'}</button>
          <div className="storycard">{img ? <img src={img} alt={`Story card for ${a.title}`} /> : <div className="ph" />}<div><b>Story card ready</b><p>Sized for Instagram Stories, with the route, who {a.dog} went with, and the stats.</p><button className="cta small" onClick={share}>{conn.instagram ? 'Share to Instagram' : 'Save story card'}</button></div></div>
          {canDelete && (del.open
            ? <Confirm text={`Delete this outing? It comes off ${a.dog}'s totals and page for everyone on the team. This cannot be undone.`} yes="Delete outing" no="Keep it" busy={del.busy} error={del.error} onYes={remove} onNo={() => setDel({ open: false, busy: false, error: '' })} />
            : <button className="cta white bordered" onClick={() => setDel({ open: true, busy: false, error: '' })}>Delete this outing</button>)}
        </div>
      </div>
    </div>
  )
}
