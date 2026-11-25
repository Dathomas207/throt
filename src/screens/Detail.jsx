import React, { useEffect, useMemo, useRef, useState } from 'react'
import TrotMap from '../Map.jsx'
import { drawCard, shareCard } from '../share.js'
import { Ic, Paw, Av, Stat, Range, Card, whoName, ptsOf } from '../ui.jsx'
import { ROUTES, PLACES, DOG, PEOPLE, PACK, CONNECTIONS, WEIGHTS, HEALTH, dayLabel, fmtTime, haversine } from '../data.js'

export default function Detail({ a, close, pawed, paw, conn, setToast }) {
  const pts = ptsOf(a), p = PEOPLE[a.by]
  const [img, setImg] = useState('')
  useEffect(() => { const go = () => { try { setImg(drawCard(a).toDataURL('image/png')) } catch (e) {} }; (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(go, go) }, [a])
  const share = async () => { const r = await shareCard(a); setToast(r === 'shared' ? 'Shared' : r === 'saved' ? 'Story card saved. Add it to your Instagram story.' : r === 'cancelled' ? '' : 'Sharing is blocked in this preview. It works in the deployed app.') }
  return (
    <div className="detail" role="dialog" aria-label={a.title}>
      <header className="dhead"><button className="round flat" aria-label="Back" onClick={close}><Ic n="back" /></button><b>{a.type}</b><button className="round flat" aria-label="Share" onClick={share}><Ic n="share" /></button></header>
      <div className="scroll">
        {pts ? <TrotMap route={pts} className="dmap" /> : <div className="dmap nomap">No route for this one. Biscuit was busy playing.</div>}
        <div className="list">
          <div className="padx"><div className="row g10"><Av t={a.dog[0]} s={48} bg={a.color || '#0F1B2D'} c={a.ink || '#C8F031'} /><div><div className="dogname big">{a.dog}</div><div className="meta">{a.type === 'Daycare' ? 'at' : 'with'} <b>{whoName(a)}</b>{p ? ` · ${p.role}` : ''}</div></div></div>
            <h1 className="dtitle">{a.title}</h1><div className="meta">{dayLabel(a.daysAgo)} {a.time} · {a.place}</div>{a.note && <p className="note">{a.note}</p>}</div>
          <div className="card padc grid3"><Stat l="DISTANCE" v={a.miles ? a.miles.toFixed(2) + ' mi' : '--'} /><Stat l="TIME" v={fmtTime(a.minutes)} /><Stat l="PACE" v={a.miles > 0.05 ? fmtTime(a.minutes / a.miles) + ' /mi' : '--'} /><Stat l="SNIFF STOPS" v={a.sniffs} /><Stat l="PAWS" v={a.paws + (pawed[a.id] ? 1 : 0)} /><Stat l="OF DAILY RANGE" v={Math.round((a.minutes / DOG.rangeMax) * 100) + '%'} /></div>
          <button className={`cta ${pawed[a.id] ? 'white bordered' : ''}`} onClick={() => paw(a.id)}><Paw s={20} c="#0F1B2D" f={pawed[a.id] ? '#0F1B2D' : 'none'} />{pawed[a.id] ? 'Paw given' : 'Give a paw'}</button>
          <div className="storycard">{img ? <img src={img} alt={`Story card for ${a.title}`} /> : <div className="ph" />}<div><b>Story card ready</b><p>Sized for Instagram Stories, with the route, who Biscuit went with, and the stats.</p><button className="cta small" onClick={share}>{conn.instagram ? 'Share to Instagram' : 'Save story card'}</button></div></div>
        </div>
      </div>
    </div>
  )
}
