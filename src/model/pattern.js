// Pattern model, mirroring how a TB-303 / TD-3 stores a pattern:
// - up to 16 steps, mono, one note per step
// - pitch = key (C .. C', 0..12) + transpose (DOWN / none / UP)
// - per-step ACCENT and SLIDE flags
// - per-step TIME value: note (new gate), tie (hold previous note) or rest
//
// Memory layout follows the hardware: 4 groups (I-IV) x 2 sections (A/B) x 8 patterns.

export const MAX_STEPS = 16
export const GROUPS = ['I', 'II', 'III', 'IV']
export const SECTIONS = ['A', 'B']
export const PATTERNS_PER_SECTION = 8
export const BANK_SIZE = GROUPS.length * SECTIONS.length * PATTERNS_PER_SECTION

export const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B', 'C']
export const TIMES = ['note', 'tie', 'rest']

// MIDI note of key C with no transpose. The 303 bottom C sits around C2.
export const BASE_MIDI = 36
export const MIN_PITCH = -12
export const MAX_PITCH = 24

export const slotIndex = (group, section, number) =>
  group * SECTIONS.length * PATTERNS_PER_SECTION + section * PATTERNS_PER_SECTION + number

export const slotParts = (index) => ({
  group: Math.floor(index / (SECTIONS.length * PATTERNS_PER_SECTION)),
  section: Math.floor(index / PATTERNS_PER_SECTION) % SECTIONS.length,
  number: index % PATTERNS_PER_SECTION
})

export const slotLabel = (index) => {
  const { group, section, number } = slotParts(index)
  return `${GROUPS[group]}-${SECTIONS[section]}${number + 1}`
}

export const makeStep = (overrides = {}) => ({
  note: 0,
  octave: 0,
  accent: false,
  slide: false,
  time: 'rest',
  ...overrides
})

// triplet: steps are 16th-note triplets (6 per beat) instead of 16ths, like the TD-3's triplet mode
export const makePattern = () => ({
  length: MAX_STEPS,
  triplet: false,
  steps: Array.from({ length: MAX_STEPS }, () => makeStep())
})

export const clonePattern = (pattern) => ({
  length: pattern.length,
  triplet: Boolean(pattern.triplet),
  steps: pattern.steps.map((s) => ({ ...s }))
})

// Pitch as a single semitone offset from bottom C (-12 .. 24).
export const pitchOf = (step) => step.note + step.octave * 12

export const fromPitch = (pitch) => {
  const p = Math.min(MAX_PITCH, Math.max(MIN_PITCH, Math.round(pitch)))
  if (p < 0) return { note: p + 12, octave: -1 }
  if (p > 12) return { note: p - 12, octave: 1 }
  return { note: p, octave: 0 }
}

export const midiOf = (step) => BASE_MIDI + pitchOf(step)

export const noteLabel = (step) => KEY_NAMES[step.note] + (step.note === 12 ? "'" : '')

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const midiName = (midi) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`

export const normalizeStep = (raw) => {
  const step = makeStep()
  if (!raw || typeof raw !== 'object') return step
  if (Number.isInteger(raw.note)) step.note = Math.min(12, Math.max(0, raw.note))
  if ([-1, 0, 1].includes(raw.octave)) step.octave = raw.octave
  step.accent = Boolean(raw.accent)
  step.slide = Boolean(raw.slide)
  if (TIMES.includes(raw.time)) step.time = raw.time
  return step
}

export const normalizePattern = (raw) => {
  const pattern = makePattern()
  if (!raw || typeof raw !== 'object') return pattern
  if (Number.isInteger(raw.length)) pattern.length = Math.min(MAX_STEPS, Math.max(1, raw.length))
  pattern.triplet = raw.triplet === true
  if (Array.isArray(raw.steps)) {
    for (let i = 0; i < MAX_STEPS; i += 1) pattern.steps[i] = normalizeStep(raw.steps[i])
  }
  return pattern
}

// Tiny text format for the built-in demo patterns:
//   "C"  note C, "D#+" D# up an octave, "G-" down, "C'" high C
//   suffix "a" = accent, "s" = slide;  "-" = tie, "." = rest
export const parsePattern = (text) => {
  const tokens = text.trim().split(/\s+/)
  const pattern = makePattern()
  pattern.length = Math.min(MAX_STEPS, tokens.length)
  tokens.slice(0, MAX_STEPS).forEach((token, i) => {
    if (token === '.') return
    if (token === '-') {
      pattern.steps[i] = makeStep({ time: 'tie' })
      return
    }
    const match = token.match(/^([A-G]#?)(')?([+-]?)([as]*)$/)
    if (!match) return
    const [, name, high, oct, flags] = match
    pattern.steps[i] = makeStep({
      note: high ? 12 : NOTE_NAMES.indexOf(name),
      octave: oct === '+' ? 1 : oct === '-' ? -1 : 0,
      accent: flags.includes('a'),
      slide: flags.includes('s'),
      time: 'note'
    })
  })
  return pattern
}

export const demoPatterns = () => [
  parsePattern("Ca C C+ C D#s F Ca - G-s G- A#-a C . C+s D#+ Ca"),
  parsePattern("C- C-s C D#- F-a F- . G-s G-a - A#- C . C-s C-a F-"),
  parsePattern("Fa F+s F G#s A#a - F . C'a C F+s D# Fa . G#s A#"),
  parsePattern("Ca . C+ C Ca . D#+s D# Ca . G+s G Ca . A#s C'a")
]

// The random line generator lives in generate.js.

/** Duration of one step in beats (quarter notes). */
export const stepBeats = (pattern) => (pattern.triplet ? 1 / 6 : 1 / 4)

export const isEmptyPattern = (pattern) => pattern.steps.every((s) => s.time === 'rest')
