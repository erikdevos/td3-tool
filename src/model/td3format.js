// Behringer TD-3 pattern binary format: SynthTribe .seq files and SysEx pattern messages.
//
// Both wrap the same 110-byte pattern payload. Layout and semantics were assembled from
// public reverse-engineering notes (no official spec exists) and then checked on a real
// TD-3-MO (firmware 2.0.1) by letting it play a received pattern and recording its MIDI out:
//   - 303patterns.com/td3-midi.html (Brad Isbell, unofficial MIDI implementation)
//   - github.com/echolevel/Acid-Injector (writes .seq/.syx; source of the .seq header)
//   - github.com/beholder-d/td3-pattern (payload dump)
//   - github.com/mattWoolly/TD-3-Commander docs/DESIGN.md (MIT; measured on a TD-3-MO 2.0.1)
// This file is an independent implementation; no code was copied from those projects.
//
// SysEx pattern message: F0 00 20 32 00 01 0A 78 <group 0-3> <slot 0-15> <marker hi> <marker lo>
// + 110-byte payload + F7 (123 bytes). The marker reads 00 on used slots; it is kept as read.
//
// Payload (110 bytes). Every value is split in two "nibble bytes": hi 4 bits, lo 4 bits.
//   0   32  pitch pool, 16 x (hi, lo)   value = 24 + semitones from bottom C, bit 7 = key C'
//   32  32  accent pool, 16 x (0, flag)
//   64  32  slide pool,  16 x (0, flag)
//   96   2  triplet (0, flag)
//   98   2  step count (hi, lo), 1..16
//   100  2  reserved, 00 00
//   102  4  gate mask  bit = 1: the step starts a note, bit = 0: the step is a tie
//   106  4  rest mask  bit = 1: rest (wins over the gate bit)
//   16-bit masks are stored as nibbles in the order [bits 4-7, 0-3, 12-15, 8-11].
//
// Per step: rest bit set -> rest; else gate bit set -> new note; else tie (the step continues
// the previous note; a tie after a rest is silent). Verified on hardware.
//
// Like the original TB-303, pitch / accent / slide are a POOL of notes, not per step:
// the sequencer takes the next pool entry for every step that starts a new note.
// Ties and rests consume nothing. Steps beyond the active length are stored too.

import { MAX_STEPS, fromPitch, makePattern, makeStep, pitchOf } from './pattern.js'
import { patternNotes } from './midi.js'

export const PAYLOAD_SIZE = 110
const PITCH_OFFSET = 24 // payload value of key C without transpose
const EMPTY_PITCH = 0x18
const SYSEX_HEADER = [0xf0, 0x00, 0x20, 0x32, 0x00, 0x01]
export const TD3_MODEL_ID = 0x0a
const CMD_PATTERN = 0x78
const CMD_REQUEST_PATTERN = 0x77
const SEQ_MAGIC = [0x23, 0x98, 0x54, 0x76]

const nib = (v) => [(v >> 4) & 0x0f, v & 0x0f]
const unnib = (hi, lo) => ((hi & 0x0f) << 4) | (lo & 0x0f)

const maskToNibbles = (m) => [(m >> 4) & 0x0f, m & 0x0f, (m >> 12) & 0x0f, (m >> 8) & 0x0f]
const nibblesToMask = (b) => ((b[0] & 0x0f) << 4) | (b[1] & 0x0f) | ((b[2] & 0x0f) << 12) | ((b[3] & 0x0f) << 8)

// ---- payload -----------------------------------------------------------------------

/** Editor pattern -> 110-byte TD-3 payload. All 16 steps are stored, also beyond the length. */
export const encodePayload = (pattern) => {
  const out = new Uint8Array(PAYLOAD_SIZE)
  const notes = patternNotes({ ...pattern, length: MAX_STEPS }) // note + following ties = one pool entry
  let gateMask = 0xffff
  let restMask = 0xffff

  for (let k = 0; k < 16; k += 1) {
    const n = notes[k]
    let value = EMPTY_PITCH
    if (n) {
      const step = pattern.steps[n.start]
      value = Math.min(0x7f, Math.max(0, PITCH_OFFSET + n.pitch)) | (step.note === 12 ? 0x80 : 0)
    }
    out.set(nib(value), k * 2)
    out[32 + k * 2 + 1] = n && n.accent ? 1 : 0
    out[64 + k * 2 + 1] = n && n.slide ? 1 : 0
  }

  notes.forEach((n) => {
    for (let i = n.start; i < n.end; i += 1) restMask &= ~(1 << i) // sounding steps
    for (let i = n.start + 1; i < n.end; i += 1) gateMask &= ~(1 << i) // tie steps
  })

  out[97] = pattern.triplet ? 1 : 0
  out.set(nib(pattern.length), 98)
  out.set(maskToNibbles(gateMask), 102)
  out.set(maskToNibbles(restMask), 106)
  return out
}

/** 110-byte TD-3 payload -> editor pattern. */
export const decodePayload = (bytes) => {
  if (bytes.length < PAYLOAD_SIZE) throw new Error('Pattern data is too short')
  const pattern = makePattern()
  const length = unnib(bytes[98], bytes[99])
  pattern.length = Math.min(MAX_STEPS, Math.max(1, length || MAX_STEPS))
  const gateMask = nibblesToMask(bytes.subarray(102, 106))
  const restMask = nibblesToMask(bytes.subarray(106, 110))

  let pool = 0 // next pool entry to consume
  const starts = [] // [step, pool entry] of every note
  for (let i = 0; i < MAX_STEPS; i += 1) {
    const rest = Boolean(restMask & (1 << i))
    const gate = Boolean(gateMask & (1 << i))
    if (rest || (gate && pool >= 16)) {
      pattern.steps[i] = makeStep()
    } else if (!gate) {
      pattern.steps[i] = makeStep({ time: 'tie' }) // continues the previous note (silent after a rest)
    } else {
      const raw = unnib(bytes[pool * 2], bytes[pool * 2 + 1])
      const pitch = (raw & 0x7f) - PITCH_OFFSET
      const fields = raw & 0x80 && pitch % 12 === 0 ? { note: 12, octave: pitch / 12 - 1 } : fromPitch(pitch)
      pattern.steps[i] = makeStep({ ...fields, accent: bytes[32 + pool * 2 + 1] === 1, time: 'note' })
      starts.push([i, pool])
      pool += 1
    }
  }
  // the slide flag lives on the last step of a (tied) note
  for (const [start, k] of starts) {
    let end = start
    while (end + 1 < MAX_STEPS && pattern.steps[end + 1].time === 'tie') end += 1
    pattern.steps[end].slide = bytes[64 + k * 2 + 1] === 1
  }
  pattern.triplet = bytes[97] === 1
  return { pattern, triplet: pattern.triplet }
}

// ---- .seq files (SynthTribe) ------------------------------------------------------

const utf16be = (s) => [...s].flatMap((c) => [0, c.charCodeAt(0) & 0xff])
const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]

/** Editor pattern -> .seq file bytes (header as written by SynthTribe 1.3.7). */
export const encodeSeq = (pattern, { device = 'TD-3', version = '1.3.7' } = {}) => {
  const payload = encodePayload(pattern)
  const name = utf16be(device)
  const ver = utf16be(version)
  return new Uint8Array([
    ...SEQ_MAGIC,
    ...u32(name.length), ...name,
    ...u32(ver.length), ...ver,
    ...u32(payload.length + 2), 0x00, 0x00,
    ...payload
  ])
}

/** .seq file bytes -> { pattern, device, version, triplet } */
export const decodeSeq = (bytes) => {
  if (bytes.length < 8 || SEQ_MAGIC.some((b, i) => bytes[i] !== b)) throw new Error('Not a TD-3 .seq file')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 4
  const readString = () => {
    const len = view.getUint32(pos)
    pos += 4
    if (len > 256 || pos + len > bytes.length) throw new Error('Corrupt .seq header')
    let s = ''
    for (let i = 0; i + 1 < len; i += 2) s += String.fromCharCode((bytes[pos + i] << 8) | bytes[pos + i + 1])
    pos += len
    return s
  }
  const device = readString()
  const version = readString()
  const dataLen = view.getUint32(pos)
  pos += 4
  if (!/^TD-3/i.test(device)) throw new Error(`This .seq is for a ${device || 'different device'}, not a TD-3`)
  // data = 2 unknown bytes + payload
  const start = pos + (dataLen >= PAYLOAD_SIZE + 2 ? 2 : 0)
  const payload = bytes.subarray(start, start + PAYLOAD_SIZE)
  return { ...decodePayload(payload), device, version }
}

// ---- SysEx (hardware link, see src/hardware/td3.js) -----------------------------------------

/** 0-based hardware slot: group 0-3, section 0 (A) / 1 (B), number 0-7 */
const slotByte = ({ section, number }) => section * 8 + number

/** `marker`: the byte the device keeps before the payload (00 on used slots); pass the value read. */
export const encodePatternSysex = (pattern, slot, modelId = TD3_MODEL_ID, marker = 0) =>
  new Uint8Array([
    ...SYSEX_HEADER, modelId, CMD_PATTERN, slot.group, slotByte(slot), ...nib(marker & 0xff),
    ...encodePayload(pattern),
    0xf7
  ])

export const requestPatternSysex = (slot, modelId = TD3_MODEL_ID) =>
  new Uint8Array([...SYSEX_HEADER, modelId, CMD_REQUEST_PATTERN, slot.group, slotByte(slot), 0xf7])

export const decodePatternSysex = (bytes) => {
  if (bytes[0] !== 0xf0 || SYSEX_HEADER.some((b, i) => bytes[i] !== b) || bytes[7] !== CMD_PATTERN) {
    throw new Error('Not a TD-3 pattern SysEx message')
  }
  const { pattern, triplet } = decodePayload(bytes.subarray(12, 12 + PAYLOAD_SIZE))
  return { pattern, triplet, group: bytes[8], slot: bytes[9], modelId: bytes[6], marker: unnib(bytes[10], bytes[11]) }
}

// handy for tests / debugging
export const _internal = { maskToNibbles, nibblesToMask, pitchOf }
