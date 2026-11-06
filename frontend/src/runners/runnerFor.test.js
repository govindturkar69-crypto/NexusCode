import { describe, it, expect } from 'vitest'
import { runnerFor, UNSUPPORTED_MESSAGE } from './runnerFor'

describe('runnerFor', () => {
  it.each([
    ['a.js', 'javascript'],
    ['a.mjs', 'javascript'],
    ['a.cjs', 'javascript'],
    ['src/deep/a.js', 'javascript'],
    ['A.JS', 'javascript'],
    ['a.py', 'python'],
    ['a.PY', 'python'],
    ['a.html', 'preview'],
    ['a.htm', 'preview'],
    ['my.file.py', 'python'],
  ])('%s runs as %s', (path, runner) => {
    expect(runnerFor(path)).toBe(runner)
  })

  it.each(['a.java', 'a.cpp', 'a.ts', 'a.jsx', 'a.md', 'a.json', 'README', '.gitignore', '.py', 'js', 'dir.py/file', 'a.css'])('%s has no runner', (path) => {
    expect(runnerFor(path)).toBeNull()
  })

  it('a stylesheet previews only if the project has a page', () => {
    expect(runnerFor('a.css', { hasHtml: true })).toBe('preview')
    expect(runnerFor('a.css', { hasHtml: false })).toBeNull()
  })

  it('html in the project does not change other files', () => {
    expect(runnerFor('a.md', { hasHtml: true })).toBeNull()
    expect(runnerFor('a.js', { hasHtml: true })).toBe('javascript')
  })

  it('has a friendly message that names what does work', () => {
    expect(UNSUPPORTED_MESSAGE).toMatch(/Python.*JavaScript.*web pages/)
  })
})
