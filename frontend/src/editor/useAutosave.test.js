import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAutosave } from './useAutosave'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useAutosave', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('debounces: one save after the user stops typing', async () => {
    const save = vi.fn(() => Promise.resolve())
    const { result } = renderHook(() => useAutosave(save, { delay: 1000 }))
    act(() => { result.current.schedule('a') })
    act(() => { result.current.schedule('ab') })
    expect(result.current.status).toBe('unsaved')
    await act(async () => { await vi.advanceTimersByTimeAsync(999) })
    expect(save).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0]).toBe('ab')
    expect(result.current.status).toBe('saved')
  })

  it('a newer save aborts the stale one and only starts after it settles', async () => {
    const first = deferred()
    const calls = []
    const save = vi.fn((value, { signal }) => {
      calls.push({ value, signal })
      if (value === 'v1') {
        signal.addEventListener('abort', () => first.reject(new DOMException('aborted', 'AbortError')))
        return first.promise
      }
      return Promise.resolve()
    })
    const { result } = renderHook(() => useAutosave(save))
    act(() => { result.current.schedule('v1') })
    await act(async () => { result.current.flush() })
    expect(calls).toHaveLength(1)
    act(() => { result.current.schedule('v2') })
    await act(async () => { await result.current.flush() })
    expect(calls[0].signal.aborted).toBe(true)
    expect(calls.map((c) => c.value)).toEqual(['v1', 'v2'])
    expect(result.current.status).toBe('saved')
  })

  it('a failed save reports the error and is retried by the next flush', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('Server down'))
      .mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useAutosave(save))
    act(() => { result.current.schedule('code') })
    await act(async () => { await result.current.flush() })
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('Server down')
    await act(async () => { await result.current.flush() })
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0]).toBe('code')
    expect(result.current.status).toBe('saved')
  })

  it('flushes pending changes with keepalive on unmount', () => {
    const save = vi.fn(() => Promise.resolve())
    const { result, unmount } = renderHook(() => useAutosave(save))
    act(() => { result.current.schedule('unsaved work') })
    unmount()
    expect(save).toHaveBeenCalledWith('unsaved work', { keepalive: true })
  })

  it('does nothing on unmount when everything is saved', async () => {
    const save = vi.fn(() => Promise.resolve())
    const { result, unmount } = renderHook(() => useAutosave(save))
    act(() => { result.current.schedule('x') })
    await act(async () => { await result.current.flush() })
    unmount()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('warns before the tab closes with unsaved changes, and saves them', () => {
    const save = vi.fn(() => Promise.resolve())
    const { result } = renderHook(() => useAutosave(save))
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    act(() => { result.current.schedule('draft') })
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
    expect(save).toHaveBeenCalledWith('draft', { keepalive: true })
  })
})
