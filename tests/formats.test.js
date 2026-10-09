import { describe, expect, it } from 'vitest'
import { LIBRARY } from '../src/model/library.js'
import { decodeMidi, encodeMidi, patternNotes } from '../src/model/midi.js'
import { noteLabel } from '../src/model/pattern.js'
import {
  decodePatternSysex,
  decodePayload,
  decodeSeq,
  encodePatternSysex,
  encodeSeq,
  requestPatternSysex
} from '../src/model/td3format.js'

const notesOf = (pattern) => JSON.stringify(patternNotes(pattern))

describe('Standard MIDI File', () => {
  it.each(LIBRARY.map((e) => [e.name, e]))('round-trips %s', (_, entry) => {
    const back = decodeMidi(encodeMidi(entry.pattern, { bpm: entry.bpm, name: entry.name }))
    // a slide survives only when it leads into a different pitch (same-pitch slides export legato)
    const expected = patternNotes(entry.pattern).map((n, i, arr) => ({
      ...n,
      slide: Boolean(n.slide && arr[i + 1] && arr[i + 1].start === n.end && arr[i + 1].pitch !== n.pitch)
    }))
    expect(JSON.stringify(patternNotes(back.pattern))).toBe(JSON.stringify(expected))
    expect(back.bpm).toBe(entry.bpm)
    expect(back.truncated).toBe(false)
  })

  it('writes a valid header and end-of-track', () => {
    const bytes = encodeMidi(LIBRARY[0].pattern)
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('MThd')
    expect([...bytes.subarray(-3)]).toEqual([0xff, 0x2f, 0x00])
  })
})

describe('TD-3 .seq and SysEx', () => {
  it.each(LIBRARY.map((e) => [e.name, e]))('round-trips %s', (_, entry) => {
    const seq = decodeSeq(encodeSeq(entry.pattern))
    expect(notesOf(seq.pattern)).toBe(notesOf(entry.pattern))
    expect(seq.pattern.length).toBe(entry.pattern.length)

    const syx = decodePatternSysex(encodePatternSysex(entry.pattern, { group: 2, section: 1, number: 3 }))
    expect(notesOf(syx.pattern)).toBe(notesOf(entry.pattern))
    expect(syx.group).toBe(2)
    expect(syx.slot).toBe(11)
  })

  it('writes the same .seq header as Acid-Injector', () => {
    const ref = [
      0x23, 0x98, 0x54, 0x76, 0x00, 0x00, 0x00, 0x08, 0x00, 0x54, 0x00, 0x44, 0x00, 0x2d, 0x00, 0x33, 0x00, 0x00,
      0x00, 0x0a, 0x00, 0x31, 0x00, 0x2e, 0x00, 0x33, 0x00, 0x2e, 0x00, 0x37, 0x00, 0x00, 0x00, 0x70, 0x00, 0x00
    ]
    expect([...encodeSeq(LIBRARY[0].pattern).subarray(0, ref.length)]).toEqual(ref)
  })

  it('builds the pattern request message', () => {
    expect([...requestPatternSysex({ group: 3, section: 1, number: 7 })]).toEqual([
      0xf0, 0x00, 0x20, 0x32, 0x00, 0x01, 0x0a, 0x77, 3, 15, 0xf7
    ])
  })

  it('decodes the hardware dump published in the td3-pattern README', () => {
    // payload after "78 03 0f 00 01"
    const dump = [
      0x01, 0x0b, 0x01, 0x0b, 0x00, 0x0d, 0x01, 0x09, 0x00, 0x0d, 0x02, 0x0c, 0x02, 0x07, 0x02, 0x07, 0x02, 0x0c, 0x02,
      0x07, 0x01, 0x0c, 0x02, 0x07, 0x01, 0x0b, 0x02, 0x05, 0x00, 0x0f, 0x02, 0x0c,
      0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 1, 0, 0, 0, 0x09, 0x0d, 0x09, 0x09, 0, 0, 2, 0
    ]
    const { pattern } = decodePayload(new Uint8Array(dump))
    const text = pattern.steps.map((s) =>
      s.time === 'note' ? noteLabel(s) + (s.octave > 0 ? '+' : s.octave < 0 ? '-' : '') : s.time === 'tie' ? '~' : '.'
    )
    expect(pattern.length).toBe(16)
    // The README lists the pitch pool D# D# C#(DN) C# C#(DN) G#(UP) D#(UP) D#(UP) G#(UP) ...;
    // ties consume no pool entry, so the notes appear in that order between the holds.
    expect(text.join(' ')).toBe('D# D# ~ C#- C# C#- ~ ~ G#+ D#+ ~ ~ D#+ . G#+ ~')
  })
})
