<script setup>
import { computed, ref } from 'vue'
import { BASE_MIDI, MAX_PITCH, MAX_STEPS, MIN_PITCH, midiName, pitchOf } from '../model/pattern.js'
import { useEditor } from '../store/editor.js'

// Classic piano roll for one mono pattern.
//   click empty cell      -> place a one-step note
//   drag on empty cells   -> paint notes
//   drag a note up/down   -> change its pitch
//   drag a note's right edge -> make it longer/shorter (stored as 303 ties)
//   click a note / right-click -> delete it
// Accent and slide live in lanes under the roll, like velocity lanes.

const {
  state,
  pattern,
  selectStep,
  placeNote,
  deleteNote,
  resizeNote,
  toggleFlag,
  previewPitch,
  previewRelease
} = useEditor()

const ROWS = MAX_PITCH - MIN_PITCH + 1 // 37 semitones
const BLACK = new Set([1, 3, 6, 8, 10])
const rowY = (pitch) => MAX_PITCH - pitch
const pct = (n, of) => `${(n / of) * 100}%`

const rows = Array.from({ length: ROWS }, (_, i) => {
  const pitch = MAX_PITCH - i
  const pc = ((pitch % 12) + 12) % 12
  return { pitch, y: i, black: BLACK.has(pc), c: pc === 0, name: midiName(BASE_MIDI + pitch) }
})

// Note blocks: a 'note' step plus the 'tie' steps that follow it.
const blocks = computed(() => {
  const p = pattern.value
  const list = []
  let current = null
  for (let i = 0; i < p.length; i += 1) {
    const step = p.steps[i]
    if (step.time === 'note') {
      current = { start: i, end: i + 1, pitch: pitchOf(step), accent: step.accent, slide: step.slide }
      list.push(current)
    } else if (step.time === 'tie' && current && current.end === i) {
      current.end = i + 1
      current.slide = step.slide
    } else {
      current = null
    }
  }
  list.forEach((b) => {
    const next = list.find((n) => n.start === b.end)
    if (b.slide && next) b.slideTo = next.pitch
  })
  return list
})

// Which block covers step i (for header labels and lanes).
const ownerOf = computed(() => {
  const owners = Array(MAX_STEPS).fill(null)
  blocks.value.forEach((b) => {
    for (let i = b.start; i < b.end; i += 1) owners[i] = b
  })
  return owners
})

const headLabel = (i) => {
  const b = ownerOf.value[i]
  if (!b) return ''
  return b.start === i ? midiName(BASE_MIDI + b.pitch) : '·'
}

// ---- pointer handling ---------------------------------------------------------------

const roll = ref(null)
const hover = ref(null) // { step, pitch, zone }
const drag = ref(null)
let dragId = 0

const locate = (event) => {
  const rect = roll.value.getBoundingClientRect()
  const fx = ((event.clientX - rect.left) / rect.width) * MAX_STEPS
  const fy = ((event.clientY - rect.top) / rect.height) * ROWS
  const step = Math.min(MAX_STEPS - 1, Math.max(0, Math.floor(fx)))
  return {
    step,
    frac: fx - step,
    pitch: Math.min(MAX_PITCH, Math.max(MIN_PITCH, MAX_PITCH - Math.floor(fy)))
  }
}

const hitTest = (pos) => {
  const b = ownerOf.value[pos.step]
  if (!b || b.pitch !== pos.pitch) return null
  const zone = pos.step === b.end - 1 && pos.frac > 0.62 ? 'resize' : 'body'
  return { block: b, zone }
}

const onDown = (event) => {
  const pos = locate(event)
  if (pos.step >= pattern.value.length) return
  const hit = hitTest(pos)

  if (event.button === 2) {
    if (hit) deleteNote(hit.block.start)
    return
  }
  if (event.button !== 0) return

  roll.value.setPointerCapture(event.pointerId)
  dragId += 1
  const key = `roll-${dragId}`

  if (hit) {
    selectStep(hit.block.start)
    drag.value =
      hit.zone === 'resize'
        ? { mode: 'resize', start: hit.block.start, key }
        : { mode: 'move', start: hit.block.start, pitch: hit.block.pitch, moved: false, key }
    return
  }

  selectStep(pos.step)
  placeNote(pos.step, pos.pitch, key)
  drag.value = { mode: 'paint', key, last: `${pos.step}:${pos.pitch}` }
}

const onMove = (event) => {
  const pos = locate(event)
  const d = drag.value
  if (!d) {
    const hit = pos.step < pattern.value.length ? hitTest(pos) : null
    hover.value = { ...pos, zone: hit ? hit.zone : pos.step < pattern.value.length ? 'empty' : 'off' }
    return
  }
  hover.value = { ...pos, zone: d.mode === 'resize' ? 'resize' : 'body' }

  if (d.mode === 'resize') {
    resizeNote(d.start, pos.step + 1, d.key)
  } else if (d.mode === 'move') {
    if (pos.pitch !== d.pitch) {
      d.pitch = pos.pitch
      d.moved = true
      placeNote(d.start, pos.pitch, d.key)
    }
  } else if (d.mode === 'paint' && pos.step < pattern.value.length) {
    const id = `${pos.step}:${pos.pitch}`
    if (id !== d.last) {
      d.last = id
      placeNote(pos.step, pos.pitch, d.key)
    }
  }
}

const onUp = () => {
  const d = drag.value
  if (d && d.mode === 'move' && !d.moved) deleteNote(d.start)
  drag.value = null
}

const onLeave = () => {
  if (!drag.value) hover.value = null
}

const cursor = computed(() => {
  const zone = hover.value?.zone
  if (zone === 'resize') return 'ew-resize'
  if (zone === 'body') return drag.value ? 'grabbing' : 'pointer'
  if (zone === 'off') return 'not-allowed'
  return 'crosshair'
})

const hoverText = computed(() => {
  if (!hover.value || hover.value.zone === 'off') return ''
  return `STEP ${String(hover.value.step + 1).padStart(2, '0')} · ${midiName(BASE_MIDI + hover.value.pitch)}`
})

// ---- keyboard gutter (audition) -------------------------------------------------

const keyDown = (pitch, event) => {
  event.currentTarget.setPointerCapture?.(event.pointerId)
  previewPitch(pitch)
}

// ---- lanes ------------------------------------------------------------------------

const laneState = (i, flag) => {
  const b = ownerOf.value[i]
  const step = pattern.value.steps[i]
  return { on: step[flag], usable: Boolean(b) && i < pattern.value.length }
}
</script>

<template>
  <div class="pr" :style="{ '--rows': ROWS }">
    <!-- header: step numbers, playhead LEDs, note names -->
    <div class="grid head">
      <span class="gutter-title">STEP</span>
      <button
        v-for="i in MAX_STEPS"
        :key="`h${i}`"
        type="button"
        :class="['head-cell', { sel: state.selectedStep === i - 1, off: i - 1 >= pattern.length, beat: (i - 1) % 4 === 0 }]"
        :aria-label="`Select step ${i}`"
        @click="selectStep(i - 1)"
      >
        <span :class="['led', { on: state.playing && state.playStep === i - 1 }]"></span>
        <span class="num">{{ i }}</span>
        <span class="note-name">{{ headLabel(i - 1) }}</span>
      </button>
    </div>

    <!-- piano roll -->
    <div class="grid body">
      <div class="piano" aria-label="Preview keys">
        <div
          v-for="r in rows"
          :key="r.pitch"
          :class="['pkey', { black: r.black, c: r.c }]"
          @pointerdown.prevent="keyDown(r.pitch, $event)"
          @pointerup="previewRelease"
          @pointercancel="previewRelease"
        >
          <span v-if="r.c">{{ r.name }}</span>
        </div>
      </div>

      <div
        ref="roll"
        class="roll"
        :style="{ cursor }"
        role="application"
        aria-label="Piano roll. Click to add a note, drag a note's right edge to lengthen it, click a note to delete it."
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @pointerleave="onLeave"
        @contextmenu.prevent
      >
        <svg class="grid-bg" viewBox="0 0 16 37" preserveAspectRatio="none" aria-hidden="true">
          <rect v-for="r in rows" :key="`r${r.pitch}`" x="0" :y="r.y" width="16" height="1" :class="['row', { black: r.black }]" />
          <line v-for="r in rows.filter((x) => x.c)" :key="`c${r.pitch}`" x1="0" x2="16" :y1="r.y + 1" :y2="r.y + 1" class="c-line" />
          <line v-for="i in 15" :key="`b${i}`" :x1="i" :x2="i" y1="0" y2="37" :class="['beat-line', { strong: i % 4 === 0 }]" />
          <rect :x="state.selectedStep" y="0" width="1" height="37" class="sel-col" />
          <rect v-if="state.playing && state.playStep >= 0" :x="state.playStep" y="0" width="1" height="37" class="play-col" />
          <rect v-if="hover && hover.zone !== 'off'" x="0" :y="rowY(hover.pitch)" width="16" height="1" class="hover-row" />
          <line
            v-for="b in blocks.filter((x) => x.slideTo !== undefined)"
            :key="`s${b.start}`"
            :x1="b.end - 0.1"
            :y1="rowY(b.pitch) + 0.5"
            :x2="b.end + 0.1"
            :y2="rowY(b.slideTo) + 0.5"
            class="slide-line"
          />
        </svg>

        <div
          v-for="b in blocks"
          :key="`n${b.start}`"
          :class="['note', { accent: b.accent, sel: state.selectedStep >= b.start && state.selectedStep < b.end }]"
          :style="{
            left: pct(b.start, MAX_STEPS),
            width: pct(b.end - b.start, MAX_STEPS),
            top: pct(rowY(b.pitch), ROWS),
            height: pct(1, ROWS)
          }"
        >
          <span class="grip"></span>
        </div>

        <div
          v-if="pattern.length < MAX_STEPS"
          class="off-zone"
          :style="{ left: pct(pattern.length, MAX_STEPS) }"
        >
          <span>END</span>
        </div>
        <span v-if="hoverText" class="hover-text">{{ hoverText }}</span>
      </div>
    </div>

    <!-- accent / slide lanes -->
    <div class="grid lane">
      <span class="gutter-title">ACCENT</span>
      <button
        v-for="i in MAX_STEPS"
        :key="`a${i}`"
        type="button"
        :class="['lane-btn', 'acc', { on: laneState(i - 1, 'accent').on, dim: !laneState(i - 1, 'accent').usable }]"
        :aria-pressed="laneState(i - 1, 'accent').on"
        :aria-label="`Accent on step ${i}`"
        @click="toggleFlag('accent', i - 1)"
      >
        <span></span>
      </button>
    </div>
    <div class="grid lane">
      <span class="gutter-title">SLIDE</span>
      <button
        v-for="i in MAX_STEPS"
        :key="`s${i}`"
        type="button"
        :class="['lane-btn', 'sld', { on: laneState(i - 1, 'slide').on, dim: !laneState(i - 1, 'slide').usable }]"
        :aria-pressed="laneState(i - 1, 'slide').on"
        :aria-label="`Slide from step ${i} into the next note`"
        @click="toggleFlag('slide', i - 1)"
      >
        <span></span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.pr {
  --gutter: 54px;
  --roll-h: 333px;
  display: grid;
  gap: 5px;
  user-select: none;
  -webkit-user-select: none;
}

.grid {
  display: grid;
  grid-template-columns: var(--gutter) repeat(16, minmax(0, 1fr));
  gap: 0 2px;
  align-items: center;
}

.gutter-title {
  justify-self: start;
  font-family: var(--font-panel);
  font-weight: 800;
  font-size: 10px;
  letter-spacing: 0.08em;
  padding: 1px 4px;
  border-radius: 2px;
  background: var(--ink);
  color: var(--chassis);
}

/* header */
.head-cell {
  display: grid;
  justify-items: center;
  gap: 2px;
  padding: 2px 0 4px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--print);
  cursor: pointer;
}

.head-cell .num {
  font-family: var(--font-panel);
  font-weight: 700;
  font-size: 12px;
  line-height: 1;
}

.head-cell .num {
  opacity: 0.7;
}

.head-cell.beat .num {
  opacity: 1;
  font-weight: 800;
}

.head-cell .note-name {
  min-height: 12px;
  font-family: var(--font-display);
  font-size: 11px;
  line-height: 1;
  color: var(--ink);
}

.head-cell.sel {
  border-bottom-color: var(--ink);
}

.head-cell.off {
  opacity: 0.3;
}

/* roll body */
.body {
  align-items: stretch;
}

.piano {
  display: grid;
  grid-template-rows: repeat(var(--rows), 1fr);
  height: var(--roll-h);
  margin-right: 4px;
  border-radius: 3px 0 0 3px;
  overflow: hidden;
  box-shadow: 0 0 0 1px #000;
}

.pkey {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 4px;
  background: linear-gradient(90deg, #cfcbbf, #efece4 70%, #e2ded3);
  border-bottom: 1px solid rgba(0, 0, 0, 0.18);
  cursor: pointer;
}

.pkey.black {
  background: linear-gradient(90deg, #0c0c0c, #2a2a2b 60%, #1a1a1a);
  margin-right: 18px;
  border-radius: 0 2px 2px 0;
  border-bottom-color: #000;
}

.pkey:active {
  filter: brightness(0.82);
}

.pkey span {
  font-family: var(--font-display);
  font-size: 9px;
  line-height: 1;
  color: #333;
  pointer-events: none;
}

.roll {
  grid-column: 2 / -1;
  position: relative;
  height: var(--roll-h);
  border-radius: 0 4px 4px 0;
  overflow: hidden;
  background: #120d05;
  box-shadow: inset 0 0 0 1px #000, inset 0 2px 12px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(255, 255, 255, 0.08);
  touch-action: none;
}

.roll::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(172deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0) 36%);
  pointer-events: none;
}

.grid-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.row {
  fill: rgba(255, 176, 32, 0.035);
}

.row.black {
  fill: rgba(0, 0, 0, 0.35);
}

.c-line {
  stroke: rgba(255, 176, 32, 0.25);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.beat-line {
  stroke: rgba(255, 176, 32, 0.08);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.beat-line.strong {
  stroke: rgba(255, 176, 32, 0.24);
}

.sel-col {
  fill: rgba(255, 220, 60, 0.06);
}

.play-col {
  fill: rgba(255, 70, 40, 0.16);
}

.hover-row {
  fill: rgba(255, 200, 80, 0.09);
}

.slide-line {
  stroke: #ffd24a;
  stroke-width: 3;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}

.note {
  position: absolute;
  box-sizing: border-box;
  padding: 0 2px;
  border: 1px solid #5a2e00;
  border-radius: 3px;
  background: linear-gradient(180deg, #ffb53a, #f08a0c);
  box-shadow: 0 0 8px rgba(255, 150, 20, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.45);
  pointer-events: none;
  margin: 0 1px;
}

.note.accent {
  background: linear-gradient(180deg, #fff59a, #ffd21f);
  box-shadow: 0 0 12px rgba(255, 220, 60, 0.75), inset 0 1px 0 #fff;
}

.note.sel {
  outline: 1px solid #fff4c8;
  outline-offset: 1px;
}

.grip {
  position: absolute;
  right: 2px;
  top: 2px;
  bottom: 2px;
  width: 2px;
  border-radius: 1px;
  background: rgba(70, 30, 0, 0.55);
}

.off-zone {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  display: flex;
  align-items: flex-start;
  padding: 6px;
  background: repeating-linear-gradient(135deg, rgba(0, 0, 0, 0.72) 0 6px, rgba(0, 0, 0, 0.58) 6px 12px);
  border-left: 2px solid rgba(255, 70, 40, 0.6);
  pointer-events: none;
}

.off-zone span {
  font-family: var(--font-panel);
  font-weight: 800;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: rgba(255, 110, 70, 0.8);
}

.hover-text {
  position: absolute;
  left: 6px;
  top: 5px;
  padding: 1px 5px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.65);
  font-family: var(--font-display);
  font-size: 11px;
  color: #ffb020;
  pointer-events: none;
}

/* lanes */
.lane-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  padding: 0;
  border: 1px solid #000;
  border-radius: 3px;
  background: linear-gradient(180deg, #3b3b3d, #252527);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 1px 0 #000;
  cursor: pointer;
}

.lane-btn span {
  width: 60%;
  height: 6px;
  border-radius: 2px;
  background: #2a1210;
  box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.8);
}

.lane-btn.acc.on span {
  background: #fff06a;
  box-shadow: 0 0 6px rgba(255, 230, 80, 0.9);
}

.lane-btn.sld.on span {
  background: #ff4b2b;
  box-shadow: 0 0 6px rgba(255, 75, 43, 0.9);
}

.lane-btn.dim {
  opacity: 0.35;
}

.lane-btn:active {
  transform: translateY(1px);
}

.lane-btn:focus-visible,
.head-cell:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

@media (max-width: 760px) {
  .pr {
    --gutter: 34px;
    --roll-h: 300px;
  }

  .grid {
    gap: 0 1px;
  }

  .pkey.black {
    margin-right: 10px;
  }

  .pkey span,
  .head-cell .note-name {
    font-size: 8px;
  }

  .gutter-title {
    font-size: 7px;
    letter-spacing: 0.04em;
  }
}
</style>
