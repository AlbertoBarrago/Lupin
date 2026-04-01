const SPECIES = [
  'duck',
  'goose',
  'blob',
  'cat',
  'dragon',
  'octopus',
  'owl',
  'penguin',
  'turtle',
  'snail',
  'ghost',
  'axolotl',
  'capybara',
  'cactus',
  'robot',
  'rabbit',
  'mushroom',
  'chonk',
]

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary']
const RARITY_WEIGHTS = [60, 25, 10, 4, 1]
const PERSONALITIES = [
  'chaotic helper',
  'silent genius',
  'tiny philosopher',
  'snarky debugger',
  'optimistic builder',
]

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function hashString(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}

function rollRarity(rng) {
  const total = RARITY_WEIGHTS.reduce((a, b) => a + b, 0)
  let roll = rng() * total
  for (let i = 0; i < RARITIES.length; i++) {
    roll -= RARITY_WEIGHTS[i]
    if (roll < 0) return RARITIES[i]
  }
  return 'common'
}

function xpToNext(level) {
  return 100 + Math.max(0, level - 1) * 20
}

export function hatchCompanion(name = 'Melky', seedSource = 'local-user') {
  const seed = `${seedSource}:${Date.now()}:${Math.random()}`
  const rng = mulberry32(hashString(seed))
  return {
    name: String(name || 'Melky').slice(0, 28),
    species: pick(rng, SPECIES),
    rarity: rollRarity(rng),
    personality: pick(rng, PERSONALITIES),
    hatchedAt: new Date().toISOString(),
    lastTickAt: new Date().toISOString(),
    hunger: 80,
    energy: 80,
    joy: 80,
    level: 1,
    xp: 0,
    muted: false,
  }
}

export function tickCompanion(companion) {
  if (!companion) return undefined
  const now = Date.now()
  const last = new Date(companion.lastTickAt || companion.hatchedAt || now).getTime()
  const elapsedHours = Math.max(0, (now - last) / 3_600_000)
  if (elapsedHours <= 0) return companion

  const hungerLoss = Math.floor(elapsedHours * 3)
  const energyLoss = Math.floor(elapsedHours * 2)
  const joyLoss = Math.floor(elapsedHours * 1)

  return {
    ...companion,
    hunger: clamp((companion.hunger ?? 80) - hungerLoss, 0, 100),
    energy: clamp((companion.energy ?? 80) - energyLoss, 0, 100),
    joy: clamp((companion.joy ?? 80) - joyLoss, 0, 100),
    lastTickAt: new Date(now).toISOString(),
  }
}

function withXp(companion, deltaXp) {
  const next = { ...companion, xp: Math.max(0, (companion.xp || 0) + deltaXp) }
  let guard = 0
  while (next.xp >= xpToNext(next.level) && guard < 10) {
    next.xp -= xpToNext(next.level)
    next.level += 1
    guard += 1
  }
  return next
}

export function applyAction(companion, action) {
  if (!companion) return { companion: undefined, message: 'No /mg companion found. Run /mg hatch <name> first.' }
  let c = tickCompanion(companion)

  if (action === 'feed') {
    c = withXp(
      {
        ...c,
        hunger: clamp(c.hunger + 25, 0, 100),
        joy: clamp(c.joy + 6, 0, 100),
      },
      12,
    )
    return { companion: c, message: `${c.name} happily munches snacks.` }
  }

  if (action === 'play') {
    c = withXp(
      {
        ...c,
        joy: clamp(c.joy + 22, 0, 100),
        energy: clamp(c.energy - 14, 0, 100),
        hunger: clamp(c.hunger - 8, 0, 100),
      },
      16,
    )
    return { companion: c, message: `${c.name} zooms around in pure chaos.` }
  }

  if (action === 'nap') {
    c = withXp(
      {
        ...c,
        energy: clamp(c.energy + 28, 0, 100),
        hunger: clamp(c.hunger - 4, 0, 100),
      },
      9,
    )
    return { companion: c, message: `${c.name} takes a tactical power nap.` }
  }

  if (action === 'pet') {
    c = withXp(
      {
        ...c,
        joy: clamp(c.joy + 10, 0, 100),
      },
      7,
    )
    return { companion: c, message: `${c.name} looks extremely pleased.` }
  }

  return { companion: c, message: `Unknown action: ${action}` }
}

export function setMuted(companion, muted) {
  if (!companion) return undefined
  return { ...companion, muted: Boolean(muted) }
}

export function renameCompanion(companion, name) {
  if (!companion) return undefined
  const next = String(name || '').trim()
  if (!next) return companion
  return { ...companion, name: next.slice(0, 28) }
}

export function formatCompanionStatus(companion) {
  if (!companion) {
    return 'No /mg companion yet. Run /mg hatch <name>.'
  }
  const c = tickCompanion(companion)
  return [
    `${c.name} the ${c.species} (${c.rarity})`,
    `personality: ${c.personality}`,
    `level: ${c.level} | xp: ${c.xp}/${xpToNext(c.level)}`,
    `hunger: ${c.hunger} | energy: ${c.energy} | joy: ${c.joy}`,
    `ambient: ${c.muted ? 'muted' : 'on'}`,
  ].join('\n')
}

function moodWord(c) {
  const avg = (c.hunger + c.energy + c.joy) / 3
  if (avg > 75) return 'thriving'
  if (avg > 55) return 'stable'
  if (avg > 35) return 'cranky'
  return 'critical'
}

export function ambientLine(companion) {
  if (!companion || companion.muted) return null
  const c = tickCompanion(companion)
  const mood = moodWord(c)
  const lines = [
    `${c.name}: tiny status ping, mood is ${mood}.`,
    `${c.name}: I am watching your stack traces with intent.`,
    `${c.name}: current vibe ${mood}; consider /mg feed or /mg nap.`,
    `${c.name}: I approve this coding session.`,
    `${c.name}: remember to commit before chaos.`,
  ]
  const rng = mulberry32(hashString(`${c.name}:${Date.now()}:${c.level}`))
  return lines[Math.floor(rng() * lines.length)]
}
