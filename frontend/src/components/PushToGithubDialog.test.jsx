import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import PushToGithubDialog from './PushToGithubDialog'
import { stubRoutes } from '../test/helpers'

const REPOS = [
  { name: 'mine', full_name: 'me/mine', private: true, default_branch: 'trunk', html_url: 'https://x/mine' },
  { name: 'open', full_name: 'me/open', private: false, default_branch: 'main', html_url: 'https://x/open' },
]
const PUSHED = { message: 'Pushed', repo_url: 'https://x/r', private: true, repo_full_name: 'me/r', branch: 'main', changed: true, files: 2, commit_url: 'https://x/r/commit/abc' }

function setup(routes = {}, props = {}) {
  const fetchMock = stubRoutes(routes)
  const handlers = { beforePush: vi.fn(() => Promise.resolve()), onClose: vi.fn(), onPushed: vi.fn() }
  render(
    <MemoryRouter>
      <PushToGithubDialog projectId="7" fileCount={2} {...handlers} {...props} />
    </MemoryRouter>
  )
  return { fetchMock, ...handlers }
}

const pushBody = (fetchMock) => JSON.parse(fetchMock.mock.calls.find(([url]) => url.includes('push-to-github'))[1].body)

describe('PushToGithubDialog', () => {
  it('a new repository is private by default', async () => {
    const { fetchMock, onPushed } = setup({ 'POST /projects/7/push-to-github': [200, PUSHED] })
    expect(screen.getByRole('checkbox', { name: 'Private repository' })).toBeChecked()
    expect(screen.getByText(/All 2 files go in one commit/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Repository name'), 'fresh')
    await userEvent.click(screen.getByRole('button', { name: 'Push' }))
    await waitFor(() => expect(onPushed).toHaveBeenCalledWith(PUSHED))
    expect(pushBody(fetchMock)).toEqual({ repo_name: 'fresh', existing: false, private: true })
  })

  it('can make it public and choose a branch', async () => {
    const { fetchMock, onPushed } = setup({ 'POST /projects/7/push-to-github': [200, PUSHED] })
    await userEvent.type(screen.getByLabelText('Repository name'), 'fresh')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Private repository' }))
    await userEvent.type(screen.getByLabelText('Branch'), 'dev')
    await userEvent.click(screen.getByRole('button', { name: 'Push' }))
    await waitFor(() => expect(onPushed).toHaveBeenCalled())
    expect(pushBody(fetchMock)).toEqual({ repo_name: 'fresh', existing: false, private: false, branch: 'dev' })
  })

  it('saves unsaved changes before pushing', async () => {
    const order = []
    const beforePush = vi.fn(() => { order.push('saved'); return Promise.resolve() })
    const { fetchMock, onPushed } = setup({ 'POST /projects/7/push-to-github': [200, PUSHED] }, { beforePush })
    await userEvent.type(screen.getByLabelText('Repository name'), 'fresh')
    await userEvent.click(screen.getByRole('button', { name: 'Push' }))
    await waitFor(() => expect(onPushed).toHaveBeenCalled())
    expect(order).toEqual(['saved'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses a bad name without calling the server', async () => {
    const { fetchMock } = setup()
    await userEvent.type(screen.getByLabelText('Repository name'), 'bad name')
    await userEvent.click(screen.getByRole('button', { name: 'Push' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/letters, numbers/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('pushes to an existing repository, defaulting to its default branch', async () => {
    const { fetchMock, onPushed } = setup({
      'GET /me/github/repos': [200, { repos: REPOS }],
      'GET /me/github/repos/mine/branches': [200, { branches: ['trunk', 'dev'] }],
      'POST /projects/7/push-to-github': [200, PUSHED],
    })
    expect(screen.getByRole('button', { name: 'Push' })).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: 'One of my repositories' }))
    expect(await screen.findByRole('option', { name: 'me/mine (private)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'me/open' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Private repository' })).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Repository'), 'mine')
    expect(screen.getByLabelText('Branch')).toHaveValue('trunk')
    await waitFor(() => expect(document.querySelectorAll('#push-branches option')).toHaveLength(2))

    await userEvent.click(screen.getByRole('button', { name: 'Push' }))
    await waitFor(() => expect(onPushed).toHaveBeenCalledWith(PUSHED))
    expect(pushBody(fetchMock)).toEqual({ repo_name: 'mine', existing: true, branch: 'trunk' })
    expect(screen.getByText(/Files only on GitHub are kept/)).toBeInTheDocument()
  })

  it('explains when there are no repositories', async () => {
    setup({ 'GET /me/github/repos': [200, { repos: [] }] })
    await userEvent.click(screen.getByRole('radio', { name: 'One of my repositories' }))
    expect(await screen.findByText(/no repositories yet/)).toBeInTheDocument()
  })

  it('links to Settings when GitHub is not connected', async () => {
    setup({ 'GET /me/github/repos': [400, { detail: 'GitHub account not connected' }] })
    await userEvent.click(screen.getByRole('radio', { name: 'One of my repositories' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub account not connected')
    expect(screen.getByRole('link', { name: 'Connect it in Settings.' })).toHaveAttribute('href', '/settings')
  })

  it('shows a push failure and lets you try again', async () => {
    const { onPushed } = setup({
      'POST /projects/7/push-to-github': [
        [400, { detail: 'Could not create the repository: name already exists on this account' }],
        [200, PUSHED],
      ],
    })
    await userEvent.type(screen.getByLabelText('Repository name'), 'dup')
    await userEvent.click(screen.getByRole('button', { name: 'Push' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    await userEvent.click(screen.getByRole('button', { name: 'Push' }))
    await waitFor(() => expect(onPushed).toHaveBeenCalled())
  })

  it('does not push if saving failed', async () => {
    const beforePush = vi.fn(() => Promise.reject(new Error('Save failed first')))
    const { fetchMock } = setup({}, { beforePush })
    await userEvent.type(screen.getByLabelText('Repository name'), 'fresh')
    await userEvent.click(screen.getByRole('button', { name: 'Push' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed first')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
