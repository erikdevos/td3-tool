<script setup>
import { computed } from 'vue'
import { GROUPS, PATTERNS_PER_SECTION, SECTIONS, slotIndex, slotLabel, slotParts } from '../model/pattern.js'
import { useEditor } from '../store/editor.js'
import HwButton from './hw/HwButton.vue'

// Pattern memory like the hardware: GROUP I-IV, SECTION A/B, PATTERN 1-8.
const { state, selectSlot, setChain, clearChain } = useEditor()

// The slot shown on the buttons = pending slot (if queued) or the current one.
const target = computed(() => slotParts(state.pendingSlot ?? state.slot))
const current = computed(() => slotParts(state.slot))

const isEmpty = (index) => state.bank[index].steps.every((s) => s.time === 'rest')

const go = (group, section, number) => selectSlot(slotIndex(group, section, number))

// Shift-click a pattern number: chain from the current slot to that one.
const pressNumber = (event, n) => {
  const index = slotIndex(target.value.group, target.value.section, n)
  if (event?.shiftKey) setChain(state.slot, index)
  else selectSlot(index)
}

const chained = (n) => {
  const c = state.chain
  const index = slotIndex(target.value.group, target.value.section, n)
  return Boolean(c) && index >= c.start && index <= c.end
}

const chainLabel = computed(() => (state.chain ? `${slotLabel(state.chain.start)} → ${slotLabel(state.chain.end)}` : null))

const numberLed = (n) => {
  const t = target.value
  const index = slotIndex(t.group, t.section, n)
  if (index === state.pendingSlot) return 'blink'
  return index === state.slot
}

const label = computed(() => slotLabel(state.slot))
const pendingLabel = computed(() => (state.pendingSlot !== null ? slotLabel(state.pendingSlot) : null))
</script>

<template>
  <div class="bank">
    <div class="bank-head">
      <span class="title">PATTERN</span>
      <span class="slot">{{ label }}</span>
      <span v-if="pendingLabel" class="pending">→ {{ pendingLabel }}</span>
      <span v-if="chainLabel" class="chain" title="These slots play one after another">
        CHAIN {{ chainLabel }}
        <button type="button" aria-label="Clear chain" title="Clear chain" @click="clearChain">×</button>
      </span>
      <span v-else class="chain-hint">Shift-click a number to chain</span>
    </div>
    <div class="bank-row">
      <div class="group">
        <HwButton
          v-for="(g, gi) in GROUPS"
          :key="g"
          size="sm"
          variant="dark"
          :label="g"
          :led="current.group === gi ? true : target.group === gi ? 'blink' : false"
          :title="`Group ${g}`"
          @press="go(gi, target.section, target.number)"
        />
      </div>
      <div class="group">
        <HwButton
          v-for="(s, si) in SECTIONS"
          :key="s"
          size="sm"
          variant="dark"
          :label="s"
          :led="current.section === si ? true : target.section === si ? 'blink' : false"
          :title="`Section ${s}`"
          @press="go(target.group, si, target.number)"
        />
      </div>
      <div class="group">
        <HwButton
          v-for="n in PATTERNS_PER_SECTION"
          :key="n"
          size="sm"
          :class="{ chained: chained(n - 1) }"
          :variant="isEmpty(slotIndex(target.group, target.section, n - 1)) ? 'dark' : 'grey'"
          :label="String(n)"
          :led="numberLed(n - 1)"
          :title="`Pattern ${n} (shift-click: chain)`"
          @press="pressNumber($event, n - 1)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.bank {
  display: grid;
  gap: 8px;
}

.bank-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-family: var(--font-panel);
  font-weight: 800;
}

.title {
  font-size: 11px;
  letter-spacing: 0.1em;
  display: inline-block;
  padding: 1px 7px;
  border-radius: 3px;
  background: var(--ink);
  color: var(--chassis);
}

.slot {
  padding: 0 6px;
  border-radius: 2px;
  background: #0d0b08;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.9);
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 14px;
  color: #ffb020;
}

.pending {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 13px;
  color: #b3200f;
  animation: blink 0.5s steps(1) infinite;
}

.chain {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 12px;
}

.chain button {
  padding: 0 3px;
  border: 0;
  background: none;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  color: var(--ink);
  cursor: pointer;
}

.chain-hint {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-soft);
}

.chained {
  position: relative;
}

.chained::after {
  content: '';
  position: absolute;
  left: -3px;
  right: -3px;
  bottom: -5px;
  height: 3px;
  border-radius: 2px;
  background: var(--ink);
}

.bank-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.group {
  display: flex;
  gap: 4px;
  padding-right: 8px;
  border-right: 1px solid var(--print-line);
}

.group:last-child {
  border-right: 0;
  padding-right: 0;
}

@keyframes blink {
  50% {
    opacity: 0.2;
  }
}
</style>
