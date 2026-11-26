import React from 'react'

// The small route drawing on feed cards. Plain SVG, kept apart from the map so the feed never loads the map library.
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
