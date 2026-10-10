# TD-3-MO MIDI implementation

The complete MIDI and SysEx implementation of the Behringer TD-3-MO as far as this project knows
it. For the device in general (controls, pattern memory, the sequencer's data model, file
formats) see [TD-3-MO.md](TD-3-MO.md).

Status labels:

- **Verified**: measured on a real TD-3-MO, firmware 2.0.1, on 2026-10-10.
- **Manual**: official TD-3-MO manual, p. 62 "MIDI Information".
- **Community**: public reverse-engineering (303patterns.com, TD-3-Commander), not checked here.

All values are hexadecimal unless noted. `n` = MIDI channel − 1 (0–F).

## 1. Ports and channels

- **Ports:** USB-MIDI (port name `TD-3-MO`) and 5-pin MIDI In / Out / Thru.
- **Two channels**, both set on the device (or with SynthTribe):
  - **MIDI IN channel:** the channel the TD-3 listens to. A computer must send notes, CC 74 and
    pitch bend on this channel.
  - **MIDI OUT channel:** the channel the TD-3 sends the notes of its own sequencer on.
- Both can be read with the configuration request (section 4.4). Test unit: IN 2, OUT 1.

## 2. Channel messages

### Received (Manual, all Verified except where noted)

| Message | Bytes | Meaning |
| --- | --- | --- |
| Note Off | `8n kk vv` | release key `kk` |
| Note On | `9n kk vv` | play key `kk`; velocity above the accent threshold = accent; `vv` = 0 is a Note Off |
| All Notes Off | `Bn 7B 00` | silence |
| Filter Cutoff | `Bn 4A vv` | CC 74, cutoff 0–127 (how it combines with the knob is not measured) |
| Pitch Bend | `En ll mm` | 14-bit, centre `00 40` (8192); range = the device's bend setting (0–12 semitones) |

- **Key mapping:** MIDI note = device pitch byte + 12. Key C without transpose is MIDI 36 (C2), the
  three-octave panel range is MIDI 24–60. (Verified.)
- **Accent:** velocity above the configurable threshold (test unit: 95). (Community / Verified.)
- **Slide:** overlapping notes: the next Note On arrives before the previous Note Off.
  (Community; broken before firmware 1.2.6 according to 303patterns.com.)
- **Not handled:** Program Change, other controllers. The knobs cannot be set over MIDI.
- Received notes are **not echoed** to MIDI out. (Verified.)

### Transmitted

| Message | When | Source |
| --- | --- | --- |
| Note On / Off on the MIDI OUT channel | while the internal sequencer runs: velocity 80 for normal steps, 112 for accented steps; gate ≈ half a step | Verified |
| Controllers | **never**: turning a knob sends nothing | Verified |
| Panel events `A0`–`A4` | only in the hidden panel test mode (SysEx `50`), do not use | Community |

## 3. System real-time

| Message | Bytes | Behaviour |
| --- | --- | --- |
| Timing Clock | `F8` | 24 per quarter note |
| Start | `FA` | starts the sequencer |
| Continue | `FB` | continues |
| Stop | `FC` | stops |

The device obeys Start/Continue/Stop **only from the interface its clock source points to**
(internal, MIDI DIN, USB or trigger), and that interface must also send `F8` clock. With the
clock source on internal, USB Start does nothing. (Manual lists the messages; behaviour Community,
Verified by setting the clock source to USB, starting, and restoring it.)

The editor's clock out sends Start, then the first `F8` on step 1 and 24 per quarter note at the
editor's tempo, and Stop when the editor stops. The clock is straight: the editor's shuffle and
triplet steps do not change it (the TD-3 applies its own). Messages carry Web MIDI timestamps
taken from the audio clock, so the clock lines up with the browser preview. The editor's
sequencer runs on one 24 ppq master clock: the `F8` ticks, the TD-3 steps (6 ticks, 4 in triplet
mode) and the browser drum machine's 16ths all come from the same tick times, so they stay
together while the tempo changes.

**Timestamp note (browser):** right after an `AudioContext` starts, `getOutputTimestamp()` returns
`contextTime` 0 for some tens of milliseconds (Chrome: ~50 ms). MIDI timestamps computed in that
window came out ~45 ms off from later ones, which showed as one long clock gap on the first start.
The editor waits until `contextTime` is above 0 before it starts the sequencer.

## 4. System exclusive

### 4.1 Framing

```
F0 00 20 32 00 01 0A <cmd> [data …] F7
```

- `00 20 32` = Behringer manufacturer ID, `00 01` = fixed, `0A` = model ID of the TD-3 and the
  TD-3-MO (identical).
- No checksum. Values wider than 7 bits travel as two nibble bytes, high nibble first.
- Every request is answered with the same header. Unknown commands get **no reply** at all, so
  use a timeout (300 ms is generous; replies arrive in a few milliseconds). (Community / Verified.)

### 4.2 Command overview

| Request | Reply | Purpose | Status |
| --- | --- | --- | --- |
| `04` | `05` + ASCII + `00` | model code, `P0DTD` | Verified |
| `06` | `07` + ASCII + `00` | product name, `TD-3` | Verified |
| `08 00` | `09 00 <maj> <min> <rev>` | firmware, test unit `02 00 01` = 2.0.1 | Verified |
| `75` | `76` + 10 bytes | configuration dump (4.4) | Verified |
| `77 <g> <s>` | `78 <g> <s>` + 112 bytes | read pattern (4.5) | Verified |
| `78 <g> <s>` + 112 bytes | `01 00 00` | write pattern (4.5) | Verified |
| `7E` | `7E 00 00 01 00 02` | poly-chain status (read only) | Verified (reply), meaning Community |
| `0E 01 <out> <in>` | `01 00 00` | set MIDI OUT and IN channel (0–F) | Community |
| `0F <00–18>` | `01 00 00` | MIDI input transpose, `0C` = 0 | Community |
| `11 <00–0C> 00` | `01 00 00` | pitch bend range in semitones | Community |
| `12 <0/1/2>` | `01 00 00` | key priority: low / high / last | Community |
| `14 <0/1>` | `01 00 00` | multi-trigger off / on | Community |
| `19 <0/1>` | `01 00 00` | clock trigger polarity: fall / rise | Community |
| `1A <0–3>` | `01 00 00` | clock trigger rate: 1 PPS / 2 PPQ / 24 PPQ / 48 PPQ | Community |
| `1B <0–3>` | `01 00 00` | clock source: internal / MIDI DIN / USB / trigger | Verified (`02` and back to `00`) |
| `1C <00–7F>` | `01 00 00` | accent velocity threshold | Community |
| `7D` | none | **reset configuration to factory** | Community, do not send casually |
| `50 <1/0>` | panel events | hidden panel test mode | Community, not used |
| `03 …` | | mode setter, **includes firmware update (DFU) entry**: can brick the unit | Community, never send |

Notes on the community sources: 303patterns.com documents the channel setter as
`0E <out> 00 <in>`; TD-3-Commander measured `0E 01 <out> <in>` on a TD-3-MO 2.0.1. The 48 PPQ
clock rate is `03` when set (303patterns.com's read table shows `08`).

### 4.3 Acknowledgement

| Reply | Meaning |
| --- | --- |
| `F0 00 20 32 00 01 0A 01 00 00 F7` | OK (pattern stored, setting changed) |
| `F0 00 20 32 00 01 0A 01 00 01 F7` | refused, e.g. pattern address out of range |

(Verified: write ACK after ~12 ms; `77 05 00` with group 5 returns the refusal.)

### 4.4 Configuration dump (`75` → `76`)

Request `F0 00 20 32 00 01 0A 75 F7`, reply `F0 00 20 32 00 01 0A 76 <10 bytes> F7`:

| Byte (message offset) | Field | Values | Test unit |
| --- | --- | --- | --- |
| 08 | MIDI OUT channel | 0–F | `00` (ch 1) |
| 09 | MIDI IN channel | 0–F | `01` (ch 2) |
| 0A | MIDI input transpose | `00`–`18`, `0C` = 0 | `0C` |
| 0B | pitch bend range | 0–12 semitones | `02` |
| 0C | key priority | 0 low, 1 high, 2 last | `02` |
| 0D | multi-trigger | 0 / 1 | `00` |
| 0E | clock trigger polarity | 0 fall, 1 rise | `01` |
| 0F | clock trigger rate | 0 1 PPS, 1 2 PPQ, 2 24 PPQ, 3 48 PPQ | `00` |
| 10 | clock source | 0 internal, 1 MIDI DIN, 2 USB, 3 trigger | `00` |
| 11 | accent velocity threshold | 0–127 | `5F` (95) |

Full reply of the test unit (Verified):

```
F0 00 20 32 00 01 0A 76 00 01 0C 02 02 00 01 00 00 5F F7
```

### 4.5 Pattern read and write

**Read** group `g` (0–3), slot `s` (0–15, A1–A8 = 0–7, B1–B8 = 8–15):

```
→ F0 00 20 32 00 01 0A 77 <g> <s> F7
← F0 00 20 32 00 01 0A 78 <g> <s> <marker hi> <marker lo> <110-byte payload> F7      (123 bytes)
```

**Write** uses exactly the same layout as the read reply:

```
→ F0 00 20 32 00 01 0A 78 <g> <s> <marker hi> <marker lo> <110-byte payload> F7
← F0 00 20 32 00 01 0A 01 00 00 F7
```

- The reply echoes `<g> <s>`, which confirms the slot numbering. (Verified.)
- A read reply can be sent back unchanged as a write: this restores a slot byte for byte.
  (Verified on slot IV-B8.)
- The marker pair reads `00 00` on used slots; keep the value that was read. (Verified / Community.)
- The 110-byte payload (pitch, accent and slide pools, triplet flag, length, gate and rest masks)
  is described in [TD-3-MO.md, section 5](TD-3-MO.md#5-pattern-data-format); the per-step meaning
  of the gate and rest bits (note / tie / rest) in
  [section 4](TD-3-MO.md#how-the-sequencer-stores-a-pattern-tb-303-style).
- Safe write procedure (as used by the editor and by TD-3-Commander): read the slot first and keep
  it as a backup, write, wait for the ACK, read back and compare.

Timing on the test unit (Verified): one read takes a few milliseconds, all 64 slots 232 ms in
sequence; a write is acknowledged after ~12 ms.

## 5. Examples

```
Product name     → F0 00 20 32 00 01 0A 06 F7
                 ← F0 00 20 32 00 01 0A 07 54 44 2D 33 00 F7          "TD-3"
Firmware         → F0 00 20 32 00 01 0A 08 00 F7
                 ← F0 00 20 32 00 01 0A 09 00 02 00 01 F7             2.0.1
Read IV-B8       → F0 00 20 32 00 01 0A 77 03 0F F7
Clock src USB    → F0 00 20 32 00 01 0A 1B 02 F7
                 ← F0 00 20 32 00 01 0A 01 00 00 F7
Note C2, ch 2    → 91 24 40          (normal)      91 24 7F   (accent)
Cutoff, ch 2     → B1 4A 40
Bend +max, ch 2  → E1 7F 7F          centre: E1 00 40
All notes off    → B1 7B 00
```

## 6. Where this lives in the code

| File | What |
| --- | --- |
| `src/model/td3format.js` | payload, `.seq`, `.sqs`, `.syx` and SysEx pattern encode/decode |
| `src/hardware/td3.js` | SysEx request/response client (identify, config, read, write with ACK), live note player, MIDI monitor descriptions |
| `src/store/device.js` | connection state, channel adoption, cutoff/tuning links, safe send with backups |
| `tests/formats.test.js` | includes the recorded TD-3-MO slot as a regression test |
| `tests/hardware.test.js` | SysEx client and note player against a simulated TD-3 |
