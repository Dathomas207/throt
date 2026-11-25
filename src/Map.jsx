import React, { useEffect, useRef } from 'react'
import L from 'leaflet'
const TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
export default function TrotMap({ route, upto, pins, onPin, selected, live, className = '', interactive = true }) {
  const el = useRef(null), map = useRef(null), layers = useRef(null)
  useEffect(() => {
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, dragging: interactive, scrollWheelZoom: false, doubleClickZoom: interactive, touchZoom: interactive, boxZoom: false, keyboard: false })
    m.attributionControl.setPrefix(false)
    const t = L.tileLayer(TILES, { maxZoom: 19, attribution: '&copy; OpenStreetMap &copy; CARTO' }).addTo(m)
    t.on('tileerror', () => el.current && el.current.classList.add('no-tiles'))
    layers.current = L.layerGroup().addTo(m)
    m.setView([42.3852, -71.1492], 14)
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize()); ro.observe(el.current)
    return () => { ro.disconnect(); m.remove() }
  }, [])
  useEffect(() => {
    const m = map.current, g = layers.current; if (!m) return
    g.clearLayers()
    if (route && route.length > 1) {
      const done = upto == null ? route : route.slice(0, Math.max(2, upto + 1))
      if (upto != null) L.polyline(route, { color: '#0F1B2D', weight: 4, opacity: 0.18, dashArray: '2 8' }).addTo(g)
      L.polyline(done, { color: '#FFFFFF', weight: 9, opacity: 0.95 }).addTo(g)
      L.polyline(done, { color: '#1F5AE8', weight: 5 }).addTo(g)
      L.circleMarker(route[0], { radius: 6, color: '#0F1B2D', weight: 3, fillColor: '#FFFFFF', fillOpacity: 1 }).addTo(g)
      const end = done[done.length - 1]
      if (upto != null || live) { L.circleMarker(end, { radius: 16, stroke: false, fillColor: '#1F5AE8', fillOpacity: 0.2 }).addTo(g); L.circleMarker(end, { radius: 8, color: '#FFFFFF', weight: 3, fillColor: '#1F5AE8', fillOpacity: 1 }).addTo(g) }
      else L.circleMarker(end, { radius: 6, color: '#FFFFFF', weight: 3, fillColor: '#0F1B2D', fillOpacity: 1 }).addTo(g)
      if (!live) m.fitBounds(L.latLngBounds(route), { padding: [28, 28], animate: false })
      else m.setView(end, Math.max(m.getZoom(), 16), { animate: true })
    }
    (pins || []).forEach((p) => {
      const on = selected === p.id
      const icon = L.divIcon({ className: '', iconSize: [36, 36], iconAnchor: [18, 18], html: `<div class="pin ${on ? 'on' : ''}"><span></span></div>` })
      L.marker(p.at, { icon, title: p.name, keyboard: true }).addTo(g).on('click', () => onPin && onPin(p))
    })
    if (pins && !route) {
      const sel = pins.find((p) => p.id === selected)
      if (sel) m.setView([sel.at[0] - 0.006, sel.at[1]], 14, { animate: true })
    }
  }, [route, upto, pins, selected, live])
  return <div ref={el} className={`map ${className}`} role="img" aria-label="Map" />
}
export function RouteThumb({ pts, w = 358, h = 130, dark }) {
  if (!pts) return null
  const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1])
  const a = Math.min(...lats), b = Math.max(...lats), c = Math.min(...lngs), d = Math.max(...lngs), pad = 18
  const s = Math.min((w - pad * 2) / ((d - c) || 1e-6), (h - pad * 2) / ((b - a) || 1e-6))
  const ox = (w - (d - c) * s) / 2, oy = (h - (b - a) * s) / 2
  const dstr = pts.map((p, i) => `${i ? 'L' : 'M'}${(ox + (p[1] - c) * s).toFixed(1)} ${(oy + (b - p[0]) * s).toFixed(1)}`).join(' ')
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${w} ${h}`} className="thumb" style={{ background: dark ? '#18294A' : undefined }}>
      {!dark && <><path d={`M0 ${h * 0.3} C${w * 0.3} ${h * 0.05} ${w * 0.6} ${h * 0.5} ${w} ${h * 0.2} V0 H0z`} fill="#D5E8C9" /><path d={`M0 ${h * 0.75} H${w} M${w * 0.22} 0 V${h} M${w * 0.8} 0 V${h}`} stroke="#fff" strokeWidth="5" /></>}
      <path d={dstr} fill="none" stroke={dark ? '#C8F031' : '#fff'} strokeWidth={dark ? 6 : 8} strokeLinecap="round" strokeLinejoin="round" />
      {!dark && <path d={dstr} fill="none" stroke="#1F5AE8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
}
