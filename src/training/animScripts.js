// The beats of each lesson's demonstration, 3 to 5 per skill. Each beat names the lesson step it shows
// (`step`, counted from 0 in content.js) and a short caption taken from that step. Plain data, so
// server/training-extras.test.js can check every skill has a valid script.
//
// What a beat holds (anything left out carries over from the beat before, except what is said, the
// "Yes!" marker, a treat being eaten and the motion arrow, which belong to one beat):
//   dog: { p: pose, x, y, r (roll), f (1 faces right, -1 left), look: 'back', carry: 'toy', harness }
//   dog2, person: { x, y, f, seat } or false, helper: { x }, hand: { x, y } or { at: 'nose' | 'chest' |
//   'floor', dx, dy } plus k: fist, treat, palm, point, toy, bag, towel. hand2 is the helper's.
//   props: { door: { v: 0..1 }, mat: x, ... }, leash: loose | tight | line, bg: in | street | yard |
//   park | trail | patio, say: a cue, yes: the marker, treat: 'mouth', path: an arrow, gx: ground slide.
//
// House rule, same as the lessons: only what the lesson teaches. No pushing a dog into position, no
// leash pops, no pulling by the collar, nothing unpleasant. Treats come after the marker.

const T = (dx = 6, dy = 2) => ({ at: 'nose', dx, dy, k: 'treat' })
const EAT = { k: 'treat', at: 'nose', dx: 2, dy: 6 }
const HOLD = { x: 128, y: 104, k: 'fist' }

const CARRY = ['bg', 'dog', 'dog2', 'person', 'helper', 'props', 'leash', 'hand', 'hand2', 'gx']
// Fills each beat in from the one before it.
export function expand(script) {
  const out = []
  let prev = { bg: script.bg || 'in', dog: { p: 'stand', x: 150, f: 1 }, person: { x: 262 }, props: {}, leash: script.leash || null, hand: null, gx: 0 }
  for (const b of script.beats) {
    const cur = {}
    for (const key of CARRY) cur[key] = key in b ? (b[key] && typeof b[key] === 'object' && !Array.isArray(b[key]) && prev[key] && typeof prev[key] === 'object' && key !== 'hand' && key !== 'hand2' ? { ...prev[key], ...b[key] } : b[key]) : prev[key]
    for (const key of ['say', 'yes', 'treat', 'path', 'walk', 'step', 'cap', 'ms', 'hold']) if (key in b) cur[key] = b[key]
    out.push(cur)
    prev = cur
  }
  return out
}

export const SCRIPTS = {
  // ---- Foundations ---------------------------------------------------------
  'name-response': { bg: 'in', beats: [
    { step: 0, cap: 'Say your dog\'s name once, in a happy voice.', dog: { p: 'sniff', x: 120, f: -1 }, say: '{name}!' },
    { step: 1, cap: 'The moment they look at you, mark it: "Yes!"', dog: { p: 'lookStand', f: 1 }, yes: true },
    { step: 1, cap: 'Then give a treat.', hand: T(), treat: 'mouth' },
    { step: 3, cap: 'Next time, reward by your leg so they come in close.', dog: { p: 'lookUp', x: 188 }, hand: EAT, treat: 'mouth' },
  ] },
  sit: { bg: 'in', beats: [
    { step: 0, cap: 'Hold a treat at your dog\'s nose.', dog: { p: 'stand', x: 150 }, hand: T(4, 0) },
    { step: 0, cap: 'Move it slowly up and back. The rear goes down on its own.', dog: { p: 'lookUp' }, hand: T(-2, -10), path: 'M218 92q-6-14-24-18', ms: 1300 },
    { step: 0, cap: 'As the rear touches the floor, mark: "Yes!"', yes: true },
    { step: 0, cap: 'Deliver the treat while your dog is still sitting.', hand: EAT, treat: 'mouth' },
    { step: 3, cap: 'Release with "Okay" and toss a treat so your dog gets up.', dog: { p: 'sniff', x: 120, f: -1 }, hand: null, props: { floorTreat: 70 }, say: 'Okay' },
  ] },
  down: { bg: 'in', beats: [
    { step: 0, cap: 'From a sit, hold a treat at your dog\'s nose.', dog: { p: 'sit', x: 140 }, hand: T(4, 0) },
    { step: 0, cap: 'Lower it straight down, then slowly out along the floor.', dog: { p: 'down' }, hand: T(14, 0), path: 'M204 76v54q2 26 18 30', ms: 1400 },
    { step: 1, cap: 'As the elbows touch the floor, mark "Yes!" and treat between the paws.', yes: true, hand: EAT, treat: 'mouth' },
    { step: 3, cap: 'Later the same movement with an empty hand is the signal: "Down".', dog: { p: 'down' }, hand: { at: 'nose', dx: 22, dy: -20, k: 'palm' }, say: 'Down' },
  ] },
  touch: { bg: 'in', beats: [
    { step: 0, cap: 'Hold your open palm a few inches from your dog\'s nose.', dog: { p: 'stand', x: 140 }, hand: { at: 'nose', dx: 20, dy: 0, k: 'palm' } },
    { step: 1, cap: 'The moment the nose touches your palm, mark "Yes!"', dog: { x: 152 }, yes: true },
    { step: 1, cap: 'Treat from your other hand.', hand: EAT, treat: 'mouth' },
    { step: 4, cap: 'Move your hand so your dog has to travel to it.', dog: { x: 168, p: 'lookStand' }, hand: { x: 222, y: 72, k: 'palm' }, say: 'Touch' },
  ] },
  'wait-at-doors': { bg: 'in', leash: 'loose', beats: [
    { step: 0, cap: 'On leash at a closed door, reach for the handle. Your dog stays put.', props: { door: { x: 250, v: 0 } }, person: { x: 222 }, dog: { p: 'stand', x: 118 }, hand: { x: 252, y: 104, k: 'fist' } },
    { step: 1, cap: 'Open it an inch. Still back? Mark "Yes!"', props: { door: { v: 0.2 } }, yes: true },
    { step: 2, cap: 'Open it wider in small steps, rewarding stillness each time.', props: { door: { v: 0.7 } }, dog: { p: 'sit' } },
    { step: 3, cap: 'Fully open, wait a second, then "Okay" and go through together.', props: { door: { v: 1 } }, dog: { p: 'stand', x: 178 }, say: 'Okay', ms: 1300 },
  ] },
  'settle-on-mat': { bg: 'in', beats: [
    { step: 0, cap: 'Put the mat down. Mark any interest in it, even a look.', props: { mat: 150 }, dog: { p: 'sniff', x: 80 }, yes: true },
    { step: 1, cap: 'Reward on the mat itself, so good things happen there.', dog: { p: 'stand', x: 138 }, hand: { at: 'floor', dx: 0, k: 'treat' } },
    { step: 2, cap: 'When your dog offers a down, feed treats between the paws.', dog: { p: 'down' }, hand: EAT, treat: 'mouth' },
    { step: 5, cap: 'Then reward calm: a sigh, a chin on the floor.', dog: { p: 'rest' }, hand: { at: 'floor', dx: 18, k: 'treat' } },
    { step: 6, cap: 'Release with "Okay" and end there.', dog: { p: 'stand', x: 110, f: -1 }, hand: null, say: 'Okay' },
  ] },

  // ---- Loose leash walking -------------------------------------------------
  'leash-attention': { bg: 'street', leash: 'loose', beats: [
    { step: 0, cap: 'Stand still with your dog on leash. Say nothing and wait.', person: { x: 110 }, dog: { p: 'sniff', x: 176 }, hand: HOLD },
    { step: 1, cap: 'The moment your dog glances at your face, mark "Yes!"', dog: { p: 'lookStand' }, yes: true },
    { step: 1, cap: 'Treat by your leg.', dog: { p: 'stand', x: 94 }, hand: EAT, treat: 'mouth', ms: 1300 },
    { step: 4, cap: 'Start walking. Mark and treat each look your way.', gx: 160, walk: true, dog: { p: 'lookStand' }, hand: HOLD, yes: true, ms: 1800 },
  ] },
  'walk-beside': { bg: 'street', leash: 'loose', beats: [
    { step: 0, cap: 'Pick a side. Feed a few treats right at the seam of your pants.', person: { x: 110 }, dog: { p: 'stand', x: 94 }, hand: EAT, treat: 'mouth' },
    { step: 2, cap: 'Take a step. Still beside you on a loose leash? Mark and treat at your leg.', gx: 120, walk: true, hand: HOLD, yes: true, ms: 1800 },
    { step: 3, cap: 'If the leash goes tight, stop and stand still. No tugging.', dog: { x: 214 }, leash: 'tight', ms: 1200 },
    { step: 3, cap: 'When your dog turns back and the leash goes slack, mark and reward beside you.', dog: { x: 94, p: 'lookStand' }, leash: 'loose', yes: true, ms: 1300 },
    { step: 5, cap: 'Add a "Go sniff" break. Sniffing is part of the reward.', dog: { x: 196, p: 'sniff' }, say: 'Go sniff', ms: 1300 },
  ] },
  'turns-and-stops': { bg: 'street', leash: 'loose', beats: [
    { step: 0, cap: 'Walk a few steps with your dog beside you.', person: { x: 110 }, dog: { p: 'stand', x: 94 }, hand: HOLD, gx: 120, walk: true, ms: 1800 },
    { step: 0, cap: 'Slow down and stop. Mark and treat when your dog stops too.', yes: true, hand: EAT, treat: 'mouth' },
    { step: 1, cap: 'Wait at the stop, and reward a sit if it is offered.', dog: { p: 'lookUp', x: 100 }, hand: EAT, treat: 'mouth' },
    { step: 2, cap: 'Say "This way", turn, and reward as your dog catches up.', person: { f: -1, x: 160 }, dog: { p: 'stand', f: -1, x: 176 }, hand: { x: 170, y: 104, k: 'fist' }, gx: 40, walk: true, say: 'This way', ms: 1800 },
  ] },
  'pass-distractions': { bg: 'street', leash: 'loose', beats: [
    { step: 0, cap: 'Start far enough away that your dog can still take treats.', props: { bike: 300 }, person: { x: 110 }, dog: { p: 'stand', x: 94 }, hand: HOLD },
    { step: 1, cap: 'When your dog notices it, mark the look and feed by your leg.', dog: { p: 'lookStand' }, yes: true },
    { step: 2, cap: 'Walk a wide arc past it, feeding every two steps.', props: { bike: 170 }, gx: 140, walk: true, dog: { p: 'stand' }, hand: EAT, treat: 'mouth', ms: 2200 },
    { step: 4, cap: 'Once past, say "Go sniff" and let your dog relax.', props: { bike: 20 }, gx: 280, walk: true, dog: { p: 'sniff', x: 170 }, hand: HOLD, say: 'Go sniff', ms: 1800 },
  ] },
  'polite-greeting': { bg: 'street', leash: 'loose', beats: [
    { step: 0, cap: 'A helper walks toward you. Feed low while all four paws stay down.', helper: { x: -10 }, person: { x: 296 }, dog: { p: 'stand', x: 214 }, hand: EAT, treat: 'mouth' },
    { step: 0, cap: 'Keep feeding low as the helper gets closer.', helper: { x: 60 }, ms: 1500 },
    { step: 2, cap: 'Four paws down? The helper offers a hand to sniff.', helper: { x: 96 }, hand: { x: 280, y: 104, k: 'fist' }, hand2: { x: 136, y: 112, k: 'palm' }, dog: { x: 214, f: -1 } },
    { step: 4, cap: 'After three seconds, call your dog back and reward.', hand2: null, dog: { p: 'lookUp', f: 1, x: 226 }, hand: EAT, treat: 'mouth' },
  ] },

  // ---- Recall ---------------------------------------------------------------
  'come-indoors': { bg: 'in', beats: [
    { step: 0, cap: 'Say "Come" once in a bright voice and step back.', dog: { p: 'sniff', x: 86, f: -1 }, person: { x: 276 }, say: 'Come!' },
    { step: 1, cap: 'As your dog moves toward you, mark "Yes!"', dog: { p: 'run', f: 1, x: 150 }, yes: true, ms: 1300 },
    { step: 1, cap: 'When they arrive, feed three treats, one after another.', dog: { p: 'lookUp', x: 206 }, hand: EAT, treat: 'mouth' },
    { step: 2, cap: 'Touch the collar gently while you feed.', hand: { at: 'nose', dx: -34, dy: 14, k: 'palm' } },
    { step: 3, cap: 'Say "Okay" and let them go back to what they were doing.', dog: { p: 'stand', f: -1, x: 90 }, hand: null, say: 'Okay', ms: 1400 },
  ] },
  'come-in-yard': { bg: 'yard', beats: [
    { step: 0, cap: 'Let your dog sniff around. Wait for a moment when they are not busy.', props: { fence: true }, dog: { p: 'sniff', x: 86, f: -1 } },
    { step: 1, cap: 'Call once and jog a few steps away. Mark the turn.', dog: { p: 'lookStand', f: 1 }, person: { x: 290 }, say: 'Come!', yes: true, ms: 1300 },
    { step: 1, cap: 'Feed a small jackpot when your dog arrives.', dog: { p: 'lookUp', x: 234 }, hand: EAT, treat: 'mouth', ms: 1500 },
    { step: 2, cap: 'Release with "Go play". Coming to you does not end the fun.', dog: { p: 'run', f: -1, x: 80 }, hand: null, say: 'Go play', ms: 1500 },
  ] },
  'long-line-recall': { bg: 'park', leash: 'line', beats: [
    { step: 0, cap: 'Clip the long line to a harness. Let it trail loosely.', dog: { p: 'sniff', x: 62, harness: true }, hand: { x: 244, y: 106, k: 'fist' } },
    { step: 1, cap: 'Call "Come" once and move backward.', dog: { p: 'lookStand' }, person: { x: 286 }, hand: { x: 268, y: 106, k: 'fist' }, say: 'Come!' },
    { step: 2, cap: 'Mark the turn, then pay a jackpot at your feet.', dog: { p: 'lookUp', x: 222 }, yes: true, ms: 1500 },
    { step: 2, cap: 'Then say "Go sniff". Build the distance over several sessions.', hand: { x: 268, y: 106, k: 'fist' }, dog: { p: 'sniff', x: 96, f: -1 }, say: 'Go sniff', ms: 1500 },
  ] },
  'recall-from-distraction': { bg: 'park', leash: 'line', beats: [
    { step: 0, cap: 'A helper stands away from you holding a boring toy.', helper: { x: 30 }, hand2: { x: 56, y: 104, k: 'toy' }, dog: { p: 'lookStand', x: 136, f: -1, harness: true }, hand: { x: 244, y: 106, k: 'fist' } },
    { step: 1, cap: 'Before your dog reaches it, call once and move away. The toy is hidden.', hand2: null, person: { x: 288 }, hand: { x: 270, y: 106, k: 'fist' }, say: 'Come!' },
    { step: 2, cap: 'Mark the turn and pay with the best reward you have.', dog: { p: 'lookUp', x: 230, f: 1 }, yes: true, ms: 1500 },
    { step: 2, cap: 'Then send your dog to "Go see" the helper as a bonus.', dog: { p: 'run', x: 112, f: -1 }, hand2: { x: 74, y: 120, k: 'palm' }, say: 'Go see', ms: 1500 },
  ] },
  'emergency-recall': { bg: 'in', beats: [
    { step: 1, cap: 'With your dog beside you, say the special word once.', dog: { p: 'lookUp', x: 210 }, say: 'Pronto!' },
    { step: 1, cap: 'Then feed tiny pieces one at a time, for about 20 seconds.', hand: EAT, treat: 'mouth' },
    { step: 3, cap: 'After a week, say it when your dog is across the room.', dog: { p: 'sniff', x: 86, f: -1 }, hand: null, say: 'Pronto!' },
    { step: 3, cap: 'Party when they arrive. Keep the word special.', dog: { p: 'lookUp', x: 210, f: 1 }, hand: EAT, treat: 'mouth', ms: 1500 },
  ] },

  // ---- Out and about ---------------------------------------------------------
  'patio-settle': { bg: 'patio', beats: [
    { step: 2, cap: 'Put the mat down beside your chair and cue "Settle".', props: { table: 44, mat: 126 }, person: { x: 262, seat: true }, dog: { p: 'stand', x: 110 }, say: 'Settle' },
    { step: 2, cap: 'Feed several treats low, between the paws.', dog: { p: 'down' }, hand: EAT, treat: 'mouth' },
    { step: 3, cap: 'Reward calm every 10 to 20 seconds. Then offer a long chew.', dog: { p: 'rest' }, props: { chew: 180 }, hand: null },
    { step: 4, cap: 'Keep the first visit short and leave while it is going well.', dog: { p: 'rest' } },
  ] },
  'leave-it': { bg: 'in', beats: [
    { step: 0, cap: 'Hold a boring treat in a closed fist. Let your dog sniff. Say nothing.', dog: { p: 'sniff', x: 150 }, hand: { at: 'nose', dx: 8, dy: 4, k: 'fist' } },
    { step: 1, cap: 'The moment they pull back or look away, mark "Yes!"', dog: { p: 'lookStand' }, yes: true },
    { step: 1, cap: 'Reward from your other hand with a better treat.', hand: EAT, treat: 'mouth' },
    { step: 5, cap: 'Later, drop a treat on leash. Reward from your hand, never the floor.', leash: 'loose', props: { floorTreat: 214 }, dog: { p: 'lookStand', x: 150 }, hand: EAT, treat: 'mouth', say: 'Leave it' },
  ] },
  'calm-around-dogs': { bg: 'park', leash: 'loose', beats: [
    { step: 0, cap: 'Start far enough away that your dog notices dogs but can still eat.', person: { x: 120 }, dog: { p: 'stand', x: 78 }, hand: { x: 104, y: 104, k: 'fist' }, dog2: { p: 'stand', x: 340, f: -1, sc: 0.6 } },
    { step: 1, cap: 'Each time your dog looks at another dog, mark "Yes!" and feed.', dog2: { x: 286 }, dog: { p: 'lookStand' }, yes: true, ms: 1800 },
    { step: 2, cap: 'Soon your dog looks, then looks back at you. Mark that and pay well.', dog: { look: 'back' }, hand: EAT, treat: 'mouth', dog2: { x: 250 } },
    { step: 4, cap: 'Practise walking away too: "Let\'s go", turn, and reward.', person: { f: -1 }, dog: { f: -1, look: null, p: 'stand', x: 92 }, hand: { x: 128, y: 104, k: 'fist' }, gx: -120, walk: true, dog2: { x: 200 }, say: 'Let\'s go', ms: 1800 },
  ] },
  'car-loading': { bg: 'street', leash: 'loose', beats: [
    { step: 0, cap: 'Car parked and off. Reward calm standing beside the open door.', props: { car: 222 }, person: { x: 86 }, dog: { p: 'stand', x: 150 }, hand: EAT, treat: 'mouth' },
    { step: 1, cap: 'Say "Load up" and toss a treat into the car.', hand: { x: 120, y: 100, k: 'fist' }, props: { floorTreat: { x: 276, y: -52 } }, say: 'Load up' },
    { step: 2, cap: 'Help or lift your dog if it is high. Reward a sit inside.', dog: { p: 'sit', x: 266, y: -52 }, props: { floorTreat: false }, leash: null, hand: null, yes: true, ms: 1400 },
    { step: 3, cap: 'To get out: leash on first, every time. Reward staying put.', person: { x: 190 }, leash: 'loose', hand: { x: 282, y: 52, k: 'fist' } },
    { step: 4, cap: 'Say "Okay". Reward four paws on the ground beside you.', dog: { p: 'lookUp', x: 150, y: 0 }, person: { x: 222 }, hand: EAT, treat: 'mouth', say: 'Okay', ms: 1400 },
  ] },
  'elevator-stairs': { bg: 'in', leash: 'loose', beats: [
    { step: 0, cap: 'On a short flight, take one step. Reward staying level with you.', props: { stairs: 100 }, person: { x: 206, y: -62 }, dog: { p: 'stand', x: 150, y: -33, r: -24 }, hand: { x: 176, y: 58, k: 'fist' } },
    { step: 1, cap: 'Build to the whole flight at walking pace, pausing on landings.', person: { x: 262, y: -86 }, dog: { x: 206, y: -57 }, hand: { x: 232, y: 32, k: 'fist' }, ms: 1600 },
    { step: 2, cap: 'At an elevator, stand to one side of the doors. Ask for a sit.', props: { stairs: false, elevator: { x: 226, v: 0 } }, person: { x: 98, y: 0 }, dog: { p: 'sit', x: 150, y: 0, r: 0 }, hand: { x: 124, y: 100, k: 'fist' } },
    { step: 3, cap: 'Let people out first. Reward waiting while the doors open.', props: { elevator: { v: 1 } }, yes: true },
    { step: 4, cap: 'Inside, keep your dog close and feed every few seconds.', person: { x: 296 }, dog: { p: 'sit', x: 250 }, hand: EAT, treat: 'mouth', ms: 1500 },
  ] },

  // ---- Trail and park ---------------------------------------------------------
  'trail-check-ins': { bg: 'trail', leash: 'line', beats: [
    { step: 0, cap: 'Walk a quiet trail on a long line. Say nothing and keep moving.', person: { x: 70 }, dog: { p: 'stand', x: 210, harness: true }, hand: { x: 90, y: 104, k: 'fist' }, gx: 140, walk: true, ms: 1800 },
    { step: 1, cap: 'Whenever your dog looks back at you, mark and toss a treat.', dog: { p: 'lookStand', look: 'back' }, yes: true, props: { floorTreat: 176 } },
    { step: 3, cap: 'Now and then, step behind a tree. Celebrate when your dog finds you.', props: { floorTreat: false, tree: 66 }, dog: { p: 'run', f: -1, look: null, x: 150 }, hand: { x: 92, y: 104, k: 'fist' }, ms: 1500 },
    { step: 4, cap: 'Pay every check-in at first, then every second or third.', props: { tree: false }, dog: { p: 'lookUp', x: 128 }, hand: EAT, treat: 'mouth' },
  ] },
  'wait-at-junctions': { bg: 'trail', leash: 'loose', beats: [
    { step: 0, cap: 'A few steps before a junction, say "Wait" and stop.', props: { post: 292 }, person: { x: 130 }, dog: { p: 'stand', x: 124 }, hand: { x: 150, y: 104, k: 'fist' }, gx: 100, walk: true, say: 'Wait', ms: 1800 },
    { step: 1, cap: 'Mark and treat when your dog stops.', yes: true, hand: EAT, treat: 'mouth' },
    { step: 1, cap: 'Feed a second treat for staying while you look both ways.', dog: { p: 'lookStand' }, hand: EAT, treat: 'mouth' },
    { step: 2, cap: 'Say "This way" and go on together.', hand: { x: 150, y: 104, k: 'fist' }, dog: { p: 'stand' }, props: { post: 150 }, gx: 240, walk: true, say: 'This way', ms: 1800 },
  ] },
  'leave-wildlife': { bg: 'park', leash: 'line', beats: [
    { step: 1, cap: 'Spot wildlife first. When your dog sees it far off, mark the look.', props: { squirrel: 296 }, person: { x: 70 }, dog: { p: 'lookStand', x: 150, harness: true }, hand: { x: 92, y: 104, k: 'fist' }, yes: true },
    { step: 1, cap: 'Feed by your leg.', dog: { x: 110, look: 'back' }, hand: EAT, treat: 'mouth' },
    { step: 2, cap: 'Say "Leave it", then "This way", and move off in another direction.', person: { f: -1 }, dog: { f: -1, look: null, p: 'stand', x: 120 }, hand: { x: 92, y: 104, k: 'fist' }, gx: -120, walk: true, say: 'Leave it', ms: 1800 },
    { step: 3, cap: 'Then give an outlet: a tossed treat to chase, or "Go sniff".', props: { squirrel: false, floorTreat: 44 }, dog: { p: 'sniff', x: 104 }, hand: { x: 118, y: 104, k: 'fist' } },
  ] },
  'water-safety': { bg: 'park', leash: 'line', beats: [
    { step: 1, cap: 'On a long line, say "Wait" a few steps before the edge. Reward the stop.', props: { water: 226 }, person: { x: 62 }, dog: { p: 'stand', x: 150, harness: true }, hand: { x: 84, y: 104, k: 'fist' }, say: 'Wait', yes: true },
    { step: 2, cap: 'Say "Okay, swim" and let your dog wade in. Stay close.', person: { x: 150 }, hand: { x: 172, y: 104, k: 'fist' }, dog: { x: 252, y: 16 }, say: 'Okay, swim', ms: 1600 },
    { step: 3, cap: 'After a minute, call "Come" and pay well on the bank.', person: { x: 90 }, dog: { p: 'lookUp', x: 170, y: 0, f: -1 }, hand: EAT, treat: 'mouth', say: 'Come', ms: 1600 },
    { step: 5, cap: 'Offer fresh water, and take breaks in the shade.', props: { bowl: 206, tree: 40 }, person: { x: 96 }, dog: { p: 'sniff', x: 150, f: 1 }, hand: null },
  ] },
  'pack-out': { bg: 'trail', leash: 'loose', beats: [
    { step: 0, cap: 'Pick up every time and carry the bag out. Reward a "Wait".', dog: { p: 'sit', x: 150 }, hand: { x: 228, y: 120, k: 'bag' }, say: 'Wait' },
    { step: 1, cap: 'At the car, ask for a "Wait" and reward holding still.', bg: 'street', props: { car: 250 }, person: { x: 214 }, dog: { p: 'stand', x: 128 }, hand: EAT, treat: 'mouth' },
    { step: 2, cap: 'Run your hands over each leg and paw. A treat for each part.', hand: { x: 152, y: 150, k: 'palm' } },
    { step: 3, cap: 'Wipe paws with the towel, a treat for each paw.', hand: { x: 120, y: 160, k: 'towel' } },
    { step: 4, cap: 'Offer water, then "Load up". The same order every time.', props: { bowl: 200 }, dog: { p: 'sniff', x: 134 }, hand: null, say: 'Load up' },
  ] },

  // ---- Tricks and fun ---------------------------------------------------------
  spin: { bg: 'in', beats: [
    { step: 0, cap: 'With your dog standing, hold a treat at their nose.', dog: { p: 'stand', x: 140 }, hand: T(4, 0) },
    { step: 0, cap: 'Draw a slow, wide circle at nose height.', dog: { f: -1 }, hand: { x: 100, y: 96, k: 'treat' }, path: 'M206 96q-30 22-80 4', ms: 1400 },
    { step: 1, cap: 'As your dog completes the circle, mark "Yes!" and treat.', dog: { f: 1 }, hand: T(4, 0), yes: true, ms: 1400 },
    { step: 3, cap: 'Later, a small swirl of one finger is enough: "Spin".', hand: { x: 214, y: 70, k: 'point' }, dog: { p: 'lookStand' }, say: 'Spin' },
  ] },
  paw: { bg: 'in', beats: [
    { step: 0, cap: 'With your dog sitting, hold a treat in a closed fist at chest height.', dog: { p: 'sit', x: 150 }, hand: { at: 'chest', dx: 16, dy: 0, k: 'fist' } },
    { step: 1, cap: 'The moment a paw lifts, mark "Yes!", open your hand and treat.', dog: { p: 'pawUp' }, yes: true },
    { step: 2, cap: 'Next, offer an open palm. Mark when the paw lands on it.', hand: { at: 'chest', dx: 18, dy: 4, k: 'palm' } },
    { step: 3, cap: 'Say "Paw" as you offer your hand. Your dog places it, you never grab it.', say: 'Paw', yes: true },
  ] },
  bow: { bg: 'in', beats: [
    { step: 0, cap: 'With your dog standing, hold a treat at their nose.', dog: { p: 'stand', x: 140 }, hand: T(4, 0) },
    { step: 0, cap: 'Lower it slowly toward the floor, slightly back toward the chest.', dog: { p: 'bow' }, hand: T(0, 4), path: 'M208 92q4 40-8 58', ms: 1400 },
    { step: 1, cap: 'Elbows bend, rear still up: mark "Yes!" quickly, and treat.', yes: true, hand: EAT, treat: 'mouth' },
    { step: 4, cap: 'Fade to an empty hand sweeping down, then add the word "Bow".', dog: { p: 'bow' }, hand: { at: 'nose', dx: 24, dy: -14, k: 'palm' }, say: 'Bow' },
  ] },
  'roll-over': { bg: 'in', beats: [
    { step: 0, cap: 'From a down on a rug, move a treat from the nose toward the shoulder.', props: { mat: 150 }, dog: { p: 'down', x: 150, look: 'back' }, hand: { x: 168, y: 120, k: 'treat' } },
    { step: 1, cap: 'Keep it moving over the shoulder blade. Your dog flops onto their side.', dog: { p: 'side', look: null }, hand: { x: 150, y: 128, k: 'treat' }, yes: true, ms: 1400 },
    { step: 2, cap: 'Continue the arc over the back so your dog rolls right over.', dog: { p: 'down', r: 180, y: -26 }, hand: { x: 116, y: 104, k: 'treat' }, path: 'M190 120q-40-34-80 0', ms: 1400 },
    { step: 2, cap: 'Back in a down: jackpot the first full roll.', dog: { p: 'down', r: 360, y: 0 }, hand: EAT, treat: 'mouth', yes: true, ms: 1400 },
    { step: 5, cap: 'Fade to a small circle of one finger, then add "Roll over".', hand: { x: 210, y: 90, k: 'point' }, say: 'Roll over' },
  ] },
  'hold-object': { bg: 'in', beats: [
    { step: 0, cap: 'Offer the object. Mark and treat any interest, even a sniff.', dog: { p: 'lookStand', x: 150 }, hand: { at: 'nose', dx: 14, dy: 6, k: 'toy' }, yes: true },
    { step: 2, cap: 'Mouth closes on it? Mark right away so it drops into your hand.', dog: { p: 'stand', carry: 'toy' }, hand: { at: 'nose', dx: 6, dy: 18, k: 'palm' }, yes: true },
    { step: 3, cap: 'Build the hold in tiny steps: half a second, then one second.', hand: { x: 236, y: 120, k: 'fist' } },
    { step: 4, cap: 'Say "Thank you" as your hand goes under it, then treat.', dog: { carry: null }, hand: { at: 'nose', dx: 0, dy: 14, k: 'toy' }, say: 'Thank you' },
  ] },
  'tidy-toys': { bg: 'in', beats: [
    { step: 1, cap: 'Basket right under your dog\'s chin. Hold a treat above it.', props: { box: 196 }, dog: { p: 'sit', x: 150, carry: 'toy' }, hand: { x: 200, y: 96, k: 'treat' } },
    { step: 1, cap: 'As the toy drops in, mark "Yes!" and treat.', dog: { carry: null }, props: { toy: { x: 196, y: -18 } }, yes: true, hand: EAT, treat: 'mouth' },
    { step: 3, cap: 'Put the toy right beside the basket. Pay for picking it up and dropping it in.', props: { toy: { x: 162, y: 0 } }, dog: { p: 'sniff', x: 100 }, hand: null },
    { step: 5, cap: 'Move it farther away, and say "Tidy up" as your dog heads for it.', props: { toy: false }, dog: { p: 'stand', x: 140, carry: 'toy' }, say: 'Tidy up', ms: 1400 },
  ] },
}

export const scriptFor = (skillId) => (SCRIPTS[skillId] ? expand(SCRIPTS[skillId]) : null)
