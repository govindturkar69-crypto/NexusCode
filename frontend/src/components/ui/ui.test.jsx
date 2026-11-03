import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Card from './Card'
import ConfirmDialog from './ConfirmDialog'
import Input from './Input'
import Modal from './Modal'

describe('Input', () => {
  it('ties the label and hint to the control', () => {
    render(<Input label="Repository name" hint="Letters only" />)
    const input = screen.getByLabelText('Repository name')
    expect(input).toHaveAccessibleDescription('Letters only')
  })

  it('keeps a hidden label available to screen readers', () => {
    render(<Input label="New task title" hideLabel placeholder="New task title" />)
    expect(screen.getByLabelText('New task title')).toBeInTheDocument()
  })
})

describe('Card', () => {
  it('is keyboard-operable when clickable', async () => {
    const onClick = vi.fn()
    render(<Card onClick={onClick}>Open</Card>)
    const card = screen.getByRole('button', { name: 'Open' })
    card.focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('is a plain container otherwise', () => {
    render(<Card>Static</Card>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

function ModalHarness({ onClose }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open dialog</button>
      {open && (
        <Modal title="Push" onClose={() => { onClose(); setOpen(false) }}>
          <input aria-label="Name" />
          <button>Inside</button>
        </Modal>
      )}
    </>
  )
}

describe('Modal', () => {
  it('is a labelled modal dialog that takes focus and returns it on close', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ModalHarness onClose={onClose} />)
    const opener = screen.getByRole('button', { name: 'Open dialog' })
    await user.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Push' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByLabelText('Name')).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup()
    render(<ModalHarness onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Open dialog' }))
    await user.tab() // input -> Inside
    expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus()
    await user.tab() // wraps back to the input
    expect(screen.getByLabelText('Name')).toHaveFocus()
  })
})

describe('ConfirmDialog', () => {
  it('focuses Cancel first so Enter never deletes by accident', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDialog title="Delete?" message="Gone forever" onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('disables both buttons while working', () => {
    render(<ConfirmDialog title="Delete?" message="x" busy onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Working...' })).toBeDisabled()
  })
})
