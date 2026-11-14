import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Walks the STATIC imports reachable from main.jsx (what lands in the main
// bundle). Lazy routes use import(), which this skips, so heavy libraries must
// only ever be reached through a lazy page.
const HEAVY = [/^yjs$/, /^y-/, /^lib0/, /monaco/, /^recharts/, /livekit/, /^pyodide/, /^@hello-pangea\/dnd/]
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STATIC_IMPORT = /^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm

function resolveLocal(from, spec) {
  const base = resolve(dirname(from), spec)
  for (const candidate of [base, `${base}.js`, `${base}.jsx`, join(base, 'index.js'), join(base, 'index.jsx')]) {
    if (existsSync(candidate) && !candidate.endsWith('/') && /\.(jsx?|css)$/.test(candidate)) return candidate
  }
  return null
}

function mainGraph() {
  const seen = new Set()
  const packages = new Map() // package -> first importer
  const queue = [join(SRC, 'main.jsx')]
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file) || file.endsWith('.css')) continue
    seen.add(file)
    for (const match of readFileSync(file, 'utf-8').matchAll(STATIC_IMPORT)) {
      const spec = match[1] ?? match[2]
      if (spec.startsWith('.')) {
        const next = resolveLocal(file, spec)
        if (next) queue.push(next)
      } else if (!packages.has(spec)) {
        packages.set(spec, file.slice(SRC.length + 1))
      }
    }
  }
  return packages
}

describe('main bundle boundaries', () => {
  it('keeps heavy libraries out of the eagerly loaded code', () => {
    const offenders = [...mainGraph()].filter(([pkg]) => HEAVY.some((re) => re.test(pkg)))
    expect(offenders).toEqual([])
  })
})
