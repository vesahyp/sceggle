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
  build: {
    // Split the vendor libraries out of the app chunk. This does NOT shrink the
    // payload — everything here is needed before the first frame, so there is
    // nothing worth lazy-loading. It buys cache stability: game code changes
    // every commit, whereas rapier/three/react change a few times a year, so
    // splitting them keeps ~95% of the bytes valid across a redeploy.
    //
    // Note rapier alone is ~2.1MB of the output. `rapier3d-compat` embeds its
    // 1.57MB .wasm as a base64 string (+33% over the raw binary) so it loads in
    // any bundler without wasm config. `@react-three/rapier` depends on the
    // compat build specifically, so switching to plain `@dimforge/rapier3d`
    // and serving the .wasm as a real asset isn't available to us here.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'rapier', test: /node_modules[\\/]@dimforge[\\/]/ },
            { name: 'three', test: /node_modules[\\/](three|three-stdlib|@react-three)[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
    // The rapier chunk is irreducibly ~2.1MB, so the stock 500kB warning fires
    // on every build and trains you to ignore it. Set the limit just above the
    // known floor: quiet at rest, but still shouts if something new bloats.
    chunkSizeWarningLimit: 2300,
  },
}));
