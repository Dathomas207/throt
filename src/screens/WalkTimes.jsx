import React, { useEffect, useMemo, useState } from 'react'
import { walkWindows, headline, hourLabel, rangeLabel, dayWord, grade } from '../walkWindows.js'
import './walktimes.css'

// "Best time to walk" on the Today screen: an hourly forecast scored for a dog walk.
// The position is the last map position or Eastover, the same one the places row uses,
// so opening Today never asks for location on its own.

const HOME = [35.186, -80.812]
const KEY = 'trot-weather-v1'
function lastCenter() {
  try { const v = JSON.parse(localStorage.getItem('trot-view-v2')); if (v && Array.isArray(v.at) && Number.isFinite(v.at[0]) && Number.isFinite(v.at[1])) return v.at } catch (e) { /* no saved map position */ }
  return HOME
}
const cached = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v && Array.isArray(v.hours) ? v : null } catch (e) { return null } }

export function useForecast(hasApi = true) {
  const [fc, setFc] = useState(() => { const c = cached(); return c && Date.now() - Date.parse(c.updatedAt) < 3 * 3600e3 ? c : null })
  useEffect(() => {
    if (!hasApi) return
    if (fc && Date.now() - Date.parse(fc.updatedAt) < 20 * 60e3 && !fc.stale) return
    let on = true
    const c = lastCenter()
    fetch(`/api/weather?lat=${c[0].toFixed(2)}&lng=${c[1].toFixed(2)}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!on || !j || !Array.isArray(j.hours)) return
      setFc(j)
      try { localStorage.setItem(KEY, JSON.stringify(j)) } catch (e) { /* storage full or off */ }
    }).catch(() => {})
    return () => { on = false }
  }, [hasApi])
  return fc
}

const FLAG = { hot_pavement: 'Hot pavement', too_hot: 'Too hot', very_cold: 'Very cold', storm: 'Storms', wet: 'Rain likely', windy: 'Windy' }

export default function WalkTimes({ name, hasApi = true, onWalk }) {
  const fc = useForecast(hasApi)
  const r = useMemo(() => (fc ? walkWindows(fc.hours) : null), [fc])
  if (!r || !r.hours.length) return null
  const strip = r.hours.slice(0, 12)
  const inWindow = (h) => r.windows.some((w) => Date.parse(h.t) >= Date.parse(w.start) && Date.parse(h.t) < Date.parse(w.end))
  return (
    <section className="tsec wt">
      <div className="row between thead"><h2>Best time to walk</h2><span className="wtplace">{fc.place || 'Near you'}</span></div>
      <div className="card wtcard">
        <p className="wthead">{headline(name, r)}</p>
        {r.windows.length > 0 && <div className="wtwins">{r.windows.map((w) => <button key={w.start} className="wtwin" onClick={onWalk}>
          <b>{rangeLabel(w.start, w.end)}</b><small>{dayWord(w.start)} · {w.temp}°{w.pop >= 30 ? ` · ${w.pop}% rain` : ' · dry'}{w.dark ? ' · after dark' : ''}</small>
        </button>)}</div>}
        <div className="wtstrip" role="list" aria-label="Next 12 hours, scored for a dog walk">{strip.map((h) => { const g = grade(h.score), f = h.flags.find((x) => FLAG[x]); return (
          <div key={h.t} role="listitem" className={`wth wt-${g} ${inWindow(h) ? 'wt-pick' : ''}`} title={f ? FLAG[f] : h.short} aria-label={`${hourLabel(h.t)}: ${h.temp} degrees, ${Number.isFinite(h.pop) ? h.pop + ' percent chance of rain, ' : ''}${g === 'great' ? 'a good time' : g === 'ok' ? 'fine' : g === 'poor' ? 'not ideal' : 'best avoided'}${f ? ', ' + FLAG[f] : ''}`}>
            <span className="wtt">{hourLabel(h.t).replace(' ', '')}</span>
            <span className="wtbar"><i style={{ height: Math.max(8, h.score) + '%' }} /></span>
            <span className="wtd">{h.temp}°</span>
            <span className="wtp">{Number.isFinite(h.pop) && h.pop >= 20 ? h.pop + '%' : ''}</span>
          </div>) })}</div>
        {r.caution && <p className="wtcaution">{r.caution}</p>}
        <p className="wtfoot">Forecast from the {fc.source || 'National Weather Service'}{fc.stale ? ', last good copy' : ''}. Bars score each hour for a walk by temperature, rain, wind and daylight. A rule of thumb, not veterinary advice.</p>
      </div>
    </section>
  )
}
