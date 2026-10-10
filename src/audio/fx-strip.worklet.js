// Mixer channel effects: DRIVE (soft clipping, a little darker as it rises) and COMP (a one-knob
// compressor). Both work without lookahead, so a channel adds no latency and stays in time with
// the other channel and with MIDI. At 0 an effect is bypassed: with both at 0 the signal passes
// through bit for bit. Dependency-free (loaded with audioWorklet.addModule), runs in Node in tests.

const BYPASS = 1e-4 // AudioParams smoothed towards 0 never reach it exactly

// COMP: make-up gain restores signals peaking at REF, so turning it up makes quieter parts louder
// while peaks stay put. Without lookahead the first millisecond of a hit gets through before the
// gain drops; a soft ceiling (from KNEE up to CEIL) catches those overshoots.
const REF = -8 // dBFS
const KNEE = 0.7
const CEIL = 0.98
const ceiling = (x) => {
  const a = Math.abs(x)
  if (a <= KNEE) return x
  const y = KNEE + (CEIL - KNEE) * Math.tanh((a - KNEE) / (CEIL - KNEE))
  return x < 0 ? -y : y
}

class FxStrip extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'comp', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ]
  }

  constructor(options) {
    super()
    const o = (options && options.processorOptions) || {}
    // compressor timing (fast attack: there is no lookahead to catch peaks)
    this.attack = Math.exp(-1 / ((o.attack || 0.001) * sampleRate))
    this.release = Math.exp(-1 / ((o.release || 0.15) * sampleRate))
    this.gr = 0 // gain reduction in dB
    this.tone = [0, 0] // drive tone filter state per channel
  }

  drive(chans, frames, amount) {
    const pre = 1 + 24 * amount
    const norm = 0.5 / Math.tanh(0.5 * pre) // a signal at 0.5 keeps its level
    const mix = Math.min(1, amount * 3) // fade the effect in from dry, no jump at the start
    const a = 1 - Math.exp((-2 * Math.PI * (16000 - 11000 * amount)) / sampleRate)
    chans.forEach((ch, c) => {
      let lp = this.tone[c] || 0
      for (let i = 0; i < frames; i += 1) {
        const x = ch[i]
        lp += a * (Math.tanh(x * pre) * norm - lp)
        ch[i] = x + mix * (lp - x)
      }
      this.tone[c] = lp
    })
  }

  compress(chans, frames, amount) {
    const thr = -6 - 24 * amount // dB
    const slope = 1 - 1 / (1 + 4 * amount) // ratio up to 5:1
    const makeup = Math.pow(10, (Math.max(0, REF - thr) * slope) / 20)
    for (let i = 0; i < frames; i += 1) {
      let peak = 0
      for (let c = 0; c < chans.length; c += 1) peak = Math.max(peak, Math.abs(chans[c][i]))
      const over = 20 * Math.log10(peak + 1e-9) - thr
      const target = over > 0 ? over * slope : 0
      const k = target > this.gr ? this.attack : this.release
      this.gr = k * this.gr + (1 - k) * target
      const g = Math.pow(10, -this.gr / 20) * makeup
      for (let c = 0; c < chans.length; c += 1) chans[c][i] = ceiling(chans[c][i] * g)
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]
    const frames = output[0].length
    if (!input || input.length === 0) {
      output.forEach((ch) => ch.fill(0))
      return true
    }
    output.forEach((ch, c) => ch.set(input[Math.min(c, input.length - 1)]))
    const drive = parameters.drive[0]
    const comp = parameters.comp[0]
    if (drive > BYPASS) this.drive(output, frames, drive)
    if (comp > BYPASS) this.compress(output, frames, comp)
    else this.gr = 0
    return true
  }
}

registerProcessor('fx-strip', FxStrip)
