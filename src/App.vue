<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { MODELS } from './model/patch.js'
import { BANK_SIZE } from './model/pattern.js'
import { useEditor } from './store/editor.js'
import DeviceOverlay from './components/DeviceOverlay.vue'
import EditorBar from './components/EditorBar.vue'
import HelpOverlay from './components/HelpOverlay.vue'
import LibraryOverlay from './components/LibraryOverlay.vue'
import PatternBank from './components/PatternBank.vue'
import PatternLab from './components/PatternLab.vue'
import PatternTools from './components/PatternTools.vue'
import PianoRoll from './components/PianoRoll.vue'
import SynthPanel from './components/SynthPanel.vue'
import Scope from './components/Scope.vue'
import Transport from './components/Transport.vue'
import SvgDefs from './components/hw/SvgDefs.vue'

const editor = useEditor()
const { state } = editor
const showHelp = ref(false)
const showLibrary = ref(false)
const showDevice = ref(false)
const model = computed(() => MODELS[state.model])

// Computer keyboard as a one-octave piano: A W S E D F T G Y H U J K = C .. C'
const NOTE_KEYS = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12 }

const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)

const onKeyDown = (event) => {
  if (isTyping(event.target)) return
  const key = event.key
  const lower = key.toLowerCase()
  const mod = event.metaKey || event.ctrlKey

  if (key === 'Escape') {
    showHelp.value = false
    showLibrary.value = false
    showDevice.value = false
    return
  }
  if (key === '?') {
    showHelp.value = !showHelp.value
    return
  }
  if (showHelp.value || showLibrary.value || showDevice.value) return

  if (mod) {
    if (lower === 'z') {
      event.preventDefault()
      if (event.shiftKey) editor.redo()
      else editor.undo()
    } else if (lower === 'y') {
      event.preventDefault()
      editor.redo()
    } else if (lower === 'c' && !window.getSelection()?.toString()) {
      editor.copyPattern()
    } else if (lower === 'v') {
      editor.pastePattern()
    }
    return
  }
  if (event.altKey || event.repeat) {
    if (event.repeat && (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight')) {
      // allow auto-repeat for navigation
    } else {
      return
    }
  }

  const step = editor.selected.value
  const index = state.selectedStep

  if (key === ' ') {
    event.preventDefault()
    editor.togglePlay()
  } else if (key === 'ArrowLeft') {
    event.preventDefault()
    editor.moveSelection(-1)
  } else if (key === 'ArrowRight') {
    event.preventDefault()
    editor.moveSelection(1)
  } else if (key === 'ArrowUp' || key === 'ArrowDown') {
    event.preventDefault()
    if (step.time !== 'note') return
    const delta = (key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 12 : 1)
    editor.nudgePitch(index, delta)
  } else if (lower in NOTE_KEYS && !event.shiftKey) {
    editor.writeNote(NOTE_KEYS[lower])
  } else if (lower === 'z') {
    editor.setOctave(-1)
  } else if (lower === 'x') {
    editor.setOctave(1)
  } else if (lower === 'c') {
    editor.toggleFlag('accent')
  } else if (lower === 'v') {
    editor.toggleFlag('slide')
  } else if (lower === 'b') {
    editor.setTime('tie')
  } else if (lower === 'n' || key === 'Backspace' || key === 'Delete') {
    event.preventDefault()
    editor.setTime('rest')
  } else if (lower === 'l') {
    showLibrary.value = true
  } else if (lower === 'r') {
    editor.randomizePattern()
  } else if (lower === 'm') {
    editor.mutate()
  } else if (key === '[' || key === ']') {
    const current = state.pendingSlot ?? state.slot
    editor.selectSlot((current + (key === ']' ? 1 : -1) + BANK_SIZE) % BANK_SIZE)
  }
}

// Browsers only allow audio after a user gesture: start the engine on the first one.
const unlockAudio = () => {
  editor.ensureAudio()
  window.removeEventListener('pointerdown', unlockAudio, true)
  window.removeEventListener('keydown', unlockAudio, true)
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('pointerdown', unlockAudio, true)
  window.addEventListener('keydown', unlockAudio, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  editor.stop()
})
</script>

<template>
  <SvgDefs />
  <div class="app">
    <EditorBar @help="showHelp = true" @device="showDevice = true" />

    <main class="device" :aria-label="model.name">
      <!-- yellow synth section -->
      <div class="chassis">
        <div class="nameplate">
          <div class="model">
            <span class="model-name">{{ model.name }}</span>
            <span class="model-desc">{{ model.description }}</span>
            <svg class="smiley" viewBox="0 0 40 40" aria-hidden="true">
              <circle cx="20" cy="20" r="17" />
              <path d="M13.5 15.5 l3 1.6 M26.5 15.5 l-3 1.6" />
              <circle cx="15.5" cy="18.6" r="1.6" class="eye" />
              <circle cx="24.5" cy="18.6" r="1.6" class="eye" />
              <path d="M11.5 23.5 q8.5 8.5 17 0" />
            </svg>
          </div>
          <div class="nameplate-right">
            <div class="power">
              <span :class="['led', { on: state.audioReady }]"></span>
              <span>{{ state.audioReady ? 'POWER' : 'CLICK TO POWER UP' }}</span>
            </div>
            <Scope />
          </div>
        </div>
        <SynthPanel />
      </div>

      <!-- sequencer section (same yellow body, below a groove) -->
      <div class="seq">
        <!-- one row: transport, length, pattern memory, edit/pattern tools -->
        <div class="seq-top">
          <Transport />
          <PatternTools part="length" />
          <PatternBank />
          <PatternTools part="tools" @library="showLibrary = true" />
        </div>
        <!-- second row: scale lock, transforms, generator -->
        <PatternLab />
        <PianoRoll />
        <p class="hint">
          Click to add a note · drag the right edge to lengthen it · drag up/down to change pitch · click a note to
          delete it ·
          <button type="button" class="hint-link" @click="showHelp = true">Shortcuts (?)</button>
        </p>
      </div>
    </main>

    <transition name="toast">
      <div v-if="state.toast" class="toast" role="status">{{ state.toast }}</div>
    </transition>

    <HelpOverlay v-if="showHelp" @close="showHelp = false" />
    <LibraryOverlay v-if="showLibrary" @close="showLibrary = false" />
    <DeviceOverlay v-if="showDevice" @close="showDevice = false" />
  </div>
</template>

<style scoped>
.app {
  width: min(1320px, 100%);
  margin: 0 auto;
  padding: 16px 16px 32px;
  display: grid;
  gap: 8px;
}

.device {
  position: relative;
  border-radius: 16px;
  overflow: hidden;
  background-color: var(--chassis);
  background-image: var(--chassis-texture),
    linear-gradient(180deg, var(--chassis-light) 0%, var(--chassis) 22%, var(--chassis) 78%, var(--chassis-deep) 100%);
  color: var(--ink);
  box-shadow:
    inset 0 2px 0 var(--body-hi),
    inset 0 -3px 0 var(--body-lo),
    inset 2px 0 0 var(--body-hi),
    inset -2px 0 0 var(--body-lo),
    0 30px 60px rgba(0, 0, 0, 0.55),
    0 6px 14px rgba(0, 0, 0, 0.45);
}

.chassis {
  position: relative;
  color: var(--ink);
}

.nameplate {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 10px 20px 8px;
  border-bottom: 2px solid var(--ink-line);
}

.model {
  display: flex;
  align-items: baseline;
  gap: 14px;
}

.model-name {
  font-family: var(--font-panel);
  font-weight: 800;
  font-size: 32px;
  line-height: 0.9;
  letter-spacing: 0.01em;
}

.model-desc {
  font-family: var(--font-panel);
  font-weight: 700;
  font-size: 17px;
  letter-spacing: 0.01em;
}

.smiley {
  width: 30px;
  height: 30px;
  align-self: center;
  margin-left: 6px;
  fill: none;
  stroke: var(--ink);
  stroke-width: 2.4;
  stroke-linecap: round;
}

.smiley .eye {
  fill: var(--ink);
  stroke: none;
}

.nameplate-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.power {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-panel);
  font-weight: 700;
  font-size: 10px;
  letter-spacing: 0.14em;
}

.seq {
  /* print colours for the yellow body */
  --print: var(--ink);
  --print-dim: var(--ink-soft);
  --print-line: var(--ink-soft);
  position: relative;
  padding: 12px 14px 12px;
  border-top: 2px solid var(--body-lo);
  box-shadow: inset 0 1px 0 var(--body-hi);
  color: var(--ink);
  display: grid;
  gap: 12px;
}

.seq-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--print-line);
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--print-dim);
}

.hint-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: 4px;
  background: #0d0b08;
  box-shadow: 0 0 0 1px #000, 0 10px 30px rgba(0, 0, 0, 0.6);
  font-family: var(--font-display);
  font-size: 15px;
  letter-spacing: 0.08em;
  color: #ffb020;
  z-index: 40;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

@media (max-width: 760px) {
  .app {
    padding: 10px 10px 24px;
  }

  .nameplate {
    flex-direction: column;
    align-items: flex-start;
    padding: 10px 14px 8px;
  }

  .model {
    flex-direction: column;
    gap: 2px;
  }

  .model-name {
    font-size: 28px;
  }

  .model-desc {
    font-size: 10px;
  }

  .seq {
    padding: 12px 10px;
  }
}
</style>
