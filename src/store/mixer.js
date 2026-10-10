import { reactive, watch } from 'vue'
import { meterLevels, setMixer } from '../audio/mixer.js'
import { normalizeMixer } from '../model/mixer.js'
import { KEYS, read, write } from './storage.js'

// Mixer settings (module singleton): saved, and pushed to the audio graph (audio/mixer.js keeps
// them until audio has started).

const mixer = reactive(normalizeMixer(read(KEYS.mixer)))

let saveTimer = null
watch(
  mixer,
  () => {
    setMixer(mixer)
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => write(KEYS.mixer, mixer), 300)
  },
  { deep: true }
)
setMixer(mixer)

export const useMixer = () => ({ mixer, meterLevels })
