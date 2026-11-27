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
//   build                   the route builder's own drawing, in place of `route`:
//                           { legs: [{ pts, mode, pending, approximate }], points, editing, selected, fitN, focus: { leg, n },
//                             onMove(i, [lat, lng]), onSelect(i), onInsert(leg, [lat, lng]) }
//                           Straight legs are dashed. While editing, each control point is a handle with a 44px
//                           hit area that drags without panning the map, and a tap on the line calls onInsert.
//                           fitN refits the view when it changes; focus zooms to one leg.
//   mileLine, mileMin       a line to put mile markers on when there is no `route`, and how many miles it needs before they show
//   wheel                   'always' zooms on the wheel straight away (full-screen maps). The default 'focus' waits
//                           for a tap or click on the map, so a map inside a scrolling page never steals the scroll.
//                           On touch screens one-finger panning waits for that tap too. Zoom buttons always work.
export default function TrotMap({ route, upto, pins, onPin, selected, focus, live, className = '', interactive = true, onMove, view, me, bottom = 0, top = 120, heat = false, onTap, waypoints, fit = true, drop, lines, onLine, walked, follow = true, onUserMove, wheel = 'focus', mileMarks = true, build, mileLine, mileMin = MILE_MARK_MIN }) {
  const el = useRef(null), map = useRef(null), G = useRef(null), prog = useRef(0), fitKey = useRef(null), cb = useRef({}), userZoom = useRef(false)
  const pinMap = useRef(new Map()), rt = useRef(null), heatLayer = useRef(null)
  cb.current = { onMove, onPin, onTap, onLine, onUserMove, build }
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
    G.current = { lines: grp(), route: grp(), build: grp(), miles: grp(), marks: grp(), me: grp(), pins: grp() }
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
      if (!m.getPane('heat')) { const pane = m.createPane('heat'); pane.style.zIndex = 350; pane.style.filter = 'blur(9px)'; pane.style.opacity = '0.55'; pane.style.pointerEvents = 'none' }
      const renderer = L.canvas({ pane: 'heat', padding: 0.3 })
      heatLayer.current = L.layerGroup(data.map((p) => { const t = (p[2] || 1) / max; return L.circleMarker([p[0], p[1]], { renderer, pane: 'heat', radius: 5 + 3 * t, stroke: false, interactive: false, fillColor: t > 0.66 ? '#1F5AE8' : t > 0.33 ? '#4F7DEE' : '#8FAAF3', fillOpacity: 0.18 + 0.3 * t }) })).addTo(m)
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
    const src = mileLine || route
    if (!mileMarks || !src || src.length < 2) return
    const marks = mileMarkers(src)
    if (marks.length < mileMin) return
    marks.forEach((k) => L.marker(k.at, { interactive: false, keyboard: false, zIndexOffset: 300, icon: L.divIcon({ className: '', iconSize: [40, 20], iconAnchor: [20, 10], html: `<div class="milemark">${k.mile} mi</div>` }) }).addTo(g))
  }, [route, mileLine, mileMin, mileMarks])
  // The route builder's legs and handles. Everything is rebuilt on a change: a route has at most 25 legs.
  useEffect(() => {
    const m = map.current, g = G.current && G.current.build; if (!m || !g) return
    g.clearLayers()
    if (!build) return
    const { legs = [], points = [], editing, selected } = build
    const B = () => cb.current.build || {}
    legs.forEach((l, i) => {
      if (!l.pts || l.pts.length < 2) return
      const soft = !!(l.pending || l.approximate)
      L.polyline(l.pts, { color: '#FFFFFF', weight: 9, opacity: 0.95, interactive: false }).addTo(g)
      L.polyline(l.pts, { color: soft ? '#5B6472' : '#1F5AE8', weight: 5, opacity: l.pending ? 0.5 : 1, dashArray: l.pending ? '2 9' : l.mode === 'straight' || soft ? '9 10' : null, interactive: false }).addTo(g)
      // A wide invisible line on top takes the tap that adds a point. It does not pass the tap on to the map.
      if (editing) L.polyline(l.pts, { color: '#1F5AE8', weight: 30, opacity: 0, bubblingMouseEvents: false }).addTo(g).on('click', (e) => { const f = B().onInsert; if (f && e.latlng) f(i, [e.latlng.lat, e.latlng.lng]) })
    })
    const n = points.length, closed = n > 2 && Math.abs(points[0][0] - points[n - 1][0]) < 1e-6 && Math.abs(points[0][1] - points[n - 1][1]) < 1e-6
    const preview = editing ? L.polyline([], { color: '#0F1B2D', weight: 3, opacity: 0.7, dashArray: '4 7', interactive: false }).addTo(g) : null
    points.forEach((p, i) => {
      if (closed && i === n - 1) return
      const end = i === n - 1 && n > 1, kind = i === 0 ? 'start' : end ? 'end' : 'via'
      if (!editing && kind === 'via') return
      const label = i === 0 ? 'Start' : end ? 'End' : `Point ${i + 1}`
      const icon = L.divIcon({ className: 'rhwrap', iconSize: [44, 44], iconAnchor: [22, 22], html: `<div class="rh ${kind}${selected === i ? ' on' : ''}">${kind === 'via' ? i + 1 : ''}</div>` })
      const mk = L.marker(p, { icon, draggable: !!editing, interactive: !!editing, keyboard: false, autoPan: false, bubblingMouseEvents: false, title: editing ? label : '', alt: label, zIndexOffset: 1000 + (selected === i ? 600 : kind === 'via' ? 0 : 300) }).addTo(g)
      if (!editing) return
      mk.on('click', () => { const f = B().onSelect; if (f) f(i) })
      // While a handle moves, a thin line shows what it will join. The router is only asked when it is let go.
      const prev = i > 0 ? points[i - 1] : closed ? points[n - 2] : null, next = i < n - 1 ? points[i + 1] : null
      mk.on('drag', () => { const ll = mk.getLatLng(), at = [ll.lat, ll.lng]; preview.setLatLngs([...(prev ? [prev] : []), at, ...(next ? [next] : [])]) })
      mk.on('dragend', () => { const ll = mk.getLatLng(), f = B().onMove; preview.setLatLngs([]); if (f) f(i, [ll.lat, ll.lng]) })
    })
  }, [build && build.legs, build && build.points, build && build.editing, build && build.selected])
  const fitTo = (m, pts, maxZoom) => { if (!pts || !pts.length) return; auto(); if (pts.length === 1) m.setView(pts[0], Math.max(m.getZoom(), 15), { animate: false }); else m.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [28, top + 8], paddingBottomRight: [28, bottom + 28], animate: false, ...(maxZoom ? { maxZoom } : {}) }) }
  useEffect(() => {
    const m = map.current; if (!m || !build || !build.fitN) return
    const pts = (build.legs || []).flatMap((l) => l.pts || [])
    fitTo(m, pts.length ? pts : build.points || [], 17)
  }, [build && build.fitN])
  useEffect(() => {
    const m = map.current, f = build && build.focus; if (!m || !f) return
    const l = (build.legs || [])[f.leg]
    if (l) fitTo(m, l.pts, 18)
  }, [build && build.focus && build.focus.n])
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
export { RouteThumb } from './RouteThumb.jsx'
