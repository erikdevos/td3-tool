import { parsePattern } from './pattern.js'

// Built-in pattern library: original patterns written in the style of classic acid
// genres. They are NOT transcriptions of existing tracks (those are copyrighted).
//
// Pattern text format (see parsePattern in pattern.js):
//   "C" note, "D#+" up an octave, "G-" down, "C'" high C, suffix "a" accent / "s" slide,
//   "-" tie (hold previous note), "." rest. Number of tokens = pattern length.
//
// `sound` refers to a factory preset name in patch.js.

const RAW = [
  { name: 'Chicago Jack', style: 'Chicago acid', bpm: 122, sound: 'CHICAGO SQUELCH',
    text: 'C- . C- Cas D#a - C . G- . C- C+s Ca . A#- C' },
  { name: 'Lazy Sunday', style: 'Chicago acid', bpm: 105, sound: 'WARM ROUND',
    text: 'F- . A- C - . F- G-s A-a - . C D- . F-s C' },
  { name: 'Octave Bounce', style: 'Acid house', bpm: 125, sound: 'SQUELCH',
    text: 'C-a C C- C+s C- C C-a . C- C+ C-s C C-a C+ C- D#' },
  { name: 'Squelch Slide', style: 'Acid house', bpm: 124, sound: 'CHICAGO SQUELCH',
    text: 'Cs D#s Fs G A#a . G-s Gs C+a - . D#s Fs Ga . C' },
  { name: 'Rolling 16ths', style: 'Acid techno', bpm: 135, sound: 'ROLLING TECHNO',
    text: 'Ca C C+ C Cs D# C Ca C C G- C Ca C+ C A#-s' },
  { name: 'Accent Ladder', style: 'Acid techno', bpm: 130, sound: 'ACCENT MONSTER',
    text: 'Ca C Ca C C Ca C C Ca C C C C+a C C C' },
  { name: 'Hypnotic Minimal', style: 'Minimal', bpm: 128, sound: 'THIN AND NASAL',
    text: 'Ca . C . C . Cs C . C Ca . C . C+s C' },
  { name: 'Detroit Minor', style: 'Detroit', bpm: 128, sound: 'HOLLOW SQUARE',
    text: 'A- . C D#a - C . A- G-s A- . C Ea D# C .' },
  { name: 'Minor Arp', style: 'Acid trance', bpm: 138, sound: 'PLUCKY ARP',
    text: 'C D# G C+ G D# C D#+a C D# G C+s D#+ C+ G D#a' },
  { name: 'Phrygian Goa', style: 'Goa / psy', bpm: 145, sound: 'PSY BASS',
    text: '. E Fa E . G E F#s . E A#a E . F E Es' },
  { name: 'Psy Roller', style: 'Goa / psy', bpm: 145, sound: 'PSY BASS',
    text: '. E Ea E . E E Ea . E E E . Ea G E' },
  { name: 'Acid Breaks', style: 'Breakbeat', bpm: 132, sound: 'SCREAMER',
    text: 'Ca . . C D#s F . Ca G- . C+a . A#- C . Fs' },
  { name: 'Rave Stabs', style: 'Hardcore', bpm: 140, sound: 'SCREAMER',
    text: "Ca C+ Ca C+ D#a D#+ Fa F+ Ga G+ A#a A#+ C'a C Ca C+" },
  { name: 'Electro Funk', style: 'Electro', bpm: 118, sound: 'DIRTY ELECTRO',
    text: 'C- . C- . D#-a . F- F-s G- . . A#- C Ca . G-' },
  { name: 'Dub Acid', style: 'Dub', bpm: 110, sound: 'DUB DRONE',
    text: 'C- - - . G- - D#-s F- - . . C - A#-s C .' },
  { name: 'Drone Wobble', style: 'Experimental', bpm: 100, sound: 'ACID WOBBLE',
    text: 'C-as - - - C+s - - - C-as - - - G-s - - -' },
  { name: 'Glide Melody', style: 'Experimental', bpm: 116, sound: 'GLIDE LEAD',
    text: 'Cs D#s G - Fs D# . C G-s A#- C - D#s Fs G .' },
  { name: 'Odd Loop 7', style: 'Polymeter', bpm: 126, sound: 'RUBBER BASS',
    text: 'Ca C+s D# C . G-a C' },
  { name: 'Sub Pulse', style: 'Deep', bpm: 120, sound: 'DEEP SUB',
    text: 'C- . . C- . . C- . C- . . C- . G- A#-s C-' }
]

export const LIBRARY = RAW.map((entry) => ({ ...entry, pattern: parsePattern(entry.text) }))

export const LIBRARY_STYLES = [...new Set(LIBRARY.map((e) => e.style))]
