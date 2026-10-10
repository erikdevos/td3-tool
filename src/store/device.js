import { reactive, watch } from 'vue'
import { audioTimeToMs } from '../audio/engine.js'
import {
  createNotePlayer,
  createSysexClient,
  listPorts,
  looksLikeTd3,
  describeMidi,
  payloadOf,
  requestMidiAccess,
  webMidiSupported
} from '../hardware/td3.js'
import { patternNotes } from '../model/midi.js'
import { normalizePattern, slotLabel, slotParts } from '../model/pattern.js'
import { decodePatternSysex, encodePayload } from '../model/td3format.js'
import { KEYS, read, write } from './storage.js'

// Reactive state for the connection with a real TD-3 / TD-3-MO (module singleton).

const saved = read(KEYS.device) || {}
const MAX_BACKUPS = 30

const device = reactive({
  supported: webMidiSupported(),
  status: 'off', // off | connecting | ready | error
  error: null,
  inputs: [],
  outputs: [],
  inputId: null,
  outputId: null,
  inputName: saved.inputName || null,
  outputName: saved.outputName || null,
  product: null, // product name reported by the device, null = no SysEx reply
  firmware: null,
  channel: Number.isInteger(saved.channel) ? saved.channel : 1, // we send on this = the TD-3's MIDI IN channel
  receiveChannel: Number.isInteger(saved.receiveChannel) ? saved.receiveChannel : 1, // the TD-3's MIDI OUT channel
  config: null, // { inChannel, outChannel, accentThreshold } as reported by the device
  monitor: [], // recent incoming messages, newest first
  monitorOn: false,
  liveOut: saved.liveOut === true, // play the editor's sequencer on the device
  linkCutoff: saved.linkCutoff === true, // CUT OFF FREQ knob -> CC 74 on the device (TD-3-MO manual p. 62)
  linkTuning: saved.linkTuning === true, // TUNING knob -> pitch bend on the device
  autoConnect: saved.autoConnect === true, // reconnect on page load (only if MIDI was already allowed)
  muteLocal: saved.muteLocal === true, // silence the WebAudio preview while playing the device
  busy: null, // text of the running SysEx job
  lost: false, // the TD-3 stopped answering (unplugged / switched off), see the heartbeat
  // patterns as they were on the device before we overwrote them, newest first
  backups: Array.isArray(saved.backups) ? saved.backups.map((b) => ({ ...b, pattern: normalizePattern(b.pattern) })) : []
})

watch(
  () => [device.inputName, device.outputName, device.channel, device.receiveChannel, device.muteLocal, device.liveOut, device.linkCutoff, device.linkTuning, device.autoConnect, device.backups],
  () =>
    write(KEYS.device, {
      inputName: device.inputName,
      outputName: device.outputName,
      channel: device.channel,
      receiveChannel: device.receiveChannel,
      muteLocal: device.muteLocal,
      linkCutoff: device.linkCutoff,
      linkTuning: device.linkTuning,
      liveOut: device.liveOut,
      autoConnect: device.autoConnect,
      backups: device.backups
    }),
  { deep: true }
)

let access = null
let client = null

const port = (kind, id) => (access && id ? access[kind].get(id) || null : null)
const output = () => (device.status === 'ready' ? port('outputs', device.outputId) : null)

// The port chosen before (by name), else a TD-3. No blind fallback to another port: live play
// would then lock the panel for a device that is not there.
const pick = (list, name) => (list.find((p) => p.name === name) || list.find((p) => p.td3) || null)?.id ?? null

const refreshPorts = () => {
  const { inputs, outputs } = listPorts(access)
  device.inputs = inputs
  device.outputs = outputs
  if (!inputs.some((p) => p.id === device.inputId)) device.inputId = pick(inputs, device.inputName)
  if (!outputs.some((p) => p.id === device.outputId)) device.outputId = pick(outputs, device.outputName)
}

let pinging = false

// MIDI monitor: everything the TD-3 sends except clock / active sensing / our own SysEx replies
let listening = null
const onIncoming = (event) => {
  const data = event.data
  if (!device.monitorOn || device.busy || (pinging && data[0] === 0xf0) || !data.length || data[0] === 0xf8 || data[0] === 0xfe) return
  device.monitor.unshift({ at: Date.now(), ...describeMidi(data) })
  device.monitor.splice(40)
}
const listen = (input) => {
  if (listening) listening.removeEventListener('midimessage', onIncoming)
  listening = input
  if (input) input.addEventListener('midimessage', onIncoming)
}

/** Ask who is on the other end. A TD-3 answers with its product name and firmware. */
const identify = async () => {
  const input = port('inputs', device.inputId)
  const out = port('outputs', device.outputId)
  listen(input)
  device.product = null
  device.firmware = null
  device.config = null
  client = input && out ? createSysexClient(input, out) : null
  // keep the remembered names while the device is unplugged, so it is picked again on return
  if (input) device.inputName = input.name
  if (out) device.outputName = out.name
  if (!client) return
  try {
    device.product = await client.productName()
    device.firmware = await client.firmware()
    device.lost = false
  } catch {
    // no SysEx reply: wrong port, a different device, or a model ID we don't know yet.
    // A port named TD-3 always answers when the device is there, so silence means it is gone
    // (Firefox lists unplugged ports as connected until it restarts).
    device.lost = looksLikeTd3(out.name)
    return
  }
  await readConfig()
}

/** Read the device's MIDI channels and adopt them, so notes go where the TD-3 listens. */
const readConfig = async () => {
  if (!client) return
  try {
    const cfg = await client.config()
    device.config = cfg
    if (cfg.inChannel) device.channel = cfg.inChannel
    if (cfg.outChannel) device.receiveChannel = cfg.outChannel
  } catch {
    device.config = null // older/newer firmware without this reply: keep the manual setting
  }
}

const isFirefox = () => typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent)

// Explain the usual reasons a browser refuses MIDI access.
const accessError = (error) => {
  if (error.name !== 'SecurityError' && error.name !== 'NotAllowedError') return error.message
  if (isFirefox()) {
    return 'Firefox refused MIDI access. Firefox only looks for MIDI devices when it starts: quit Firefox completely ' +
      '(Cmd+Q), make sure the TD-3 is connected and switched on, start Firefox again and click Connect. ' +
      'If it still fails, allow MIDI for this site in the address bar (site permissions), or use Chrome or Edge.'
  }
  return 'MIDI access was blocked. Allow MIDI (with SysEx) for this site in the browser\'s site settings and try again.'
}

const connect = async () => {
  device.error = null
  device.status = 'connecting'
  try {
    access = access || (await requestMidiAccess())
    // plug / unplug while the page is open: follow the ports, so live play stops by itself
    access.onstatechange = () => {
      const before = `${device.inputId}|${device.outputId}`
      refreshPorts()
      if (`${device.inputId}|${device.outputId}` !== before) {
        if (!device.outputId) notes.panic()
        identify()
      }
    }
    refreshPorts()
    device.status = 'ready'
    device.autoConnect = true
    await identify()
  } catch (error) {
    device.status = 'error'
    device.error = accessError(error)
  }
}

// On page load: reconnect silently when the user connected before and the browser
// already granted MIDI + SysEx (no permission prompt without a click).
const restoreConnection = async () => {
  if (!device.supported || !device.autoConnect) return
  try {
    const status = await navigator.permissions?.query({ name: 'midi', sysex: true })
    if (status?.state === 'granted') await connect()
  } catch {
    // permissions API without 'midi' support: wait for a manual connect
  }
}
restoreConnection()

// Heartbeat. Chrome reports an unplugged port through statechange, but Firefox keeps listing it
// as "connected". So while a TD-3 that answers SysEx is selected, ask it for its name every few
// seconds; two missed answers in a row = gone (live play stops, the panel unlocks).
const HEARTBEAT_MS = 2500
let misses = 0
const heartbeat = async () => {
  if (device.status !== 'ready' || !client || device.busy || pinging) return
  if (!device.product && !device.lost) return // a non-TD-3 port that never answered: nothing to watch
  if (typeof document !== 'undefined' && document.hidden) return
  pinging = true
  const alive = await client.ping()
  pinging = false
  misses = alive ? 0 : misses + 1
  if (alive && device.lost) {
    device.lost = false
    if (!device.product) identify() // it was missing on connect: fetch name, firmware and channels now
  } else if (misses >= 2 && !device.lost) {
    device.lost = true
    notes.panic()
  }
}
if (typeof setInterval !== 'undefined' && device.supported) setInterval(heartbeat, HEARTBEAT_MS)

const selectPorts = async ({ inputId = device.inputId, outputId = device.outputId } = {}) => {
  notes.panic()
  device.inputId = inputId
  device.outputId = outputId
  await identify()
}

// ---- live notes ---------------------------------------------------------------------

const notes = createNotePlayer(output, () => device.channel)

// Live play only counts while the chosen output port is really there (reactive: reads device.*)
const liveActive = () =>
  device.liveOut && device.status === 'ready' && !device.lost && Boolean(device.outputId) && Boolean(output())

/** Voice events from the sequencer or an audition, mirrored to the device. */
const playEvents = (events) => {
  if (liveActive() && events.length) notes.play(events, audioTimeToMs)
}

const panic = () => notes.panic()

// ---- controllers --------------------------------------------------------------------

// The TD-3-MO receives Filter Cutoff as CC 74 (0x4A). The device's own knobs send nothing.
export const CC_CUTOFF = 0x4a

const sendCC = (cc, value) => {
  const out = output()
  if (!out) return false
  out.send([0xb0 | ((device.channel - 1) & 0x0f), cc & 0x7f, Math.min(127, Math.max(0, Math.round(value)))])
  return true
}

// Knob drags fire many updates: send at most every 10 ms, always ending on the latest value.
const throttled = (send) => {
  let pending = null
  let timer = null
  const flush = () => {
    timer = null
    if (pending === null) return
    send(pending)
    pending = null
    timer = setTimeout(flush, 10)
  }
  return (value) => {
    pending = value
    if (!timer) flush()
  }
}

const sendCutoff = throttled((value) => sendCC(CC_CUTOFF, value * 127))

/** Mirror the editor's cutoff knob (0..1) to the device when linked. */
const syncCutoff = (value) => {
  if (device.linkCutoff && output()) sendCutoff(value)
}

// Pitch bend: 14-bit, centre 8192. The device bends by its own configured range (semitones).
const DEFAULT_BEND_RANGE = 2
const bendRange = () => (device.config?.bendRange > 0 ? device.config.bendRange : DEFAULT_BEND_RANGE)

const sendBend = throttled((semitones) => {
  const out = output()
  if (!out) return
  const amount = Math.min(1, Math.max(-1, semitones / bendRange()))
  const value = Math.min(16383, Math.max(0, Math.round(8192 + amount * (amount < 0 ? 8192 : 8191))))
  out.send([0xe0 | ((device.channel - 1) & 0x0f), value & 0x7f, value >> 7])
})

/**
 * Mirror the editor's TUNING knob (0..1 = -12..+12 semitones, like the preview) as pitch bend.
 * Beyond the device's bend range the bend stops at its maximum. Unlinking re-centres the bend.
 */
const syncTuning = (value, linked = device.linkTuning) => {
  if (!output()) return
  if (linked) sendBend((value - 0.5) * 24)
  else sendBend(0)
}

watch(
  () => [device.liveOut, device.channel],
  () => notes.panic()
)

// ---- pattern memory ----------------------------------------------------------------

const requireClient = () => {
  if (!client) throw new Error('Connect a TD-3 first')
  if (!device.product) throw new Error('The device does not answer SysEx requests')
}

const run = async (label, job) => {
  if (device.busy) throw new Error('Device is busy')
  device.busy = label
  try {
    return await job()
  } finally {
    device.busy = null
  }
}

/** Read one slot from the device. Resolves with {pattern, triplet}. */
const receivePattern = (slotIndex) =>
  run(`Reading ${slotLabel(slotIndex)}`, async () => {
    requireClient()
    const message = await client.readPattern(slotParts(slotIndex))
    return decodePatternSysex(message)
  })

/** Read many slots; onEach(index, result) is called per slot as it arrives. */
const receiveSlots = (indexes, onEach) =>
  run('Reading patterns', async () => {
    requireClient()
    for (const [n, index] of indexes.entries()) {
      device.busy = `Reading ${slotLabel(index)} (${n + 1}/${indexes.length})`
      onEach(index, decodePatternSysex(await client.readPattern(slotParts(index))))
    }
  })

const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
// Same music, even if the device fills unused bytes differently than we do.
const sameMusic = (a, b) => a.length === b.length && JSON.stringify(patternNotes(a)) === JSON.stringify(patternNotes(b))

/**
 * Write a pattern into a device slot, safely:
 *   1. read what is there now and keep it as a backup (abort if that read fails)
 *   2. write the new pattern and wait for the device's acknowledgement (01 00 00)
 *   3. read it back and compare
 * Resolves with { verified, exact, backup }: verified = same notes, exact = identical bytes.
 */
const sendPattern = (slotIndex, pattern) =>
  run(`Writing ${slotLabel(slotIndex)}`, async () => {
    requireClient()
    const slot = slotParts(slotIndex)
    const before = await client.readPattern(slot)
    const backup = {
      slot: slotIndex,
      at: new Date().toISOString(),
      device: device.product,
      pattern: decodePatternSysex(before).pattern,
      raw: [...before] // the exact message, for a byte-exact restore
    }
    device.backups.unshift(backup)
    device.backups.splice(MAX_BACKUPS)

    await client.writePattern(slot, pattern, decodePatternSysex(before).marker)
    const after = await client.readPattern(slot)
    return {
      verified: sameMusic(decodePatternSysex(after).pattern, pattern),
      exact: sameBytes(payloadOf(after), encodePayload(pattern)),
      backup
    }
  })

export const useDevice = () => ({
  device,
  connect,
  selectPorts,
  identify,
  readConfig,
  playEvents,
  liveActive,
  panic,
  sendCC,
  syncCutoff,
  syncTuning,
  bendRange,
  receivePattern,
  receiveSlots,
  sendPattern
})
