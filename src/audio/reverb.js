// Impulse response for the mixer's reverb (a ConvolverNode): decaying stereo noise that gets
// darker over time, with a short pre-delay. Pure JS, so it is tested in Node.

const noise = (seed) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1
  }
}

/**
 * @param {number} sampleRate
 * @param {number} seconds  decay time to -60 dB
 * @returns {[Float32Array, Float32Array]}  left and right; energy 0.25 each, so a full send gives
 *          a wet signal at about half the dry level
 */
export const impulseResponse = (sampleRate, seconds) => {
  const pre = Math.round(0.012 * sampleRate)
  const length = pre + Math.round(seconds * sampleRate)
  const attack = Math.round(0.004 * sampleRate)
  return [101, 202].map((seed) => {
    const rand = noise(seed)
    const out = new Float32Array(length)
    let lp = 0
    let energy = 0
    for (let i = pre; i < length; i += 1) {
      const t = (i - pre) / sampleRate
      const k = 0.85 - 0.65 * Math.min(1, t / seconds) // high frequencies die out first
      lp += k * (rand() - lp)
      const fade = Math.min(1, (i - pre) / attack, (length - 1 - i) / attack)
      out[i] = lp * 10 ** ((-3 * t) / seconds) * fade
      energy += out[i] * out[i]
    }
    const gain = energy > 0 ? Math.sqrt(0.25 / energy) : 0
    for (let i = pre; i < length; i += 1) out[i] *= gain
    return out
  })
}
