# Hardware link (TD-3 / TD-3-MO over USB)

Everything that talks to a real device lives here (`td3.js`), with the reactive wrapper in
`src/store/device.js` and the UI in `src/components/DeviceOverlay.vue` (top bar: **TD-3 USB**).
It uses Web MIDI with SysEx, so it works in Chrome and Edge on desktop, not in Safari.

## What it does

- **Live play.** The editor's sequencer and note previews play the real synth as a MIDI
  instrument: accent = velocity 127 (normal notes 64), slide = the next note starts 4 ms before
  the previous one ends, key C = MIDI note 36. Nothing is written to the device. The browser
  sound can be muted. Stopping sends note-off plus All Notes Off (CC 123).
- **Identify.** Product name (`F0 00 20 32 00 01 0A 06 F7`) and firmware (`... 08 00 F7`).
  No reply means wrong port, another device, or a model ID we don't know (see below).
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

## Still to verify (on a real TD-3-MO)

- **Tie direction.** We follow td3-pattern's observation: a tie bit on step i means the note
  continues into step i+1. Acid-Injector never writes ties, so this has one source only.
- **Pattern slot numbering** in SysEx: A1–A8 = 0–7, B1–B8 = 8–15 (two sources). 303patterns.com
  says A1 = 1, which conflicts.
- **TD-3-MO model ID.** All sources describe the regular TD-3 (`0x0A`). The MO may report a
  different ID or `.seq` device name. Import accepts any device name starting with "TD-3".
- **Triplet timing.** The flag (payload byte 97) round-trips. The editor plays triplet patterns
  as 16th-note triplets (6 steps per beat); no source documents the TD-3's exact timing.
- **Accent over MIDI.** The TD-3 treats velocities above a configurable threshold as accent
  (303patterns.com). We send 127 and 64, which works unless the threshold is set below 64.
- **Note range over MIDI.** Key C is sent as MIDI note 36. If the device plays an octave off,
  `BASE_MIDI` in `src/model/pattern.js` is the single place to change it.

How to verify with a real unit: connect, check that the product name appears, use
**Receive** on a few slots you know (including one with ties and one in section B), and compare
with what the device plays. Only then use **Send**, on a slot you don't mind losing; the backup
and read-back check protect against surprises. If the TD-3-MO does not answer SysEx at all, its
model ID probably differs from `0x0A` (`TD3_MODEL_ID` in `src/model/td3format.js`); a MIDI
monitor capture of SynthTribe talking to the device will show the right value.

`tests/hardware.test.js` runs the SysEx client and the note player against a simulated TD-3.
