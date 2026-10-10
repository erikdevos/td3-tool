<script setup>
import { computed, ref } from 'vue'

// Vertical mixer fader: black cap with a white line in a dark slot. v-model is 0..1.
// Drag (Shift = fine), scroll, arrow keys when focused, double-click = default.
const props = defineProps({
  modelValue: { type: Number, required: true },
  label: { type: String, default: '' },
  defaultValue: { type: Number, default: 0.8 },
  format: { type: Function, default: null },
  height: { type: Number, default: 132 }
})
const emit = defineEmits(['update:modelValue'])

const CAP = 22 // cap height in px
const travel = computed(() => props.height - CAP)
const capTop = computed(() => (1 - props.modelValue) * travel.value)
const display = computed(() => (props.format ? props.format(props.modelValue) : (props.modelValue * 10).toFixed(1)))

const set = (v) => emit('update:modelValue', Math.min(1, Math.max(0, v)))

const dragging = ref(false)
let startY = 0
let startValue = 0

const onDown = (event) => {
  if (event.button !== 0) return
  event.preventDefault()
  try {
    event.currentTarget.setPointerCapture(event.pointerId)
  } catch {
    // pointer already gone: dragging still works without capture
  }
  event.currentTarget.focus({ preventScroll: true })
  dragging.value = true
  startY = event.clientY
  startValue = props.modelValue
}

const onMove = (event) => {
  if (!dragging.value) return
  set(startValue + (startY - event.clientY) / (travel.value * (event.shiftKey ? 5 : 1)))
}

const onUp = (event) => {
  dragging.value = false
  try {
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  } catch {
    // not captured
  }
}

const onWheel = (event) => set(props.modelValue + (event.deltaY < 0 ? 1 : -1) * (event.shiftKey ? 0.005 : 0.025))

const onKey = (event) => {
  const step = event.shiftKey ? 0.01 : 0.05
  const map = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 0.1, PageDown: -0.1 }
  if (event.key in map) {
    event.preventDefault()
    event.stopPropagation()
    set(props.modelValue + map[event.key])
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    set(event.key === 'End' ? 1 : 0)
  }
}
</script>

<template>
  <div :class="['fader', { 'is-active': dragging }]">
    <div
      class="fader-hit"
      role="slider"
      tabindex="0"
      aria-orientation="vertical"
      :aria-label="label"
      aria-valuemin="0"
      aria-valuemax="1"
      :aria-valuenow="modelValue.toFixed(2)"
      :aria-valuetext="display"
      :title="`${label}: ${display} (double-click: reset)`"
      :style="{ height: `${height}px` }"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @dblclick="set(defaultValue)"
      @wheel.prevent="onWheel"
      @keydown="onKey"
    >
      <span class="slot" aria-hidden="true"></span>
      <span class="unity" :style="{ top: `${(1 - defaultValue) * travel + CAP / 2}px` }" aria-hidden="true"></span>
      <span class="cap" :style="{ top: `${capTop}px` }" aria-hidden="true"></span>
    </div>
    <span class="readout">{{ display }}</span>
  </div>
</template>

<style scoped>
.fader {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.fader-hit {
  position: relative;
  width: 30px;
  cursor: ns-resize;
  touch-action: none;
}

.fader-hit:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: 3px;
}

.slot {
  position: absolute;
  left: 50%;
  top: 6px;
  bottom: 6px;
  width: 5px;
  margin-left: -2.5px;
  border-radius: 3px;
  background: #0d0b08;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.9), 0 1px 0 var(--body-hi);
}

/* 0 dB mark */
.unity {
  position: absolute;
  left: 2px;
  right: 2px;
  height: 1.5px;
  background: var(--ink);
}

.cap {
  position: absolute;
  left: 3px;
  right: 3px;
  height: 22px;
  border: 1px solid #000;
  border-radius: 3px;
  background: linear-gradient(180deg, #3b3b3d 0%, #1c1c1d 48%, #2c2c2e 52%, #111 100%);
  box-shadow: 0 3px 5px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.15);
}

.cap::after {
  content: '';
  position: absolute;
  left: 3px;
  right: 3px;
  top: 50%;
  height: 2px;
  margin-top: -1px;
  background: #f1efe8;
}

.is-active .cap {
  filter: brightness(1.25);
}

.readout {
  font-family: var(--font-display);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
}
</style>
