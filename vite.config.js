import vue from '@vitejs/plugin-vue'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineConfig } from 'vite'

// PWA: after the build, write the build time and the list of all files in dist/ into the
// service worker (public/sw.js), so the whole app is cached for offline use. No plugin needed.
const pwaPrecache = () => {
  let outDir = 'dist'
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : [path]
    })
  return {
    name: 'pwa-precache',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const swPath = join(outDir, 'sw.js')
      const files = walk(outDir)
        .map((path) => relative(outDir, path).split('\\').join('/'))
        .filter((path) => path !== 'sw.js' && !path.endsWith('.map'))
      const sw = readFileSync(swPath, 'utf8')
        .replace("'__BUILD_VERSION__'", JSON.stringify(String(Date.now())))
        .replace("'__PRECACHE_LIST__'", JSON.stringify(['./', ...files]))
      writeFileSync(swPath, sw)
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), pwaPrecache()],
  // Relative asset URLs: the build in dist/ works from any sub path, e.g. GitHub Pages
  // at https://<user>.github.io/td3-tool/, without hard-coding the repository name.
  base: './',
})
