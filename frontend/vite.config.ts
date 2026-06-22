import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config tuned for Tauri: a fixed dev port the Rust side points at, no
// screen-clearing so Rust/Vite logs interleave, and HMR over the same port.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Don't watch the Rust backend from the frontend dev server.
      ignored: ['**/src-tauri/**'],
    },
  },
});
