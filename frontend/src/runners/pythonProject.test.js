import { describe, it, expect, vi } from 'vitest'
import { MAX_PROJECT_CHARS, MAX_PROJECT_FILES, collectPythonFiles, isPythonPath } from './pythonProject'

describe('collectPythonFiles', () => {
  const read = vi.fn(async (path) => ({ 'todo.py': 'saved todo', 'pkg/util.py': 'u = 1', 'broken.py': null })[path])

  it('includes the running file with its editor text, and the other .py files', async () => {
    const files = await collectPythonFiles(['test_todo.py', 'todo.py', 'pkg/util.py', 'README.md', 'broken.py'], read, 'test_todo.py', 'import todo')
    expect(files).toEqual([
      { path: 'test_todo.py', content: 'import todo' },
      { path: 'todo.py', content: 'saved todo' },
      { path: 'pkg/util.py', content: 'u = 1' },
    ])
    expect(read).not.toHaveBeenCalledWith('README.md')
  })

  it('runs the file on its own when it is the only Python file', async () => {
    expect(await collectPythonFiles(['main.py', 'a.js'], read, 'main.py', 'x')).toEqual([])
  })

  it('leaves out files that fail to load', async () => {
    const failing = async (path) => {
      if (path === 'a.py') throw new Error('network')
      return 'b = 1'
    }
    expect(await collectPythonFiles(['main.py', 'a.py', 'b.py'], failing, 'main.py', 'x')).toEqual([
      { path: 'main.py', content: 'x' },
      { path: 'b.py', content: 'b = 1' },
    ])
  })

  it('gives up on projects that are too big, and the file runs alone', async () => {
    const many = Array.from({ length: MAX_PROJECT_FILES + 1 }, (_, i) => `f${i}.py`)
    expect(await collectPythonFiles(many, async () => 'x', 'f0.py', 'x')).toEqual([])
    expect(await collectPythonFiles(['a.py', 'b.py'], async () => 'x'.repeat(MAX_PROJECT_CHARS), 'a.py', 'x')).toEqual([])
  })

  it('isPythonPath', () => {
    expect(isPythonPath('a/B.PY')).toBe(true)
    expect(isPythonPath('a.pyc')).toBe(false)
  })
})
