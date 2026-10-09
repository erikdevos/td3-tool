import { describe, expect, it } from 'vitest'
import { createNotePlayer, createSysexClient, describeMidi, payloadOf } from '../src/hardware/td3.js'
import { LIBRARY } from '../src/model/library.js'
import { patternNotes } from '../src/model/midi.js'
import { decodePatternSysex, encodePatternSysex } from '../src/model/td3format.js'
import { makePattern, slotParts } from '../src/model/pattern.js'

// A fake TD-3 on a pair of Web MIDI ports, answering like the unofficial docs describe.
const fakeTd3 = ({ answers = true } = {}) => {
  const memory = new Map()
  const input = new EventTarget()
  const reply = (bytes) => setTimeout(() => {
    const ev = new Event('midimessage')
    ev.data = new Uint8Array(bytes)
    input.dispatchEvent(ev)
  }, 1)
  const head = [0xf0, 0x00, 0x20, 0x32, 0x00, 0x01, 0x0a]
  const output = {
    sent: [],
    send(data) {
      const d = [...data]
      this.sent.push(d)
      if (!answers || d[0] !== 0xf0) return
      if (d[7] === 0x06) reply([...head, 0x07, 0x54, 0x44, 0x2d, 0x33, 0x00, 0xf7])
      if (d[7] === 0x08) reply([...head, 0x09, 0x00, 0x01, 0x03, 0x07, 0xf7])
      // configuration reply, example from 303patterns.com
      if (d[7] === 0x75) reply([...head, 0x76, 0x00, 0x08, 0x0c, 0x02, 0x02, 0x00, 0x01, 0x02, 0x03, 0x46, 0xf7])
      if (d[7] === 0x78) {
        if (d[8] > 3 || d[9] > 15) return reply([...head, 0x01, 0x00, 0x01, 0xf7]) // refused
        memory.set(`${d[8]}/${d[9]}`, d.slice(12, 12 + 110))
        reply([...head, 0x01, 0x00, 0x00, 0xf7]) // stored
      }
      if (d[7] === 0x77) {
        const payload = memory.get(`${d[8]}/${d[9]}`) || [...encodePatternSysex(makePattern(), { group: 0, section: 0, number: 0 })].slice(12, 122)
        reply([...head, 0x78, d[8], d[9], 0x00, 0x00, ...payload, 0xf7])
      }
    }
  }
  return { input, output, memory }
}

describe('SysEx client', () => {
  it('identifies the device', async () => {
    const { input, output } = fakeTd3()
    const client = createSysexClient(input, output)
    expect(await client.productName()).toBe('TD-3')
    expect(await client.firmware()).toBe('1.3.7')
  })

  it('reads the MIDI configuration', async () => {
    const { input, output } = fakeTd3()
    const cfg = await createSysexClient(input, output).config()
    expect(cfg.outChannel).toBe(1)
    expect(cfg.inChannel).toBe(9)
    expect(cfg.accentThreshold).toBe(70)
  })

  it('writes a pattern and reads the same notes back', async () => {
    const { input, output } = fakeTd3()
    const client = createSysexClient(input, output)
    const slot = slotParts(13) // I-B6
    const pattern = LIBRARY[3].pattern
    await client.writePattern(slot, pattern)
    const back = await client.readPattern(slot)
    expect(back[8]).toBe(0)
    expect(back[9]).toBe(13)
    expect(JSON.stringify(patternNotes(decodePatternSysex(back).pattern))).toBe(JSON.stringify(patternNotes(pattern)))
    expect(payloadOf(back)).toHaveLength(110)
  })

  it('reports a refused write', async () => {
    const { input, output } = fakeTd3()
    const client = createSysexClient(input, output)
    await expect(client.writePattern({ group: 7, section: 0, number: 0 }, LIBRARY[0].pattern)).rejects.toThrow('refused')
  })

  it('times out when nothing answers', async () => {
    const { input, output } = fakeTd3({ answers: false })
    const client = createSysexClient(input, output)
    await expect(client.request(new Uint8Array([0xf0, 0xf7]), () => true, 20)).rejects.toThrow('No reply')
  })
})

describe('live note player', () => {
  const setup = () => {
    const sent = []
    const out = { send: (bytes, at) => sent.push({ bytes: [...bytes], at }) }
    const player = createNotePlayer(() => out, () => 2)
    return { sent, player, toMs: (t) => t * 1000 }
  }

  it('sends accents as high velocity on the chosen channel', () => {
    const { sent, player, toMs } = setup()
    player.play([{ kind: 'on', time: 1, midi: 36, accent: true, slide: false }, { kind: 'off', time: 1.1 }], toMs)
    expect(sent[0]).toEqual({ bytes: [0x91, 36, 127], at: 1000 })
    expect(sent[1].bytes).toEqual([0x81, 36, 0])
  })

  it('plays slides as overlapping notes', () => {
    const { sent, player, toMs } = setup()
    player.play(
      [
        { kind: 'on', time: 1, midi: 36, accent: false, slide: false },
        { kind: 'on', time: 1.2, midi: 43, accent: false, slide: true }
      ],
      toMs
    )
    const [on1, on2, off1] = sent
    expect(on1.bytes).toEqual([0x91, 36, 64])
    expect(on2.bytes).toEqual([0x91, 43, 64])
    expect(off1.bytes).toEqual([0x81, 36, 0])
    expect(off1.at).toBeGreaterThan(on2.at) // the new note starts before the old one ends
  })

  it('releases the previous note before a normal retrigger', () => {
    const { sent, player, toMs } = setup()
    player.play(
      [
        { kind: 'on', time: 1, midi: 36, accent: false, slide: false },
        { kind: 'on', time: 1.2, midi: 36, accent: false, slide: false }
      ],
      toMs
    )
    expect(sent.map((m) => m.bytes[0])).toEqual([0x91, 0x81, 0x91])
    expect(sent[1].at).toBeLessThan(sent[2].at)
  })
})

describe('MIDI monitor', () => {
  it('describes common messages', () => {
    expect(describeMidi([0xb0, 74, 100]).text).toContain('CC 74 = 100')
    expect(describeMidi([0x91, 36, 127]).text).toContain('ch 2')
    expect(describeMidi([0xfa]).text).toBe('Start')
  })
})
