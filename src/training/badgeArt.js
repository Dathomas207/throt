// Trot's training badge art, as an SVG string, so the app and the public dog page draw the same thing.
// Original shapes in the Trot palette: a shield for a skill, a rosette for a track, a medallion for the
// rest. The ring carries the tier and the numeral is Archivo italic. Every value comes from the fixed
// tables below, never from a person, so the string is safe to place in a page as it is.
const INK = '#0F1B2D', VOLT = '#C8F031', BLUE = '#1F5AE8', GREY = '#9AA3B0'
const RING = { reliable: BLUE, proofed: VOLT, bronze: '#C0793A', silver: '#C3CAD4', gold: '#F2C230', special: VOLT }
const NUMERAL = { reliable: '2', proofed: '3', bronze: '1', silver: '2', gold: '3' }
const GLYPH = {
  block: 'M4 18h16M7 13h10M10 8h4',
  leash: 'M10 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0M9 9.5c3.5 2 2 7 9.5 8',
  return: 'M18 6v5a5 5 0 0 1-5 5H6M10 12l-4 4 4 4',
  cup: 'M6 8h10v5a5 5 0 0 1-10 0zM16 9h2a2 2 0 0 1 0 4h-2M7 20h8',
  peak: 'M3 19l6-10 4 6 2-3 6 7z',
  star: 'M12 4l2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  house: 'M4 11l8-7 8 7v8H4zM10 19v-5h4v5',
}
const WORD = { seven: '7', thirty: '30' }
const SHIELD = 'M24 3l17 6v16c0 11-7 19-17 24C14 44 7 36 7 25V9z'
// A 14-petal rosette around (24, 22).
const ROSETTE = (() => { let d = ''; for (let i = 0; i < 28; i++) { const a = (Math.PI * i) / 14, r = i % 2 ? 16.5 : 20.5; d += `${i ? 'L' : 'M'}${(24 + r * Math.sin(a)).toFixed(1)} ${(22 - r * Math.cos(a)).toFixed(1)}` } return d + 'z' })()
const num = (v) => (Number.isFinite(Number(v)) ? Math.max(12, Math.min(200, Math.round(Number(v)))) : 48)

export function badgeSvg(b, size = 48) {
  const on = !!(b && b.earned !== false && b.tier), ring = on ? RING[b.tier] || VOLT : GREY, s = num(size)
  const group = b && ['skill', 'track', 'cross'].includes(b.group) ? b.group : 'cross'
  const outline = on ? `fill="${INK}" stroke="${ring}" stroke-width="3"` : `fill="none" stroke="${GREY}" stroke-width="2" stroke-dasharray="4 3"`
  const ink = on ? (group === 'cross' ? VOLT : '#fff') : GREY
  const shape = group === 'skill' ? `<path d="${SHIELD}" ${outline} stroke-linejoin="round"/>`
    : group === 'track' ? `<path d="M15 34l-4 16 8-4 5 5 5-5 8 4-4-16z" fill="${on ? BLUE : 'none'}" stroke="${on ? BLUE : GREY}" stroke-width="${on ? 0 : 2}" stroke-dasharray="${on ? '' : '4 3'}"/><path d="${ROSETTE}" fill="${on ? ring : 'none'}" stroke="${on ? INK : GREY}" stroke-width="${on ? 1.5 : 2}" stroke-linejoin="round" stroke-dasharray="${on ? '' : '4 3'}"/>${on ? `<circle cx="24" cy="22" r="13.5" fill="${INK}"/>` : ''}`
      : `<circle cx="24" cy="24" r="20" ${outline}/>${on ? `<circle cx="24" cy="24" r="15.5" fill="none" stroke="${BLUE}" stroke-width="1.5"/>` : ''}`
  const word = b && WORD[b.glyph]
  // Where the glyph sits: the middle of the shield, of the rosette's disc, or of the medallion.
  const [gx, gy, gs] = group === 'skill' ? [24, 21, 0.85] : group === 'track' ? [24, 21, 0.72] : [24, 24, 1]
  const glyph = word ? `<text x="${gx}" y="${gy + 6.5}" text-anchor="middle" font-family="Archivo,Arial,sans-serif" font-style="italic" font-weight="800" font-size="${word.length > 1 ? 16 : 19}" fill="${ink}">${word}</text>`
    : `<path transform="translate(${(gx - 12 * gs).toFixed(2)} ${(gy - 12 * gs).toFixed(2)}) scale(${gs})" d="${GLYPH[b && b.glyph] || GLYPH.check}" fill="none" stroke="${ink}" stroke-width="${(2.2 / gs).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`
  // The tier numeral: at the foot of a shield, and on a small disc at the foot of a rosette.
  const numeral = on && NUMERAL[b.tier]
  const n = !numeral || group === 'cross' ? '' : group === 'skill' ? `<text x="24" y="43" text-anchor="middle" font-family="Archivo,Arial,sans-serif" font-style="italic" font-weight="800" font-size="10" fill="${b.tier === 'reliable' ? '#9DB6F4' : ring}">${numeral}</text>`
    : `<circle cx="24" cy="40.5" r="6.5" fill="${ring}" stroke="${INK}" stroke-width="1.5"/><text x="23.6" y="44" text-anchor="middle" font-family="Archivo,Arial,sans-serif" font-style="italic" font-weight="800" font-size="9.5" fill="${INK}">${numeral}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="${s}" height="${Math.round((s * 52) / 48)}" viewBox="0 0 48 52">${shape}${glyph}${n}</svg>`
}
