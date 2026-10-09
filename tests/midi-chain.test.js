import { describe, expect, it } from 'vitest'
import { LIBRARY } from '../src/model/library.js'
import { decodeMidi, encodeMidi, patternNotes } from '../src/model/midi.js'
import { clonePattern } from '../src/model/pattern.js'
import { decodeSeq, encodeSeq } from '../src/model/td3format.js'

// strip slides into the same pitch / across pattern ends, which MIDI can't express
const comparable = (pattern) =>
  patternNotes(pattern).map((n, i, arr) => ({
    ...n,
    slide: Boolean(n.slide && arr[i + 1] && arr[i + 1].start === n.end && arr[i + 1].pitch !== n.pitch)
  }))

const full = (entry) => {
  const p = clonePattern(entry.pattern)
  p.length = 16
  return p
}

describe('multi-pattern MIDI', () => {
  it('splits a 4-bar file into 4 patterns', () => {
    const chain = LIBRARY.slice(0, 4).map(full)
    const back = decodeMidi(encodeMidi(chain, { bpm: 128 }), { maxPatterns: 8 })
    expect(back.patterns).toHaveLength(4)
    expect(back.truncated).toBe(false)
    back.patterns.forEach((p, i) => expect(comparable(p)).toEqual(comparable(chain[i])))
  })

  it('reports truncation when there are more bars than slots', () => {
    const chain = LIBRARY.slice(0, 3).map(full)
    const back = decodeMidi(encodeMidi(chain), { maxPatterns: 2 })
    expect(back.patterns).toHaveLength(2)
    expect(back.truncated).toBe(true)
  })

  it('keeps the old single-pattern behaviour by default', () => {
    const back = decodeMidi(encodeMidi(LIBRARY.slice(0, 2).map(full)))
    expect(back.patterns).toHaveLength(1)
    expect(back.truncated).toBe(true)
  })
})

describe('triplet patterns', () => {
  const triplet = () => {
    const p = clonePattern(LIBRARY.find((e) => e.name === 'Minor Arp').pattern)
    p.triplet = true
    return p
  }

  it('survive a MIDI round-trip', () => {
    const back = decodeMidi(encodeMidi(triplet(), { bpm: 120 }))
    expect(back.pattern.triplet).toBe(true)
    expect(comparable(back.pattern)).toEqual(comparable(triplet()))
  })

  it('survive a .seq round-trip', () => {
    const back = decodeSeq(encodeSeq(triplet()))
    expect(back.triplet).toBe(true)
    expect(back.pattern.triplet).toBe(true)
  })

  it('straight 16ths are not detected as triplets', () => {
    for (const e of LIBRARY) expect(decodeMidi(encodeMidi(e.pattern)).pattern.triplet).toBe(false)
  })
})
