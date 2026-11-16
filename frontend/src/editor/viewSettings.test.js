import { describe, it, expect, afterEach, vi } from 'vitest'
import { DEFAULT_VIEW, monacoViewOptions, readView, stepFontSize, storeView } from './viewSettings'

describe('editor view settings', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })
  it('round-trips and ignores junk', () => {
    storeView({ fontSize: 18, wordWrap: true, minimap: false })
    expect(readView()).toEqual({ fontSize: 18, wordWrap: true, minimap: false })
    localStorage.setItem('editor-view', JSON.stringify({ fontSize: 99, wordWrap: 'yes' }))
    expect(readView()).toEqual(DEFAULT_VIEW)
    localStorage.setItem('editor-view', '{bad')
    expect(readView()).toEqual(DEFAULT_VIEW)
  })
  it('steps text size within the list', () => {
    expect(stepFontSize(14, 1)).toBe(15)
    expect(stepFontSize(20, 1)).toBe(20)
    expect(stepFontSize(12, -1)).toBe(12)
    expect(stepFontSize(17, 1)).toBe(15)
  })
  it('maps to Monaco options', () => {
    expect(monacoViewOptions({ fontSize: 16, wordWrap: true, minimap: true })).toEqual({ fontSize: 16, wordWrap: 'on', minimap: { enabled: true } })
  })
  it('works with storage blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readView()).toEqual(DEFAULT_VIEW)
    expect(() => storeView(DEFAULT_VIEW)).not.toThrow()
  })
})
