import { describe, expect, it } from 'vitest'
import { patternNotes } from '../src/model/midi.js'
import { parsePattern, pitchOf } from '../src/model/pattern.js'
import { inScale, normalizeScale, snapPitch } from '../src/model/scale.js'
import { euclid, generatePattern, mutatePattern, normalizeGenerator, seededRandom } from '../src/model/generate.js'
import { doubleSpeed, fitToScale, halfSpeed, invertPattern, reversePattern, rotateFlags } from '../src/model/transform.js'

const notesOf = (p) => patternNotes(p).map((n) => [n.start, n.end, n.pitch, n.accent ? 'a' : '', n.slide ? 's' : ''].join(':'))

describe('scale', () => {
  const cMinor = { root: 0, type: 'minor', lock: true }
  it('knows its pitches in every octave', () => {
    expect([0, 2, 3, 5, 7, 8, 10, 12, -2, 15].every((p) => inScale(cMinor, p))).toBe(true)
    expect([1, 4, 6, 9, 11, 13, -1].some((p) => inScale(cMinor, p))).toBe(false)
  })
  it('snaps to the nearest scale tone (ties go down) and nudges by scale degree', () => {
    expect(snapPitch(cMinor, 4)).toBe(3)
    expect(snapPitch(cMinor, 6)).toBe(5)
    expect(snapPitch(cMinor, 11)).toBe(10)
    expect(snapPitch(cMinor, 24 - 1)).toBe(22)
    expect(snapPitch(cMinor, 3, 1)).toBe(5)
    expect(snapPitch(cMinor, 3, -1)).toBe(2)
    expect(snapPitch({ root: 9, type: 'minorPenta' }, 10)).toBe(9) // A minor pentatonic
  })
  it('normalises stored settings', () => {
    expect(normalizeScale({ root: 14, type: 'nope', lock: 'x' })).toEqual({ root: 0, type: 'chromatic', lock: true })
    expect(normalizeScale({ root: 5, type: 'phrygian', lock: false })).toEqual({ root: 5, type: 'phrygian', lock: false })
  })
})

describe('transforms', () => {
  // C (accent) held 2 steps, slides into D#, rest, G, rest x3  (length 8)
  const base = () => {
    const p = parsePattern('Ca - D# . G . . .')
    p.steps[1].slide = true // slide sits on the last step of the held C
    return p
  }

  it('reverses notes and moves the slide to the note that now comes first', () => {
    const r = reversePattern(base())
    expect(notesOf(r)).toEqual(['3:4:7::', '5:6:3::s', '6:8:0:a:'])
  })

  it('reversing twice gives the original notes back', () => {
    const p = parsePattern('Ca D#s F . G - A#s C+a')
    expect(notesOf(reversePattern(reversePattern(p)))).toEqual(notesOf(p))
  })

  it('inverts within the melody range and can snap to a scale', () => {
    const inv = invertPattern(base())
    expect(patternNotes(inv).map((n) => n.pitch)).toEqual([7, 4, 0])
    const snapped = invertPattern(base(), { root: 0, type: 'minor' })
    expect(patternNotes(snapped).map((n) => n.pitch)).toEqual([7, 3, 0])
  })

  it('rotates accents and slides from note to note', () => {
    const r = rotateFlags(base(), 'accent', 1)
    expect(patternNotes(r).map((n) => n.accent)).toEqual([false, true, false])
    const s = rotateFlags(base(), 'slide', -1)
    expect(patternNotes(s).map((n) => n.slide)).toEqual([false, false, true])
  })

  it('doubles and halves the speed', () => {
    const p = parsePattern('C . D# . F - . G')
    expect(notesOf(doubleSpeed(p))).toEqual(['0:1:0::', '1:2:3::', '2:3:5::', '3:4:7::', '4:5:0::', '5:6:3::', '6:7:5::', '7:8:7::'])
    expect(notesOf(halfSpeed(p))).toEqual(['0:2:0::', '4:6:3::'])
  })

  it('fits notes into a scale and keeps steps beyond the length', () => {
    const p = parsePattern('C E F#')
    p.length = 2
    const fitted = fitToScale(p, { root: 0, type: 'minor' })
    expect(fitted.steps.slice(0, 2).map(pitchOf)).toEqual([0, 3])
    expect(fitted.steps[2]).toEqual(p.steps[2])
  })
})

describe('generator', () => {
  it('spreads Euclidean hits evenly', () => {
    expect(euclid(4, 16).map(Number).join('')).toBe('1000100010001000')
    expect(euclid(3, 8).filter(Boolean).length).toBe(3)
  })

  it('makes valid patterns inside the scale and range', () => {
    const scale = { root: 2, type: 'phrygian' }
    for (let seed = 1; seed < 30; seed += 1) {
      const p = generatePattern(16, { range: 1, rhythm: seed % 2 ? 'even' : 'random' }, scale, seededRandom(seed))
      const notes = patternNotes(p)
      expect(notes.length).toBeGreaterThan(0)
      notes.forEach((n) => {
        expect(inScale(scale, n.pitch)).toBe(true)
        expect(n.pitch).toBeGreaterThanOrEqual(2)
        expect(n.pitch).toBeLessThanOrEqual(14)
      })
      p.steps.forEach((s, i) => {
        if (s.time === 'tie') expect(['note', 'tie']).toContain(p.steps[i - 1].time)
      })
    }
  })

  it('follows the density setting with the even rhythm', () => {
    const p = generatePattern(16, { density: 0.25, ties: 0, rhythm: 'even' }, null, seededRandom(3))
    expect(patternNotes(p).length).toBe(4)
  })

  it('mutates a little, not everything', () => {
    const p = parsePattern('C D# F G A# C+ G F D# C . C D# F G C')
    const m = mutatePattern(p, normalizeGenerator({}), { root: 0, type: 'minor' }, seededRandom(7), 0.2)
    const before = notesOf(p)
    const after = notesOf(m)
    const same = after.filter((n) => before.includes(n)).length
    expect(same).toBeGreaterThan(before.length / 2)
    expect(after).not.toEqual(before)
  })
})
