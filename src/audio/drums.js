import { decayTime, knobGain, tuneRate, VOICE_KEYS } from '../model/drums.js'
import { renderVoice } from './drumkit.js'
import { audioContext } from './engine.js'
import { drumInput } from './mixer.js'

// Plays the drum companion: each kit is rendered once (audio/drumkit.js) into AudioBuffers, every
// hit is a buffer source with its own gain, scheduled at an exact AudioContext time by the
// sequencer. The drum bus feeds the mixer's DRUMS channel (audio/mixer.js), not the scope, and
// nothing on the way adds latency (they stay in time with the synth and MIDI).

let bus = null
let volume = 0.7
const kits = new Map() // kit -> { voice: AudioBuffer }
let scheduled = [] // hits that may not have started yet: { src, gain, time }
let openHat = null // the ringing open hat; a closed (or new open) hat chokes it

const ensureBus = (ctx) => {
  if (!bus) {
    bus = ctx.createGain()
    bus.gain.value = knobGain(volume)
    bus.connect(drumInput() || ctx.destination)
  }
  return bus
}

/** Render a kit's buffers ahead of time (a few ms), e.g. when it is selected. */
export const prepareKit = (kit) => {
  const ctx = audioContext()
  if (!ctx || kits.has(kit)) return kits.get(kit) || null
  const buffers = {}
  VOICE_KEYS.forEach((voice) => {
    const data = renderVoice(kit, voice, ctx.sampleRate)
    const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate)
    buffer.copyToChannel(data, 0)
    buffers[voice] = buffer
  })
  kits.set(kit, buffers)
  return buffers
}

export const setDrumVolume = (value) => {
  volume = value
  const ctx = audioContext()
  if (bus && ctx) bus.gain.setTargetAtTime(knobGain(value), ctx.currentTime, 0.02)
}

const choke = (time) => {
  if (!openHat) return
  const { gain, src } = openHat
  openHat = null
  gain.gain.cancelScheduledValues(time)
  gain.gain.setTargetAtTime(0, time, 0.004)
  try {
    src.stop(time + 0.05)
  } catch {
    // already stopped
  }
}

/**
 * One hit at AudioContext `time` (default: now).
 * @param {{tune:number, decay:number, level:number}} settings  the voice's knobs (0..1)
 */
export const playDrum = (kit, voice, time = null, { tune = 0.5, decay = 1, level = 0.7 } = {}) => {
  const ctx = audioContext()
  const buffers = ctx && prepareKit(kit)
  if (!buffers) return
  const at = Math.max(time ?? ctx.currentTime, ctx.currentTime)
  if (voice === 'ch' || voice === 'oh') choke(at)

  const src = ctx.createBufferSource()
  src.buffer = buffers[voice]
  src.playbackRate.value = tuneRate(tune)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(knobGain(level), at)
  const tau = decayTime(decay)
  if (Number.isFinite(tau)) gain.gain.setTargetAtTime(0, at + 0.005, tau)
  src.connect(gain).connect(ensureBus(ctx))
  src.start(at)
  const hit = { src, gain, time: at }
  src.onended = () => {
    scheduled = scheduled.filter((h) => h !== hit)
    src.disconnect()
    gain.disconnect()
  }
  scheduled.push(hit)
  if (voice === 'oh') openHat = hit
}

/** Transport stopped: cancel the hits that were scheduled ahead but have not sounded yet. */
export const cancelDrums = () => {
  const ctx = audioContext()
  if (!ctx) return
  const now = ctx.currentTime
  scheduled = scheduled.filter((hit) => {
    if (hit.time <= now) return true // already sounding: let it ring out, like the hardware
    try {
      hit.src.stop()
    } catch {
      // not started
    }
    return false
  })
}
