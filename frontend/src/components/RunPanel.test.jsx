import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RunPanel from './RunPanel'

const idle = { output: [], outcome: null }

function setup(props) {
  const onClear = vi.fn()
  const view = render(<RunPanel result={idle} running={false} loading={null} onClear={onClear} {...props} />)
  return { onClear, ...view }
}

describe('RunPanel', () => {
  it('takes no space before anything has run', () => {
    const { container } = setup()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows Running while running, with no Clear or Copy', () => {
    setup({ running: true })
    expect(screen.getByText('Running...')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })

  it('shows download progress for the first Python run', () => {
    setup({ running: true, loading: { stage: 'download', received: 3_000_000, total: 12_000_000 } })
    expect(screen.getByText(/Downloading Python, only needed once: 3.0 of 12.0 MB/)).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('value', '3000000')
    expect(bar).toHaveAttribute('max', '12000000')
  })

  it('then that Python is starting', () => {
    setup({ running: true, loading: { stage: 'starting' } })
    expect(screen.getByText('Starting Python...')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it.each([
    ['ok', 'Finished', 'text-success'],
    ['error', 'Failed', 'text-danger'],
    ['timeout', /10 second limit/, 'text-danger'],
    ['output-limit', /100 KB limit/, 'text-danger'],
    ['stopped', 'Stopped', 'muted'],
    ['crashed', /runner failed/, 'text-danger'],
  ])('describes the status %s', (status, text, tone) => {
    setup({ result: { output: [], outcome: { status, durationMs: 12 } } })
    expect(screen.getByText(text instanceof RegExp ? text : new RegExp(`^${text}`))).toHaveClass(tone)
  })

  it.each([[12.4, '12 ms'], [999, '999 ms'], [1234, '1.23 s'], [10004, '10.00 s']])('formats %s as %s', (durationMs, text) => {
    setup({ result: { output: [], outcome: { status: 'ok', durationMs } } })
    expect(screen.getByText(new RegExp(text))).toBeInTheDocument()
  })

  it('marks stderr, renders output as text', () => {
    setup({ result: { output: [{ stream: 'stdout', text: '<b>out</b>' }, { stream: 'stderr', text: 'bad' }], outcome: { status: 'ok', durationMs: 1 } } })
    expect(screen.getByText('<b>out</b>')).toBeInTheDocument()
    expect(screen.getByText('bad')).toHaveClass('text-danger')
  })

  it('says when there was no output, only on success', () => {
    const { rerender } = setup({ result: { output: [], outcome: { status: 'ok', durationMs: 1 } } })
    expect(screen.getByText('No output.')).toBeInTheDocument()
    rerender(<RunPanel result={{ output: [], outcome: { status: 'stopped', durationMs: 1 } }} running={false} loading={null} onClear={vi.fn()} />)
    expect(screen.queryByText('No output.')).not.toBeInTheDocument()
  })

  it('Copy copies stdout and stderr together', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    setup({ result: { output: [{ stream: 'stdout', text: 'a\n' }, { stream: 'stderr', text: 'b\n' }], outcome: { status: 'ok', durationMs: 1 } } })
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('a\nb\n')
  })

  it('has no Copy when there is nothing to copy', () => {
    setup({ result: { output: [], outcome: { status: 'ok', durationMs: 1 } } })
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
  })

  it('Clear asks to clear', async () => {
    const { onClear } = setup({ result: { output: [{ stream: 'stdout', text: 'a' }], outcome: { status: 'ok', durationMs: 1 } } })
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalled()
  })
})
