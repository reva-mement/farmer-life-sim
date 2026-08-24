import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Project page on GitHub Pages is served from /<repo-name>/, not the root.
  base: '/farmer-life-sim/',
  plugins: [react()],
})
