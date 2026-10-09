// TD-3 / TD-3-MO hardware link over Web MIDI (USB-MIDI or a MIDI interface).
//
// Two independent features:
//   1. Live notes: the editor's sequencer plays the real synth as a MIDI instrument
//      (accent = high velocity, slide = overlapping notes). Nothing is stored on the device.
//   2. Pattern memory over SysEx: read a slot, write a slot (with backup + read-back check).
//
// No Vue in here; the reactive wrapper lives in src/store/device.js.
// Message formats: see docs/MIDI-IMPLEMENTATION.md and src/model/td3format.js.

import { PAYLOAD_SIZE, TD3_MODEL_ID, encodePatternSysex, requestPatternSysex } from '../model/td3format.js'

const BEHRINGER = [0xf0, 0x00, 0x20, 0x32, 0x00, 0x01]
const CMD_PRODUCT = 0x06
const CMD_PRODUCT_REPLY = 0x07
const CMD_FIRMWARE = 0x08
const CMD_FIRMWARE_REPLY = 0x09
const CMD_PATTERN = 0x78
const CMD_CONFIG = 0x75
const CMD_CONFIG_REPLY = 0x76
const CMD_ACK = 0x01 // 01 00 00 = OK, 01 00 01 = refused

export const webMidiSupported = () => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator

/** Ask the browser for MIDI access with SysEx (shows a permission prompt). */
export const requestMidiAccess = () => {
  if (!webMidiSupported()) return Promise.reject(new Error('Web MIDI is not available in this browser (use Chrome or Edge)'))
  return navigator.requestMIDIAccess({ sysex: true })
}

export const looksLikeTd3 = (name = '') => /td-?3/i.test(name)

/** All ports as plain objects, TD-3 ports first. */
export const listPorts = (access) => {
  const map = (ports) =>
    [...ports.values()]
      .map((p) => ({ id: p.id, name: p.name || p.id, td3: looksLikeTd3(p.name) }))
      .sort((a, b) => Number(b.td3) - Number(a.td3))
  return { inputs: map(access.inputs), outputs: map(access.outputs) }
}

// ---- SysEx request / response -------------------------------------------------------

const isBehringer = (data, modelId) => data.length > 8 && BEHRINGER.every((b, i) => data[i] === b) && data[6] === modelId

/**
 * Small request/response helper on one input + output pair.
 * Only one request is in flight at a time (the TD-3 answers in order anyway).
 */
export const createSysexClient = (input, output, modelId = TD3_MODEL_ID) => {
  let queue = Promise.resolve()

  const exchange = (message, match, timeoutMs) =>
    new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const data = event.data
        if (data[0] !== 0xf0 || !isBehringer(data, modelId) || !match(data)) return
        cleanup()
        resolve(data)
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('No reply from the device'))
      }, timeoutMs)
      const cleanup = () => {
        clearTimeout(timer)
        input.removeEventListener('midimessage', onMessage)
      }
      input.addEventListener('midimessage', onMessage)
      output.send(message)
    })

  // serialize requests
  const request = (message, match, timeoutMs = 1500) => {
    const run = queue.then(() => exchange(message, match, timeoutMs))
    queue = run.catch(() => {})
    return run
  }

  const productName = async () => {
    const reply = await request(new Uint8Array([...BEHRINGER, modelId, CMD_PRODUCT, 0xf7]), (d) => d[7] === CMD_PRODUCT_REPLY)
    let name = ''
    for (let i = 8; i < reply.length - 1 && reply[i] !== 0; i += 1) name += String.fromCharCode(reply[i])
    return name
  }

  const firmware = async () => {
    const reply = await request(
      new Uint8Array([...BEHRINGER, modelId, CMD_FIRMWARE, 0x00, 0xf7]),
      (d) => d[7] === CMD_FIRMWARE_REPLY
    )
    return [...reply.subarray(9, reply.length - 1)].join('.')
  }

  /**
   * Read the device's MIDI configuration (303patterns.com, firmware 1.2.4-1.3.7).
   * Channels are returned 1-16. Resolves with null fields if the reply is shorter than expected.
   */
  const config = async () => {
    const reply = await request(new Uint8Array([...BEHRINGER, modelId, CMD_CONFIG, 0xf7]), (d) => d[7] === CMD_CONFIG_REPLY)
    const at = (i) => (i < reply.length - 1 ? reply[i] : null)
    const ch = (v) => (v === null || v > 15 ? null : v + 1)
    return {
      outChannel: ch(at(8)), // the channel the TD-3 sends its notes on
      inChannel: ch(at(9)), // the channel the TD-3 listens to
      bendRange: at(11), // pitch bend range in semitones (0-12)
      accentThreshold: at(17),
      raw: [...reply]
    }
  }

  /** Read one pattern slot. Resolves with the full SysEx message (decode with decodePatternSysex). */
  const readPattern = (slot) => {
    const message = requestPatternSysex(slot, modelId)
    const [group, index] = [message[8], message[9]]
    return request(
      message,
      (d) => d[7] === CMD_PATTERN && d[8] === group && d[9] === index && d.length >= 12 + PAYLOAD_SIZE,
      2000
    )
  }

  /**
   * Write one pattern slot and wait for the device's answer: 01 00 00 = stored, 01 00 01 = refused
   * (bad address). Measured on a TD-3-MO 2.0.1 (also in TD-3-Commander's notes). `marker` is the
   * byte the device keeps before the payload; pass the value read from the slot.
   */
  const writePattern = async (slot, pattern, marker = 0) => {
    const reply = await request(encodePatternSysex(pattern, slot, modelId, marker), (d) => d[7] === CMD_ACK, 2000)
    if (reply[9] !== 0) throw new Error(`The device refused the pattern (status ${reply[9]})`)
  }

  return { request, productName, firmware, config, readPattern, writePattern }
}

/** Short human-readable description of an incoming MIDI message (for the monitor). */
export const describeMidi = (data) => {
  const [status, d1, d2] = data
  const ch = (status & 0x0f) + 1
  const hex = [...data.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join(' ') + (data.length > 12 ? ' …' : '')
  switch (status & 0xf0) {
    case 0x80: return { text: `Note off  ch ${ch}  key ${d1}`, hex }
    case 0x90: return { text: d2 ? `Note on   ch ${ch}  key ${d1}  vel ${d2}` : `Note off  ch ${ch}  key ${d1}`, hex }
    case 0xa0: return { text: `Key pressure  ch ${ch}  ${d1} = ${d2}`, hex }
    case 0xb0: return { text: `Control change  ch ${ch}  CC ${d1} = ${d2}`, hex }
    case 0xc0: return { text: `Program change  ch ${ch}  ${d1}`, hex }
    case 0xd0: return { text: `Channel pressure  ch ${ch}  ${d1}`, hex }
    case 0xe0: return { text: `Pitch bend  ch ${ch}  ${((d2 << 7) | d1) - 8192}`, hex }
    default: break
  }
  if (status === 0xf0) return { text: `SysEx (${data.length} bytes)`, hex }
  if (status === 0xfa) return { text: 'Start', hex }
  if (status === 0xfb) return { text: 'Continue', hex }
  if (status === 0xfc) return { text: 'Stop', hex }
  return { text: 'System message', hex }
}

/** Payload bytes of a pattern SysEx message, for comparing what was written with what was read back. */
export const payloadOf = (message) => message.subarray(12, 12 + PAYLOAD_SIZE)

// ---- live notes ---------------------------------------------------------------------

export const ACCENT_VELOCITY = 127 // the TD-3 treats velocities above a configurable threshold as accent
export const NORMAL_VELOCITY = 64
const SLIDE_OVERLAP_MS = 4

/**
 * Turns the sequencer's voice events ({kind:'on'|'off', time, midi, accent, slide}) into
 * timestamped MIDI notes. `toMs(audioTime)` converts AudioContext time to performance.now() time.
 */
export const createNotePlayer = (getOutput, getChannel) => {
  let sounding = null // MIDI key currently held on the device

  const send = (bytes, at) => {
    const out = getOutput()
    if (out) out.send(bytes, at)
  }
  const ch = () => (getChannel() - 1) & 0x0f
  const noteOn = (key, vel, at) => send([0x90 | ch(), key & 0x7f, vel], at)
  const noteOff = (key, at) => send([0x80 | ch(), key & 0x7f, 0], at)

  const play = (events, toMs) => {
    for (const ev of events) {
      const at = toMs(ev.time)
      if (ev.kind === 'on') {
        const vel = ev.accent ? ACCENT_VELOCITY : NORMAL_VELOCITY
        if (ev.slide && sounding !== null) {
          if (sounding === ev.midi) continue // slide into the same key: just keep holding
          noteOn(ev.midi, vel, at) // new note first, then release the old one = legato slide
          noteOff(sounding, at + SLIDE_OVERLAP_MS)
        } else {
          if (sounding !== null) noteOff(sounding, Math.max(0, at - 1))
          noteOn(ev.midi, vel, at)
        }
        sounding = ev.midi
      } else if (ev.kind === 'off' && sounding !== null) {
        noteOff(sounding, at)
        sounding = null
      }
    }
  }

  // Stop: drop everything still queued and silence the device.
  const panic = () => {
    const out = getOutput()
    if (!out) return
    if (typeof out.clear === 'function') out.clear()
    if (sounding !== null) out.send([0x80 | ch(), sounding, 0])
    out.send([0xb0 | ch(), 123, 0]) // all notes off
    sounding = null
  }

  return { play, panic }
}
