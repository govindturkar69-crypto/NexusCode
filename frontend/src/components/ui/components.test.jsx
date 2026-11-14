import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Avatar, { AvatarStack } from './Avatar'
import { initials, textOn } from './avatarColors'
import Badge from './Badge'
import Button from './Button'
import Input from './Input'
import Menu from './Menu'
import Modal from './Modal'
import Select from './Select'
import Skeleton, { LoadingRegion, SkeletonText } from './Skeleton'
import Spinner from './Spinner'
import { EmptyState, ErrorState } from './States'
import Tabs from './Tabs'
import { ToastProvider } from './Toast'
import { useToast } from './toastContext'
import Tooltip from './Tooltip'
import { animateOut } from '../../motion/animateOut'

function setReducedMotion(reduce) {
  document.documentElement.dataset.motion = reduce ? 'reduce' : 'full'
}

describe('Button', () => {
  it('shows a spinner, stays labelled and is disabled while loading', () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button.querySelector('.spinner')).not.toBeNull()
  })

  it('keeps its type, variant and size', () => {
    render(<Button variant="secondary" size="sm" type="submit">Go</Button>)
    const button = screen.getByRole('button', { name: 'Go' })
    expect(button).toHaveAttribute('type', 'submit')
    expect(button.className).toMatch(/btn--secondary/)
    expect(button.className).toMatch(/btn--sm/)
  })
})

describe('Input', () => {
  it('a password field can be shown and hidden, and says which', async () => {
    const user = userEvent.setup()
    render(<Input label="Password" type="password" />)
    const field = screen.getByLabelText('Password')
    expect(field).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(field).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('an error marks the field invalid and is read with it', () => {
    render(<Input label="Email" error="Enter a valid email" hint="We never share it" />)
    const field = screen.getByLabelText('Email')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('Enter a valid email We never share it')
  })
})

describe('Select', () => {
  it('is labelled', () => {
    render(<Select label="Role"><option>viewer</option><option>editor</option></Select>)
    expect(screen.getByLabelText('Role').tagName).toBe('SELECT')
  })
})

describe('Menu', () => {
  beforeEach(() => setReducedMotion(true))

  function TestMenu({ onRename = vi.fn(), onDelete = vi.fn() }) {
    return (
      <Menu
        label="Project actions"
        renderTrigger={(props) => <button {...props}>Open</button>}
        items={[{ label: 'Rename', onSelect: onRename }, { label: 'Delete', tone: 'danger', onSelect: onDelete }]}
      />
    )
  }

  it('opens a menu, moves with the arrow keys and closes with Escape back to the trigger', async () => {
    const user = userEvent.setup()
    render(<TestMenu />)
    const trigger = screen.getByRole('button', { name: 'Project actions' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu', { name: 'Project actions' })
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    await user.keyboard('{ArrowDown}') // wraps
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('runs the chosen item and closes', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(<TestMenu onDelete={onDelete} />)
    await user.click(screen.getByRole('button', { name: 'Project actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('ArrowDown on the trigger opens it', async () => {
    const user = userEvent.setup()
    render(<TestMenu />)
    screen.getByRole('button', { name: 'Project actions' }).focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
})

describe('Tooltip', () => {
  it('describes its element on keyboard focus and hides on Escape', async () => {
    const user = userEvent.setup()
    render(<Tooltip label="Toggle theme"><button aria-label="Theme">T</button></Tooltip>)
    await user.tab()
    const button = screen.getByRole('button', { name: 'Theme' })
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Toggle theme')
    expect(button).toHaveAccessibleDescription('Toggle theme')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})

describe('Toast', () => {
  function Trigger() {
    const toast = useToast()
    return <button onClick={() => toast({ title: 'Project created', tone: 'success', duration: 5000 })}>Make</button>
  }

  it('announces a toast in a polite live region and can be dismissed', async () => {
    setReducedMotion(true)
    const user = userEvent.setup()
    render(<ToastProvider><Trigger /></ToastProvider>)
    await user.click(screen.getByRole('button', { name: 'Make' }))
    const region = screen.getByRole('status', { name: 'Status messages' })
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(within(region).getByText('Project created')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(within(region).queryByText('Project created')).not.toBeInTheDocument()
  })

  it('goes away by itself after its time', () => {
    vi.useFakeTimers()
    setReducedMotion(true)
    render(<ToastProvider><Trigger /></ToastProvider>)
    act(() => screen.getByRole('button', { name: 'Make' }).click())
    expect(screen.getByText('Project created')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(5100))
    expect(screen.queryByText('Project created')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('useToast outside a provider is a harmless no-op', () => {
    render(<Trigger />)
    expect(() => screen.getByRole('button', { name: 'Make' }).click()).not.toThrow()
  })
})

describe('Tabs', () => {
  function TestTabs() {
    const [value, setValue] = useState('board')
    return (
      <Tabs label="Project" value={value} onChange={setValue} tabs={[{ id: 'board', label: 'Board' }, { id: 'chat', label: 'Chat', badge: 3 }]}>
        {(active) => <p>{active} panel</p>}
      </Tabs>
    )
  }

  it('selects with the arrow keys and shows the matching panel', async () => {
    const user = userEvent.setup()
    render(<TestTabs />)
    const board = screen.getByRole('tab', { name: 'Board' })
    expect(board).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Board' })).toHaveTextContent('board panel')
    board.focus()
    await user.keyboard('{ArrowRight}')
    const chat = screen.getByRole('tab', { name: /Chat/ })
    expect(chat).toHaveFocus()
    expect(chat).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('chat panel')
    expect(board).toHaveAttribute('tabindex', '-1')
  })
})

describe('Avatar', () => {
  it('shows initials, is labelled with the name, and picks readable text', () => {
    render(<Avatar name="demo_priya" />)
    const avatar = screen.getByRole('img', { name: 'demo_priya' })
    expect(avatar).toHaveTextContent('DP')
    expect(initials('olivia')).toBe('OL')
    expect(textOn('#2563eb')).toBe('#ffffff')
    expect(textOn('#d97706')).toBe('#0d1117')
  })

  it('a stack has one label and counts the rest', () => {
    render(<AvatarStack names={['a', 'b', 'c', 'd', 'e']} max={3} label="5 people editing" />)
    const stack = screen.getByRole('img', { name: '5 people editing' })
    expect(stack).toHaveTextContent('+2')
  })
})

describe('Badge, Spinner, Skeleton', () => {
  it('a badge carries its text, so colour is not the only signal', () => {
    render(<Badge tone="danger">Overdue</Badge>)
    expect(screen.getByText('Overdue').className).toMatch(/badge--danger/)
  })

  it('a labelled spinner is announced; skeletons are hidden from assistive tech', () => {
    render(
      <>
        <Spinner label="Saving" />
        <LoadingRegion label="Loading projects"><Skeleton /><SkeletonText lines={2} /></LoadingRegion>
      </>,
    )
    expect(screen.getAllByRole('status')).toHaveLength(2) // the spinner and the loading region
    expect(screen.getByText('Saving')).toBeInTheDocument()
    expect(screen.getByText('Loading projects')).toBeInTheDocument()
    expect(document.querySelectorAll('.skeleton[aria-hidden="true"]').length).toBe(3)
  })
})

describe('EmptyState and ErrorState', () => {
  it('an empty state has a heading and its action', () => {
    render(<EmptyState title="No projects yet" action={<button>New project</button>}>Create one to start.</EmptyState>)
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument()
  })

  it('an error state is announced and retries', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<ErrorState title="Couldn't load projects" message="Check your connection." onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load projects")
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalled()
  })
})

describe('exit animations and reduced motion', () => {
  afterEach(() => { delete document.documentElement.dataset.motion })

  it('with reduced motion nothing is left behind to animate', () => {
    setReducedMotion(true)
    const el = document.createElement('div')
    el.animate = vi.fn()
    document.body.appendChild(el)
    animateOut(el)
    expect(el.animate).not.toHaveBeenCalled()
    expect(document.body.children.length).toBe(1)
    el.remove()
  })

  it('with motion, an inert copy fades out and is removed', () => {
    setReducedMotion(false)
    const el = document.createElement('div')
    el.id = 'real'
    el.innerHTML = '<button id="inner">x</button>'
    el.animate = () => {} // jsdom has no Web Animations; the copy gets a spy below
    let animation
    const originalClone = el.cloneNode.bind(el)
    el.cloneNode = (deep) => {
      const ghost = originalClone(deep)
      ghost.animate = vi.fn(() => (animation = { onfinish: null, oncancel: null }))
      return ghost
    }
    animateOut(el, { parent: document.body })
    const ghost = document.body.lastElementChild
    expect(ghost).toHaveAttribute('aria-hidden', 'true')
    expect(ghost.hasAttribute('inert')).toBe(true)
    expect(ghost.querySelector('[id]')).toBeNull() // no duplicate ids
    animation.onfinish()
    expect(ghost.isConnected).toBe(false)
  })

  it('a closed Modal leaves the page with motion, and simply goes with reduced motion', () => {
    setReducedMotion(true)
    const { rerender } = render(<Modal title="T" onClose={() => {}}>x</Modal>)
    expect(screen.getByRole('dialog', { name: 'T' })).toBeInTheDocument()
    rerender(<div />)
    expect(document.querySelectorAll('.modal-backdrop').length).toBe(0)
  })
})
