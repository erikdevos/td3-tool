<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { duckRelease, faderDb, reverbSeconds } from '../model/mixer.js'
import { useDevice } from '../store/device.js'
import { useEditor } from '../store/editor.js'
import { useMixer } from '../store/mixer.js'
import Fader from './hw/Fader.vue'
import HwButton from './hw/HwButton.vue'
import Knob from './hw/Knob.vue'
import SevenSeg from './hw/SevenSeg.vue'

// Mixer popup (not modal: the editor stays usable). TD-3 and DRUMS channels with drive,
// compressor, reverb send, fader and mute; the TD-3 also has the kick sidechain. MASTER holds the
// one tempo (the same as the transport's) and the reverb size.
defineEmits(['close'])

const { mixer, meterLevels } = useMixer()
const { state, tapTempo } = useEditor()
const { device, clockActive, liveActive } = useDevice()

const MIN_BPM = 40
const MAX_BPM = 300
const tempo = computed({
  get: () => (state.bpm - MIN_BPM) / (MAX_BPM - MIN_BPM),
  set: (v) => {
    state.bpm = Math.round(MIN_BPM + v * (MAX_BPM - MIN_BPM))
  }
})

const pct = (v) => `${Math.round(v * 100)}%`
const db = (v) => {
  const d = faderDb(v)
  if (!Number.isFinite(d)) return '−∞ dB'
  return `${d > 0.05 ? '+' : ''}${d.toFixed(1)} dB`
}
const ms = (v) => `${Math.round(duckRelease(v) * 1000)} ms`
const secs = (v) => `${reverbSeconds(v).toFixed(1)} s`

const hardwareOnly = computed(() => liveActive() && device.muteLocal)
const clockNote = computed(() =>
  clockActive()
    ? 'The TD-3 over USB follows this tempo (clock out is on).'
    : 'One tempo for the TD-3 sequencer and the drums. With clock out on (TD-3 USB), the hardware follows it too.'
)

// ---- meters: peak with a falling bar and a clip LED (DOM updates, no reactivity per frame) ----

const meterEls = { td3: ref(null), drums: ref(null), master: ref(null) }
const shown = { td3: 0, drums: 0, master: 0 }
const clipUntil = ref(0)
const now = ref(0)
let raf = null

const toBar = (peak) => {
  const d = 20 * Math.log10(peak + 1e-9)
  return Math.min(1, Math.max(0, (d + 48) / 51)) // -48 dB .. +3 dB
}

const frame = () => {
  const levels = meterLevels()
  Object.keys(shown).forEach((key) => {
    shown[key] = Math.max(toBar(levels[key]), shown[key] - 0.025)
    meterEls[key].value?.style.setProperty('--lvl', shown[key].toFixed(3))
  })
  now.value = performance.now()
  if (levels.master >= 1) clipUntil.value = now.value + 1500
  raf = requestAnimationFrame(frame)
}

// ---- drag the popup by its head --------------------------------------------------------

const pos = ref({ x: 0, y: 84 })
const root = ref(null)
let drag = null

const clampPos = (x, y) => {
  const w = root.value?.offsetWidth || 460
  return { x: Math.min(Math.max(8, x), window.innerWidth - w - 8), y: Math.min(Math.max(8, y), window.innerHeight - 60) }
}

const startDrag = (event) => {
  if (event.button !== 0 || event.target.closest('button')) return
  drag = { dx: event.clientX - pos.value.x, dy: event.clientY - pos.value.y }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}
const moveDrag = (event) => {
  if (drag) pos.value = clampPos(event.clientX - drag.dx, event.clientY - drag.dy)
}
const endDrag = () => {
  drag = null
}

onMounted(() => {
  pos.value = clampPos(window.innerWidth - (root.value?.offsetWidth || 460) - 24, 84)
  raf = requestAnimationFrame(frame)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div ref="root" class="mixer" role="dialog" aria-label="Mixer" :style="{ left: `${pos.x}px`, top: `${pos.y}px` }">
    <div class="head" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag">
      <span class="title">MIXER</span>
      <button type="button" class="close" aria-label="Close mixer" title="Close (Esc)" @click="$emit('close')">×</button>
    </div>

    <div class="strips">
      <!-- TD-3 -->
      <section class="strip" aria-label="TD-3 channel">
        <span class="strip-name">TD-3</span>
        <div class="knobs">
          <Knob v-model="mixer.td3.drive" size="sm" label="Drive" :default-value="0" :format="pct" />
          <Knob v-model="mixer.td3.comp" size="sm" label="Comp" :default-value="0" :format="pct" />
          <Knob v-model="mixer.td3.reverb" size="sm" label="Reverb" :default-value="0" :format="pct" />
          <span></span>
          <Knob
            v-model="mixer.td3.duck"
            size="sm"
            label="Duck"
            :default-value="0"
            :format="pct"
            title="Sidechain: each kick of the drum machine ducks the TD-3"
          />
          <Knob v-model="mixer.td3.release" size="sm" label="Release" :default-value="0.4" :format="ms" />
        </div>
        <div class="fader-row">
          <span :ref="meterEls.td3" class="meter" aria-hidden="true"></span>
          <Fader v-model="mixer.td3.volume" label="TD-3 level" :format="db" />
        </div>
        <HwButton size="text" variant="dark" :title="mixer.td3.mute ? 'Unmute the TD-3' : 'Mute the TD-3'" @press="mixer.td3.mute = !mixer.td3.mute">
          <span :class="['led', { on: mixer.td3.mute }]" aria-hidden="true"></span>
          Mute
        </HwButton>
        <p v-if="hardwareOnly" class="strip-note">The real TD-3 is playing: its sound does not pass through here.</p>
      </section>

      <!-- DRUMS -->
      <section class="strip" aria-label="Drums channel">
        <span class="strip-name">Drums</span>
        <div class="knobs">
          <Knob v-model="mixer.drums.drive" size="sm" label="Drive" :default-value="0" :format="pct" />
          <Knob v-model="mixer.drums.comp" size="sm" label="Comp" :default-value="0" :format="pct" />
          <Knob v-model="mixer.drums.reverb" size="sm" label="Reverb" :default-value="0" :format="pct" />
        </div>
        <div class="fader-row">
          <span :ref="meterEls.drums" class="meter" aria-hidden="true"></span>
          <Fader v-model="mixer.drums.volume" label="Drums level" :format="db" />
        </div>
        <HwButton size="text" variant="dark" :title="mixer.drums.mute ? 'Unmute the drums' : 'Mute the drums'" @press="mixer.drums.mute = !mixer.drums.mute">
          <span :class="['led', { on: mixer.drums.mute }]" aria-hidden="true"></span>
          Mute
        </HwButton>
      </section>

      <!-- MASTER -->
      <section class="strip master" aria-label="Master">
        <span class="strip-name">Master</span>
        <div class="knobs master-knobs">
          <Knob v-model="tempo" size="sm" label="Tempo" :default-value="(126 - MIN_BPM) / (MAX_BPM - MIN_BPM)" :format="() => `${state.bpm} BPM`" />
          <div class="bpm">
            <SevenSeg :value="state.bpm" :digits="3" />
            <HwButton size="sm" variant="dark" label="Tap" title="Tap tempo" @press="tapTempo" />
          </div>
          <Knob v-model="mixer.master.reverbSize" size="sm" label="Reverb size" :default-value="0.5" :format="secs" />
        </div>
        <div class="fader-row">
          <span :ref="meterEls.master" class="meter" aria-hidden="true"></span>
          <Fader v-model="mixer.master.volume" label="Master level" :format="db" />
        </div>
        <span class="clip" :title="'Lights when the output clips (above 0 dB)'">
          <span :class="['led', { on: clipUntil > now }]" aria-hidden="true"></span>
          CLIP
        </span>
      </section>
    </div>

    <p class="note">{{ clockNote }}</p>
  </div>
</template>

<style scoped>
.mixer {
  position: fixed;
  z-index: 30;
  width: 452px;
  border: 1px solid var(--body-lo);
  border-radius: 8px;
  background-color: var(--chassis);
  background-image: var(--chassis-texture);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 var(--body-hi);
  color: var(--ink);
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px 6px 12px;
  border-bottom: 2px solid var(--ink-line);
  cursor: move;
  user-select: none;
  touch-action: none;
}

.title {
  padding: 1px 7px;
  border-radius: 3px;
  background: var(--ink);
  color: var(--chassis);
  font-weight: 800;
  font-size: 11px;
  letter-spacing: 0.1em;
}

.close {
  margin-left: auto;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: none;
  color: var(--ink);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.close:hover {
  background: rgba(0, 0, 0, 0.08);
}

.strips {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.strip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 8px 6px 10px;
}

.strip + .strip {
  border-left: 1px solid var(--ink-soft);
}

.strip-name {
  padding: 1px 8px;
  border-radius: 2px;
  background: var(--ink);
  color: var(--chassis);
  font-weight: 800;
  font-style: italic;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.knobs {
  display: grid;
  grid-template-columns: repeat(2, 64px);
  grid-auto-rows: 80px;
  height: 240px;
  justify-items: center;
}

.knobs :deep(.knob-label) {
  font-size: 9.5px;
  letter-spacing: 0.04em;
}

.master-knobs {
  grid-template-columns: 64px;
}

.bpm {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.fader-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

/* level meter: green - amber - red, lit up to --lvl (0..1, -48 .. +3 dB) */
.meter {
  --lvl: 0;
  position: relative;
  width: 8px;
  height: 132px;
  border-radius: 2px;
  background: linear-gradient(0deg, #2fbf3a 0%, #2fbf3a 70%, #ffb020 82%, #ff3b22 94%);
  box-shadow: 0 0 0 1px #000;
  overflow: hidden;
}

/* unlit part on top, plus the segment gaps */
.meter::before,
.meter::after {
  content: '';
  position: absolute;
  inset: 0;
}

.meter::before {
  bottom: calc(var(--lvl) * 100%);
  background: #14110c;
}

.meter::after {
  background: repeating-linear-gradient(0deg, transparent 0 4px, rgba(0, 0, 0, 0.7) 4px 5.5px);
}

.strip-note {
  margin: 0;
  max-width: 130px;
  font-size: 10px;
  line-height: 1.3;
  text-align: center;
  color: var(--ink-soft);
}

.clip {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  font-weight: 800;
  font-size: 10px;
  letter-spacing: 0.08em;
}

.led {
  margin-right: 5px;
}

.clip .led {
  margin-right: 0;
}

.note {
  margin: 0;
  padding: 7px 12px 9px;
  border-top: 1px solid var(--ink-soft);
  font-size: 11px;
  line-height: 1.35;
  color: var(--ink-soft);
}
</style>
