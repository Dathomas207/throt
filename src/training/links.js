// Ways out of Trot for a lesson: a YouTube search, free articles from training and animal welfare
// organizations, and directories of certified trainers. Plain data and pure functions, no imports, so
// server/training-extras.test.js can check the shape.
//
// Every article and directory address below was opened by hand on the date in `checked` and was a live
// page about that skill. A skill with no page we could check has no article link. Trot is not
// affiliated with any of these organizations, and none of them reviewed Trot.

export const LINKS_CHECKED = '2026-11-28'

// One search per skill, worded for reward-based methods. A search never breaks and names no creator.
const QUERY = {
  'name-response': 'teach a dog to respond to its name positive reinforcement',
  sit: 'teach a dog to sit positive reinforcement',
  down: 'teach a dog to lie down positive reinforcement lure',
  touch: 'teach a dog hand target touch positive reinforcement',
  'wait-at-doors': 'teach a dog to wait at the door positive reinforcement',
  'settle-on-mat': 'teach a dog to settle on a mat relaxation positive reinforcement',
  'leash-attention': 'teach a dog to check in on leash positive reinforcement',
  'walk-beside': 'loose leash walking positive reinforcement',
  'turns-and-stops': 'loose leash walking turns and stops positive reinforcement',
  'pass-distractions': 'walk a dog past distractions positive reinforcement',
  'polite-greeting': 'teach a dog to greet people without jumping positive reinforcement',
  'come-indoors': 'teach a dog to come when called indoors positive reinforcement',
  'come-in-yard': 'recall training in the yard positive reinforcement',
  'long-line-recall': 'long line recall training positive reinforcement',
  'recall-from-distraction': 'recall away from distractions positive reinforcement',
  'emergency-recall': 'emergency recall cue dog positive reinforcement',
  'patio-settle': 'teach a dog to settle at a restaurant patio positive reinforcement',
  'leave-it': 'teach a dog leave it positive reinforcement',
  'calm-around-dogs': 'look at that game dog calm around other dogs positive reinforcement',
  'car-loading': 'teach a dog to get in and out of the car calmly positive reinforcement',
  'elevator-stairs': 'dog elevator and stairs manners positive reinforcement',
  'trail-check-ins': 'teach a dog to check in on hikes positive reinforcement',
  'wait-at-junctions': 'teach a dog to wait on cue on walks positive reinforcement',
  'leave-wildlife': 'teach a dog not to chase squirrels positive reinforcement',
  'water-safety': 'introduce a dog to swimming safely',
  'pack-out': 'dog paw and tick check after a hike cooperative care',
  spin: 'teach a dog to spin trick positive reinforcement',
  paw: 'teach a dog paw shake trick positive reinforcement',
  bow: 'teach a dog to bow trick positive reinforcement',
  'roll-over': 'teach a dog to roll over trick positive reinforcement lure',
  'hold-object': 'teach a dog to hold an object positive reinforcement',
  'tidy-toys': 'teach a dog to put toys away in a basket positive reinforcement',
}
export const searchQuery = (skillId) => QUERY[skillId] || null
export const videoSearchUrl = (skillId) => (QUERY[skillId] ? `https://www.youtube.com/results?search_query=${encodeURIComponent(QUERY[skillId])}` : null)

const AKC = 'American Kennel Club', BF = 'Best Friends Animal Society', VCA = 'VCA Animal Hospitals', BAT = 'Battersea'
const A = (source, title, url) => ({ source, title, url, checked: LINKS_CHECKED })

// One or two free articles per skill, each opened and read on LINKS_CHECKED.
export const ARTICLES = {
  'name-response': [A(AKC, 'How to Teach Your Dog Their Name', 'https://www.akc.org/expert-advice/training/how-to-teach-dog-name/'), A(BF, 'How to Teach a Dog Their Name', 'https://bestfriends.org/pet-care-resources/how-teach-dog-their-name')],
  sit: [A(AKC, 'Teach Your Dog to Sit', 'https://www.akc.org/expert-advice/training/teach-your-dog-to-sit/')],
  down: [A(AKC, 'How to Teach Your Dog to Lie Down', 'https://www.akc.org/expert-advice/training/teach-your-dog-to-lie-down/')],
  touch: [A(AKC, 'How to Teach Targeting to Your Dog', 'https://www.akc.org/expert-advice/training/teaching-targeting-to-your-dog/')],
  'wait-at-doors': [A(AKC, 'How to Teach Your Dog to Wait at Doorways', 'https://www.akc.org/expert-advice/training/teaching-wait-at-the-door/')],
  'settle-on-mat': [A(AKC, 'How to Teach Your Dog to Go to Their Place', 'https://www.akc.org/expert-advice/training/teaching-go-to-your-place/'), A(VCA, 'Teaching Settle and Calm', 'https://vcahospitals.com/know-your-pet/dog-behavior-and-training-teaching-calm-soft-and-handling-exercises')],
  'leash-attention': [A(AKC, 'The "Watch Me" Cue', 'https://www.akc.org/expert-advice/training/dogs-attention-look-command/'), A('Whole Dog Journal', 'Train Your Dog to Check In', 'https://www.whole-dog-journal.com/training/train-your-dog-to-check-in/')],
  'walk-beside': [A(VCA, 'Controlling Pulling on Walks', 'https://vcahospitals.com/know-your-pet/controlling-pulling-on-walks'), A(AKC, 'How to Teach a Puppy to Walk on a Leash', 'https://www.akc.org/expert-advice/training/teach-puppy-walk-leash/')],
  'pass-distractions': [A(AKC, 'Training Your Dog to Ignore Distractions', 'https://www.akc.org/expert-advice/training/tips-for-walking-your-distracted-dog/')],
  'polite-greeting': [A(AKC, 'How to Stop Your Dog From Jumping Up on People', 'https://www.akc.org/expert-advice/training/how-to-stop-your-dog-from-jumping-up-on-people/')],
  'come-indoors': [A(AKC, 'How to Train Your Dog to Come When Called', 'https://www.akc.org/expert-advice/training/teach-your-dog-to-come-when-called/'), A(BF, 'How to Train Your Dog to Come', 'https://bestfriends.org/pet-care-resources/how-train-your-dog-come')],
  'come-in-yard': [A('RSPCA Australia', 'How can I teach my dog recall?', 'https://kb.rspca.org.au/knowledge-base/how-can-i-teach-my-dog-recall-to-come-when-called/'), A(BF, 'How to Train Your Dog to Come', 'https://bestfriends.org/pet-care-resources/how-train-your-dog-come')],
  'long-line-recall': [A(BAT, 'How to use a long-line lead', 'https://www.battersea.org.uk/pet-advice/dog-advice/how-use-long-line-lead'), A(AKC, 'How to Train a Reliable Recall', 'https://www.akc.org/expert-advice/training/reliable-recall-train-dogs-to-come-when-called/')],
  'recall-from-distraction': [A(AKC, 'How to Train a Reliable Recall', 'https://www.akc.org/expert-advice/training/reliable-recall-train-dogs-to-come-when-called/')],
  'emergency-recall': [A('Preventive Vet', 'How to Teach Your Dog the Emergency Recall', 'https://www.preventivevet.com/dogs/teach-your-dog-the-emergency-recall-come')],
  'patio-settle': [A(AKC, 'Is Your Dog Ready to Go to a Restaurant?', 'https://www.akc.org/expert-advice/training/how-to-know-if-my-dog-is-ready-for-a-restaurant/')],
  'leave-it': [A(AKC, 'Teaching "Leave It"', 'https://www.akc.org/expert-advice/training/teach-leave-it/')],
  'calm-around-dogs': [A(BF, '"Look at That" Training', 'https://bestfriends.org/pet-care-resources/look-lat-training-reactive-dogs'), A(AKC, 'How to Stop a Dog From Lunging on a Leash', 'https://www.akc.org/expert-advice/training/why-does-my-friendly-dog-bark-and-lunge-at-other-dogs-on-leash/')],
  'car-loading': [A(AKC, 'Teach Your Dog to Ride in the Car', 'https://www.akc.org/expert-advice/travel/teach-dog-ride-car-prevent-anxiety/')],
  'trail-check-ins': [A('Whole Dog Journal', 'Train Your Dog to Check In', 'https://www.whole-dog-journal.com/training/train-your-dog-to-check-in/'), A(AKC, 'Hiking With Your Dog', 'https://www.akc.org/expert-advice/lifestyle/tips-for-hiking-with-your-dog/')],
  'leave-wildlife': [A(AKC, 'How to Channel Your Dog\'s Prey Drive on Walks', 'https://www.akc.org/expert-advice/training/how-to-channel-your-dogs-predatory-instincts-on-walks/')],
  'water-safety': [A(AKC, 'Can All Dogs Swim? How to Teach a Dog to Swim', 'https://www.akc.org/expert-advice/health/can-all-dogs-swim-safety-and-training-tips-for-dog-swimming/')],
  'pack-out': [A(AKC, 'Hiking With Your Dog', 'https://www.akc.org/expert-advice/lifestyle/tips-for-hiking-with-your-dog/'), A('American Animal Hospital Association', '10 Safety Tips for Hiking with Your Dog', 'https://www.aaha.org/your-pet/pet-owner-education/ask-aaha/10-safety-tips-for-hiking-with-your-dog/')],
  spin: [A(AKC, 'How to Teach Your Dog to Spin Around', 'https://www.akc.org/expert-advice/training/teach-your-dog-to-spin-around/')],
  paw: [A(AKC, 'How to Teach Your Dog to Shake Hands', 'https://www.akc.org/expert-advice/training/how-to-teach-your-dog-to-shake-hands/')],
  bow: [A(AKC, 'Teach Your Dog to Bow', 'https://www.akc.org/expert-advice/training/teach-your-dog-to-bow/')],
  'roll-over': [A(AKC, 'How to Teach a Dog to Roll Over', 'https://www.akc.org/expert-advice/training/how-to-teach-a-dog-to-roll-over/')],
  'hold-object': [A(BAT, 'Teach your dog to hold an item', 'https://www.battersea.org.uk/pet-advice/dog-advice/teach-your-dog-hold-item')],
  'tidy-toys': [A(AKC, 'Teach Your Dog to Clean Up Their Toys', 'https://www.akc.org/expert-advice/training/trick-teach-dog-clean-up-toys/')],
}
export const articlesFor = (skillId) => ARTICLES[skillId] || []

// Directories run by the credentialing organizations themselves. `means` is one plain sentence on what
// the credential says about a person, and nothing more.
export const DIRECTORIES = [
  { id: 'ccpdt', name: 'CCPDT', full: 'Certification Council for Professional Dog Trainers', url: 'https://www.ccpdt.org/dog-owners/', checked: LINKS_CHECKED,
    means: 'CPDT-KA trainers passed an independent exam on dog training knowledge, and CPDT-KSA trainers also passed a hands-on skills assessment.' },
  { id: 'iaabc', name: 'IAABC', full: 'International Association of Animal Behavior Consultants', url: 'https://iaabc.org/consultant', checked: LINKS_CHECKED,
    means: 'Lists certified members who work on behavior problems as well as training, which helps with worry, reactivity or other harder cases.' },
  { id: 'kpa', name: 'Karen Pryor Academy', full: 'Karen Pryor Academy Certified Training Partners', url: 'https://karenpryoracademy.com/find-a-trainer/', checked: LINKS_CHECKED,
    means: 'A KPA Certified Training Partner finished the academy\'s dog trainer program and showed both knowledge and hands-on skill in reward-based training.' },
  { id: 'fearfree', name: 'Fear Free', full: 'Fear Free directory', url: 'https://directory.fearfree.com/', checked: LINKS_CHECKED,
    means: 'Fear Free certified professionals took training on lowering fear, anxiety and stress, so they watch how a dog feels as well as what it does.' },
  { id: 'acvb', name: 'ACVB', full: 'American College of Veterinary Behaviorists', url: 'https://www.dacvb.org/search/custom.asp?id=5985', checked: LINKS_CHECKED,
    means: 'Veterinary behaviorists are veterinarians with specialist board certification in behavior, the right call for fear, aggression or distress when left alone.' },
]

// Does a place from Trot's own index say it trains dogs? Reads the category and the listing's own words.
// A note that only cites a trainer as a source ("a local trainer's guide") does not count.
const TRAINS = /\b(training|obedience|dog trainer)\b/i
export function isTrainerPlace(p) {
  if (!p || typeof p !== 'object') return false
  const text = `${p.name || ''}. ${p.note || ''}`
  if (!TRAINS.test(text)) return false
  // Only listings that say where they are or where the listing came from.
  return !!((p.address && String(p.address).trim()) || p.sourceUrl)
}
// What kind of listing it is, from its own words: a trainer first, a daycare that also trains, or a bar or
// shop that runs classes.
export const trainerKind = (p) => (/^\s*dog train(ing|er)\b/i.test(p.note || '') ? 'Trainer' : p.category === 'care' ? 'Daycare with training' : 'Also offers training')
