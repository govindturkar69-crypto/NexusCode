import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import CodeEditor from './CodeEditor'
import AuthProvider from '../auth/AuthProvider'
import { forgetPythonWorker } from '../runners/runPython'
import { fakeJwt, inOneHour, sseFrame, sseResponse, stubRoutes } from '../test/helpers'

// Monaco can't run in jsdom; everything else here is the real page
vi.mock('../editor/monacoSetup', () => ({}))
vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div data-testid="diff" />,
  default: ({ value, onChange, language, path, options }) => (
    <textarea
      aria-label="Code"
      data-language={language}
      data-path={path}
      readOnly={options.readOnly}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

const summary = (id, path, language = 'python') => ({ id, path, language, project_id: 7, created_at: '', updated_at: '' })
const A = summary(1, 'src/a.py')
const B = summary(2, 'b.js', 'javascript')
const body = (file, content) => [200, { code_file: { ...file, content } }]

function setup(role = 'owner', routes = {}) {
  localStorage.setItem('token', fakeJwt({ sub: 'me', exp: inOneHour() }))
  const fetchMock = stubRoutes({
    'GET /me': [200, { id: 1, username: 'me', is_admin: false }],
    'GET /projects/7': [200, { project: { id: 7, name: 'P', role } }],
    'GET /projects/7/code/files': [200, { code_files: [B, A] }],
    'GET /code-files/1': body(A, 'print(1)'),
    'GET /code-files/2': body(B, 'console.log(2)'),
    ...routes,
  })
  render(
    <MemoryRouter initialEntries={['/projects/7/editor']}>
      <AuthProvider>
        <Routes>
          <Route path="/projects/:projectId/editor" element={<CodeEditor />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  )
  return fetchMock
}

const calls = (fetchMock, method, path) =>
  fetchMock.mock.calls.filter(([url, init]) => new URL(url).pathname === path && (init?.method ?? 'GET') === method)
const sent = (fetchMock, method, path) => JSON.parse(calls(fetchMock, method, path).at(-1)[1].body)
const tree = () => screen.getByRole('navigation', { name: 'Project files' })
const tabs = () => screen.getAllByRole('tab').map((t) => t.textContent.replace(' ●', ''))

describe('CodeEditor', () => {
  beforeEach(() => vi.useRealTimers())

  describe('opening files', () => {
    it('shows the tree and opens the first file', async () => {
      setup()
      expect(await screen.findByLabelText('Code')).toHaveValue('console.log(2)')
      expect(within(tree()).getByRole('button', { name: 'src' })).toHaveAttribute('aria-expanded', 'true')
      expect(within(tree()).getByRole('button', { name: 'a.py' })).toBeInTheDocument()
      expect(tabs()).toEqual(['b.js'])
    })

    it('uses the file language from the server and a separate Monaco model per file', async () => {
      setup()
      const editor = await screen.findByLabelText('Code')
      expect(editor).toHaveAttribute('data-language', 'javascript')
      expect(editor).toHaveAttribute('data-path', 'project-7/file-2')
      await userEvent.click(within(tree()).getByRole('button', { name: 'a.py' }))
      await waitFor(() => expect(screen.getByLabelText('Code')).toHaveAttribute('data-language', 'python'))
      expect(screen.getByLabelText('Code')).toHaveAttribute('data-path', 'project-7/file-1')
      expect(screen.getByLabelText('Code')).toHaveValue('print(1)')
    })

    it('tabs switch without fetching again', async () => {
      const fetchMock = setup()
      await screen.findByLabelText('Code')
      await userEvent.click(within(tree()).getByRole('button', { name: 'a.py' }))
      await waitFor(() => expect(tabs()).toEqual(['b.js', 'a.py']))
      await waitFor(() => expect(screen.getByLabelText('Code')).toHaveValue('print(1)'))
      await userEvent.click(screen.getByRole('tab', { name: /b\.js/ }))
      expect(screen.getByLabelText('Code')).toHaveValue('console.log(2)')
      expect(calls(fetchMock, 'GET', '/code-files/2')).toHaveLength(1)
    })

    it('fetches a file once, even under StrictMode', async () => {
      localStorage.setItem('token', fakeJwt({ sub: 'me', exp: inOneHour() }))
      const fetchMock = stubRoutes({
        'GET /me': [200, { id: 1, username: 'me', is_admin: false }],
        'GET /projects/7': [200, { project: { id: 7, name: 'P', role: 'owner' } }],
        'GET /projects/7/code/files': [200, { code_files: [B, A] }],
        'GET /code-files/2': body(B, 'console.log(2)'),
      })
      render(
        <StrictMode>
          <MemoryRouter initialEntries={['/projects/7/editor']}>
            <AuthProvider>
              <Routes>
                <Route path="/projects/:projectId/editor" element={<CodeEditor />} />
              </Routes>
            </AuthProvider>
          </MemoryRouter>
        </StrictMode>
      )
      expect(await screen.findByLabelText('Code')).toHaveValue('console.log(2)')
      expect(calls(fetchMock, 'GET', '/code-files/2')).toHaveLength(1)
    })

    it('a failed load can be retried by opening the file again', async () => {
      setup('owner', { 'GET /code-files/1': [[500, { detail: 'Try later' }], body(A, 'print(1)')] })
      await screen.findByLabelText('Code')
      await userEvent.click(within(tree()).getByRole('button', { name: 'a.py' }))
      expect(await screen.findByText('Try later')).toBeInTheDocument()
      await userEvent.click(within(tree()).getByRole('button', { name: 'a.py' }))
      await waitFor(() => expect(screen.getByLabelText('Code')).toHaveValue('print(1)'))
    })

    it('opening the same file twice keeps one tab', async () => {
      setup()
      await screen.findByLabelText('Code')
      await userEvent.click(within(tree()).getByRole('button', { name: 'b.js' }))
      expect(tabs()).toEqual(['b.js'])
    })

    it('closing a tab activates a neighbour, and reopening reads fresh content', async () => {
      const fetchMock = setup()
      await screen.findByLabelText('Code')
      await userEvent.click(within(tree()).getByRole('button', { name: 'a.py' }))
      await waitFor(() => expect(screen.getByLabelText('Code')).toHaveValue('print(1)'))
      await userEvent.click(screen.getByRole('button', { name: 'Close a.py' }))
      expect(tabs()).toEqual(['b.js'])
      expect(screen.getByLabelText('Code')).toHaveValue('console.log(2)')
      await userEvent.click(within(tree()).getByRole('button', { name: 'a.py' }))
      await waitFor(() => expect(screen.getByLabelText('Code')).toHaveValue('print(1)'))
      expect(calls(fetchMock, 'GET', '/code-files/1')).toHaveLength(2)
    })

    it('closing the last tab shows a prompt', async () => {
      setup()
      await screen.findByLabelText('Code')
      await userEvent.click(screen.getByRole('button', { name: 'Close b.js' }))
      expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()
      expect(screen.getByText(/Open a file from the list/)).toBeInTheDocument()
    })

    it('collapses folders', async () => {
      setup()
      await screen.findByLabelText('Code')
      await userEvent.click(within(tree()).getByRole('button', { name: 'src' }))
      expect(within(tree()).queryByRole('button', { name: 'a.py' })).not.toBeInTheDocument()
    })

    it('says so when the project has no files', async () => {
      setup('owner', { 'GET /projects/7/code/files': [200, { code_files: [] }] })
      expect(await screen.findByText(/No files yet\. Create the first one/)).toBeInTheDocument()
      expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()
      expect(await screen.findByRole('button', { name: /Push to GitHub/ })).toBeDisabled()
    })

    it('shows a load failure', async () => {
      setup('owner', { 'GET /projects/7/code/files': [500, { detail: 'Server broke' }] })
      expect(await screen.findByText('Server broke')).toBeInTheDocument()
    })
  })

  describe('autosave per file', () => {
    it('saves to the file being edited and shows the status', async () => {
      const fetchMock = setup('editor', { 'PUT /code-files/2': [200, { code_file: B }] })
      await userEvent.type(await screen.findByLabelText('Code'), '!')
      expect(screen.getByRole('status')).toHaveTextContent(/Unsaved changes/)
      expect(screen.getByRole('tab', { name: /b\.js/ })).toHaveTextContent('●')
      await waitFor(() => expect(calls(fetchMock, 'PUT', '/code-files/2')).toHaveLength(1), { timeout: 3000 })
      expect(sent(fetchMock, 'PUT', '/code-files/2')).toEqual({ content: 'console.log(2)!' })
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All changes saved'))
      expect(screen.getByRole('tab', { name: /b\.js/ })).not.toHaveTextContent('●')
    })

    it('switching tabs keeps each file separate, and both get saved', async () => {
      const fetchMock = setup('editor', {
        'PUT /code-files/1': [200, { code_file: A }],
        'PUT /code-files/2': [200, { code_file: B }],
      })
      await userEvent.type(await screen.findByLabelText('Code'), 'X')
      await userEvent.click(within(tree()).getByRole('button', { name: 'a.py' }))
      await waitFor(() => expect(screen.getByLabelText('Code')).toHaveValue('print(1)'))
      await userEvent.type(screen.getByLabelText('Code'), 'Y')
      await waitFor(() => {
        expect(calls(fetchMock, 'PUT', '/code-files/1')).toHaveLength(1)
        expect(calls(fetchMock, 'PUT', '/code-files/2')).toHaveLength(1)
      }, { timeout: 3000 })
      expect(sent(fetchMock, 'PUT', '/code-files/2').content).toBe('console.log(2)X')
      expect(sent(fetchMock, 'PUT', '/code-files/1').content).toBe('print(1)Y')
    })

    it('shows a failed save with a retry', async () => {
      setup('editor', {
        'PUT /code-files/2': [
          [500, { detail: 'Disk full' }],
          [200, { code_file: B }],
        ],
      })
      await userEvent.type(await screen.findByLabelText('Code'), '!')
      expect(await screen.findByText(/Save failed: Disk full/, {}, { timeout: 3000 })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All changes saved'))
    })

    it('closing a tab saves what is pending', async () => {
      const fetchMock = setup('editor', { 'PUT /code-files/2': [200, { code_file: B }] })
      await userEvent.type(await screen.findByLabelText('Code'), '!')
      await userEvent.click(screen.getByRole('button', { name: 'Close b.js' }))
      await waitFor(() => expect(calls(fetchMock, 'PUT', '/code-files/2')).toHaveLength(1))
    })
  })

  describe('managing files', () => {
    async function ready(role = 'editor', routes = {}) {
      const fetchMock = setup(role, routes)
      await screen.findByLabelText('Code')
      await screen.findByRole('button', { name: '+ File' })
      return fetchMock
    }

    async function fillDialog(value, submit) {
      const dialog = await screen.findByRole('dialog')
      const input = within(dialog).getByRole('textbox')
      await userEvent.clear(input)
      await userEvent.type(input, value)
      await userEvent.click(within(dialog).getByRole('button', { name: submit }))
    }

    it('creates a file and opens it', async () => {
      const created = summary(3, 'src/new.py')
      const fetchMock = await ready('editor', { 'POST /projects/7/code/files': [201, { code_file: { ...created, content: '' } }] })
      await userEvent.click(screen.getByRole('button', { name: '+ File' }))
      await fillDialog('src/new.py', 'Create')
      expect(await within(tree()).findByRole('button', { name: 'new.py' })).toBeInTheDocument()
      expect(sent(fetchMock, 'POST', '/projects/7/code/files')).toEqual({ path: 'src/new.py' })
      expect(tabs()).toEqual(['b.js', 'new.py'])
      expect(screen.getByLabelText('Code')).toHaveValue('')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('a folder row starts the path in that folder', async () => {
      await ready()
      await userEvent.click(screen.getByRole('button', { name: 'New file in src' }))
      expect(within(await screen.findByRole('dialog')).getByRole('textbox')).toHaveValue('src/')
    })

    it('keeps the dialog open with the server error on a conflict', async () => {
      await ready('editor', { 'POST /projects/7/code/files': [409, { detail: 'b.js already exists.' }] })
      await userEvent.click(screen.getByRole('button', { name: '+ File' }))
      await fillDialog('b.js', 'Create')
      expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('b.js already exists.')
    })

    it('renames a file and follows the new language', async () => {
      const fetchMock = await ready('editor', { 'PATCH /code-files/2': [200, { code_file: summary(2, 'b.ts', 'typescript') }] })
      await userEvent.click(screen.getByRole('button', { name: 'Rename b.js' }))
      await fillDialog('b.ts', 'Rename')
      expect(await within(tree()).findByRole('button', { name: 'b.ts' })).toBeInTheDocument()
      expect(sent(fetchMock, 'PATCH', '/code-files/2')).toEqual({ path: 'b.ts' })
      expect(tabs()).toEqual(['b.ts'])
      expect(screen.getByLabelText('Code')).toHaveAttribute('data-language', 'typescript')
    })

    it('deletes a file only after confirming, and closes its tab', async () => {
      const fetchMock = await ready('editor', { 'DELETE /code-files/2': [204] })
      await userEvent.click(screen.getByRole('button', { name: 'Delete b.js' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText(/"b\.js" will be permanently deleted/)).toBeInTheDocument()
      expect(calls(fetchMock, 'DELETE', '/code-files/2')).toHaveLength(0)
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(within(tree()).queryByRole('button', { name: 'b.js' })).not.toBeInTheDocument())
      expect(screen.queryAllByRole('tab')).toEqual([])
    })

    it('deleting a file with unsaved changes does not save them', async () => {
      const fetchMock = await ready('editor', { 'DELETE /code-files/2': [204] })
      await userEvent.type(screen.getByLabelText('Code'), '!')
      await userEvent.click(screen.getByRole('button', { name: 'Delete b.js' }))
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(calls(fetchMock, 'DELETE', '/code-files/2')).toHaveLength(1))
      await act(() => new Promise((resolve) => setTimeout(resolve, 1100)))
      expect(calls(fetchMock, 'PUT', '/code-files/2')).toHaveLength(0)
    })

    it('an empty folder stays local until it has a file', async () => {
      const fetchMock = await ready()
      await userEvent.click(screen.getByRole('button', { name: '+ Folder' }))
      await fillDialog('docs', 'Create')
      expect(await within(tree()).findByRole('button', { name: 'docs' })).toBeInTheDocument()
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)

      await userEvent.click(screen.getByRole('button', { name: 'Rename docs' }))
      await fillDialog('guides', 'Rename')
      expect(await within(tree()).findByRole('button', { name: 'guides' })).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Delete guides' }))
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(within(tree()).queryByRole('button', { name: 'guides' })).not.toBeInTheDocument())
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
    })

    it('refuses a folder that already exists', async () => {
      await ready()
      await userEvent.click(screen.getByRole('button', { name: '+ Folder' }))
      await fillDialog('src', 'Create')
      expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('src already exists.')
    })

    it('renames a folder on the server and reloads the tree', async () => {
      const moved = summary(1, 'lib/a.py')
      const fetchMock = await ready('editor', {
        'POST /projects/7/code/folders/rename': [200, { code_files: [moved] }],
        'GET /projects/7/code/files': [
          [200, { code_files: [B, A] }],
          [200, { code_files: [B, moved] }],
        ],
      })
      await userEvent.click(screen.getByRole('button', { name: 'Rename src' }))
      await fillDialog('lib', 'Rename')
      expect(await within(tree()).findByRole('button', { name: 'lib' })).toBeInTheDocument()
      expect(sent(fetchMock, 'POST', '/projects/7/code/folders/rename')).toEqual({ path: 'src', new_path: 'lib' })
    })

    it('deletes a folder on the server and closes tabs inside it', async () => {
      const fetchMock = await ready('editor', { 'POST /projects/7/code/folders/delete': [200, { deleted: [1] }] })
      await userEvent.click(within(tree()).getByRole('button', { name: 'a.py' }))
      await waitFor(() => expect(tabs()).toEqual(['b.js', 'a.py']))
      await userEvent.click(screen.getByRole('button', { name: 'Delete src' }))
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(tabs()).toEqual(['b.js']))
      expect(sent(fetchMock, 'POST', '/projects/7/code/folders/delete')).toEqual({ path: 'src' })
      expect(within(tree()).queryByRole('button', { name: 'src' })).not.toBeInTheDocument()
    })
  })

  describe('roles', () => {
    it('a viewer can read and open files but change nothing', async () => {
      const fetchMock = setup('viewer')
      const editor = await screen.findByLabelText('Code')
      expect(await screen.findByText('View only')).toBeInTheDocument()
      expect(editor).toHaveAttribute('readonly')
      expect(screen.queryByRole('button', { name: '+ File' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '+ Folder' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Delete / })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Rename / })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Push to GitHub/ })).not.toBeInTheDocument()
      await userEvent.click(within(tree()).getByRole('button', { name: 'a.py' }))
      await waitFor(() => expect(screen.getByLabelText('Code')).toHaveValue('print(1)'))
      expect(fetchMock.mock.calls.filter(([, init]) => ['PUT', 'PATCH', 'DELETE'].includes(init?.method))).toHaveLength(0)
    })

    it('an editor can edit but not push', async () => {
      setup('editor')
      expect(await screen.findByRole('button', { name: '+ File' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Push to GitHub/ })).not.toBeInTheDocument()
    })

    it('an owner can push', async () => {
      setup('owner')
      expect(await screen.findByRole('button', { name: /Push to GitHub/ })).toBeEnabled()
    })
  })

  describe('teammates', () => {
    it('picks up changes every 30s and closes the tab of a file someone deleted', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const fetchMock = setup('editor', {
        'GET /projects/7/code/files': [
          [200, { code_files: [B, A] }],
          [200, { code_files: [A, summary(5, 'added.py')] }],
        ],
      })
      await screen.findByLabelText('Code')
      await act(() => vi.advanceTimersByTimeAsync(30000))
      expect(calls(fetchMock, 'GET', '/projects/7/code/files')).toHaveLength(2)
      expect(await within(tree()).findByRole('button', { name: 'added.py' })).toBeInTheDocument()
      expect(screen.getByText(/deleted or moved by someone else/)).toBeInTheDocument()
      expect(screen.queryAllByRole('tab')).toEqual([])
      vi.useRealTimers()
    })
  })

  describe('pushing', () => {
    const PUSHED = { message: 'Pushed', repo_url: 'https://x/r', private: true, repo_full_name: 'me/r', branch: 'main', files: 2, commit_url: 'https://x/r/commit/abc' }

    async function push(user = userEvent) {
      await user.click(await screen.findByRole('button', { name: /Push to GitHub/ }))
      const dialog = await screen.findByRole('dialog')
      await user.type(within(dialog).getByLabelText('Repository name'), 'fresh')
      await user.click(within(dialog).getByRole('button', { name: 'Push' }))
    }

    it('saves what is unsaved first, then links to the commit', async () => {
      const order = []
      const fetchMock = setup('owner', {
        'PUT /code-files/2': [200, { code_file: B }],
        'POST /projects/7/push-to-github': [200, { ...PUSHED, changed: true }],
      })
      await userEvent.type(await screen.findByLabelText('Code'), '!')
      await push()
      expect(await screen.findByRole('link', { name: 'Open the commit' })).toHaveAttribute('href', 'https://x/r/commit/abc')
      expect(screen.getByText(/Pushed 2 files to me\/r \(main\)/)).toBeInTheDocument()
      fetchMock.mock.calls.forEach(([url, init]) => {
        if (init?.method === 'PUT' || url.includes('push-to-github')) order.push(init.method)
      })
      expect(order).toEqual(['PUT', 'POST'])
    })

    it('says so when GitHub already had everything', async () => {
      setup('owner', { 'POST /projects/7/push-to-github': [200, { ...PUSHED, changed: false }] })
      await screen.findByLabelText('Code')
      await push()
      expect(await screen.findByText(/already has these files/)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Open the repository' })).toHaveAttribute('href', 'https://x/r')
    })

    it('does not push if a change could not be saved', async () => {
      const fetchMock = setup('owner', { 'PUT /code-files/2': [500, { detail: 'Disk full' }] })
      await userEvent.type(await screen.findByLabelText('Code'), '!')
      await push()
      expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(/Couldn't save your changes first: Disk full/)
      expect(fetchMock.mock.calls.some(([url]) => url.includes('push-to-github'))).toBe(false)
    })
  })

  describe('preview', () => {
    const PAGE = summary(10, 'index.html', 'html')
    const CSS = summary(11, 'site.css', 'css')
    const previewRoutes = {
      'GET /projects/7/code/files': [200, { code_files: [PAGE, CSS] }],
      'GET /code-files/10': body(PAGE, '<link rel="stylesheet" href="site.css"><p>page v1</p>'),
      'GET /code-files/11': body(CSS, 'p { color: red }'),
    }
    const frame = () => screen.getByTitle('Project preview')

    it('is offered only when the project has an html file', async () => {
      setup('editor')
      await screen.findByLabelText('Code')
      expect(screen.queryByRole('button', { name: /Preview/ })).not.toBeInTheDocument()
    })

    it('renders the project, reading unopened files from the server', async () => {
      const fetchMock = setup('viewer', previewRoutes)
      await screen.findByLabelText('Code')
      await userEvent.click(screen.getByRole('button', { name: /Preview/ }))
      await waitFor(() => expect(frame().getAttribute('srcdoc')).toContain('page v1'))
      expect(frame().getAttribute('srcdoc')).toContain('p { color: red }')
      expect(frame().getAttribute('sandbox')).toBe('allow-scripts')
      expect(calls(fetchMock, 'GET', '/code-files/11')).toHaveLength(1)
    })

    it('refreshes after a save, with the new text', async () => {
      setup('editor', { ...previewRoutes, 'PUT /code-files/10': [200, { code_file: PAGE }] })
      await screen.findByLabelText('Code')
      await userEvent.click(screen.getByRole('button', { name: /Preview/ }))
      await waitFor(() => expect(frame().getAttribute('srcdoc')).toContain('page v1'))
      await userEvent.type(screen.getByLabelText('Code'), 'EDITED')
      expect(frame().getAttribute('srcdoc')).not.toContain('EDITED')
      await waitFor(() => expect(frame().getAttribute('srcdoc')).toContain('EDITED'), { timeout: 3000 })
    })

    it('can be closed', async () => {
      setup('viewer', previewRoutes)
      await screen.findByLabelText('Code')
      await userEvent.click(screen.getByRole('button', { name: /Preview/ }))
      await waitFor(() => expect(frame()).toBeInTheDocument())
      await userEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(screen.queryByTitle('Project preview')).not.toBeInTheDocument()
    })
  })

  describe('running', () => {
    class FakeWorker {
      static instances = []
      constructor(url, options) { this.url = String(url); this.options = options; FakeWorker.instances.push(this); queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } })) }
      postMessage(message) {
        this.message = message
        this.onmessage?.({ data: { type: 'started' } })
        if (FakeWorker.hang) return
        this.onmessage?.({ data: { type: 'output', stream: 'stdout', text: `ran ${message.fileName}\n` } })
        this.onmessage?.({ data: { type: 'done', ok: true } })
      }
      terminate() { this.terminated = true }
    }
    const PY = summary(3, 'main.py', 'python')
    const MD = summary(4, 'notes.md', 'markdown')
    const CSS = summary(5, 'site.css', 'css')
    const PAGE = summary(6, 'index.html', 'html')

    beforeEach(() => {
      FakeWorker.instances = []
      FakeWorker.hang = false
      vi.stubGlobal('Worker', FakeWorker)
      forgetPythonWorker()
    })

    const only = (...files) => ({ 'GET /projects/7/code/files': [200, { code_files: files }] })
    const run = () => userEvent.click(screen.getByRole('button', { name: /Run/ }))

    it('JavaScript runs what is in the editor, sending nothing to the server', async () => {
      const fetchMock = setup('editor')
      const editor = await screen.findByLabelText('Code')
      await userEvent.type(editor, ' // new')
      fetchMock.mockClear()
      await run()
      expect(await screen.findByText(/ran b\.js/)).toBeInTheDocument()
      expect(FakeWorker.instances[0].message).toEqual({ code: 'console.log(2) // new', fileName: 'b.js' })
      expect(FakeWorker.instances[0].url).toMatch(/^data:text\/javascript/)
      expect(fetchMock.mock.calls.filter(([url]) => url.includes('/run'))).toEqual([])
    })

    it('Python gets a module worker and the stdin box', async () => {
      setup('editor', { ...only(PY), 'GET /code-files/3': body(PY, 'print(input())') })
      await screen.findByLabelText('Code')
      await userEvent.type(screen.getByLabelText('Input (stdin)'), 'Ada')
      await run()
      expect(await screen.findByText(/ran main\.py/)).toBeInTheDocument()
      expect(FakeWorker.instances[0].options).toEqual({ type: 'module' })
      expect(FakeWorker.instances[0].message).toEqual({ code: 'print(input())', fileName: 'main.py', stdin: 'Ada' })
    })

    it('no worker is created until Run is pressed, so Pyodide stays lazy', async () => {
      setup('editor', { ...only(PY), 'GET /code-files/3': body(PY, 'x') })
      await screen.findByLabelText('Code')
      expect(FakeWorker.instances).toHaveLength(0)
    })

    it('only Python files get the stdin box', async () => {
      setup('editor')
      await screen.findByLabelText('Code')
      expect(screen.queryByLabelText('Input (stdin)')).not.toBeInTheDocument()
    })

    it('other languages get a friendly message and a disabled button', async () => {
      setup('editor', { ...only(MD), 'GET /code-files/4': body(MD, '# hi') })
      await screen.findByLabelText('Code')
      expect(screen.getByRole('button', { name: /Run/ })).toBeDisabled()
      expect(screen.getByText(/can't run in the browser/)).toBeInTheDocument()
    })

    it('Run on an html file opens the preview', async () => {
      setup('viewer', { ...only(PAGE), 'GET /code-files/6': body(PAGE, '<p>my page</p>') })
      await screen.findByLabelText('Code')
      expect(screen.queryByTitle('Project preview')).not.toBeInTheDocument()
      await run()
      await waitFor(() => expect(screen.getByTitle('Project preview').getAttribute('srcdoc')).toContain('my page'))
      expect(FakeWorker.instances).toHaveLength(0)
    })

    it('Run on a stylesheet previews the page it belongs to', async () => {
      setup('editor', { ...only(CSS, PAGE), 'GET /code-files/5': body(CSS, 'p{color:red}'), 'GET /code-files/6': body(PAGE, '<link rel="stylesheet" href="site.css"><p>x</p>') })
      await screen.findByLabelText('Code')
      await run()
      await waitFor(() => expect(screen.getByTitle('Project preview').getAttribute('srcdoc')).toContain('p{color:red}'))
    })

    it('the Preview button stays available while working on a script', async () => {
      const JS = summary(7, 'app.js', 'javascript')
      setup('editor', { ...only(JS, PAGE), 'GET /code-files/7': body(JS, 'x'), 'GET /code-files/6': body(PAGE, '<p>x</p>') })
      await screen.findByLabelText('Code')
      await userEvent.click(screen.getByRole('button', { name: /Preview/ }))
      await waitFor(() => expect(screen.getByTitle('Project preview')).toBeInTheDocument())
      expect(FakeWorker.instances).toHaveLength(0)
    })

    describe('roles', () => {
      it.each(['viewer', 'editor', 'owner'])('a %s can run code', async (role) => {
        setup(role)
        await screen.findByLabelText('Code')
        await run()
        expect(await screen.findByText(/ran b\.js/)).toBeInTheDocument()
      })

      it('running as a viewer saves nothing', async () => {
        const fetchMock = setup('viewer')
        await screen.findByLabelText('Code')
        await run()
        await screen.findByText(/ran b\.js/)
        expect(fetchMock.mock.calls.filter(([, init]) => ['PUT', 'PATCH', 'POST', 'DELETE'].includes(init?.method))).toEqual([])
      })
    })

    describe('Ctrl+Enter', () => {
      it.each([['Control', '{Control>}{Enter}{/Control}'], ['Cmd', '{Meta>}{Enter}{/Meta}']])('%s+Enter runs the file', async (_name, keys) => {
        setup('editor')
        await screen.findByLabelText('Code')
        await userEvent.keyboard(keys)
        expect(await screen.findByText(/ran b\.js/)).toBeInTheDocument()
      })

      it('Enter alone does not run', async () => {
        setup('editor')
        await screen.findByLabelText('Code')
        await userEvent.keyboard('{Enter}')
        expect(FakeWorker.instances).toHaveLength(0)
      })

      it('does nothing for a file that cannot run', async () => {
        setup('editor', { ...only(MD), 'GET /code-files/4': body(MD, '# hi') })
        await screen.findByLabelText('Code')
        await userEvent.keyboard('{Control>}{Enter}{/Control}')
        expect(FakeWorker.instances).toHaveLength(0)
      })

      it('is left alone while a dialog is open', async () => {
        setup('editor')
        await screen.findByLabelText('Code')
        await userEvent.click(await screen.findByRole('button', { name: '+ File' }))
        await screen.findByRole('dialog')
        await userEvent.keyboard('{Control>}{Enter}{/Control}')
        expect(FakeWorker.instances).toHaveLength(0)
      })

      it('stops listening when leaving the page', async () => {
        const remove = vi.spyOn(window, 'removeEventListener')
        setup('editor')
        await screen.findByLabelText('Code')
        cleanup()
        expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), true)
      })
    })

    describe('output', () => {
      it('Clear empties the panel', async () => {
        setup('editor')
        await screen.findByLabelText('Code')
        await run()
        await screen.findByText(/ran b\.js/)
        await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
        expect(screen.queryByText(/ran b\.js/)).not.toBeInTheDocument()
        expect(screen.queryByRole('region', { name: 'Run output' })).not.toBeInTheDocument()
      })

      it('each file keeps its own output across tab switches', async () => {
        const JS2 = summary(8, 'c.js', 'javascript')
        setup('editor', { ...only(B, JS2), 'GET /code-files/8': body(JS2, 'y') })
        await screen.findByLabelText('Code')
        await run()
        await screen.findByText(/ran b\.js/)
        await userEvent.click(within(tree()).getByRole('button', { name: 'c.js' }))
        await waitFor(() => expect(screen.getByLabelText('Code')).toHaveValue('y'))
        expect(screen.queryByText(/ran b\.js/)).not.toBeInTheDocument()
        await userEvent.click(screen.getByRole('tab', { name: /b\.js/ }))
        expect(await screen.findByText(/ran b\.js/)).toBeInTheDocument()
      })

      it('Stop ends a run and terminates the worker', async () => {
        FakeWorker.hang = true
        setup('editor')
        await screen.findByLabelText('Code')
        await run()
        await userEvent.click(await screen.findByRole('button', { name: /Stop/ }))
        expect(await screen.findByText(/^Stopped/)).toBeInTheDocument()
        expect(FakeWorker.instances[0].terminated).toBe(true)
      })

      it('running another file stops the first', async () => {
        FakeWorker.hang = true
        const JS2 = summary(8, 'c.js', 'javascript')
        setup('editor', { ...only(B, JS2), 'GET /code-files/8': body(JS2, 'y') })
        await screen.findByLabelText('Code')
        await run()
        await waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
        await userEvent.click(within(tree()).getByRole('button', { name: 'c.js' }))
        await waitFor(() => expect(screen.getByLabelText('Code')).toHaveValue('y'))
        await run()
        expect(FakeWorker.instances[0].terminated).toBe(true)
        expect(FakeWorker.instances).toHaveLength(2)
      })

      it('leaving the page stops the run', async () => {
        FakeWorker.hang = true
        setup('editor')
        await screen.findByLabelText('Code')
        await run()
        await waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
        cleanup()
        expect(FakeWorker.instances[0].terminated).toBe(true)
      })
    })

    it('shows no daily-run wording anywhere', async () => {
      setup('editor')
      await screen.findByLabelText('Code')
      expect(screen.queryByText(/runs? left/i)).not.toBeInTheDocument()
    })
  })

  describe('AI', () => {
    const streamReply = (text) => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ text })}\n\nevent: done\ndata: {}\n\n`))
          controller.close()
        },
      }),
    })

    function withStream(fetchMock, reply) {
      const original = fetchMock.getMockImplementation()
      fetchMock.mockImplementation((url, init) => (url.includes('/stream') ? Promise.resolve(streamReply(reply)) : original(url, init)))
    }

    it('saves first and asks about the open file', async () => {
      const fetchMock = setup('editor', { 'PUT /code-files/2': [200, { code_file: B }] })
      withStream(fetchMock, 'A fine file.')
      await userEvent.type(await screen.findByLabelText('Code'), '!')
      await userEvent.click(screen.getByRole('button', { name: /Explain/ }))
      expect(await screen.findByText('A fine file.')).toBeInTheDocument()
      const methods = fetchMock.mock.calls.filter(([, init]) => ['PUT', 'POST'].includes(init?.method)).map(([url, init]) => `${init.method} ${new URL(url).pathname}`)
      expect(methods).toEqual(['PUT /code-files/2', 'POST /ai/projects/7/stream'])
      const body = JSON.parse(fetchMock.mock.calls.find(([url]) => url.includes('/stream'))[1].body)
      expect(body).toEqual({ action: 'explain', file_id: 2, context_file_ids: [] })
    })

    it('applying a reply changes the editor and autosaves, after the diff', async () => {
      const fetchMock = setup('editor', { 'PUT /code-files/2': [200, { code_file: B }] })
      withStream(fetchMock, '```js\nconst better = 1\n```\n')
      await screen.findByLabelText('Code')
      await userEvent.click(screen.getByRole('button', { name: /Refactor/ }))
      await userEvent.click(await screen.findByRole('button', { name: 'Apply to editor' }))
      expect(screen.getByLabelText('Code')).toHaveValue('console.log(2)')
      const dialog = await screen.findByRole('dialog')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Apply changes' }))
      expect(screen.getByLabelText('Code')).toHaveValue('const better = 1')
      await waitFor(() => expect(calls(fetchMock, 'PUT', '/code-files/2')).toHaveLength(1), { timeout: 3000 })
      expect(sent(fetchMock, 'PUT', '/code-files/2')).toEqual({ content: 'const better = 1' })
    })

    it('viewers can ask but not apply', async () => {
      const fetchMock = setup('viewer')
      withStream(fetchMock, '```js\nconst better = 1\n```\n')
      await screen.findByText('View only')
      await screen.findByLabelText('Code')
      await userEvent.click(screen.getByRole('button', { name: /Refactor/ }))
      expect(await screen.findByRole('button', { name: 'Copy' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Apply to editor' })).not.toBeInTheDocument()
    })
  })

  describe('the agent', () => {
    // stubRoutes for everything, plus a scripted agent stream
    function setupAgent(role, steps, routes = {}) {
      const base = setup(role, {
        'POST /ai/projects/7/agent/runs': [201, { id: 5, status: 'running', limits: { max_steps: 8 } }],
        'POST /ai/agent/runs/5/accepted': [200, { id: 5 }],
        ...routes,
      })
      const queue = [...steps]
      const fetchMock = vi.fn((url, init) => {
        if (new URL(url).pathname === '/ai/agent/runs/5/step') return sseResponse(queue.shift(), { signal: init.signal })
        return base(url, init)
      })
      vi.stubGlobal('fetch', fetchMock)
      return { base, fetchMock }
    }

    it('is only offered to editors', async () => {
      setup('viewer')
      await screen.findByLabelText('Code')
      expect(screen.queryByRole('button', { name: '🤖 Agent' })).not.toBeInTheDocument()
    })

    it('an accepted edit to an open file updates its tab, and a new file joins the tree', async () => {
      const { base } = setupAgent(
        'editor',
        [
          [
            sseFrame('tool_call', { id: 'w1', name: 'write_file', args: { path: 'b.js', content: 'console.log(3)' } }),
            sseFrame('tool_call', { id: 'w2', name: 'write_file', args: { path: 'lib/new.js', content: 'export const x = 1' } }),
            sseFrame('done', { status: 'tool_calls' }),
          ],
          [sseFrame('done', { status: 'finished', summary: 'Done it.' })],
        ],
        {
          'PUT /code-files/2': [200, { code_file: { ...B, updated_at: 'later' } }],
          'POST /projects/7/code/files': [201, { code_file: summary(9, 'lib/new.js', 'javascript') }],
        }
      )
      expect(await screen.findByLabelText('Code')).toHaveValue('console.log(2)')
      await userEvent.click(screen.getByRole('button', { name: '🤖 Agent' }))
      await userEvent.type(screen.getByLabelText('Goal'), 'Change the log')
      await userEvent.click(screen.getByRole('button', { name: '▶ Start' }))
      await screen.findByText('✅ Done')
      // Nothing saved yet
      expect(calls(base, 'PUT', '/code-files/2')).toHaveLength(0)
      const list = screen.getByRole('list', { name: 'Changes to review' })
      await userEvent.click(within(within(list).getByRole('listitem', { name: 'b.js (edit)' })).getByRole('button', { name: 'Accept' }))
      await waitFor(() => expect(screen.getByLabelText('Code')).toHaveValue('console.log(3)'))
      expect(sent(base, 'PUT', '/code-files/2')).toEqual({ content: 'console.log(3)' })
      await userEvent.click(within(within(list).getByRole('listitem', { name: 'lib/new.js (new file)' })).getByRole('button', { name: 'Accept' }))
      expect(await within(tree()).findByRole('button', { name: 'new.js' })).toBeInTheDocument()
      expect(sent(base, 'POST', '/projects/7/code/files')).toEqual({ path: 'lib/new.js', content: 'export const x = 1' })
    })

    it('the agent reads what is in the editor, unsaved text included', async () => {
      const { fetchMock } = setupAgent('editor', [
        [sseFrame('tool_call', { id: 'r1', name: 'read_file', args: { path: 'b.js' } }), sseFrame('done', { status: 'tool_calls' })],
        [sseFrame('done', { status: 'finished', summary: 'ok' })],
      ])
      const editor = await screen.findByLabelText('Code')
      await userEvent.clear(editor)
      await userEvent.type(editor, 'typed')
      await userEvent.click(screen.getByRole('button', { name: '🤖 Agent' }))
      await userEvent.type(screen.getByLabelText('Goal'), 'Read it')
      await userEvent.click(screen.getByRole('button', { name: '▶ Start' }))
      await screen.findByText('✅ Done')
      const steps = fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === '/ai/agent/runs/5/step')
      expect(JSON.parse(steps[1][1].body).results).toEqual([{ id: 'r1', result: { content: 'typed' } }])
    })
  })
})

