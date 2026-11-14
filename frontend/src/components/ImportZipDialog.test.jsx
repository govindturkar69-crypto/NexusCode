import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImportZipDialog from './ImportZipDialog'
import { downloadProjectZip, uploadProjectZip } from '../api/archive'

// --- the dialog, with the upload faked at the module boundary
vi.mock('../api/archive', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, uploadProjectZip: vi.fn() }
})

const PREVIEW = {
  dry_run: true,
  capacity: 499,
  summary: { new: 2, duplicate: 1, skipped: 2 },
  entries: [
    { path: 'src/app.py', status: 'new', size: 120, reason: null },
    { path: 'docs/notes.md', status: 'new', size: 30, reason: null },
    { path: 'src/main.py', status: 'duplicate', size: 40, reason: 'src/main.py already exists.' },
    { path: '../evil.py', status: 'skipped', size: 5, reason: "'..' can't be used as a file or folder name." },
    { path: 'logo.png', status: 'skipped', size: 900, reason: 'Binary file (only text and code can be imported).' },
  ],
}

const zip = (name = 'starter.zip', size = 2000) => new File([new Uint8Array(size)], name, { type: 'application/zip' })

async function choose(user, file) {
  await user.upload(document.getElementById('zip-file'), file)
}

describe('ImportZipDialog', () => {
  beforeEach(() => vi.mocked(uploadProjectZip).mockReset())

  it('previews the ZIP, lets the user decide on duplicates, then imports', async () => {
    const user = userEvent.setup()
    const onImported = vi.fn()
    vi.mocked(uploadProjectZip)
      .mockResolvedValueOnce(PREVIEW)
      .mockResolvedValueOnce({ dry_run: false, created: ['src/app.py', 'docs/notes.md', 'src/main-2.py'], renamed: ['src/main.py'], skipped: PREVIEW.entries.slice(3), summary: PREVIEW.summary })
    render(<ImportZipDialog projectId="7" onClose={() => {}} onImported={onImported} />)
    await choose(user, zip())
    // The preview: counts, reasons and a choice per duplicate (skip by default)
    expect(await screen.findByText('2 new')).toBeInTheDocument()
    expect(screen.getByText('1 already exist')).toBeInTheDocument()
    expect(screen.getByText('2 skipped')).toBeInTheDocument()
    expect(screen.getByText(/'\.\.' can't be used/)).toBeInTheDocument()
    const choice = screen.getByLabelText('What to do with src/main.py')
    expect(choice).toHaveValue('skip')
    expect(screen.getByRole('button', { name: 'Import 2 files' })).toBeEnabled()
    await user.selectOptions(choice, 'rename')
    await user.click(screen.getByRole('button', { name: 'Import 3 files' }))
    // The real run sends the same file with the choices; the server re-checks everything
    await waitFor(() => expect(uploadProjectZip).toHaveBeenCalledTimes(2))
    const [projectId, file, options] = vi.mocked(uploadProjectZip).mock.calls[1]
    expect(projectId).toBe('7')
    expect(file.name).toBe('starter.zip')
    expect(options).toMatchObject({ dryRun: false, decisions: { 'src/main.py': 'rename' } })
    expect(await screen.findByText(/Imported 3 files \(1 as renamed copies\)\. 2 skipped\./)).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Imported files' })).getAllByRole('listitem')).toHaveLength(3)
    expect(onImported).toHaveBeenCalledOnce()
  })

  it('"Skip all" and "Keep both" set every duplicate at once', async () => {
    const user = userEvent.setup()
    vi.mocked(uploadProjectZip).mockResolvedValueOnce({
      ...PREVIEW,
      entries: [
        { path: 'a.py', status: 'duplicate', size: 1, reason: 'a.py already exists.' },
        { path: 'b.py', status: 'duplicate', size: 1, reason: 'b.py already exists.' },
      ],
    })
    render(<ImportZipDialog projectId="7" onClose={() => {}} />)
    await choose(user, zip())
    await screen.findByText('2 already exist')
    expect(screen.getByRole('button', { name: 'Nothing to import' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Keep both (rename)' }))
    expect(screen.getByLabelText('What to do with a.py')).toHaveValue('rename')
    expect(screen.getByLabelText('What to do with b.py')).toHaveValue('rename')
    expect(screen.getByRole('button', { name: 'Import 2 files' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Skip all' }))
    expect(screen.getByRole('button', { name: 'Nothing to import' })).toBeDisabled()
  })

  it('refuses non-ZIP and oversized files before uploading', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<ImportZipDialog projectId="7" onClose={() => {}} />)
    await choose(user, new File(['x'], 'notes.txt', { type: 'text/plain' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a .zip file.')
    await choose(user, zip('huge.zip', 5 * 1024 * 1024 + 1))
    expect(await screen.findByRole('alert')).toHaveTextContent('the limit is 5 MB')
    expect(uploadProjectZip).not.toHaveBeenCalled()
  })

  it("shows the server's reason when the ZIP is rejected", async () => {
    const user = userEvent.setup()
    vi.mocked(uploadProjectZip).mockRejectedValueOnce(new Error('The ZIP has 400 entries; at most 300 can be imported at once.'))
    render(<ImportZipDialog projectId="7" onClose={() => {}} />)
    await choose(user, zip())
    expect(await screen.findByRole('alert')).toHaveTextContent('at most 300')
    expect(screen.getByRole('button', { name: 'Choose a ZIP' })).toBeEnabled()
  })
})

// --- the real client helpers, against fake transports
describe('archive client', () => {
  it('downloads the export with progress and the server-given file name', async () => {
    const real = await vi.importActual('../api/archive')
    const chunks = [new Uint8Array(60), new Uint8Array(40)]
    let i = 0
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      headers: new Headers({ 'content-length': '100', 'content-disposition': 'attachment; filename="Weather-CLI-2026-11-14.zip"' }),
      body: { getReader: () => ({ read: () => Promise.resolve(i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }) }) },
    })))
    const progress = []
    const save = vi.fn()
    const out = await real.downloadProjectZip(7, { onProgress: (p) => progress.push(p), save })
    expect(fetch.mock.calls[0][0]).toMatch(/\/projects\/7\/export$/)
    expect(progress).toEqual([0.6, 1, 1])
    expect(out).toEqual({ name: 'Weather-CLI-2026-11-14.zip', size: 100 })
    expect(save).toHaveBeenCalledWith(expect.any(Blob), 'Weather-CLI-2026-11-14.zip')
  })

  it('reports a failed export with the server message', async () => {
    const real = await vi.importActual('../api/archive')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ detail: 'Project not found' }) })))
    await expect(real.downloadProjectZip(7)).rejects.toThrow('Project not found')
    expect(downloadProjectZip).toBeDefined()
  })

  it('uploads with progress, the auth header and the choices', async () => {
    const real = await vi.importActual('../api/archive')
    localStorage.setItem('token', 'tok')
    const sent = {}
    class FakeXhr {
      constructor() { this.upload = {}; this.headers = {} }
      open(method, url) { sent.method = method; sent.url = url }
      setRequestHeader(k, v) { this.headers[k] = v; sent.headers = this.headers }
      send(form) {
        sent.form = form
        this.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 })
        this.status = 200
        this.responseText = JSON.stringify({ dry_run: false, created: ['a.py'] })
        this.onload()
      }
    }
    const progress = []
    const data = await real.uploadProjectZip(7, zip(), { dryRun: false, decisions: { 'a.py': 'rename' }, onProgress: (p) => progress.push(p), Xhr: FakeXhr })
    expect(data.created).toEqual(['a.py'])
    expect(sent.method).toBe('POST')
    expect(sent.url).toMatch(/\/projects\/7\/code\/import$/)
    expect(sent.headers.Authorization).toBe('Bearer tok')
    expect(sent.form.get('dry_run')).toBe('false')
    expect(JSON.parse(sent.form.get('decisions'))).toEqual({ 'a.py': 'rename' })
    expect(progress).toEqual([0.5])
  })

  it('turns an error response into an ApiError with the detail', async () => {
    const real = await vi.importActual('../api/archive')
    class FailingXhr {
      constructor() { this.upload = {} }
      open() {}
      setRequestHeader() {}
      send() { this.status = 403; this.responseText = JSON.stringify({ detail: 'Your role (viewer) cannot do this' }); this.onload() }
    }
    await expect(real.uploadProjectZip(7, zip(), { Xhr: FailingXhr })).rejects.toMatchObject({ status: 403, message: 'Your role (viewer) cannot do this' })
  })
})
