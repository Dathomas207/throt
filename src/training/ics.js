// A calendar file (RFC 5545) for short practice sessions of one skill. Pure: same input, same text, so
// server/training-extras.test.js can check it. Nothing is sent anywhere; the browser saves the file.
//
// Times are "floating" (no time zone), so 6 pm means 6 pm wherever the calendar is, which is what a
// person picking "6 pm" means. One repeating event, not one event per day.

const pad = (n) => String(n).padStart(2, '0')
const stamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
const local = (y, m, d, h, min) => `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`
// Text values escape backslash, semicolon, comma and line breaks.
const esc = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n')
// Lines longer than 75 octets fold onto the next line with a leading space.
function fold(line) {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out = []
  let cur = '', size = 0
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0 }
    cur += ch; size += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

export const REMINDER_DAYS = [3, 7, 14]
export const REMINDER_DEFAULT = { hour: 18, minute: 0, days: 7, every: 1 }

// How many sessions a plan holds: every day for `days` days, or every other day within them.
export const sessionCount = (days, every) => Math.max(1, Math.ceil(days / (every === 2 ? 2 : 1)))

// { skillId, skillName, minutes, hour, minute, days, every (1 or 2), start (a Date for the first day,
// read in local time), now (a Date, for DTSTAMP), url (optional) } -> the .ics text.
export function practiceIcs({ skillId, skillName, minutes = 5, hour = 18, minute = 0, days = 7, every = 1, start = new Date(), now = new Date(), url = '' }) {
  const h = Math.min(23, Math.max(0, Math.floor(Number(hour) || 0))), mi = Math.min(59, Math.max(0, Math.floor(Number(minute) || 0)))
  const len = Math.min(15, Math.max(1, Math.round(Number(minutes) || 5)))
  const d = Math.min(60, Math.max(1, Math.round(Number(days) || 7))), ev = every === 2 ? 2 : 1
  const y = start.getFullYear(), m = start.getMonth() + 1, dd = start.getDate()
  const end = new Date(y, m - 1, dd, h, mi + len)
  const count = sessionCount(d, ev)
  const safeId = String(skillId || 'skill').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'skill'
  const uid = `trot-practice-${safeId}-${local(y, m, dd, h, mi)}@trot-app`
  const desc = `A ${len} minute practice session for ${skillName}. Open the lesson in Trot for the steps. End on a win.`
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Trot//Training reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${local(y, m, dd, h, mi)}`,
    `DTEND:${local(end.getFullYear(), end.getMonth() + 1, end.getDate(), end.getHours(), end.getMinutes())}`,
    `RRULE:FREQ=DAILY;INTERVAL=${ev};COUNT=${count}`,
    `SUMMARY:${esc(`Practice: ${skillName}`)}`,
    `DESCRIPTION:${esc(desc)}`,
    ...(url ? [`URL:${url}`] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`Practice: ${skillName}`)}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}
export const icsFileName = (skillId) => `trot-practice-${String(skillId || 'skill').replace(/[^a-z0-9-]/gi, '')}.ics`
