// The drawn cast for the lesson demonstrations: a friendly dog in side view, a person's legs and one arm,
// and a few props. Original shapes in the Trot palette, drawn as inline SVG from numbers, so a scene is
// a flat set of values that can be blended from one beat to the next. No images, no libraries.
//
// Coordinates: the stage is 320 by 190, the ground is at y = 168, the dog faces right unless `f` is -1.
import React from 'react'

import { W, H, GROUND, noseOf, toScene, P3, P4, WALKS } from './poses.js'
const INK = '#0F1B2D', VOLT = '#C8F031', BLUE = '#1F5AE8'
const FUR = { fur: '#E2A964', far: '#C68844', ear: '#93602F', belly: '#F0C894' }
const FUR2 = { fur: '#B9C2CE', far: '#97A2B1', ear: '#6B7685', belly: '#D5DBE4' }
const SKIN = '#D9A27C', TREAT = '#8A5A2B'
const L1 = 19, L2 = 20

export { flatten, blend, POSES } from './poses.js'
// ---- drawing -------------------------------------------------------------------------------------------
const tr = (x, y, r = 0) => `translate(${x.toFixed(1)} ${y.toFixed(1)})${r ? ` rotate(${r.toFixed(1)})` : ''}`

function Leg({ j, swing = 0, hind, far, tone }) {
  const fill = far ? tone.far : tone.fur
  return <g transform={tr(j[0], j[1], j[2] + swing)}>
    {hind ? <ellipse cx="0" cy={L1 / 2 - 1} rx="8.5" ry={L1 / 2 + 5} fill={fill} stroke={INK} strokeWidth="2" /> : <rect x="-5" y="-6" width="10" height={L1 + 8} rx="5" fill={fill} stroke={INK} strokeWidth="2" />}
    <g transform={tr(0, L1, j[3] - swing * 0.6)}>
      <rect x="-4.5" y="-4" width="9" height={L2 + 4} rx="4.5" fill={fill} stroke={INK} strokeWidth="2" />
      <ellipse cx="3" cy={L2} rx="6.5" ry="4" fill={fill} stroke={INK} strokeWidth="2" />
    </g>
  </g>
}

const Toy = () => <g><rect x="-9" y="-3" width="18" height="6" rx="3" fill={BLUE} stroke={INK} strokeWidth="1.8" /><circle cx="-9" cy="-3" r="3.6" fill={BLUE} stroke={INK} strokeWidth="1.8" /><circle cx="-9" cy="3" r="3.6" fill={BLUE} stroke={INK} strokeWidth="1.8" /><circle cx="9" cy="-3" r="3.6" fill={BLUE} stroke={INK} strokeWidth="1.8" /><circle cx="9" cy="3" r="3.6" fill={BLUE} stroke={INK} strokeWidth="1.8" /></g>

// The dog. `pre` picks which dog in the flat state, `phase` drives walking legs.
export function Dog({ v, k, pre, tone = FUR, phase = 0, amp = 0 }) {
  if (!(v[pre + 'o'] > 0.01)) return null
  const p = k[pre + 'p'], walk = (WALKS[p] || 0) * amp
  const s = Math.sin(phase) * 20 * walk
  const b = P3(v, pre, 'b'), n = P3(v, pre, 'n'), h = P3(v, pre, 'h'), t = P3(v, pre, 't'), hf = v[pre + 'hf']
  const root = `translate(${v[pre + 'x'].toFixed(1)} ${(GROUND + v[pre + 'y'] - 22).toFixed(1)}) rotate(${v[pre + 'r'].toFixed(1)}) translate(0 22) scale(${(v[pre + 'f'] * v[pre + 'sc']).toFixed(3)} ${v[pre + 'sc'].toFixed(3)})`
  return <g transform={root} opacity={Math.min(1, v[pre + 'o'])}>
    <g transform={tr(t[0], t[1], t[2])}><g className="an-wag"><path d="M0 0C-8-5-14-14-13-27" fill="none" stroke={INK} strokeWidth="9.5" strokeLinecap="round" /><path d="M0 0C-8-5-14-14-13-27" fill="none" stroke={tone.fur} strokeWidth="5.5" strokeLinecap="round" /></g></g>
    <Leg j={P4(v, pre, 'hf')} swing={s} hind far tone={tone} />
    <Leg j={P4(v, pre, 'ff')} swing={-s} far tone={tone} />
    <g transform={tr(b[0], b[1], b[2])}>
      <ellipse cx="0" cy="0" rx="37" ry="16" fill={tone.fur} stroke={INK} strokeWidth="2" />
      <ellipse cx="24" cy="1" rx="15.5" ry="16" fill={tone.fur} stroke={INK} strokeWidth="2" />
      <path d="M-30 6C-14 15 12 16 30 9" fill="none" stroke={tone.belly} strokeWidth="5" strokeLinecap="round" />
      <ellipse cx="24" cy="1" rx="13.5" ry="14" fill={tone.fur} />
      <ellipse cx="0" cy="-1" rx="35" ry="14" fill={tone.fur} />
      {k[pre + 'harness'] && <><path d="M18-15C14-4 14 6 18 15" fill="none" stroke={BLUE} strokeWidth="4.5" strokeLinecap="round" /><path d="M2-15C0-4 0 6 2 15" fill="none" stroke={BLUE} strokeWidth="4.5" strokeLinecap="round" /><circle cx="6" cy="-15" r="3" fill={VOLT} stroke={INK} strokeWidth="1.5" /></>}
    </g>
    <g transform={tr(n[0], n[1], n[2])}><rect x="-9" y="-26" width="18" height="34" rx="9" fill={tone.fur} stroke={INK} strokeWidth="2" /><rect x="-7" y="-4" width="14" height="14" fill={tone.fur} /><rect x="-9.5" y="-21" width="19" height="5.5" rx="2" fill={VOLT} stroke={INK} strokeWidth="1.6" /></g>
    <Leg j={P4(v, pre, 'hn')} swing={-s} hind tone={tone} />
    <Leg j={P4(v, pre, 'fn')} swing={s} tone={tone} />
    <g transform={`${tr(h[0], h[1], h[2] * hf)} scale(${hf.toFixed(3)} 1)`}>
      <path d="M-2-12C-9-15-13-12-14-6" fill="none" stroke={INK} strokeWidth="2" />
      <circle cx="0" cy="0" r="13.5" fill={tone.fur} stroke={INK} strokeWidth="2" />
      <rect x="4" y="-3" width="22" height="13" rx="6.5" fill={tone.fur} stroke={INK} strokeWidth="2" />
      <rect x="3" y="-1" width="8" height="9" fill={tone.fur} />
      <ellipse cx="25.5" cy="-0.5" rx="3.8" ry="3.2" fill={INK} />
      <path d="M15 8.5q5 2.5 9-1" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="5" cy="-4.5" r="2.4" fill={INK} /><circle cx="5.8" cy="-5.3" r="0.8" fill="#fff" />
      <path d="M-5-10C-13-7-15 4-11 11C-8 15-3 11-2 4C-1-2-1-7-5-10Z" fill={tone.ear} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      {k[pre + 'carry'] === 'toy' && <g transform="translate(22 9) rotate(-8)"><Toy /></g>}
      {k[pre + 'carry'] === 'ball' && <circle cx="24" cy="9" r="6" fill={VOLT} stroke={INK} strokeWidth="1.8" />}
    </g>
  </g>
}

// The person: two legs from the top of the stage to the shoes, or seated on a chair.
function Person({ v, k, phase, amp }) {
  if (!(v.po > 0.01)) return null
  const s = Math.sin(phase) * 14 * amp
  const leg = (dx, sw, fill) => <g transform={tr(dx, -30, sw)}>
    <rect x="-12" y="0" width="24" height="190" rx="9" fill={fill} stroke={INK} strokeWidth="2" />
    <path d="M-13 184h26c8 0 14 4 14 10v2h-40z" fill={INK} /><rect x="-13" y="194" width="40" height="3.5" rx="1.75" fill={VOLT} />
  </g>
  if (k.seat) {
    return <g transform={`translate(${v.px.toFixed(1)} ${v.py.toFixed(1)}) scale(${v.pf} 1)`} opacity={v.po}>
      <rect x="-6" y="96" width="44" height="7" rx="3" fill="#9AA3B0" stroke={INK} strokeWidth="2" /><rect x="30" y="20" width="7" height="82" rx="3" fill="#9AA3B0" stroke={INK} strokeWidth="2" /><rect x="-2" y="100" width="6" height="68" fill="#9AA3B0" stroke={INK} strokeWidth="2" /><rect x="30" y="100" width="6" height="68" fill="#9AA3B0" stroke={INK} strokeWidth="2" />
      <rect x="-4" y="-10" width="36" height="104" rx="14" fill={BLUE} stroke={INK} strokeWidth="2" />
      <rect x="-44" y="76" width="62" height="24" rx="11" fill="#2A3A52" stroke={INK} strokeWidth="2" />
      <rect x="-46" y="80" width="24" height="84" rx="10" fill="#2A3A52" stroke={INK} strokeWidth="2" />
      <path d="M-47 158h26c8 0 14 4 14 9v1h-40z" fill={INK} />
    </g>
  }
  return <g transform={`translate(${v.px.toFixed(1)} ${(v.py - 26).toFixed(1)}) scale(${v.pf} 1)`} opacity={v.po}>
    {leg(10, -s, '#1E2B40')}{leg(-6, s, '#2A3A52')}
  </g>
}
// A helper's legs, in grey, coming from the left.
function Helper({ v, phase, amp }) {
  if (!(v.qo > 0.01)) return null
  const s = Math.sin(phase) * 14 * amp
  const leg = (dx, sw, fill) => <g transform={tr(dx, -30, sw)}><rect x="-11" y="0" width="22" height="190" rx="9" fill={fill} stroke={INK} strokeWidth="2" /><path d="M11 184h-24c-8 0-13 4-13 10v2h37z" fill="#5B6472" /></g>
  return <g transform={`translate(${v.qx.toFixed(1)} -26)`} opacity={v.qo}>{leg(-8, s, '#7B8594')}{leg(8, -s, '#8E99A8')}</g>
}

// An arm from above the stage to a hand. `kind`: fist, treat, palm, point, toy, bag, towel.
function Arm({ sx, sy, x, y, kind, o, sleeve = BLUE }) {
  if (!(o > 0.01) || !kind) return null
  const dx = x - sx, dy = y - sy, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len
  const ex = x - ux * 7, ey = y - uy * 7
  const ang = (Math.atan2(uy, ux) * 180) / Math.PI - 90
  return <g opacity={o}>
    <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={INK} strokeWidth="17" strokeLinecap="round" />
    <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={sleeve} strokeWidth="13" strokeLinecap="round" />
    <g transform={tr(x, y, ang)}>
      {kind === 'palm' || kind === 'towel' ? <ellipse cx="0" cy="2" rx="8.5" ry="11" fill={SKIN} stroke={INK} strokeWidth="2" />
        : <circle cx="0" cy="0" r="8.5" fill={SKIN} stroke={INK} strokeWidth="2" />}
      {kind === 'point' && <rect x="-2.6" y="4" width="5.2" height="12" rx="2.6" fill={SKIN} stroke={INK} strokeWidth="1.8" />}
      {kind === 'palm' && <path d="M-8 2q-4 2-3 6" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />}
      {kind === 'treat' && <rect x="-3.6" y="6" width="7.2" height="6" rx="2" fill={TREAT} stroke={INK} strokeWidth="1.5" />}
      {kind === 'toy' && <g transform="translate(0 11) rotate(90)"><Toy /></g>}
      {kind === 'bag' && <path d="M-6 8h12l-2 14h-8z" fill="#2E7D32" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />}
      {kind === 'towel' && <rect x="-10" y="6" width="20" height="10" rx="3" fill="#F2F4F7" stroke={INK} strokeWidth="1.6" />}
    </g>
  </g>
}

function Bubble({ x, y, text, yes }) {
  const w = Math.max(44, text.length * 8.4 + 22)
  return <g className="an-pop" transform={tr(x, y)}>
    <rect x={-w / 2} y="-15" width={w} height="30" rx="15" fill={yes ? VOLT : '#fff'} stroke={INK} strokeWidth="2" />
    <path d={yes ? 'M8 14l10 9-2-10' : 'M8 14l12 8-4-9'} fill={yes ? VOLT : '#fff'} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
    <rect x="4" y="11" width="16" height="4" fill={yes ? VOLT : '#fff'} />
    <text x="0" y="5.5" textAnchor="middle" className="an-say">{text}</text>
  </g>
}

const Treat = ({ x, y }) => <rect x={x - 3.6} y={y - 3} width="7.2" height="6" rx="2" fill={TREAT} stroke={INK} strokeWidth="1.5" />

// The backdrop: a room, a street, a yard or park, a trail, or a patio.
function Backdrop({ bg, gx }) {
  const off = ((gx % 64) + 64) % 64
  if (bg === 'in') return <g><rect width={W} height={H} fill="#EEF1F6" /><rect y="150" width={W} height="6" fill="#DCE1E8" /><rect y={GROUND} width={W} height={H - GROUND} fill="#E3D6C3" /><line x1="0" y1={GROUND} x2={W} y2={GROUND} stroke="#C9B79F" strokeWidth="2" /></g>
  const sky = <rect width={W} height={H} fill="#EAF1FD" />
  if (bg === 'street') return <g>{sky}<rect x="0" y="118" width={W} height="40" fill="#DCE3EC" /><rect y={GROUND - 10} width={W} height={H - GROUND + 10} fill="#D5DBE4" />{[0, 1, 2, 3, 4, 5, 6].map((i) => <line key={i} x1={i * 64 - off} y1={GROUND - 10} x2={i * 64 - off - 8} y2={H} stroke="#B9C2CE" strokeWidth="2" />)}<line x1="0" y1={GROUND - 10} x2={W} y2={GROUND - 10} stroke="#B9C2CE" strokeWidth="2" /></g>
  if (bg === 'trail') return <g>{sky}<path d={`M${-off} 140q40-30 80 0t80 0 80 0 80 0 80 0`} fill="#CFE3B0" /><rect y="140" width={W} height={H - 140} fill="#CFE3B0" /><rect y={GROUND - 8} width={W} height={H - GROUND + 8} fill="#E5D7BC" />{[0, 1, 2, 3, 4, 5, 6].map((i) => <circle key={i} cx={i * 64 - off + 20} cy={H - 8} r="2" fill="#C2AE8C" />)}</g>
  if (bg === 'patio') return <g>{sky}<rect x="0" y="40" width={W} height="10" fill="#C8F031" opacity=".5" /><rect y="150" width={W} height={H - 150} fill="#E6E0D6" />{[0, 1, 2, 3, 4, 5].map((i) => <line key={i} x1={i * 64} y1="150" x2={i * 64 - 20} y2={H} stroke="#D3CABB" strokeWidth="2" />)}</g>
  // yard and park: grass
  return <g>{sky}<rect y="138" width={W} height={H - 138} fill="#D6EBAE" />{[0, 1, 2, 3, 4, 5, 6].map((i) => <path key={i} d={`M${i * 64 - off + 10} ${GROUND + 8}l3-6 3 6`} fill="none" stroke="#A9CB6E" strokeWidth="2" />)}</g>
}

// Props behind the cast, and the few that sit in front of it.
function PropsBack({ v }) {
  const o = (n) => v['o_' + n], x = (n) => v['x_' + n]
  return <g>
    {o('fence') > 0.01 && <g opacity={o('fence')}>{[...Array(11)].map((_, i) => <rect key={i} x={i * 32 + 6} y="104" width="14" height="50" rx="3" fill="#fff" stroke="#C5CBD4" strokeWidth="2" />)}<rect x="0" y="116" width={W} height="6" fill="#fff" stroke="#C5CBD4" strokeWidth="2" /></g>}
        {o('door') > 0.01 && <g opacity={o('door')} transform={tr(x('door'), 0)}>
      <rect x="0" y="28" width="62" height={GROUND - 28} fill="#7A8699" stroke={INK} strokeWidth="2" />
      <rect x="4" y="32" width="54" height={GROUND - 32} fill="#F7F1DA" />
      <g transform={`translate(58 0) scale(${(1 - 0.88 * v.v_door).toFixed(3)} 1)`}><rect x="-54" y="32" width="54" height={GROUND - 32} fill="#B7835A" stroke={INK} strokeWidth="2" /><circle cx="-46" cy="102" r="3.5" fill={VOLT} stroke={INK} strokeWidth="1.5" /></g>
    </g>}
    {o('elevator') > 0.01 && <g opacity={o('elevator')} transform={tr(x('elevator'), 0)}>
      <rect x="0" y="30" width="84" height={GROUND - 30} fill="#E9EEF5" stroke={INK} strokeWidth="2" /><rect x="8" y="40" width="68" height="4" fill="#C5CBD4" />
      <rect x="0" y="30" width={(42 * (1 - v.v_elevator)).toFixed(1)} height={GROUND - 30} fill="#C5CBD4" stroke={INK} strokeWidth="1.5" />
      <rect x={(42 + 42 * v.v_elevator).toFixed(1)} y="30" width={(42 * (1 - v.v_elevator)).toFixed(1)} height={GROUND - 30} fill="#C5CBD4" stroke={INK} strokeWidth="1.5" />
      <rect x="-22" y="90" width="12" height="20" rx="3" fill="#AEB7C4" stroke={INK} strokeWidth="1.5" /><circle cx="-16" cy="100" r="3" fill={VOLT} stroke={INK} strokeWidth="1.2" />
    </g>}
    {o('car') > 0.01 && <g opacity={o('car')} transform={tr(x('car'), 0)}>
      <rect x="0" y="2" width="220" height="150" rx="16" fill="#9DB6F4" stroke={INK} strokeWidth="2" />
      <rect x="7" y="10" width="98" height="112" rx="9" fill="#3B4A63" stroke={INK} strokeWidth="2" />
      <rect x="88" y="44" width="12" height="74" rx="4" fill="#2A3A52" />
      <rect x="118" y="14" width="96" height="58" rx="8" fill="#E9EEF5" stroke={INK} strokeWidth="2" />
    </g>}
    {o('stairs') > 0.01 && <g opacity={o('stairs')}>{[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => <rect key={i} x={x('stairs') + i * 26} y={GROUND - 12 * (i + 1)} width={W} height={12 * (i + 1)} fill={i % 2 ? '#D3C3AC' : '#DCCDB7'} stroke="#B9A88F" strokeWidth="1.5" />)}<path d={`M${x('stairs')} ${GROUND - 40}l${26 * 9} -${12 * 9}`} stroke="#7A8699" strokeWidth="4" strokeLinecap="round" /></g>}
    {o('post') > 0.01 && <g opacity={o('post')} transform={tr(x('post'), 0)}><rect x="-5" y="70" width="10" height={GROUND - 70} fill="#9C7A54" stroke={INK} strokeWidth="2" /><path d="M-26 74h40l10 9-10 9h-40z" fill={VOLT} stroke={INK} strokeWidth="2" strokeLinejoin="round" /><path d="M20 98h-40l-10 9 10 9h40z" fill="#fff" stroke={INK} strokeWidth="2" strokeLinejoin="round" /></g>}
    {o('table') > 0.01 && <g opacity={o('table')} transform={tr(x('table'), 0)}><rect x="-50" y="88" width="80" height="8" rx="3" fill="#fff" stroke={INK} strokeWidth="2" /><rect x="-14" y="94" width="8" height={GROUND - 94} fill="#9AA3B0" stroke={INK} strokeWidth="2" /><path d="M-30 88v-12h12v12" fill="#fff" stroke={INK} strokeWidth="2" /></g>}
    {o('bike') > 0.01 && <g opacity={o('bike')} transform={`translate(${x('bike').toFixed(1)} 28) scale(0.72)`}><circle cx="-24" cy="146" r="20" fill="none" stroke={INK} strokeWidth="3" /><circle cx="24" cy="146" r="20" fill="none" stroke={INK} strokeWidth="3" /><path d="M-24 146l16-30h26l6 30M-8 116l20 30M14 116l-4-10h-8M-12 110h10" fill="none" stroke={BLUE} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /></g>}
    {o('mat') > 0.01 && <g opacity={o('mat')}><rect x={x('mat') - 52} y={GROUND - 5} width="104" height="9" rx="4" fill="#9DB6F4" stroke={INK} strokeWidth="2" /><line x1={x('mat') - 40} y1={GROUND - 1} x2={x('mat') + 40} y2={GROUND - 1} stroke="#fff" strokeWidth="1.5" strokeDasharray="5 4" /></g>}
    {o('box') > 0.01 && <g opacity={o('box')} transform={tr(x('box'), 0)}><path d="M-22 136h44l-5 32h-34z" fill="#E7C27D" stroke={INK} strokeWidth="2" strokeLinejoin="round" /><path d="M-18 146h36M-16 156h32" stroke="#C49A52" strokeWidth="2" /></g>}
  </g>
}
function PropsFront({ v }) {
  const o = (n) => v['o_' + n], x = (n) => v['x_' + n], y = (n) => v['y_' + n]
  return <g>
    {o('car') > 0.01 && <g opacity={o('car')} transform={tr(x('car'), 0)}><path d="M0 116h220v24c0 7-5 12-12 12H12c-7 0-12-5-12-12z" fill="#9DB6F4" stroke={INK} strokeWidth="2" /><rect x="3" y="122" width="8" height="16" rx="2" fill="#E0532F" stroke={INK} strokeWidth="1.5" /><circle cx="70" cy="150" r="18" fill={INK} /><circle cx="70" cy="150" r="7" fill="#C5CBD4" /></g>}
    {o('elevator') > 0.01 && <g opacity={o('elevator')} transform={tr(x('elevator'), 0)}><rect x="-8" y="22" width="100" height="10" fill="#AEB7C4" stroke={INK} strokeWidth="2" /><rect x="-8" y="22" width="10" height={GROUND - 22} fill="#AEB7C4" stroke={INK} strokeWidth="2" /><rect x="82" y="22" width="10" height={GROUND - 22} fill="#AEB7C4" stroke={INK} strokeWidth="2" /></g>}
    {o('tree') > 0.01 && <g opacity={o('tree')} transform={tr(x('tree'), 0)}><rect x="-17" y="40" width="34" height={GROUND - 40} rx="6" fill="#8A6A47" stroke={INK} strokeWidth="2" /><circle cx="0" cy="34" r="40" fill="#7DB04B" stroke={INK} strokeWidth="2" /><circle cx="-18" cy="52" r="18" fill="#8CC057" stroke={INK} strokeWidth="2" /></g>}
    {o('water') > 0.01 && <g opacity={o('water') * 0.88} transform={tr(x('water'), 0)}><path d={`M0 ${GROUND - 14}q10-6 20 0t20 0 20 0 20 0 20 0 20 0V${H}H0z`} fill="#6F9BF0" /><path d={`M10 ${GROUND - 2}q8-4 16 0M46 ${GROUND + 6}q8-4 16 0`} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></g>}
    {o('ball') > 0.01 && <circle opacity={o('ball')} cx={x('ball')} cy={GROUND - 6 + y('ball')} r="6" fill={VOLT} stroke={INK} strokeWidth="1.8" />}
    {o('toy') > 0.01 && <g opacity={o('toy')} transform={tr(x('toy'), GROUND - 7 + y('toy'))}><Toy /></g>}
    {o('squirrel') > 0.01 && <g opacity={o('squirrel')} transform={tr(x('squirrel'), GROUND)}><path d="M8-10c10-4 14-18 6-26-6-6-16-2-14 6 2 6 8 4 8 10" fill="#9AA3B0" stroke={INK} strokeWidth="2" /><ellipse cx="-4" cy="-8" rx="10" ry="8" fill="#AEB7C4" stroke={INK} strokeWidth="2" /><circle cx="-14" cy="-16" r="6" fill="#AEB7C4" stroke={INK} strokeWidth="2" /><circle cx="-16" cy="-17" r="1.3" fill={INK} /></g>}
    {o('bowl') > 0.01 && <g opacity={o('bowl')} transform={tr(x('bowl'), GROUND)}><path d="M-14-10h28l-4 10h-20z" fill={BLUE} stroke={INK} strokeWidth="2" strokeLinejoin="round" /><ellipse cx="0" cy="-10" rx="12" ry="2.5" fill="#9DB6F4" /></g>}
    {o('chew') > 0.01 && <g opacity={o('chew')} transform={tr(x('chew'), GROUND - 5)}><rect x="-10" y="-3" width="20" height="6" rx="3" fill="#E7C27D" stroke={INK} strokeWidth="1.6" /></g>}
    {o('floorTreat') > 0.01 && <g opacity={o('floorTreat')}><Treat x={x('floorTreat')} y={GROUND - 3 + y('floorTreat')} /></g>}
  </g>
}

// The leash from the collar (or the harness) to the hand. Loose sags into a J, tight is straight,
// a long line drapes along the ground.
function Leash({ v, k }) {
  if (!k.leash || !(v.ho > 0.01)) return null
  const pre = 'd_', h = P3(v, pre, 'h'), b = P3(v, pre, 'b')
  const at = k[pre + 'harness'] ? [b[0] + 6, b[1] - 15] : [h[0] - 9, h[1] + 16]
  const [cx, cy] = toScene({ x: v.d_x, y: v.d_y, r: v.d_r, f: v.d_f, sc: v.d_sc }, at)
  const hx = v.hx, hy = v.hy + 4
  let d
  if (k.leash === 'tight') d = `M${cx.toFixed(1)} ${cy.toFixed(1)}L${hx.toFixed(1)} ${hy.toFixed(1)}`
  else if (k.leash === 'line') { const mx = (cx + hx) / 2; d = `M${cx.toFixed(1)} ${cy.toFixed(1)}C${cx.toFixed(1)} ${GROUND + 4} ${mx.toFixed(1)} ${GROUND - 1} ${mx.toFixed(1)} ${GROUND - 1}S${hx.toFixed(1)} ${GROUND + 4} ${hx.toFixed(1)} ${hy.toFixed(1)}` }
  else { const mx = (cx + hx) / 2, sag = Math.max(cy, hy) + 34; d = `M${cx.toFixed(1)} ${cy.toFixed(1)}Q${mx.toFixed(1)} ${sag.toFixed(1)} ${hx.toFixed(1)} ${hy.toFixed(1)}` }
  return <path d={d} fill="none" stroke={k.leash === 'line' ? '#E0532F' : INK} strokeWidth="3" strokeLinecap="round" opacity={v.ho} />
}

// One frame of a scene. `name` fills in "{name}" in what the person says.
export function Stage({ s, name = 'your dog', walkPhase = 0, walkAmp = 0, personAmp = 0, title }) {
  const { v, k } = s
  const say = k.say ? k.say.replace('{name}', name) : null
  const [nx, ny] = (() => { const pre = 'd_', p = k[pre + 'p']; const n = noseOf(p, P3(v, pre, 'h')); return toScene({ x: v.d_x, y: v.d_y, r: v.d_r, f: v.d_f, sc: v.d_sc }, n) })()
  // Speech sits above the hand side of the stage; "Yes!" just beside it.
  const bw = (t) => Math.max(44, t.length * 8.4 + 22)
  const side = v.px < 160 ? 1 : -1, clampX = (x, w) => Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, x))
  const bx = clampX(v.px + side * 60, say ? bw(say) : 44), by = 22
  const yx = say ? clampX(bx - side * (bw(say) / 2 + 30), 44) : bx
  return <svg className="an-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} focusable="false">
    <Backdrop bg={k.bg} gx={v.gx} />
    <PropsBack v={v} />
    <Helper v={v} phase={walkPhase} amp={personAmp} />
    <Person v={v} k={k} phase={walkPhase} amp={personAmp} />
    <Dog v={v} k={k} pre="e_" tone={FUR2} phase={walkPhase + 1} amp={walkAmp} />
    <Dog v={v} k={k} pre="d_" phase={walkPhase} amp={walkAmp} />
    <Leash v={v} k={k} />
    {k.treat === 'mouth' && <Treat x={nx - 2 * v.d_f} y={ny + 4} />}
    <PropsFront v={v} />
    {k.path && <path className="an-path" d={k.path} fill="none" stroke={BLUE} strokeWidth="2.5" strokeDasharray="5 5" strokeLinecap="round" markerEnd="url(#an-arrow)" />}
    <defs><marker id="an-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5 0 10z" fill={BLUE} /></marker></defs>
    <Arm sx={v.qx + 14} sy={-40} x={v.gx2} y={v.gy2} kind={k.hand2} o={v.go2 * v.qo} sleeve="#7B8594" />
    <Arm sx={k.seat ? v.px + 14 : v.px - 2} sy={k.seat ? 10 : -40} x={v.hx} y={v.hy} kind={k.hand} o={v.ho} />
    {say && <Bubble x={bx} y={by} text={say} />}
    {k.yes && <Bubble x={yx} y={say ? by + 34 : by} text="Yes!" yes />}
  </svg>
}
