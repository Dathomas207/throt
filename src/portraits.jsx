import React from 'react'

// Original flat illustrations for the Biscuit demo. Drawn here as inline SVG, so
// the demo ships no photographs and loads nothing from the network.
const INK = '#0F1B2D'
const Eye = ({ x, y, iris }) => iris
  ? <g><circle cx={x} cy={y} r="3.4" fill={iris} /><circle cx={x} cy={y} r="1.7" fill={INK} /></g>
  : <g><circle cx={x} cy={y} r="2.7" fill={INK} /><circle cx={x + 0.9} cy={y - 0.9} r="0.8" fill="#fff" /></g>
const Nose = ({ y = 54, w = 5 }) => <path d={`M${48 - w} ${y}h${w * 2}l-${w} ${w + 1}z`} fill={INK} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
const Smile = ({ y = 61, w = 7 }) => <path d={`M48 ${y}v3M48 ${y + 3}c-1.500 3.500-${w - 1} 3.500-${w} 0M48 ${y + 3}c1.500 3.500 ${w - 1} 3.500 ${w} 0`} fill="none" stroke={INK} strokeWidth="1.800" strokeLinecap="round" />

// Each head is drawn on a 96 by 96 grid, centred, so it can sit in a round avatar
// or be placed into a wider scene.
export function GoldenHead({ stick }) {
  return (
    <g>
      <ellipse cx="48" cy="100" rx="30" ry="20" fill="#E3A94B" />
      <ellipse cx="48" cy="96" rx="13" ry="16" fill="#F3D49A" />
      <path d="M27 30C12 33 11 58 19 68C27 64 30 48 33 36Z" fill="#C4862F" />
      <path d="M69 30C84 33 85 58 77 68C69 64 66 48 63 36Z" fill="#C4862F" />
      <ellipse cx="48" cy="46" rx="23" ry="25" fill="#E3A94B" />
      <ellipse cx="48" cy="60" rx="13" ry="11.500" fill="#F3D49A" />
      <Eye x={39} y={44} /><Eye x={57} y={44} />
      <Nose />
      {stick
        ? <g><rect x="20" y="62" width="56" height="6.500" rx="3.250" fill="#8A5A2B" /><path d="M66 62l5-6" stroke="#8A5A2B" strokeWidth="3.500" strokeLinecap="round" /><path d="M39 61.500c3 2 15 2 18 0" fill="none" stroke={INK} strokeWidth="1.800" strokeLinecap="round" /></g>
        : <g><Smile /><path d="M44.500 65h7v3.500a3.500 3.500 0 0 1-7 0z" fill="#FF8A5B" /></g>}
    </g>
  )
}
function BerneseHead() {
  return (
    <g>
      <ellipse cx="48" cy="100" rx="32" ry="20" fill="#22242E" />
      <path d="M38 84h20l4 14H34z" fill="#fff" />
      <path d="M25 30C11 34 12 58 20 66C27 61 29 47 32 36Z" fill="#22242E" />
      <path d="M71 30C85 34 84 58 76 66C69 61 67 47 64 36Z" fill="#22242E" />
      <ellipse cx="48" cy="46" rx="25" ry="25" fill="#22242E" />
      <circle cx="33" cy="58" r="7.500" fill="#B4622C" /><circle cx="63" cy="58" r="7.500" fill="#B4622C" />
      <path d="M48 22C46 32 45 42 36 54C34 66 40 71 48 71C56 71 62 66 60 54C51 42 50 32 48 22Z" fill="#fff" />
      <circle cx="38" cy="36" r="2.800" fill="#B4622C" /><circle cx="58" cy="36" r="2.800" fill="#B4622C" />
      <Eye x={38} y={44} iris="#D9A441" /><Eye x={58} y={44} iris="#D9A441" />
      <Nose y={55} w={5.500} /><Smile y={63} />
    </g>
  )
}
function CollieHead() {
  return (
    <g>
      <ellipse cx="48" cy="100" rx="28" ry="20" fill="#22242E" />
      <path d="M36 82h24l5 16H31z" fill="#fff" />
      <path d="M28 40L24 13L45 26Z" fill="#22242E" /><path d="M24 13l10 6-8 6z" fill="#4A4E5E" />
      <path d="M68 40L72 13L51 26Z" fill="#22242E" /><path d="M72 13l-10 6 8 6z" fill="#4A4E5E" />
      <path d="M48 22C60 22 70 32 70 46C70 58 60 72 48 72C36 72 26 58 26 46C26 32 36 22 48 22Z" fill="#22242E" />
      <path d="M48 23C47 34 46.500 44 39 55C38 66 42 72 48 72C54 72 58 66 57 55C49.500 44 49 34 48 23Z" fill="#fff" />
      <Eye x={38.500} y={45} iris="#8A5A2B" /><Eye x={57.500} y={45} iris="#9CC3F5" />
      <Nose y={57} w={4.500} /><Smile y={64} w={6} />
    </g>
  )
}
function DachshundHead() {
  return (
    <g>
      <ellipse cx="48" cy="102" rx="24" ry="20" fill="#A6562A" />
      <path d="M32 30C15 31 12 60 20 74C29 70 33 52 36 38Z" fill="#7A3C1B" />
      <path d="M64 30C81 31 84 60 76 74C67 70 63 52 60 38Z" fill="#7A3C1B" />
      <ellipse cx="48" cy="42" rx="19" ry="20" fill="#A6562A" />
      <path d="M38 50C38 44 58 44 58 50L57 68C57 76 39 76 39 68Z" fill="#C4763F" />
      <circle cx="40" cy="35" r="2.300" fill="#C4763F" /><circle cx="56" cy="35" r="2.300" fill="#C4763F" />
      <Eye x={40} y={42} /><Eye x={56} y={42} />
      <Nose y={63} w={4.500} /><Smile y={69.500} w={5} />
    </g>
  )
}

const PORTRAITS = {
  Biscuit: { Head: GoldenHead, bg: '#C8F031', photo: 'biscuit.jpg', label: 'Biscuit, a golden retriever, smiling on the grass' },
  Moose: { Head: BerneseHead, bg: '#C6D4F7', label: 'Illustration of Moose, a Bernese mountain dog' },
  Juno: { Head: CollieHead, bg: '#FFD9CB', label: 'Illustration of Juno, a border collie' },
  Pickle: { Head: DachshundHead, bg: '#1F5AE8', label: 'Illustration of Pickle, a dachshund' },
}
export const hasPortrait = (name) => Object.prototype.hasOwnProperty.call(PORTRAITS, name)
export function Portrait({ name }) {
  const p = hasPortrait(name) ? PORTRAITS[name] : null
  if (!p) return null
  if (p.photo) return <img src={import.meta.env.BASE_URL + p.photo} alt={p.label} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
  return <svg viewBox="0 0 96 96" role="img" aria-label={p.label}><rect width="96" height="96" fill={p.bg} /><p.Head /></svg>
}

// Illustrated stand-ins for the photo slot on two demo outings.
const SCENES = {
  s1: 'Biscuit lying on the grass after the walk',
  s4: 'Illustration: Biscuit asleep on a mat at daycare',
}
export const hasDemoPhoto = (id) => Object.prototype.hasOwnProperty.call(SCENES, id)
export function DemoPhoto({ id }) {
  if (!hasDemoPhoto(id)) return null
  if (id === 's1') return <img className="demophoto" src={import.meta.env.BASE_URL + 'biscuit-wide.jpg'} alt={SCENES.s1} style={{ display: 'block', width: '100%', aspectRatio: '358 / 170', objectFit: 'cover', objectPosition: '50% 35%' }} />
  if (id === 's1-illustration') return (
    <svg className="demophoto" viewBox="0 0 358 170" role="img" aria-label={SCENES.s1}>
      <rect width="358" height="170" fill="#C6D4F7" />
      <circle cx="300" cy="38" r="20" fill="#FFE9A8" />
      <path d="M0 70C40 52 70 56 110 66C150 50 200 50 240 64C280 54 320 56 358 68V110H0Z" fill="#7FA36B" />
      <rect y="96" width="358" height="46" fill="#1F5AE8" />
      <path d="M24 110h34M250 118h42M96 128h26M300 104h30" stroke="#9CC3F5" strokeWidth="3" strokeLinecap="round" />
      <path d="M0 136C60 126 120 130 180 134C240 128 300 128 358 134V170H0Z" fill="#C8F031" />
      <g transform="translate(96 20) scale(1.720)"><GoldenHead stick /></g>
    </svg>
  )
  return (
    <svg className="demophoto" viewBox="0 0 358 170" role="img" aria-label={SCENES.s4}>
      <rect width="358" height="170" fill="#FFD9CB" />
      <rect y="112" width="358" height="58" fill="#0F1B2D" />
      <rect x="28" y="22" width="70" height="52" rx="8" fill="#fff" /><path d="M40 60l14-18 12 12 8-8 14 14z" fill="#C6D4F7" />
      <ellipse cx="186" cy="134" rx="124" ry="24" fill="#1F5AE8" />
      <path d="M98 122C92 96 126 78 176 78C232 78 276 92 278 118C280 138 240 142 180 142C130 142 102 140 98 122Z" fill="#E3A94B" />
      <path d="M262 104C286 96 300 106 296 122C290 116 276 114 266 120Z" fill="#C4862F" />
      <ellipse cx="124" cy="116" rx="36" ry="27" fill="#E3A94B" />
      <path d="M134 92C156 90 166 112 156 132C146 128 138 112 134 92Z" fill="#C4862F" />
      <ellipse cx="102" cy="126" rx="19" ry="13" fill="#F3D49A" />
      <path d="M84 121h9l-4.500 5.500z" fill="#0F1B2D" stroke="#0F1B2D" strokeWidth="2.400" strokeLinejoin="round" />
      <path d="M112 110c3 3.500 8 3.500 11 0" fill="none" stroke="#0F1B2D" strokeWidth="2.400" strokeLinecap="round" />
      <path d="M150 134c14 6 30 6 44 2" fill="none" stroke="#C4862F" strokeWidth="6" strokeLinecap="round" />
      <g fill="none" stroke="#0F1B2D" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M150 58h12l-12 14h12" /><path d="M172 38h9l-9 10h9" /><path d="M188 24h6l-6 7h6" /></g>
    </svg>
  )
}
