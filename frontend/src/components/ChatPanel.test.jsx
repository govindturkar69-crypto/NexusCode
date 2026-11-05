import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatPanel from './ChatPanel'
import { formatMessageTime, typingText } from '../projects/chat'
import { stubRoutes } from '../test/helpers'

class FakeSocket {
  static instances = []
  constructor(url) {
    this.url = url
    this.readyState = 1
    this.sent = []
    FakeSocket.instances.push(this)
  }
  send(data) { this.sent.push(JSON.parse(data)) }
  close() { this.closed = true }
  receive(frame) { act(() => this.onmessage({ data: JSON.stringify(frame) })) }
}

const ME = { id: 1, username: 'me' }
const MEMBERS = [{ user_id: 1, username: 'me' }, { user_id: 2, username: 'eddie' }]
const msg = (id, username, user_id, extra = {}) => ({
  id, username, user_id, content: `m${id}`, created_at: '2030-01-15T10:30:00+00:00', ...extra,
})

async function setup({ history = [], next = null, props = {}, routes = {} } = {}) {
  const fetchMock = stubRoutes({
    'GET /projects/7/messages': [200, { messages: history, next_cursor: next }],
    'POST /ws-ticket': [200, { ticket: 't', expires_in: 30 }],
    ...routes,
  })
  render(<ChatPanel projectId="7" canPost currentUser={ME} members={MEMBERS} {...props} />)
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(1))
  return { fetchMock, ws: FakeSocket.instances[0], user: userEvent.setup() }
}

describe('ChatPanel', () => {
  beforeEach(() => {
    FakeSocket.instances = []
    vi.stubGlobal('WebSocket', FakeSocket)
  })

  it('shows history oldest first, with timestamps and who sent it', async () => {
    await setup({ history: [msg(2, 'eddie', 2), msg(1, 'me', 1)] })
    const log = await screen.findByRole('log')
    await waitFor(() => expect(log.textContent.indexOf('m1')).toBeLessThan(log.textContent.indexOf('m2')))
    expect(screen.getByText('me (you)')).toBeInTheDocument()
    expect(screen.getByText('eddie')).toBeInTheDocument()
    expect(log.querySelectorAll('time')).toHaveLength(2)
    expect(log.querySelector('time').getAttribute('datetime')).toBe('2030-01-15T10:30:00+00:00')
  })

  it('marks messages from people who left', async () => {
    await setup({ history: [msg(3, 'gone', 9, { author_removed: true }), msg(2, 'eddie', 2)] })
    await screen.findByText('gone')
    expect(screen.getAllByText('removed')).toHaveLength(1)
  })

  it('marks a message live if its author is no longer in the member list', async () => {
    const { ws } = await setup()
    ws.receive({ type: 'message', ...msg(5, 'ghost', 99) })
    expect(screen.getByText('removed')).toBeInTheDocument()
  })

  it('shows who is online from presence frames', async () => {
    const { ws } = await setup()
    expect(screen.getByLabelText('Who is online')).toHaveTextContent('Nobody online')
    ws.receive({ type: 'presence', users: [{ user_id: 1, username: 'me' }, { user_id: 2, username: 'eddie' }] })
    expect(screen.getByLabelText('Who is online')).toHaveTextContent('Online: me, eddie')
  })

  it('shows a typing indicator that clears when the message arrives', async () => {
    const { ws } = await setup()
    ws.receive({ type: 'typing', user_id: 2, username: 'eddie' })
    expect(screen.getByText('eddie is typing...')).toBeInTheDocument()
    ws.receive({ type: 'message', ...msg(6, 'eddie', 2) })
    expect(screen.queryByText('eddie is typing...')).not.toBeInTheDocument()
  })

  it('the typing indicator expires on its own', async () => {
    const { ws } = await setup()
    vi.useFakeTimers()
    try {
      ws.receive({ type: 'typing', user_id: 2, username: 'eddie' })
      expect(screen.getByText('eddie is typing...')).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(4100))
      expect(screen.queryByText('eddie is typing...')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends typing frames at most every few seconds, and the message without a name', async () => {
    const { ws, user } = await setup()
    await user.type(screen.getByLabelText('Message'), 'hello')
    expect(ws.sent.filter((f) => f.type === 'typing')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(ws.sent.at(-1)).toEqual({ content: 'hello' })
    expect(screen.getByLabelText('Message')).toHaveValue('')
  })

  it('load older keeps the order and appends above', async () => {
    const { ws, user } = await setup({
      history: [msg(5, 'me', 1)],
      next: 5,
      routes: { 'GET /projects/7/messages': [[200, { messages: [msg(5, 'me', 1)], next_cursor: 5 }], [200, { messages: [msg(4, 'me', 1), msg(3, 'me', 1)], next_cursor: null }]] },
    })
    expect(ws).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: /Load older/ }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Load older/ })).not.toBeInTheDocument())
    const text = screen.getByRole('log').textContent
    expect(text.indexOf('m3')).toBeLessThan(text.indexOf('m4'))
    expect(text.indexOf('m4')).toBeLessThan(text.indexOf('m5'))
  })

  it('scrolling near the top loads older messages automatically', async () => {
    const { fetchMock } = await setup({
      routes: { 'GET /projects/7/messages': [[200, { messages: [msg(5, 'me', 1)], next_cursor: 5 }], [200, { messages: [], next_cursor: null }]] },
    })
    await screen.findByRole('button', { name: /Load older/ })
    act(() => { screen.getByRole('log').dispatchEvent(new Event('scroll', { bubbles: true })) })
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('before=5'))).toBe(true))
  })

  it('viewers get a note instead of the message box', async () => {
    await setup({ props: { canPost: false } })
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument()
    expect(screen.getByText(/read the chat but not post/)).toBeInTheDocument()
  })

  it('shows server errors and a disconnect notice', async () => {
    const { ws } = await setup()
    ws.receive({ type: 'error', detail: 'Messages can be at most 2000 characters.' })
    expect(screen.getByRole('alert')).toHaveTextContent('at most 2000')
    act(() => ws.onclose())
    expect(screen.getByRole('alert')).toHaveTextContent('Chat disconnected')
    expect(screen.getByLabelText('Who is online')).toHaveTextContent('Nobody online')
  })
})

describe('chat helpers', () => {
  it('typingText', () => {
    expect(typingText([])).toBe('')
    expect(typingText(['a'])).toBe('a is typing...')
    expect(typingText(['a', 'b'])).toBe('a and b are typing...')
    expect(typingText(['a', 'b', 'c'])).toBe('Several people are typing...')
  })

  it('formatMessageTime shows just the time today, the date otherwise', () => {
    const now = new Date(2030, 0, 15, 12, 0)
    const today = formatMessageTime(new Date(2030, 0, 15, 9, 5).toISOString(), now)
    const earlier = formatMessageTime(new Date(2030, 0, 3, 9, 5).toISOString(), now)
    expect(today).not.toMatch(/Jan/)
    expect(earlier).toMatch(/Jan/)
    expect(formatMessageTime(null)).toBe('')
    expect(formatMessageTime('nonsense')).toBe('')
  })
})
