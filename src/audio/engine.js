import fxUrl from './fx-strip.worklet.js?url&no-inline' // a real file (small assets get inlined as data: URLs)
import workletUrl from './td3-voice.worklet.js?url'
import { buildMixer } from './mixer.js'

// Thin wrapper around the AudioContext + the TD-3 voice worklet.
// Everything time-critical happens inside the worklet; the main thread only
// sends parameter updates and timestamped note events.
// Output: voice -> mixer (audio/mixer.js) -> speakers. The scope taps the voice before the
// mixer, so it always shows the plain TD-3 emulation.

let ctx = null
let voice = null
let analyser = null
let initPromise = null
let pendingParams = null

export const audioSupported = () =>
  typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext)

export const initAudio = () => {
  if (initPromise) return initPromise
  initPromise = (async () => {
    const Ctor = window.AudioContext || window.webkitAudioContext
    ctx = new Ctor({ latencyHint: 'interactive' })
    await Promise.all([ctx.audioWorklet.addModule(workletUrl), ctx.audioWorklet.addModule(fxUrl)])
    voice = new AudioWorkletNode(ctx, 'td3-voice', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    })
    analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    voice.connect(analyser) // scope tap (analysers run without an output connection)
    buildMixer(ctx, voice)
    if (pendingParams) voice.port.postMessage({ type: 'params', params: pendingParams })
    return ctx
  })()
  initPromise.catch(() => {
    initPromise = null
  })
  return initPromise
}

export const resumeAudio = async () => {
  await initAudio()
  if (ctx.state !== 'running') await ctx.resume()
  return ctx
}

export const audioTime = () => (ctx ? ctx.currentTime : 0)
export const audioContext = () => ctx
export const getAnalyser = () => analyser

export const setParams = (params) => {
  pendingParams = { ...params }
  if (voice) voice.port.postMessage({ type: 'params', params: pendingParams })
}

export const sendEvents = (events) => {
  if (voice && events.length) voice.port.postMessage({ type: 'events', events })
}

export const clearVoice = () => {
  if (voice) voice.port.postMessage({ type: 'clear' })
}

// Immediate note for auditioning (keys, step edits).
export const auditionOn = (midi, accent = false, slide = false) => {
  if (!ctx) return
  sendEvents([{ kind: 'on', time: ctx.currentTime, midi, accent, slide }])
}

export const auditionOff = (delay = 0) => {
  if (!ctx) return
  sendEvents([{ kind: 'off', time: ctx.currentTime + delay }])
}

// AudioContext time -> performance.now() time, for timestamped Web MIDI messages that
// should line up with what the speakers play (getOutputTimestamp includes output latency).
export const audioTimeToMs = (time) => {
  if (!ctx) return performance.now()
  const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null
  if (ts && ts.contextTime > 0) return ts.performanceTime + (time - ts.contextTime) * 1000
  // no output timestamp yet: estimate the output latency ourselves
  return performance.now() + (time - ctx.currentTime + (ctx.outputLatency || 0)) * 1000
}

/**
 * Right after the context starts, getOutputTimestamp() reports contextTime 0 (with a stale
 * performanceTime) for a few tens of milliseconds; measured in Chrome: ~50 ms. MIDI timestamps
 * computed in that window come out ~45 ms off from the ones after it. Wait (at most 250 ms)
 * until it reports a real time.
 */
export const outputClockReady = async () => {
  if (!ctx || typeof ctx.getOutputTimestamp !== 'function') return
  const t0 = performance.now()
  while (!(ctx.getOutputTimestamp().contextTime > 0) && performance.now() - t0 < 250) {
    await new Promise((r) => setTimeout(r, 10))
  }
}
