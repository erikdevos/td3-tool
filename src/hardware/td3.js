// TD-3 / TD-3-MO hardware link over Web MIDI (USB-MIDI or a MIDI interface).
//
// Two independent features:
//   1. Live notes: the editor's sequencer plays the real synth as a MIDI instrument
//      (accent = high velocity, slide = overlapping notes). Nothing is stored on the device.
//   2. Pattern memory over SysEx: read a slot, write a slot (with backup + read-back check).
//
// No Vue in here; the reactive wrapper lives in src/store/device.js.
// Message formats: see src/model/td3format.js and src/hardware/README.md.

import { PAYLOAD_SIZE, TD3_MODEL_ID, encodePatternSysex, requestPatternSysex } from '../model/td3format.js'

const BEHRINGER = [0xf0, 0x00, 0x20, 0x32, 0x00, 0x01]
const CMD_PRODUCT = 0x06
const CMD_PRODUCT_REPLY = 0x07
const CMD_FIRMWARE = 0x08
const CMD_FIRMWARE_REPLY = 0x09
const CMD_PATTERN = 0x78

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

  /** Write one pattern slot. The TD-3 sends no documented acknowledgement, so verify by reading back. */
  const writePattern = async (slot, pattern) => {
    await queue
    output.send(encodePatternSysex(pattern, slot, modelId))
    await new Promise((r) => setTimeout(r, 250)) // give the device time to store it
  }

  return { request, productName, firmware, readPattern, writePattern }
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
