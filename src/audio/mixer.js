import { defaultMixer, duckFloor, duckRelease, faderGain, reverbSeconds, sendGain } from '../model/mixer.js'
import { impulseResponse } from './reverb.js'

// The mixer graph (module singleton), built once by engine.js when audio starts:
//
//   TD-3 voice -> [fx: drive, comp] -> duck -> fader -> master -> output
//   drum bus   -> [fx: drive, comp] --------> fader -> master
//   each fader -> reverb send -> convolver -> master
//
// Nothing on the dry paths adds latency (the fx worklet has no lookahead, the reverb runs in
// parallel), so the TD-3, the drums and MIDI out stay in time. The sidechain is not an envelope
// follower: the drum machine tells us when each kick is scheduled and the duck gain is automated
// at exactly that time.

let ctx = null
let graph = null
let settings = defaultMixer()
let reverbTimer = null

const SMOOTH = 0.02

const strip = (fxOptions) => {
  const fx = new AudioWorkletNode(ctx, 'fx-strip', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: fxOptions
  })
  const duck = ctx.createGain()
  const fader = ctx.createGain()
  const send = ctx.createGain()
  const meter = ctx.createAnalyser()
  meter.fftSize = 1024
  send.gain.value = 0
  fx.connect(duck).connect(fader)
  fader.connect(meter)
  fader.connect(send)
  return { input: fx, fx, duck, fader, send, meter }
}

/** Build the graph. `td3` is the voice node; returns nothing, use drumInput() for the drums. */
export const buildMixer = (context, td3) => {
  ctx = context
  const master = ctx.createGain()
  const masterMeter = ctx.createAnalyser()
  masterMeter.fftSize = 1024
  const reverbIn = ctx.createGain()
  const reverbOut = ctx.createGain()
  graph = {
    td3: strip({ attack: 0.0005, release: 0.15 }),
    drums: strip({ attack: 0.001, release: 0.12 }),
    master,
    masterMeter,
    reverbIn,
    reverbOut,
    convolver: null
  }
  td3.connect(graph.td3.input)
  ;['td3', 'drums'].forEach((key) => {
    graph[key].fader.connect(master)
    graph[key].send.connect(reverbIn)
  })
  reverbOut.connect(master)
  master.connect(masterMeter)
  master.connect(ctx.destination)
  applyNow(settings, true)
  loadReverb(settings.master.reverbSize)
}

/** Where the drum machine's bus connects (null before audio has started). */
export const drumInput = () => (graph ? graph.drums.input : null)

const setParam = (param, value, immediate) => {
  if (immediate) param.value = value
  else param.setTargetAtTime(value, ctx.currentTime, SMOOTH)
}

// A new size swaps in a new convolver; the old one keeps ringing out its tail.
const loadReverb = (size) => {
  const seconds = reverbSeconds(size)
  const [left, right] = impulseResponse(ctx.sampleRate, seconds)
  const buffer = ctx.createBuffer(2, left.length, ctx.sampleRate)
  buffer.copyToChannel(left, 0)
  buffer.copyToChannel(right, 1)
  const conv = ctx.createConvolver()
  conv.normalize = false
  conv.buffer = buffer
  conv.connect(graph.reverbOut)
  const old = graph.convolver
  graph.reverbIn.connect(conv)
  if (old) {
    graph.reverbIn.disconnect(old)
    setTimeout(() => old.disconnect(), 4500)
  }
  graph.convolver = conv
}

const applyNow = (s, immediate = false) => {
  ;['td3', 'drums'].forEach((key) => {
    const g = graph[key]
    const c = s[key]
    setParam(g.fx.parameters.get('drive'), c.drive, immediate)
    setParam(g.fx.parameters.get('comp'), c.comp, immediate)
    setParam(g.fader.gain, c.mute ? 0 : faderGain(c.volume), immediate)
    setParam(g.send.gain, sendGain(c.reverb), immediate)
  })
  setParam(graph.master.gain, faderGain(s.master.volume), immediate)
}

/** New mixer settings (from the store); applied now, or when audio starts. */
export const setMixer = (next) => {
  const sizeChanged = next.master.reverbSize !== settings.master.reverbSize
  settings = JSON.parse(JSON.stringify(next))
  if (!graph) return
  applyNow(settings)
  if (sizeChanged) {
    clearTimeout(reverbTimer)
    reverbTimer = setTimeout(() => loadReverb(settings.master.reverbSize), 150)
  }
}

// ---- sidechain -----------------------------------------------------------------------------

/** A kick will sound at `time`: duck the TD-3 channel then (if DUCK is up). */
export const duckAt = (time) => {
  const depth = settings.td3.duck
  if (!graph || depth <= 0) return
  const gain = graph.td3.duck.gain
  gain.setTargetAtTime(duckFloor(depth), time, 0.0015) // down within a few ms
  gain.setTargetAtTime(1, time + 0.012, duckRelease(settings.td3.release))
}

/** Transport stopped: drop the ducks that were scheduled ahead and open up again. */
export const resetDuck = () => {
  if (!graph) return
  const gain = graph.td3.duck.gain
  gain.cancelScheduledValues(ctx.currentTime)
  gain.setTargetAtTime(1, ctx.currentTime, 0.02)
}

// ---- meters --------------------------------------------------------------------------------

let buf = null
const peakOf = (analyser) => {
  if (!buf || buf.length !== analyser.fftSize) buf = new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(buf)
  let peak = 0
  for (let i = 0; i < buf.length; i += 1) peak = Math.max(peak, Math.abs(buf[i]))
  return peak
}

/** Current peak level (linear) per channel and of the master; zeros before audio has started. */
export const meterLevels = () =>
  graph
    ? { td3: peakOf(graph.td3.meter), drums: peakOf(graph.drums.meter), master: peakOf(graph.masterMeter) }
    : { td3: 0, drums: 0, master: 0 }
