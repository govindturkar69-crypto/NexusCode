import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// monaco-editor ships its own copy of DOMPurify inside its source
// (vs/base/browser/dompurify/dompurify.js, currently 3.4.15), so an npm
// "overrides" pin alone never reaches it. This swaps that file for the
// dompurify package (pinned via overrides in package.json). Both default-
// export the same DOMPurify instance API.
// Applies to production builds; the dev server's dependency pre-bundling
// still uses Monaco's copy.
function monacoUsesNpmDompurify() {
  return {
    name: 'monaco-uses-npm-dompurify',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (
        source === './dompurify/dompurify.js' &&
        importer &&
        /monaco-editor[\\/]esm[\\/]vs[\\/]base[\\/]browser[\\/]domSanitize\.js$/.test(importer)
      ) {
        return this.resolve('dompurify', importer, { skipSelf: true })
      }
      return null
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), monacoUsesNpmDompurify()],
  build: {
    // Monaco's core is one large lazy chunk loaded only by the editor page
    chunkSizeWarningLimit: 4000,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    // Fixed API URL so tests don't depend on a local .env
    env: { VITE_API_URL: 'http://api.test' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/test/**', 'src/**/*.test.{js,jsx}', 'src/main.jsx', 'src/editor/monacoSetup.js'],
    },
  },
})
