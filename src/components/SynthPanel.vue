<script setup>
import { KNOBS, MAIN_ROW, MO_ROW, SWITCHES } from '../model/patch.js'
import { useEditor } from '../store/editor.js'
import Knob from './hw/Knob.vue'
import SlideSwitch from './hw/SlideSwitch.vue'

const { state, setParam } = useEditor()

const MO_SWITCHES = ['accentSweep', 'sweepSpeed', 'muffler', 'subOsc']
</script>

<template>
  <!-- One row: classic TB-303 / TD-3 controls (1/2) + "Modded Out" section (1/2) -->
  <section class="synth" aria-label="Synth controls">
    <div class="main">
      <div class="cell cell--wave">
        <SlideSwitch
          :model-value="state.patch.waveform"
          :positions="['SAW', 'SQUARE']"
          label="Waveform"
          @update:model-value="setParam('waveform', $event)"
        />
      </div>
      <div class="knob-run">
        <Knob
          v-for="key in MAIN_ROW"
          :key="key"
          :model-value="state.patch[key]"
          :label="KNOBS[key].label"
          :default-value="KNOBS[key].default"
          :bipolar="KNOBS[key].bipolar"
          size="md"
          @update:model-value="setParam(key, $event)"
        />
      </div>
      <div class="cell cell--volume">
        <Knob
          :model-value="state.patch.volume"
          label="Volume"
          :default-value="KNOBS.volume.default"
          size="md"
          @update:model-value="setParam('volume', $event)"
        />
      </div>
    </div>

    <div class="mo">
      <div class="mo-badge" aria-hidden="true">Modded Out</div>
      <div class="mo-grid">
        <Knob
          v-for="key in MO_ROW"
          :key="key"
          :model-value="state.patch[key]"
          :label="KNOBS[key].label"
          :default-value="KNOBS[key].default"
          size="md"
          @update:model-value="setParam(key, $event)"
        />
        <SlideSwitch
          v-for="key in MO_SWITCHES"
          :key="key"
          :model-value="state.patch[key]"
          :positions="SWITCHES[key].positions"
          :label="SWITCHES[key].label"
          @update:model-value="setParam(key, $event)"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.synth {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

/* ---- main 1/2 ---- */
.main {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 12px 14px;
  border-right: 2px solid var(--ink-line);
}

.knob-run {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 2px;
}

.cell {
  align-self: stretch;
  display: flex;
  align-items: center;
}

.cell--wave,
.cell--volume {
  padding: 6px 8px;
  border: 2px solid var(--ink-line);
  border-radius: 8px;
}

/* ---- Modded Out 1/2 ---- */
.mo {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mo-badge {
  align-self: flex-start;
  margin: 8px 0 6px 14px;
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

.mo-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  align-items: start;
  justify-items: center;
  gap: 2px 0;
  padding: 2px 8px 8px;
}

.mo-grid :deep(.knob-label),
.mo-grid :deep(.switch-label) {
  font-size: 9.5px;
  letter-spacing: 0.04em;
  max-width: 84px;
}

.mo-grid :deep(.switch) {
  padding-top: 8px;
  gap: 3px;
}

/* stack the two sections on narrower screens */
@media (max-width: 1260px) {
  .synth {
    grid-template-columns: 1fr;
  }

  .main {
    border-right: 0;
    border-bottom: 2px solid var(--ink-line);
  }

  .mo-grid {
    grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
  }
}

@media (max-width: 760px) {
  .main {
    flex-wrap: wrap;
    padding: 10px 12px;
  }

  .knob-run {
    order: 3;
    flex-basis: 100%;
    flex-wrap: wrap;
    justify-content: space-around;
  }

  .cell--wave,
  .cell--volume {
    border: 0;
    padding: 0;
  }
}
</style>
