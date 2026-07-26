import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` is '/sceggle/' for production builds because GitHub Pages serves a
// project site under https://<user>.github.io/<repo>/. Dev stays at '/'.
//
// `isPreview` matters: `vite preview` runs with command === 'serve', so keying
// base off command alone served the built index.html (which has /sceggle/ paths
// baked in) from base '/'. Asset URLs then missed the static dir and fell
// through to the SPA fallback — normal requests got index.html with
// content-type text/html, and module scripts got a bare 404 because vite
// rightly refuses to hand HTML to a <script>. Net effect was a blank page that
// looked like a broken build.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/sceggle/' : '/',
  plugins: [react()],
  build: {
    // Split the vendor libraries out of the app chunk. This does NOT shrink the
    // payload — everything here is needed before the first frame, so there is
    // nothing worth lazy-loading. It buys cache stability: game code changes
    // every commit, whereas three/react change a few times a year, so splitting
    // them keeps most of the bytes valid across a redeploy.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/](three|three-stdlib|@react-three)[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
    // The three chunk is irreducibly ~1010kB (three + drei helpers incl. the
    // troika text renderer for damage numbers), so the stock 500kB warning
    // fires on every build and trains you to ignore it. Set the limit just
    // above the known floor: quiet at rest, but still shouts if something
    // new bloats.
    chunkSizeWarningLimit: 1100,
  },
}));
