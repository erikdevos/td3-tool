<script setup>
import { ref, watch } from 'vue'
import { hardwareStatus } from '../hardware/td3.js'
import { useEditor } from '../store/editor.js'

const emit = defineEmits(['help'])

const {
  state,
  patchDirty,
  loadPreset,
  savePreset,
  deletePreset,
  initPatch,
  stepPreset,
  exportBank,
  importBank,
  exportPatternMidi,
  exportPatternSeq,
  importPatternFile
} = useEditor()

const nameDraft = ref(state.patchName)
watch(
  () => state.patchName,
  (name) => {
    nameDraft.value = name
  }
)

const fileInput = ref(null)
const onFile = async (event) => {
  const [file] = event.target.files
  if (file) await importBank(file)
  event.target.value = ''
}

const midiInput = ref(null)
const onMidiFile = async (event) => {
  const [file] = event.target.files
  if (file) await importPatternFile(file)
  event.target.value = ''
}

const onSelect = (event) => loadPreset(event.target.value)
const save = () => savePreset(nameDraft.value)
</script>

<template>
  <header class="bar">
    <div class="brand">
      <span class="brand-model">TD-3-MO</span>
      <span class="brand-sub">Editor</span>
    </div>

    <div class="patch" aria-label="Patch memory">
      <span class="bar-label">PATCH</span>
      <button type="button" class="ghost" title="Previous patch" @click="stepPreset(-1)">◀</button>
      <select class="lcd" :value="state.patchName" aria-label="Load patch" @change="onSelect">
        <option v-if="!state.presets.some((p) => p.name === state.patchName)" :value="state.patchName" disabled>
          {{ state.patchName }}
        </option>
        <option v-for="p in state.presets" :key="p.name" :value="p.name">{{ p.name }}</option>
      </select>
      <button type="button" class="ghost" title="Next patch" @click="stepPreset(1)">▶</button>
      <input
        v-model="nameDraft"
        class="lcd name"
        maxlength="16"
        aria-label="Patch name"
        spellcheck="false"
        @keydown.enter="save"
      />
      <span
        :class="['dirty', { on: patchDirty }]"
        :title="patchDirty ? 'Knobs changed since this patch was saved' : 'Patch saved'"
        :aria-label="patchDirty ? 'Edited' : 'Saved'"
      ></span>
      <button type="button" title="Save knob settings under this name" @click="save">Save</button>
      <button type="button" title="Delete this patch" @click="deletePreset">Del</button>
      <button type="button" title="Reset all knobs" @click="initPatch">Init</button>
    </div>

    <div class="files">
      <span class="bar-label">PATTERN</span>
      <button type="button" title="Load a .mid or SynthTribe .seq file into the current pattern slot" @click="midiInput.click()">
        Import
      </button>
      <button type="button" title="Save the current pattern as a MIDI file for your DAW (accent = velocity, slide = overlap)" @click="exportPatternMidi">
        .mid
      </button>
      <button type="button" title="Save the current pattern as a SynthTribe .seq file for the TD-3" @click="exportPatternSeq">
        .seq
      </button>
      <input ref="midiInput" type="file" accept=".mid,.midi,.seq,audio/midi,audio/x-midi" hidden @change="onMidiFile" />
    </div>

    <div class="files">
      <span class="bar-label">BANK</span>
      <button type="button" title="Download all patterns and patches as a JSON file" @click="exportBank">Export</button>
      <button type="button" title="Load a previously exported JSON file" @click="fileInput.click()">Import</button>
      <input ref="fileInput" type="file" accept="application/json,.json" hidden @change="onFile" />
      <button
        type="button"
        class="hw"
        disabled
        :title="hardwareStatus.note"
      >
        Send to TD-3
      </button>
    </div>

    <div class="right">
      <button type="button" class="help" title="Keyboard shortcuts (?)" @click="emit('help')">?</button>
    </div>
  </header>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: 8px 16px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-radius: 10px;
  background: linear-gradient(180deg, #1b1b1d, #121213);
  border: 1px solid #000;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 8px 24px rgba(0, 0, 0, 0.45);
  color: var(--print);
}

.brand {
  display: flex;
  flex-direction: column;
  line-height: 1;
}

.brand-model {
  font-family: var(--font-panel);
  font-weight: 800;
  font-style: italic;
  font-size: 20px;
  letter-spacing: 0.02em;
  color: var(--chassis);
}

.brand-sub {
  margin-top: 3px;
  font-family: var(--font-panel);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--print-dim);
}

.patch,
.files,
.right {
  display: flex;
  align-items: center;
  gap: 5px;
}

.right {
  margin-left: auto;
  gap: 10px;
}

.bar-label {
  margin-right: 4px;
  font-family: var(--font-panel);
  font-weight: 800;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--chassis);
}

button {
  height: 26px;
  padding: 0 8px;
  border: 1px solid #000;
  border-radius: 4px;
  background: linear-gradient(180deg, #3a3a3c, #262628);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
  color: var(--print);
  font-family: var(--font-panel);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  cursor: pointer;
}

button:hover:not(:disabled) {
  filter: brightness(1.15);
}

button:focus-visible,
.lcd:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

button.ghost {
  padding: 0 6px;
  background: none;
  border-color: transparent;
  box-shadow: none;
  color: var(--print-dim);
}

.lcd {
  height: 26px;
  padding: 0 8px;
  border: 1px solid #000;
  border-radius: 3px;
  background: #0d0b08;
  box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.9);
  color: #ffb020;
  font-family: var(--font-display);
  font-size: 13px;
  text-transform: uppercase;
}

select.lcd {
  width: 150px;
  cursor: pointer;
}

.lcd.name {
  width: 124px;
}

.dirty {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #3a3a3a;
}

.dirty.on {
  background: #ff6a3a;
  box-shadow: 0 0 6px rgba(255, 106, 58, 0.8);
}

.help {
  width: 26px;
  padding: 0;
  border-radius: 50%;
  font-size: 14px;
}

@media (max-width: 760px) {
  .right {
    margin-left: 0;
  }

  .patch {
    flex-wrap: wrap;
  }
}
</style>
