import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PreviewPanel from './PreviewPanel'

const file = (id, path) => ({ id, path, updated_at: '' })
const FILES = [file(1, 'index.html'), file(2, 'about.html'), file(3, 'style.css'), file(4, 'main.py')]
const TEXT = {
  1: '<html><head><link rel="stylesheet" href="style.css"></head><body>home</body></html>',
  2: '<p>about</p>',
  3: 'p { color: red }',
}

function setup(props = {}) {
  const readFile = vi.fn((f) => Promise.resolve(TEXT[f.id] ?? ''))
  const view = render(<PreviewPanel files={FILES} readFile={readFile} refreshKey={0} {...props} />)
  const rerender = (next) => view.rerender(<PreviewPanel files={FILES} readFile={readFile} refreshKey={0} {...props} {...next} />)
  return { readFile, rerender }
}

const frame = () => screen.getByTitle('Project preview')

function tokenOf() {
  return frame().getAttribute('srcdoc').match(/var token = "([0-9a-f]+)"/)[1]
}

function fromFrame(data, source = frame().contentWindow) {
  window.dispatchEvent(new MessageEvent('message', { data, source }))
}

// Console lines are batched, so wait for a flush
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 70)))

describe('PreviewPanel', () => {
  it('sandboxes the iframe with allow-scripts and nothing else', async () => {
    setup()
    await waitFor(() => expect(frame()).toBeInTheDocument())
    expect(frame().getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame().getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('renders index.html first, with its css inlined', async () => {
    setup()
    await waitFor(() => expect(frame().getAttribute('srcdoc')).toContain('home'))
    expect(frame().getAttribute('srcdoc')).toContain('p { color: red }')
    expect(screen.getByLabelText('Page')).toHaveValue('index.html')
  })

  it('lets you choose the entry file, offering only html files', async () => {
    setup()
    await waitFor(() => expect(frame()).toBeInTheDocument())
    const options = [...screen.getByLabelText('Page').options].map((o) => o.value)
    expect(options).toEqual(['index.html', 'about.html'])
    await userEvent.selectOptions(screen.getByLabelText('Page'), 'about.html')
    await waitFor(() => expect(frame().getAttribute('srcdoc')).toContain('about'))
  })

  it('starts from the preferred entry when given one', async () => {
    setup({ preferredEntry: 'about.html' })
    await waitFor(() => expect(frame().getAttribute('srcdoc')).toContain('about'))
  })

  it('explains itself with no html files', () => {
    setup({ files: [file(4, 'main.py')] })
    expect(screen.getByText(/Add an .html file/)).toBeInTheDocument()
    expect(screen.queryByTitle('Project preview')).not.toBeInTheDocument()
  })

  it('rebuilds on save, but only reloads if the document changed', async () => {
    const { rerender } = setup()
    await waitFor(() => expect(frame()).toBeInTheDocument())
    const before = frame().getAttribute('srcdoc')
    rerender({ refreshKey: 1 })
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
    expect(frame().getAttribute('srcdoc')).toBe(before)

    TEXT[3] = 'p { color: blue }'
    rerender({ refreshKey: 2 })
    await waitFor(() => expect(frame().getAttribute('srcdoc')).toContain('color: blue'))
    TEXT[3] = 'p { color: red }'
  })

  it('shows build warnings in the console', async () => {
    setup({ files: [file(9, 'index.html')], readFile: () => Promise.resolve('<script src="no.js"></script>') })
    expect(await screen.findByText(/Can't find no\.js/)).toBeInTheDocument()
  })

  it('shows a build failure', async () => {
    setup({ readFile: () => Promise.reject(new Error('Network down')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down')
  })

  describe('messages from the frame', () => {
    async function ready() {
      setup()
      await waitFor(() => expect(frame()).toBeInTheDocument())
    }

    it('shows console output with its level', async () => {
      await ready()
      const token = tokenOf()
      fromFrame({ nexusPreview: token, kind: 'console', level: 'log', text: 'hello' })
      fromFrame({ nexusPreview: token, kind: 'console', level: 'error', text: 'boom' })
      await settle()
      expect(screen.getByText('hello')).toHaveClass('preview-console__line--log')
      expect(screen.getByText('boom')).toHaveClass('preview-console__line--error')
    })

    it('renders output as text, never as HTML', async () => {
      await ready()
      fromFrame({ nexusPreview: tokenOf(), kind: 'console', level: 'log', text: '<img src=x onerror=bad()>' })
      await settle()
      expect(screen.getByText('<img src=x onerror=bad()>')).toBeInTheDocument()
      expect(document.querySelector('img')).toBeNull()
    })

    it('ignores other windows, wrong tokens and bad shapes', async () => {
      await ready()
      const token = tokenOf()
      fromFrame({ nexusPreview: token, kind: 'console', level: 'log', text: 'from elsewhere' }, window)
      fromFrame({ nexusPreview: 'wrong', kind: 'console', level: 'log', text: 'wrong token' })
      fromFrame({ nexusPreview: token, kind: 'console', level: 'log', text: { not: 'text' } })
      fromFrame(null)
      fromFrame('a string')
      await settle()
      expect(screen.queryByText(/from elsewhere|wrong token/)).not.toBeInTheDocument()
      expect(screen.getByText(/output and errors appear here/)).toBeInTheDocument()
    })

    it('an unknown level is treated as a plain line', async () => {
      await ready()
      fromFrame({ nexusPreview: tokenOf(), kind: 'console', level: 'preview-console__evil', text: 'x' })
      await settle()
      expect(screen.getByText('x')).toHaveClass('preview-console__line--log')
    })

    it('caps the console, keeping the newest lines', async () => {
      await ready()
      const token = tokenOf()
      for (let i = 0; i < 510; i += 1) fromFrame({ nexusPreview: token, kind: 'console', level: 'log', text: `line ${i}` })
      await settle()
      expect(screen.queryByText('line 0')).not.toBeInTheDocument()
      expect(screen.getByText('line 509')).toBeInTheDocument()
      expect(document.querySelectorAll('.preview-console__line')).toHaveLength(500)
    })

    it('caps the console by size too', async () => {
      await ready()
      const token = tokenOf()
      fromFrame({ nexusPreview: token, kind: 'console', level: 'log', text: 'old' })
      fromFrame({ nexusPreview: token, kind: 'console', level: 'log', text: 'y'.repeat(100_000) })
      await settle()
      expect(screen.queryByText('old')).not.toBeInTheDocument()
    })

    it('a link to another project page switches to it', async () => {
      await ready()
      fromFrame({ nexusPreview: tokenOf(), kind: 'navigate', level: 'info', text: 'about.html' })
      await waitFor(() => expect(screen.getByLabelText('Page')).toHaveValue('about.html'))
    })

    it('a link anywhere else only gets a note', async () => {
      await ready()
      const token = tokenOf()
      fromFrame({ nexusPreview: token, kind: 'navigate', level: 'info', text: 'https://evil.test/' })
      fromFrame({ nexusPreview: token, kind: 'navigate', level: 'info', text: 'style.css' })
      await settle()
      expect(screen.getByText(/doesn't open in the preview: https:\/\/evil\.test/)).toBeInTheDocument()
      expect(screen.getByLabelText('Page')).toHaveValue('index.html')
    })

    it('Clear empties the console', async () => {
      await ready()
      fromFrame({ nexusPreview: tokenOf(), kind: 'console', level: 'log', text: 'hello' })
      await settle()
      await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
      expect(screen.queryByText('hello')).not.toBeInTheDocument()
    })
  })

  it('Reload restarts the page and empties the console', async () => {
    setup()
    await waitFor(() => expect(frame()).toBeInTheDocument())
    const first = frame()
    fromFrame({ nexusPreview: tokenOf(), kind: 'console', level: 'log', text: 'hello' })
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /Reload/ }))
    expect(frame()).not.toBe(first)
    expect(screen.queryByText('hello')).not.toBeInTheDocument()
  })

  it('a flood of lines in one go causes one repaint and stays capped', async () => {
    setup()
    await waitFor(() => expect(frame()).toBeInTheDocument())
    const token = tokenOf()
    for (let i = 0; i < 2000; i += 1) fromFrame({ nexusPreview: token, kind: 'console', level: 'log', text: `flood ${i}` })
    await settle()
    expect(document.querySelectorAll('.preview-console__line')).toHaveLength(500)
    expect(screen.getByText('flood 1999')).toBeInTheDocument()
  })

  it('stops listening when closed', async () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const view = render(<PreviewPanel files={FILES} readFile={() => Promise.resolve('')} refreshKey={0} />)
    view.unmount()
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function))
  })
})
