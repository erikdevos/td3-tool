<script setup>
import { computed } from 'vue'
import { GROOVES } from '../model/drums.js'
import { useDrums } from '../store/drums.js'
import { useEditor } from '../store/editor.js'
import HwButton from './hw/HwButton.vue'

// Drum companion, top sequencer row (next to the shared transport): on/off, grooves, clear, undo.
const { drums, loadGroove, clearSteps, matchGroove, undo, isEmpty } = useDrums()
const { notify } = useEditor()

const current = computed(() => matchGroove(GROOVES))

const pick = (groove) => {
  if (loadGroove(groove)) notify(`GROOVE ${groove.name.toUpperCase()}`)
}

const clear = () => {
  if (clearSteps()) notify('DRUMS CLEARED (UNDO WITH CMD+Z)')
}

const undoDrums = () => {
  if (!undo()) notify('NOTHING TO UNDO')
}
</script>

<template>
  <div class="drum-tools">
    <div class="group">
      <HwButton
        size="text"
        variant="dark"
        :title="drums.on ? 'Drums on: they play with the transport' : 'Drums off: the TD-3 plays alone'"
        @press="drums.on = !drums.on"
      >
        <span :class="['led', { on: drums.on }]" aria-hidden="true"></span>
        Drums
      </HwButton>
    </div>

    <div class="group grooves">
      <span class="title">GROOVE</span>
      <HwButton
        v-for="g in GROOVES"
        :key="g.name"
        size="text"
        :variant="current === g ? 'light' : 'dark'"
        :title="g.title"
        @press="pick(g)"
      >
        {{ g.name }}
      </HwButton>
    </div>

    <div class="group">
      <HwButton size="text" variant="dark" title="Clear all drum steps" :class="{ dim: isEmpty() }" @press="clear">Clear</HwButton>
      <HwButton size="text" variant="dark" title="Undo the last drum edit (⌘/Ctrl+Z)" @press="undoDrums">↶ Undo</HwButton>
    </div>
  </div>
</template>

<style scoped>
.drum-tools {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  min-width: 0;
}

.group {
  display: flex;
  flex-wrap: wrap;
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
  padding: 0 8px;
}

.led {
  margin-right: 5px;
}

.dim {
  opacity: 0.55;
}
</style>
