// Behringer TD-3 pattern binary format: SynthTribe .seq files and SysEx pattern messages.
//
// Both wrap the same 110-byte pattern payload. Layout and semantics were assembled from
// public reverse-engineering notes (no official spec exists):
//   - 303patterns.com/td3-midi.html (AudioPump, unofficial MIDI implementation)
//   - github.com/echolevel/Acid-Injector (writes .seq/.syx; source of the .seq header)
//   - github.com/beholder-d/td3-pattern (README: payload dump + observed tie/rest behaviour)
// This file is an independent implementation; no code was copied from those projects.
//
// Payload (110 bytes). Every value is split in two "nibble bytes": hi 4 bits, lo 4 bits.
//   0   32  pitch pool, 16 x (hi, lo)   value = 24 + semitones from bottom C, bit 7 = key C'
//   32  32  accent pool, 16 x (0, flag)
//   64  32  slide pool,  16 x (0, flag)
//   96   2  triplet (0, flag)
//   98   2  step count (hi, lo), 1..16
//   100  2  unknown, 00 00
//   102  4  tie mask   bit = 1: step plays normally, bit = 0: step is held into the next step
//   106  4  rest mask  bit = 1: rest
//   16-bit masks are stored as nibbles in the order [bits 4-7, 0-3, 12-15, 8-11].
//
// Like the original TB-303, pitch / accent / slide are a POOL of notes, not per step:
// the sequencer takes the next pool entry for every step that starts a new note.
// A held (tied) step consumes nothing; rests consume nothing.
//
// UNVERIFIED on real hardware (check before writing to a device, see src/hardware/README.md):
//   - tie direction: we follow the behaviour reported by td3-pattern (tie bit on step i =
//     note continues into step i+1)
//   - pattern slot numbering in SysEx (A1-A8 = 0-7, B1-B8 = 8-15)
//   - whether the TD-3-MO uses the same model ID (0x0A) and payload as the TD-3

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

/** Editor pattern -> 110-byte TD-3 payload. */
export const encodePayload = (pattern) => {
  const out = new Uint8Array(PAYLOAD_SIZE)
  const notes = patternNotes(pattern) // note + following ties = one pool entry
  let tieMask = 0xffff
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
    for (let i = n.start; i < n.end; i += 1) restMask &= ~(1 << i)
    for (let i = n.start; i < n.end - 1; i += 1) tieMask &= ~(1 << i) // held into next step
  })

  out[97] = 0 // triplet off
  out.set(nib(pattern.length), 98)
  out.set(maskToNibbles(tieMask), 102)
  out.set(maskToNibbles(restMask), 106)
  return out
}

/** 110-byte TD-3 payload -> editor pattern. */
export const decodePayload = (bytes) => {
  if (bytes.length < PAYLOAD_SIZE) throw new Error('Pattern data is too short')
  const pattern = makePattern()
  const length = unnib(bytes[98], bytes[99])
  pattern.length = Math.min(MAX_STEPS, Math.max(1, length || MAX_STEPS))
  const tieMask = nibblesToMask(bytes.subarray(102, 106))
  const restMask = nibblesToMask(bytes.subarray(106, 110))

  let pool = 0 // next pool entry to consume
  let current = -1 // pool entry of the sounding note
  let held = false // previous step is held into this one
  for (let i = 0; i < MAX_STEPS; i += 1) {
    const rest = Boolean(restMask & (1 << i))
    if (held) {
      pattern.steps[i] = makeStep({ time: 'tie' })
    } else if (rest || pool >= 16) {
      pattern.steps[i] = makeStep()
      current = -1
      held = false
      continue
    } else {
      const raw = unnib(bytes[pool * 2], bytes[pool * 2 + 1])
      const pitch = (raw & 0x7f) - PITCH_OFFSET
      const fields = raw & 0x80 && pitch % 12 === 0 ? { note: 12, octave: pitch / 12 - 1 } : fromPitch(pitch)
      pattern.steps[i] = makeStep({ ...fields, accent: bytes[32 + pool * 2 + 1] === 1, time: 'note' })
      current = pool
      pool += 1
    }
    held = !(tieMask & (1 << i))
    // the slide flag lives on the last step of a (held) note
    if (!held) pattern.steps[i].slide = bytes[64 + current * 2 + 1] === 1
  }
  return { pattern, triplet: bytes[97] === 1 }
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

// ---- SysEx (for the future hardware link) -----------------------------------------

/** 0-based hardware slot: group 0-3, section 0 (A) / 1 (B), number 0-7 */
const slotByte = ({ section, number }) => section * 8 + number

export const encodePatternSysex = (pattern, slot, modelId = TD3_MODEL_ID) =>
  new Uint8Array([
    ...SYSEX_HEADER, modelId, CMD_PATTERN, slot.group, slotByte(slot), 0x00, 0x00,
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
  return { pattern, triplet, group: bytes[8], slot: bytes[9], modelId: bytes[6] }
}

// handy for tests / debugging
export const _internal = { maskToNibbles, nibblesToMask, pitchOf }
