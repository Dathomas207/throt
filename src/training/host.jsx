// Opens the Training screen from anywhere (the Today row, the dog tab, a notification) without the caller
// holding any state. The screen itself loads on demand, the way Settings, Compete and Notifications do,
// inside its own error boundary.
import React, { lazy, Suspense, useEffect, useState } from 'react'
import ErrorBoundary from '../ErrorBoundary.jsx'
import { setScreen, currentScreen } from '../usage.js'

const Training = lazy(() => import('../screens/Training.jsx'))
let show = null
// `start` may carry { skill } or { view: 'badges' } to open somewhere other than the track list.
export const openTraining = (start) => { if (show) show(start || {}) }
// Fired after practice is logged, a level changes or a session is deleted, so rows elsewhere can refresh.
export const TRAINING_CHANGED = 'trot-training-changed'
export const trainingChanged = () => { try { window.dispatchEvent(new Event(TRAINING_CHANGED)) } catch (e) {} }

export function TrainingHost({ real, dd, setToast, setTab }) {
  const [start, setStart] = useState(null)
  useEffect(() => { show = setStart; return () => { if (show === setStart) show = null } }, [])
  useEffect(() => { if (!start) return; const was = currentScreen(); setScreen('training'); return () => setScreen(was) }, [start])
  if (!start) return null
  const close = () => setStart(null)
  return <ErrorBoundary name="training" kind="sheet" onClose={close}><Suspense fallback={null}>
    <Training key={real ? real.dog.slug : dd.key} close={close} start={start} real={real} dd={dd} setToast={setToast} goAwards={() => { close(); setTab('dog') }} />
  </Suspense></ErrorBoundary>
}
