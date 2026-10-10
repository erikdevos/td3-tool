// Drum companion: a small 16-step drum machine that runs alongside the TD-3 (same tempo, shuffle
// and start/stop). It is a jam helper, not part of the TD-3 emulation: the sounds are synthesised
// in the style of the classic 606 / 808 / 909 kits (see audio/drumkit.js).

export const DRUM_STEPS = 16

export const DRUM_VOICES = [
  { key: 'bd', label: 'BD', name: 'Bass drum' },
  { key: 'sd', label: 'SD', name: 'Snare drum' },
  { key: 'ch', label: 'CH', name: 'Closed hat' },
  { key: 'oh', label: 'OH', name: 'Open hat' },
  { key: 'cy', label: 'CY', name: 'Crash' }
]
export const VOICE_KEYS = DRUM_VOICES.map((v) => v.key)

export const KITS = ['606', '808', '909']
export const DEFAULT_KIT = '909'

// Ready-made grooves, one bar each ('x' = hit). The first three are the "metronome" ones.
export const GROOVES = [
  { name: 'Kick', title: 'Kick on every beat', rows: { bd: 'x...x...x...x...' } },
  { name: 'Kick + hat', title: 'Kick on the beat, open hat on the off-beat', rows: { bd: 'x...x...x...x...', oh: '..x...x...x...x.' } },
  { name: 'Kick + 8ths', title: 'Kick on the beat, closed hat on every 8th', rows: { bd: 'x...x...x...x...', ch: 'x.x.x.x.x.x.x.x.' } },
  {
    name: 'House',
    title: 'Four on the floor: snare on 2 and 4, 16th hats, open hat on the off-beat',
    rows: { bd: 'x...x...x...x...', sd: '....x.......x...', ch: 'xx.xxx.xxx.xxx.x', oh: '..x...x...x...x.' }
  },
  {
    name: 'Techno',
    title: 'Driving kick, off-beat open hat, ghost snares',
    rows: { bd: 'x...x...x...x...', sd: '.......x......x.', ch: 'x.xxx.xxx.xxx.xx', oh: '..x...x...x...x.' }
  },
  {
    name: 'Backbeat',
    title: 'Straight 4/4 rock beat: snare on 2 and 4, 8th hats',
    rows: { bd: 'x.....x.x.......', sd: '....x.......x...', ch: 'x.x.x.x.x.x.x.x.' }
  },
  {
    name: 'Electro',
    title: 'Syncopated kick, snare on 2 and 4, 16th hats',
    rows: { bd: 'x.....x...x.....', sd: '....x.......x...', ch: 'xxxxxxxxxxxxxxxx' }
  },
  {
    name: 'Break',
    title: 'Broken beat with an off-beat kick and a late snare',
    rows: { bd: 'x.x.......x.....', sd: '....x..x.x..x...', ch: 'x.x.x.x.x.x.x.xx' }
  }
]

const parseRow = (row) => Array.from({ length: DRUM_STEPS }, (_, i) => typeof row === 'string' && row[i] === 'x')
export const rowString = (row) => row.map((on) => (on ? 'x' : '.')).join('')

export const emptySteps = () => Object.fromEntries(VOICE_KEYS.map((k) => [k, parseRow('')]))
export const grooveSteps = (groove) => Object.fromEntries(VOICE_KEYS.map((k) => [k, parseRow(groove.rows[k])]))
export const stepsEqual = (a, b) => VOICE_KEYS.every((k) => a[k].every((on, i) => on === b[k][i]))
export const isEmptySteps = (steps) => VOICE_KEYS.every((k) => !steps[k].some(Boolean))

export const defaultVoice = () => ({ tune: 0.5, decay: 0.8, level: 0.7, mute: false })

export const defaultDrums = () => ({
  kit: DEFAULT_KIT,
  on: true,
  volume: 0.7,
  // empty at first, so nothing changes for people who never open the drums
  steps: emptySteps(),
  voices: Object.fromEntries(VOICE_KEYS.map((k) => [k, defaultVoice()]))
})

const unit = (v, fallback) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback)

/** Stored drums (rows as 'x...' strings or boolean arrays) -> clean state. */
export const normalizeDrums = (raw) => {
  const d = defaultDrums()
  if (!raw || typeof raw !== 'object') return d
  const steps = raw.steps && typeof raw.steps === 'object' ? raw.steps : {}
  const voices = raw.voices && typeof raw.voices === 'object' ? raw.voices : {}
  return {
    kit: KITS.includes(raw.kit) ? raw.kit : d.kit,
    on: raw.on !== false,
    volume: unit(raw.volume, d.volume),
    steps: Object.fromEntries(
      VOICE_KEYS.map((k) => [k, Array.isArray(steps[k]) ? parseRow(rowString(steps[k].slice(0, DRUM_STEPS))) : parseRow(steps[k])])
    ),
    voices: Object.fromEntries(
      VOICE_KEYS.map((k) => {
        const v = voices[k] || {}
        const base = defaultVoice()
        return [k, { tune: unit(v.tune, base.tune), decay: unit(v.decay, base.decay), level: unit(v.level, base.level), mute: v.mute === true }]
      })
    )
  }
}

/** State -> what goes into localStorage (rows as readable strings). */
export const serializeDrums = (d) => ({
  kit: d.kit,
  on: d.on,
  volume: d.volume,
  steps: Object.fromEntries(VOICE_KEYS.map((k) => [k, rowString(d.steps[k])])),
  voices: Object.fromEntries(VOICE_KEYS.map((k) => [k, { ...d.voices[k] }]))
})

// ---- knob mappings ---------------------------------------------------------------------

/** TUNE: playback rate, one octave down .. one octave up (centre = as rendered). */
export const tuneRate = (tune) => 2 ** ((tune - 0.5) * 2)

/** DECAY: time constant (s) of the extra fade on each hit; fully open = the sound's own decay. */
export const decayTime = (decay) => (decay >= 0.999 ? Infinity : 0.015 * (2 / 0.015) ** decay)

/**
 * LEVEL / VOLUME knobs -> gain (squared, so the knob feels even). At the defaults a busy groove
 * peaks around -6 dBFS, so drums plus TD-3 stay below 0 dB at the mixer's unity faders.
 */
export const knobGain = (v) => v * v
