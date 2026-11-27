// The training tracks, skill ids and badge rules. Plain data and pure functions with no imports, so the
// browser (src/training/content.js, the Training screen) and the server (server/routesTraining.js) read the
// same list. The lessons themselves live in content.js; this file is only what both sides must agree on.
//
// Everything here is self-reported by a dog's own family. Nothing in Trot certifies a dog.

export const TRACKS = [
  { id: 'foundations', name: 'Foundations', glyph: 'block', blurb: 'The everyday basics every other track builds on.', skills: [
    ['name-response', 'Name response'], ['sit', 'Sit'], ['down', 'Down'], ['touch', 'Touch'], ['wait-at-doors', 'Wait at doors'], ['settle-on-mat', 'Settle on a mat']] },
  { id: 'loose-leash', name: 'Loose leash walking', glyph: 'leash', blurb: 'A relaxed leash and a dog who chooses to stay with you.', skills: [
    ['leash-attention', 'Attention on leash'], ['walk-beside', 'Walking beside you'], ['turns-and-stops', 'Turns and stops'], ['pass-distractions', 'Passing distractions'], ['polite-greeting', 'Greeting people politely']] },
  { id: 'recall', name: 'Recall', glyph: 'return', blurb: 'Coming when called, built up one easy win at a time.', skills: [
    ['come-indoors', 'Come indoors'], ['come-in-yard', 'Come in the yard'], ['long-line-recall', 'Long line recall'], ['recall-from-distraction', 'Recall away from a distraction'], ['emergency-recall', 'Emergency recall word']] },
  { id: 'out-and-about', name: 'Out and about', glyph: 'cup', blurb: 'Manners for patios, sidewalks, cars and lobbies.', skills: [
    ['patio-settle', 'Settle at a patio'], ['leave-it', 'Leave it'], ['calm-around-dogs', 'Calm around other dogs'], ['car-loading', 'Loading in and out of the car'], ['elevator-stairs', 'Elevator and stairs manners']] },
  { id: 'trail-park', name: 'Trail and park', glyph: 'peak', blurb: 'Good habits for trails, greenways and parks.', skills: [
    ['trail-check-ins', 'Check-ins on the trail'], ['wait-at-junctions', 'Wait at trail junctions'], ['leave-wildlife', 'Leave wildlife'], ['water-safety', 'Water safety basics'], ['pack-out', 'Pack-out routine']] },
  { id: 'tricks', name: 'Tricks and fun', glyph: 'star', blurb: 'Low-pressure tricks that build focus and confidence.', skills: [
    ['spin', 'Spin'], ['paw', 'Paw'], ['bow', 'Bow'], ['roll-over', 'Roll over'], ['hold-object', 'Hold an object'], ['tidy-toys', 'Tidy up toys']] },
].map((t) => ({ ...t, skills: t.skills.map(([id, name]) => ({ id, name, track: t.id })) }))

export const SKILLS = TRACKS.flatMap((t) => t.skills)
export const SKILL_IDS = SKILLS.map((s) => s.id)
const BY_ID = new Map(SKILLS.map((s) => [s.id, s]))
export const skillOf = (id) => (typeof id === 'string' && BY_ID.get(id)) || null
export const trackOf = (id) => TRACKS.find((t) => t.id === id) || null

export const LEVELS = ['Not started', 'Learning', 'Reliable at home', 'Proofed out and about']
export const LEVEL_SHORT = ['Not started', 'Learning', 'Reliable at home', 'Proofed in public']
export const PLACES = [['home', 'Home'], ['yard', 'Yard'], ['out', 'Out and about']]
export const PLACE_IDS = PLACES.map((p) => p[0])
export const TRAINING_LIMITS = { note: 140, minutes: 60, reps: 50, backfillDays: 30, recent: 200, perDog: 5000 }
// Who may confirm a level. Walkers and daycare can log practice, but the level is the family's call.
export const CONFIRM_ROLES = ['owner', 'family']
// The self-check asks this many yes or no questions, and every one has to be a yes.
export const CHECK_COUNT = 3
export const selfReported = (dogName) => `Self-reported by ${dogName}'s family`

// The three questions for a level, built from the skill's own pass standard (content.js supplies `pass`).
export function selfCheck(level, pass, dogName = 'your dog') {
  if (level === 2) return [
    `At home, did ${dogName} meet this standard: ${pass.home}?`,
    'Did that happen on at least two different days?',
    `Did ${dogName} do it on your cue or hand signal, with no treat showing in your hand first?`,
  ]
  return [
    `In a public place, did ${dogName} meet this standard: ${pass.out}?`,
    'Were everyday distractions around, such as people, sounds or other dogs at a distance?',
    `Did ${dogName} look relaxed and happy to work, not worried or overwhelmed?`,
  ]
}

const need = (n) => Math.ceil(n / 2)
const TIER_RANK = { bronze: 1, silver: 2, gold: 3 }
const TIER_NAME = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' }
export const PATIO_PRO = ['patio-settle', 'leave-it', 'polite-greeting']
export const TRAIL_READY = ['recall-from-distraction', 'trail-check-ins', 'leave-wildlife']
const names = (ids) => ids.map((id) => BY_ID.get(id).name).join(', ')

// Tier of one track from the levels of its skills: Bronze at half the track reliable at home, Silver at
// the whole track reliable at home, Gold at the whole track proofed in public.
export function trackTier(track, levels) {
  const l = track.skills.map((s) => levels[s.id] || 0), n = l.length
  const at2 = l.filter((v) => v >= 2).length, at3 = l.filter((v) => v >= 3).length
  return { tier: at3 === n ? 'gold' : at2 === n ? 'silver' : at2 >= need(n) ? 'bronze' : null, at2, at3, n }
}

// Every badge, earned or not. `levels` maps skill id to 0..3, `sessions` is how many practice sessions are
// logged in all, `bestStreak` the longest run of days in a row with practice. Pure: same input, same list.
export function computeBadges({ levels = {}, sessions = 0, bestStreak = 0 } = {}) {
  const out = []
  const lv = (id) => levels[id] || 0
  for (const t of TRACKS) {
    const tt = trackTier(t, levels)
    const next = tt.tier === 'gold' ? null : tt.tier === 'silver' ? 'gold' : tt.tier === 'bronze' ? 'silver' : 'bronze'
    const how = next === 'bronze' ? `Bronze: ${need(tt.n)} of ${tt.n} skills reliable at home.` : next === 'silver' ? `Silver: all ${tt.n} skills reliable at home.` : next === 'gold' ? `Gold: all ${tt.n} skills proofed in public.` : `All ${tt.n} skills proofed in public.`
    out.push({ id: `track:${t.id}`, group: 'track', track: t.id, glyph: t.glyph, tier: tt.tier, earned: !!tt.tier, name: tt.tier ? `${t.name} ${TIER_NAME[tt.tier]}` : t.name, how,
      progress: next === 'gold' ? tt.at3 : tt.at2, target: next === 'bronze' ? need(tt.n) : tt.n })
  }
  for (const s of SKILLS) {
    const v = lv(s.id), tier = v >= 3 ? 'proofed' : v >= 2 ? 'reliable' : null
    out.push({ id: `skill:${s.id}`, group: 'skill', track: s.track, skill: s.id, glyph: trackOf(s.track).glyph, tier, earned: !!tier,
      name: tier === 'proofed' ? `${s.name}: proofed in public` : tier === 'reliable' ? `${s.name}: reliable at home` : s.name,
      how: tier === 'proofed' ? 'Confirmed in a public place.' : tier === 'reliable' ? 'Next: confirm it in a public place to upgrade this badge.' : 'Confirm it as reliable at home.', progress: Math.min(v, 3), target: tier === 'reliable' ? 3 : 2 })
  }
  const tierOf = (id) => TIER_RANK[trackTier(trackOf(id), levels).tier] || 0
  const all3 = (ids) => ids.filter((id) => lv(id) >= 3).length
  const cross = (id, name, glyph, how, progress, target) => out.push({ id: `cross:${id}`, group: 'cross', glyph, tier: progress >= target ? 'special' : null, earned: progress >= target, name, how, progress: Math.min(progress, target), target })
  cross('first-session', 'First session', 'check', 'Log one practice session.', sessions, 1)
  cross('streak-7', '7 day practice streak', 'seven', 'Practice 7 days in a row.', bestStreak, 7)
  cross('sessions-30', '30 sessions', 'thirty', 'Log 30 practice sessions in all.', sessions, 30)
  cross('patio-pro', 'Patio pro', 'cup', `Proofed in public: ${names(PATIO_PRO)}.`, all3(PATIO_PRO), 3)
  cross('trail-ready', 'Trail ready', 'peak', `Proofed in public: ${names(TRAIL_READY)}.`, all3(TRAIL_READY), 3)
  cross('good-neighbor', 'Good neighbor', 'house', 'Foundations and Loose leash walking both at Silver.', (tierOf('foundations') >= 2 ? 1 : 0) + (tierOf('loose-leash') >= 2 ? 1 : 0), 2)
  return out
}
// One key per badge and tier. An upgrade (Bronze to Silver, home to public) counts as newly earned.
export const badgeKey = (b) => `${b.id}@${b.tier}`
// A step back down (Gold to Silver, public to home) is not an earning.
const RANK = { reliable: 1, proofed: 2, bronze: 1, silver: 2, gold: 3, special: 1 }
export const newlyEarned = (before, after) => { const had = Object.fromEntries(before.filter((b) => b.earned).map((b) => [b.id, RANK[b.tier] || 0])); return after.filter((b) => b.earned && (RANK[b.tier] || 0) > (had[b.id] || 0)) }

// Practice streaks. `times` are session times in milliseconds, `tz` is minutes behind UTC (the number a
// browser's getTimezoneOffset() gives), so a day is the person's own calendar day. A streak is still alive
// when the last practice was yesterday.
const DAY = 864e5
export const practiceDay = (t, tz = 0) => Math.floor((t - tz * 60e3) / DAY)
export function practiceStreak(times, now = Date.now(), tz = 0) {
  const days = new Set(times.map((t) => practiceDay(t, tz))), today = practiceDay(now, tz)
  let current = 0, best = 0
  for (let d = days.has(today) ? today : today - 1; days.has(d); d--) current++
  for (const d of days) { if (days.has(d - 1)) continue; let n = 1; while (days.has(d + n)) n++; if (n > best) best = n }
  return { current, best, today: days.has(today) }
}

// A gentle suggestion: the easiest skill not yet reliable at home in the track practised most recently,
// otherwise the first such skill from Foundations onward. Once everything is reliable at home it points at
// the first skill not yet proofed in public. `lastSkillId` is the skill of the newest session, if any.
export function nextUp(levels = {}, lastSkillId = null) {
  const lv = (id) => levels[id] || 0
  const last = skillOf(lastSkillId) ? trackOf(skillOf(lastSkillId).track) : null
  for (const max of [2, 3]) {
    for (const t of [...(last ? [last] : []), ...TRACKS]) { const s = t.skills.find((x) => lv(x.id) < max); if (s) return { skillId: s.id, trackId: t.id, name: s.name, trackName: t.name, level: lv(s.id) } }
  }
  return null
}
