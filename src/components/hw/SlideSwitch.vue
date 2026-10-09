<script setup>
import { computed } from 'vue'

// Multi-position slide switch, like the TD-3 waveform / MO switches.
// vertical: positions stacked next to the track (panel look)
// horizontal: label left, sideways track with the position names underneath (compact rows)
// Click a position label to select it, click the switch body to cycle.
const props = defineProps({
  modelValue: { type: Number, required: true },
  positions: { type: Array, required: true },
  label: { type: String, default: '' },
  orientation: { type: String, default: 'vertical' } // 'vertical' | 'horizontal'
})
const emit = defineEmits(['update:modelValue'])

const PITCH = 13 // vertical: px per position
const H_PITCH = 24 // horizontal: px per position
const horizontal = computed(() => props.orientation === 'horizontal')
const trackStyle = computed(() =>
  horizontal.value
    ? { width: `${props.positions.length * H_PITCH + 4}px` }
    : { height: `${props.positions.length * PITCH + 4}px` }
)
const thumbStyle = computed(() => ({
  transform: horizontal.value ? `translateX(${props.modelValue * H_PITCH}px)` : `translateY(${props.modelValue * PITCH}px)`
}))

const cycle = () => emit('update:modelValue', (props.modelValue + 1) % props.positions.length)

const onKey = (event) => {
  if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    event.preventDefault()
    emit('update:modelValue', Math.max(0, props.modelValue - 1))
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    event.preventDefault()
    emit('update:modelValue', Math.min(props.positions.length - 1, props.modelValue + 1))
  } else if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    cycle()
  }
}
</script>

<template>
  <div :class="['switch', { 'switch--h': horizontal }]">
    <span v-if="label && horizontal" class="switch-label">{{ label }}</span>
    <div class="switch-body">
      <button
        type="button"
        class="track"
        role="radiogroup"
        :aria-label="label"
        :style="trackStyle"
        @click="cycle"
        @keydown="onKey"
      >
        <span class="thumb" :style="thumbStyle"></span>
      </button>
      <ul class="positions">
        <li v-for="(pos, i) in positions" :key="pos">
          <button
            type="button"
            role="radio"
            :aria-checked="i === modelValue"
            :class="{ on: i === modelValue }"
            tabindex="-1"
            @click="emit('update:modelValue', i)"
          >
            {{ pos }}
          </button>
        </li>
      </ul>
    </div>
    <span v-if="label && !horizontal" class="switch-label">{{ label }}</span>
  </div>
</template>

<style scoped>
.switch {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.switch-body {
  display: flex;
  align-items: flex-start;
  gap: 5px;
}

.track {
  position: relative;
  width: 16px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: linear-gradient(90deg, #050505, #1e1e1e 50%, #050505);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 0 1.5px var(--ink), 0 1px 0 1.5px var(--body-hi);
  cursor: pointer;
}

.track:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.thumb {
  position: absolute;
  left: 2px;
  top: 2px;
  width: 12px;
  height: 13px;
  border-radius: 2px;
  background: repeating-linear-gradient(180deg, #5a5a5a 0 1px, #2c2c2c 1px 3px);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.25);
  transition: transform 0.08s ease-out;
}

.thumb::after {
  content: '';
  position: absolute;
  left: 2px;
  right: 2px;
  top: 6px;
  height: 1px;
  background: rgba(255, 255, 255, 0.18);
}

.positions {
  list-style: none;
  margin: 0;
  padding: 2px 0 0;
  display: grid;
  grid-auto-rows: 13px;
}

.positions button {
  padding: 0;
  border: 0;
  background: none;
  font-family: var(--font-panel);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.06em;
  line-height: 13px;
  color: var(--ink-soft);
  cursor: pointer;
  text-align: left;
}

.positions button.on {
  color: var(--ink);
  font-weight: 800;
}

.switch-label {
  font-family: var(--font-panel);
  font-weight: 700;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink);
  text-align: center;
  max-width: 80px;
  line-height: 1.05;
}

/* ---- horizontal variant ---- */
.switch--h {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.switch--h .switch-label {
  max-width: 64px;
  text-align: right;
}

.switch--h .switch-body {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.switch--h .track {
  height: 14px;
}

.switch--h .thumb {
  width: 22px;
  height: 10px;
  background: repeating-linear-gradient(90deg, #5a5a5a 0 1px, #2c2c2c 1px 3px);
}

.switch--h .thumb::after {
  left: 10px;
  right: auto;
  top: 1px;
  bottom: 1px;
  width: 1px;
  height: auto;
}

.switch--h .positions {
  display: flex;
  padding: 0 0 0 2px;
}

.switch--h .positions li {
  width: 24px;
  text-align: center;
}

.switch--h .positions button {
  width: 100%;
  font-size: 8.5px;
  line-height: 10px;
  text-align: center;
}
</style>
