<script setup>
import { DRUM_VOICES, KITS } from '../model/drums.js'
import { useDrums } from '../store/drums.js'
import Knob from './hw/Knob.vue'
import SlideSwitch from './hw/SlideSwitch.vue'

// Drum companion, upper panel (in place of the synth knobs): kit, and per voice tune / decay / level.
const { drums } = useDrums()

const semis = (v) => {
  const s = Math.round((v - 0.5) * 24)
  return `${s > 0 ? '+' : ''}${s} st`
}
const pct = (v) => `${Math.round(v * 100)}%`
const decayText = (v) => (v >= 0.999 ? 'Full' : pct(v))
</script>

<template>
  <section class="drum-panel" aria-label="Drum controls">
    <div class="cell cell--kit">
      <SlideSwitch
        :model-value="KITS.indexOf(drums.kit)"
        :positions="KITS"
        label="Kit"
        @update:model-value="drums.kit = KITS[$event]"
      />
    </div>

    <div class="voices">
      <div v-for="v in DRUM_VOICES" :key="v.key" class="voice">
        <span class="voice-name">{{ v.name }}</span>
        <div class="knobs">
          <Knob v-model="drums.voices[v.key].tune" size="sm" label="Tune" bipolar :default-value="0.5" :format="semis" />
          <Knob v-model="drums.voices[v.key].decay" size="sm" label="Decay" :default-value="0.8" :format="decayText" />
          <Knob v-model="drums.voices[v.key].level" size="sm" label="Level" :default-value="0.7" :format="pct" />
        </div>
      </div>
    </div>

    <div class="cell cell--volume">
      <Knob v-model="drums.volume" size="md" label="Volume" :default-value="0.7" :format="pct" />
    </div>
  </section>
</template>

<style scoped>
.drum-panel {
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 10px 14px 12px;
}

.cell {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  border: 2px solid var(--ink-line);
  border-radius: 8px;
}

.voices {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.voice {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding-top: 2px;
  border-left: 1px solid var(--ink-soft);
}

.voice:first-child {
  border-left: 0;
}

.voice-name {
  padding: 1px 8px;
  border-radius: 2px;
  background: var(--ink);
  color: var(--chassis);
  font-family: var(--font-panel);
  font-weight: 800;
  font-style: italic;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.knobs {
  display: flex;
  justify-content: center;
  gap: 0;
}

.knobs :deep(.knob-label) {
  font-size: 9.5px;
  letter-spacing: 0.04em;
}

@media (max-width: 1260px) {
  .voices {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  }
}

@media (max-width: 760px) {
  .drum-panel {
    flex-wrap: wrap;
  }

  .voices {
    order: 3;
    flex-basis: 100%;
  }
}
</style>
