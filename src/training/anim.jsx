// The looping demonstration at the top of a lesson. Loaded on demand with the lesson (Training.jsx
// imports it lazily), so none of this is in the main bundle.
//
// It plays the beats in animScripts.js, blending one into the next, holds each one long enough to read
// the caption, and pauses at the end before starting over. It stops when it is off screen or the page
// is hidden. With reduced motion turned on it shows the beats as a still storyboard instead.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Stage, flatten, blend } from './cast.jsx'
import { scriptFor } from './animScripts.js'
import './anim.css'

const TWEEN = 1000, HOLD = 1900, END = 1500
const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) { return false } }

function useReduced() {
  const [r, setR] = useState(reducedMotion)
  useEffect(() => {
    let m
    try { m = window.matchMedia('(prefers-reduced-motion: reduce)') } catch (e) { return }
    const on = () => setR(m.matches)
    if (m.addEventListener) m.addEventListener('change', on); else if (m.addListener) m.addListener(on)
    return () => { if (m.removeEventListener) m.removeEventListener('change', on); else if (m.removeListener) m.removeListener(on) }
  }, [])
  return r
}

// How far the walkers have gone, for leg swing: the ground sliding by plus any change of place.
function walkers(a, b, t) {
  const moveDog = Math.abs(b.v.d_x - a.v.d_x) + Math.abs(b.v.gx - a.v.gx), movePerson = Math.abs(b.v.px - a.v.px) + Math.abs(b.v.gx - a.v.gx) + Math.abs(b.v.qx - a.v.qx)
  const live = t > 0 && t < 1
  return { dogAmp: live && moveDog > 4 ? 1 : 0, personAmp: live && movePerson > 4 ? 1 : 0, phase: t * Math.max(moveDog, movePerson) * 0.16 }
}

export default function LessonAnim({ skillId, skillName, name, onBeat }) {
  const beats = useMemo(() => scriptFor(skillId) || [], [skillId])
  const flat = useMemo(() => beats.map(flatten), [beats])
  const reduced = useReduced()
  const [i, setI] = useState(0)
  const [from, setFrom] = useState(0)
  const [t, setT] = useState(1)
  const [playing, setPlaying] = useState(true)
  const [shown, setShown] = useState(true)
  const [said, setSaid] = useState('')
  const box = useRef(null), clock = useRef({ start: 0, i: 0 })

  useEffect(() => { if (onBeat && beats[i]) onBeat(beats[i].step) }, [i, beats])
  useEffect(() => () => { if (onBeat) onBeat(null) }, [])

  // On screen and the page visible: only then does it run.
  useEffect(() => {
    const el = box.current
    let inView = true, pageOn = typeof document === 'undefined' || !document.hidden
    const set = () => setShown(inView && pageOn)
    let io = null
    if (el && typeof IntersectionObserver !== 'undefined') { io = new IntersectionObserver((es) => { inView = es.some((e) => e.isIntersecting); set() }, { threshold: 0.15 }); io.observe(el) }
    const vis = () => { pageOn = !document.hidden; set() }
    document.addEventListener('visibilitychange', vis)
    return () => { if (io) io.disconnect(); document.removeEventListener('visibilitychange', vis) }
  }, [reduced])

  // The clock. Frames are drawn only while a beat is moving; holds just wait.
  useEffect(() => {
    if (reduced || !playing || !shown || !beats.length) return
    let raf = 0, alive = true
    const c = clock.current
    const now = () => performance.now()
    // Pick up where it was: keep the time already spent in this beat.
    c.start = now() - (c.spent || 0)
    const tick = () => {
      if (!alive) return
      const b = beats[c.i] || beats[0], tw = b.ms || TWEEN, hold = (b.hold || HOLD) + (c.i === beats.length - 1 ? END : 0)
      const el = now() - c.start
      c.spent = el
      if (el < tw) { setT(el / tw); raf = requestAnimationFrame(tick); return }
      setT(1)
      if (el < tw + hold) { raf = requestAnimationFrame(tick); return }
      // Next beat. After the last one it starts over without blending back.
      const next = (c.i + 1) % beats.length
      setFrom(next === 0 ? 0 : c.i); setI(next); c.i = next; c.start = now(); c.spent = 0; setT(next === 0 ? 1 : 0)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { alive = false; cancelAnimationFrame(raf) }
  }, [reduced, playing, shown, beats])

  if (!beats.length) return null
  const title = `Demonstration of ${skillName}`
  if (reduced) {
    return <figure className="an an-board" aria-label={title}>
      <ol className="an-strip">{beats.map((b, k) => <li key={k}><Stage s={flatten(b)} name={name} title={`${k + 1}. ${b.cap}`} /><span><b className="num">{k + 1}</b> {b.cap}</span></li>)}</ol>
    </figure>
  }
  const go = (n) => {
    const next = (n + beats.length) % beats.length
    setFrom(i); setI(next); Object.assign(clock.current, { i: next, start: performance.now(), spent: 0 }); setT(playing ? 0 : 1)
    setSaid(`Step ${next + 1} of ${beats.length}: ${beats[next].cap}`)
  }
  const a = flat[from] || flat[0], b = flat[i]
  const s = t >= 1 ? { ...b, t: 1 } : blend(a, b, t)
  const w = walkers(a, b, t)
  const cap = beats[i].cap
  return <figure className={`an${playing && shown ? '' : ' an-paused'}`} ref={box}>
    <div className="an-stage"><Stage s={s} name={name} title={title} walkPhase={w.phase} walkAmp={w.dogAmp} personAmp={w.personAmp} /></div>
    <figcaption className="an-cap"><span className="an-n num" aria-hidden="true">{i + 1}/{beats.length}</span><span>{cap}</span></figcaption>
    <div className="an-ctl" role="group" aria-label="Demonstration controls">
      <button type="button" onClick={() => go(i - 1)} aria-label="Previous step"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
      <button type="button" className="an-play" onClick={() => { setPlaying((p) => !p); setSaid('') }} aria-label={playing ? 'Pause demonstration' : 'Play demonstration'} aria-pressed={!playing}>
        {playing ? <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg> : <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>}
      </button>
      <button type="button" onClick={() => go(i + 1)} aria-label="Next step"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
      <span className="an-dots" aria-hidden="true">{beats.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</span>
    </div>
    {/* Read out only when someone steps by hand, so autoplay does not talk over the page. */}
    <p className="an-live" aria-live="polite">{said}</p>
  </figure>
}
