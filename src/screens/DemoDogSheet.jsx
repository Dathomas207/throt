import React from 'react'
import { DogAv, Stat } from '../ui.jsx'
import { PACK, DEMO_BOARD, fmtTime, dayLabel } from '../data.js'

// A small profile for one of the demo's other dogs, built from the sample data.
export default function DemoDogSheet({ name, close }) {
  const outs = PACK.filter((a) => a.dog === name), row = DEMO_BOARD.find((d) => d.name === name), breed = (outs[0] && outs[0].breed) || (row && row.breed) || ''
  return (
    <div className="scrim" onClick={close}><div className="modal" role="dialog" aria-label={`${name}'s profile`} onClick={(e) => e.stopPropagation()}>
      <div className="grab" />
      <div className="row g14"><DogAv name={name} demo s={64} /><div className="grow"><h2>{name}<span className="tagx">Sample dog</span></h2><p className="meta">{breed}</p></div></div>
      {row && <div className="row g20"><Stat l="MILES THIS WEEK" v={row.miles.toFixed(1)} /><Stat l="OUTINGS" v={row.outings} /><Stat l="TOP SPEED" v={row.top_speed.toFixed(1) + ' mph'} /></div>}
      {outs.map((a) => <div key={a.id} className="hentry"><span className="hb">{a.title}</span><div className="meta">{a.type} with {a.byName} · {dayLabel(a.daysAgo)} · {a.place}{a.miles > 0 ? ` · ${a.miles.toFixed(1)} mi` : ''} · {fmtTime(a.minutes)}</div></div>)}
      <p className="meta">{name} is a made-up dog in the demo pack. Real dogs get a full public page.</p>
      <button className="cta white bordered" onClick={close}>Close</button>
    </div></div>
  )
}
