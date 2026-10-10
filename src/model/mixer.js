// Mixer: sits AFTER the TD-3 emulation and the drum machine, like plugging the hardware into a
// small mixer with an effects unit. Every effect is off at 0; with the TD-3 channel at its
// defaults (effects 0, fader at 0 dB) the TD-3 sound passes through untouched, so the emulation
// itself stays a mirror of the device.

export const CHANNELS = [
  { key: 'td3', label: 'TD-3' },
  { key: 'drums', label: 'Drums' }
]

// fader position of 0 dB (unity gain); the top of the fader is about +6 dB
export const UNITY = 0.8

export const defaultMixer = () => ({
  td3: { volume: UNITY, mute: false, drive: 0, comp: 0, reverb: 0, duck: 0, release: 0.4 },
  drums: { volume: UNITY, mute: false, drive: 0, comp: 0, reverb: 0 },
  master: { volume: UNITY, reverbSize: 0.5 }
})

const unit = (v, fallback) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback)

/** Stored mixer -> clean state (unknown fields dropped, missing ones at their defaults). */
export const normalizeMixer = (raw) => {
  const d = defaultMixer()
  if (!raw || typeof raw !== 'object') return d
  Object.keys(d).forEach((strip) => {
    const src = raw[strip] && typeof raw[strip] === 'object' ? raw[strip] : {}
    Object.keys(d[strip]).forEach((key) => {
      d[strip][key] = key === 'mute' ? src.mute === true : unit(src[key], d[strip][key])
    })
  })
  return d
}

// ---- knob and fader mappings -----------------------------------------------------------

/** Fader position -> gain: audio taper, exactly 1 at UNITY, about +6 dB at the top. */
export const faderGain = (v) => (v <= 0 ? 0 : (v / UNITY) ** 3)
export const faderDb = (v) => (v <= 0 ? -Infinity : 20 * Math.log10(faderGain(v)))

/** Reverb send knob -> send gain. */
export const sendGain = (v) => v * v

/** Sidechain DUCK knob -> gain the TD-3 drops to on each kick (1 = no ducking, about -24 dB at max). */
export const duckFloor = (depth) => 1 - 0.94 * depth

/** Sidechain RELEASE knob -> time constant (s) of the recovery: 30 ms .. 500 ms. */
export const duckRelease = (v) => 0.03 * (0.5 / 0.03) ** v

/** Reverb SIZE knob -> decay time (s, to -60 dB): 0.4 .. 4 s. */
export const reverbSeconds = (v) => 0.4 * 10 ** v

/** True when a channel's effects are all off. */
export const isDry = (strip) => !strip.drive && !strip.comp && !strip.reverb && !strip.duck
