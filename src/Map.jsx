import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { getConfig, getHeat } from './config.js'
import { ROUTES } from './data.js'
import './zoom.css'
const TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const MB_ATTR = '&copy; <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> <a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noopener">Improve this map</a>'
// Sample heat for the demo and for static hosting: Biscuit's seeded routes.
const sampleHeat = () => Object.values(ROUTES).flatMap((r) => r.pts.filter((_, i) => i % 2 === 0).map((p) => [p[0], p[1], 1]))
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
// Props added for Explore and Record. All are optional, so <TrotMap route={pts} className="dmap" /> still works.
//   onMove(bounds, byUser)  bounds is { s, w, n, e, center, zoom }; byUser is false for moves the map made itself
//   view { at, zoom, n }    recenters whenever n changes
//   me [lat, lng]           draws the user's location dot
//   bottom (px)             height of a sheet covering the bottom of the map; keeps attribution and fits clear of it
export default function TrotMap({ route, upto, pins, onPin, selected, live, className = '', interactive = true, onMove, view, me, bottom = 0, heat = false }) {
  const el = useRef(null), map = useRef(null), layers = useRef(null), prog = useRef(0), fitKey = useRef(null), cb = useRef({})
  cb.current = { onMove, onPin }
  const auto = () => { prog.current = Date.now() }
  useEffect(() => {
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, dragging: interactive, scrollWheelZoom: interactive, doubleClickZoom: interactive, touchZoom: interactive, boxZoom: false, keyboard: false })
    m.attributionControl.setPrefix(false)
    if (interactive) L.control.zoom({ position: 'topleft', zoomInTitle: 'Zoom in', zoomOutTitle: 'Zoom out' }).addTo(m)
    let dead = false
    const carto = () => { const t = L.tileLayer(TILES, { maxZoom: 19, attribution: ATTR }).addTo(m); t.on('tileerror', () => el.current && el.current.classList.add('no-tiles')); return t }
    // Mapbox style tiles when the server has a public token; CARTO otherwise or if Mapbox refuses the token.
    getConfig().then((c) => {
      if (dead) return
      if (!c || !c.mapboxToken) { carto(); return }
      const style = c.mapboxStyle || 'mapbox/outdoors-v12'
      const mb = L.tileLayer(`https://api.mapbox.com/styles/v1/${style}/tiles/512/{z}/{x}/{y}@2x?access_token=${c.mapboxToken}`, { tileSize: 512, zoomOffset: -1, maxZoom: 20, attribution: MB_ATTR }).addTo(m)
      let failed = false
      mb.on('tileerror', () => { if (failed || dead) return; failed = true; m.removeLayer(mb); carto() })
      if (el.current) el.current.classList.add('mapbox')
    })
    layers.current = L.layerGroup().addTo(m)
    m.setView([42.3852, -71.1492], 14)
    m.on('moveend', () => {
      const f = cb.current.onMove; if (!f) return
      const b = m.getBounds(), c = m.getCenter(), byUser = Date.now() - prog.current > 900
      f({ s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast(), center: [c.lat, c.lng], zoom: m.getZoom() }, byUser)
    })
    map.current = m
    const ro = new ResizeObserver(() => { auto(); m.invalidateSize() }); ro.observe(el.current)
    return () => { dead = true; ro.disconnect(); m.remove() }
  }, [])
  useEffect(() => {
    const m = map.current; if (!m || !heat) return
    let layer = null, off = false
    getHeat().then((pts) => {
      if (off) return
      const data = pts && pts.length ? pts : sampleHeat()
      const max = Math.max(1, ...data.map((p) => p[2] || 1))
      // A blurred pane of soft dots under the route and pins. Hotter cells are brighter and larger.
      if (!m.getPane('heat')) { const pane = m.createPane('heat'); pane.style.zIndex = 350; pane.style.filter = 'blur(5px)'; pane.style.pointerEvents = 'none' }
      const renderer = L.canvas({ pane: 'heat', padding: 0.3 })
      layer = L.layerGroup(data.map((p) => { const t = (p[2] || 1) / max; return L.circleMarker([p[0], p[1]], { renderer, pane: 'heat', radius: 6 + 5 * t, stroke: false, interactive: false, fillColor: t > 0.66 ? '#FF5A1F' : t > 0.33 ? '#FF8A5B' : '#7B5CFF', fillOpacity: 0.35 + 0.4 * t }) })).addTo(m)
    })
    return () => { off = true; if (layer) m.removeLayer(layer) }
  }, [heat])
  useEffect(() => {
    const m = map.current; if (!m || !view || !view.at) return
    auto(); m.setView(view.at, view.zoom || m.getZoom(), { animate: false })
  }, [view && view.n])
  useEffect(() => {
    const m = map.current, g = layers.current; if (!m) return
    g.clearLayers()
    const hasRoute = route && route.length > 1
    if (hasRoute) {
      const done = upto == null ? route : route.slice(0, Math.max(2, upto + 1))
      if (upto != null) L.polyline(route, { color: '#0F1B2D', weight: 4, opacity: 0.18, dashArray: '2 8' }).addTo(g)
      L.polyline(done, { color: '#FFFFFF', weight: 9, opacity: 0.95 }).addTo(g)
      L.polyline(done, { color: '#1F5AE8', weight: 5 }).addTo(g)
      L.circleMarker(route[0], { radius: 6, color: '#0F1B2D', weight: 3, fillColor: '#FFFFFF', fillOpacity: 1 }).addTo(g)
      const end = done[done.length - 1]
      if (upto != null || live) { L.circleMarker(end, { radius: 16, stroke: false, fillColor: '#1F5AE8', fillOpacity: 0.2 }).addTo(g); L.circleMarker(end, { radius: 8, color: '#FFFFFF', weight: 3, fillColor: '#1F5AE8', fillOpacity: 1 }).addTo(g) }
      else L.circleMarker(end, { radius: 6, color: '#FFFFFF', weight: 3, fillColor: '#0F1B2D', fillOpacity: 1 }).addTo(g)
      if (live) { auto(); m.setView(end, Math.max(m.getZoom(), 16), { animate: true }) }
      else if (!pins) { auto(); m.fitBounds(L.latLngBounds(route), { padding: [28, 28], animate: false }) }
      else if (fitKey.current !== route) { auto(); m.fitBounds(L.latLngBounds(route), { paddingTopLeft: [28, 120], paddingBottomRight: [28, bottom + 28], animate: false }) }
    } else if (live && route && route.length === 1) { auto(); m.setView(route[0], Math.max(m.getZoom(), 16), { animate: true }) }
    fitKey.current = hasRoute ? route : null
    const dot = me || (live && route && route.length === 1 ? route[0] : null)
    if (dot) { L.circleMarker(dot, { radius: 16, stroke: false, fillColor: '#1F5AE8', fillOpacity: 0.2, interactive: false }).addTo(g); L.circleMarker(dot, { radius: 7, color: '#FFFFFF', weight: 3, fillColor: '#1F5AE8', fillOpacity: 1, interactive: false }).addTo(g) }
    ;(pins || []).forEach((p) => {
      const on = selected === p.id
      const icon = L.divIcon({ className: '', iconSize: [36, 36], iconAnchor: [18, 18], html: `<div class="pin ${on ? 'on' : ''}"><span></span></div>` })
      L.marker(p.at, { icon, title: p.name, keyboard: true, zIndexOffset: on ? 500 : 0 }).addTo(g).on('click', () => cb.current.onPin && cb.current.onPin(p))
    })
  }, [route, upto, pins, selected, live, me && me[0], me && me[1]])
  useEffect(() => {
    // Bring the selected pin into the part of the map that is not under the sheet.
    const m = map.current; if (!m || !pins || (route && route.length > 1)) return
    const sel = pins.find((p) => p.id === selected); if (!sel) return
    const size = m.getSize(), pt = m.latLngToContainerPoint(sel.at), clear = Math.max(120, size.y - bottom)
    if (pt.x > 30 && pt.x < size.x - 30 && pt.y > 110 && pt.y < clear - 30) return
    auto(); m.panTo(m.containerPointToLatLng([pt.x, pt.y + (size.y - clear) / 2]), { animate: true })
  }, [selected])
  return <div ref={el} className={`map ${className}`} style={{ '--map-bottom': bottom + 'px' }} role="img" aria-label="Map" />
}
// Height in px of whatever element the returned ref callback is attached to, kept current.
// Used to tell the map how much of it a bottom sheet covers: const [ref, h] = useHeight()
export function useHeight() {
  const [node, setNode] = useState(null), [h, setH] = useState(0)
  useEffect(() => {
    if (!node) { setH(0); return }
    const read = () => setH((v) => (Math.abs(v - node.offsetHeight) > 2 ? node.offsetHeight : v))
    read()
    const ro = new ResizeObserver(read); ro.observe(node)
    return () => ro.disconnect()
  }, [node])
  return [setNode, h]
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
