// Deleting an account. One transaction: either everything below happens or nothing does.
//
// The rule for dogs:
// - A dog this person is the only owner of, with no family member on its team, is deleted with everything
//   that belongs to it (walks, photos, health records, documents, awards, tags, friends, training).
//   Walkers and daycare on that team lose the dog too.
// - A dog with another owner stays, and this person is taken off its team.
// - A dog this person is the only owner of, with at least one family member, stays. The family member
//   who has been on the team longest becomes the owner, and this person is taken off the team.
// - A dog this person is on as family, walker or daycare stays, and this person is taken off the team.
//
// A dog that stays keeps its history. Walks, photos, health entries, documents, awards, tags and practice
// sessions this person added to it are kept and shown as added by "Former member", a placeholder account
// with no name or email of theirs. Vet links and unused invites this person made are deleted.
//
// Everything that is only theirs is deleted: sessions, saved routes, live walk, notifications and
// notification settings, paws, place confirmations, claims and reports, usage rows, events they added,
// and places they added that nobody else has confirmed or maintains.

// The placeholder that kept records point at. The address ends in .invalid, which no sign-in accepts.
export const FORMER_MEMBER = { id: '00000000-0000-4000-8000-000000000000', name: 'Former member', email: 'former-member@deleted.invalid' }

const marks = (ids, from = 1) => ids.map((_, i) => `$${i + from}`).join(', ')

// Tables with a dog_id column that go when the dog goes. Fixed names, never from a request.
const DOG_TABLES = ['tag_scans', 'dog_tags', 'dog_registrations', 'training_sessions', 'training_progress', 'live_walks', 'event_entries', 'challenge_joins', 'health_entries', 'health_shares', 'documents', 'awards', 'invites', 'walks', 'memberships']
// Records on a dog that stays, and the column that says who added them.
const KEPT = [['walks', 'user_id'], ['walk_photos', 'added_by'], ['health_entries', 'created_by'], ['documents', 'uploaded_by'], ['awards', 'created_by'], ['dog_tags', 'created_by'], ['dog_follows', 'created_by'], ['training_sessions', 'user_id'], ['dogs', 'created_by'], ['invites', 'created_by'], ['invites', 'used_by']]
// Rows that are only this person's.
const OWN = ['paws', 'live_walks', 'notifications', 'notification_prefs', 'place_confirms', 'place_claims', 'place_reports', 'usage_events', 'routes', 'sessions', 'memberships']

async function deleteDog(q, id) {
  const walks = (await q('SELECT id FROM walks WHERE dog_id = $1', [id])).rows.map((r) => r.id)
  if (walks.length) {
    await q(`DELETE FROM paws WHERE walk_id IN (${marks(walks)})`, walks)
    await q(`DELETE FROM walk_photos WHERE walk_id IN (${marks(walks)})`, walks)
    // Someone else's saved route that came from one of these walks stays theirs. It just stops pointing at it.
    await q(`UPDATE routes SET source_walk_id = NULL WHERE source_walk_id IN (${marks(walks)})`, walks)
  }
  await q('UPDATE routes SET dog_id = NULL, usual = FALSE WHERE dog_id = $1', [id])
  await q('UPDATE usage_events SET dog_id = NULL WHERE dog_id = $1', [id])
  await q('DELETE FROM notifications WHERE dog_id = $1', [id])
  await q('DELETE FROM dog_follows WHERE follower_dog_id = $1 OR followed_dog_id = $1', [id])
  for (const table of DOG_TABLES) await q(`DELETE FROM ${table} WHERE dog_id = $1`, [id])
  await q('DELETE FROM dogs WHERE id = $1', [id])
}

// Answers { dogsDeleted, dogsKept, dogsHandedOn }. Throws, with nothing changed, if any step fails.
export async function deleteAccount(db, userId) {
  return db.tx(async (t) => {
    const q = (text, params) => t.query(text, params)
    const out = { dogsDeleted: 0, dogsKept: 0, dogsHandedOn: 0 }
    const mine = (await q('SELECT dog_id, role FROM memberships WHERE user_id = $1', [userId])).rows
    for (const m of mine) {
      if (m.role === 'owner') {
        const others = (await q('SELECT user_id, role FROM memberships WHERE dog_id = $1 AND user_id <> $2 ORDER BY created_at ASC, user_id ASC', [m.dog_id, userId])).rows
        if (!others.some((o) => o.role === 'owner')) {
          const heir = others.find((o) => o.role === 'family')
          if (!heir) { await deleteDog(q, m.dog_id); out.dogsDeleted++; continue }
          await q('UPDATE memberships SET role = $1 WHERE dog_id = $2 AND user_id = $3', ['owner', m.dog_id, heir.user_id])
          out.dogsHandedOn++
        }
      }
      out.dogsKept++
    }

    // Vet links and unused invites this person made stop working.
    await q('DELETE FROM health_shares WHERE created_by = $1', [userId])
    await q('DELETE FROM invites WHERE created_by = $1 AND used_by IS NULL', [userId])
    // What they added to dogs that stay is kept and no longer carries their name.
    let placeholder = false
    for (const [table, column] of KEPT) {
      const has = await q(`SELECT 1 AS x FROM ${table} WHERE ${column} = $1 LIMIT 1`, [userId])
      if (!has.rows[0]) continue
      if (!placeholder) {
        await q('INSERT INTO users (id, name, email, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING', [FORMER_MEMBER.id, FORMER_MEMBER.name, FORMER_MEMBER.email, new Date().toISOString()])
        placeholder = true
      }
      await q(`UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2`, [FORMER_MEMBER.id, userId])
    }
    await q('UPDATE dog_registrations SET updated_by = NULL WHERE updated_by = $1', [userId])
    await q('UPDATE training_progress SET passed_by = NULL WHERE passed_by = $1', [userId])

    // Saved routes are private to the person. Outings that followed one are kept without the link.
    const routes = (await q('SELECT id FROM routes WHERE user_id = $1', [userId])).rows.map((r) => r.id)
    if (routes.length) await q(`UPDATE walks SET route_id = NULL WHERE route_id IN (${marks(routes)})`, routes)

    // Events they added go, with every dog's mark on them.
    const events = (await q('SELECT id FROM events WHERE created_by = $1', [userId])).rows.map((r) => r.id)
    if (events.length) {
      await q(`DELETE FROM event_entries WHERE event_id IN (${marks(events)})`, events)
      await q(`DELETE FROM events WHERE id IN (${marks(events)})`, events)
    }

    for (const table of OWN) await q(`DELETE FROM ${table} WHERE user_id = $1`, [userId])

    // A listing they maintained goes back to having no manager.
    await q('UPDATE places SET managed_by = NULL, managed_role = NULL WHERE managed_by = $1', [userId])
    // A place they added goes unless someone else has confirmed it or maintains it. Then it stays with no adder.
    const places = (await q('SELECT id, managed_by FROM places WHERE created_by = $1', [userId])).rows
    for (const p of places) {
      const others = await q('SELECT 1 AS x FROM place_confirms WHERE place_id = $1 LIMIT 1', [p.id])
      if (others.rows[0] || p.managed_by) { await q('UPDATE places SET created_by = NULL WHERE id = $1', [p.id]); continue }
      for (const table of ['place_claims', 'place_reports', 'place_confirms']) await q(`DELETE FROM ${table} WHERE place_id = $1`, [p.id])
      await q('DELETE FROM places WHERE id = $1', [p.id])
    }

    await q('DELETE FROM users WHERE id = $1', [userId])
    return out
  })
}
