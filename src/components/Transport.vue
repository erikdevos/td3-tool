<script setup>
import { computed } from 'vue'
import { useEditor } from '../store/editor.js'
import HwButton from './hw/HwButton.vue'
import Knob from './hw/Knob.vue'
import SevenSeg from './hw/SevenSeg.vue'

const { state, togglePlay, tapTempo } = useEditor()

const MIN_BPM = 40
const MAX_BPM = 300

const tempo = computed({
  get: () => (state.bpm - MIN_BPM) / (MAX_BPM - MIN_BPM),
  set: (v) => {
    state.bpm = Math.round(MIN_BPM + v * (MAX_BPM - MIN_BPM))
  }
})

const shuffle = computed({
  get: () => state.shuffle,
  set: (v) => {
    state.shuffle = Math.round(v * 100) / 100
  }
})
</script>

<template>
  <div class="transport">
    <div class="run">
      <HwButton label="Run / Stop" size="lg" variant="dark" :led="state.playing" title="Run / stop (Space)" @press="togglePlay">
        {{ state.playing ? '■' : '▶' }}
      </HwButton>
    </div>
    <div class="tempo">
      <Knob
        v-model="tempo"
        label="Tempo"
        size="md"
        :default-value="(126 - MIN_BPM) / (MAX_BPM - MIN_BPM)"
        :scale-labels="['40', '300']"
        :format="() => `${state.bpm} BPM`"
      />
      <div class="readout">
        <SevenSeg :value="state.bpm" :digits="3" />
        <HwButton label="Tap" size="sm" variant="dark" title="Tap tempo" @press="tapTempo" />
      </div>
      <Knob
        v-model="shuffle"
        label="Shuffle"
        size="sm"
        :default-value="0"
        :format="(v) => `${Math.round(v * 100)}%`"
      />
    </div>
  </div>
</template>

<style scoped>
.transport {
  display: flex;
  align-items: center;
  gap: 12px;
}

.tempo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.readout {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.transport :deep(.knob-label) {
  color: var(--print);
}

.transport :deep(.tick) {
  stroke: var(--print);
}

.transport :deep(.scale-label) {
  fill: var(--print);
}
</style>
