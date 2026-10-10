# Behringer TD-3-MO: device notes

What this project learned about the TD-3-MO ("Modded Out") while building the editor: the
hardware, what can and cannot be controlled from a computer, how the pattern memory and the
sequencer work, and the file formats. The MIDI and SysEx details are in a separate document:
[MIDI-IMPLEMENTATION.md](MIDI-IMPLEMENTATION.md).

Each fact is marked with where it comes from:

- **Verified**: measured on a real TD-3-MO, firmware 2.0.1, on 2026-10-10 (this project's test unit).
- **Manual**: the official TD-3-MO manual (p. 62, "MIDI Information").
- **Community**: public reverse-engineering notes, not (yet) checked on the test unit. Sources at the end.

Behringer publishes no SysEx specification and no firmware release notes; everything about
SysEx and the pattern format is reverse-engineered.

## 1. Hardware and connection

| Item | Value | Source |
| --- | --- | --- |
| USB device name | `TD-3-MO` (manufacturer "Behringer") | Verified |
| USB vendor / product ID | `0x1397` / `0x1265` | Verified |
| USB speed | Full speed, 12 Mb/s | Verified |
| USB class | Class-compliant USB-MIDI; no driver needed on macOS. Port name `TD-3-MO` for input and output | Verified |
| Other MIDI ports | 5-pin MIDI In, Out, Thru | Retailer spec |
| Product name over SysEx | `TD-3` (identical to the regular TD-3) | Verified |
| Model code over SysEx | `P0DTD` (identical to the regular TD-3) | Verified |
| Firmware (test unit) | 2.0.1 (SynthTribe shows the same) | Verified |

**Telling a TD-3-MO from a TD-3:** over SysEx it answers exactly like a regular TD-3 (same model
ID `0x0A`, same product name and model code). The only differences are the USB/MIDI port name
(`TD-3-MO`) and the firmware major version (2.x on the MO, 1.x on the regular TD-3).
(Verified; the same observation is in TD-3-Commander's notes.)

### Browsers and operating systems

- **Chrome / Edge (desktop):** Web MIDI with SysEx works after a permission prompt.
- **Firefox:** works, but Firefox scans for MIDI devices only when it starts. If the TD-3 was not
  connected and switched on at that moment, Firefox silently refuses MIDI access ("no devices
  were detected") until it is restarted. Fix: connect the TD-3, quit Firefox with Cmd+Q, start it
  again. (Verified with the user's setup.) Firefox also keeps listing an unplugged TD-3 as
  "connected", so the page cannot rely on the port state; the editor asks the device for its name
  every 2.5 s instead and treats two missed answers as "gone". (Verified with the user's setup.)
- **Safari:** no Web MIDI at all.
- **Web MIDI needs a secure context** (HTTPS or localhost); GitHub Pages is fine.
- **Long SysEx in Node:** the `jzz` library on macOS dropped the device's 123-byte pattern replies
  while short replies came through; RtMidi (`@julusian/midi`) received them correctly. Browsers
  handle them fine. (Verified.)

## 2. Synth section: what a computer can and cannot control

The synth section is analog. The knobs are potentiometers in the audio path:

- Knob positions are **not stored**, not recalled and not readable. There is no patch memory.
- Turning a knob **sends no MIDI** (nothing appears on the MIDI out). (Verified with a MIDI monitor;
  the manual lists no transmitted controllers either.)
- From the computer, only two sound parameters can be changed (Manual):
  - **Filter cutoff:** CC 74 (`Bn 4A vv`).
  - **Pitch:** pitch bend, within the bend range set on the device (0–12 semitones; test unit ±2).
- How CC 74 combines with the physical cutoff knob (offset or replace) is not documented and not
  yet measured.

**WAVEFORM switch (TD-3-MO):** SAW, SQUARE and OFF. OFF mutes the main oscillator only; what
remains audible is the sub oscillator (if switched on), the filter when the resonance makes it
self-oscillate, and the external audio input. The regular TD-3 has only SAW and SQUARE. (Manual
summaries and a review, see sources; confirmed by the owner of the test unit.) The editor shows
the three positions for both models. In the preview, the filter rings without an oscillator
when the accent sweep is on HIGH and a note is accented; plain maximum resonance stays just below
self-oscillation, as in Open303. That threshold has not been compared with the real unit.

So a two-way knob sync is impossible. The editor's patches are a model for the browser preview and
a recall sheet for setting the real knobs by hand; during live play the editor locks every control
except the two that reach the device.

## 3. Playing the TD-3 from a computer

- **Notes:** standard Note On/Off on the device's MIDI IN channel (Manual). Mono, the device's key
  priority setting decides between overlapping notes (default "last").
- **Accent:** a note is accented when its velocity is above the device's accent threshold
  (configurable, 0–127; test unit: 95). The editor sends 127 for accent and 64 for normal notes.
  (Community, threshold value Verified.)
- **Slide:** start the next note before releasing the previous one (legato overlap). Older
  firmware before 1.2.6 is reported to have broken slides. (Community.)
- **Pitch:** MIDI note = device pitch byte + 12; key C without transpose is MIDI 36 (C2).
  (Verified by recording the device's own playback.)
- **All Notes Off:** CC 123 (`Bn 7B`). (Manual.)
- The device does **not echo** notes it receives to its MIDI out. (Verified.)

### Running the device's own sequencer

- The device obeys Start (`FA`), Continue (`FB`) and Stop (`FC`) only from the interface its
  **clock source** points to (internal, MIDI DIN, USB, or trigger input), and that interface must
  also send MIDI clock (`F8`, 24 per quarter note). With the clock source on "internal", USB Start
  does nothing. (Community; Verified by switching the clock source to USB, starting the sequencer
  over USB and switching back.)
- While its sequencer runs, the device sends the notes it plays on its **MIDI OUT channel**:
  velocity 80 for normal steps, 112 for accented steps; a note's gate lasts about half a step
  (3 of 6 clocks), tied notes are held until half way the last tied step. (Verified.)
- There is **no command to select the playing pattern**, no Program Change handling and no way to
  read or write tracks (song mode). (Community.)

## 4. Pattern memory

- **64 patterns:** Group I–IV × Section A/B × Pattern 1–8.
- Addressing over SysEx: `group` 0–3, `slot` 0–15 where A1–A8 = 0–7 and B1–B8 = 8–15.
  (Verified: every read reply echoes the requested address; an invalid address is refused.)
- A pattern has 1–16 active steps, a triplet flag, and per step: pitch (C..C', with DOWN/UP
  transpose), accent, slide and a time value (note / tie / rest).
- Reading all 64 slots over USB takes about 0.25 s; a write is acknowledged within ~12 ms.
  (Verified.)

### How the sequencer stores a pattern (TB-303 style)

Like the original TB-303, pitch, accent and slide are **not stored per step**. They are three
lists ("pools") of up to 16 entries that the sequencer consumes in order, one entry for every
step that starts a new note. Ties and rests consume nothing. The time value per step decides
what happens:

| Gate bit | Rest bit | Step | Notes |
| --- | --- | --- | --- |
| 1 | 0 | **note** | starts a new note, takes the next pool entry |
| 0 | 0 | **tie** | *this* step continues the previous note; silent after a rest |
| 1 | 1 | **rest** | silent |
| 0 | 1 | **tie-rest** | occurs in factory patterns; sounds as a rest |

Verified on the test unit: the device played slot I-A2 over USB clock and its MIDI out was recorded.
Every note started, held and stopped exactly as this table predicts (for example: a note step
followed by two tie steps was held for three steps; a tie step right after rests stayed silent).
This corrected an earlier assumption in this project that a cleared gate bit meant "held into the
*next* step"; that put every tie one step early.

Further details (Community, consistent with the test unit's data):

- Steps beyond the active length are stored too (masks and pool entries) and reappear when the
  length is raised on the panel.
- Pool entries after the last used note hold stale data; do not infer the note count from them.
- The slide flag of a pool entry means "glide from this note into the next one".

## 5. Pattern data format

The same 110-byte payload is used in SysEx messages and in SynthTribe `.seq` files. Every value
is split into two "nibble bytes" (high 4 bits, low 4 bits), so all bytes stay below 0x80.

| Offset | Bytes | Field |
| --- | --- | --- |
| 0 | 32 | pitch pool: 16 entries × (hi, lo) |
| 32 | 32 | accent pool: 16 × (0, flag) |
| 64 | 32 | slide pool: 16 × (0, flag) |
| 96 | 2 | triplet: (0, flag) |
| 98 | 2 | active step count 1–16: (hi, lo) |
| 100 | 2 | reserved, 00 00 |
| 102 | 4 | gate mask (16 bits) |
| 106 | 4 | rest mask (16 bits) |

- **16-bit masks** are stored as four nibbles in the order: bits 4–7, bits 0–3, bits 12–15,
  bits 8–11 (i.e. steps 8–5, 4–1, 16–13, 12–9; bit 0 = step 1).
- **Pitch byte** = 12 + semitone (0–12) + 12 × transpose (0 = down, 1 = none, 2 = up), so key C
  without transpose = 24 (0x18). Bit 7 is set when the note was entered on the upper C key
  (C'). Decode with `& 0x7F`. Unused entries are padded with 0x18. (Community; the mapping to MIDI
  notes, byte + 12, was Verified.)
- **Marker byte:** in front of the payload sits one more nibble pair. It reads 00 on used slots
  (01 was seen on an empty slot, Community). The editor keeps the value it read when writing.

### SynthTribe `.seq` file

A `.seq` file is a header followed by the marker pair and the payload, 146 bytes in total:

| Bytes | Content |
| --- | --- |
| 4 | magic `23 98 54 76` |
| 4 + 8 | length 8 (u32 BE) + UTF-16BE `TD-3` |
| 4 + 10 | length 10 (u32 BE) + UTF-16BE `1.3.7` (SynthTribe version) |
| 4 | length of the rest, 112 (u32 BE) |
| 2 | marker pair `00 00` |
| 110 | payload |

The header matches what Acid-Injector writes, byte for byte. Files exported by SynthTribe for a
TD-3-MO are reported to differ in the header (see synthtribe2midi issue #1); the editor accepts any
device name starting with "TD-3". (Community.)

Other community formats exist (`.sqs` banks, `.syx`); the editor does not read them yet.

## 6. What the editor does with all this

| Feature | How |
| --- | --- |
| Live play | sequencer events → Note On/Off on the device's MIDI IN channel; accent = velocity 127, normal 64; slide = next note-on 4 ms before the previous note-off; stop = All Notes Off |
| Cutoff link | CUT OFF FREQ knob → CC 74, throttled to one message per 10 ms |
| Tuning link | TUNING knob (±12 semitones in the preview) → pitch bend, scaled to the device's bend range, clamped beyond it |
| Channels | read from the device configuration on connect (nothing is written) |
| Receive | pattern read of one slot or all 64; undoable in the editor |
| Send | read the slot (backup) → write → wait for ACK → read back and compare; aborts if the backup read fails; the last 30 backups are kept |
| Files | `.seq` import/export (SynthTribe), `.mid` import/export (DAW) |

## 7. Open questions

- **Triplet timing:** the flag round-trips; the editor plays triplet steps as 16th-note triplets
  (6 per beat). The device's exact timing has not been measured.
- **CC 74 and the cutoff knob:** offset or replacement?
- **Tie-rest steps** decode as rests and are written back as plain rests; whether the panel shows
  them differently is unknown.
- **Firmware 2.0.1 changes:** no release notes found; everything tested so far behaves like the
  community documentation for firmware 1.2.4–1.3.7, except that 303patterns.com's channel setter
  layout is wrong (see the MIDI document).

## 8. Sources

- Behringer TD-3-MO manual, p. 62 "MIDI Information" (official).
- Brad Isbell, *Behringer TD-3 MIDI Implementation, unofficial documentation*,
  https://303patterns.com/td3-midi.html (firmware 1.2.4–1.3.7).
- Matt Woolly, *TD-3-Commander*, docs/DESIGN.md, https://github.com/mattWoolly/TD-3-Commander
  (MIT; measured on a TD-3-MO with firmware 2.0.1, the same as the test unit).
- beholder-d, *td3-pattern*, https://github.com/beholder-d/td3-pattern.
- echolevel, *Acid-Injector*, https://github.com/echolevel/Acid-Injector (`.seq` header).
- james-see, *synthtribe2midi* issue #1 (TD-3-MO `.seq` exports).
- TD-3-MO-SR user guide (manuals.plus) and the macProVideo TD-3-MO review (waveform OFF).
- Thomann product page (cutoff controllable via MIDI, MIDI In/Out/Thru).

No code was copied from these projects; the editor's implementation is independent.
