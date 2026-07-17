import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Rapier ships as WebAssembly; Vite needs it excluded from dep pre-bundling
// so the .wasm loads correctly in dev.
//
// `base` is '/sceggle/' for production builds because GitHub Pages serves a
// project site under https://<user>.github.io/<repo>/. Dev stays at '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/sceggle/' : '/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
}));
