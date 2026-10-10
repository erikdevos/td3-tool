# CLAUDE.md

Guide for AI-assisted development on this repository. Read this first; details live in the
linked docs.

## What this is

A browser-only editor for the Behringer **TD-3-MO** and **TD-3** (TB-303 clones): a piano-roll
pattern sequencer, a WebAudio emulation of the synth (Open303-based AudioWorklet), pattern files
(`.seq` for SynthTribe, `.mid` for DAWs), and a USB/Web MIDI link to the real device (live play,
receive/send patterns). Vue 3 + Vite, no backend. Live at https://erikdevos.github.io/td3-tool/.

- Device knowledge: [docs/TD-3-MO.md](docs/TD-3-MO.md)
- MIDI / SysEx: [docs/MIDI-IMPLEMENTATION.md](docs/MIDI-IMPLEMENTATION.md)
- Hardware code notes: [src/hardware/README.md](src/hardware/README.md)
- Features, structure, storage keys: [README.md](README.md)

## Commands

```bash
npm run dev      # Vite dev server on :5173 (.claude/launch.json "dev")
npm test         # Vitest, must stay green (CI blocks deploys on failures)
npm run build    # static build in dist/ (relative paths, base './')
```

Deploy = push to `main`. `.github/workflows/deploy.yml` tests, builds and publishes `dist/` to
GitHub Pages (repo setting: Pages source "GitHub Actions"). There is no server; keep it that way.

PWA: `public/sw.js` + `public/manifest.webmanifest`. The `pwa-precache` step in `vite.config.js`
fills the service worker's file list and version after each build. It is not registered in dev
(`import.meta.env.PROD`); test it with `npm run build && npm run preview` (`.claude/launch.json`
"preview"). Remove the test registration afterwards (it outlives the server on that port).

## Architecture in one screen

```
src/model/        pure, no DOM, unit-tested
  pattern.js        step/pattern model, bank layout (64 slots), pitch helpers, BASE_MIDI = 36
  scale.js          scales, inScale / snapPitch (scale lock)
  generate.js       generator + mutator (pass a seeded rng in tests: seededRandom)
  transform.js      note-level transforms; fromNotes() rebuilds steps (accent first, slide last step)
  patch.js          knob/switch definitions, models (td3mo/td3), themes, factory presets
  library.js        built-in patterns in a small text DSL (parsePattern)
  midi.js           Standard MIDI File encode/decode (chains, triplets)
  td3format.js      TD-3 payload, .seq / .sqs / .syx files, SysEx pattern messages
src/audio/
  td3-voice.worklet.js  the synth voice; dependency-free (loaded via audioWorklet.addModule)
  engine.js         AudioContext + worklet + analyser; audioTimeToMs for MIDI timestamps
  sequencer.js      lookahead scheduler; emits {kind:'on'|'off', time, midi, accent, slide},
                    and MIDI clock ticks via onClock (straight 24 ppq, independent of shuffle)
src/hardware/td3.js  Web MIDI: SysEx client (request/response, ACK), live note player; no Vue
src/store/
  editor.js         single reactive editor state + all actions (undo, transport, chain, files)
  device.js         TD-3 connection state, heartbeat (device.lost), channel adoption,
                    cutoff/tuning links, clock out, safe send, full backup / restore
  storage.js        localStorage keys, normalisation, migrations, JSON import/export
src/components/     Vue SFCs; hw/ = reusable hardware widgets (Knob, SlideSwitch, HwButton, ...)
tests/              Vitest: formats, midi chains, library, hardware (simulated TD-3)
```

State is a module singleton (`useEditor()`, `useDevice()`), not Pinia. Components call actions;
pattern edits go through `edit()` / `replaceSlots()` so undo works.

## Rules that must hold

**Device / data format (verified on a real TD-3-MO 2.0.1, see docs):**

- Ties: in the payload, gate bit 0 marks the step that *continues* the previous note. Rest bit set
  = rest. Pitch, accent and slide are pools consumed by note steps only. Do not "fix" this back;
  `tests/formats.test.js` contains a recording of the real device as ground truth.
- MIDI note = device pitch byte + 12; key C = MIDI 36 (`BASE_MIDI`). Section B = slots 8–15.
- Encode all 16 steps (also beyond the pattern length); keep the marker byte when writing.
- Writes: backup read first (abort if it fails) → write → wait for ACK `01 00 00` → read back.
  A full restore reads ALL target slots first (saved as a file), then writes and reads back each.
- The marker byte (`00 00` / `00 01`) does not mean "empty"; keep it as read.
- Never send SysEx `03` (DFU / mode) or `7D` (factory reset). Device settings are read, not written.
- The synth knobs are analog: no patch storage, no knob MIDI out. Only cutoff (CC 74) and pitch
  bend reach the device. Do not build "knob sync" from device to app; it cannot work.

**Product decisions from the owner:**

- Vue, not React. Browser-only, static hosting.
- The sequencer is a classic piano roll / step sequencer, deliberately *not* a copy of the
  hardware's step-entry workflow.
- Mono, one note per step.
- Look: the yellow TD-3-MO body (matte amber plastic), amber-skirt knobs with red pointer, black
  rubber buttons, black tab titles. Colours are CSS variables in `src/style.css`; themes
  (`yellow`, `silver`, `black`) override them via `:root[data-theme=...]`. Never hard-code body
  colours in components; use `--chassis`, `--ink`, `--accent`, etc.
- Desktop target: MacBook 13/14" (1440×900 and 1280×800). Rows must not wrap at 1440; check
  layout changes at both widths.
- Every setting persists in `localStorage` and survives a reload.
- The synth emulation is a mirror of the real device: no extra audio features (effects, sound
  extras the hardware lacks). Sound changes only bring it closer to the hardware.
- Pattern tools (scale lock, generator, transforms) must produce patterns the TD-3 can store.

## Conventions

- Match the surrounding code: small pure functions, comments explain *why*, no new dependencies
  without a good reason (the worklet must stay dependency-free).
- New persisted fields: add to the save `watch` in the store and to the normaliser; adding factory
  presets means bumping `FACTORY_VERSION` in `patch.js` (existing users get them merged in).
- Code, comments and docs are in English; UI text in English.
- Keep docs in sync: device facts go in `docs/`, labelled Verified / Manual / Community.
- Commit messages end with the attribution line requested by the harness, if any.

## Testing and verification tips

- Unit tests run in Node; the model and `hardware/td3.js` only need Web MIDI *shapes*
  (an `EventTarget` input firing `midimessage`, an output with `send()`), so fakes are easy.
- Browser checks: the built-in preview browser works for UI tests but **blocks Web MIDI**. For the
  real device use Node + `@julusian/midi` (RtMidi) with the app's own `td3.js`; `jzz` drops the
  123-byte SysEx replies on macOS.
- Settings are saved with a 300 ms debounce; wait before reading `localStorage` in tests.
- Fake devices in the browser: replace `navigator.requestMIDIAccess` before clicking Connect. The
  fake must answer SysEx (product `06`, firmware `08`, config `75`): a TD-3-named port that stays
  silent is treated as unplugged (heartbeat), so live play and clock stay off.
- Live play / clock out only run while `liveActive()` / `clockActive()`: chosen output connected,
  device not lost. Firefox keeps unplugged ports "connected"; the heartbeat is what catches that.
- MIDI timestamps: `getOutputTimestamp()` reports contextTime 0 for ~50 ms after the context
  starts; `outputClockReady()` waits for it. Don't remove that wait (first-start timing jumps).
- Synthetic pointer events with an unknown `pointerId` make `setPointerCapture` throw; the
  components catch that, but real mouse input is the better test (use the browser tool's drag).
- Dynamic `import()` of app modules from the page gives separate module instances under Vite HMR;
  drive the UI through the DOM instead.
- The 7-segment displays are SVG (no text content); read values from state or `localStorage`.
- Offline audio rendering: the worklet class can run in Node by stubbing `AudioWorkletProcessor`
  and `registerProcessor` (useful to check levels, NaN and CPU after DSP changes).
- For layout screenshots at a real desktop size, headless Chrome
  (`--headless=new --window-size=1440,900 --screenshot=...`) is sharper than the preview pane.
  To set state first (localStorage, clicks), drive it over the DevTools protocol
  (`--remote-debugging-port`, Node 22's global WebSocket): `Runtime.evaluate`, then
  `Page.captureScreenshot`.
- Both sequencer rows (`.seq-top` and the PatternLab row) must stay one line at 1280 and 1440.

## Open questions (see docs/TD-3-MO.md §7)

Triplet timing on the device, how CC 74 combines with the physical cutoff knob, tie-rest steps.
