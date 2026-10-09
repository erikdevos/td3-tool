import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  // Relative asset URLs: the build in dist/ works from any sub path, e.g. GitHub Pages
  // at https://<user>.github.io/td3-tool/, without hard-coding the repository name.
  base: './',
})
