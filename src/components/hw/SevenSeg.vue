<script setup>
import { computed } from 'vue'

// Red 7-segment LED readout (SVG). Supports digits, a few letters, '-', ' ' and '.'.
const props = defineProps({
  value: { type: [String, Number], required: true },
  digits: { type: Number, default: 3 },
  color: { type: String, default: 'red' } // red | amber
})

//      a
//    f   b
//      g
//    e   c
//      d
const MAP = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
  A: 'abcefg', b: 'cdefg', C: 'adef', c: 'deg', d: 'bcdeg', E: 'adefg', F: 'aefg', G: 'acdef', H: 'bcefg', h: 'cefg',
  I: 'ef', i: 'c', J: 'bcde', L: 'def', n: 'ceg', o: 'cdeg', P: 'abefg', r: 'eg', S: 'acdfg', t: 'defg', U: 'bcdef',
  u: 'cde', y: 'bcdfg', '-': 'g', _: 'd', ' ': ''
}

const SEGMENTS = {
  a: 'M3 1 L15 1 L13 3 L5 3 Z',
  b: 'M15.5 1.5 L15.5 13 L14 14 L13.2 12.5 L13.2 3.5 Z',
  c: 'M15.5 15 L15.5 26.5 L13.2 24.5 L13.2 15.5 L14 14 Z',
  d: 'M3 27 L15 27 L13 25 L5 25 Z',
  e: 'M2.5 15 L2.5 26.5 L4.8 24.5 L4.8 15.5 L4 14 Z',
  f: 'M2.5 1.5 L2.5 13 L4 14 L4.8 12.5 L4.8 3.5 Z',
  g: 'M3.4 14 L5 12.7 L13 12.7 L14.6 14 L13 15.3 L5 15.3 Z'
}

const cells = computed(() => {
  const chars = []
  for (const ch of String(props.value)) {
    if (ch === '.' && chars.length) chars[chars.length - 1].dot = true
    else chars.push({ ch, dot: false })
  }
  while (chars.length < props.digits) chars.unshift({ ch: ' ', dot: false })
  return chars.slice(-props.digits).map(({ ch, dot }) => {
    const lit = MAP[ch] ?? MAP[ch.toUpperCase()] ?? MAP[ch.toLowerCase()] ?? ''
    return { segs: Object.keys(SEGMENTS).map((s) => ({ s, on: lit.includes(s) })), dot }
  })
})
</script>

<template>
  <div :class="['seven', `seven--${color}`]" role="img" :aria-label="String(value)">
    <svg v-for="(cell, i) in cells" :key="i" viewBox="0 0 20 28" class="digit">
      <g transform="skewX(-6) translate(1.5 0)">
        <path v-for="seg in cell.segs" :key="seg.s" :d="SEGMENTS[seg.s]" :class="{ on: seg.on }" />
      </g>
      <circle cx="18" cy="26" r="1.4" :class="{ on: cell.dot }" />
    </svg>
  </div>
</template>

<style scoped>
.seven {
  display: inline-flex;
  gap: 1px;
  padding: 5px 7px;
  border-radius: 3px;
  background: radial-gradient(ellipse at 50% 40%, #1c0504 0%, #0b0101 70%);
  box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(255, 255, 255, 0.12);
}

.digit {
  width: 15px;
  height: 21px;
  overflow: visible;
}

path,
circle {
  fill: rgba(255, 50, 30, 0.08);
}

.seven--red .on {
  fill: #ff3b22;
  filter: drop-shadow(0 0 2px rgba(255, 50, 20, 0.85));
}

.seven--amber .on {
  fill: #ffb020;
  filter: drop-shadow(0 0 2px rgba(255, 160, 20, 0.85));
}

.seven--amber path,
.seven--amber circle {
  fill: rgba(255, 170, 30, 0.07);
}
</style>
