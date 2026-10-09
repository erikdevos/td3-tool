<script setup>
// Rubber-cap hardware button with optional red LED above it.
defineProps({
  label: { type: String, default: '' }, // printed on the panel under/above the button
  led: { type: [Boolean, String], default: null }, // true | false | 'blink' | null (no LED)
  variant: { type: String, default: 'grey' }, // grey | dark | red | light
  size: { type: String, default: 'md' }, // sm | md | lg | wide | text
  active: { type: Boolean, default: false },
  title: { type: String, default: '' }
})
defineEmits(['press'])
</script>

<template>
  <div :class="['hwb', `hwb--${size}`]">
    <span v-if="led !== null" :class="['led', { on: led === true, blink: led === 'blink' }]" aria-hidden="true"></span>
    <button
      type="button"
      :class="['cap', `cap--${variant}`, { active }]"
      :title="title || label"
      :aria-pressed="led === null ? undefined : led === true"
      @click="$emit('press', $event)"
    >
      <slot />
    </button>
    <span v-if="label" class="hwb-label">{{ label }}</span>
  </div>
</template>

<style scoped>
.hwb {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.cap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 24px;
  padding: 0 4px;
  border: 1px solid #000;
  border-radius: 3px;
  font-family: var(--font-panel);
  font-weight: 700;
  font-size: 10px;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: transform 0.05s ease, box-shadow 0.05s ease, filter 0.1s ease;
  user-select: none;
  -webkit-user-select: none;
}

.hwb--sm .cap {
  width: 28px;
  height: 18px;
}

.hwb--lg .cap {
  width: 50px;
  height: 42px;
  font-size: 13px;
}

.hwb--wide .cap {
  width: 52px;
  height: 22px;
}

.hwb--text .cap {
  width: auto;
  height: 24px;
  padding: 0 9px;
  font-size: 11px;
  text-transform: uppercase;
  white-space: nowrap;
}

.cap--dark,
.cap--grey,
.cap--light,
.cap--red {
  background: radial-gradient(ellipse at 50% 25%, #3a3a3a 0%, #1b1b1b 55%, #0e0e0e 100%);
  color: #ece6d6;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), inset 0 -2px 3px rgba(0, 0, 0, 0.6), 0 2px 0 #000,
    0 3px 5px rgba(60, 35, 0, 0.45);
}

/* slightly lighter cap: e.g. pattern slots that contain notes */
.cap--grey {
  background: radial-gradient(ellipse at 50% 25%, #555 0%, #2e2e2e 55%, #1c1c1c 100%);
}

/* highlighted action (e.g. Library): amber print on the black cap */
.cap--light {
  color: var(--accent);
}

.cap--red {
  color: #ff5a3c;
}

.cap:hover {
  filter: brightness(1.08);
}

.cap:active,
.cap.active {
  transform: translateY(2px);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5), 0 0 0 #000;
}

.cap:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.hwb-label {
  font-family: var(--font-panel);
  font-weight: 700;
  font-size: 9.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--print);
  text-align: center;
  line-height: 1.05;
  white-space: nowrap;
}
</style>
