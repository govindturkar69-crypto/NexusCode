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
    act(() => { result.current.schedule(1, 'a') })
    act(() => { result.current.schedule(1, 'ab') })
    expect(result.current.state(1).status).toBe('unsaved')
    await act(async () => { await vi.advanceTimersByTimeAsync(999) })
    expect(save).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0].slice(0, 2)).toEqual([1, 'ab'])
    expect(result.current.state(1).status).toBe('saved')
  })

  it('a newer save aborts the stale one and only starts after it settles', async () => {
    const first = deferred()
    const calls = []
    const save = vi.fn((key, value, { signal }) => {
      calls.push({ value, signal })
      if (value === 'v1') {
        signal.addEventListener('abort', () => first.reject(new DOMException('aborted', 'AbortError')))
        return first.promise
      }
      return Promise.resolve()
    })
    const { result } = renderHook(() => useAutosave(save))
    act(() => { result.current.schedule(1, 'v1') })
    await act(async () => { result.current.flush(1) })
    expect(calls).toHaveLength(1)
    act(() => { result.current.schedule(1, 'v2') })
    await act(async () => { await result.current.flush(1) })
    expect(calls[0].signal.aborted).toBe(true)
    expect(calls.map((c) => c.value)).toEqual(['v1', 'v2'])
    expect(result.current.state(1).status).toBe('saved')
  })

  it('a failed save reports the error and is retried by the next flush', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('Server down'))
      .mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useAutosave(save))
    act(() => { result.current.schedule(1, 'code') })
    await act(async () => { await result.current.flush(1) })
    expect(result.current.state(1)).toEqual({ status: 'error', error: 'Server down' })
    await act(async () => { await result.current.flush(1) })
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][1]).toBe('code')
    expect(result.current.state(1).status).toBe('saved')
  })

  it('flushes pending changes with keepalive on unmount', () => {
    const save = vi.fn(() => Promise.resolve())
    const { result, unmount } = renderHook(() => useAutosave(save))
    act(() => { result.current.schedule(1, 'unsaved work') })
    unmount()
    expect(save).toHaveBeenCalledWith(1, 'unsaved work', { keepalive: true })
  })

  it('does nothing on unmount when everything is saved', async () => {
    const save = vi.fn(() => Promise.resolve())
    const { result, unmount } = renderHook(() => useAutosave(save))
    act(() => { result.current.schedule(1, 'x') })
    await act(async () => { await result.current.flush(1) })
    unmount()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('warns before the tab closes with unsaved changes, and saves them', () => {
    const save = vi.fn(() => Promise.resolve())
    const { result } = renderHook(() => useAutosave(save))
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    act(() => { result.current.schedule(1, 'draft') })
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
    expect(save).toHaveBeenCalledWith(1, 'draft', { keepalive: true })
  })

  describe('with several files', () => {
    it('each file has its own timer, value and status', async () => {
      const save = vi.fn(() => Promise.resolve())
      const { result } = renderHook(() => useAutosave(save, { delay: 1000 }))
      act(() => { result.current.schedule(1, 'one') })
      await act(async () => { await vi.advanceTimersByTimeAsync(600) })
      act(() => { result.current.schedule(2, 'two') })
      await act(async () => { await vi.advanceTimersByTimeAsync(400) })
      // File 1's timer isn't reset by typing in file 2
      expect(save.mock.calls.map((c) => c.slice(0, 2))).toEqual([[1, 'one']])
      expect(result.current.state(1).status).toBe('saved')
      expect(result.current.state(2).status).toBe('unsaved')
      await act(async () => { await vi.advanceTimersByTimeAsync(600) })
      expect(save.mock.calls[1].slice(0, 2)).toEqual([2, 'two'])
    })

    it('a save of one file does not abort a save of another', async () => {
      const first = deferred()
      const signals = {}
      const save = vi.fn((key, value, { signal }) => {
        signals[key] = signal
        return key === 1 ? first.promise : Promise.resolve()
      })
      const { result } = renderHook(() => useAutosave(save))
      act(() => { result.current.schedule(1, 'a') })
      await act(async () => { result.current.flush(1) })
      act(() => { result.current.schedule(2, 'b') })
      await act(async () => { await result.current.flush(2) })
      expect(signals[1].aborted).toBe(false)
      expect(result.current.state(1).status).toBe('saving')
      expect(result.current.state(2).status).toBe('saved')
      await act(async () => { first.resolve(); await first.promise })
      expect(result.current.state(1).status).toBe('saved')
    })

    it('a failure in one file leaves the others alone', async () => {
      const save = vi.fn((key) => (key === 1 ? Promise.reject(new Error('Nope')) : Promise.resolve()))
      const { result } = renderHook(() => useAutosave(save))
      act(() => { result.current.schedule(1, 'a'); result.current.schedule(2, 'b') })
      await act(async () => { await result.current.flush(1); await result.current.flush(2) })
      expect(result.current.state(1).status).toBe('error')
      expect(result.current.state(2).status).toBe('saved')
    })

    it('saves every unsaved file on unmount and on closing the tab', () => {
      const save = vi.fn(() => Promise.resolve())
      const { result, unmount } = renderHook(() => useAutosave(save))
      act(() => { result.current.schedule(1, 'a'); result.current.schedule(2, 'b') })
      window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
      expect(save).toHaveBeenCalledWith(1, 'a', { keepalive: true })
      expect(save).toHaveBeenCalledWith(2, 'b', { keepalive: true })
      save.mockClear()
      unmount()
      expect(save).toHaveBeenCalledTimes(2)
    })

    it('forget drops unsaved changes, so a deleted file is not saved', async () => {
      const save = vi.fn(() => Promise.resolve())
      const { result, unmount } = renderHook(() => useAutosave(save, { delay: 1000 }))
      act(() => { result.current.schedule(1, 'a') })
      act(() => { result.current.forget(1) })
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(result.current.state(1).status).toBe('saved')
      unmount()
      expect(save).not.toHaveBeenCalled()
    })

    it('pendingError reports a failure straight after flush, and clears on success', async () => {
      const save = vi.fn()
        .mockRejectedValueOnce(new Error('Server down'))
        .mockResolvedValueOnce(undefined)
      const { result } = renderHook(() => useAutosave(save))
      expect(result.current.pendingError(1)).toBeNull()
      act(() => { result.current.schedule(1, 'a') })
      await act(async () => {
        await result.current.flush(1)
        expect(result.current.pendingError(1)).toBe('Server down')
      })
      await act(async () => { await result.current.flush(1) })
      expect(result.current.pendingError(1)).toBeNull()
    })

    it('forget aborts a save in flight and ignores how it ends', async () => {
      const inFlight = deferred()
      const save = vi.fn((key, value, { signal }) => {
        signal.addEventListener('abort', () => inFlight.reject(new DOMException('aborted', 'AbortError')))
        return inFlight.promise
      })
      const { result } = renderHook(() => useAutosave(save))
      act(() => { result.current.schedule(1, 'a') })
      await act(async () => { result.current.flush(1) })
      await act(async () => { result.current.forget(1) })
      expect(result.current.state(1)).toEqual({ status: 'saved', error: '' })
    })
  })
})
