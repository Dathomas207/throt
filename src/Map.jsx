import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { getConfig, getHeat } from './config.js'
import { ROUTES, haversine } from './data.js'
import { perfMark } from './osm.js'
const TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const MB_ATTR = '&copy; <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> <a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noopener">Improve this map</a>'
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
const DEFAULT_VIEW = [42.3852, -71.1492]
const CONFIG_WAIT_MS = 400 // how long the first tiles wait for the server settings before starting on CARTO
const TILE_FAILS = 4 // this many tile errors inside TILE_WINDOW_MS before the basemap is swapped
const TILE_WINDOW_MS = 8000
const MILE_MARK_MIN = 2 // routes at least this long get a marker at every whole mile
const MAX_MILE_MARKS = 40
// Sample heat for the demo and for static hosting: Biscuit's seeded routes.
const sampleHeat = () => Object.values(ROUTES).flatMap((r) => r.pts.filter((_, i) => i % 2 === 0).map((p) => [p[0], p[1], 1]))
// Heat data is fetched once per page load and its layer is built once per map.
let heatOnce = null
const heatData = () => heatOnce || (heatOnce = getHeat().then((pts) => (pts && pts.length ? pts : sampleHeat()), () => sampleHeat()))
// Points at each whole mile along a line: [{ at:[lat,lng], mile }]
export function mileMarkers(pts, max = MAX_MILE_MARKS) {
  const out = []
  let d = 0, next = 1
  for (let i = 1; i < (pts ? pts.length : 0) && out.length < max; i++) {
    const a = pts[i - 1], b = pts[i], step = haversine(a, b)
    while (step > 0 && d + step >= next && out.length < max) { const t = (next - d) / step; out.push({ at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], mile: next }); next++ }
    d += step
  }
  return out
}
const PIN_GLYPH = { park: 'P', bar: 'B', cafe: 'C', shop: 'S', vet: 'V', care: 'D', water: 'W', other: '+' }
const pinIcon = (p, on) => { const glyph = PIN_GLYPH[p.category]; return L.divIcon({ className: '', iconSize: [36, 36], iconAnchor: [18, 18], html: `<div class="pin ${glyph ? 'cat c-' + p.category : ''} ${p.community ? 'comm' : ''} ${on ? 'on' : ''}"><span>${glyph || ''}</span></div>` }) }
const pinKey = (p, on) => `${p.category || ''}|${p.community ? 1 : 0}|${on ? 1 : 0}|${p.name || ''}`
// All props but route are optional, so <TrotMap route={pts} className="dmap" /> still works.
//   onMove(bounds, byUser)  bounds is { s, w, n, e, center, zoom }; byUser is false for moves the map made itself
//   view { at, zoom, n }    recenters whenever n changes; also the starting view, so the first paint is already in place
//   me [lat, lng]           draws the user's location dot
//   bottom (px)             height of a sheet covering the bottom of the map; keeps controls, attribution and fits clear of it
//   top (px)                height of the controls covering the top of the map, for the same purpose
//   onTap([lat, lng])       called for a tap on the map itself; turns off double-tap zoom while set
//   waypoints [[lat,lng]]   numbered markers, 1 first. A last point that repeats the first is not numbered again
//   fit                     false stops the map refitting itself when the route changes (used while building a route)
//   pins[]                  { id, at, name, category, community }. Markers are updated by id, not rebuilt
//   selected                id of the highlighted pin; focus { id, n } centers that pin in the clear part of the map when n changes
//   drop [lat, lng]         a single "+" marker, used while placing a new community place
//   lines [{ id, pts, kind }]  extra tappable lines (kind 'trail' or 'saved'); onLine(id) is called for a tap on one
//   walked [[lat,lng]]      the part of the route covered so far, drawn solid over the dashed full route
//   follow                  with live, false stops the map recentering on the newest point
//   onUserMove()            called when the person drags, pinches, wheels, uses the keyboard or presses a zoom button
//   mileMarks               false hides the marker at each whole mile of a route of 2 miles or more
//   wheel                   'always' zooms on the wheel straight away (full-screen maps). The default 'focus' waits
//                           for a tap or click on the map, so a map inside a scrolling page never steals the scroll.
//                           On touch screens one-finger panning waits for that tap too. Zoom buttons always work.
export default function TrotMap({ route, upto, pins, onPin, selected, focus, live, className = '', interactive = true, onMove, view, me, bottom = 0, top = 120, heat = false, onTap, waypoints, fit = true, drop, lines, onLine, walked, follow = true, onUserMove, wheel = 'focus', mileMarks = true }) {
  const el = useRef(null), map = useRef(null), G = useRef(null), prog = useRef(0), fitKey = useRef(null), cb = useRef({}), userZoom = useRef(false)
  const pinMap = useRef(new Map()), rt = useRef(null), heatLayer = useRef(null)
  cb.current = { onMove, onPin, onTap, onLine, onUserMove }
  const auto = () => { prog.current = Date.now() }
  useEffect(() => {
    const node = el.current, t0 = performance.now()
    const gate = interactive && wheel !== 'always'
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    const m = L.map(node, { zoomControl: false, attributionControl: true, dragging: interactive && !(gate && coarse), scrollWheelZoom: interactive && !gate, doubleClickZoom: interactive, touchZoom: interactive, boxZoom: false, keyboard: interactive })
    m.attributionControl.setPrefix(false)
    L.control.scale({ metric: false, imperial: true, position: 'bottomleft', maxWidth: 90 }).addTo(m)
    let dead = false
    const user = () => { userZoom.current = true; const f = cb.current.onUserMove; if (f) f() }
    const cleanup = []
    if (interactive) {
      // The only zoom control: real buttons, 44px, above the attribution in the bottom right corner, which the sheet height keeps clear.
      const Zoom = L.Control.extend({ onAdd() {
        const box = L.DomUtil.create('div', 'zoomctl')
        const mk = (label, text, fn) => { const b = L.DomUtil.create('button', '', box); b.type = 'button'; b.setAttribute('aria-label', label); b.textContent = text; b.addEventListener('click', () => { user(); fn() }) }
        mk('Zoom in', '+', () => m.zoomIn()); mk('Zoom out', '−', () => m.zoomOut())
        L.DomEvent.disableClickPropagation(box); L.DomEvent.disableScrollPropagation(box)
        return box
      } })
      new Zoom({ position: 'bottomright' }).addTo(m)
      m.on('dragstart', user)
      const onWheel = () => { if (m.scrollWheelZoom.enabled()) user() }
      const onTouch = (e) => { if (e.touches && e.touches.length > 1) user() }
      const onKey = (e) => { if (/^(Arrow|\+|-|=)/.test(e.key)) user() }
      node.addEventListener('wheel', onWheel, { passive: true }); node.addEventListener('touchstart', onTouch, { passive: true }); node.addEventListener('keydown', onKey)
      cleanup.push(() => { node.removeEventListener('wheel', onWheel); node.removeEventListener('touchstart', onTouch); node.removeEventListener('keydown', onKey) })
    }
    if (gate) {
      let engaged = false
      const hint = L.DomUtil.create('div', 'maphint', node)
      hint.textContent = coarse ? 'Tap the map to move it' : 'Click the map to zoom with the wheel'
      const engage = () => { if (engaged) return; engaged = true; m.dragging.enable(); m.scrollWheelZoom.enable(); node.classList.add('engaged') }
      const release = (e) => { if (!engaged || node.contains(e.target)) return; engaged = false; if (coarse) m.dragging.disable(); m.scrollWheelZoom.disable(); node.classList.remove('engaged') }
      m.on('click', engage)
      document.addEventListener('pointerdown', release, true)
      cleanup.push(() => document.removeEventListener('pointerdown', release, true))
    }
    // Tiles. One slow or failed tile must not swap the whole basemap, so a layer is only given up on
    // after several tile errors close together.
    const guard = (layer, onFail) => {
      let errs = [], loaded = 0
      // A phone screen can hold as few as three tiles, so a layer that has never loaded one is given up on after two errors.
      layer.on('tileerror', () => { const now = Date.now(); errs = errs.filter((t) => now - t < TILE_WINDOW_MS); errs.push(now); if (errs.length >= TILE_FAILS || (loaded === 0 && errs.length >= 2)) onFail() })
      layer.on('tileload', () => { loaded++; perfMark('first-tile', t0) })
    }
    const carto = () => { const t = L.tileLayer(TILES, { maxZoom: 19, attribution: ATTR, updateWhenIdle: false, keepBuffer: 3 }).addTo(m); guard(t, () => node.classList.add('no-tiles')); return t }
    // Mapbox style tiles when the server has a public token: 512px tiles, at double resolution only on dense screens.
    const mapbox = (c) => {
      const style = c.mapboxStyle || 'mapbox/outdoors-v12', dense = (window.devicePixelRatio || 1) >= 2
      const mb = L.tileLayer(`https://api.mapbox.com/styles/v1/${style}/tiles/512/{z}/{x}/{y}${dense ? '@2x' : ''}?access_token=${c.mapboxToken}`, { tileSize: 512, zoomOffset: -1, maxZoom: 20, attribution: MB_ATTR, updateWhenIdle: false, keepBuffer: 2 }).addTo(m)
      let failed = false
      guard(mb, () => { if (failed || dead) return; failed = true; m.removeLayer(mb); node.classList.remove('mapbox'); carto() })
      node.classList.add('mapbox')
    }
    // The settings usually come straight from the cache. If they do not, tiles start on CARTO rather than wait.
    let base = null, settled = false
    const wait = setTimeout(() => { if (!settled && !dead) base = carto() }, CONFIG_WAIT_MS)
    getConfig().then((c) => {
      perfMark('config', t0)
      settled = true; clearTimeout(wait)
      if (dead) return
      if (c && c.mapboxToken) { if (base) m.removeLayer(base); mapbox(c) } else if (!base) base = carto()
    })
    const grp = () => L.layerGroup().addTo(m)
    G.current = { lines: grp(), route: grp(), miles: grp(), marks: grp(), me: grp(), pins: grp() }
    m.setView((view && view.at) || DEFAULT_VIEW, (view && view.zoom) || 14)
    m.on('moveend', () => {
      const f = cb.current.onMove; if (!f) return
      const b = m.getBounds(), c = m.getCenter(), byUser = Date.now() - prog.current > 900
      f({ s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast(), center: [c.lat, c.lng], zoom: m.getZoom() }, byUser)
    })
    m.on('click', (e) => { const f = cb.current.onTap; if (f && e.latlng) f([e.latlng.lat, e.latlng.lng]) })
    map.current = m
    perfMark('map-ready', t0)
    const ro = new ResizeObserver(() => { auto(); m.invalidateSize() }); ro.observe(node)
    return () => { dead = true; clearTimeout(wait); cleanup.forEach((f) => f()); ro.disconnect(); pinMap.current.clear(); rt.current = null; heatLayer.current = null; m.remove() }
  }, [])
  useEffect(() => {
    const m = map.current; if (!m || !heat) return
    let off = false
    // The layer is built the first time it is wanted and then only added and removed.
    if (heatLayer.current) heatLayer.current.addTo(m)
    else heatData().then((data) => {
      if (off || heatLayer.current || map.current !== m) return
      const max = Math.max(1, ...data.map((p) => p[2] || 1))
      // A blurred pane of soft dots under the route and pins. Hotter cells are brighter and larger.
      if (!m.getPane('heat')) { const pane = m.createPane('heat'); pane.style.zIndex = 350; pane.style.filter = 'blur(5px)'; pane.style.pointerEvents = 'none' }
      const renderer = L.canvas({ pane: 'heat', padding: 0.3 })
      heatLayer.current = L.layerGroup(data.map((p) => { const t = (p[2] || 1) / max; return L.circleMarker([p[0], p[1]], { renderer, pane: 'heat', radius: 6 + 5 * t, stroke: false, interactive: false, fillColor: t > 0.66 ? '#FF5A1F' : t > 0.33 ? '#FF8A5B' : '#7B5CFF', fillOpacity: 0.35 + 0.4 * t }) })).addTo(m)
    })
    return () => { off = true; if (heatLayer.current && map.current === m) m.removeLayer(heatLayer.current) }
  }, [heat])
  useEffect(() => {
    const m = map.current; if (!m || !interactive) return
    if (onTap) m.doubleClickZoom.disable(); else m.doubleClickZoom.enable()
  }, [!!onTap])
  useEffect(() => {
    const m = map.current; if (!m || !view || !view.at) return
    auto(); m.setView(view.at, view.zoom || m.getZoom(), { animate: false })
  }, [view && view.n])
  // Route: the layers are created once and then moved, so playback does not rebuild them four times a second.
  useEffect(() => {
    const m = map.current, g = G.current && G.current.route; if (!m) return
    const hasRoute = route && route.length > 1
    if (!hasRoute) {
      if (rt.current) { g.clearLayers(); rt.current = null }
      if (live && follow && route && route.length === 1) { auto(); m.setView(route[0], userZoom.current ? m.getZoom() : Math.max(m.getZoom(), 16), { animate: true }) }
      fitKey.current = null
      return
    }
    const part = walked && walked.length > 1, dashed = upto != null || part, moving = dashed || !!live
    const done = part ? walked : upto == null ? route : route.slice(0, Math.max(2, upto + 1))
    const end = done[done.length - 1], key = `${moving}|${dashed}`
    let R = rt.current
    if (!R || R.key !== key) {
      g.clearLayers()
      R = rt.current = { key, route: null }
      if (dashed) R.dash = L.polyline(route, { color: '#0F1B2D', weight: 4, opacity: 0.18, dashArray: '2 8' }).addTo(g)
      R.halo = L.polyline(done, { color: '#FFFFFF', weight: 9, opacity: 0.95 }).addTo(g)
      R.line = L.polyline(done, { color: '#1F5AE8', weight: 5 }).addTo(g)
      R.start = L.circleMarker(route[0], { radius: 6, color: '#0F1B2D', weight: 3, fillColor: '#FFFFFF', fillOpacity: 1 }).addTo(g)
      if (moving) { R.glow = L.circleMarker(end, { radius: 16, stroke: false, fillColor: '#1F5AE8', fillOpacity: 0.2 }).addTo(g); R.end = L.circleMarker(end, { radius: 8, color: '#FFFFFF', weight: 3, fillColor: '#1F5AE8', fillOpacity: 1 }).addTo(g) }
      else R.end = L.circleMarker(end, { radius: 6, color: '#FFFFFF', weight: 3, fillColor: '#0F1B2D', fillOpacity: 1 }).addTo(g)
    } else {
      if (R.route !== route) { if (R.dash) R.dash.setLatLngs(route); R.start.setLatLng(route[0]) }
      R.halo.setLatLngs(done); R.line.setLatLngs(done)
      if (R.glow) R.glow.setLatLng(end)
      R.end.setLatLng(end)
    }
    R.route = route
    if (live) { if (follow) { auto(); m.setView(end, userZoom.current ? m.getZoom() : Math.max(m.getZoom(), 16), { animate: true }) } }
    else if (!pins) { if (fitKey.current !== route) { auto(); m.fitBounds(L.latLngBounds(route), { padding: [28, 28], animate: false }) } }
    else if (fit && fitKey.current !== route) { auto(); m.fitBounds(L.latLngBounds(route), { paddingTopLeft: [28, top], paddingBottomRight: [28, bottom + 28], animate: false }) }
    fitKey.current = route
  }, [route, upto, walked, live, follow])
  useEffect(() => {
    const g = G.current && G.current.miles; if (!g) return
    g.clearLayers()
    if (!mileMarks || !route || route.length < 2) return
    const marks = mileMarkers(route)
    if (marks.length < MILE_MARK_MIN) return
    marks.forEach((k) => L.marker(k.at, { interactive: false, keyboard: false, zIndexOffset: 300, icon: L.divIcon({ className: '', iconSize: [40, 20], iconAnchor: [20, 10], html: `<div class="milemark">${k.mile} mi</div>` }) }).addTo(g))
  }, [route, mileMarks])
  useEffect(() => {
    const g = G.current && G.current.me; if (!g) return
    g.clearLayers()
    const dot = me || (live && route && route.length === 1 ? route[0] : null)
    if (dot) { L.circleMarker(dot, { radius: 16, stroke: false, fillColor: '#1F5AE8', fillOpacity: 0.2, interactive: false }).addTo(g); L.circleMarker(dot, { radius: 7, color: '#FFFFFF', weight: 3, fillColor: '#1F5AE8', fillOpacity: 1, interactive: false }).addTo(g) }
  }, [me && me[0], me && me[1], live, route && route.length === 1 ? route[0] : null])
  useEffect(() => {
    const g = G.current && G.current.lines; if (!g) return
    g.clearLayers()
    ;(lines || []).forEach((l) => {
      if (!l.pts || l.pts.length < 2) return
      const saved = l.kind === 'saved'
      L.polyline(l.pts, { color: '#FFFFFF', weight: 7, opacity: 0.9, interactive: false }).addTo(g)
      L.polyline(l.pts, { color: saved ? '#0F1B2D' : '#1F5AE8', weight: 4, opacity: saved ? 0.85 : 0.75, dashArray: saved ? '8 7' : null, interactive: false }).addTo(g)
      // A wide invisible line on top makes a thin line easy to tap.
      L.polyline(l.pts, { color: '#1F5AE8', weight: 26, opacity: 0, bubblingMouseEvents: false }).addTo(g).on('click', () => cb.current.onLine && cb.current.onLine(l.id))
    })
  }, [lines])
  useEffect(() => {
    const g = G.current && G.current.marks; if (!g) return
    g.clearLayers()
    const wps = waypoints || [], closed = wps.length > 2 && wps[0][0] === wps[wps.length - 1][0] && wps[0][1] === wps[wps.length - 1][1]
    wps.forEach((w, i) => {
      if (closed && i === wps.length - 1) return
      L.marker(w, { interactive: false, keyboard: false, zIndexOffset: 800, icon: L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14], html: `<div class="wpt">${i + 1}</div>` }) }).addTo(g)
    })
    if (drop) L.marker(drop, { interactive: false, keyboard: false, zIndexOffset: 900, icon: L.divIcon({ className: '', iconSize: [32, 32], iconAnchor: [16, 16], html: '<div class="wpt drop">+</div>' }) }).addTo(g)
  }, [waypoints, drop && drop[0], drop && drop[1]])
  // Pins are diffed by id: new ones are added, gone ones removed, and an icon is only replaced when its look changes.
  useEffect(() => {
    const g = G.current && G.current.pins, have = pinMap.current; if (!g) return
    const seen = new Set()
    ;(pins || []).forEach((p) => {
      const on = selected === p.id, key = pinKey(p, on)
      let e = have.get(p.id)
      if (!e) {
        e = { key, p }
        e.marker = L.marker(p.at, { icon: pinIcon(p, on), title: p.name, keyboard: true, zIndexOffset: on ? 500 : 0 }).addTo(g).on('click', () => cb.current.onPin && cb.current.onPin(e.p))
        have.set(p.id, e)
      } else {
        if (e.key !== key) { e.marker.setIcon(pinIcon(p, on)); e.marker.setZIndexOffset(on ? 500 : 0); e.key = key }
        const ll = e.marker.getLatLng()
        if (ll.lat !== p.at[0] || ll.lng !== p.at[1]) e.marker.setLatLng(p.at)
        e.p = p
      }
      seen.add(p.id)
    })
    have.forEach((e, id) => { if (!seen.has(id)) { g.removeLayer(e.marker); have.delete(id) } })
  }, [pins, selected])
  const clearCenter = (m, at, always) => {
    const size = m.getSize(), pt = m.latLngToContainerPoint(at), clear = Math.max(top + 40, size.y - bottom)
    if (!always && pt.x > 30 && pt.x < size.x - 30 && pt.y > top - 10 && pt.y < clear - 30) return
    // The container point that has to become the map center for `at` to sit mid-way between the top controls and the sheet.
    auto(); m.panTo(m.containerPointToLatLng([pt.x, pt.y + size.y / 2 - (top + clear) / 2]), { animate: true })
  }
  useEffect(() => {
    // Bring the selected pin into the part of the map that is not under the sheet.
    const m = map.current; if (!m || !pins || (route && route.length > 1)) return
    const sel = pins.find((p) => p.id === selected); if (!sel) return
    clearCenter(m, sel.at, false)
  }, [selected])
  useEffect(() => {
    // A list row was tapped: put its pin in the middle of the clear part of the map.
    const m = map.current; if (!m || !pins || !focus) return
    const sel = pins.find((p) => p.id === focus.id); if (!sel) return
    clearCenter(m, sel.at, true)
  }, [focus && focus.n])
  return <div ref={el} className={`map ${className}${onTap ? ' tapmode' : ''}`} style={{ '--map-bottom': bottom + 'px' }} role="region" aria-label="Map" />
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
