import { ROUTES, PEOPLE, fmtTime } from './data.js'
export function drawCard(a) {
  const W = 1080, H = 1920, c = document.createElement('canvas'); c.width = W; c.height = H
  const x = c.getContext('2d')
  x.fillStyle = '#0F1B2D'; x.fillRect(0, 0, W, H)
  x.fillStyle = '#18294A'; x.beginPath(); x.roundRect(70, 330, 940, 820, 48); x.fill()
  const pts = a.pts || (a.route && ROUTES[a.route] ? ROUTES[a.route].pts : null)
  if (pts && pts.length > 1) {
    const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1]), lo = Math.min(...lats), hi = Math.max(...lats), l = Math.min(...lngs), r = Math.max(...lngs)
    const s = Math.min(740 / ((r - l) || 1e-6), 620 / ((hi - lo) || 1e-6)), ox = 540 - ((r - l) * s) / 2, oy = 740 - ((hi - lo) * s) / 2
    x.strokeStyle = '#C8F031'; x.lineWidth = 16; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath()
    pts.forEach((p, i) => { const X = ox + (p[1] - l) * s, Y = oy + (hi - p[0]) * s; i ? x.lineTo(X, Y) : x.moveTo(X, Y) }); x.stroke()
  }
  x.fillStyle = '#C8F031'; x.font = 'italic 900 96px Archivo, Arial, sans-serif'; x.fillText('TROT', 70, 190)
  x.fillStyle = '#FFFFFF'; x.font = 'italic 900 150px Archivo, Arial, sans-serif'; x.fillText(a.dog.toUpperCase(), 70, 1340)
  const who = a.byName || (PEOPLE[a.by] ? PEOPLE[a.by].name : '')
  x.font = '500 46px Inter, Arial, sans-serif'; x.fillStyle = '#D5DBE4'; x.fillText(`${a.title}${who ? ' · with ' + who : ''}`.slice(0, 44), 70, 1410)
  const stats = [['DISTANCE', a.miles ? a.miles.toFixed(1) + ' mi' : '-'], ['TIME', fmtTime(a.minutes)], ['SNIFF STOPS', String(a.sniffs)]]
  stats.forEach(([k, v], i) => { const X = 70 + i * 330; x.fillStyle = '#AEB7C4'; x.font = '600 34px Inter, Arial, sans-serif'; x.fillText(k, X, 1540); x.fillStyle = '#FFFFFF'; x.font = 'italic 800 92px Archivo, Arial, sans-serif'; x.fillText(v, X, 1640) })
  x.fillStyle = '#C8F031'; x.fillRect(70, 1740, 120, 10)
  x.fillStyle = '#AEB7C4'; x.font = '500 36px Inter, Arial, sans-serif'; x.fillText('Every walk counts.', 70, 1810)
  return c
}
export async function shareCard(a) {
  const c = drawCard(a)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const file = new File([blob], `${a.dog.toLowerCase()}-trot.png`, { type: 'image/png' })
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: `${a.dog} on Trot` }); return 'shared' }
  } catch (e) { if (e && e.name === 'AbortError') return 'cancelled' }
  try {
    const u = URL.createObjectURL(blob), l = document.createElement('a'); l.href = u; l.download = file.name; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); return 'saved'
  } catch (e) { return 'blocked' }
}
