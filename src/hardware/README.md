# Hardware link (developer notes)

Everything that talks to a real TD-3 / TD-3-MO lives here (`td3.js`), with the reactive wrapper in
`src/store/device.js` and the UI in `src/components/DeviceOverlay.vue` (top bar: **TD-3 USB**).

The device facts behind this code are documented separately:

- [docs/TD-3-MO.md](../../docs/TD-3-MO.md): hardware, controls, pattern memory, the sequencer's
  data model (pools, note / tie / rest), the payload and `.seq` formats, test results, sources.
- [docs/MIDI-IMPLEMENTATION.md](../../docs/MIDI-IMPLEMENTATION.md): channel messages, clock,
  every known SysEx command with byte layouts and examples.

## Layers

```
DeviceOverlay.vue ──► store/device.js ──► hardware/td3.js ──► Web MIDI (MIDIInput / MIDIOutput)
                         │                    │
                         │                    └─ model/td3format.js (pattern payload, SysEx framing)
                         └─ store/editor.js (sequencer events → live notes, cutoff/tuning links)
```

- `td3.js` has no Vue: `createSysexClient(input, output)` (identify, config, read, write with
  ACK, one request at a time with timeouts), `createNotePlayer` (sequencer events → timestamped
  Note On/Off, slides as overlaps, panic), `describeMidi` (monitor), `listPorts`.
- `device.js` holds the connection state, adopts the device's MIDI channels, mirrors live notes,
  sends CC 74 / pitch bend for the linked knobs (throttled to 10 ms), keeps backups, and
  persists its settings in `localStorage` (`td3mo.device.v1`). It also runs a heartbeat (a
  product-name request every 2.5 s): Firefox reports unplugged ports as still connected, so
  `device.lost` is what stops live play and unlocks the panel there; Chrome's `statechange` is
  handled too. A port named TD-3 that never answers counts as lost.
- Both only depend on the Web MIDI *shapes* (an `EventTarget` input with `midimessage` events and
  an output with `send(bytes, timestamp)`), so they also run in Node against a CoreMIDI adapter
  or a fake device.

## Rules for code that writes to the device

1. Read the slot first and keep it as a backup; abort if that read fails.
2. Write, then wait for the ACK `01 00 00`; treat `01 00 01` as an error.
3. Read back and compare; report a mismatch.
4. Keep the marker byte that was read.
5. Never send `03` (mode setter, includes firmware update entry) or `7D` (factory reset) from
   the editor. Configuration setters are not used; channels are only read.

## Testing

- `tests/hardware.test.js` runs the SysEx client and the note player against a simulated TD-3
  (`npm test`).
- `tests/formats.test.js` contains a slot recorded from a real TD-3-MO plus the notes the device
  played from it, as a regression test for the tie semantics.
- Real-device checks (2026-10-10) were run in Node with the app's own `td3.js` / `td3format.js`
  over CoreMIDI using `@julusian/midi` (RtMidi); the `jzz` library dropped the 123-byte replies on
  macOS. The browser's Web MIDI receives them fine.

## Browser support

Chrome and Edge on desktop; Firefox works but only sees devices that were connected when it
started (restart Firefox after connecting the TD-3); Safari has no Web MIDI. HTTPS or localhost
is required.
