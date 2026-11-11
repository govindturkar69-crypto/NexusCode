import { copyFileSync, createReadStream, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const HERE = dirname(fileURLToPath(import.meta.url))
const PYODIDE_DIR = join(HERE, 'node_modules', 'pyodide')
const PYODIDE_VERSION = JSON.parse(readFileSync(join(PYODIDE_DIR, 'package.json'), 'utf-8')).version
// Versioned, so these large files can be cached forever (see vercel.json)
const PYODIDE_BASE = `/pyodide/${PYODIDE_VERSION}/`
const PYODIDE_TYPES = {
  'pyodide.mjs': 'text/javascript',
  'pyodide.asm.mjs': 'text/javascript',
  'pyodide.asm.wasm': 'application/wasm',
  'python_stdlib.zip': 'application/zip',
  'pyodide-lock.json': 'application/json',
}
// What the first Python run downloads, for its progress bar
const PYODIDE_DOWNLOAD_BYTES = ['pyodide.asm.wasm', 'python_stdlib.zip']
  .reduce((total, file) => total + statSync(join(PYODIDE_DIR, file)).size, 0)

// Self-hosts Pyodide, like Monaco: no CDN, and no binaries in git. They're served
// from node_modules in development and copied beside the app at build time. Nothing
// downloads them until someone clicks Run on a Python file.
function selfHostPyodide() {
  let outDir = 'dist'
  return {
    name: 'self-host-pyodide',
    configResolved(config) {
      outDir = config.build.outDir
    },
    configureServer(server) {
      server.middlewares.use(PYODIDE_BASE, (req, res, next) => {
        const file = (req.url ?? '').split('?')[0].replace(/^\//, '')
        if (!PYODIDE_TYPES[file]) return next()
        res.setHeader('Content-Type', PYODIDE_TYPES[file])
        createReadStream(join(PYODIDE_DIR, file)).pipe(res)
      })
    },
    closeBundle() {
      const target = resolve(HERE, outDir, `.${PYODIDE_BASE}`)
      mkdirSync(target, { recursive: true })
      for (const file of Object.keys(PYODIDE_TYPES)) copyFileSync(join(PYODIDE_DIR, file), join(target, file))
    },
  }
}

// `vite preview` sends the same headers as Vercel, so the built app, including the
// agent workers' Content-Security-Policy, can be checked locally. Only the
// patterns vercel.json uses are supported: literal paths and (.*).
function previewWithVercelHeaders() {
  const rules = JSON.parse(readFileSync(join(HERE, 'vercel.json'), 'utf-8')).headers.map(({ source, headers }) => {
    if (/[:?+*]/.test(source.replaceAll('(.*)', ''))) throw new Error(`vercel.json: unsupported source ${source}`)
    const pattern = new RegExp(`^${source.replaceAll('.', '\\.').replaceAll('(\\.*)', '(.*)')}$`)
    return { pattern, headers }
  })
  return {
    name: 'preview-with-vercel-headers',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]
        for (const { pattern, headers } of rules) {
          if (pattern.test(path)) for (const { key, value } of headers) res.setHeader(key, value)
        }
        next()
      })
    },
  }
}

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
  plugins: [react(), monacoUsesNpmDompurify(), selfHostPyodide(), previewWithVercelHeaders()],
  define: {
    __PYODIDE_BASE__: JSON.stringify(PYODIDE_BASE),
    __PYODIDE_DOWNLOAD_BYTES__: PYODIDE_DOWNLOAD_BYTES,
  },
  resolve: {
    alias: [
      // y-monaco imports Monaco's API by its pre-0.50 path. Since 0.50 Monaco's exports
      // map that path elsewhere; this is the same module our Monaco setup loads.
      { find: /^monaco-editor\/esm\/vs\/editor\/editor\.api\.js$/, replacement: 'monaco-editor/editor/editor.api.js' },
    ],
  },
  // The Python worker imports Pyodide at run time, which needs a module worker
  worker: { format: 'es' },
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
      // Workers run in a real browser, so the browser checks cover them
      exclude: ['src/test/**', 'src/**/*.test.{js,jsx}', 'src/main.jsx', 'src/editor/monacoSetup.js', 'src/runners/pythonWorker.js', 'src/runners/agentPythonWorker.js', 'src/runners/agentJsWorker.js'],
    },
  },
})
