<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getAnalyser } from '../audio/engine.js'
import { useEditor } from '../store/editor.js'

// Small oscilloscope of the synth output (amber trace on a dark CRT).
const { state } = useEditor()
const canvas = ref(null)
let raf = null
let data = null

const draw = () => {
  const el = canvas.value
  const analyser = getAnalyser()
  if (!el) return
  const ctx = el.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const w = el.clientWidth * dpr
  const h = el.clientHeight * dpr
  if (el.width !== w || el.height !== h) {
    el.width = w
    el.height = h
  }
  ctx.clearRect(0, 0, w, h)

  ctx.strokeStyle = 'rgba(255, 176, 32, 0.12)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, h / 2)
  ctx.lineTo(w, h / 2)
  ctx.stroke()

  if (analyser) {
    if (!data || data.length !== analyser.fftSize) data = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(data)
    // trigger on a rising zero crossing so the waveform stands still
    let start = 0
    for (let i = 1; i < data.length / 2; i += 1) {
      if (data[i - 1] < 0 && data[i] >= 0) {
        start = i
        break
      }
    }
    const span = 700
    ctx.strokeStyle = '#ffb020'
    ctx.shadowColor = 'rgba(255, 160, 20, 0.8)'
    ctx.shadowBlur = 6 * dpr
    ctx.lineWidth = 1.6 * dpr
    ctx.beginPath()
    for (let i = 0; i < span; i += 1) {
      const v = data[start + i] || 0
      const x = (i / (span - 1)) * w
      const y = h / 2 - v * h * 0.9
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.shadowBlur = 0
  }
  raf = requestAnimationFrame(draw)
}

const start = () => {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(draw)
}

onMounted(start)
watch(() => state.audioReady, start)
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div class="scope" :title="state.audioReady ? 'Output scope' : 'Audio starts on first interaction'">
    <canvas ref="canvas"></canvas>
    <span v-if="!state.audioReady" class="scope-off">AUDIO OFF</span>
  </div>
</template>

<style scoped>
.scope {
  position: relative;
  width: 150px;
  height: 32px;
  border-radius: 4px;
  overflow: hidden;
  background: radial-gradient(ellipse at center, #1a1206 0%, #070502 80%);
  box-shadow: inset 0 0 0 1px #000, inset 0 2px 8px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(255, 255, 255, 0.06);
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.scope-off {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-family: var(--font-display);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: rgba(255, 176, 32, 0.45);
}
</style>
