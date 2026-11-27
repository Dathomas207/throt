// The two small ways into Training: a compact row on Today, and a card on the dog tab that also shows the
// earned training badges. Both read the same summary the Training screen does.
import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { badgeSvg } from './badgeArt.js'
import { demoTraining } from './demo.js'
import { LEVEL_SHORT, selfReported } from './skills.js'
import { openTraining, TRAINING_CHANGED } from './host.jsx'
import '../screens/training.css'

// The art is a fixed SVG string built from Trot's own tables (badgeArt.js), never from anything a person typed.
export const BadgeArt = ({ b, s = 44 }) => <span className="tr-art" aria-hidden="true" dangerouslySetInnerHTML={{ __html: badgeSvg(b, s) }} />
export const TrainIcon = ({ s = 20, c = '#1F5AE8' }) => <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v6c0 4.500-3 7.500-7 9-4-1.500-7-4.500-7-9V6z" /><path d="M8.500 12l2.500 2.500 4.500-5" /></svg>
export const streakText = (s) => (s && s.current > 0 ? `${s.current} day streak` : '')

// The last answer per dog, kept for this visit so a row does not blink empty each time a tab is opened.
const seen = new Map()
// One earned training badge in the dog tab's badge list, with its own art and the self-reported label.
export const TrainingBadge = ({ b }) => <li className="tbadge on"><BadgeArt b={{ ...b, earned: true }} s={40} /><span className="grow"><b>{b.name}</b><small>{b.how}</small></span></li>
// Signed in it asks the API and asks again whenever practice changes. In the demo it is the sample data.
export function useTraining({ real, dd }) {
  const slug = real ? real.dog.slug : null
  const [data, setData] = useState(() => (real ? seen.get(slug) || null : null))
  useEffect(() => {
    if (!real) { setData(demoTraining(dd.key, dd.dog.name)); return }
    let on = true
    const load = () => api.training.get(slug).then((r) => { seen.set(slug, r); if (on) setData(r) }, () => {})
    setData(seen.get(slug) || null); load()
    window.addEventListener(TRAINING_CHANGED, load)
    return () => { on = false; window.removeEventListener(TRAINING_CHANGED, load) }
  }, [slug, real ? null : dd.key])
  return data
}

// Today: the next skill up and the streak. One tap opens that lesson.
export function TrainingRow({ real, dd }) {
  const data = useTraining({ real, dd })
  const name = real ? real.dog.name : dd.dog.name
  const next = data && data.next, streak = streakText(data && data.streak)
  return <button className="rrow box tr-row" onClick={() => openTraining(next ? { skill: next.skillId } : {})} aria-label={next ? `Training. Next up: ${next.name}. ${streak || 'No streak yet'}. Continue` : `Training for ${name}`}>
    <span className="ricon"><TrainIcon /></span>
    <span className="grow"><b>Training</b><small>{next ? `Next up: ${next.name}${streak ? ` · ${streak}` : ''}` : data ? 'Every skill is proofed. Keep the streak going.' : `Short lessons and badges for ${name}`}</small></span>
    <span className="tr-go">{next && next.level > 0 ? 'Continue' : 'Start'}</span>
  </button>
}

const ORDER = { track: 0, cross: 1, skill: 2 }
// The dog tab: where things stand, and the earned badges with their self-reported label.
export function TrainingCard({ real, dd }) {
  const data = useTraining({ real, dd })
  const name = real ? real.dog.name : dd.dog.name
  const earned = data ? data.badges.filter((b) => b.earned).length : 0
  const levels = data ? Object.values(data.progress) : []
  const home = levels.filter((p) => p.level >= 2).length, pub = levels.filter((p) => p.level >= 3).length
  return <section className="card padc tr-card" aria-label="Training">
    <div className="row between g8"><b>Training</b><button className="tbtn" onClick={() => openTraining({})}>Open training</button></div>
    <p className="meta">{!data ? `Short reward-based lessons for ${name}.` : levels.length === 0 ? `Nothing practised yet. Six tracks of short lessons are ready when ${name} is.` : `${levels.length} ${levels.length === 1 ? 'skill' : 'skills'} started · ${home} ${LEVEL_SHORT[2].toLowerCase()}${pub ? ` · ${pub} ${LEVEL_SHORT[3].toLowerCase()}` : ''}${streakText(data.streak) ? ` · ${streakText(data.streak)}` : ''}`}</p>
    {earned > 0 && <p className="meta"><button className="tbtn inline" onClick={() => openTraining({ view: 'badges' })}>{earned} training {earned === 1 ? 'badge' : 'badges'}</button> · {selfReported(name)}</p>}
    {/* Signed in, the earned badges are listed in the Awards card above. The demo has no such list, so they show here. */}
    {!real && earned > 0 && <><div className="sl">TRAINING BADGES, SELF-REPORTED</div><ul className="tbadges">{data.badges.filter((b) => b.earned).sort((x, y) => ORDER[x.group] - ORDER[y.group]).slice(0, 5).map((b) => <TrainingBadge key={b.id} b={{ ...b, how: `Training badge. ${selfReported(name)}.` }} />)}</ul></>}
    {data && data.next && <button className="cta small" onClick={() => openTraining({ skill: data.next.skillId })}>{data.next.level > 0 ? 'Continue' : 'Start'}: {data.next.name}</button>}
  </section>
}
