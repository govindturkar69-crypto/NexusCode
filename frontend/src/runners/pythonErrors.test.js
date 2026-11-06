import { describe, it, expect } from 'vitest'
import { cleanTraceback, describePythonError, exitWasClean, moduleNotAvailable } from './pythonErrors'

const INTERNAL = `Traceback (most recent call last):
  File "/lib/python314.zip/_pyodide/_base.py", line 597, in eval_code_async
    await CodeRunner(
    ^^^^^^^^^^^^^^^^^
  File "/lib/python314.zip/_pyodide/_base.py", line 411, in run_async
    coroutine = eval(self.code, globals, locals)
  File "err.py", line 3, in <module>
    f()
  File "err.py", line 2, in f
    return 1 / 0
ZeroDivisionError: division by zero
`

describe('cleanTraceback', () => {
  it('keeps the user\'s frames and drops Pyodide\'s', () => {
    expect(cleanTraceback(INTERNAL)).toBe(`Traceback (most recent call last):
  File "err.py", line 3, in <module>
    f()
  File "err.py", line 2, in f
    return 1 / 0
ZeroDivisionError: division by zero`)
  })

  it('drops the header when no frames are left', () => {
    const text = `Traceback (most recent call last):
  File "/lib/python314.zip/_pyodide/_base.py", line 1, in x
    y
SyntaxError: invalid syntax`
    expect(cleanTraceback(text)).toBe('SyntaxError: invalid syntax')
  })

  it('leaves other text alone', () => {
    expect(cleanTraceback('plain message')).toBe('plain message')
  })
})

describe('describePythonError', () => {
  it('passes ordinary errors through, cleaned', () => {
    const text = describePythonError({ type: 'ZeroDivisionError', message: INTERNAL })
    expect(text).toContain('ZeroDivisionError: division by zero')
    expect(text).not.toContain('_pyodide')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('explains a missing third-party module', () => {
    const text = describePythonError({
      type: 'ModuleNotFoundError',
      message: 'Traceback (most recent call last):\n  File "bad.py", line 1, in <module>\n    import numpy\nModuleNotFoundError: No module named \'numpy\'',
    })
    expect(text).toContain("The module 'numpy' isn't available here")
    expect(text).toContain('File "bad.py", line 1')
    expect(text).not.toContain("No module named")
  })

  it('explains a module Pyodide ships separately, without its install advice', () => {
    const text = describePythonError({
      type: 'ModuleNotFoundError',
      message: 'ModuleNotFoundError: The module \'numpy\' is included in the Pyodide distribution, but it is not installed.\nYou can install it by calling:\n  await micropip.install("numpy") in Python, or\nSee https://pyodide.org/en/stable/usage/loading-packages.html for more details.',
    })
    expect(text).toContain("The module 'numpy' isn't available here")
    expect(text).not.toContain('https://')
    expect(text).not.toContain('micropip')
    expect(text).not.toContain('You can install')
  })

  it('does not treat other import errors as a missing module', () => {
    const text = describePythonError({ type: 'ImportError', message: 'ImportError: cannot import name x from y' })
    expect(text).toContain('cannot import name x')
    expect(text).not.toContain("isn't available")
  })

  it('explains running out of input', () => {
    const text = describePythonError({ type: 'EOFError', message: 'EOFError: EOF when reading a line' })
    expect(text).toContain('EOF when reading a line')
    expect(text).toContain('Input box')
  })

  it('copes with a missing message', () => {
    expect(describePythonError({ type: 'Error' })).toBe('\n')
  })
})

describe('moduleNotAvailable', () => {
  it('names the module', () => {
    expect(moduleNotAvailable('requests')).toContain("'requests'")
  })
})

describe('exitWasClean', () => {
  it.each([
    ['SystemExit', true],
    ['SystemExit: 0', true],
    ['SystemExit: None', true],
    ['Traceback...\nSystemExit: 0\n', true],
    ['SystemExit: 1', false],
    ['SystemExit: something went wrong', false],
  ])('%j gives %s', (message, clean) => {
    expect(exitWasClean(message)).toBe(clean)
  })
})
