<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ROOT_NAMES, SCALES, isChromatic } from '../model/scale.js'
import { useEditor } from '../store/editor.js'
import HwButton from './hw/HwButton.vue'
import Knob from './hw/Knob.vue'
import SlideSwitch from './hw/SlideSwitch.vue'

// Second sequencer row: scale lock, transforms and the line generator.
// Everything here edits the current pattern (undoable) and stays within what the TD-3 stores.

const { state, setScale, transform, randomizePattern, mutate } = useEditor()

const RHYTHMS = ['random', 'even']
const RANGES = [1, 2, 3]

// generator settings popover
const showGen = ref(false)
const genRoot = ref(null)
const onDocDown = (event) => {
  if (showGen.value && genRoot.value && !genRoot.value.contains(event.target)) showGen.value = false
}
const onDocKey = (event) => {
  if (event.key === 'Escape') showGen.value = false
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocDown, true)
  document.addEventListener('keydown', onDocKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocDown, true)
  document.removeEventListener('keydown', onDocKey)
})

const pct = (v) => `${Math.round(v * 100)}%`
</script>

<template>
  <div class="lab">
    <div class="group">
      <span class="title">SCALE</span>
      <select
        class="lcd key"
        :value="state.scale.root"
        aria-label="Key"
        title="Key (root note)"
        @change="setScale({ root: Number($event.target.value) })"
      >
        <option v-for="(name, i) in ROOT_NAMES" :key="name" :value="i">{{ name }}</option>
      </select>
      <select
        class="lcd scale"
        :value="state.scale.type"
        aria-label="Scale"
        title="Scale: shown in the piano roll, used by the generator"
        @change="setScale({ type: $event.target.value })"
      >
        <option v-for="(s, key) in SCALES" :key="key" :value="key">{{ s.name }}</option>
      </select>
      <HwButton
        size="text"
        variant="dark"
        :class="{ off: isChromatic(state.scale) }"
        :title="state.scale.lock ? 'Lock on: new and moved notes snap into the scale' : 'Lock off: any note can be placed'"
        @press="setScale({ lock: !state.scale.lock })"
      >
        <span :class="['led', { on: state.scale.lock && !isChromatic(state.scale) }]" aria-hidden="true"></span>
        Lock
      </HwButton>
      <HwButton size="text" variant="dark" title="Move every note to the nearest note of the scale" @press="transform('fit')">
        Fit
      </HwButton>
    </div>

    <div class="group">
      <span class="title">TRANSFORM</span>
      <HwButton size="text" variant="dark" title="Play the pattern backwards" @press="transform('reverse')">Reverse</HwButton>
      <HwButton size="text" variant="dark" title="Turn the melody upside down (within its own range)" @press="transform('invert')">
        Invert
      </HwButton>
      <span class="pair" title="Move the accents to the previous / next note">
        <span class="pair-label">ACC</span>
        <HwButton size="text" variant="dark" title="Accents one note earlier" @press="transform('accentLeft')">◀</HwButton>
        <HwButton size="text" variant="dark" title="Accents one note later" @press="transform('accentRight')">▶</HwButton>
      </span>
      <span class="pair" title="Move the slides to the previous / next note">
        <span class="pair-label">SLIDE</span>
        <HwButton size="text" variant="dark" title="Slides one note earlier" @press="transform('slideLeft')">◀</HwButton>
        <HwButton size="text" variant="dark" title="Slides one note later" @press="transform('slideRight')">▶</HwButton>
      </span>
      <HwButton size="text" variant="dark" title="Double speed: the pattern in half the steps, played twice" @press="transform('double')">
        ×2
      </HwButton>
      <HwButton size="text" variant="dark" title="Half speed: the first half stretched over the whole pattern" @press="transform('half')">
        ÷2
      </HwButton>
    </div>

    <div ref="genRoot" class="group gen">
      <span class="title">GENERATE</span>
      <HwButton size="text" variant="light" title="New random line with these settings (R)" @press="randomizePattern">New</HwButton>
      <HwButton size="text" variant="dark" title="Change a few notes, accents and slides (M)" @press="mutate">Mutate</HwButton>
      <HwButton
        size="text"
        variant="dark"
        :active="showGen"
        title="Generator settings: density, ties, accent and slide, rhythm and range"
        @press="showGen = !showGen"
      >
        Settings ▾
      </HwButton>

      <div v-if="showGen" class="pop" role="dialog" aria-label="Generator settings">
        <div class="knobs">
          <Knob v-model="state.gen.density" size="sm" label="Notes" :default-value="0.7" :format="pct" />
          <Knob v-model="state.gen.ties" size="sm" label="Ties" :default-value="0.25" :format="pct" />
          <Knob v-model="state.gen.accent" size="sm" label="Accent" :default-value="0.3" :format="pct" />
          <Knob v-model="state.gen.slide" size="sm" label="Slide" :default-value="0.2" :format="pct" />
        </div>
        <div class="switches">
          <SlideSwitch
            orientation="horizontal"
            label="Rhythm"
            :positions="['RAND', 'EVEN']"
            :model-value="RHYTHMS.indexOf(state.gen.rhythm)"
            @update:model-value="state.gen.rhythm = RHYTHMS[$event]"
          />
          <SlideSwitch
            orientation="horizontal"
            label="Octaves"
            :positions="['1', '2', '3']"
            :model-value="RANGES.indexOf(state.gen.range)"
            @update:model-value="state.gen.range = RANGES[$event]"
          />
        </div>
        <p class="pop-note">
          Uses the key and scale on the left ({{ isChromatic(state.scale) ? `${ROOT_NAMES[state.scale.root]} minor` : 'as chosen' }}).
          EVEN spreads the notes evenly (Euclidean).
        </p>
        <div class="pop-actions">
          <HwButton size="text" variant="light" @press="randomizePattern">New</HwButton>
          <HwButton size="text" variant="dark" @press="mutate">Mutate</HwButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lab {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--print-line);
}

.group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.title {
  font-family: var(--font-panel);
  font-weight: 800;
  font-size: 11px;
  letter-spacing: 0.1em;
  display: inline-block;
  padding: 1px 7px;
  margin-right: 2px;
  border-radius: 3px;
  background: var(--ink);
  color: var(--chassis);
}

.group :deep(.hwb--text .cap) {
  padding: 0 7px;
}

.lcd {
  height: 24px;
  padding: 0 6px;
  border: 1px solid #000;
  border-radius: 3px;
  background: #0d0b08;
  box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.9);
  color: #ffb020;
  font-family: var(--font-display);
  font-size: 13px;
  text-transform: uppercase;
  cursor: pointer;
}

.lcd:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.lcd.key {
  width: 52px;
}

.lcd.scale {
  width: 118px;
}

.led {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 5px;
  border-radius: 50%;
  background: #3a1410;
  box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.6);
}

.led.on {
  background: #ff3b24;
  box-shadow: 0 0 5px #ff3b24, 0 0 1px #ff8a70;
}

.off {
  opacity: 0.55;
}

.pair {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin: 0 2px;
}

.pair-label {
  margin-right: 2px;
  font-family: var(--font-panel);
  font-weight: 800;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--print);
}

.gen {
  position: relative;
}

.pop {
  position: absolute;
  z-index: 20;
  top: calc(100% + 8px);
  right: 0;
  display: grid;
  gap: 10px;
  width: 300px;
  padding: 12px 14px;
  border: 1px solid var(--body-lo);
  border-radius: 6px;
  background: var(--chassis);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35), inset 0 1px 0 var(--body-hi);
  color: var(--ink);
}

.knobs {
  display: flex;
  justify-content: space-between;
}

.switches {
  display: grid;
  gap: 6px;
}

.switches :deep(.switch-label) {
  width: 62px;
}

.pop-note {
  margin: 0;
  font-size: 11px;
  line-height: 1.35;
  color: var(--ink-soft);
}

.pop-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
