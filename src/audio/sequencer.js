import { audioTime, clearVoice, resumeAudio, sendEvents } from './engine.js'
import { midiOf } from '../model/pattern.js'

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
 */
export const createSequencer = ({ getState, onWrap, onStep }) => {
  let timer = null
  let raf = null
  let nextTime = 0
  let stepIndex = 0
  let gateOpen = false
  let uiQueue = []

  const scheduleStep = (index, time) => {
    const { pattern, bpm, shuffle } = getState()
    const stepDur = 60 / bpm / 4
    const swing = index % 2 === 1 ? shuffle * stepDur * 0.33 : 0
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

    sendEvents(events)
    uiQueue.push({ index, time: t })
    return stepDur
  }

  const tick = () => {
    const horizon = audioTime() + LOOKAHEAD
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
    stepIndex = 0
    gateOpen = false
    uiQueue = []
    nextTime = audioTime() + 0.05
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
  }

  return { start, stop, isRunning: () => Boolean(timer) }
}
