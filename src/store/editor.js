import { computed, reactive, toRaw, watch } from 'vue'
import { auditionOff, auditionOn, clearVoice, resumeAudio, setParams } from '../audio/engine.js'
import { createSequencer } from '../audio/sequencer.js'
import { FACTORY_VERSION, defaultPatch, normalizePatch, patchesEqual } from '../model/patch.js'
import {
  BANK_SIZE,
  BASE_MIDI,
  MAX_PITCH,
  MAX_STEPS,
  MIN_PITCH,
  TIMES,
  clonePattern,
  fromPitch,
  makePattern,
  midiOf,
  pitchOf,
  randomPattern,
  slotLabel
} from '../model/pattern.js'
import { decodeMidi, encodeMidi } from '../model/midi.js'
import { decodeSeq, encodeSeq } from '../model/td3format.js'
import { KEYS, downloadBlob, exportFile, loadAll, parseImportFile, write } from './storage.js'

// Single shared editor state (module singleton). Components import `useEditor()`.

const loaded = loadAll()
const session = loaded.session

const clampInt = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback)

const state = reactive({
  patch: session.patch ? normalizePatch(session.patch) : defaultPatch(),
  patchName: typeof session.patchName === 'string' ? session.patchName : 'INIT 303',
  presets: loaded.presets,
  bank: loaded.bank,
  slot: clampInt(session.slot, 0, BANK_SIZE - 1, 0),
  pendingSlot: null,
  selectedStep: 0,
  bpm: clampInt(session.bpm, 40, 300, 126),
  shuffle: Number.isFinite(session.shuffle) ? Math.min(1, Math.max(0, session.shuffle)) : 0,
  autoAdvance: session.autoAdvance !== false,
  playing: false,
  playStep: -1,
  audioReady: false,
  clipboard: null,
  toast: null
})

const pattern = computed(() => state.bank[state.slot])
const selected = computed(() => pattern.value.steps[state.selectedStep])
const activePreset = computed(() => state.presets.find((p) => p.name === state.patchName) || null)
const patchDirty = computed(() => !activePreset.value || !patchesEqual(activePreset.value.params, state.patch))

// ---- persistence -------------------------------------------------------------------

const debounce = (fn, ms) => {
  let id = null
  return () => {
    clearTimeout(id)
    id = setTimeout(fn, ms)
  }
}

const saveBank = debounce(() => write(KEYS.bank, toRaw(state.bank)), 300)
const savePresets = debounce(() => write(KEYS.presets, toRaw(state.presets)), 300)
const saveSession = debounce(
  () =>
    write(KEYS.session, {
      patch: toRaw(state.patch),
      patchName: state.patchName,
      slot: state.slot,
      bpm: state.bpm,
      shuffle: state.shuffle,
      autoAdvance: state.autoAdvance,
      factoryVersion: FACTORY_VERSION
    }),
  300
)

watch(() => state.bank, saveBank, { deep: true })
watch(() => state.presets, savePresets, { deep: true })
watch(
  () => [state.patch, state.patchName, state.slot, state.bpm, state.shuffle, state.autoAdvance],
  saveSession,
  { deep: true }
)

// push knob changes to the audio engine
watch(() => state.patch, (patch) => setParams(toRaw(patch)), { deep: true, immediate: true })

// ---- toast -------------------------------------------------------------------------

let toastTimer = null
const notify = (message) => {
  state.toast = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    state.toast = null
  }, 2200)
}

// ---- undo / redo (pattern edits) -----------------------------------------------

const history = { undo: [], redo: [], lastKey: null, lastAt: 0 }

// Snapshot the current pattern before an edit. Edits with the same `coalesce`
// key in quick succession (e.g. dragging over the roll) share one undo step.
const edit = (fn, coalesce = null) => {
  const now = performance.now()
  const merge = coalesce && coalesce === history.lastKey && now - history.lastAt < 800
  if (!merge) {
    history.undo.push({ slot: state.slot, pattern: clonePattern(pattern.value) })
    if (history.undo.length > 200) history.undo.shift()
    history.redo.length = 0
  }
  history.lastKey = coalesce
  history.lastAt = now
  fn(pattern.value)
}

const restore = (from, to) => {
  const entry = from.pop()
  if (!entry) return false
  to.push({ slot: entry.slot, pattern: clonePattern(state.bank[entry.slot]) })
  state.bank[entry.slot] = entry.pattern
  if (!state.playing) state.slot = entry.slot
  history.lastKey = null
  return true
}

const undo = () => restore(history.undo, history.redo) || notify('NOTHING TO UNDO')
const redo = () => restore(history.redo, history.undo) || notify('NOTHING TO REDO')

// ---- audio ---------------------------------------------------------------------------

const ensureAudio = async () => {
  try {
    await resumeAudio()
    state.audioReady = true
  } catch (error) {
    console.error(error)
    notify('AUDIO UNAVAILABLE')
  }
}

const audition = (step, length = 0.18) => {
  if (state.playing || !state.audioReady || step.time === 'rest') return
  clearVoice()
  auditionOn(midiOf(step), step.accent)
  auditionOff(length)
}

// ---- transport -------------------------------------------------------------------

const sequencer = createSequencer({
  getState: () => ({ pattern: pattern.value, bpm: state.bpm, shuffle: state.shuffle }),
  onWrap: () => {
    if (state.pendingSlot !== null) {
      state.slot = state.pendingSlot
      state.pendingSlot = null
    }
  },
  onStep: (index) => {
    state.playStep = index
  }
})

const play = async () => {
  await ensureAudio()
  if (!state.audioReady) return
  state.playing = true
  await sequencer.start()
}

const stop = () => {
  sequencer.stop()
  state.playing = false
  state.playStep = -1
  if (state.pendingSlot !== null) {
    state.slot = state.pendingSlot
    state.pendingSlot = null
  }
}

const togglePlay = () => (state.playing ? stop() : play())

const tapTimes = []
const tapTempo = () => {
  const now = performance.now()
  if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2000) tapTimes.length = 0
  tapTimes.push(now)
  if (tapTimes.length > 5) tapTimes.shift()
  if (tapTimes.length >= 2) {
    const avg = (tapTimes[tapTimes.length - 1] - tapTimes[0]) / (tapTimes.length - 1)
    state.bpm = Math.min(300, Math.max(40, Math.round(60000 / avg)))
  }
}

// ---- pattern memory --------------------------------------------------------------

const selectSlot = (index) => {
  if (index === state.slot && state.pendingSlot === null) return
  if (state.playing) {
    // like the hardware: switch when the current pattern has finished
    state.pendingSlot = index === state.slot ? null : index
  } else {
    state.slot = index
  }
  state.selectedStep = Math.min(state.selectedStep, state.bank[index].length - 1)
}

const copyPattern = () => {
  state.clipboard = clonePattern(pattern.value)
  notify('PATTERN COPIED')
}

const pastePattern = () => {
  if (!state.clipboard) return notify('CLIPBOARD EMPTY')
  edit((p) => {
    const copy = clonePattern(state.clipboard)
    p.length = copy.length
    p.steps = copy.steps
  })
  notify('PATTERN PASTED')
}

const clearPattern = () => {
  edit((p) => {
    const empty = makePattern()
    p.length = empty.length
    p.steps = empty.steps
  })
  state.selectedStep = 0
}

const randomizePattern = () => {
  edit((p) => {
    const rnd = randomPattern(p.length)
    p.steps = rnd.steps
  })
}

const shiftPattern = (dir) => {
  edit((p) => {
    const active = p.steps.slice(0, p.length)
    const rotated = dir > 0 ? [active[active.length - 1], ...active.slice(0, -1)] : [...active.slice(1), active[0]]
    p.steps.splice(0, p.length, ...rotated)
  }, `shift`)
}

const transposePattern = (semis) => {
  edit((p) => {
    const sounding = p.steps.filter((s) => s.time === 'note')
    const pitches = sounding.map(pitchOf)
    if (pitches.some((x) => x + semis < MIN_PITCH || x + semis > MAX_PITCH)) {
      notify('OUT OF RANGE')
      return
    }
    sounding.forEach((s) => Object.assign(s, fromPitch(pitchOf(s) + semis)))
  }, 'transpose')
}

const setLength = (length) => {
  const n = Math.min(MAX_STEPS, Math.max(1, length))
  if (n === pattern.value.length) return
  edit((p) => {
    p.length = n
  }, 'length')
  state.selectedStep = Math.min(state.selectedStep, n - 1)
}

// ---- step editing ---------------------------------------------------------------

const selectStep = (index) => {
  state.selectedStep = Math.min(pattern.value.length - 1, Math.max(0, index))
}

const moveSelection = (delta) => {
  const len = pattern.value.length
  state.selectedStep = (state.selectedStep + delta + len) % len
}

const advance = () => {
  if (state.autoAdvance) moveSelection(1)
}

// Key press on the note keyboard: write pitch to the selected step (WRITE/NEXT style)
const writeNote = (note) => {
  const index = state.selectedStep
  edit((p) => {
    const step = p.steps[index]
    step.note = note
    step.time = 'note'
  })
  audition(pattern.value.steps[index])
  advance()
}

const setOctave = (octave, index = state.selectedStep) => {
  edit((p) => {
    const step = p.steps[index]
    step.octave = step.octave === octave ? 0 : octave
  })
  audition(pattern.value.steps[index])
}

const setPitch = (index, pitch, coalesce = null) => {
  const step = pattern.value.steps[index]
  const next = fromPitch(pitch)
  if (step.time === 'note' && step.note === next.note && step.octave === next.octave) return
  edit((p) => {
    Object.assign(p.steps[index], next, { time: 'note' })
  }, coalesce)
  audition(pattern.value.steps[index], 0.12)
}

const nudgePitch = (index, delta) => {
  const step = pattern.value.steps[index]
  if (step.time !== 'note') return
  setPitch(index, pitchOf(step) + delta, `nudge-${index}`)
}

const toggleFlag = (flag, index = state.selectedStep) => {
  edit((p) => {
    p.steps[index][flag] = !p.steps[index][flag]
  })
}

const setTime = (time, index = state.selectedStep, { move = true } = {}) => {
  edit((p) => {
    p.steps[index].time = time
  })
  if (move && index === state.selectedStep) advance()
}

const cycleTime = (index) => {
  const step = pattern.value.steps[index]
  const next = TIMES[(TIMES.indexOf(step.time) + 1) % TIMES.length]
  setTime(next, index, { move: false })
}

const setRest = (index) => {
  edit((p) => {
    p.steps[index].time = 'rest'
  }, `paint-${index}`)
}

// ---- piano roll operations -----------------------------------------------------
// A "note" in the roll = a step with time 'note' plus the 'tie' steps that follow it.

const noteEnd = (p, start) => {
  let end = start + 1
  while (end < p.length && p.steps[end].time === 'tie') end += 1
  return end
}

const placeNote = (index, pitch, coalesce = null) => {
  if (index >= pattern.value.length) return
  edit((p) => {
    Object.assign(p.steps[index], fromPitch(pitch), { time: 'note' })
  }, coalesce)
  audition(pattern.value.steps[index], 0.14)
}

const deleteNote = (start) => {
  edit((p) => {
    const end = noteEnd(p, start)
    for (let i = start; i < end; i += 1) p.steps[i].time = 'rest'
  })
}

// Make the note starting at `start` span up to (not including) `end` using ties.
const resizeNote = (start, end, coalesce = null) => {
  const p0 = pattern.value
  const target = Math.min(p0.length, Math.max(start + 1, end))
  const current = noteEnd(p0, start)
  if (target === current) return
  edit((p) => {
    for (let i = start + 1; i < target; i += 1) p.steps[i].time = 'tie'
    for (let i = target; i < current; i += 1) p.steps[i].time = 'rest'
  }, coalesce)
}

let previewing = false
const previewPitch = async (pitch) => {
  if (state.playing) return
  await ensureAudio()
  clearVoice()
  auditionOn(BASE_MIDI + pitch, false, false)
  previewing = true
}

const previewRelease = () => {
  if (!previewing) return
  previewing = false
  auditionOff()
}

// ---- patches (knob presets) ---------------------------------------------------

const setParam = (key, value) => {
  state.patch[key] = value
}

const loadPreset = (name) => {
  const preset = state.presets.find((p) => p.name === name)
  if (!preset) return
  state.patch = normalizePatch(preset.params)
  state.patchName = preset.name
}

const savePreset = (name = state.patchName) => {
  const clean = (name || '').trim().slice(0, 16).toUpperCase() || `PATCH ${state.presets.length + 1}`
  const entry = { name: clean, params: { ...toRaw(state.patch) } }
  const index = state.presets.findIndex((p) => p.name === clean)
  if (index >= 0) state.presets.splice(index, 1, entry)
  else state.presets.push(entry)
  state.patchName = clean
  notify(`SAVED ${clean}`)
}

const deletePreset = () => {
  const index = state.presets.findIndex((p) => p.name === state.patchName)
  if (index < 0) return
  const [removed] = state.presets.splice(index, 1)
  notify(`DELETED ${removed.name}`)
}

const initPatch = () => {
  state.patch = defaultPatch()
  state.patchName = 'INIT 303'
}

const stepPreset = (dir) => {
  if (!state.presets.length) return
  const index = state.presets.findIndex((p) => p.name === state.patchName)
  const next = (index + dir + state.presets.length) % state.presets.length
  loadPreset(state.presets[next].name)
}

// ---- pattern library -----------------------------------------------------------

// Load a library entry into the current slot (undoable). Optionally also the
// suggested tempo and sound.
const loadLibraryEntry = (entry, { withSound = true } = {}) => {
  edit((p) => {
    const copy = clonePattern(entry.pattern)
    p.length = copy.length
    p.steps = copy.steps
  })
  state.selectedStep = 0
  if (withSound) {
    state.bpm = entry.bpm
    loadPreset(entry.sound)
  }
  notify(`LOADED ${entry.name.toUpperCase()}`)
}

// ---- file I/O ----------------------------------------------------------------------

const exportBank = () => {
  exportFile({
    bank: toRaw(state.bank),
    presets: toRaw(state.presets),
    session: { bpm: state.bpm, shuffle: state.shuffle }
  })
  notify('BANK EXPORTED')
}

const importBank = async (file) => {
  try {
    const data = await parseImportFile(file)
    stop()
    state.bank = data.bank
    if (data.presets) state.presets = data.presets
    if (data.session?.bpm) state.bpm = clampInt(data.session.bpm, 40, 300, state.bpm)
    history.undo.length = 0
    history.redo.length = 0
    notify('BANK IMPORTED')
  } catch (error) {
    console.error(error)
    notify('IMPORT FAILED')
  }
}

// ---- MIDI file import / export (current pattern) ------------------------------

const exportPatternMidi = () => {
  const label = slotLabel(state.slot)
  const bytes = encodeMidi(pattern.value, { bpm: state.bpm, name: `TD-3-MO ${label}` })
  downloadBlob(new Blob([bytes], { type: 'audio/midi' }), `td3mo-${label}.mid`)
  notify(`EXPORTED ${label}.MID`)
}

const exportPatternSeq = () => {
  const label = slotLabel(state.slot)
  downloadBlob(new Blob([encodeSeq(pattern.value)], { type: 'application/octet-stream' }), `td3mo-${label}.seq`)
  notify(`EXPORTED ${label}.SEQ`)
}

const replacePattern = (imported) => {
  edit((p) => {
    p.length = imported.length
    p.steps = imported.steps
  })
  state.selectedStep = 0
}

// Accepts .mid/.midi and SynthTribe .seq; the format is detected from the file content.
const importPatternFile = async (file) => {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const isMidi = bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64 // 'MThd'
    if (isMidi) {
      const { pattern: imported, bpm, truncated } = decodeMidi(bytes)
      replacePattern(imported)
      if (bpm && !state.playing) state.bpm = Math.min(300, Math.max(40, bpm))
      notify(truncated ? 'MIDI IMPORTED (FIRST BAR ONLY)' : 'MIDI IMPORTED')
    } else {
      const { pattern: imported, triplet } = decodeSeq(bytes)
      replacePattern(imported)
      notify(triplet ? 'SEQ IMPORTED (TRIPLET MODE NOT SUPPORTED)' : 'SEQ IMPORTED')
    }
  } catch (error) {
    console.error(error)
    notify(`IMPORT FAILED: ${error.message.toUpperCase()}`)
  }
}

export const useEditor = () => ({
  state,
  pattern,
  selected,
  activePreset,
  patchDirty,
  notify,
  ensureAudio,
  // transport
  play,
  stop,
  togglePlay,
  tapTempo,
  // memory
  selectSlot,
  copyPattern,
  pastePattern,
  clearPattern,
  randomizePattern,
  shiftPattern,
  transposePattern,
  setLength,
  undo,
  redo,
  // steps
  selectStep,
  moveSelection,
  writeNote,
  setOctave,
  setPitch,
  nudgePitch,
  toggleFlag,
  setTime,
  cycleTime,
  setRest,
  // piano roll
  noteEnd,
  placeNote,
  deleteNote,
  resizeNote,
  previewPitch,
  previewRelease,
  // patches
  setParam,
  loadPreset,
  savePreset,
  deletePreset,
  initPatch,
  stepPreset,
  // library
  loadLibraryEntry,
  // files
  exportPatternMidi,
  exportPatternSeq,
  importPatternFile,
  exportBank,
  importBank
})
