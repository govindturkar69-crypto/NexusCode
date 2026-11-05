import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RunPanel from './RunPanel'
import { stubRoutes } from '../test/helpers'

const FILE = { id: 3, path: 'main.py', language: 'python' }
const INFO = { enabled: true, languages: ['python', 'javascript'], remaining_today: 5 }
const RESULT = {
  status: 'Accepted', succeeded: true, timed_out: false, stdout: 'hello\n', stderr: '', compile_output: '',
  exit_code: 0, time_seconds: 0.01, memory_kb: 100, truncated: false, remaining_today: 4,
}

function setup({ routes = {}, ...props } = {}) {
  const fetchMock = stubRoutes(routes)
  const handlers = { beforeRun: vi.fn(() => Promise.resolve()), onRemaining: vi.fn() }
  render(<RunPanel file={FILE} info={INFO} {...handlers} {...props} />)
  return { fetchMock, ...handlers }
}

const clickRun = () => userEvent.click(screen.getByRole('button', { name: '▶ Run' }))

describe('RunPanel', () => {
  it('runs after saving and shows output, exit code and time', async () => {
    const { fetchMock, beforeRun, onRemaining } = setup({ routes: { 'POST /code-files/3/run': [200, RESULT] } })
    expect(screen.getByText('5 runs left today')).toBeInTheDocument()
    await clickRun()
    expect(await screen.findByText(/Accepted · exit code 0 · 0.01s/)).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(beforeRun).toHaveBeenCalledTimes(1)
    expect(onRemaining).toHaveBeenCalledWith(4)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ stdin: '' })
  })

  it('sends program input', async () => {
    const { fetchMock } = setup({ routes: { 'POST /code-files/3/run': [200, RESULT] } })
    await userEvent.click(screen.getByRole('button', { name: 'Input' }))
    await userEvent.type(screen.getByLabelText('Program input (stdin)'), '42')
    await clickRun()
    await screen.findByText(/Accepted/)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ stdin: '42' })
  })

  it('shows stderr and a failed status', async () => {
    setup({ routes: { 'POST /code-files/3/run': [200, { ...RESULT, succeeded: false, status: 'Runtime Error (NZEC)', exit_code: 1, stdout: '', stderr: 'Traceback' }] } })
    await clickRun()
    expect(await screen.findByText(/Runtime Error \(NZEC\) · exit code 1/)).toHaveClass('text-danger')
    expect(screen.getByText('Traceback')).toHaveClass('text-danger')
  })

  it('shows compiler errors when there is no exit code or time', async () => {
    setup({ routes: { 'POST /code-files/3/run': [200, { ...RESULT, succeeded: false, status: 'Compilation Error', exit_code: null, time_seconds: null, stdout: '', compile_output: 'bad syntax' }] } })
    await clickRun()
    expect(await screen.findByText('Compilation Error')).toBeInTheDocument()
    expect(screen.getByText('bad syntax')).toBeInTheDocument()
  })

  it('says when there was no output, and when it was cut short', async () => {
    setup({ routes: { 'POST /code-files/3/run': [[200, { ...RESULT, stdout: '' }], [200, { ...RESULT, truncated: true }]] } })
    await clickRun()
    expect(await screen.findByText('No output.')).toBeInTheDocument()
    await clickRun()
    expect(await screen.findByText(/cut short/)).toBeInTheDocument()
  })

  it('shows server errors such as the daily limit', async () => {
    setup({ routes: { 'POST /code-files/3/run': [429, { detail: "You've used your 15 code runs for today." }] } })
    await clickRun()
    expect(await screen.findByRole('alert')).toHaveTextContent('15 code runs')
  })

  it('does not run if saving failed', async () => {
    const { fetchMock } = setup({ beforeRun: vi.fn(() => Promise.reject(new Error('Could not save'))) })
    await clickRun()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('disables Run for file types it cannot run', () => {
    setup({ file: { ...FILE, language: 'markdown' } })
    expect(screen.getByRole('button', { name: '▶ Run' })).toBeDisabled()
    expect(screen.getByText("This file type can't be run.")).toBeInTheDocument()
  })

  it('disables Run when the server has no key', () => {
    setup({ info: { ...INFO, enabled: false } })
    expect(screen.getByRole('button', { name: '▶ Run' })).toBeDisabled()
    expect(screen.getByText(/isn't set up/)).toBeInTheDocument()
  })

  it('disables Run with none left today', () => {
    setup({ info: { ...INFO, remaining_today: 0 } })
    expect(screen.getByRole('button', { name: '▶ Run' })).toBeDisabled()
    expect(screen.getByText('0 runs left today')).toBeInTheDocument()
  })

  it('shows Running while waiting', async () => {
    let finish
    const beforeRun = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    setup({ beforeRun, routes: { 'POST /code-files/3/run': [200, RESULT] } })
    await clickRun()
    expect(screen.getByRole('button', { name: 'Running...' })).toBeDisabled()
    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: '▶ Run' })).toBeEnabled())
  })

  it('renders nothing until the info has loaded', () => {
    const { container } = render(<RunPanel file={FILE} info={null} beforeRun={vi.fn()} onRemaining={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
