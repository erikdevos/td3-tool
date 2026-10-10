<script setup>
import { useEditor } from '../store/editor.js'
import HwButton from './hw/HwButton.vue'
import SevenSeg from './hw/SevenSeg.vue'

// part="length": the LENGTH readout (top row of the sequencer)
// part="tools":  two compact lines (edit + pattern actions) that sit in the sequencer's top row
defineProps({
  part: { type: String, default: 'tools' }
})
const emit = defineEmits(['library'])

const {
  state,
  pattern,
  setLength,
  toggleTriplet,
  clearPattern,
  copyPattern,
  pastePattern,
  shiftPattern,
  transposePattern,
  undo
} = useEditor()
</script>

<template>
  <div v-if="part === 'length'" class="length">
    <span class="title">LENGTH</span>
    <div class="row">
      <HwButton size="sm" variant="dark" title="Shorter" @press="setLength(pattern.length - 1)">−</HwButton>
      <SevenSeg :value="String(pattern.length).padStart(2, '0')" :digits="2" />
      <HwButton size="sm" variant="dark" title="Longer" @press="setLength(pattern.length + 1)">+</HwButton>
      <HwButton
        size="sm"
        variant="dark"
        label="Triplet"
        class="triplet"
        :led="pattern.triplet"
        title="Triplet mode: steps are 16th-note triplets"
        @press="toggleTriplet"
      />
    </div>
  </div>

  <div v-else class="toolbar">
    <div class="group">
      <span class="title">EDIT</span>
      <HwButton size="text" variant="dark" title="Rotate pattern one step left" @press="shiftPattern(-1)">◀ Shift</HwButton>
      <HwButton size="text" variant="dark" title="Rotate pattern one step right" @press="shiftPattern(1)">Shift ▶</HwButton>
      <HwButton size="text" variant="dark" title="Transpose all notes down a semitone" @press="transposePattern(-1)">−1 st</HwButton>
      <HwButton size="text" variant="dark" title="Transpose all notes up a semitone" @press="transposePattern(1)">+1 st</HwButton>
      <HwButton size="text" variant="dark" title="Undo (⌘Z)" @press="undo">↶ Undo</HwButton>
    </div>
    <div class="group">
      <span class="title">PATTERN</span>
      <HwButton size="text" variant="light" title="Browse built-in acid patterns (L)" @press="emit('library')">Library</HwButton>
      <HwButton size="text" variant="dark" title="Copy pattern (⌘C)" @press="copyPattern">Copy</HwButton>
      <HwButton
        size="text"
        variant="dark"
        :title="state.clipboard ? 'Paste pattern (⌘V)' : 'Clipboard empty'"
        @press="pastePattern"
      >
        Paste
      </HwButton>
      <HwButton size="text" variant="dark" title="Clear pattern" @press="clearPattern">Clear</HwButton>
    </div>
  </div>
</template>

<style scoped>
.title {
  justify-self: start;
  font-family: var(--font-panel);
  font-weight: 800;
  font-size: 11px;
  letter-spacing: 0.1em;
  display: inline-block;
  padding: 1px 7px;
  border-radius: 3px;
  background: var(--ink);
  color: var(--chassis);
}

.length {
  display: grid;
  gap: 8px;
}

.row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.triplet {
  margin-left: 4px;
}

.toolbar {
  display: grid;
  gap: 6px;
}

.group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.group .title {
  width: 52px;
  margin-right: 2px;
  text-align: center;
}

.group :deep(.hwb--text .cap) {
  padding: 0 5px;
}
</style>
