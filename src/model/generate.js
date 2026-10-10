// Acid line generator and mutator. Output is a normal TD-3 pattern (notes, ties, rests, accent,
// slide), so everything it makes can be sent to the device.
//
// Settings (all persisted with the session):
//   density  0..1   share of steps that start a note
//   ties     0..1   chance that a note is held into the next free step
//   accent   0..1   chance per note
//   slide    0..1   chance per note
//   range    1|2|3  octaves: 1 = key .. key + 1 oct, 2 = one below as well, 3 = the whole roll
//   rhythm   'random' | 'even'   even = Euclidean: the notes are spread as evenly as possible

import { patternNotes } from './midi.js'
import { MAX_PITCH, MAX_STEPS, MIN_PITCH, clonePattern, makePattern } from './pattern.js'
import { fromNotes } from './transform.js'
import { isChromatic, scalePitches } from './scale.js'

export const defaultGenerator = () => ({ density: 0.7, ties: 0.25, accent: 0.3, slide: 0.2, range: 2, rhythm: 'random' })

const unit = (v, fallback) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback)

export const normalizeGenerator = (raw) => {
  const gen = defaultGenerator()
  if (!raw || typeof raw !== 'object') return gen
  for (const key of ['density', 'ties', 'accent', 'slide']) gen[key] = unit(raw[key], gen[key])
  if ([1, 2, 3].includes(raw.range)) gen.range = raw.range
  if (raw.rhythm === 'random' || raw.rhythm === 'even') gen.rhythm = raw.rhythm
  return gen
}

/** Euclidean rhythm: `hits` onsets spread over `steps`, rotated by `rotate`. */
export const euclid = (hits, steps, rotate = 0) => {
  const out = Array(steps).fill(false)
  if (hits <= 0) return out
  for (let i = 0; i < steps; i += 1) {
    const hit = Math.floor((i * hits) / steps) !== Math.floor(((i - 1) * hits) / steps)
    out[(i + rotate) % steps] = hit
  }
  return out
}

// Without a scale the generator still needs one: minor in the chosen key sounds like acid.
const workingScale = (scale) => (!scale || isChromatic(scale) ? { root: scale?.root ?? 0, type: 'minor' } : scale)

/** The pitches the generator may use, plus the pitch it treats as home (the key's root). */
export const pitchPool = (scale, range) => {
  const s = workingScale(scale)
  const lo = range === 3 ? MIN_PITCH : range === 2 ? s.root - 12 : s.root
  const hi = range === 3 ? MAX_PITCH : s.root + 12
  return { pitches: scalePitches(s, lo, hi), home: s.root }
}

const pick = (list, rng) => list[Math.floor(rng() * list.length) % list.length]

// Home note on the beat now and then, else any scale tone (the root a little more often).
const choosePitch = (pool, step, rng, avoid = null) => {
  if (step % 4 === 0 && rng() < 0.45 && avoid !== pool.home) return pool.home
  const options = pool.pitches.filter((p) => p !== avoid)
  if (rng() < 0.2 && pool.home !== avoid) return pool.home
  return pick(options.length ? options : pool.pitches, rng)
}

/** A new pattern of `length` steps. Steps beyond the length are rests. */
export const generatePattern = (length, settings, scale = null, rng = Math.random) => {
  const gen = normalizeGenerator(settings)
  const L = Math.min(MAX_STEPS, Math.max(1, length))
  const pool = pitchPool(scale, gen.range)

  let onsets
  if (gen.rhythm === 'even') {
    const hits = Math.max(1, Math.round(gen.density * L))
    onsets = euclid(hits, L, Math.floor(rng() * L))
  } else {
    onsets = Array.from({ length: L }, () => rng() < gen.density)
    if (!onsets.some(Boolean)) onsets[0] = true
  }

  const notes = []
  for (let i = 0; i < L; i += 1) {
    if (!onsets[i]) continue
    let end = i + 1
    while (end < L && !onsets[end] && rng() < gen.ties) end += 1
    notes.push({ start: i, end, pitch: choosePitch(pool, i, rng), accent: rng() < gen.accent, slide: rng() < gen.slide })
  }

  const pattern = makePattern()
  pattern.length = L
  return fromNotes(pattern, notes)
}

/**
 * Change a few things in an existing pattern: another pitch, an accent or slide flipped, a note
 * added, removed, shortened or held longer. `amount` is the share of active steps that change.
 */
export const mutatePattern = (pattern, settings, scale = null, rng = Math.random, amount = 0.2) => {
  const gen = normalizeGenerator(settings)
  const L = pattern.length
  const pool = pitchPool(scale, gen.range)
  let notes = patternNotes(pattern).map((n) => ({ ...n }))
  const changes = Math.max(1, Math.round(amount * L))

  const owner = (i) => notes.find((n) => i >= n.start && i < n.end)

  for (let c = 0; c < changes; c += 1) {
    const i = Math.floor(rng() * L) % L
    const n = owner(i)
    const r = rng()
    if (!n) {
      // empty step: add a one-step note
      notes.push({ start: i, end: i + 1, pitch: choosePitch(pool, i, rng), accent: rng() < gen.accent, slide: rng() < gen.slide })
      notes.sort((a, b) => a.start - b.start)
    } else if (r < 0.4) {
      n.pitch = choosePitch(pool, n.start, rng, n.pitch)
    } else if (r < 0.55) {
      n.accent = !n.accent
    } else if (r < 0.7) {
      n.slide = !n.slide
    } else if (r < 0.8 && n.end < L && !owner(n.end)) {
      n.end += 1 // hold into the following empty step
    } else if (r < 0.9 && n.end - n.start > 1) {
      n.end -= 1
    } else {
      notes = notes.filter((x) => x !== n)
    }
  }
  if (!notes.length) return clonePattern(pattern)
  return fromNotes(pattern, notes)
}

/** Small seeded random source (mulberry32), for repeatable tests. */
export const seededRandom = (seed) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
