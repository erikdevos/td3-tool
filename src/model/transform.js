// Whole-pattern transforms. They work on notes (a 'note' step plus its 'tie' steps, see
// patternNotes) within the active length, and rebuild the steps from those notes, so ties,
// accents and slides stay consistent. Steps beyond the length are left alone.
// Everything here stays inside what the TD-3 can store: a pattern in, a pattern out.

import { patternNotes } from './midi.js'
import { clonePattern, fromPitch, makeStep } from './pattern.js'
import { isChromatic, snapPitch } from './scale.js'

/**
 * Steps from a list of notes { start, end, pitch, accent, slide } (end exclusive).
 * Accent sits on the first step of a note, slide on its last step ("glide into the next note"),
 * which is where the sequencer and the TD-3 format expect them.
 */
export const fromNotes = (pattern, notes) => {
  const out = clonePattern(pattern)
  for (let i = 0; i < out.length; i += 1) out.steps[i] = makeStep()
  for (const n of notes) {
    const end = Math.min(out.length, n.end)
    if (n.start < 0 || n.start >= end) continue
    out.steps[n.start] = makeStep({ ...fromPitch(n.pitch), accent: Boolean(n.accent), time: 'note' })
    for (let i = n.start + 1; i < end; i += 1) out.steps[i] = makeStep({ time: 'tie' })
    out.steps[end - 1].slide = Boolean(n.slide)
  }
  return out
}

/** Play the pattern backwards. A slide from A into B becomes a slide from B into A. */
export const reversePattern = (pattern) => {
  const L = pattern.length
  const notes = patternNotes(pattern)
  const slidesInto = new Set() // notes that the previous note slides into
  notes.forEach((n, i) => {
    const next = notes[(i + 1) % notes.length]
    if (n.slide && next && next.start === n.end % L) slidesInto.add(next)
  })
  const reversed = notes.map((n) => ({ ...n, start: L - n.end, end: L - n.start, slide: slidesInto.has(n) }))
  return fromNotes(pattern, reversed)
}

/**
 * Mirror the melody upside down within its own range (lowest and highest note swap places).
 * With a scale, the result is snapped back into the scale.
 */
export const invertPattern = (pattern, scale = null) => {
  const notes = patternNotes(pattern)
  if (!notes.length) return clonePattern(pattern)
  const pitches = notes.map((n) => n.pitch)
  const axis = Math.min(...pitches) + Math.max(...pitches)
  const snap = (p) => (scale && !isChromatic(scale) ? snapPitch(scale, p) : p)
  return fromNotes(pattern, notes.map((n) => ({ ...n, pitch: snap(axis - n.pitch) })))
}

/**
 * Move the accents (or slides) to the next / previous note, keeping the melody and rhythm.
 * Like the TD-3's own pools: flags belong to notes, not to step positions.
 */
export const rotateFlags = (pattern, flag, dir) => {
  const notes = patternNotes(pattern)
  if (notes.length < 2) return clonePattern(pattern)
  const flags = notes.map((n) => n[flag])
  const k = ((dir % flags.length) + flags.length) % flags.length
  const rotated = flags.map((_, i) => flags[(i - k + flags.length) % flags.length])
  return fromNotes(pattern, notes.map((n, i) => ({ ...n, [flag]: rotated[i] })))
}

/** Double speed: squeeze the pattern into the first half and play it twice. */
export const doubleSpeed = (pattern) => {
  const L = pattern.length
  const half = Math.ceil(L / 2)
  const squeezed = []
  for (const n of patternNotes(pattern)) {
    const start = Math.floor(n.start / 2)
    if (squeezed.some((s) => s.start === start)) continue // two notes landed on one step: keep the first
    squeezed.push({ ...n, start, end: Math.min(half, start + Math.max(1, Math.round((n.end - n.start) / 2))) })
  }
  squeezed.forEach((n, i) => {
    const next = squeezed[i + 1]
    if (next && n.end > next.start) n.end = next.start
  })
  const copies = squeezed
    .map((n) => ({ ...n, start: n.start + half, end: Math.min(L, n.end + half) }))
    .filter((n) => n.start < L)
  return fromNotes(pattern, [...squeezed, ...copies])
}

/** Half speed: stretch the first half over the whole pattern (the second half falls off). */
export const halfSpeed = (pattern) => {
  const L = pattern.length
  const stretched = patternNotes(pattern)
    .map((n) => ({ ...n, start: n.start * 2, end: Math.min(L, n.end * 2) }))
    .filter((n) => n.start < L)
  return fromNotes(pattern, stretched)
}

/** Move every note to the nearest pitch of the scale. */
export const fitToScale = (pattern, scale) => {
  if (!scale || isChromatic(scale)) return clonePattern(pattern)
  return fromNotes(pattern, patternNotes(pattern).map((n) => ({ ...n, pitch: snapPitch(scale, n.pitch) })))
}
