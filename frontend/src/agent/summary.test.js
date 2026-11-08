import { describe, it, expect } from 'vitest'
import { describeRunResult, runResults } from './summary'

const run = (path, result) => ({ type: 'tool', call: { name: 'run_file', args: { path } }, result })

describe('run summary', () => {
  it('keeps the last result for each file, and counts runs and failures', () => {
    const results = runResults([
      run('test_todo.py', { status: 'error', stderr: 'AssertionError' }),
      { type: 'tool', call: { name: 'write_file', args: { path: 'todo.py' } }, result: { state: 'staged' } },
      run('test_todo.py', { status: 'ok' }),
      run('Main.java', { status: 'unsupported', message: "can't run" }),
      run('pending.py', null),
    ])
    expect(results).toEqual([
      { path: 'test_todo.py', runs: 2, failures: 1, status: 'ok', message: null },
      { path: 'Main.java', runs: 0, failures: 0, status: 'unsupported', message: "can't run" },
    ])
  })

  it.each([
    [{ status: 'ok', runs: 1, failures: 0 }, 'passed'],
    [{ status: 'ok', runs: 3, failures: 2 }, 'passed on run 3, after 2 failed'],
    [{ status: 'error', runs: 1, failures: 1 }, 'failed'],
    [{ status: 'error', runs: 2, failures: 2 }, 'failed (2 runs)'],
    [{ status: 'timeout', runs: 1, failures: 1 }, 'timed out (10 s limit)'],
    [{ status: 'unsupported', runs: 0, failures: 0 }, "can't run in the browser"],
  ])('describes %o', (result, text) => {
    expect(describeRunResult(result)).toBe(text)
  })
})
