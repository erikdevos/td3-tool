import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { impulseResponse } from '../src/audio/reverb.js'
import { UNITY, defaultMixer, duckFloor, faderDb, faderGain, isDry, normalizeMixer } from '../src/model/mixer.js'

// Load the fx worklet in Node: it only needs AudioWorkletProcessor, registerProcessor, sampleRate.
const loadFxStrip = () => {
  let Processor = null
  globalThis.sampleRate = 48000
  globalThis.AudioWorkletProcessor = class {}
  globalThis.registerProcessor = (_name, cls) => {
    Processor = cls
  }
  new Function(readFileSync(new URL('../src/audio/fx-strip.worklet.js', import.meta.url), 'utf8'))()
  return Processor
}
const FxStrip = loadFxStrip()

// run a stereo signal through the strip in 128-frame blocks
const runStrip = (left, right, { drive = 0, comp = 0 } = {}) => {
  const fx = new FxStrip({ processorOptions: {} })
  const out = [new Float32Array(left.length), new Float32Array(left.length)]
  for (let i = 0; i < left.length; i += 128) {
    const input = [left.slice(i, i + 128), right.slice(i, i + 128)]
    const output = [new Float32Array(128), new Float32Array(128)]
    fx.process([input], [output], { drive: [drive], comp: [comp] })
    out[0].set(output[0], i)
    out[1].set(output[1], i)
  }
  return out
}

const sine = (freq, amp, seconds) =>
  Float32Array.from({ length: Math.round(seconds * 48000) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / 48000))
const peak = (x, from = 0) => x.slice(from).reduce((m, v) => Math.max(m, Math.abs(v)), 0)

describe('mixer settings', () => {
  it('starts dry at 0 dB and survives junk in storage', () => {
    const d = defaultMixer()
    expect(faderGain(d.td3.volume)).toBe(1)
    expect(faderGain(d.master.volume)).toBe(1)
    expect(isDry(d.td3)).toBe(true)
    expect(normalizeMixer(null)).toEqual(d)
    const m = normalizeMixer({ td3: { drive: 3, mute: 'yes', bogus: 1 }, master: { volume: -1 } })
    expect(m.td3).toMatchObject({ drive: 1, mute: false })
    expect(m.td3).not.toHaveProperty('bogus')
    expect(m.master.volume).toBe(0)
  })

  it('maps the faders and the duck', () => {
    expect(faderGain(0)).toBe(0)
    expect(faderDb(UNITY)).toBe(0)
    expect(faderDb(1)).toBeCloseTo(5.8, 1)
    expect(duckFloor(0)).toBe(1)
    expect(20 * Math.log10(duckFloor(1))).toBeCloseTo(-24.4, 1)
  })
})

describe('fx strip worklet', () => {
  it('passes the signal through bit for bit with drive and comp at 0', () => {
    const left = Float32Array.from({ length: 4096 }, (_, i) => Math.sin(i * 0.37) * 0.8)
    const right = Float32Array.from({ length: 4096 }, (_, i) => Math.cos(i * 0.11) * 0.3)
    const [l, r] = runStrip(left, right)
    expect(l).toEqual(left)
    expect(r).toEqual(right)
  })

  it('drive clips loud peaks and lifts quiet parts', () => {
    const loud = sine(110, 0.9, 0.2)
    const [l] = runStrip(loud, loud, { drive: 1 })
    expect(peak(l)).toBeLessThan(0.6)
    const quiet = sine(110, 0.05, 0.2)
    const [q] = runStrip(quiet, quiet, { drive: 1 })
    expect(peak(q, 2400)).toBeGreaterThan(0.2)
    l.forEach((v) => expect(Number.isFinite(v)).toBe(true))
  })

  it('comp narrows the gap between loud and quiet', () => {
    const settle = 24000 // judge after 0.5 s
    const [loud] = runStrip(sine(110, 0.9, 1), sine(110, 0.9, 1), { comp: 1 })
    const [quiet] = runStrip(sine(110, 0.01, 1), sine(110, 0.01, 1), { comp: 1 })
    const ratioIn = 0.9 / 0.01
    const ratioOut = peak(loud, settle) / peak(quiet, settle)
    expect(ratioOut).toBeLessThan(ratioIn / 10)
  })

  it('comp keeps sudden hits below 0 dBFS (soft ceiling, no lookahead)', () => {
    // hard clicks every 50 ms on a quiet bed: the worst case for a compressor without lookahead
    const x = Float32Array.from({ length: 48000 }, (_, i) => (i % 2400 < 24 ? 1 : 0.02 * Math.sin(i * 0.05)))
    ;[0.25, 0.5, 1].forEach((comp) => {
      const [l] = runStrip(x, x, { comp })
      expect(peak(l)).toBeLessThan(1)
    })
  })

  it('outputs silence without an input', () => {
    const fx = new FxStrip({ processorOptions: {} })
    const output = [new Float32Array(128).fill(1), new Float32Array(128).fill(1)]
    expect(fx.process([[]], [output], { drive: [0.5], comp: [0.5] })).toBe(true)
    expect(peak(output[0])).toBe(0)
  })
})

describe('reverb impulse response', () => {
  it('is stereo, decays, and has a fixed energy', () => {
    const [left, right] = impulseResponse(48000, 2)
    expect(left.length).toBe(Math.round(0.012 * 48000) + 96000)
    expect(left.slice(0, 500).every((v) => v === 0)).toBe(true) // pre-delay
    const energy = (x) => x.reduce((s, v) => s + v * v, 0)
    expect(energy(left)).toBeCloseTo(0.25, 3)
    expect(energy(right)).toBeCloseTo(0.25, 3)
    const tenth = Math.round(left.length / 10)
    expect(energy(left.slice(-tenth))).toBeLessThan(energy(left.slice(600, 600 + tenth)) / 1000)
    expect(left).not.toEqual(right)
  })
})
