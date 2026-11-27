// Training: a practice log per dog, the level the family has confirmed for each skill, and the badges
// that follow from both. Registered from app.js with the shared `kit`.
//
// Rules this file keeps:
// - Skill ids come from src/training/skills.js, the same list the app bundles. Anything else is refused.
// - Anyone on the care team can log practice. Only the owner and family can confirm a level, and only
//   after answering every self-check question with a yes. Level 3 needs level 2 and practice logged out and about.
// - Badges are computed, never stored, and are always described as self-reported. Nothing here certifies a dog.
// - The public page gets earned badges only. Session notes, places and names never leave the care team.
// - Days and streaks follow the `tz` the browser sends (minutes behind UTC), the way health and compete do.
//   Trot stores no time zone for a dog or owner, so without `tz`, and on the public page, days are UTC.
import { SKILL_IDS, skillOf, PLACE_IDS, TRAINING_LIMITS as L, CONFIRM_ROLES, CHECK_COUNT, LEVELS, computeBadges, newlyEarned, badgeKey, practiceStreak, nextUp, selfReported } from '../src/training/skills.js'

const DAY = 864e5
// The level shown for a skill: a confirmed 2 or 3, otherwise 1 once any practice is logged.
export const levelOf = (confirmed, sessions) => (confirmed >= 2 ? Math.min(3, confirmed) : sessions > 0 ? 1 : 0)

export function registerTraining(kit) {
  const { api, db, auth, dogFor, memberItem, HttpError, bad, text, number, object, newId, iso, num, firstName, ID_RE, tzOf } = kit

  // Everything the answers are built from, read once: every session (newest first) and the confirmed levels.
  async function load(dogId) {
    const s = await db.query(`SELECT s.id, s.user_id, s.skill_id, s.at, s.minutes, s.reps_ok, s.reps_total, s.place, s.note, s.walk_id, u.name AS user_name, m.role AS user_role FROM training_sessions s JOIN users u ON u.id = s.user_id LEFT JOIN memberships m ON m.dog_id = s.dog_id AND m.user_id = s.user_id WHERE s.dog_id = $1 ORDER BY s.at DESC, s.id DESC LIMIT ${L.perDog}`, [dogId])
    const p = await db.query('SELECT p.skill_id, p.level, p.passed_at, u.name AS passed_name FROM training_progress p LEFT JOIN users u ON u.id = p.passed_by WHERE p.dog_id = $1', [dogId])
    return { sessions: s.rows, confirmed: Object.fromEntries(p.rows.filter((r) => skillOf(r.skill_id)).map((r) => [r.skill_id, r])) }
  }
  function figure({ sessions, confirmed }, tz, now = Date.now()) {
    const per = {}
    for (const r of sessions) {
      if (!skillOf(r.skill_id)) continue
      const x = per[r.skill_id] || (per[r.skill_id] = { sessions: 0, out: 0, lastAt: null })
      x.sessions++; if (r.place === 'out') x.out++
      if (!x.lastAt) x.lastAt = iso(r.at)
    }
    const levels = {}, progress = {}
    for (const id of SKILL_IDS) {
      const c = confirmed[id], x = per[id] || { sessions: 0, out: 0, lastAt: null }
      const level = levelOf(c ? num(c.level) : 0, x.sessions)
      levels[id] = level
      if (level > 0) progress[id] = { level, sessions: x.sessions, outSessions: x.out, lastAt: x.lastAt, passedAt: level >= 2 && c.passed_at ? iso(c.passed_at) : null, passedBy: level >= 2 && c.passed_name ? firstName(c.passed_name) : null }
    }
    const streak = practiceStreak(sessions.map((r) => new Date(r.at).getTime()), now, tz)
    const badges = computeBadges({ levels, sessions: sessions.length, bestStreak: streak.best })
    return { levels, progress, streak, badges }
  }
  const sessionOut = (r, userId, role) => ({
    id: r.id, skillId: r.skill_id, at: iso(r.at), minutes: num(r.minutes), repsOk: num(r.reps_ok), repsTotal: num(r.reps_total), place: r.place, note: r.note, walkId: r.walk_id || null,
    // First names only for people. A daycare is a business, so its name is shown whole.
    by: r.user_role === 'daycare' ? r.user_name : firstName(r.user_name), mine: r.user_id === userId, canDelete: r.user_id === userId || role === 'owner',
  })
  function summary(dog, role, userId, data, f) {
    const last = data.sessions.find((r) => skillOf(r.skill_id))
    return {
      dog: { slug: dog.slug, name: dog.name }, role, canConfirm: CONFIRM_ROLES.includes(role), selfReported: selfReported(dog.name),
      progress: f.progress, sessions: data.sessions.filter((r) => skillOf(r.skill_id)).slice(0, L.recent).map((r) => sessionOut(r, userId, role)),
      totals: { sessions: data.sessions.length, minutes: data.sessions.reduce((n, r) => n + num(r.minutes), 0) },
      streak: f.streak, badges: f.badges, next: nextUp(f.levels, last ? last.skill_id : null),
    }
  }
  // Owner and family hear about a badge someone else's practice or confirmation earned. Never the person who did it.
  async function announce(dog, actor, fresh, what) {
    for (const b of fresh.slice(0, 4)) {
      await kit.notifyDogPeople(dog.id, { kind: 'training_badge', actorId: actor.id, dedupeKey: `training:${dog.id}:${badgeKey(b)}`, title: `${dog.name} earned a training badge: ${b.name}`, body: `${firstName(actor.name)} ${what}. ${selfReported(dog.name)}.`, link: { to: 'training', dog: dog.slug } })
    }
  }
  const badgeOut = (b) => ({ id: b.id, name: b.name, tier: b.tier, group: b.group, glyph: b.glyph })

  api.get('/dogs/:slug/training', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    const data = await load(dog.id)
    res.json(summary(dog, role, req.user.id, data, figure(data, tzOf(req.query.tz))))
  })

  // Anyone on the care team can log practice.
  api.post('/dogs/:slug/training/sessions', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    const b = object(req.body), tz = tzOf(req.query.tz), now = Date.now()
    if (typeof b.skillId !== 'string' || !skillOf(b.skillId)) throw bad('That is not a skill Trot knows.')
    const minutes = number(b.minutes, 'Minutes', { min: 1, max: L.minutes, integer: true })
    const repsTotal = number(b.repsTotal, 'Tries', { min: 1, max: L.reps, integer: true })
    const repsOk = number(b.repsOk, 'Successful tries', { min: 0, max: L.reps, integer: true })
    if (repsOk > repsTotal) throw bad('Successful tries cannot be more than the tries in all.')
    if (!PLACE_IDS.includes(b.place)) throw bad(`Place must be one of: ${PLACE_IDS.join(', ')}.`)
    const note = text(b.note, 'Note', { max: L.note })
    let at = now
    if (b.at !== undefined && b.at !== null) {
      if (typeof b.at !== 'string' || b.at.length > 40) throw bad('at must be an ISO date.')
      at = new Date(b.at).getTime()
      if (Number.isNaN(at)) throw bad('at must be an ISO date.')
      if (at > now + 5 * 60e3) throw bad('A practice session cannot be in the future.')
      if (at < now - L.backfillDays * DAY) throw bad(`A practice session cannot be more than ${L.backfillDays} days old.`)
    }
    let walkId = null
    if (b.walkId != null) {
      // The outing made by "Share to days": it has to be this person's own Training outing for this dog.
      const ok = typeof b.walkId === 'string' && ID_RE.test(b.walkId) && (await db.query("SELECT id FROM walks WHERE id = $1 AND dog_id = $2 AND user_id = $3 AND type = 'Training'", [b.walkId, dog.id, req.user.id])).rows[0]
      if (!ok) throw bad('walkId must be a Training outing you logged for this dog.')
      walkId = b.walkId
    }
    const before = await load(dog.id)
    if (before.sessions.length >= L.perDog) throw bad(`A dog can have up to ${L.perDog} practice sessions in this trial.`)
    const id = newId()
    await db.query('INSERT INTO training_sessions (id, dog_id, user_id, skill_id, at, minutes, reps_ok, reps_total, place, note, walk_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)', [id, dog.id, req.user.id, b.skillId, iso(at), minutes, repsOk, repsTotal, b.place, note, walkId])
    const data = await load(dog.id), f = figure(data, tz, now)
    const fresh = newlyEarned(figure(before, tz, now).badges, f.badges)
    await announce(dog, req.user, fresh, 'logged a practice session')
    res.status(201).json({ session: sessionOut(data.sessions.find((r) => r.id === id), req.user.id, role), newBadges: fresh.map(badgeOut), ...summary(dog, role, req.user.id, data, f) })
  })

  // The owner or family confirms a level after the self-check. Stepping a level back down needs no check.
  api.post('/dogs/:slug/training/skills/:skillId/level', auth, async (req, res) => {
    const { dog, role } = await dogFor(req.params.slug, req.user.id)
    const skill = skillOf(req.params.skillId)
    if (!skill) throw new HttpError(404, 'That is not a skill Trot knows.')
    if (!CONFIRM_ROLES.includes(role)) throw new HttpError(403, `Only ${dog.name}'s owner or family can confirm a level. You can still log practice.`)
    const b = object(req.body), tz = tzOf(req.query.tz), now = Date.now()
    const level = number(b.level, 'Level', { min: 1, max: 3, integer: true })
    const before = await load(dog.id), f0 = figure(before, tz, now), cur = f0.levels[skill.id]
    if (level > cur) {
      if (level - cur > 1 && !(cur === 0 && level === 1)) {
        throw bad(level === 3 ? `${skill.name} has to be confirmed as "${LEVELS[2]}" before "${LEVELS[3]}".` : 'Log a practice session for this skill first.')
      }
      if (level === 1) throw bad('A skill moves to "Learning" when its first practice session is logged.')
      if (level === 3 && !(f0.progress[skill.id] && f0.progress[skill.id].outSessions > 0)) throw bad('Log at least one practice session out and about before confirming this level.')
      if (!Array.isArray(b.checks) || b.checks.length !== CHECK_COUNT || b.checks.some((v) => v !== true)) throw bad(`Answer yes to all ${CHECK_COUNT} self-check questions to confirm this level. If one is a no, keep practising. There is no rush.`)
    }
    if (level !== cur) {
      if (level < 2) await db.query('DELETE FROM training_progress WHERE dog_id = $1 AND skill_id = $2', [dog.id, skill.id])
      else {
        const u = await db.query('UPDATE training_progress SET level = $1, passed_at = $2, passed_by = $3 WHERE dog_id = $4 AND skill_id = $5 RETURNING skill_id', [level, iso(now), req.user.id, dog.id, skill.id])
        if (!u.rows[0]) await db.query('INSERT INTO training_progress (dog_id, skill_id, level, passed_at, passed_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (dog_id, skill_id) DO NOTHING', [dog.id, skill.id, level, iso(now), req.user.id])
      }
    }
    const data = await load(dog.id), f = figure(data, tz, now)
    const fresh = newlyEarned(f0.badges, f.badges)
    await announce(dog, req.user, fresh, 'confirmed a level')
    res.json({ skillId: skill.id, level: f.levels[skill.id], newBadges: fresh.map(badgeOut), ...summary(dog, role, req.user.id, data, f) })
  })

  // The person who logged a session can delete it, and so can the dog's owner. A linked outing is left alone.
  api.delete('/training/sessions/:id', auth, async (req, res) => {
    const s = await memberItem('training_sessions', 'id, dog_id, user_id', req.params.id, req.user.id, 'No such practice session.')
    if (s.user_id !== req.user.id && s.role !== 'owner') throw new HttpError(403, 'Only the person who logged this session or the dog\'s owner can delete it.')
    await db.query('DELETE FROM training_sessions WHERE id = $1', [s.id])
    res.json({ ok: true })
  })

  // Earned training badges for a dog, with nothing private in them. Used by the public page (UTC days).
  kit.trainingBadges = async (dogId, tz = 0) => figure(await load(dogId), tz).badges.filter((b) => b.earned)
  kit.trainingPublic = async (dog) => {
    try { const list = await kit.trainingBadges(dog.id); return list.length ? { label: selfReported(dog.name), badges: list.map(badgeOut) } : null }
    catch (e) { console.error('training:', e && e.message); return null }
  }
  // The existing earned-badges list (GET /dogs/:slug/awards) gains the earned training badges, labelled as self-reported.
  const walkBadges = kit.badgesFor
  if (walkBadges) kit.badgesFor = async (dogId, tz) => {
    const base = await walkBadges(dogId, tz)
    try {
      const d = await db.query('SELECT name FROM dogs WHERE id = $1', [dogId])
      const label = selfReported(d.rows[0] ? d.rows[0].name : 'this dog')
      return [...base, ...(await kit.trainingBadges(dogId, tz)).map((b) => ({ id: `training:${b.id}`, name: b.name, how: `Training badge. ${label}.`, kind: 'training', tier: b.tier, group: b.group, glyph: b.glyph, progress: 1, target: 1, unit: '', earned: true, selfReported: true }))]
    } catch (e) { console.error('training:', e && e.message); return base }
  }
}
