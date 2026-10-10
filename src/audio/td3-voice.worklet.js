// TD-3 / TD-3-MO style monosynth voice, running in an AudioWorklet.
//
// The core follows Open303 by Robin Schmidt (MIT license, see NOTICE below): its
// measured TB-303 filter model ("TeeBee" coupled diode-ladder approximation), the 303
// saw / tanh-shaped square waveforms, the envelope-to-cutoff mapping measured on a real
// unit, the accent circuit (RC smoothed main envelope) and the fixed pre/post filters.
// On top of that sit the TD-3-MO "Modded Out" controls: normal/accent decay, VCA decay,
// soft attack, slide time, filter tracking, filter FM, accent sweep + sweep speed,
// muffler, overdrive and sub oscillator.
// With `model: 1` the voice behaves like a regular TD-3 instead: DECAY sets the filter
// envelope (as on the TB-303), the MO controls are fixed at stock values and the
// built-in distortion (DS-1 style: dist, tone, level) replaces the overdrive.
//
// Oscillator and filter run 4x oversampled, like Open303.
//
// NOTICE — portions derived from Open303:
//   Copyright (c) 2009 Robin Schmidt (www.rs-met.com)
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this
//   software and associated documentation files (the "Software"), to deal in the Software
//   without restriction, including without limitation the rights to use, copy, modify,
//   merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
//   permit persons to whom the Software is furnished to do so, subject to the following
//   conditions: The above copyright notice and this permission notice shall be included
//   in all copies or substantial portions of the Software.
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
//
// This file must stay dependency-free: it is loaded with audioWorklet.addModule().

const PI = Math.PI
const OVERSAMPLING = 4
const TABLE_SIZE = 2048
const ONE_OVER_SQRT2 = Math.SQRT1_2

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const expMap = (v, lo, hi) => lo * Math.pow(hi / lo, v)

const softTanh = (x) => {
  if (x < -3) return -1
  if (x > 3) return 1
  const x2 = x * x
  return (x * (27 + x2)) / (27 + 9 * x2)
}

// ---- band-limited 303 wavetables (mip-mapped) -----------------------------------------

// Open303 prototypes: a saw, and a square made by tanh-shaping that saw with a DC offset
// (drive 36.9 dB, offset 4.37), shifted 180 degrees.
const buildPrototype = (kind) => {
  const N = TABLE_SIZE
  const N1 = Math.round(0.5 * (N - 1))
  const N2 = N - N1
  const s1 = 1 / (N1 - 1)
  const s2 = 1 / N2
  const saw = new Float64Array(N)
  for (let n = 0; n < N1; n += 1) saw[n] = s1 * n
  for (let n = N1; n < N; n += 1) saw[n] = -1 + s2 * (n - N1)
  if (kind === 'saw') return saw
  const drive = Math.pow(10, 36.9 / 20)
  const sq = new Float64Array(N)
  const shift = N / 2
  for (let n = 0; n < N; n += 1) sq[(n + shift) % N] = -Math.tanh(drive * saw[n] + 4.37)
  return sq
}

// Fourier coefficients of the prototype, then one table per octave with fewer harmonics.
const buildMipMaps = (proto) => {
  const N = TABLE_SIZE
  const H = N / 2
  const re = new Float64Array(H + 1)
  const im = new Float64Array(H + 1)
  const cosT = new Float64Array(N)
  const sinT = new Float64Array(N)
  for (let n = 0; n < N; n += 1) {
    cosT[n] = Math.cos((2 * PI * n) / N)
    sinT[n] = Math.sin((2 * PI * n) / N)
  }
  for (let h = 1; h < H; h += 1) {
    let a = 0
    let b = 0
    for (let n = 0; n < N; n += 1) {
      const idx = (h * n) % N
      a += proto[n] * cosT[idx]
      b += proto[n] * sinT[idx]
    }
    re[h] = (2 * a) / N
    im[h] = (2 * b) / N
  }
  const tables = []
  for (let maxH = H / 2; maxH >= 1; maxH = Math.floor(maxH / 2)) {
    const t = new Float32Array(N + 1)
    for (let n = 0; n < N; n += 1) {
      let v = 0
      for (let h = 1; h <= maxH; h += 1) {
        const idx = (h * n) % N
        v += re[h] * cosT[idx] + im[h] * sinT[idx]
      }
      t[n] = v
    }
    t[N] = t[0]
    tables.push({ maxH, data: t })
  }
  return tables
}

// ---- small filter helpers -----------------------------------------------------------

const onePoleHighpass = (fc, fs) => {
  const x = Math.exp((-2 * PI * fc) / fs)
  return { b0: 0.5 * (1 + x), b1: -0.5 * (1 + x), a1: x, x1: 0, y1: 0 }
}

const onePoleAllpass = (fc, fs) => {
  const t = Math.tan((PI * fc) / fs)
  const x = (t - 1) / (t + 1)
  return { b0: x, b1: 1, a1: -x, x1: 0, y1: 0 }
}

const onePole = (f, x) => {
  const y = f.b0 * x + f.b1 * f.x1 + f.a1 * f.y1
  f.x1 = x
  f.y1 = y
  return y
}

// RBJ cookbook biquads (Open303 sign convention: y = b0x + b1x1 + b2x2 + a1y1 + a2y2)
const biquadLowpass = (fc, q, fs) => {
  const w = (2 * PI * fc) / fs
  const s = Math.sin(w)
  const c = Math.cos(w)
  const alpha = s / (2 * q)
  const scale = 1 / (1 + alpha)
  const b1 = (1 - c) * scale
  return { b0: 0.5 * b1, b1, b2: 0.5 * b1, a1: 2 * c * scale, a2: (alpha - 1) * scale, x1: 0, x2: 0, y1: 0, y2: 0 }
}

const biquadNotch = (fc, bwOct, fs) => {
  const w = (2 * PI * fc) / fs
  const s = Math.sin(w)
  const c = Math.cos(w)
  const alpha = s * Math.sinh(((0.5 * Math.log(2) * bwOct * w) / s))
  const scale = 1 / (1 + alpha)
  return { b0: scale, b1: -2 * c * scale, b2: scale, a1: 2 * c * scale, a2: (alpha - 1) * scale, x1: 0, x2: 0, y1: 0, y2: 0 }
}

const biquad = (f, x) => {
  const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 + f.a1 * f.y1 + f.a2 * f.y2
  f.x2 = f.x1
  f.x1 = x
  f.y2 = f.y1
  f.y1 = y
  return y
}

const resetFilter = (f) => {
  f.x1 = 0
  f.y1 = 0
  if ('x2' in f) {
    f.x2 = 0
    f.y2 = 0
  }
}

// ---- parameters ----------------------------------------------------------------------

const DEFAULT_PARAMS = {
  tuning: 0.5,
  cutoff: 0.42,
  resonance: 0.62,
  envMod: 0.55,
  decay: 0.72,
  accent: 0.65,
  volume: 0.7,
  normalDecay: 0.42,
  accentDecay: 0.35,
  softAttack: 0.25,
  slideTime: 0.28,
  filterTracking: 0,
  filterFm: 0,
  overdrive: 0.25,
  waveform: 0,
  accentSweep: 1,
  sweepSpeed: 1,
  muffler: 0,
  subOsc: 0,
  distOn: 0,
  distDrive: 0.5,
  distTone: 0.5,
  distLevel: 0.5,
  model: 0 // 0 = TD-3-MO, 1 = TD-3
}

// Stock TB-303 / TD-3 timing (Open303 defaults)
const STOCK = { accentDecayMs: 200, ampDecayMs: 1230, attackMs: 3, slideMs: 60 }
const STOCK_OVERRIDES = { filterTracking: 0, filterFm: 0, accentSweep: 1, sweepSpeed: 1, muffler: 0, subOsc: 0, overdrive: 0 }

// Open303's envelope-to-cutoff mapping, measured on a real TB-303
const C0 = 313.8152786059267 // lowest nominal cutoff
const C1 = 2394.411986817546 // highest nominal cutoff
const ENV = { oF: 0.048292930943553, oC: 0.294391201442418, sLoF: 3.773996325111173, sLoC: 0.736965594166206, sHiF: 4.194548788411135, sHiC: 0.864344900642434 }

class TD3Voice extends AudioWorkletProcessor {
  constructor() {
    super()
    this.p = { ...DEFAULT_PARAMS }
    this.stockP = { ...DEFAULT_PARAMS } // reused per block in TD-3 mode (no allocation on the audio thread)
    this.queue = []
    const fs = sampleRate
    const fsOs = fs * OVERSAMPLING
    this.fsOs = fsOs

    this.tables = [buildMipMaps(buildPrototype('saw')), buildMipMaps(buildPrototype('square'))]
    this.phase = 0
    this.subPhase = 0
    this.seed = 22222

    // pitch
    this.oscFreq = 65.41
    this.slewFreq = 65.41

    // envelopes
    this.idle = true
    this.noteOn = false
    this.accentGain = 0
    this.meg = 0 // main envelope (filter), Open303 DecayEnvelope
    this.megCoef = 0.99
    this.rc2 = 0 // accent sweep RC
    this.amp = 0 // Open303 AnalogEnvelope (attack -> decay to 0 -> release)
    this.ampTime = 0
    this.ampAttackMs = 0
    this.ampReleaseCoef = 1
    this.noteAccent = false

    // TeeBee filter state (oversampled)
    this.y1 = 0
    this.y2 = 0
    this.y3 = 0
    this.y4 = 0
    this.fbHp = onePoleHighpass(150, fsOs)
    this.hp1 = onePoleHighpass(44.486, fsOs)
    // decimation lowpass (2 x biquad Butterworth) before going back to base rate
    this.aa1 = biquadLowpass(fs * 0.45, 0.5412, fsOs)
    this.aa2 = biquadLowpass(fs * 0.45, 1.3066, fsOs)

    // base-rate post filters (Open303 "tweakables")
    this.allpass = onePoleAllpass(14.008, fs)
    this.hp2 = onePoleHighpass(24.167, fs)
    this.notch = biquadNotch(7.5164, 4.7, fs)
    this.deClick = biquadLowpass(200, Math.SQRT1_2, fs)

    // TD-3 distortion: pre-emphasis, clipper, tone (lowpass/highpass blend)
    this.distPre = onePoleHighpass(120, fs)
    this.distLp = { y: 0, a: 1 - Math.exp((-2 * PI * 600) / fs) }
    this.distHp = { y: 0, a: 1 - Math.exp((-2 * PI * 1800) / fs) }

    this.lastOut = 0
    this.dcX = 0
    this.dcY = 0

    this.sm = { cutoff: this.p.cutoff, resonance: this.p.resonance, envMod: this.p.envMod, volume: this.p.volume, overdrive: this.p.overdrive }

    this.port.onmessage = (event) => this.onMessage(event.data)
  }

  onMessage(msg) {
    switch (msg.type) {
      case 'params':
        Object.assign(this.p, msg.params)
        break
      case 'events':
        for (const ev of msg.events) this.queue.push({ ...ev, frame: Math.round(ev.time * sampleRate) })
        this.queue.sort((a, b) => a.frame - b.frame)
        break
      case 'clear':
        this.queue.length = 0
        this.release()
        break
      default:
        break
    }
  }

  // ---- note handling (Open303 triggerNote / slideToNote / releaseNote) --------------

  setAccent(accent) {
    const p = this.p
    this.noteAccent = accent
    this.accentGain = accent ? p.accent : 0
    // MO: separate normal / accent decay of the main (filter) envelope.
    // TD-3: DECAY sets the normal-note filter decay (200 ms .. 2 s), accents use a fixed 200 ms.
    const decayMs = p.model === 1
      ? accent ? STOCK.accentDecayMs : expMap(p.decay, 200, 2000)
      : accent ? expMap(p.accentDecay, 30, 3000) : expMap(p.normalDecay, 60, 3000)
    this.megCoef = Math.exp(-1 / (0.001 * decayMs * sampleRate))
    // Open303: accented notes release slower
    const releaseMs = accent ? 50 : 1
    this.ampReleaseCoef = 1 - Math.exp(-1 / (0.001 * releaseMs * sampleRate))
  }

  trigger(ev) {
    if (this.idle) {
      // reset everything only when silent, to avoid clicks
      this.phase = 0
      this.subPhase = 0
      this.y1 = this.y2 = this.y3 = this.y4 = 0
      for (const f of [this.fbHp, this.hp1, this.allpass, this.hp2, this.notch, this.deClick, this.aa1, this.aa2]) resetFilter(f)
    }
    this.setAccent(Boolean(ev.accent))
    this.oscFreq = 440 * Math.pow(2, (ev.midi - 69) / 12)
    this.slewFreq = this.oscFreq
    this.meg = 1
    // MO soft attack: only on unaccented notes (TD-3: fixed short attack)
    const attack = this.p.model === 1 ? STOCK.attackMs : 30 * this.p.softAttack * this.p.softAttack
    this.ampAttackMs = this.noteAccent ? 0 : attack
    this.ampTime = 0
    this.noteOn = true
    this.idle = false
  }

  slide(ev) {
    this.oscFreq = 440 * Math.pow(2, (ev.midi - 69) / 12)
    this.setAccent(Boolean(ev.accent))
    this.idle = false
  }

  release() {
    this.noteOn = false
  }

  // ---- audio ---------------------------------------------------------------------------

  process(_inputs, outputs) {
    const out = outputs[0]
    const left = out[0]
    if (!left) return true
    const frames = left.length
    // the regular TD-3 has none of the MO controls: use stock values for them
    const p = this.p.model === 1 ? Object.assign(this.stockP, this.p, STOCK_OVERRIDES) : this.p
    const td3 = p.model === 1
    const sm = this.sm
    const fs = sampleRate
    const fsOs = this.fsOs
    const startFrame = currentFrame

    // per-block values
    const smoothK = 1 - Math.exp(-1 / (0.012 * fs))
    const slideMs = td3 ? STOCK.slideMs : expMap(p.slideTime, 30, 360) // TD-3: ~60 ms, MO: up to 6x
    const slewCoef = Math.exp(-1 / (0.001 * 0.2 * slideMs * fs))
    const sweepMs = [6, 15, 45][p.sweepSpeed] ?? 15
    const rc2Coef = Math.exp(-1 / (0.001 * sweepMs * fs))
    const sweepAmount = [0, 1, 1.6][p.accentSweep] ?? 1
    const sweepRes = p.accentSweep === 2 ? 0.35 : 0
    // MO: DECAY controls the VCA decay (Open303 fixed it at 1230 ms); fully up = drone
    // TD-3: fixed VCA decay
    const ampDecayMs = td3 ? STOCK.ampDecayMs : expMap(p.decay, 20, 6000)
    const ampDecayCoef = !td3 && p.decay >= 0.985 ? 0 : 1 - Math.exp(-1 / (0.001 * ampDecayMs * fs))
    const attackCoef = this.ampAttackMs > 0 ? 1 - Math.exp(-1 / (0.001 * this.ampAttackMs * fs)) : 1
    const tuningRatio = Math.pow(2, (p.tuning - 0.5) * 2)
    const subLevel = [0, 0.25, 0.45, 0.7][p.subOsc] || 0
    const fmDepth = Math.pow(p.filterFm, 3) * 4
    const mufflerKnee = [0, 0.7, 0.4][p.muffler] || 0
    const tables = this.tables[p.waveform === 1 ? 1 : 0]
    // Open303 scales the square by 0.5; OFF (2) mutes the main oscillator
    const waveGain = p.waveform === 1 ? 0.5 : p.waveform === 2 ? 0 : 1
    const r = (1 - Math.exp(-3 * sm.resonance)) / (1 - Math.exp(-3)) // Open303 resonance skew

    for (let i = 0; i < frames; i += 1) {
      const frame = startFrame + i
      while (this.queue.length && this.queue[0].frame <= frame) {
        const ev = this.queue.shift()
        if (ev.kind === 'on') {
          if (ev.slide && this.noteOn) this.slide(ev)
          else this.trigger(ev)
        } else if (ev.kind === 'off') {
          this.release()
        }
      }

      if (this.idle) {
        left[i] = 0
        continue
      }

      sm.cutoff += (p.cutoff - sm.cutoff) * smoothK
      sm.resonance += (p.resonance - sm.resonance) * smoothK
      sm.envMod += (p.envMod - sm.envMod) * smoothK
      sm.volume += (p.volume - sm.volume) * smoothK
      sm.overdrive += (p.overdrive - sm.overdrive) * smoothK

      // ---- pitch (Open303: leaky integrator on frequency)
      this.slewFreq = this.oscFreq + slewCoef * (this.slewFreq - this.oscFreq)
      const freq = this.slewFreq * tuningRatio

      // ---- main envelope + accent RC
      this.meg *= this.megCoef
      const accentIn = this.accentGain > 0 ? this.meg : 0
      this.rc2 = accentIn + rc2Coef * (this.rc2 - accentIn)

      // ---- cutoff: Open303 measured env-mod mapping (MO: wider cutoff range)
      const cutoffHz = td3 ? expMap(sm.cutoff, C0, C1) : expMap(sm.cutoff, C0 * 0.55, C1 * 1.35)
      const c = clamp(Math.log(cutoffHz / C0) / Math.log(C1 / C0), 0, 1)
      const e = sm.envMod
      const envScaler = (1 - c) * (ENV.sLoF * e + ENV.sLoC) + c * (ENV.sHiF * e + ENV.sHiC)
      const envOffset = ENV.oF * c + ENV.oC
      let oct = envScaler * (this.meg - envOffset) + this.accentGain * this.rc2 * sweepAmount
      if (p.filterTracking > 0) oct += Math.log2(freq / 65.41) * p.filterTracking
      if (fmDepth > 0) oct += this.lastOut * fmDepth
      const instCutoff = clamp(cutoffHz * Math.pow(2, oct), 10, fsOs * 0.2)

      // ---- TeeBee filter coefficients (Open303 TB_303 mode)
      const fx = (2 * PI * instCutoff / fsOs) * ONE_OVER_SQRT2 / (2 * PI)
      const b0 = (0.00045522346 + 6.1922189 * fx) / (1 + 12.358354 * fx + 4.4156345 * fx * fx)
      let k = fx * (fx * (fx * (fx * (fx * (fx + 7198.6997) - 5837.7917) - 476.47308) + 614.95611) + 213.87126) + 16.998792
      let g = k / 17
      const rr = clamp(r + this.rc2 * this.accentGain * sweepRes, 0, 1.05)
      g = ((g - 1) * rr + 1) * (1 + rr)
      k *= rr

      // ---- oscillator + filter, 4x oversampled
      const inc = freq / fsOs
      let level = 0
      while (level < tables.length - 1 && tables[level].maxH * freq > fs) level += 1
      const table = tables[level].data
      let filtered = 0
      for (let o = 0; o < OVERSAMPLING; o += 1) {
        const pos = this.phase * TABLE_SIZE
        const idx = pos | 0
        const frac = pos - idx
        let osc = -(table[idx] + frac * (table[idx + 1] - table[idx])) * waveGain
        this.phase += inc
        if (this.phase >= 1) this.phase -= 1

        if (subLevel > 0) {
          this.subPhase += inc * 0.5
          if (this.subPhase >= 1) this.subPhase -= 1
          osc += (this.subPhase < 0.5 ? subLevel : -subLevel) * 0.5
        }

        // tiny noise floor, as in the analog circuit: it lets a high resonance start ringing
        // when the oscillator is off (inaudible otherwise, about -80 dB)
        this.seed = (this.seed * 1664525 + 1013904223) >>> 0
        osc += (this.seed / 4294967296 - 0.5) * 2e-4

        let x = onePole(this.hp1, osc)
        const y0 = x - onePole(this.fbHp, k * this.y4)
        this.y1 += 2 * b0 * (y0 - this.y1 + this.y2)
        this.y2 += b0 * (this.y1 - 2 * this.y2 + this.y3)
        this.y3 += b0 * (this.y2 - 2 * this.y3 + this.y4)
        this.y4 += b0 * (this.y3 - 2 * this.y4)
        // keep self-oscillation bounded (the real circuit saturates too)
        if (this.y4 > 4 || this.y4 < -4) this.y4 = softTanh(this.y4 / 4) * 4
        x = 2 * g * this.y4
        filtered = biquad(this.aa2, biquad(this.aa1, x))
      }

      // ---- amp envelope (Open303 AnalogEnvelope + MEG contribution)
      if (this.noteOn) {
        // attack towards 1 (instant without soft attack), then decay towards 0
        if (this.ampTime <= this.ampAttackMs) this.amp += attackCoef * (1 - this.amp)
        else this.amp -= ampDecayCoef * this.amp
        this.ampTime += 1000 / fs
      } else {
        this.amp += this.ampReleaseCoef * (0 - this.amp)
      }
      let ampOut = this.amp
      if (this.noteOn) ampOut += 0.45 * this.meg + this.accentGain * 4 * this.meg
      ampOut = biquad(this.deClick, ampOut)

      // ---- post filters (Open303), VCA
      let sig = onePole(this.allpass, filtered)
      sig = onePole(this.hp2, sig)
      sig = biquad(this.notch, sig)
      sig *= ampOut * 0.25 // Open303 level -12 dB
      this.lastOut = sig

      // ---- MO muffler: soft clipping of the VCA output
      if (mufflerKnee > 0) {
        const a = Math.abs(sig)
        if (a > mufflerKnee) {
          const over = a - mufflerKnee
          sig = Math.sign(sig) * (mufflerKnee + over / (1 + over * 3))
        }
      }

      if (td3) {
        // ---- TD-3 distortion (DS-1 style): emphasis + clipper, tone blend, output level
        if (p.distOn === 1) {
          const pre = onePole(this.distPre, sig) * expMap(p.distDrive, 4, 120)
          const clipped = pre > 0 ? softTanh(pre) : softTanh(pre * 0.85) / 0.85
          this.distLp.y += this.distLp.a * (clipped - this.distLp.y)
          this.distHp.y += this.distHp.a * (clipped - this.distHp.y)
          const high = clipped - this.distHp.y
          const toned = this.distLp.y * (1 - p.distTone) + high * p.distTone * 1.6
          sig = toned * 0.85 * Math.pow(p.distLevel, 1.6)
        }
      } else {
        // ---- MO overdrive
        const drive = 0.6 + sm.overdrive * sm.overdrive * 14
        sig = softTanh(sig * drive) / (Math.sqrt(drive) * 0.8)
      }

      sig *= sm.volume * sm.volume * 2.2

      // DC blocker
      const dc = sig - this.dcX + 0.9995 * this.dcY
      this.dcX = sig
      this.dcY = dc
      // output safety: soft knee above 0.8, never exceeds 1.0
      const mag = Math.abs(dc)
      left[i] = mag > 0.8 ? Math.sign(dc) * (0.8 + 0.2 * Math.tanh((mag - 0.8) / 0.2)) : dc

      // go idle when the voice has fully released
      if (!this.noteOn && this.amp < 1e-5 && Math.abs(dc) < 1e-5 && this.meg < 1e-3) {
        this.idle = true
        this.amp = 0
      }
    }

    for (let ch = 1; ch < out.length; ch += 1) out[ch].set(left)
    return true
  }
}

registerProcessor('td3-voice', TD3Voice)
