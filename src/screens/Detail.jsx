import React, { useEffect, useMemo, useRef, useState } from 'react'
import TrotMap from '../Map.jsx'
import { drawCard, shareCard } from '../share.js'
import { Ic, Paw, Av, Stat, Range, Card, whoName, ptsOf, whenOf } from '../ui.jsx'
import { api } from '../api.js'
import { ROUTES, PLACES, DOG, PEOPLE, PACK, CONNECTIONS, WEIGHTS, HEALTH, dayLabel, fmtTime, haversine } from '../data.js'

export default function Detail({ a, close, pawed, paw, conn, setToast, setTab, dogName }) {
  const p = a.real ? null : PEOPLE[a.by]
  // Lists carry a thinned route. A saved walk's full route is fetched when it opens.
  const [full, setFull] = useState(null)
  useEffect(() => {
    setFull(null)
    if (!a.real) return
    let on = true
    api.get(`/walks/${a.id}`).then((r) => { if (on && r.walk.route && r.walk.route.length > 1) setFull(r.walk.route) }, () => {})
    return () => { on = false }
  }, [a.id, a.real])
  const pts = full || ptsOf(a)
  const mine = !!setTab && a.dog === (dogName || 'Biscuit')
  const [img, setImg] = useState('')
  useEffect(() => { const go = () => { try { setImg(drawCard(a).toDataURL('image/png')) } catch (e) {} }; (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(go, go) }, [a])
  const share = async () => { const r = await shareCard(a); setToast(r === 'shared' ? 'Shared' : r === 'saved' ? 'Story card saved. Add it to your Instagram story.' : r === 'cancelled' ? '' : 'Sharing is blocked in this preview. It works in the deployed app.') }
  return (
    <div className="detail" role="dialog" aria-label={a.title}>
      <header className="dhead"><button className="round flat" aria-label="Back" onClick={close}><Ic n="back" /></button><b>{a.type}</b><button className="round flat" aria-label="Share" onClick={share}><Ic n="share" /></button></header>
      <div className="scroll">
        {pts ? <TrotMap route={pts} className="dmap" /> : <div className="dmap nomap">No route for this one. {a.dog} was busy playing.</div>}
        <div className="list">
          <div className="padx"><div className="row g10">{mine ? <button className="doglink" aria-label={`Open ${a.dog}'s profile`} onClick={() => { close(); setTab('dog') }}><Av t={a.dog[0]} s={48} bg={a.color || '#0F1B2D'} c={a.ink || '#C8F031'} /></button> : <Av t={a.dog[0]} s={48} bg={a.color || '#0F1B2D'} c={a.ink || '#C8F031'} />}<div>{mine ? <button className="dogname big doglink" onClick={() => { close(); setTab('dog') }}>{a.dog}</button> : <div className="dogname big">{a.dog}</div>}<div className="meta">{a.type === 'Daycare' ? 'at' : 'with'} <b>{whoName(a)}</b>{p ? ` · ${p.role}` : ''}</div></div></div>
            <h1 className="dtitle">{a.title}</h1><div className="meta">{whenOf(a)}{a.place ? ` · ${a.place}` : ''}</div>{a.note && <p className="note">{a.note}</p>}</div>
          <div className="card padc grid3"><Stat l="DISTANCE" v={a.miles ? a.miles.toFixed(2) + ' mi' : '--'} /><Stat l="TIME" v={fmtTime(a.minutes)} /><Stat l="PACE" v={a.miles > 0.05 ? fmtTime(a.minutes / a.miles) + ' /mi' : '--'} /><Stat l="SNIFF STOPS" v={a.sniffs} /><Stat l="PAWS" v={a.paws + (pawed[a.id] ? 1 : 0)} />{!a.real && <Stat l="OF DAILY RANGE" v={Math.round((a.minutes / DOG.rangeMax) * 100) + '%'} />}</div>
          <button className={`cta ${pawed[a.id] ? 'white bordered' : ''}`} onClick={() => paw(a.id)}><Paw s={20} c="#0F1B2D" f={pawed[a.id] ? '#0F1B2D' : 'none'} />{pawed[a.id] ? 'Paw given' : 'Give a paw'}</button>
          <div className="storycard">{img ? <img src={img} alt={`Story card for ${a.title}`} /> : <div className="ph" />}<div><b>Story card ready</b><p>Sized for Instagram Stories, with the route, who {a.dog} went with, and the stats.</p><button className="cta small" onClick={share}>{conn.instagram ? 'Share to Instagram' : 'Save story card'}</button></div></div>
        </div>
      </div>
    </div>
  )
}
