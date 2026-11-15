import { describe, it, expect, vi, afterEach } from 'vitest'
import * as Y from 'yjs'
import { destroyOnce } from './destroyOnce'

// Shaped like y-monaco's MonacoBinding: observes the text, and its model's
// dispose handler calls this.destroy() before the editor's cleanup does
class FakeBinding {
  constructor(ytext) {
    this.ytext = ytext
    this.observer = () => {}
    ytext.observe(this.observer)
    this.onModelDispose = () => this.destroy()
  }
  destroy() {
    this.ytext.unobserve(this.observer)
  }
}

afterEach(() => vi.restoreAllMocks())

describe('destroyOnce', () => {
  it('reproduces the yjs warning without it', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const binding = new FakeBinding(new Y.Doc().getText('content'))
    binding.onModelDispose()
    binding.destroy()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Tried to remove event handler'))
  })

  it('lets the model dispose and the effect cleanup both destroy, with no warning', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ytext = new Y.Doc().getText('content')
    const binding = destroyOnce(new FakeBinding(ytext))
    const unobserve = vi.spyOn(ytext, 'unobserve')
    binding.onModelDispose()
    binding.destroy()
    expect(unobserve).toHaveBeenCalledTimes(1)
    expect(error).not.toHaveBeenCalled()
  })
})
