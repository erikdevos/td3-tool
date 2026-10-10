import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderVoice } from '../src/audio/drumkit.js'
import {
  DRUM_STEPS,
  GROOVES,
  KITS,
  VOICE_KEYS,
  decayTime,
  defaultDrums,
  grooveSteps,
  isEmptySteps,
  normalizeDrums,
  serializeDrums,
  tuneRate
} from '../src/model/drums.js'
import { makePattern, makeStep } from '../src/model/pattern.js'

// The sequencer only needs the AudioContext clock from the engine: drive it by hand.
const audio = vi.hoisted(() => ({ now: 0 }))
vi.mock('../src/audio/engine.js', () => ({
  audioTime: () => audio.now,
  clearVoice: () => {},
  outputClockReady: async () => {},
  resumeAudio: async () => {},
  sendEvents: () => {}
}))
const { createSequencer } = await import('../src/audio/sequencer.js')

describe('drum kits', () => {
  it('renders every voice of every kit: finite, at its peak level, silent at the end', () => {
    const peaks = { bd: 0.9, sd: 0.72, ch: 0.42, oh: 0.42, cy: 0.38 }
    KITS.forEach((kit) => {
      VOICE_KEYS.forEach((voice) => {
        const hit = renderVoice(kit, voice, 44100)
        expect(hit.length).toBeGreaterThan(44100 * 0.2)
        let peak = 0
        hit.forEach((s) => {
          expect(Number.isFinite(s)).toBe(true)
          peak = Math.max(peak, Math.abs(s))
        })
        expect(peak).toBeCloseTo(peaks[voice], 2)
        expect(Math.abs(hit[0])).toBe(0)
        expect(Math.abs(hit[hit.length - 1])).toBe(0)
      })
    })
  })

  it('renders the same hit every time and gives each kit its own sound', () => {
    expect(renderVoice('909', 'sd', 48000)).toEqual(renderVoice('909', 'sd', 48000))
    // the 606 kick is short, the 808 kick booms
    expect(renderVoice('606', 'bd', 48000).length).toBeLessThan(renderVoice('808', 'bd', 48000).length / 2)
    expect(() => renderVoice('707', 'bd', 48000)).toThrow()
  })
})

describe('drum model', () => {
  it('has grooves of 16 steps on known voices, each with a kick', () => {
    GROOVES.forEach((g) => {
      Object.entries(g.rows).forEach(([voice, row]) => {
        expect(VOICE_KEYS).toContain(voice)
        expect(row).toMatch(/^[x.]{16}$/)
      })
      expect(g.rows.bd).toContain('x')
    })
    const house = grooveSteps(GROOVES.find((g) => g.name === 'House'))
    expect(house.bd.filter(Boolean)).toHaveLength(4)
    expect(house.cy.some(Boolean)).toBe(false)
  })

  it('starts empty and survives junk in storage', () => {
    expect(isEmptySteps(defaultDrums().steps)).toBe(true)
    expect(normalizeDrums(null)).toEqual(defaultDrums())
    const d = normalizeDrums({ kit: '707', volume: 7, steps: { bd: 'x..x', zz: 'xxxx' }, voices: { sd: { tune: -1, mute: true } } })
    expect(d.kit).toBe('909')
    expect(d.volume).toBe(1)
    expect(d.steps.bd).toHaveLength(DRUM_STEPS)
    expect(d.steps.bd.slice(0, 4)).toEqual([true, false, false, true])
    expect(d.steps).not.toHaveProperty('zz')
    expect(d.voices.sd).toMatchObject({ tune: 0, mute: true })
  })

  it('stores rows as readable strings and reads them back', () => {
    const d = normalizeDrums({ kit: '808', steps: grooveSteps(GROOVES[3]) })
    const stored = serializeDrums(d)
    expect(stored.steps.bd).toBe('x...x...x...x...')
    expect(normalizeDrums(JSON.parse(JSON.stringify(stored)))).toEqual(d)
  })

  it('maps the knobs', () => {
    expect(tuneRate(0.5)).toBe(1)
    expect(tuneRate(0)).toBe(0.5)
    expect(tuneRate(1)).toBe(2)
    expect(decayTime(1)).toBe(Infinity)
    expect(decayTime(0)).toBeCloseTo(0.015)
  })
})

describe('sequencer master clock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    globalThis.requestAnimationFrame = () => 0
    globalThis.cancelAnimationFrame = () => {}
    audio.now = 0
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // run the sequencer for `seconds` of audio time, calling change(t) on every timer wake-up
  const run = async (state, seconds, change = () => {}) => {
    const notes = []
    const sixteenths = []
    const clocks = []
    const seq = createSequencer({
      getState: () => state,
      onWrap: () => {},
      onStep: () => {},
      output: (events) => events.filter((e) => e.kind === 'on').forEach((e) => notes.push(e.time)),
      onClock: (kind, time) => kind === 'tick' && clocks.push(time),
      onSixteenth: (n, time) => sixteenths.push(time)
    })
    await seq.start()
    while (audio.now < seconds) {
      audio.now += 0.025
      change(audio.now)
      vi.advanceTimersByTime(25)
    }
    seq.stop()
    return { notes, sixteenths, clocks }
  }

  const allNotes = (triplet = false) => {
    const p = makePattern()
    p.steps = p.steps.map(() => makeStep({ time: 'note' }))
    p.triplet = triplet
    return p
  }

  it('keeps TD-3 steps, drum 16ths and MIDI clock on the same times while the tempo changes', async () => {
    const state = { pattern: allNotes(), bpm: 120, shuffle: 0.4 }
    // sweep the tempo like a knob drag: a new value every 25 ms
    const { notes, sixteenths, clocks } = await run(state, 6, (t) => {
      state.bpm = Math.round(120 + 40 * Math.sin(t * 2))
    })
    expect(notes.length).toBeGreaterThan(40)
    expect(sixteenths.slice(0, notes.length)).toEqual(notes) // same shuffle on both
    // unshuffled 16ths sit exactly on every 6th clock tick
    notes.forEach((time, i) => {
      if (i % 2 === 0) expect(time).toBe(clocks[i * 6])
    })
  })

  it('runs triplet steps every 4 clock ticks, next to straight drum 16ths', async () => {
    const { notes, sixteenths, clocks } = await run({ pattern: allNotes(true), bpm: 132, shuffle: 0 }, 3)
    notes.forEach((time, i) => expect(time).toBe(clocks[i * 4]))
    sixteenths.forEach((time, i) => expect(time).toBe(clocks[i * 6]))
    // three triplet steps in the time of two 16ths
    expect(notes[3]).toBe(sixteenths[2])
  })
})
