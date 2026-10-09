# TD-3-MO Pattern & Sound Editor

A browser-based editor for the Behringer TD-3-MO, built with Vue 3 + Vite. It looks like the
hardware (acid-yellow panel, TD-3-MO control set) and has a modern piano-roll sequencer
instead of the hardware's step-entry workflow.

## Goal
- Edit TD-3-style mono patterns (one note per step, accent, slide, ties) in a classic piano roll
- Preview patterns and knob settings with a TD-3-MO-style WebAudio synth
- Store patterns and patches locally, import/export them as files
- Later: transfer patterns to/from the real device over USB-MIDI (see `src/hardware/`)

## Run locally
```bash
npm install
npm run dev -- --host 0.0.0.0
```

Production build check:
```bash
npm run build
```

## Features
- **Front panel** modeled on the TD-3-MO:
  - Main row: Waveform, Tuning, Cut Off Freq, Resonance, Env Mod, Decay, Accent and Volume.
  - "Modded Out" row: Normal Decay, Accent Decay, Soft Attack, Slide Time, Filter Tracking,
    Filter FM and Overdrive, plus switches for Accent Sweep, Sweep Speed, Muffler and Sub Osc.
  - Knobs: drag, scroll, use the arrow keys, Shift for fine control, double-click to reset.
- **Piano roll sequencer**: click to add a note, drag a note's right edge to lengthen it (stored as
  303 ties), drag it up or down to change pitch, click it to delete. Accent and slide have their
  own lanes. The range is three octaves (DOWN C to UP C'), the same as the hardware.
- **Pattern memory** in the hardware layout: Group I–IV × Section A/B × Pattern 1–8 (64 slots).
  While playing, a newly selected pattern starts when the current one ends, like on the device.
- Pattern length 1–16, shift, transpose, copy/paste, random acid line, clear, and undo/redo.
- Tempo with a 7-segment readout, tap tempo, shuffle.
- **Sound engine** in an AudioWorklet, built on **Open303** by Robin Schmidt (MIT license,
  notice in the worklet file): the measured TB-303 "TeeBee" filter model, 303 saw and tanh-shaped
  square wavetables, the envelope-to-cutoff mapping measured on a real unit, the accent RC circuit
  and the fixed pre/post filters, running 4x oversampled. The TD-3-MO controls sit on top: normal and
  accent decay, VCA decay (up to drone), soft attack, slide time (up to 6x), filter tracking, filter
  FM, accent sweep and sweep speed, muffler, overdrive and sub osc. A lookahead scheduler gives
  sample-accurate timing.
- **Look**: TD-3-MO yellow matte body (no separate dark section), amber-skirt knobs with a black cap
  and a red indicator line, black rubber buttons, black tab-style section titles, condensed bold panel
  lettering. The sequencer layout itself is intentionally not a copy of the hardware.
- **Pattern library** (`LIB` button or `L`): 19 original patterns in classic styles (Chicago acid,
  acid techno, psy, dub, electro and more). Each one comes with a suggested tempo and sound and loads
  into the current slot (undoable). These are not transcriptions of existing tracks.
- 19 factory patches (knob presets). New factory presets are added for existing users without
  overwriting their own patches (`FACTORY_VERSION` in `patch.js`). Save, delete and an "edited" indicator.
- **Pattern files**: `Import` accepts `.mid` and SynthTribe `.seq` (detected by content). Export as
  `.mid` (for DAWs) or `.seq` (for SynthTribe / the TD-3). The `.seq` and SysEx format is in
  `src/model/td3format.js`. See `src/hardware/README.md` for what is still unverified.
- **MIDI mapping**: Accent = velocity (127 out, >= 100 counts as accent in), slide = overlapping notes,
  ties = longer notes. Import takes the first bar, keeps one note per 16th (highest wins) and folds
  notes into the 3-octave range. The tempo is taken from the file if present.
- Export and import of the whole bank (patterns + patches) as JSON. Everything also autosaves
  to localStorage.
- Keyboard shortcuts: press `?` in the app for the full list.

## Project structure
```
src/
  App.vue                     device shell, global keyboard shortcuts
  style.css                   design tokens (colors, fonts), LED style
  model/
    patch.js                  knob/switch definitions, defaults, factory presets
    pattern.js                pattern/step model, bank layout, demo + random patterns
    library.js                built-in pattern library (text format, see parsePattern)
    midi.js                   Standard MIDI File encode/decode (pure, testable in Node)
    td3format.js              TD-3 pattern payload: .seq files + SysEx messages
  store/
    editor.js                 shared editor state + all actions (edit, undo, transport, presets)
    storage.js                localStorage, v1 migration, JSON import/export
  audio/
    td3-voice.worklet.js      the synth voice (AudioWorkletProcessor, no imports)
    engine.js                 AudioContext + worklet node + analyser
    sequencer.js              lookahead scheduler, 303 gate/tie/slide logic
  components/
    EditorBar.vue             patch manager, bank import/export, scope, help
    SynthPanel.vue            yellow knob panel
    Transport.vue             run/stop, tempo, tap, shuffle
    PatternBank.vue           group / section / pattern selection
    PatternTools.vue          length, shift, transpose, copy/paste, random, clear, undo
    PianoRoll.vue             piano roll + accent/slide lanes
    HelpOverlay.vue           shortcuts sheet
    LibraryOverlay.vue        pattern library browser
    Scope.vue                 output oscilloscope
    hw/                       reusable hardware widgets: Knob, SlideSwitch, HwButton, SevenSeg, SvgDefs
  hardware/
    td3.js                    hardware bridge stub (Web MIDI helpers, encode/decode TODOs)
    README.md                 plan + data mapping for the future SysEx upload
```

## Data model (how it maps to the TD-3)
- A pattern has `length` (1–16) and 16 `steps`.
- A step has `note` (0–12 = C..C'), `octave` (-1 / 0 / +1 = DOWN / – / UP), `accent`, `slide`
  and `time` (`note`, `tie` or `rest`). In the piano roll, a note longer than one step is a
  `note` step followed by `tie` steps.
- The slide flag on a step means "glide into the next note". The gate stays open and the
  envelopes are not retriggered.
- The bank holds 64 patterns, indexed by `slotIndex(group, section, number)`.

## Important constraints
- Use Vue, not React.
- Keep it browser-only for now.
- The sequencer is mono and single-note-per-step.
- Keep the TD-3-MO visual language: yellow matte body throughout, amber-skirt knobs with red
  pointers, black rubber buttons, red LEDs, black tab titles. Only the piano roll is a dark display.
- The sequencer UI should stay a regular piano roll / step sequencer, not a copy of the
  hardware's step-entry workflow (that workflow is famously unintuitive).
- Real hardware upload / MIDI / SysEx is deferred. Everything for it lives in `src/hardware/`.

## Assumptions and caveats
- The TD-3-MO's synth section is analog, so knob settings are not stored on the device.
  Patches only exist in this editor (for the preview and as recall notes).
- The control set follows public descriptions of the TD-3-MO (Behringer/retailer listings and
  the Sound On Sound review). The exact panel placement, the number of muffler positions and
  the sub osc behavior have not been checked against a real unit or the official manual.
- The core sound follows Open303, which is calibrated against a real TB-303. The MO-specific
  controls (and their ranges) are an interpretation of the TD-3-MO feature list, tuned by ear, and
  have not been compared with a real TD-3-MO.
- Web Audio needs a user gesture before it can start. The first click or key press powers up
  the synth.

## Known TODOs
- Hardware transfer (Web MIDI + SysEx). See `src/hardware/README.md`.
- MIDI out for live playback of patterns on the device.
- Verify `.seq`/SysEx details (tie direction, slot numbering, MO model ID) on a real TD-3-MO.
- MIDI import of longer files into consecutive slots (currently first bar only).
- Track/song mode (pattern chaining), triplet mode.
- Compare the panel layout and sound against a real TD-3-MO.

## Storage keys
`td3mo.bank.v2`, `td3mo.presets.v2`, `td3mo.session.v2`. Data from the first prototype
(`td3-patches-v1`, `td3-sequences-v1`) is migrated once on first load: old sequences go to
Group I, Section B.
