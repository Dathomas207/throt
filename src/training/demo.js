// Sample training progress for the two demo dogs. Biscuit is partway through Foundations and Loose
// leash walking with a few badges. Millie is just starting. Nothing here is saved or sent anywhere.
import { SKILL_IDS, computeBadges, practiceStreak, nextUp, selfReported } from './skills.js'

const DAY = 864e5
// [skill, days ago, minutes, tries that worked, tries, place, who, note]
const LOGS = {
  biscuit: {
    confirmed: { 'name-response': 3, sit: 3, down: 2, touch: 2, 'leash-attention': 2, 'walk-beside': 2, 'come-indoors': 2 },
    rows: [
      ['wait-at-doors', 0, 3, 4, 5, 'home', 'Dale', 'Front door on leash. Held it while the mail came.'], ['turns-and-stops', 1, 4, 4, 5, 'out', 'Sue', 'Wide turns on Elm St.'],
      ['wait-at-doors', 2, 3, 3, 5, 'home', 'Pat', ''], ['walk-beside', 3, 5, 4, 5, 'out', 'Dale', 'Twenty steps past the school.'], ['sit', 5, 3, 5, 5, 'out', 'Dale', 'Curbs on the greenway.'],
      ['walk-beside', 6, 5, 4, 5, 'yard', 'Pat', ''], ['leash-attention', 7, 3, 5, 5, 'out', 'Sue', ''], ['come-indoors', 8, 3, 5, 5, 'home', 'Dale', 'From upstairs.'],
      ['touch', 9, 3, 5, 5, 'home', 'Pat', ''], ['down', 10, 4, 5, 5, 'home', 'Dale', ''], ['name-response', 11, 3, 4, 5, 'out', 'Dale', 'Freedom Park, on leash.'],
      ['sit', 12, 3, 5, 5, 'home', 'Pat', ''], ['name-response', 13, 3, 5, 5, 'home', 'Dale', ''], ['leash-attention', 14, 3, 4, 5, 'yard', 'Dale', ''],
    ],
  },
  millie: { confirmed: {}, rows: [['name-response', 0, 2, 4, 5, 'home', 'Dale', 'Short and silly. She loved it.'], ['name-response', 1, 2, 3, 5, 'home', 'Pat', '']] },
}

// The same shape GET /api/dogs/:slug/training answers with, so the screens do not care where it came from.
export function demoTraining(key, name) {
  const src = LOGS[key] || LOGS.biscuit, now = Date.now()
  const sessions = src.rows.map(([skillId, ago, minutes, repsOk, repsTotal, place, by, note], i) => ({ id: `demo-${key}-${i}`, skillId, at: new Date(now - ago * DAY - 3600e3).toISOString(), minutes, repsOk, repsTotal, place, note, walkId: null, by, mine: by === 'Dale', canDelete: false }))
  const levels = {}, progress = {}
  for (const id of SKILL_IDS) {
    const mine = sessions.filter((s) => s.skillId === id), level = src.confirmed[id] || (mine.length ? 1 : 0)
    levels[id] = level
    if (level) progress[id] = { level, sessions: mine.length, outSessions: mine.filter((s) => s.place === 'out').length, lastAt: mine[0] ? mine[0].at : null, passedAt: level >= 2 ? new Date(now - 4 * DAY).toISOString() : null, passedBy: level >= 2 ? 'Dale' : null }
  }
  const streak = practiceStreak(sessions.map((s) => Date.parse(s.at)), now, new Date().getTimezoneOffset())
  return { demo: true, dog: { slug: key, name }, role: 'owner', canConfirm: true, selfReported: selfReported(name), progress, sessions, totals: { sessions: sessions.length, minutes: sessions.reduce((n, s) => n + s.minutes, 0) }, streak,
    badges: computeBadges({ levels, sessions: sessions.length, bestStreak: streak.best }), next: nextUp(levels, sessions[0] ? sessions[0].skillId : null) }
}
