import { describe, expect, it } from 'vitest'
import { LIBRARY } from '../src/model/library.js'
import { factoryPresets } from '../src/model/patch.js'

describe('pattern library', () => {
  const presetNames = new Set(factoryPresets().map((p) => p.name))
  const token = /^([A-G]#?)(')?([+-]?)([as]*)$/

  it.each(LIBRARY.map((e) => [e.name, e]))('%s is valid', (_, entry) => {
    const tokens = entry.text.trim().split(/\s+/)
    expect(tokens.filter((t) => t !== '-' && t !== '.' && !token.test(t))).toEqual([])
    expect(tokens.length).toBeLessThanOrEqual(16)
    expect(presetNames.has(entry.sound)).toBe(true)
  })
})
