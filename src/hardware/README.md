# Hardware link (TD-3 / TD-3-MO over USB)

Everything that talks to a real device lives here (`td3.js`), with the reactive wrapper in
`src/store/device.js` and the UI in `src/components/DeviceOverlay.vue` (top bar: **TD-3 USB**).
It uses Web MIDI with SysEx, so it works in Chrome and Edge on desktop, and in Firefox with a caveat:
Firefox only scans for MIDI devices at startup and silently denies access when it found none, so
connect and switch on the TD-3 *before* starting Firefox (quit it fully with Cmd+Q first). Safari has
no Web MIDI. The TD-3-MO shows up on macOS as USB device "TD-3-MO" (Behringer, vendor 0x1397,
product 0x1265).

## What it does

- **Live play.** The editor's sequencer and note previews play the real synth as a MIDI
  instrument: accent = velocity 127 (normal notes 64), slide = the next note starts 4 ms before
  the previous one ends, key C = MIDI note 36. Nothing is written to the device. The browser
  sound can be muted. Stopping sends note-off plus All Notes Off (CC 123).
- **Identify.** Product name (`F0 00 20 32 00 01 0A 06 F7`) and firmware (`... 08 00 F7`).
  No reply means wrong port, another device, or a model ID we don't know (see below).
- **MIDI channels.** The TD-3 has a MIDI IN channel (what it listens to; the app sends notes on it)
  and a MIDI OUT channel (what it sends its own notes on). After identifying, the app reads both
  from the device configuration (`F0 00 20 32 00 01 0A 75 F7`, reply `... 76`, byte 8 = out,
  byte 9 = in, byte 17 = accent velocity threshold) and adopts them. Nothing is written to the
  device settings.
- **MIDI monitor** shows what the device sends (notes, CC, start/stop; clock hidden).
- **Cutoff link (one way).** The official TD-3-MO manual (p. 62, "MIDI Information") lists what the
  device receives: Note Off `8n`, Note On `9n`, All Notes Off `Bn 7B`, **Filter Cutoff `Bn 4A xx`
  (CC 74)**, Pitch Bend `En`, and clock / start / continue / stop. With "Link the CUT OFF FREQ knob"
  on, the editor's cutoff knob sends CC 74 (0..127, throttled to one message per 10 ms, current
  value sent when the link or connection starts). The device's own knobs send no MIDI, so there is
  no way back from device to editor.
- **Tuning link (one way).** With "Link the TUNING knob" on, the editor's tuning knob (±12 semitones
  in the preview) is sent as pitch bend `En lsb msb`. The device bends by its own configured range
  (read from the configuration reply, byte 11; 2 semitones assumed if unknown), so beyond that range
  the bend stays at its maximum. Switching the link off re-centres the bend (8192).
- **CC test tool** next to the monitor: send any CC number/value to find out what a firmware responds to.
- **Receive** one slot or all 64 into the editor (undoable with Cmd+Z).
- **Send** the current pattern to the same slot on the device, in three steps:
  1. read the slot as it is now and keep it as a backup (aborts if that read fails),
  2. write the new pattern,
  3. read it back and compare the notes (the TD-3 sends no acknowledgement for a write).
  The last 30 backups are kept in localStorage and can be loaded back into the editor.

## What can be transferred

- **Patterns: yes**, over MIDI SysEx (USB-MIDI or 5-pin DIN).
- **Patches (knob settings): no.** The TD-3-MO's synth section is analog with direct
  potentiometers. Knob positions are not stored, recalled or sent over MIDI. The patches in
  this editor only drive the WebAudio preview and serve as recall notes.

## File formats vs. what the device receives

The TD-3-MO does not receive files over USB. It receives **MIDI SysEx messages**:

- `.seq` is SynthTribe's file format on the computer. SynthTribe reads it and sends the
  pattern to the device as SysEx. A `.seq` file is a small header followed by exactly the same
  110-byte pattern payload as the SysEx message.
- `.mid` (supported in the editor, `src/model/midi.js`) is for exchanging patterns with DAWs.
  It cannot be uploaded as a pattern. At most it can be played live into the device as notes.

So the work comes down to one translation layer, with the editor model in the middle:

```
.mid  <-> model/midi.js  <->  editor pattern  <->  model/td3format.js (SysEx)  <-> TD-3-MO over USB
                                    ^
                         .seq  <->  model/td3format.js (done)
```

## Data mapping

The editor model in `src/model/pattern.js` mirrors the hardware memory:

| Editor                          | Hardware concept                     |
| ------------------------------- | ------------------------------------ |
| `slot` 0..63                    | Group I–IV × Section A/B × Pattern 1–8 |
| `pattern.length` 1..16          | Pattern length (last step)           |
| `step.note` 0..12               | Pitch key C .. C'                    |
| `step.octave` -1 / 0 / +1       | DOWN / (none) / UP transpose         |
| `step.accent`, `step.slide`     | ACCENT / SLIDE per step              |
| `step.time` note / tie / rest   | Time sequence: note, tie, rest       |

Helpers: `slotParts(index)` and `slotIndex(group, section, number)` in `src/model/pattern.js`.

## Format status

`src/model/td3format.js` implements the payload, `.seq` files and SysEx messages, based on
public reverse-engineering (303patterns.com, echolevel/Acid-Injector, beholder-d/td3-pattern;
independent implementation, no code copied). Checked so far:

- 19 library patterns survive `.seq` and SysEx round-trips unchanged.
- The `.seq` header matches what Acid-Injector writes, byte for byte.
- A real hardware dump published in the td3-pattern README decodes to the note sequence
  described there, so the pitch encoding and the "pitch pool" model are right.

## Verified on a real TD-3-MO (firmware 2.0.1), 2026-10-10

Tested with the app's own `td3.js` / `td3format.js` driving the device over USB (CoreMIDI):

- **Identity:** product "TD-3", model code "P0DTD", firmware reply `09 00 02 00 01`; model ID `0x0A`.
- **Config dump** (`75` → `76` + 10 bytes): out ch, in ch, transpose, bend range, key priority,
  multi-trigger, clock polarity, clock rate, clock source, accent threshold. This unit: out 1, in 2,
  bend ±2, clock source internal, accent above velocity 95.
- **Pattern read** (`77 g s` → 123-byte `78 g s` message): all 64 slots in 232 ms; the reply echoes
  the address, so section B = slots 8–15 is confirmed. A bad address gets `01 00 01`.
- **Tie semantics, by letting the device play a received slot over USB clock and recording its MIDI
  out:** per step, rest bit set = rest; gate bit set = new note (takes the next pool entry); gate bit
  clear = tie, i.e. *this* step continues the previous note (silent after a rest). The earlier
  implementation put ties one step early; fixed, with the recorded slot as a regression test in
  `tests/formats.test.js`. Pitch mapping confirmed: key C = MIDI 36.
- **Pattern write:** ACK `01 00 00` after ~12 ms; read-back byte-identical; the original slot content
  was restored byte for byte afterwards. The app now waits for this ACK and keeps the marker byte.
- **Live notes** on the device's MIDI IN channel, accent/slide, CC 74 and pitch bend were sent
  correctly; the device does not echo received notes, so the sound itself was judged by ear.

Reference that matched these measurements: github.com/mattWoolly/TD-3-Commander, docs/DESIGN.md
(MIT, measured on the same model and firmware).

## Still open

- **Triplet timing.** The flag round-trips; the editor plays triplet steps as 16th-note triplets.
- **"Tie-rest" steps** (gate 0 + rest 1) exist in factory patterns; they decode as rests and are
  written back as plain rests.
- Stale pool entries / masks beyond the used notes are not preserved on write (they are inaudible).

`tests/hardware.test.js` runs the SysEx client and the note player against a simulated TD-3.
