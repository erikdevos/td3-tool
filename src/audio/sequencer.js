import { audioTime, clearVoice, outputClockReady, resumeAudio, sendEvents } from './engine.js'
import { midiOf, stepBeats } from '../model/pattern.js'

// Lookahead scheduler ("A tale of two clocks"): a coarse JS timer wakes up
// every 25 ms and schedules all steps that fall inside the next 120 ms with
// exact AudioContext timestamps. The worklet applies them sample-accurately.

const LOOKAHEAD = 0.12
const TICK_MS = 25
const GATE_LENGTH = 0.5 // 303 gate is roughly half a 16th step

/**
 * @param {object} hooks
 * @param {() => {pattern, bpm, shuffle}} hooks.getState  read live state each step
 * @param {() => void} hooks.onWrap   called when the pattern loops (pattern change point)
 * @param {(step:number) => void} hooks.onStep  called (in sync with audio) when a step sounds
 * @param {(events:object[]) => void} [hooks.output]  where voice events go (default: the WebAudio voice)
 * @param {() => void} [hooks.onStop]  called after the sequencer stopped (silence external gear here)
 * @param {(kind:'start'|'tick'|'stop', time:number|null) => void} [hooks.onClock]
 *        MIDI clock: 'start' just before the first tick, then 24 'tick's per quarter note at the
 *        current tempo (straight: shuffle and triplet steps do not change the clock), 'stop' at the end
 */
export const createSequencer = ({ getState, onWrap, onStep, output = sendEvents, onStop = () => {}, onClock = null }) => {
  let timer = null
  let raf = null
  let nextTime = 0
  let nextClock = 0
  let stepIndex = 0
  let gateOpen = false
  let uiQueue = []

  const scheduleStep = (index, time) => {
    const { pattern, bpm, shuffle } = getState()
    const stepDur = (60 / bpm) * stepBeats(pattern)
    const swing = index % 2 === 1 && !pattern.triplet ? shuffle * stepDur * 0.33 : 0
    const t = time + swing
    const step = pattern.steps[index]
    const next = pattern.steps[(index + 1) % pattern.length]
    const events = []

    const sounding = step.time === 'note' || (step.time === 'tie' && gateOpen)

    if (step.time === 'note') {
      // gate still open = previous step slid into this one
      events.push({ kind: 'on', time: t, midi: midiOf(step), accent: step.accent, slide: gateOpen })
    } else if (!sounding && gateOpen) {
      // pattern was edited under us: never leave a note hanging
      events.push({ kind: 'off', time: t })
    }

    if (sounding) {
      const holdGate = next.time === 'tie' || (step.slide && next.time === 'note')
      if (!holdGate) events.push({ kind: 'off', time: t + stepDur * GATE_LENGTH })
      gateOpen = holdGate
    } else {
      gateOpen = false
    }

    output(events)
    uiQueue.push({ index, time: t })
    return stepDur
  }

  const tick = () => {
    const horizon = audioTime() + LOOKAHEAD
    if (onClock) {
      while (nextClock < horizon) {
        onClock('tick', nextClock)
        nextClock += 60 / getState().bpm / 24
      }
    }
    while (nextTime < horizon) {
      let { pattern } = getState()
      if (stepIndex >= pattern.length) {
        stepIndex = 0
        onWrap()
        pattern = getState().pattern
      }
      nextTime += scheduleStep(stepIndex, nextTime)
      stepIndex += 1
    }
  }

  const frame = () => {
    const now = audioTime()
    let latest = null
    while (uiQueue.length && uiQueue[0].time <= now) latest = uiQueue.shift()
    if (latest) onStep(latest.index)
    raf = requestAnimationFrame(frame)
  }

  const start = async () => {
    if (timer) return
    await resumeAudio()
    await outputClockReady() // so MIDI timestamps (notes, clock) are stable from the first step
    stepIndex = 0
    gateOpen = false
    uiQueue = []
    nextTime = audioTime() + 0.05
    nextClock = nextTime
    if (onClock) onClock('start', nextTime - 0.001) // Start, then the first clock on step 1
    tick()
    timer = setInterval(tick, TICK_MS)
    raf = requestAnimationFrame(frame)
  }

  const stop = () => {
    clearInterval(timer)
    cancelAnimationFrame(raf)
    timer = null
    raf = null
    uiQueue = []
    gateOpen = false
    clearVoice()
    if (onClock) onClock('stop', null)
    onStop()
  }

  return { start, stop, isRunning: () => Boolean(timer) }
}
