<script setup>
defineEmits(['close'])

const SHORTCUTS = [
  ['Space', 'Run / stop'],
  ['← →', 'Select previous / next step'],
  ['↑ ↓', 'Pitch of selected step ±1 semitone, or ±1 scale step with the scale lock on (Shift: ±1 octave)'],
  ['A W S E D F T G Y H U J K', 'Write note C .. C\' to the selected step, then move on'],
  ['Z / X', 'Selected note an octave down / up'],
  ['C / V', 'Toggle ACCENT / SLIDE'],
  ['B', 'Lengthen the previous note into this step (tie)'],
  ['N, Backspace', 'Delete the note on this step (rest)'],
  ['[ ]', 'Previous / next pattern slot'],
  ['L', 'Pattern library'],
  ['R / M', 'New random line / mutate the pattern (generator settings under GENERATE)'],
  ['⌘/Ctrl + Z', 'Undo (Shift: redo); in the drum view it undoes drum edits'],
  ['⌘/Ctrl + C / V', 'Copy / paste pattern'],
  ['Shift + D', 'Switch the panel: synth or drums (both keep playing)'],
  ['Shift + M', 'Open / close the mixer'],
  ['?', 'This help']
]

const MOUSE = [
  ['Knobs', 'Drag up/down (Shift = fine), scroll, arrow keys when focused, double-click = default'],
  ['Empty roll cell', 'Click to add a note, drag to paint several'],
  ['Note', 'Drag up/down to change pitch, click to delete (or right-click)'],
  ['Note right edge', 'Drag to make the note longer or shorter'],
  ['Scroll in the roll', 'Show other octaves (the view centres on the notes when you switch pattern)'],
  ['Piano keys (left)', 'Hold to preview a pitch'],
  ['Accent / slide lanes', 'Toggle per step; slide glides into the next note'],
  ['Pattern buttons', 'While running, the new pattern starts when the current one ends'],
  ['Shift-click a number', 'Chain from the current slot to that one; the chain plays in a loop'],
  ['Triplet', 'Steps become 16th-note triplets (6 per beat)'],
  ['SCALE', 'Key and scale are shaded in the roll; with Lock on, notes snap into the scale. Fit moves all notes into it'],
  ['TRANSFORM', 'Reverse, invert, move accents / slides to the previous or next note, double or half speed'],
  ['SYNTH | DRUMS (by the name)', 'Show the TD-3 or the drum machine. The drums follow tempo, shuffle and RUN / STOP; the LED is lit while they will play'],
  ['MIXER (by the name)', 'Levels, drive, compressor and reverb for the TD-3 and the drums, kick sidechain (DUCK) on the TD-3, and the tempo. Effects are off at 0; drag the mixer by its title. The LED is lit when it changes the sound'],
  ['Drum grid', 'Click a step to set or clear it, drag to paint; click BD, SD ... to mute that row. GROOVE loads a ready-made beat'],
  ['TD-3 / TD-3-MO (top left)', 'Switch model: panel, sound and name follow the chosen hardware'],
  ['Colour dots (top left)', 'Body colour: yellow (MO), silver (303) or black (BK)'],
  ['TD-3 USB (top bar)', 'Play the real synth, receive and send patterns over USB']
]
</script>

<template>
  <div class="overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" @click.self="$emit('close')">
    <div class="sheet">
      <div class="sheet-head">
        <h2>How to drive it</h2>
        <button type="button" class="close" aria-label="Close" @click="$emit('close')">×</button>
      </div>
      <div class="cols">
        <section>
          <h3>Keyboard</h3>
          <dl>
            <template v-for="[k, v] in SHORTCUTS" :key="k">
              <dt><kbd>{{ k }}</kbd></dt>
              <dd>{{ v }}</dd>
            </template>
          </dl>
        </section>
        <section>
          <h3>Mouse</h3>
          <dl>
            <template v-for="[k, v] in MOUSE" :key="k">
              <dt>{{ k }}</dt>
              <dd>{{ v }}</dd>
            </template>
          </dl>
          <h3>How it maps to the TD-3</h3>
          <p>
            Mono, one note per step. A note longer than one step is stored as a 303 <strong>tie</strong>.
            <strong>Slide</strong> glides into the next note without retriggering the envelopes, and
            <strong>accent</strong> adds volume and filter sweep, building up over consecutive accents.
          </p>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(3px);
}

.sheet {
  width: min(860px, 100%);
  max-height: calc(100vh - 32px);
  overflow: auto;
  padding: 20px 24px 24px;
  border-radius: 10px;
  background: var(--chassis);
  color: var(--ink);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}

.sheet-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 2px solid var(--ink);
  padding-bottom: 8px;
  margin-bottom: 14px;
}

h2 {
  margin: 0;
  font-family: var(--font-panel);
  font-style: italic;
  font-weight: 800;
  font-size: 24px;
  text-transform: uppercase;
}

h3 {
  margin: 0 0 8px;
  font-family: var(--font-panel);
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

section + section h3:not(:first-child) {
  margin-top: 18px;
}

.close {
  width: 32px;
  height: 32px;
  border: 2px solid var(--ink);
  border-radius: 50%;
  background: none;
  color: var(--ink);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 12px;
  margin: 0;
  font-size: 13px;
}

dt {
  font-weight: 700;
}

dd {
  margin: 0;
}

kbd {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--ink);
  color: var(--chassis);
  font-family: var(--font-display);
  font-size: 12px;
  white-space: nowrap;
}

p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}

@media (max-width: 680px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
</style>
