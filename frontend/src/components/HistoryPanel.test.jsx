import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HistoryPanel from './HistoryPanel'
import { ToastProvider } from './ui/Toast'
import { stubRoutes } from '../test/helpers'

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: ({ original, modified, language, options }) => (
    <div data-testid="diff" data-language={language} data-side-by-side={String(options.renderSideBySide)}>
      <pre data-testid="original">{original}</pre>
      <pre data-testid="modified">{modified}</pre>
    </div>
  ),
}))

const FILE = { id: 5, path: 'src/weather.py', language: 'python' }
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString()
const VERSIONS = {
  versions: [
    { id: 30, created_at: minutesAgo(2), label: null, source: 'autosnapshot', author: 'alex', content_hash: 'c', size: 20 },
    { id: 20, created_at: minutesAgo(60), label: 'Works before refactor', source: 'save', author: 'priya', content_hash: 'b', size: 18 },
    { id: 10, created_at: minutesAgo(600), label: null, source: 'import', author: null, content_hash: 'a', size: 9 },
  ],
  total: 3,
}

function renderPanel({ canRestore = true, routes = {}, current = 'current text\n', ...props } = {}) {
  const fetchMock = stubRoutes({
    'GET /code-files/5/versions': [200, VERSIONS],
    'GET /code-files/5/versions/30': [200, { version: VERSIONS.versions[0], content: 'current text\n' }],
    'GET /code-files/5/versions/20': [200, { version: VERSIONS.versions[1], content: 'older text\n' }],
    'GET /code-files/5/versions/10': [200, { version: VERSIONS.versions[2], content: 'imported\n' }],
    ...routes,
  })
  const handlers = { onClose: vi.fn(), onRestored: vi.fn(), beforeRestore: vi.fn(() => Promise.resolve()) }
  render(
    <ToastProvider>
      <HistoryPanel file={FILE} currentContent={current} canRestore={canRestore} {...handlers} {...props} />
    </ToastProvider>,
  )
  return { fetchMock, ...handlers }
}

const timeline = () => screen.getByRole('list', { name: 'Versions, newest first' })
const item = (pattern) => within(timeline()).getAllByRole('button').find((b) => pattern.test(b.textContent))

describe('HistoryPanel', () => {
  it('shows a loading state, then the timeline with author, time, source and label', async () => {
    renderPanel()
    expect(screen.getByText('Loading versions…')).toBeInTheDocument()
    await screen.findByRole('list', { name: 'Versions, newest first' })
    expect(screen.getByText('3 versions')).toBeInTheDocument()
    const newest = item(/alex/)
    expect(newest).toHaveTextContent('Latest')
    expect(newest).toHaveTextContent('Live edit')
    expect(newest).toHaveTextContent(/minutes? ago/)
    expect(newest).toHaveAttribute('aria-pressed', 'true') // newest chosen first
    expect(item(/priya/)).toHaveTextContent('Works before refactor')
    expect(item(/Former member/)).toHaveTextContent('Imported')
  })

  it('opens a diff of the chosen version against the current text', async () => {
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('list', { name: 'Versions, newest first' })
    // The newest matches the current text: no diff, a plain note
    expect(await screen.findByText('This version matches the current text.')).toBeInTheDocument()
    await user.click(item(/priya/))
    expect(item(/priya/)).toHaveAttribute('aria-pressed', 'true')
    const diff = await screen.findByTestId('diff')
    expect(diff).toHaveAttribute('data-language', 'python')
    expect(screen.getByTestId('original')).toHaveTextContent('older text')
    expect(screen.getByTestId('modified')).toHaveTextContent('current text')
    expect(screen.getByRole('region', { name: /Changes from this version/ })).toBeInTheDocument()
  })

  it('moves through the timeline with the arrow keys', async () => {
    const user = userEvent.setup()
    renderPanel()
    await screen.findByRole('list', { name: 'Versions, newest first' })
    item(/alex/).focus()
    await user.keyboard('{ArrowDown}')
    expect(item(/priya/)).toHaveFocus()
    expect(item(/priya/)).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('{End}')
    expect(item(/Former member/)).toHaveFocus()
    await user.keyboard('{Home}')
    expect(item(/alex/)).toHaveFocus()
  })

  it('lets viewers browse but never restore', async () => {
    const user = userEvent.setup()
    renderPanel({ canRestore: false })
    await screen.findByRole('list', { name: 'Versions, newest first' })
    await user.click(item(/priya/))
    await screen.findByTestId('diff')
    expect(screen.queryByRole('button', { name: 'Restore this version' })).not.toBeInTheDocument()
    expect(screen.getByText(/owners and editors can restore/)).toBeInTheDocument()
  })

  it('restores after confirming: saves pending edits first, then calls the API and reloads', async () => {
    const user = userEvent.setup()
    const { fetchMock, beforeRestore, onRestored } = renderPanel({
      routes: {
        'POST /code-files/5/versions/20/restore': [200, { message: 'Restored src/weather.py to the version from 2026-11-15 10:00 UTC.', version_id: 31, restored_to_version_id: 20 }],
      },
    })
    await screen.findByRole('list', { name: 'Versions, newest first' })
    // Restoring a version identical to the current text is pointless
    await screen.findByText('This version matches the current text.')
    expect(screen.getByRole('button', { name: 'Restore this version' })).toBeDisabled()
    await user.click(item(/priya/))
    await screen.findByTestId('diff')
    await user.click(screen.getByRole('button', { name: 'Restore this version' }))
    const confirm = await screen.findByRole('dialog', { name: 'Restore this version?' })
    expect(within(confirm).getByText(/Nothing is lost/)).toBeInTheDocument()
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(confirm).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith('older text\n'))
    expect(beforeRestore).toHaveBeenCalled()
    const restoreCall = fetchMock.mock.calls.find(([url, init]) => url.endsWith('/code-files/5/versions/20/restore') && init?.method === 'POST')
    expect(restoreCall).toBeDefined()
    expect(await screen.findByText('Version restored')).toBeInTheDocument()
    // The list is fetched again, so the restore shows as the newest version
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url.includes('/code-files/5/versions?')).length).toBe(2))
  })

  it("shows the server's reason when a restore fails", async () => {
    const user = userEvent.setup()
    const { onRestored } = renderPanel({ routes: { 'POST /code-files/5/versions/20/restore': [403, { detail: 'Your role (viewer) cannot do this' }] } })
    await screen.findByRole('list', { name: 'Versions, newest first' })
    await user.click(item(/priya/))
    await screen.findByTestId('diff')
    await user.click(screen.getByRole('button', { name: 'Restore this version' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Restore this version?' })).getByRole('button', { name: 'Restore' }))
    expect(await screen.findByText("Couldn't restore")).toBeInTheDocument()
    expect(screen.getByText('Your role (viewer) cannot do this')).toBeInTheDocument()
    expect(onRestored).not.toHaveBeenCalled()
  })

  it('shows an empty state for a file without versions', async () => {
    renderPanel({ routes: { 'GET /code-files/5/versions': [200, { versions: [], total: 0 }] } })
    expect(await screen.findByRole('heading', { name: 'No versions yet' })).toBeInTheDocument()
  })

  it('shows an error with a retry that works', async () => {
    const user = userEvent.setup()
    renderPanel({ routes: { 'GET /code-files/5/versions': [[500, { detail: 'Database asleep' }], [200, VERSIONS]] } })
    expect(await screen.findByText('Database asleep')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('list', { name: 'Versions, newest first' })).toBeInTheDocument()
  })
})
