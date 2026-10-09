import { reactive, watch } from 'vue'
import { audioTimeToMs } from '../audio/engine.js'
import {
  createNotePlayer,
  createSysexClient,
  listPorts,
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
  channel: Number.isInteger(saved.channel) ? saved.channel : 1,
  liveOut: saved.liveOut === true, // play the editor's sequencer on the device
  autoConnect: saved.autoConnect === true, // reconnect on page load (only if MIDI was already allowed)
  muteLocal: saved.muteLocal === true, // silence the WebAudio preview while playing the device
  busy: null, // text of the running SysEx job
  // patterns as they were on the device before we overwrote them, newest first
  backups: Array.isArray(saved.backups) ? saved.backups.map((b) => ({ ...b, pattern: normalizePattern(b.pattern) })) : []
})

watch(
  () => [device.inputName, device.outputName, device.channel, device.muteLocal, device.liveOut, device.autoConnect, device.backups],
  () =>
    write(KEYS.device, {
      inputName: device.inputName,
      outputName: device.outputName,
      channel: device.channel,
      muteLocal: device.muteLocal,
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

const pick = (list, name) => (list.find((p) => p.name === name) || list.find((p) => p.td3) || list[0] || null)?.id ?? null

const refreshPorts = () => {
  const { inputs, outputs } = listPorts(access)
  device.inputs = inputs
  device.outputs = outputs
  if (!inputs.some((p) => p.id === device.inputId)) device.inputId = pick(inputs, device.inputName)
  if (!outputs.some((p) => p.id === device.outputId)) device.outputId = pick(outputs, device.outputName)
}

/** Ask who is on the other end. A TD-3 answers with its product name and firmware. */
const identify = async () => {
  const input = port('inputs', device.inputId)
  const out = port('outputs', device.outputId)
  device.product = null
  device.firmware = null
  client = input && out ? createSysexClient(input, out) : null
  device.inputName = input?.name ?? null
  device.outputName = out?.name ?? null
  if (!client) return
  try {
    device.product = await client.productName()
    device.firmware = await client.firmware()
  } catch {
    // no SysEx reply: wrong port, a different device, or a model ID we don't know yet
  }
}

const connect = async () => {
  device.error = null
  device.status = 'connecting'
  try {
    access = access || (await requestMidiAccess())
    access.onstatechange = () => {
      const before = `${device.inputId}|${device.outputId}`
      refreshPorts()
      if (`${device.inputId}|${device.outputId}` !== before) identify()
    }
    refreshPorts()
    device.status = 'ready'
    device.autoConnect = true
    await identify()
  } catch (error) {
    device.status = 'error'
    device.error = error.name === 'SecurityError' || error.name === 'NotAllowedError' ? 'MIDI access was blocked' : error.message
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

const selectPorts = async ({ inputId = device.inputId, outputId = device.outputId } = {}) => {
  notes.panic()
  device.inputId = inputId
  device.outputId = outputId
  await identify()
}

// ---- live notes ---------------------------------------------------------------------

const notes = createNotePlayer(output, () => device.channel)

const liveActive = () => device.liveOut && Boolean(output())

/** Voice events from the sequencer or an audition, mirrored to the device. */
const playEvents = (events) => {
  if (liveActive() && events.length) notes.play(events, audioTimeToMs)
}

const panic = () => notes.panic()

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
 *   2. write the new pattern
 *   3. read it back and compare the bytes
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
      pattern: decodePatternSysex(before).pattern
    }
    device.backups.unshift(backup)
    device.backups.splice(MAX_BACKUPS)

    await client.writePattern(slot, pattern)
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
  playEvents,
  liveActive,
  panic,
  receivePattern,
  receiveSlots,
  sendPattern
})
