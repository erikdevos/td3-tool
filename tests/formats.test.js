import { describe, expect, it } from 'vitest'
import { LIBRARY } from '../src/model/library.js'
import { decodeMidi, encodeMidi, patternNotes } from '../src/model/midi.js'
import { clonePattern, makePattern, makeStep } from '../src/model/pattern.js'
import {
  decodeBankFile,
  decodePatternSysex,
  decodeSqs,
  decodePayload,
  decodeSeq,
  encodePayload,
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

  // Ground truth from a real TD-3-MO (firmware 2.0.1): slot I-A2 as received over SysEx, and the
  // notes the device itself played from that slot (recorded from its MIDI out, 6 clocks per step):
  //   step 0 C3(48) · 1 E3(52) held through 3 · 4 rest · 5 D#3(51) · 6 F#3(54) held through 7 ·
  //   8 G#2(44) · 9 C1(24) accent, held through 10 · 11-14 silent · 15 G3(55)
  it('decodes a real TD-3-MO dump exactly as the device plays it', () => {
    const msg = new Uint8Array([
      240, 0, 32, 50, 0, 1, 10, 120, 0, 1, 0, 0, 2, 4, 2, 8, 2, 7, 2, 10, 2, 0, 0, 12, 2, 11, 2, 11, 2, 12, 1, 13, 2,
      13, 2, 13, 1, 0, 2, 5, 2, 10, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 1, 0, 0, 0, 7, 3, 9, 3, 1, 0, 3, 8, 247
    ])
    const { pattern, group, slot, marker } = decodePatternSysex(msg)
    expect([group, slot, marker, pattern.length]).toEqual([0, 1, 0, 16])
    const played = patternNotes(pattern).map((n) => [n.start, n.end, 36 + n.pitch, n.accent])
    expect(played).toEqual([
      [0, 1, 48, false],
      [1, 4, 52, false],
      [5, 6, 51, false],
      [6, 8, 54, false],
      [8, 9, 44, false],
      [9, 11, 24, true],
      [15, 16, 55, false]
    ])
    // re-encoding keeps the same music
    const again = decodePayload(encodePayload(pattern)).pattern
    expect(patternNotes(again)).toEqual(patternNotes(pattern))
  })

  it('stores steps beyond the pattern length', () => {
    const p = clonePattern(LIBRARY[0].pattern)
    p.length = 8
    const back = decodePayload(encodePayload(p)).pattern
    expect(back.length).toBe(8)
    expect(patternNotes({ ...back, length: 16 })).toEqual(patternNotes({ ...p, length: 16 }))
  })

  it('writes ties on the continuing step (gate bit 0) and keeps the marker byte', () => {
    const p = makePattern()
    p.steps[0] = makeStep({ time: 'note' })
    p.steps[1] = makeStep({ time: 'tie' })
    p.steps[2] = makeStep({ time: 'tie' })
    const bytes = encodePayload(p)
    const gate = ((bytes[102] & 15) << 4) | (bytes[103] & 15) | ((bytes[104] & 15) << 12) | ((bytes[105] & 15) << 8)
    const rest = ((bytes[106] & 15) << 4) | (bytes[107] & 15) | ((bytes[108] & 15) << 12) | ((bytes[109] & 15) << 8)
    expect(gate & 0b111).toBe(0b001) // step 0 starts the note, steps 1-2 are ties
    expect(rest & 0b1111).toBe(0b1000) // steps 0-2 sound, step 3 rests
    const msg = encodePatternSysex(p, { group: 1, section: 0, number: 2 }, 0x0a, 1)
    expect([...msg.subarray(8, 12)]).toEqual([1, 2, 0, 1])
  })
})

describe('SynthTribe .sqs bank', () => {
  // Builds a file in the layout of real SynthTribe exports (magic, two UTF-16BE strings, records).
  const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
  const utf16 = (s) => [...s].flatMap((c) => [0, c.charCodeAt(0)])
  const sqs = (records, device = 'TD-3', version = '1.3.7') =>
    new Uint8Array([
      0x87, 0x43, 0x91, 0x02,
      ...u32(device.length * 2), ...utf16(device),
      ...u32(version.length * 2), ...utf16(version),
      ...records.flatMap(({ group, slot, pattern, marker = 0 }) => [
        ...u32(group), ...u32(slot), ...u32(112),
        ...[...encodePatternSysex(pattern, { group, section: slot >> 3, number: slot & 7 }, 0x0a, marker)].slice(10, 122)
      ])
    ])

  it('reads every record by its group / slot, including a TD-3-MO header', () => {
    const records = [
      { group: 0, slot: 0, pattern: LIBRARY[0].pattern },
      { group: 3, slot: 15, pattern: LIBRARY[1].pattern, marker: 1 },
      { group: 1, slot: 9, pattern: LIBRARY[2].pattern }
    ]
    const bytes = sqs(records, 'TD-3-MO', '2.0.1')
    const { device, version, entries } = decodeSqs(bytes)
    expect([device, version]).toEqual(['TD-3-MO', '2.0.1'])
    expect(entries.map((e) => e.index)).toEqual([0, 63, 16 + 9])
    expect(entries[1].marker).toBe(1)
    records.forEach((r, i) => expect(patternNotes(entries[i].pattern)).toEqual(patternNotes(r.pattern)))
    // each entry is also a valid pattern message for a restore
    expect(entries[2].raw.length).toBe(123)
    expect(decodeBankFile(bytes).kind).toBe('SQS')
  })

  it('a full TD-3 bank is 7966 bytes', () => {
    const all = Array.from({ length: 64 }, (_, i) => ({ group: i >> 4, slot: i & 15, pattern: LIBRARY[i % LIBRARY.length].pattern }))
    const bytes = sqs(all)
    expect(bytes.length).toBe(7966)
    expect(decodeSqs(bytes).entries).toHaveLength(64)
  })

  it('refuses other devices and broken records', () => {
    expect(() => decodeSqs(sqs([], 'CRAVE'))).toThrow(/not a TD-3/)
    const bad = sqs([{ group: 0, slot: 0, pattern: LIBRARY[0].pattern }])
    bad[bad.length - 113] = 0x50 // record length 0x70 -> 0x50... corrupt the length field
    expect(() => decodeSqs(bad)).toThrow()
  })
})
