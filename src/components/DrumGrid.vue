<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import { DRUM_STEPS, DRUM_VOICES } from '../model/drums.js'
import { useDrums } from '../store/drums.js'
import { useEditor } from '../store/editor.js'

// Drum companion, step grid: one row per voice, 16 steps. Click a step to set or clear it, drag to
// paint more; click a row name to mute that voice.
const { drums, checkpoint, setStep, audition } = useDrums()
const { state } = useEditor()

const steps = Array.from({ length: DRUM_STEPS }, (_, i) => i)

// value being painted while the mouse button is down (null = not painting), and the last cell
let paint = null
let last = null

const down = (voice, i, event) => {
  if (event.button !== 0) return
  event.preventDefault()
  // touch captures the pointer to the first cell; release it so dragging reaches the others
  try {
    event.target.releasePointerCapture?.(event.pointerId)
  } catch {
    // not captured
  }
  checkpoint()
  paint = !drums.steps[voice][i]
  last = { voice, i }
  setStep(voice, i, paint)
  if (paint && !state.playing) audition(voice)
}

// a quick drag can skip cells: fill the ones between the last cell and this one (same row)
const enter = (voice, i) => {
  if (paint === null) return
  const from = last && last.voice === voice ? last.i : i
  for (let k = Math.min(from, i); k <= Math.max(from, i); k += 1) setStep(voice, k, paint)
  last = { voice, i }
}

// keyboard (Enter on a focused step); mouse clicks are handled on pointerdown
const keyToggle = (voice, i, event) => {
  if (event.detail !== 0) return
  checkpoint()
  setStep(voice, i, !drums.steps[voice][i])
  if (drums.steps[voice][i] && !state.playing) audition(voice)
}

const end = () => {
  paint = null
  last = null
}

onMounted(() => window.addEventListener('pointerup', end))
onBeforeUnmount(() => window.removeEventListener('pointerup', end))

const playing = (i) => state.playing && drums.playStep === i
</script>

<template>
  <div class="dg">
    <div class="grid">
      <span class="gutter-title">STEP</span>
      <div class="head">
        <span v-for="i in steps" :key="`h${i}`" :class="['head-cell', { beat: i % 4 === 0 }]">
          <span :class="['led', { on: playing(i) }]"></span>
          <span class="num">{{ i + 1 }}</span>
        </span>
      </div>
    </div>

    <div v-for="v in DRUM_VOICES" :key="v.key" :class="['grid', 'row', { muted: drums.voices[v.key].mute }]">
      <button
        type="button"
        class="voice-key"
        :aria-pressed="!drums.voices[v.key].mute"
        :title="`${v.name}: click to ${drums.voices[v.key].mute ? 'unmute' : 'mute'}`"
        @click="drums.voices[v.key].mute = !drums.voices[v.key].mute"
      >
        <span :class="['led', { on: !drums.voices[v.key].mute }]" aria-hidden="true"></span>
        <span class="voice-label">{{ v.label }}</span>
      </button>
      <div class="lane" role="group" :aria-label="v.name" @contextmenu.prevent>
        <button
          v-for="i in steps"
          :key="i"
          type="button"
          :class="['pad', { on: drums.steps[v.key][i], beat: i % 4 === 0, now: playing(i) }]"
          :aria-pressed="drums.steps[v.key][i]"
          :aria-label="`${v.name} step ${i + 1}`"
          @pointerdown="down(v.key, i, $event)"
          @pointerenter="enter(v.key, i)"
          @click="keyToggle(v.key, i, $event)"
        >
          <span></span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dg {
  --gutter: 60px; /* same columns as the piano roll */
  display: grid;
  gap: 4px;
  user-select: none;
  -webkit-user-select: none;
}

.grid {
  display: grid;
  grid-template-columns: var(--gutter) minmax(0, 1fr);
  align-items: center;
}

.head,
.lane {
  display: grid;
  grid-template-columns: repeat(16, minmax(0, 1fr));
  gap: 2px;
  padding: 0 3px;
}

.gutter-title {
  justify-self: start;
  font-family: var(--font-panel);
  font-weight: 800;
  font-size: 10px;
  letter-spacing: 0.08em;
  padding: 1px 4px;
  border-radius: 2px;
  background: var(--ink);
  color: var(--chassis);
}

.head-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 2px 0 3px;
}

.head-cell .num {
  font-family: var(--font-panel);
  font-weight: 700;
  font-size: 12px;
  line-height: 1;
  opacity: 0.7;
}

.head-cell.beat .num {
  opacity: 1;
  font-weight: 800;
}

/* row name = a light key like the piano keys; click to mute */
.voice-key {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 34px;
  margin-right: 4px;
  padding: 0 7px;
  border: 0;
  border-radius: 3px 0 0 3px;
  background: linear-gradient(90deg, #cfcbbf, #efece4 70%, #e2ded3);
  box-shadow: 0 0 0 1px #000;
  cursor: pointer;
}

.voice-key:active {
  filter: brightness(0.82);
}

.voice-label {
  font-family: var(--font-display);
  font-size: 13px;
  color: #1a1a1a;
}

.lane {
  height: 34px;
  padding: 3px;
  border-radius: 0 4px 4px 0;
  background: #120d05;
  box-shadow: inset 0 0 0 1px #000, inset 0 2px 8px rgba(0, 0, 0, 0.9);
  touch-action: none;
}

.pad {
  display: flex;
  padding: 2px;
  border: 0;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
}

.pad.beat {
  background: rgba(255, 200, 80, 0.09);
}

.pad.now {
  background: rgba(255, 70, 40, 0.3);
}

.pad span {
  flex: 1;
  border-radius: 2px;
}

.pad.on span {
  border: 1px solid #5a2e00;
  background: linear-gradient(180deg, #ffb53a, #f08a0c);
  box-shadow: 0 0 8px rgba(255, 150, 20, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.45);
}

.pad.on.now span {
  background: linear-gradient(180deg, #fff59a, #ffd21f);
  box-shadow: 0 0 12px rgba(255, 220, 60, 0.75), inset 0 1px 0 #fff;
}

.pad:hover:not(.on) span {
  background: rgba(255, 200, 80, 0.12);
}

.pad:focus-visible,
.voice-key:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.row.muted .pad {
  opacity: 0.3;
}

.row.muted .voice-label {
  color: #8a867c;
}
</style>
