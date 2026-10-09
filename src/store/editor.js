import { computed, reactive, toRaw, watch } from 'vue'
import { audioTime, auditionOff, auditionOn, clearVoice, resumeAudio, sendEvents, setParams } from '../audio/engine.js'
import { createSequencer } from '../audio/sequencer.js'
import { DEFAULT_MODEL, DEFAULT_THEME, FACTORY_VERSION, MODELS, THEMES, defaultPatch, normalizePatch, patchesEqual } from '../model/patch.js'
import {
  BANK_SIZE,
  BASE_MIDI,
  MAX_PITCH,
  MAX_STEPS,
  MIN_PITCH,
  TIMES,
  clonePattern,
  fromPitch,
  isEmptyPattern,
  makePattern,
  midiOf,
  pitchOf,
  randomPattern,
  slotLabel
} from '../model/pattern.js'
import { decodeMidi, encodeMidi } from '../model/midi.js'
import { decodeSeq, encodeSeq } from '../model/td3format.js'
import { useDevice } from './device.js'
import { KEYS, downloadBlob, exportFile, loadAll, parseImportFile, write } from './storage.js'

// Single shared editor state (module singleton). Components import `useEditor()`.

const { playEvents: playOnDevice, panic: devicePanic, syncCutoff, syncTuning, device } = useDevice()

const loaded = loadAll()
const session = loaded.session

const validChain = (c) =>
  c && Number.isInteger(c.start) && Number.isInteger(c.end) && c.start >= 0 && c.end < BANK_SIZE && c.start < c.end
    ? { start: c.start, end: c.end }
    : null

const clampInt = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback)

const state = reactive({
  // which hardware the editor shows and emulates: 'td3mo' or 'td3'
  model: session.model in MODELS ? session.model : DEFAULT_MODEL,
  // body colour: 'yellow' | 'silver' | 'black'
  theme: session.theme in THEMES ? session.theme : DEFAULT_THEME,
  patch: session.patch ? normalizePatch(session.patch) : defaultPatch(),
  patchName: typeof session.patchName === 'string' ? session.patchName : 'INIT 303',
  presets: loaded.presets,
  bank: loaded.bank,
  slot: clampInt(session.slot, 0, BANK_SIZE - 1, 0),
  pendingSlot: null,
  // chain: play slots start..end (inclusive) in a loop, like holding several pattern buttons
  chain: validChain(session.chain),
  selectedStep: clampInt(session.selectedStep, 0, MAX_STEPS - 1, 0),
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
      chain: state.chain,
      model: state.model,
      theme: state.theme,
      selectedStep: state.selectedStep,
      factoryVersion: FACTORY_VERSION
    }),
  300
)

watch(() => state.bank, saveBank, { deep: true })
watch(() => state.presets, savePresets, { deep: true })
watch(
  () => [state.patch, state.patchName, state.slot, state.bpm, state.shuffle, state.autoAdvance, state.chain, state.model, state.theme, state.selectedStep],
  saveSession,
  { deep: true }
)

// push knob changes to the audio engine
watch(
  () => [state.patch, state.model],
  () => setParams({ ...toRaw(state.patch), model: state.model === 'td3' ? 1 : 0 }),
  { deep: true, immediate: true }
)

watch(
  () => state.theme,
  (theme) => {
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme
  },
  { immediate: true }
)

// CUT OFF FREQ -> TD-3-MO (CC 74) when linked; also push the current value when the link
// is switched on or the device (re)connects.
watch(
  () => [state.patch.cutoff, device.linkCutoff, device.status, device.outputId],
  () => syncCutoff(state.patch.cutoff)
)

// TUNING -> pitch bend on the device when linked (re-centred when the link is switched off)
watch(
  () => [state.patch.tuning, device.linkTuning, device.status, device.outputId, device.config?.bendRange],
  ([tuning, linked], old) => {
    if (linked || (old && old[1])) syncTuning(tuning, linked)
  }
)

const setTheme = (theme) => {
  if (theme in THEMES) state.theme = theme
}

const setModel = (model) => {
  if (!(model in MODELS) || model === state.model) return
  state.model = model
  notify(`${MODELS[model].name} MODE`)
}

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
// An undo entry is a list of { slot, pattern } snapshots (usually one).
const snapshot = (slots) => slots.map((slot) => ({ slot, pattern: clonePattern(state.bank[slot]) }))

const pushUndo = (slots) => {
  history.undo.push(snapshot(slots))
  if (history.undo.length > 200) history.undo.shift()
  history.redo.length = 0
}

const edit = (fn, coalesce = null) => {
  const now = performance.now()
  const merge = coalesce && coalesce === history.lastKey && now - history.lastAt < 800
  if (!merge) pushUndo([state.slot])
  history.lastKey = coalesce
  history.lastAt = now
  fn(pattern.value)
}

// Replace whole patterns in several slots as one undo step.
const replaceSlots = (entries) => {
  if (!entries.length) return
  pushUndo(entries.map((e) => e.slot))
  history.lastKey = null
  entries.forEach(({ slot, pattern: p }) => {
    state.bank[slot] = clonePattern(p)
  })
}

const restore = (from, to) => {
  const entry = from.pop()
  if (!entry) return false
  to.push(snapshot(entry.map((e) => e.slot)))
  entry.forEach((e) => {
    state.bank[e.slot] = e.pattern
  })
  if (!state.playing) state.slot = entry[0].slot
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
  mirrorAudition(midiOf(step), step.accent, length)
}

// Mirror an audition note to the device when live MIDI out is on.
const mirrorAudition = (midi, accent, length) => {
  const t = audioTime()
  playOnDevice([{ kind: 'on', time: t, midi, accent, slide: false }])
  if (length !== null) playOnDevice([{ kind: 'off', time: t + length }])
}

// ---- transport -------------------------------------------------------------------

const inChain = (slot) => Boolean(state.chain) && slot >= state.chain.start && slot <= state.chain.end

const nextChainSlot = () => {
  const { start, end } = state.chain
  return state.slot >= end || state.slot < start ? start : state.slot + 1
}

const sequencer = createSequencer({
  getState: () => ({ pattern: pattern.value, bpm: state.bpm, shuffle: state.shuffle }),
  onWrap: () => {
    if (state.pendingSlot !== null) {
      state.slot = state.pendingSlot
      state.pendingSlot = null
    } else if (inChain(state.slot)) {
      state.slot = nextChainSlot()
    }
  },
  onStep: (index) => {
    state.playStep = index
  },
  // WebAudio preview and/or the real TD-3 over MIDI
  output: (events) => {
    if (!(device.muteLocal && device.liveOut)) sendEvents(events)
    playOnDevice(events)
  },
  onStop: devicePanic
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

// Chain = a range of slots that play one after another. Shift-click on the bank sets it.
const setChain = (start, end) => {
  const a = Math.min(start, end)
  const b = Math.max(start, end)
  state.chain = a === b ? null : { start: a, end: b }
  if (state.chain) notify(`CHAIN ${slotLabel(a)} - ${slotLabel(b)}`)
}

const clearChain = () => {
  state.chain = null
}

const toggleTriplet = () => {
  edit((p) => {
    p.triplet = !p.triplet
  })
  notify(pattern.value.triplet ? 'TRIPLET MODE ON' : 'TRIPLET MODE OFF')
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
  mirrorAudition(BASE_MIDI + pitch, false, null)
  previewing = true
}

const previewRelease = () => {
  if (!previewing) return
  previewing = false
  auditionOff()
  playOnDevice([{ kind: 'off', time: audioTime() }])
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

// Exports the whole chain when the current slot is part of one.
const exportPatternMidi = () => {
  const chained = inChain(state.slot)
  const slots = chained
    ? Array.from({ length: state.chain.end - state.chain.start + 1 }, (_, i) => state.chain.start + i)
    : [state.slot]
  const label = chained ? `${slotLabel(slots[0])}_to_${slotLabel(slots[slots.length - 1])}` : slotLabel(state.slot)
  const bytes = encodeMidi(
    slots.map((i) => state.bank[i]),
    { bpm: state.bpm, name: `TD-3-MO ${label}` }
  )
  downloadBlob(new Blob([bytes], { type: 'audio/midi' }), `td3mo-${label}.mid`)
  notify(chained ? `EXPORTED CHAIN (${slots.length} PATTERNS)` : `EXPORTED ${label}.MID`)
}

const exportPatternSeq = () => {
  const label = slotLabel(state.slot)
  downloadBlob(new Blob([encodeSeq(pattern.value)], { type: 'application/octet-stream' }), `td3mo-${label}.seq`)
  notify(`EXPORTED ${label}.SEQ`)
}

const replacePattern = (imported) => {
  edit((p) => {
    p.length = imported.length
    p.triplet = Boolean(imported.triplet)
    p.steps = imported.steps
  })
  state.selectedStep = 0
}

const MAX_IMPORT_PATTERNS = 16

// Accepts .mid/.midi and SynthTribe .seq; the format is detected from the file content.
const importPatternFile = async (file) => {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const isMidi = bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64 // 'MThd'
    if (isMidi) {
      // longer files fill the following slots and become a chain
      const room = Math.min(MAX_IMPORT_PATTERNS, BANK_SIZE - state.slot)
      const { patterns, bpm, truncated } = decodeMidi(bytes, { maxPatterns: room })
      if (bpm && !state.playing) state.bpm = Math.min(300, Math.max(40, bpm))
      if (patterns.length === 1) {
        replacePattern(patterns[0])
        notify(truncated ? 'MIDI IMPORTED (FIRST BAR ONLY)' : 'MIDI IMPORTED')
      } else {
        const start = state.slot
        const end = start + patterns.length - 1
        const overwritten = patterns.filter((_, i) => i > 0 && !isEmptyPattern(state.bank[start + i])).length
        replaceSlots(patterns.map((p, i) => ({ slot: start + i, pattern: p })))
        state.chain = { start, end }
        state.selectedStep = 0
        notify(
          `MIDI: ${patterns.length} PATTERNS ${slotLabel(start)} TO ${slotLabel(end)}` +
            (overwritten ? ` (${overwritten} REPLACED, UNDO WITH CMD+Z)` : '') +
            (truncated ? ' (TRUNCATED)' : '')
        )
      }
    } else {
      const { pattern: imported } = decodeSeq(bytes)
      replacePattern(imported)
      notify(imported.triplet ? 'SEQ IMPORTED (TRIPLET)' : 'SEQ IMPORTED')
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
  setModel,
  setTheme,
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
  replaceSlots,
  setChain,
  clearChain,
  inChain,
  toggleTriplet,
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
