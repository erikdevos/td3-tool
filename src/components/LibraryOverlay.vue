<script setup>
import { computed, ref, watch } from 'vue'
import { LIBRARY, LIBRARY_STYLES } from '../model/library.js'
import { MAX_PITCH, MIN_PITCH, pitchOf, slotLabel } from '../model/pattern.js'
import { useEditor } from '../store/editor.js'
import { KEYS, read, write } from '../store/storage.js'

const emit = defineEmits(['close'])
const { state, loadLibraryEntry, play } = useEditor()

// remember the filter and checkbox between visits
const saved = read(KEYS.ui)?.library || {}
const style = ref(saved.style === 'All' || LIBRARY_STYLES.includes(saved.style) ? saved.style : 'All')
const withSound = ref(saved.withSound !== false)
watch([style, withSound], () => write(KEYS.ui, { ...(read(KEYS.ui) || {}), library: { style: style.value, withSound: withSound.value } }))

const entries = computed(() => (style.value === 'All' ? LIBRARY : LIBRARY.filter((e) => e.style === style.value)))

// tiny contour for the list: one bar per step, height = pitch
const contour = (pattern) =>
  pattern.steps.slice(0, pattern.length).map((s, i, arr) => {
    if (s.time === 'rest') return { i, h: 0, kind: 'rest' }
    if (s.time === 'tie') {
      const prev = arr.slice(0, i).reverse().find((x) => x.time === 'note')
      return { i, h: prev ? pitchOf(prev) : 0, kind: 'tie' }
    }
    return { i, h: pitchOf(s), kind: s.accent ? 'accent' : 'note' }
  })

const y = (pitch) => ((MAX_PITCH - pitch) / (MAX_PITCH - MIN_PITCH)) * 22 + 1

const load = (entry, andPlay = false) => {
  loadLibraryEntry(entry, { withSound: withSound.value })
  if (andPlay && !state.playing) play()
  emit('close')
}

</script>

<template>
  <div class="overlay" role="dialog" aria-modal="true" aria-label="Pattern library" @click.self="emit('close')">
    <div class="sheet">
      <div class="sheet-head">
        <div>
          <h2>Pattern library</h2>
          <p class="sub">Loads into slot <strong>{{ slotLabel(state.slot) }}</strong> (undo with ⌘Z)</p>
        </div>
        <button type="button" class="close" aria-label="Close" @click="emit('close')">×</button>
      </div>

      <div class="filters">
        <button
          v-for="s in ['All', ...LIBRARY_STYLES]"
          :key="s"
          type="button"
          :class="['chip', { on: style === s }]"
          @click="style = s"
        >
          {{ s }}
        </button>
        <label class="opt">
          <input v-model="withSound" type="checkbox" />
          Also load suggested sound and tempo
        </label>
      </div>

      <ul class="list">
        <li v-for="e in entries" :key="e.name" class="row">
          <svg class="contour" viewBox="0 0 64 24" preserveAspectRatio="none" aria-hidden="true">
            <template v-for="c in contour(e.pattern)" :key="c.i">
              <rect
                v-if="c.kind !== 'rest'"
                :x="(c.i / e.pattern.length) * 64 + 0.4"
                :y="y(c.h)"
                :width="64 / e.pattern.length - 0.8"
                height="1.8"
                :class="c.kind"
              />
            </template>
          </svg>
          <div class="meta">
            <strong>{{ e.name }}</strong>
            <span>{{ e.style }} · {{ e.bpm }} BPM · {{ e.pattern.length }} steps · {{ e.sound }}</span>
          </div>
          <div class="actions">
            <button type="button" @click="load(e)">Load</button>
            <button type="button" class="play" @click="load(e, true)">Load + play</button>
          </div>
        </li>
      </ul>
      <p class="note">
        Original patterns written in classic acid styles, not transcriptions of existing tracks.
      </p>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(3px);
}

.sheet {
  width: min(820px, 100%);
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  padding: 20px 24px 16px;
  border-radius: 10px;
  background: #1c1c1d;
  border: 1px solid #000;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
  color: var(--print);
}

.sheet-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding-bottom: 10px;
  border-bottom: 2px solid var(--accent);
}

h2 {
  margin: 0;
  font-family: var(--font-panel);
  font-style: italic;
  font-weight: 800;
  font-size: 24px;
  text-transform: uppercase;
  color: var(--accent);
}

.sub {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--print-dim);
}

.sub strong {
  font-family: var(--font-display);
  font-weight: 400;
  color: #ffb020;
}

.close {
  width: 32px;
  height: 32px;
  border: 2px solid var(--print-dim);
  border-radius: 50%;
  background: none;
  color: var(--print);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 12px 0;
}

.chip {
  height: 26px;
  padding: 0 10px;
  border: 1px solid #000;
  border-radius: 13px;
  background: #2d2d2f;
  color: var(--print);
  font-family: var(--font-panel);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.chip.on {
  background: var(--accent);
  color: var(--accent-ink);
}

.opt {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: 13px;
  color: var(--print-dim);
  cursor: pointer;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  border-top: 1px solid var(--print-line);
}

.row {
  display: grid;
  grid-template-columns: 96px 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 8px 4px;
  border-bottom: 1px solid var(--print-line);
}

.contour {
  width: 96px;
  height: 32px;
  border-radius: 3px;
  background: #120d05;
  box-shadow: inset 0 0 0 1px #000;
}

.contour .note,
.contour .tie {
  fill: #ff9f1a;
}

.contour .accent {
  fill: #fff06a;
}

.meta {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.meta strong {
  font-family: var(--font-panel);
  font-size: 16px;
  letter-spacing: 0.02em;
}

.meta span {
  font-size: 12px;
  color: var(--print-dim);
}

.actions {
  display: flex;
  gap: 6px;
}

.actions button {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #000;
  border-radius: 4px;
  background: linear-gradient(180deg, #3a3a3c, #262628);
  color: var(--print);
  font-family: var(--font-panel);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
}

.actions button.play {
  background: linear-gradient(180deg, #e2402f, #a51f16);
  color: #fff3ea;
}

button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.note {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--print-dim);
}

@media (max-width: 620px) {
  .row {
    grid-template-columns: 64px 1fr;
  }

  .contour {
    width: 64px;
  }

  .actions {
    grid-column: 1 / -1;
  }

  .opt {
    margin-left: 0;
  }
}
</style>
