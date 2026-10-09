<script setup>
import { computed, ref } from 'vue'

// Rotary control styled after the black TD-3 knobs with a printed scale.
// v-model is normalised 0..1. Drag vertically (Shift = fine), scroll,
// arrow keys, double-click to reset.
const props = defineProps({
  modelValue: { type: Number, required: true },
  label: { type: String, default: '' },
  size: { type: String, default: 'lg' }, // 'lg' | 'md' | 'sm'
  defaultValue: { type: Number, default: 0.5 },
  bipolar: { type: Boolean, default: false },
  scaleLabels: { type: Array, default: null }, // [min, max] labels printed at the scale ends
  format: { type: Function, default: null }
})

const emit = defineEmits(['update:modelValue'])

const SIZES = { lg: 50, md: 40, sm: 32 }
const knobSize = computed(() => SIZES[props.size] || SIZES.lg)
const box = computed(() => knobSize.value + 30)
const c = computed(() => box.value / 2)
const r = computed(() => knobSize.value / 2)

const angle = computed(() => -135 + props.modelValue * 270)

const ticks = computed(() => {
  const list = []
  const count = 21
  for (let i = 0; i < count; i += 1) {
    const a = ((-135 + (i * 270) / (count - 1) - 90) * Math.PI) / 180
    const major = i % 2 === 0
    const r1 = r.value + 3
    const r2 = r.value + (major ? 8.5 : 6)
    list.push({
      x1: c.value + Math.cos(a) * r1,
      y1: c.value + Math.sin(a) * r1,
      x2: c.value + Math.cos(a) * r2,
      y2: c.value + Math.sin(a) * r2,
      major
    })
  }
  return list
})

const endLabels = computed(() => props.scaleLabels || (props.bipolar ? ['−', '+'] : ['0', '10']))
const labelPos = computed(() => {
  const rr = r.value + 13
  const at = (deg) => {
    const a = ((deg - 90) * Math.PI) / 180
    return { x: c.value + Math.cos(a) * rr, y: c.value + Math.sin(a) * rr + 3 }
  }
  return [at(-148), at(148)]
})

const display = computed(() => {
  if (props.format) return props.format(props.modelValue)
  if (props.bipolar) {
    const v = (props.modelValue - 0.5) * 10
    return `${v > 0.05 ? '+' : ''}${v.toFixed(1)}`
  }
  return (props.modelValue * 10).toFixed(1)
})

const knurls = computed(() => {
  const n = 36
  return Array.from({ length: n }, (_, i) => (i * 360) / n)
})

const dragging = ref(false)
const hover = ref(false)
let startY = 0
let startX = 0
let startValue = 0

const set = (v) => emit('update:modelValue', Math.min(1, Math.max(0, v)))

const onPointerDown = (event) => {
  if (event.button !== 0) return
  event.preventDefault()
  event.currentTarget.setPointerCapture(event.pointerId)
  event.currentTarget.focus({ preventScroll: true })
  dragging.value = true
  startY = event.clientY
  startX = event.clientX
  startValue = props.modelValue
}

const onPointerMove = (event) => {
  if (!dragging.value) return
  const range = event.shiftKey ? 900 : 180
  const delta = (startY - event.clientY + (event.clientX - startX) * 0.5) / range
  set(startValue + delta)
}

const onPointerUp = (event) => {
  if (!dragging.value) return
  dragging.value = false
  event.currentTarget.releasePointerCapture?.(event.pointerId)
}

const onWheel = (event) => {
  const step = event.shiftKey ? 0.004 : 0.02
  set(props.modelValue + (event.deltaY < 0 ? step : -step))
}

const onKey = (event) => {
  const step = event.shiftKey ? 0.01 : 0.05
  const map = {
    ArrowUp: step,
    ArrowRight: step,
    ArrowDown: -step,
    ArrowLeft: -step,
    PageUp: 0.1,
    PageDown: -0.1
  }
  if (event.key in map) {
    event.preventDefault()
    event.stopPropagation()
    set(props.modelValue + map[event.key])
  } else if (event.key === 'Home') {
    event.preventDefault()
    set(0)
  } else if (event.key === 'End') {
    event.preventDefault()
    set(1)
  }
}

const reset = () => set(props.defaultValue)
</script>

<template>
  <div :class="['knob', `knob--${size}`, { 'is-active': dragging }]">
    <span v-if="label" class="knob-label">{{ label }}</span>
    <div
      class="knob-hit"
      role="slider"
      tabindex="0"
      :aria-label="label"
      aria-valuemin="0"
      aria-valuemax="10"
      :aria-valuenow="(modelValue * 10).toFixed(1)"
      :aria-valuetext="display"
      :style="{ width: `${box}px`, height: `${box}px` }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerenter="hover = true"
      @pointerleave="hover = false"
      @dblclick="reset"
      @wheel.prevent="onWheel"
      @keydown="onKey"
    >
      <svg :viewBox="`0 0 ${box} ${box}`" :width="box" :height="box" aria-hidden="true">
        <!-- printed scale -->
        <line
          v-for="(t, i) in ticks"
          :key="i"
          :x1="t.x1"
          :y1="t.y1"
          :x2="t.x2"
          :y2="t.y2"
          class="tick"
          :class="{ major: t.major }"
        />
        <text :x="labelPos[0].x" :y="labelPos[0].y" class="scale-label" text-anchor="middle">{{ endLabels[0] }}</text>
        <text :x="labelPos[1].x" :y="labelPos[1].y" class="scale-label" text-anchor="middle">{{ endLabels[1] }}</text>

        <!-- drop shadow on the panel -->
        <circle :cx="c + 1.2" :cy="c + 2.6" :r="r" class="shadow" filter="url(#soft-shadow)" />
        <!-- amber skirt -->
        <circle :cx="c" :cy="c" :r="r" class="skirt" />
        <g :transform="`rotate(${angle} ${c} ${c})`">
          <!-- knurled grip on the skirt -->
          <line
            v-for="k in knurls"
            :key="k"
            :x1="c"
            :y1="c - r + 0.8"
            :x2="c"
            :y2="c - r * 0.8"
            class="knurl"
            :transform="`rotate(${k} ${c} ${c})`"
          />
          <!-- black cap -->
          <circle :cx="c" :cy="c" :r="r * 0.7" class="cap" />
          <!-- red indicator line on the cap -->
          <line :x1="c" :y1="c - r * 0.66" :x2="c" :y2="c - r * 0.22" class="pointer" />
        </g>
        <circle :cx="c" :cy="c" :r="r * 0.7" class="cap-shine" />
      </svg>
      <span v-show="dragging || hover" class="knob-value">{{ display }}</span>
    </div>
  </div>
</template>

<style scoped>
.knob {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  user-select: none;
  -webkit-user-select: none;
}

.knob-hit {
  position: relative;
  cursor: ns-resize;
  touch-action: none;
  border-radius: 50%;
  outline: none;
}

.knob-hit:focus-visible {
  box-shadow: 0 0 0 2px var(--focus);
}

svg {
  display: block;
  overflow: visible;
}

.tick {
  stroke: var(--ink);
  stroke-width: 0.9;
  stroke-linecap: round;
}

.tick.major {
  stroke-width: 1.4;
}

.scale-label {
  fill: var(--ink);
  font-family: var(--font-panel);
  font-weight: 700;
  font-size: 8px;
}

.shadow {
  fill: rgba(0, 0, 0, 0.4);
}

.skirt {
  fill: url(#knob-skirt);
  stroke: #5a3a00;
  stroke-width: 0.8;
}

.knurl {
  stroke: rgba(90, 55, 0, 0.45);
  stroke-width: 1.3;
}

.cap {
  fill: url(#knob-cap);
  stroke: #000;
  stroke-width: 0.8;
}

.cap-shine {
  fill: url(#knob-shine);
  pointer-events: none;
}

.pointer {
  stroke: #e2241a;
  stroke-width: 2.2;
  stroke-linecap: round;
}

.knob-label {
  max-width: 88px;
  margin-bottom: -2px;
  text-align: center;
  font-family: var(--font-panel);
  font-weight: 700;
  font-size: 12px;
  line-height: 1.05;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink);
}

.knob--sm .knob-label,
.knob--md .knob-label {
  font-size: 11px;
}

.knob-value {
  position: absolute;
  left: 50%;
  bottom: -10px;
  transform: translateX(-50%);
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--ink);
  color: var(--chassis);
  font-family: var(--font-display);
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  z-index: 5;
}
</style>
