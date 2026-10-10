import { reactive, watch } from 'vue'
import { audioContext } from '../audio/engine.js'
import { cancelDrums, playDrum, prepareKit, setDrumVolume } from '../audio/drums.js'
import { duckAt, resetDuck } from '../audio/mixer.js'
import { DRUM_STEPS, VOICE_KEYS, grooveSteps, isEmptySteps, normalizeDrums, serializeDrums, stepsEqual } from '../model/drums.js'
import { KEYS, read, write } from './storage.js'

// Drum companion state (module singleton). The editor's sequencer calls onSixteenth() for every
// straight 16th, so the drums share its tempo, shuffle and start/stop.

const drums = reactive({
  ...normalizeDrums(read(KEYS.drums)),
  playStep: -1 // step that is sounding now (-1 = stopped)
})

let saveTimer = null
watch(
  () => [drums.kit, drums.on, drums.volume, drums.steps, drums.voices],
  () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => write(KEYS.drums, serializeDrums(drums)), 300)
  },
  { deep: true }
)

watch(() => drums.volume, setDrumVolume, { immediate: true })
// render the new kit right away, not on its first hit inside the scheduler
watch(() => drums.kit, (kit) => prepareKit(kit))

/** Audio just started (first user gesture): render the current kit. */
const prepare = () => prepareKit(drums.kit)

/** Drums will sound when the transport runs. */
const audible = () => drums.on && VOICE_KEYS.some((k) => !drums.voices[k].mute && drums.steps[k].some(Boolean))

// ---- playback ----------------------------------------------------------------------------

const onSixteenth = (n, time, _dur, later) => {
  const index = n % DRUM_STEPS
  if (drums.on) {
    VOICE_KEYS.forEach((voice) => {
      if (!drums.steps[voice][index] || drums.voices[voice].mute) return
      playDrum(drums.kit, voice, time, drums.voices[voice])
      if (voice === 'bd') duckAt(time) // mixer sidechain: the kick ducks the TD-3
    })
  }
  later(time, () => {
    drums.playStep = index
  })
}

const onStop = () => {
  cancelDrums()
  resetDuck()
  drums.playStep = -1
}

const audition = (voice) => {
  if (audioContext()) playDrum(drums.kit, voice, null, drums.voices[voice])
}

// ---- editing (own undo history: drum edits are not TD-3 pattern edits) -------------------

const history = { undo: [], redo: [] }
const copySteps = () => Object.fromEntries(VOICE_KEYS.map((k) => [k, [...drums.steps[k]]]))

const checkpoint = () => {
  history.undo.push(copySteps())
  if (history.undo.length > 100) history.undo.shift()
  history.redo.length = 0
}

const setStep = (voice, index, on) => {
  drums.steps[voice][index] = on
}

const replaceSteps = (steps) => {
  if (stepsEqual(steps, drums.steps)) return false
  checkpoint()
  VOICE_KEYS.forEach((k) => {
    drums.steps[k] = [...steps[k]]
  })
  return true
}

const loadGroove = (groove) => replaceSteps(grooveSteps(groove))
const clearSteps = () => replaceSteps(grooveSteps({ rows: {} }))

const restoreFrom = (from, to) => {
  const entry = from.pop()
  if (!entry) return false
  to.push(copySteps())
  VOICE_KEYS.forEach((k) => {
    drums.steps[k] = entry[k]
  })
  return true
}

const undo = () => restoreFrom(history.undo, history.redo)
const redo = () => restoreFrom(history.redo, history.undo)

/** Which groove (if any) the current steps are exactly. */
const matchGroove = (grooves) => grooves.find((g) => stepsEqual(grooveSteps(g), drums.steps)) || null

export const useDrums = () => ({
  drums,
  prepare,
  audible,
  isEmpty: () => isEmptySteps(drums.steps),
  onSixteenth,
  onStop,
  audition,
  checkpoint,
  setStep,
  loadGroove,
  clearSteps,
  matchGroove,
  undo,
  redo
})
