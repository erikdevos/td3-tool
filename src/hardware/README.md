# Hardware bridge (future work)

This folder is where communication with a real Behringer TD-3-MO will live.
Nothing here is wired into the UI yet, except a disabled **Send to TD-3** button in
`src/components/EditorBar.vue`.

## What can be transferred

- **Patterns: yes.** The TD-3 stores sequencer patterns in memory and can exchange them
  over MIDI SysEx (USB-MIDI or 5-pin DIN).
- **Patches (knob settings): no.** The TD-3-MO's synth section is analog with direct
  potentiometers. Knob positions are not stored or recalled by the device. The patches in
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

## Plan

1. `requestMidiAccess()` with `sysex: true` (Chrome/Edge; Firefox needs the site permission
   add-on flow, Safari has no Web MIDI).
2. `findTd3Ports()` to pick the device by port name.
3. Ask the device for its product name / firmware (`F0 00 20 32 00 01 0A 06 F7`) to confirm the
   model ID, then request a pattern dump (`requestPatternSysex`) and decode it.
4. Compare the decoded pattern with what the TD-3-MO plays, especially ties.
5. Back up all 64 patterns, then add "Receive from TD-3" / "Send to TD-3".

## Still to verify (on a real TD-3-MO)

- **Tie direction.** We follow td3-pattern's observation: a tie bit on step i means the note
  continues into step i+1. Acid-Injector never writes ties, so this has one source only.
- **Pattern slot numbering** in SysEx: A1–A8 = 0–7, B1–B8 = 8–15 (two sources). 303patterns.com
  says A1 = 1, which conflicts.
- **TD-3-MO model ID.** All sources describe the regular TD-3 (`0x0A`). The MO may report a
  different ID or `.seq` device name. Import accepts any device name starting with "TD-3".
- Triplet mode is read but not supported by the editor (it plays as straight 16ths).

Sources to check first: Behringer's official TD-3-MO documentation and the SynthTribe
app (it reads and writes patterns, so its traffic can be captured with a MIDI monitor),
plus community reverse-engineering notes of the TD-3 SysEx format. Verify everything
against a dump from a real unit before writing to the device.

A tip for testing: back up all patterns from the device first.
