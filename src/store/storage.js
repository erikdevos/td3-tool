import { FACTORY_VERSION, factoryPresets, normalizePatch } from '../model/patch.js'
import {
  BANK_SIZE,
  demoPatterns,
  makePattern,
  makeStep,
  normalizePattern
} from '../model/pattern.js'

export const KEYS = {
  bank: 'td3mo.bank.v2',
  presets: 'td3mo.presets.v2',
  session: 'td3mo.session.v2',
  device: 'td3mo.device.v1',
  ui: 'td3mo.ui.v1'
}

// Keys used by the first prototype; migrated once if present.
const LEGACY = {
  patches: 'td3-patches-v1',
  sequences: 'td3-sequences-v1'
}

export const FILE_FORMAT = 'td3mo-editor'
export const FILE_VERSION = 2

export const read = (key) => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch (error) {
    console.warn(`Unable to read ${key} from localStorage`, error)
    return null
  }
}

export const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.warn(`Unable to write ${key} to localStorage`, error)
  }
}

export const normalizeBank = (raw) =>
  Array.from({ length: BANK_SIZE }, (_, i) => (Array.isArray(raw) && raw[i] ? normalizePattern(raw[i]) : makePattern()))

export const normalizePresets = (raw) => {
  if (!Array.isArray(raw)) return null
  const presets = raw
    .filter((p) => p && typeof p.name === 'string')
    .map((p) => ({ name: p.name.slice(0, 16).toUpperCase(), params: normalizePatch(p.params) }))
  return presets.length ? presets : null
}

// ---- legacy v1 migration -------------------------------------------------

const migrateLegacyPatch = (data) =>
  normalizePatch({
    tuning: data.tune / 100,
    cutoff: data.cutoff / 100,
    resonance: data.resonance / 100,
    envMod: data.envelope / 100,
    accent: data.accent / 100,
    softAttack: data.softAttack / 100,
    slideTime: data.slideTime / 100,
    filterFm: data.filterFm / 100,
    overdrive: data.overdrive / 100,
    volume: data.volume / 100,
    waveform: data.waveform === 'square' ? 1 : 0
  })

const migrateLegacySequence = (data) => {
  const pattern = makePattern()
  if (!Array.isArray(data)) return pattern
  data.slice(0, 16).forEach((step, i) => {
    if (!step || step.note === null || step.note === undefined) return
    pattern.steps[i] = makeStep({
      note: Math.min(11, Math.max(0, step.note)),
      accent: Boolean(step.accent),
      slide: Boolean(step.slide),
      time: 'note'
    })
  })
  return pattern
}

// ---- load everything ----------------------------------------------------------

export const loadAll = () => {
  let bank = read(KEYS.bank)
  let presets = normalizePresets(read(KEYS.presets))
  const session = read(KEYS.session) || {}

  if (!bank) {
    bank = normalizeBank(null)
    demoPatterns().forEach((pattern, i) => {
      bank[i] = pattern
    })
    const legacy = read(LEGACY.sequences)
    if (Array.isArray(legacy)) {
      // put old sequences in group I, section B
      legacy.slice(0, 8).forEach((item, i) => {
        bank[8 + i] = migrateLegacySequence(item?.data)
      })
    }
  } else {
    bank = normalizeBank(bank)
  }

  if (!presets) {
    presets = factoryPresets()
    const legacy = read(LEGACY.patches)
    if (Array.isArray(legacy)) {
      legacy.forEach((item) => {
        if (item?.data && typeof item.name === 'string') {
          presets.push({ name: item.name.slice(0, 16).toUpperCase(), params: migrateLegacyPatch(item.data) })
        }
      })
    }
  } else if ((session.factoryVersion || 1) < FACTORY_VERSION) {
    // add factory presets introduced since the user's last visit (keeps their own)
    const names = new Set(presets.map((p) => p.name))
    factoryPresets().forEach((p) => {
      if (!names.has(p.name)) presets.push(p)
    })
  }

  return { bank, presets, session }
}

// ---- file import / export ----------------------------------------------------

export const exportFile = ({ bank, presets, session }) => {
  const payload = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    exportedAt: new Date().toISOString(),
    bank,
    presets,
    session
  }
  const stamp = new Date().toISOString().slice(0, 10)
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `td3mo-bank-${stamp}.json`)
}

export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const parseImportFile = async (file) => {
  const text = await file.text()
  const data = JSON.parse(text)
  if (!data || data.format !== FILE_FORMAT) {
    throw new Error('This is not a TD-3-MO editor file.')
  }
  return {
    bank: normalizeBank(data.bank),
    presets: normalizePresets(data.presets),
    session: data.session && typeof data.session === 'object' ? data.session : null
  }
}
