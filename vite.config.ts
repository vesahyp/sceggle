import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { versionName } from './src/versionName.js';

// The build id is the commit, or the time when there is no git (CI always
// has git). It is baked into the bundle and written to version.json so the
// running app can notice a newer deploy (src/version.ts).
function buildId(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || String(Date.now());
  } catch {
    return String(Date.now());
  }
}

function versionFile(id: string): Plugin {
  return {
    name: 'hoyry-version-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: id, name: versionName(id) }) });
    },
  };
}

// GitHub Pages serves a project site under https://<user>.github.io/hoyry/,
// so production builds and `vite preview` use that base. Dev stays at '/'.
// `--mode portal` is the build for itch.io and Newgrounds: relative paths,
// because each portal serves the zip from its own folder.
export default defineConfig(({ command, isPreview, mode }) => {
  const id = buildId();
  return {
    base: mode === 'portal' ? './' : command === 'build' || isPreview ? '/hoyry/' : '/',
    plugins: [react(), versionFile(id)],
    define: { __BUILD__: JSON.stringify(id) },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [{ name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }],
          },
        },
      },
    },
  };
});
