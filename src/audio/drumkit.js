// Drum sounds for the drum companion, synthesised in plain JS: no samples, no WebAudio, no
// dependencies, so it runs (and is tested) in Node too. renderVoice(kit, voice, sampleRate) returns
// one hit as a Float32Array; audio/drums.js renders a kit once and plays the hits as AudioBuffers.
//
// The recipes follow how the analog machines make their sounds: a sine with a falling pitch for the
// kick, two tones plus filtered noise for the snare, six detuned square waves ("metal") for hats and
// cymbal. 909 hats and crash are samples on the original; here they are metal plus noise.
// Tuned by ear towards each kit's character, not measured against the real machines.

const TWO_PI = 2 * Math.PI

// Peak level of each voice after rendering (the LEVEL knobs scale from here)
const PEAK = { bd: 0.9, sd: 0.72, ch: 0.42, oh: 0.42, cy: 0.38 }

// Frequencies of the six square-wave oscillators of the 808 / 606 hat and cymbal circuit
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800]

// ---- tiny DSP helpers --------------------------------------------------------------

// Deterministic noise, so a kit sounds the same every time it is rendered
const noiseSource = (seed) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1
  }
}

// RBJ cookbook biquad: 'lp', 'hp' or 'bp' (band-pass with 0 dB peak)
const biquad = (type, freq, q, sr) => {
  const w = (TWO_PI * Math.min(freq, sr * 0.45)) / sr
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / (2 * q)
  const b = type === 'lp' ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : type === 'hp' ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2] : [alpha, 0, -alpha]
  const a0 = 1 + alpha
  const [b0, b1, b2] = b.map((x) => x / a0)
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  return (x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    return y
  }
}

// Six square waves summed: the metallic source of analog hats and cymbals
const metalSource = (sr, detune = 1) => {
  const incs = METAL.map((f) => (f * detune) / sr)
  const phases = METAL.map((_, i) => i / METAL.length)
  return () => {
    let s = 0
    for (let i = 0; i < incs.length; i += 1) {
      phases[i] += incs[i]
      if (phases[i] >= 1) phases[i] -= 1
      s += phases[i] < 0.5 ? 1 : -1
    }
    return s / incs.length
  }
}

const render = (seconds, sr, fn) => {
  const out = new Float32Array(Math.round(seconds * sr))
  for (let i = 0; i < out.length; i += 1) out[i] = fn(i / sr)
  return out
}

// ---- voices ----------------------------------------------------------------------------

/** Sine with a falling pitch (f0 -> f1), a short click and optional saturation. */
const kick = ({ f0, f1, sweep, decay, click, drive, length }) => (sr, noise) => {
  const lp = biquad('lp', 2500, 0.7, sr)
  let phase = 0
  return render(length, sr, (t) => {
    phase += (TWO_PI * (f1 + (f0 - f1) * Math.exp(-t / sweep))) / sr
    const s = Math.sin(phase) * Math.exp(-t / decay) + lp(noise()) * click * Math.exp(-t / 0.003)
    return drive ? Math.tanh(s * drive) / Math.tanh(drive) : s
  })
}

/** Two tuned tones (with a small pitch drop) plus band-limited noise for the snares. */
const snare = ({ tones, bend, hp, lp, noiseDecay, noiseGain, length }) => (sr, noise) => {
  const phases = tones.map(() => 0)
  const hpf = biquad('hp', hp, 0.7, sr)
  const lpf = biquad('lp', lp, 0.7, sr)
  return render(length, sr, (t) => {
    const pitch = 1 + bend * Math.exp(-t / 0.012)
    let s = 0
    tones.forEach(([f, decay, gain], i) => {
      phases[i] += (TWO_PI * f * pitch) / sr
      s += Math.sin(phases[i]) * gain * Math.exp(-t / decay)
    })
    return s + lpf(hpf(noise())) * noiseGain * Math.exp(-t / noiseDecay)
  })
}

/** Metal (and some noise) through a band-pass and a high-pass: hats and cymbals. */
const metal = ({ detune = 1, noiseMix = 0, bands, hp, decay, burst = 0, length }) => (sr, noise) => {
  const src = metalSource(sr, detune)
  const filters = bands.map(([f, q, gain, tau]) => ({ bp: biquad('bp', f, q, sr), gain, tau }))
  const hpf = biquad('hp', hp, 0.7, sr)
  return render(length, sr, (t) => {
    const x = src() * (1 - noiseMix) + noise() * noiseMix
    let s = 0
    filters.forEach((f) => {
      s += f.bp(x) * f.gain * Math.exp(-t / (f.tau || decay))
    })
    return hpf(s) * (1 + burst * Math.exp(-t / 0.015))
  })
}

const RECIPES = {
  808: {
    bd: kick({ f0: 78, f1: 49, sweep: 0.03, decay: 0.38, click: 0.12, drive: 0, length: 1.8 }),
    sd: snare({ tones: [[180, 0.07, 0.75], [330, 0.045, 0.4]], bend: 0.12, hp: 1800, lp: 9000, noiseDecay: 0.1, noiseGain: 0.55, length: 0.5 }),
    ch: metal({ bands: [[10000, 1.2, 1]], hp: 7000, decay: 0.028, length: 0.3 }),
    oh: metal({ bands: [[10000, 1.2, 1]], hp: 7000, decay: 0.2, length: 1.2 }),
    cy: metal({ bands: [[3600, 2, 0.5, 0.25], [8200, 1, 1]], hp: 3000, decay: 0.8, length: 3 })
  },
  909: {
    bd: kick({ f0: 240, f1: 51, sweep: 0.016, decay: 0.24, click: 0.5, drive: 2.2, length: 1.1 }),
    sd: snare({ tones: [[190, 0.06, 0.6], [345, 0.045, 0.35]], bend: 0.35, hp: 900, lp: 11000, noiseDecay: 0.17, noiseGain: 0.95, length: 0.7 }),
    ch: metal({ detune: 1.45, noiseMix: 0.45, bands: [[10500, 0.8, 1]], hp: 7500, decay: 0.035, length: 0.35 }),
    oh: metal({ detune: 1.45, noiseMix: 0.45, bands: [[10500, 0.8, 1]], hp: 7500, decay: 0.28, length: 1.5 }),
    cy: metal({ detune: 1.7, noiseMix: 0.6, bands: [[9000, 0.6, 1]], hp: 5000, decay: 0.75, burst: 1.2, length: 3 })
  },
  606: {
    bd: kick({ f0: 135, f1: 62, sweep: 0.012, decay: 0.1, click: 0.3, drive: 1.3, length: 0.6 }),
    sd: snare({ tones: [[240, 0.035, 0.35], [460, 0.025, 0.15]], bend: 0.2, hp: 2500, lp: 12000, noiseDecay: 0.085, noiseGain: 0.95, length: 0.4 }),
    ch: metal({ detune: 1.2, bands: [[11500, 1.5, 1]], hp: 8500, decay: 0.02, length: 0.25 }),
    oh: metal({ detune: 1.2, bands: [[11500, 1.5, 1]], hp: 8500, decay: 0.14, length: 0.9 }),
    cy: metal({ detune: 1.2, bands: [[7000, 1, 1]], hp: 5000, decay: 0.5, length: 2.2 })
  }
}

const SEEDS = { bd: 11, sd: 23, ch: 37, oh: 41, cy: 53 }

/** One hit of `voice` ('bd' | 'sd' | 'ch' | 'oh' | 'cy') from `kit` ('606' | '808' | '909'). */
export const renderVoice = (kit, voice, sampleRate) => {
  const recipe = RECIPES[kit]?.[voice]
  if (!recipe) throw new Error(`unknown drum ${kit} ${voice}`)
  const out = recipe(sampleRate, noiseSource(SEEDS[voice] * 1000 + Number(kit)))
  // short fade in (no click from a DC step) and out (the tail ends at zero), then set the peak
  const fadeIn = Math.round(sampleRate * 0.0005)
  const fadeOut = Math.round(sampleRate * 0.02)
  let peak = 0
  for (let i = 0; i < out.length; i += 1) {
    out[i] *= Math.min(1, i / fadeIn, (out.length - 1 - i) / fadeOut)
    peak = Math.max(peak, Math.abs(out[i]))
  }
  const gain = peak > 0 ? PEAK[voice] / peak : 0
  for (let i = 0; i < out.length; i += 1) out[i] *= gain
  return out
}
