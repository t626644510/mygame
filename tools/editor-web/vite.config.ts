import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

export default defineConfig({
  plugins: [react(), {
    name: 'noto-font-notices',
    apply: 'build',
    generateBundle() {
      for (const name of ['OFL.txt', 'SOURCE.txt']) this.emitFile({type: 'asset', fileName: `assets/NotoSansCJKsc-${name}`, source: readFileSync(new URL(`../../Game/Assets/Prototype/Art/Fonts/${name}`, import.meta.url))})
    },
  }],
  server: {
    port: 5175,
    strictPort: true,
    // Reuse the tracked, licensed font without exposing its surrounding folders.
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../../Game/Assets/Prototype/Art/Fonts/NotoSansCJKsc-Regular.otf', import.meta.url))] },
    proxy: { '/api': { target: process.env.SIM_API_URL || 'http://127.0.0.1:5185', changeOrigin: false } },
  },
  preview: { port: 4175, strictPort: true },
})
