// Patch = the position of every front-panel control.
// Note: the real TD-3-MO is fully analog and does NOT store knob positions.
// Patches only exist in this editor (for the WebAudio preview and for recall notes).

// Continuous controls are normalised 0..1 (displayed as 0..10 like the panel print).
export const KNOBS = {
  // Main row (classic TB-303 / TD-3 controls)
  tuning: { label: 'Tuning', default: 0.5, bipolar: true },
  cutoff: { label: 'Cut Off Freq', default: 0.42 },
  resonance: { label: 'Resonance', default: 0.62 },
  envMod: { label: 'Env Mod', default: 0.55 },
  decay: { label: 'Decay', default: 0.72 },
  accent: { label: 'Accent', default: 0.65 },
  volume: { label: 'Volume', default: 0.7 },

  // "Modded Out" row
  normalDecay: { label: 'Normal Decay', default: 0.42 },
  accentDecay: { label: 'Accent Decay', default: 0.35 },
  softAttack: { label: 'Soft Attack', default: 0.25 },
  slideTime: { label: 'Slide Time', default: 0.28 },
  filterTracking: { label: 'Filter Tracking', default: 0 },
  filterFm: { label: 'Filter FM', default: 0 },
  overdrive: { label: 'Overdrive', default: 0.25 }
}

// Multi-position switches; value is the index into `positions`.
export const SWITCHES = {
  waveform: { label: 'Waveform', positions: ['SAW', 'SQR'], default: 0 },
  accentSweep: { label: 'Accent Sweep', positions: ['OFF', 'NORM', 'HIGH'], default: 1 },
  sweepSpeed: { label: 'Sweep Speed', positions: ['FAST', 'NORM', 'SLOW'], default: 1 },
  muffler: { label: 'Muffler', positions: ['OFF', 'SOFT', 'HARD'], default: 0 },
  subOsc: { label: 'Sub Osc', positions: ['OFF', 'LOW', 'MID', 'HIGH'], default: 0 }
}

export const MAIN_ROW = ['tuning', 'cutoff', 'resonance', 'envMod', 'decay', 'accent']
export const MO_ROW = ['normalDecay', 'accentDecay', 'softAttack', 'slideTime', 'filterTracking', 'filterFm', 'overdrive']

export const defaultPatch = () => {
  const patch = {}
  for (const [key, def] of Object.entries(KNOBS)) patch[key] = def.default
  for (const [key, def] of Object.entries(SWITCHES)) patch[key] = def.default
  return patch
}

const clamp01 = (v) => Math.min(1, Math.max(0, v))

// Accepts anything (localStorage, imported file) and returns a valid patch.
export const normalizePatch = (raw) => {
  const patch = defaultPatch()
  if (!raw || typeof raw !== 'object') return patch
  for (const key of Object.keys(KNOBS)) {
    if (Number.isFinite(raw[key])) patch[key] = clamp01(raw[key])
  }
  for (const [key, def] of Object.entries(SWITCHES)) {
    const v = Math.round(raw[key])
    if (Number.isFinite(v)) patch[key] = Math.min(def.positions.length - 1, Math.max(0, v))
  }
  return patch
}

export const patchesEqual = (a, b) =>
  Object.keys(KNOBS).every((k) => Math.abs(a[k] - b[k]) < 0.0005) &&
  Object.keys(SWITCHES).every((k) => a[k] === b[k])

export const factoryPresets = () => [
  { name: 'INIT 303', params: defaultPatch() },
  {
    name: 'SQUELCH',
    params: {
      ...defaultPatch(),
      cutoff: 0.28, resonance: 0.88, envMod: 0.78, normalDecay: 0.38, accentDecay: 0.3,
      accent: 0.85, accentSweep: 2, sweepSpeed: 1, overdrive: 0.35
    }
  },
  {
    name: 'RUBBER BASS',
    params: {
      ...defaultPatch(),
      waveform: 1, cutoff: 0.22, resonance: 0.4, envMod: 0.38, normalDecay: 0.3,
      decay: 0.45, accent: 0.5, subOsc: 2, softAttack: 0.4
    }
  },
  {
    name: 'DRONE SCREAM',
    params: {
      ...defaultPatch(),
      cutoff: 0.5, resonance: 0.93, envMod: 0.45, decay: 1, normalDecay: 0.7,
      accent: 0.9, overdrive: 0.75, muffler: 2, filterFm: 0.55, slideTime: 0.55
    }
  },
  {
    name: 'SOFT PLUCK',
    params: {
      ...defaultPatch(),
      cutoff: 0.36, resonance: 0.55, envMod: 0.6, normalDecay: 0.22, accentDecay: 0.2,
      decay: 0.38, softAttack: 0.62, filterTracking: 0.5, overdrive: 0.12
    }
  },
  // v2 additions: starting points built from common 303 "recipes" (low cutoff, high
  // resonance, env mod for the squelch, accent for the wow). Tuned by ear on this engine.
  ...[
    ['CHICAGO SQUELCH', { cutoff: 0.3, resonance: 0.82, envMod: 0.6, decay: 0.55, normalDecay: 0.45, accent: 0.8 }],
    ['ROLLING TECHNO', { cutoff: 0.35, resonance: 0.75, envMod: 0.5, normalDecay: 0.3, accentDecay: 0.25, overdrive: 0.55, muffler: 1 }],
    ['DEEP SUB', { waveform: 1, cutoff: 0.18, resonance: 0.3, envMod: 0.25, decay: 0.5, subOsc: 3, overdrive: 0.15 }],
    ['SCREAMER', { cutoff: 0.45, resonance: 0.95, envMod: 0.85, accent: 1, accentSweep: 2, sweepSpeed: 2, overdrive: 0.8, muffler: 2 }],
    ['PSY BASS', { cutoff: 0.3, resonance: 0.5, envMod: 0.55, normalDecay: 0.18, accentDecay: 0.15, decay: 0.3, overdrive: 0.4 }],
    ['HOLLOW SQUARE', { waveform: 1, cutoff: 0.42, resonance: 0.6, envMod: 0.45, normalDecay: 0.4 }],
    ['GLIDE LEAD', { tuning: 1, cutoff: 0.55, resonance: 0.7, envMod: 0.4, decay: 0.85, slideTime: 0.6 }],
    ['ACID WOBBLE', { cutoff: 0.38, resonance: 0.85, envMod: 0.5, filterFm: 0.6, slideTime: 0.7, decay: 1 }],
    ['PLUCKY ARP', { cutoff: 0.45, resonance: 0.65, normalDecay: 0.15, accentDecay: 0.12, decay: 0.25, softAttack: 0.1, filterTracking: 0.7 }],
    ['DUB DRONE', { cutoff: 0.25, resonance: 0.7, envMod: 0.3, decay: 1, normalDecay: 0.8, slideTime: 0.8, sweepSpeed: 2 }],
    ['WARM ROUND', { cutoff: 0.3, resonance: 0.35, envMod: 0.3, softAttack: 0.6, overdrive: 0.3 }],
    ['DIRTY ELECTRO', { waveform: 1, cutoff: 0.33, resonance: 0.6, envMod: 0.7, overdrive: 0.65, muffler: 1, subOsc: 1 }],
    ['THIN AND NASAL', { cutoff: 0.55, resonance: 0.88, envMod: 0.2, filterTracking: 1 }],
    ['ACCENT MONSTER', { cutoff: 0.2, resonance: 0.8, envMod: 0.4, accent: 1, accentSweep: 2, sweepSpeed: 0 }]
  ].map(([name, params]) => ({ name, params: { ...defaultPatch(), ...params } }))
]

// Bump when factory presets are added, so existing users receive the new ones.
export const FACTORY_VERSION = 2
