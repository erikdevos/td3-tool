<template>
  <!-- Shared gradients / filters referenced by the hardware components -->
  <svg width="0" height="0" style="position: absolute" aria-hidden="true" focusable="false">
    <defs>
      <!-- TD-3-MO knob: translucent amber skirt ... -->
      <radialGradient id="knob-skirt" cx="42%" cy="35%" r="72%">
        <stop offset="0%" stop-color="#f7c443" />
        <stop offset="45%" stop-color="#d99a0a" />
        <stop offset="80%" stop-color="#a86f02" />
        <stop offset="100%" stop-color="#6a4400" />
      </radialGradient>
      <!-- ... with a black cap -->
      <radialGradient id="knob-cap" cx="38%" cy="30%" r="80%">
        <stop offset="0%" stop-color="#3a3a3a" />
        <stop offset="55%" stop-color="#1b1b1b" />
        <stop offset="100%" stop-color="#070707" />
      </radialGradient>
      <radialGradient id="knob-shine" cx="34%" cy="24%" r="55%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.22)" />
        <stop offset="50%" stop-color="rgba(255,255,255,0.04)" />
        <stop offset="100%" stop-color="rgba(255,255,255,0)" />
      </radialGradient>
      <filter id="soft-shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="1.8" />
      </filter>
    </defs>
  </svg>
</template>
