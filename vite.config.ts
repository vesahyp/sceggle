import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Rapier ships as WebAssembly; Vite needs it excluded from dep pre-bundling
// so the .wasm loads correctly in dev.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
