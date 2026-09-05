import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],

  // Relative asset paths, so one build runs unchanged from a GitHub Pages
  // project subpath, a custom domain, a plain static host, or a folder opened
  // straight off disk. With hash routing, that leaves no deployment
  // configuration to get wrong.
  base: './',

  build: {
    outDir: 'dist',
    sourcemap: true,
  },

  server: {
    port: 5173,
  },
})
