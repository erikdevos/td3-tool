<script setup>
import { computed } from 'vue'
import { GROUPS, PATTERNS_PER_SECTION, SECTIONS, slotIndex, slotLabel, slotParts } from '../model/pattern.js'
import { useEditor } from '../store/editor.js'
import HwButton from './hw/HwButton.vue'

// Pattern memory like the hardware: GROUP I-IV, SECTION A/B, PATTERN 1-8.
const { state, selectSlot } = useEditor()

// The slot shown on the buttons = pending slot (if queued) or the current one.
const target = computed(() => slotParts(state.pendingSlot ?? state.slot))
const current = computed(() => slotParts(state.slot))

const isEmpty = (index) => state.bank[index].steps.every((s) => s.time === 'rest')

const go = (group, section, number) => selectSlot(slotIndex(group, section, number))

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
          :variant="isEmpty(slotIndex(target.group, target.section, n - 1)) ? 'dark' : 'grey'"
          :label="String(n)"
          :led="numberLed(n - 1)"
          :title="`Pattern ${n}`"
          @press="go(target.group, target.section, n - 1)"
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

.bank-row {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}

.group {
  display: flex;
  gap: 6px;
  padding-right: 14px;
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
