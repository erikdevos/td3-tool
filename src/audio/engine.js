import workletUrl from './td3-voice.worklet.js?url'

// Thin wrapper around the AudioContext + the TD-3 voice worklet.
// Everything time-critical happens inside the worklet; the main thread only
// sends parameter updates and timestamped note events.

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
    await ctx.audioWorklet.addModule(workletUrl)
    voice = new AudioWorkletNode(ctx, 'td3-voice', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    })
    analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    voice.connect(analyser)
    analyser.connect(ctx.destination)
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
  if (ts && ts.performanceTime) return ts.performanceTime + (time - ts.contextTime) * 1000
  return performance.now() + (time - ctx.currentTime) * 1000
}
