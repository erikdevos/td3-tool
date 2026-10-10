// Scales for the scale lock, the generator and the transforms.
// A scale is a key (root pitch class 0..11, C = 0) plus a set of intervals.
// 'chromatic' means "no scale": every pitch is allowed and nothing is snapped.
// Pitches are the editor's semitone offsets from key C (-12..24, see pattern.js),
// so pitch class = pitch mod 12.

import { MAX_PITCH, MIN_PITCH } from './pattern.js'

export const SCALES = {
  chromatic: { name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  minor: { name: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  phrygian: { name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  dorian: { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  harmonicMinor: { name: 'Harm. minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  minorPenta: { name: 'Minor penta', steps: [0, 3, 5, 7, 10] },
  blues: { name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  major: { name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  mixolydian: { name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] }
}

export const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const defaultScale = () => ({ root: 0, type: 'chromatic', lock: true })

export const normalizeScale = (raw) => {
  const scale = defaultScale()
  if (!raw || typeof raw !== 'object') return scale
  if (Number.isInteger(raw.root) && raw.root >= 0 && raw.root < 12) scale.root = raw.root
  if (raw.type in SCALES) scale.type = raw.type
  if (typeof raw.lock === 'boolean') scale.lock = raw.lock
  return scale
}

const mod12 = (n) => ((n % 12) + 12) % 12

export const isChromatic = (scale) => !scale || scale.type === 'chromatic'

export const inScale = (scale, pitch) => isChromatic(scale) || SCALES[scale.type].steps.includes(mod12(pitch - scale.root))

export const isRoot = (scale, pitch) => !isChromatic(scale) && mod12(pitch - scale.root) === 0

/** All pitches of the scale inside lo..hi (inclusive), ascending. */
export const scalePitches = (scale, lo = MIN_PITCH, hi = MAX_PITCH) => {
  const list = []
  for (let p = lo; p <= hi; p += 1) if (inScale(scale, p)) list.push(p)
  return list
}

/**
 * Nearest pitch in the scale, within the roll's range. Ties go down, which keeps a dragged note
 * where it was when the pointer is between two scale tones.
 * `prefer` = +1 / -1 picks the next scale tone in that direction instead (for nudging).
 */
export const snapPitch = (scale, pitch, prefer = 0) => {
  if (inScale(scale, pitch) && !prefer) return pitch
  if (prefer) {
    for (let p = pitch + prefer; p >= MIN_PITCH && p <= MAX_PITCH; p += prefer) if (inScale(scale, p)) return p
    return pitch
  }
  for (let d = 1; d < 12; d += 1) {
    if (pitch - d >= MIN_PITCH && inScale(scale, pitch - d)) return pitch - d
    if (pitch + d <= MAX_PITCH && inScale(scale, pitch + d)) return pitch + d
  }
  return pitch
}

export const scaleLabel = (scale) => (isChromatic(scale) ? 'CHROMATIC' : `${ROOT_NAMES[scale.root]} ${SCALES[scale.type].name}`.toUpperCase())
