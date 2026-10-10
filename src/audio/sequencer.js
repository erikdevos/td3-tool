import { audioTime, clearVoice, outputClockReady, resumeAudio, sendEvents } from './engine.js'
import { midiOf, stepBeats } from '../model/pattern.js'

// Lookahead scheduler ("A tale of two clocks"): a coarse JS timer wakes up
// every 25 ms and schedules all steps that fall inside the next 120 ms with
// exact AudioContext timestamps. The worklet applies them sample-accurately.
//
// One master clock runs at 24 ticks per quarter note (the MIDI clock rate). TD-3 steps (6 ticks,
// or 4 in triplet mode), the drum companion's 16ths (6 ticks) and MIDI clock out all derive from
// the same tick times, so they stay locked together, also while the tempo changes.

const LOOKAHEAD = 0.12
const TICK_MS = 25
const GATE_LENGTH = 0.5 // 303 gate is roughly half a 16th step
const PPQ = 24
const SIXTEENTH = PPQ / 4

/** Shuffle: every second straight 16th comes later (triplet steps are not shuffled). */
export const swingDelay = (index, stepDur, shuffle, triplet = false) => (index % 2 === 1 && !triplet ? shuffle * stepDur * 0.33 : 0)

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
 * @param {(n:number, time:number, dur:number, later:(time:number, fn:() => void) => void) => void} [hooks.onSixteenth]
 *        every straight 16th from the start (n = 0, 1, 2 ...; time includes the shuffle), for the
 *        drum companion; `later` runs a UI update when that time is heard
 */
export const createSequencer = ({ getState, onWrap, onStep, output = sendEvents, onStop = () => {}, onClock = null, onSixteenth = null }) => {
  let timer = null
  let raf = null
  let nextTick = 0 // time of the next master clock tick
  let tickCount = 0
  let stepTicksLeft = 0 // ticks until the next TD-3 step
  let stepIndex = 0
  let gateOpen = false
  let uiQueue = []

  const later = (time, fn) => uiQueue.push({ time, fn })

  // returns the step's length in master ticks
  const scheduleStep = (index, time) => {
    const { pattern, bpm, shuffle } = getState()
    const stepDur = (60 / bpm) * stepBeats(pattern)
    const t = time + swingDelay(index, stepDur, shuffle, pattern.triplet)
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
    later(t, () => onStep(index))
    return Math.round(PPQ * stepBeats(pattern))
  }

  const tick = () => {
    const horizon = audioTime() + LOOKAHEAD
    while (nextTick < horizon) {
      const { bpm, shuffle } = getState()
      const tickDur = 60 / bpm / PPQ
      if (onClock) onClock('tick', nextTick)
      if (stepTicksLeft <= 0) {
        if (stepIndex >= getState().pattern.length) {
          stepIndex = 0
          onWrap()
        }
        stepTicksLeft = scheduleStep(stepIndex, nextTick)
        stepIndex += 1
      }
      if (onSixteenth && tickCount % SIXTEENTH === 0) {
        const n = tickCount / SIXTEENTH
        const dur = tickDur * SIXTEENTH
        onSixteenth(n, nextTick + swingDelay(n, dur, shuffle), dur, later)
      }
      stepTicksLeft -= 1
      tickCount += 1
      nextTick += tickDur
    }
  }

  const frame = () => {
    const now = audioTime()
    const due = uiQueue.filter((e) => e.time <= now)
    if (due.length) {
      uiQueue = uiQueue.filter((e) => e.time > now)
      due.forEach((e) => e.fn())
    }
    raf = requestAnimationFrame(frame)
  }

  const start = async () => {
    if (timer) return
    await resumeAudio()
    await outputClockReady() // so MIDI timestamps (notes, clock) are stable from the first step
    stepIndex = 0
    stepTicksLeft = 0
    tickCount = 0
    gateOpen = false
    uiQueue = []
    nextTick = audioTime() + 0.05
    if (onClock) onClock('start', nextTick - 0.001) // Start, then the first clock on step 1
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
