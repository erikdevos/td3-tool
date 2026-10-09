// TD-3-MO hardware bridge — NOT IMPLEMENTED YET.
//
// Everything that will talk to the real device lives in this folder.
// See ./README.md for the plan, the data mapping and what still has to be verified.
//
// The editor's data model (src/model/pattern.js) was designed to map 1:1 onto the
// hardware pattern memory, so this module only needs to translate, not restructure.

import { encodePatternSysex as encodePatternSysexFn } from '../model/td3format.js'

export const hardwareStatus = {
  implemented: false,
  webMidi: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
  note: 'Hardware transfer is not implemented yet — see src/hardware/README.md'
}

/**
 * Ask the browser for MIDI access (SysEx needs explicit permission).
 * Safe to call later from a user action; not used by the UI yet.
 * @returns {Promise<MIDIAccess>}
 */
export const requestMidiAccess = () => {
  if (!hardwareStatus.webMidi) return Promise.reject(new Error('Web MIDI is not available in this browser'))
  return navigator.requestMIDIAccess({ sysex: true })
}

/**
 * List MIDI ports whose name looks like a TD-3.
 * @param {MIDIAccess} access
 */
export const findTd3Ports = (access) => {
  const match = (port) => /td-?3/i.test(port.name || '')
  return {
    inputs: [...access.inputs.values()].filter(match),
    outputs: [...access.outputs.values()].filter(match)
  }
}

// Pattern SysEx encoding/decoding lives in src/model/td3format.js (shared with .seq files).
// Read the UNVERIFIED notes at the top of that file before sending anything to a device.
export { encodePatternSysex as encodePattern, decodePatternSysex as decodePattern, requestPatternSysex } from '../model/td3format.js'

/**
 * Send a pattern to the device.
 * TODO: wire to a UI action ("Send to TD-3" button in EditorBar.vue) after verifying
 * against a dump from a real unit, and back up the device's patterns first.
 * @param {MIDIOutput} output
 * @param {object} pattern editor pattern
 * @param {{group:number, section:number, number:number}} slot
 */
export const sendPattern = (output, pattern, slot) => {
  output.send(encodePatternSysexFn(pattern, slot))
}
