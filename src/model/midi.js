// Standard MIDI File (.mid) import / export for single patterns.
//
// Mapping between a 303-style pattern and plain MIDI notes:
//   step           = one 16th note
//   note + ties    = one MIDI note spanning those steps
//   accent         = velocity >= ACCENT_VELOCITY (export writes 127, normal notes 80)
//   slide          = the note overlaps the next note (legato), which is also how the
//                    TD-3 and most 303 clones receive slides over MIDI
//   pitch          = BASE_MIDI + pitch offset (C2 = key C without transpose)
//
// Pure functions, no DOM: safe to unit test in Node.

import {
  BASE_MIDI,
  MAX_PITCH,
  MAX_STEPS,
  MIN_PITCH,
  fromPitch,
  makePattern,
  makeStep,
  pitchOf
} from './pattern.js'

export const PPQ = 96
const STEP_TICKS = PPQ / 4
const ACCENT_VELOCITY = 100
const NORMAL_VELOCITY = 80

// ---- helpers ------------------------------------------------------------------------

const varLen = (value) => {
  const bytes = [value & 0x7f]
  let v = value >> 7
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80)
    v >>= 7
  }
  return bytes
}

const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const u16 = (n) => [(n >> 8) & 0xff, n & 0xff]
const ascii = (s) => [...s].map((c) => c.charCodeAt(0) & 0x7f)

// Notes (start/end in steps) from a pattern: a 'note' step plus following 'tie' steps.
export const patternNotes = (pattern) => {
  const notes = []
  let current = null
  for (let i = 0; i < pattern.length; i += 1) {
    const step = pattern.steps[i]
    if (step.time === 'note') {
      current = { start: i, end: i + 1, pitch: pitchOf(step), accent: step.accent, slide: step.slide }
      notes.push(current)
    } else if (step.time === 'tie' && current && current.end === i) {
      current.end = i + 1
      current.slide = step.slide
    } else {
      current = null
    }
  }
  return notes
}

// ---- export ---------------------------------------------------------------------

/**
 * @param {object} pattern editor pattern
 * @param {object} opts { bpm, name }
 * @returns {Uint8Array} format-0 Standard MIDI File, one bar per 16 steps
 */
export const encodeMidi = (pattern, { bpm = 120, name = 'TD-3-MO pattern' } = {}) => {
  const notes = patternNotes(pattern)
  const events = [] // { tick, order, bytes }

  notes.forEach((n, idx) => {
    const next = notes[idx + 1]
    // a slide into the same key can't overlap in MIDI (it would be one note), so play it legato
    const slidesIntoNext = n.slide && next && next.start === n.end && next.pitch !== n.pitch
    const on = n.start * STEP_TICKS
    let off
    if (slidesIntoNext) off = n.end * STEP_TICKS + STEP_TICKS / 4 // overlap = slide
    else if (n.end - n.start > 1) off = n.end * STEP_TICKS - STEP_TICKS / 2
    else off = on + STEP_TICKS / 2 // 303-style half-step gate
    const key = Math.min(127, Math.max(0, BASE_MIDI + n.pitch))
    const vel = n.accent ? 127 : NORMAL_VELOCITY
    events.push({ tick: on, order: 1, bytes: [0x90, key, vel] })
    events.push({ tick: off, order: 0, bytes: [0x80, key, 0] })
  })

  // note-offs before note-ons at the same tick, except overlapping slides keep their order by tick
  events.sort((a, b) => a.tick - b.tick || a.order - b.order)

  const mpqn = Math.round(60000000 / bpm)
  const track = [
    ...[0, 0xff, 0x03, ...varLen(name.length), ...ascii(name)],
    ...[0, 0xff, 0x51, 0x03, (mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff],
    ...[0, 0xff, 0x58, 0x04, 4, 2, 24, 8]
  ]
  let last = 0
  for (const ev of events) {
    track.push(...varLen(ev.tick - last), ...ev.bytes)
    last = ev.tick
  }
  const endTick = Math.max(last, pattern.length * STEP_TICKS)
  track.push(...varLen(endTick - last), 0xff, 0x2f, 0x00)

  const bytes = [
    ...ascii('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(PPQ),
    ...ascii('MTrk'), ...u32(track.length), ...track
  ]
  return new Uint8Array(bytes)
}

// ---- import ---------------------------------------------------------------------

const readChunks = (data) => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const tag = (o) => String.fromCharCode(data[o], data[o + 1], data[o + 2], data[o + 3])
  if (data.length < 14 || tag(0) !== 'MThd') throw new Error('Not a MIDI file')
  const division = view.getUint16(12)
  if (division & 0x8000) throw new Error('SMPTE time division is not supported')
  const tracks = []
  let pos = 8 + view.getUint32(4)
  while (pos + 8 <= data.length) {
    const len = view.getUint32(pos + 4)
    if (tag(pos) === 'MTrk') tracks.push(data.subarray(pos + 8, Math.min(data.length, pos + 8 + len)))
    pos += 8 + len
  }
  return { ppq: division, tracks }
}

const parseTrack = (bytes) => {
  const notes = []
  const open = new Map() // key -> {tick, vel}
  let tempo = null
  let pos = 0
  let tick = 0
  let status = 0
  const readVar = () => {
    let v = 0
    let b
    do {
      b = bytes[pos++]
      v = (v << 7) | (b & 0x7f)
    } while (b & 0x80 && pos < bytes.length)
    return v
  }
  while (pos < bytes.length) {
    tick += readVar()
    let b = bytes[pos]
    if (b & 0x80) {
      status = b
      pos += 1
    } else if (!status) {
      break
    }
    if (status === 0xff) {
      const type = bytes[pos++]
      const len = readVar()
      if (type === 0x51 && len === 3 && tempo === null) {
        tempo = 60000000 / ((bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2])
      }
      pos += len
      if (type === 0x2f) break
      status = 0
      continue
    }
    if (status === 0xf0 || status === 0xf7) {
      pos += readVar()
      status = 0
      continue
    }
    const kind = status & 0xf0
    const d1 = bytes[pos++]
    const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[pos++]
    if (kind === 0x90 && d2 > 0) {
      if (open.has(d1)) notes.push({ key: d1, ...open.get(d1), off: tick })
      open.set(d1, { on: tick, vel: d2 })
    } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
      if (open.has(d1)) {
        notes.push({ key: d1, ...open.get(d1), off: tick })
        open.delete(d1)
      }
    }
  }
  open.forEach((n, key) => notes.push({ key, ...n, off: tick }))
  return { notes, tempo }
}

/**
 * Convert a MIDI file into one mono pattern (first 16 sixteenth-steps).
 * Chords are reduced to their highest note; notes outside the 3-octave range are
 * folded in by octaves.
 * @param {Uint8Array} data
 * @returns {{ pattern, bpm: number|null, truncated: boolean, noteCount: number }}
 */
export const decodeMidi = (data) => {
  const { ppq, tracks } = readChunks(data)
  let bpm = null
  let notes = []
  for (const t of tracks) {
    const parsed = parseTrack(t)
    if (bpm === null && parsed.tempo) bpm = Math.round(parsed.tempo)
    // use the first track that actually contains notes
    if (!notes.length && parsed.notes.length) notes = parsed.notes
  }
  if (!notes.length) throw new Error('No notes found in this MIDI file')

  const stepTicks = ppq / 4
  const firstStep = Math.floor(Math.min(...notes.map((n) => n.on)) / stepTicks / 16) * 16 // start of first bar with notes

  // one note per step: highest key wins
  const byStep = new Map()
  for (const n of notes) {
    const step = Math.round(n.on / stepTicks) - firstStep
    const prev = byStep.get(step)
    if (!prev || n.key > prev.key) byStep.set(step, n)
  }
  const starts = [...byStep.keys()].sort((a, b) => a - b)
  const truncated = starts.some((s) => s >= MAX_STEPS)
  const inRange = starts.filter((s) => s >= 0 && s < MAX_STEPS)

  const pattern = makePattern()
  let lastEnd = 0
  inRange.forEach((s, i) => {
    const n = byStep.get(s)
    const nextStart = i + 1 < inRange.length ? inRange[i + 1] : MAX_STEPS
    const durSteps = Math.max(1, Math.round((n.off - n.on) / stepTicks))
    const end = Math.min(nextStart, s + durSteps, MAX_STEPS)
    let pitch = n.key - BASE_MIDI
    while (pitch < MIN_PITCH) pitch += 12
    while (pitch > MAX_PITCH) pitch -= 12
    const nextNote = byStep.get(nextStart)
    const slide = Boolean(nextNote) && n.off > nextNote.on && nextStart === end
    pattern.steps[s] = makeStep({ ...fromPitch(pitch), accent: n.vel >= ACCENT_VELOCITY, time: 'note' })
    for (let k = s + 1; k < end; k += 1) pattern.steps[k] = makeStep({ time: 'tie' })
    pattern.steps[end - 1].slide = slide
    lastEnd = Math.max(lastEnd, end)
  })

  // keep the pattern a whole number of beats long where possible
  pattern.length = truncated ? MAX_STEPS : Math.min(MAX_STEPS, Math.max(1, Math.ceil(lastEnd / 4) * 4))
  return { pattern, bpm, truncated, noteCount: notes.length }
}
