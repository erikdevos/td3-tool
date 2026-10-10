<script setup>
import { computed, ref } from 'vue'
import { BANK_SIZE, isEmptyPattern, slotLabel } from '../model/pattern.js'
import { useDevice } from '../store/device.js'
import { useEditor } from '../store/editor.js'

const emit = defineEmits(['close'])
const { state, pattern, notify, replaceSlots } = useEditor()
const { device, connect, selectPorts, identify, readConfig, receivePattern, receiveSlots, sendPattern, sendCC, bendRange } =
  useDevice()

// CC test tool: send any controller to find out what the device responds to
const ccNumber = ref(74)
const ccValue = ref(64)
const sendTestCC = () => sendCC(ccNumber.value, ccValue.value)

const slot = computed(() => state.slot)
const label = computed(() => slotLabel(state.slot))
const sysexOk = computed(() => device.status === 'ready' && Boolean(device.product) && !device.lost)
const result = ref(null) // { kind: 'ok' | 'warn' | 'error', text }
const confirmSend = ref(false)

const report = (kind, text) => {
  result.value = { kind, text }
}

const guard = async (job) => {
  result.value = null
  try {
    await job()
  } catch (error) {
    console.error(error)
    report('error', error.message)
  }
}

const receiveSlot = () =>
  guard(async () => {
    const { pattern: received } = await receivePattern(slot.value)
    replaceSlots([{ slot: slot.value, pattern: received }])
    report('ok', `Read ${label.value} from the device into the editor. Undo with ⌘Z.`)
    notify(`RECEIVED ${label.value}`)
  })

const receiveBank = () =>
  guard(async () => {
    const received = []
    await receiveSlots(
      Array.from({ length: BANK_SIZE }, (_, i) => i),
      (index, r) => received.push({ slot: index, pattern: r.pattern })
    )
    replaceSlots(received)
    report('ok', `Read all ${BANK_SIZE} patterns into the editor. Undo with ⌘Z.`)
    notify('BANK RECEIVED')
  })

const send = () =>
  guard(async () => {
    confirmSend.value = false
    const { verified, exact } = await sendPattern(slot.value, pattern.value)
    if (verified) {
      report('ok', `Wrote ${label.value} and read it back: the device has the same notes${exact ? '' : ' (bytes differ slightly)'}.`)
      notify(`SENT ${label.value}`)
    } else {
      report('warn', `Wrote ${label.value}, but reading it back gave a different pattern. The previous version is in the backups below.`)
    }
  })

const loadBackup = (backup) => {
  replaceSlots([{ slot: backup.slot, pattern: backup.pattern }])
  state.slot = backup.slot
  notify(`BACKUP LOADED INTO ${slotLabel(backup.slot)}`)
}

const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
</script>

<template>
  <div class="overlay" role="dialog" aria-modal="true" aria-label="TD-3 over USB" @click.self="emit('close')">
    <div class="sheet">
      <div class="sheet-head">
        <div>
          <h2>TD-3 over USB</h2>
          <p class="sub">Play the real synth from the editor and move patterns in and out of its memory.</p>
        </div>
        <button type="button" class="close" aria-label="Close" @click="emit('close')">×</button>
      </div>

      <p v-if="!device.supported" class="msg error">
        This browser has no Web MIDI. Use Chrome or Edge on desktop to connect the TD-3.
      </p>

      <template v-else>
        <!-- connection -->
        <section>
          <h3>Connection</h3>
          <div v-if="device.status !== 'ready'" class="row">
            <button type="button" class="primary" :disabled="device.status === 'connecting'" @click="connect">
              {{ device.status === 'connecting' ? 'Connecting…' : 'Connect MIDI' }}
            </button>
            <span class="dim">Connect the TD-3 with USB first. The browser will ask for MIDI permission.</span>
          </div>
          <p v-if="device.error" class="msg error">{{ device.error }}</p>

          <div v-if="device.status === 'ready'" class="grid">
            <label>
              <span>MIDI out</span>
              <select :value="device.outputId" @change="selectPorts({ outputId: $event.target.value })">
                <option v-if="!device.outputs.length" :value="null">No outputs</option>
                <option v-else-if="!device.outputId" :value="null" disabled>Choose a port</option>
                <option v-for="p in device.outputs" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </label>
            <label>
              <span>MIDI in</span>
              <select :value="device.inputId" @change="selectPorts({ inputId: $event.target.value })">
                <option v-if="!device.inputs.length" :value="null">No inputs</option>
                <option v-else-if="!device.inputId" :value="null" disabled>Choose a port</option>
                <option v-for="p in device.inputs" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </label>
            <label title="The TD-3's MIDI IN channel: the app sends notes on this channel">
              <span>Send ch (TD-3 in)</span>
              <select v-model.number="device.channel">
                <option v-for="c in 16" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
            <label title="The TD-3's MIDI OUT channel: the channel it sends its own notes on">
              <span>Receive ch (TD-3 out)</span>
              <select v-model.number="device.receiveChannel">
                <option v-for="c in 16" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
            <p v-if="device.config && device.config.inChannel" class="cfg dim">
              Read from the device: MIDI in ch {{ device.config.inChannel }}, MIDI out ch {{ device.config.outChannel }}<template
                v-if="device.config.accentThreshold !== null"
              >, accent above velocity {{ device.config.accentThreshold }}</template>.
              <button type="button" class="link" @click="readConfig">Read again</button>
            </p>
            <div class="status">
              <span :class="['led', sysexOk ? 'ok' : 'warn']" aria-hidden="true"></span>
              <span v-if="sysexOk">Connected: {{ device.product }} · firmware {{ device.firmware || '?' }}</span>
              <span v-else-if="!device.outputId" class="dim">No TD-3 found: connect it with USB and switch it on</span>
              <span v-else-if="device.lost" class="dim"
                >The TD-3 stopped answering: unplugged or switched off? Live play is paused until it answers again.
                Firefox does not notice a reconnected device: restart Firefox (Cmd+Q) after plugging it back in.</span
              >
              <span v-else class="dim">No SysEx reply: live play may work, receive/send won't</span>
              <button type="button" class="link" @click="identify">Retry</button>
            </div>
          </div>
        </section>

        <!-- live notes -->
        <section :class="{ off: device.status !== 'ready' }">
          <h3>Live play</h3>
          <label class="check">
            <input v-model="device.liveOut" type="checkbox" :disabled="device.status !== 'ready'" />
            Play the sequencer and note previews on the TD-3 (accent = velocity 127, slide = overlapping notes)
          </label>
          <label class="check">
            <input v-model="device.muteLocal" type="checkbox" />
            Mute the browser sound while playing the TD-3
          </label>
          <label class="check">
            <input v-model="device.linkCutoff" type="checkbox" :disabled="device.status !== 'ready'" />
            Link the CUT OFF FREQ knob to the TD-3 (sends CC 74, one way: the device's knobs send nothing back)
          </label>
          <label class="check">
            <input v-model="device.linkTuning" type="checkbox" :disabled="device.status !== 'ready'" />
            Link the TUNING knob to the TD-3 as pitch bend (device range ±{{ bendRange() }} semitones<template
              v-if="!device.config?.bendRange"
            >, assumed</template>; the knob goes to ±12, beyond the range the bend stays at its maximum)
          </label>
          <p class="dim small">
            Leave the TD-3's own sequencer stopped. Pitches are sent with key C = MIDI note C2 (36). If accents don't
            sound, lower the accent velocity threshold in SynthTribe.
          </p>
        </section>

        <!-- pattern memory -->
        <section :class="{ off: !sysexOk }">
          <h3>Pattern memory <span class="slot">{{ label }}</span></h3>
          <div class="row">
            <button type="button" :disabled="!sysexOk || Boolean(device.busy)" @click="receiveSlot">Receive {{ label }}</button>
            <button type="button" :disabled="!sysexOk || Boolean(device.busy)" @click="receiveBank">Receive all 64</button>
            <span class="spacer"></span>
            <template v-if="!confirmSend">
              <button
                type="button"
                class="danger"
                :disabled="!sysexOk || Boolean(device.busy) || isEmptyPattern(pattern)"
                @click="confirmSend = true"
              >
                Send to {{ label }}…
              </button>
            </template>
            <template v-else>
              <span class="warn-text">Overwrite {{ label }} on the TD-3?</span>
              <button type="button" class="danger" @click="send">Yes, write</button>
              <button type="button" @click="confirmSend = false">Cancel</button>
            </template>
          </div>
          <p class="dim small">
            Slots match the editor: group I–IV, section A/B, pattern 1–8. Before writing, the current content of that
            slot is read and kept as a backup; after writing it is read back to check.
          </p>
          <p v-if="device.busy" class="msg">{{ device.busy }}…</p>
          <p v-if="result" :class="['msg', result.kind]">{{ result.text }}</p>
        </section>

        <!-- monitor -->
        <section :class="{ off: device.status !== 'ready' }">
          <h3>MIDI monitor &amp; CC test</h3>
          <label class="check">
            <input v-model="device.monitorOn" type="checkbox" :disabled="device.status !== 'ready'" />
            Show what the TD-3 sends (notes, controllers, start/stop; clock is hidden)
          </label>
          <div class="cc-test">
            <span class="dim">Send CC</span>
            <input v-model.number="ccNumber" type="number" min="0" max="127" aria-label="Controller number" />
            <input
              v-model.number="ccValue"
              type="range"
              min="0"
              max="127"
              aria-label="Controller value"
              :disabled="device.status !== 'ready'"
              @input="sendTestCC"
            />
            <code>{{ ccValue }}</code>
          </div>
          <ul v-if="device.monitorOn" class="monitor">
            <li v-if="!device.monitor.length" class="dim">Nothing received yet. Turn a knob or play a key on the TD-3.</li>
            <li v-for="m in device.monitor" :key="m.at + m.hex">
              <span>{{ m.text }}</span>
              <code>{{ m.hex }}</code>
            </li>
          </ul>
        </section>

        <!-- backups -->
        <section v-if="device.backups.length">
          <h3>Backups from the device</h3>
          <ul class="backups">
            <li v-for="b in device.backups" :key="b.at + b.slot">
              <span class="slot">{{ slotLabel(b.slot) }}</span>
              <span class="dim">{{ when(b.at) }}</span>
              <button type="button" class="link" @click="loadBackup(b)">Load into editor</button>
            </li>
          </ul>
        </section>
      </template>
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
  width: min(760px, 100%);
  max-height: calc(100vh - 32px);
  overflow: auto;
  padding: 20px 24px 18px;
  border-radius: 10px;
  background: #1c1c1d;
  border: 1px solid #000;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
  color: var(--print);
}

.sheet-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 2px solid var(--accent);
}

h2 {
  margin: 0;
  font-family: var(--font-panel);
  font-style: italic;
  font-weight: 800;
  font-size: 24px;
  text-transform: uppercase;
  color: var(--accent);
}

h3 {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0 0 10px;
  font-family: var(--font-panel);
  font-weight: 800;
  font-size: 14px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent);
}

.sub {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--print-dim);
}

section {
  padding: 14px 0;
  border-bottom: 1px solid var(--print-line);
}

section:last-child {
  border-bottom: 0;
}

section.off {
  opacity: 0.55;
}

.close {
  flex: none;
  width: 32px;
  height: 32px;
  border: 2px solid var(--print-dim);
  border-radius: 50%;
  background: none;
  color: var(--print);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.spacer {
  flex: 1;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr 110px 120px;
  gap: 10px 12px;
}

.cfg {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 12px;
}

.cc-test {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 12px;
}

.cc-test input[type='number'] {
  width: 56px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid #000;
  border-radius: 3px;
  background: #0d0b08;
  color: #ffb020;
  font-family: var(--font-display);
}

.cc-test input[type='range'] {
  flex: 1;
  accent-color: var(--accent);
}

.cc-test code {
  width: 28px;
  font-family: var(--font-display);
  color: #ffb020;
}

.monitor {
  list-style: none;
  margin: 8px 0 0;
  padding: 6px 8px;
  max-height: 160px;
  overflow: auto;
  border-radius: 4px;
  background: #0d0b08;
  font-family: var(--font-display);
  font-size: 12px;
  color: #ffb020;
}

.monitor li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 1px 0;
}

.monitor code {
  color: var(--print-dim);
  font-family: inherit;
}

.grid label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--print-dim);
}

.status {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

select {
  height: 28px;
  padding: 0 6px;
  border: 1px solid #000;
  border-radius: 3px;
  background: #0d0b08;
  color: #ffb020;
  font-family: var(--font-display);
  font-size: 13px;
}

.check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 13px;
  cursor: pointer;
}

.check input {
  margin-top: 2px;
}

button {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #000;
  border-radius: 4px;
  background: linear-gradient(180deg, #3a3a3c, #262628);
  color: var(--print);
  font-family: var(--font-panel);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  cursor: pointer;
}

button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

button.primary {
  background: var(--accent);
  color: var(--accent-ink);
}

button.danger {
  background: linear-gradient(180deg, #e2402f, #a51f16);
  color: #fff3ea;
}

button.link {
  height: auto;
  padding: 0;
  border: 0;
  background: none;
  color: var(--print);
  text-decoration: underline;
  text-transform: none;
  letter-spacing: 0;
  font-family: inherit;
  font-weight: 400;
  font-size: 13px;
}

button:focus-visible,
select:focus-visible,
input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.slot {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 14px;
  letter-spacing: 0;
  color: #ffb020;
}

.dim {
  color: var(--print-dim);
}

.small {
  margin: 8px 0 0;
  font-size: 12px;
}

.warn-text {
  font-size: 13px;
  color: #ffb020;
}

.msg {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 4px;
  background: #121213;
  font-size: 13px;
}

.msg.ok {
  color: #9be37a;
}

.msg.warn {
  color: #ffb020;
}

.msg.error {
  color: #ff7a66;
}

.backups {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

.backups li {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 13px;
}

@media (max-width: 620px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
