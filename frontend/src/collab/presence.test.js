import { describe, it, expect } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { cssString, cursorStyles, describePeople, peopleIn, peopleSignature, safeColor } from './presence'

// An awareness with these remote states (client id -> state), plus our own
function awarenessWith(remote, self = { user: { name: 'me', color: '#111111' } }) {
  const awareness = new Awareness(new Y.Doc())
  awareness.setLocalState(self)
  for (const [clientId, state] of Object.entries(remote)) awareness.states.set(Number(clientId), state)
  return awareness
}

describe('presence', () => {
  it('lists the other people once each, sorted, without you', () => {
    const awareness = awarenessWith({
      11: { user: { name: 'bob', color: '#00ff00', role: 'editor' } },
      12: { user: { name: 'alice', color: '#ff0000', role: 'editor' } },
      13: { user: { name: 'bob', color: '#00ff00', role: 'editor' } }, // bob's second tab
      14: { user: { name: 'vera', color: '#0000ff', role: 'viewer' } },
      15: { cursor: 1 }, // no user: ignored
    })
    expect(peopleIn(awareness).map((p) => [p.name, p.role])).toEqual([['alice', 'editor'], ['bob', 'editor'], ['vera', 'viewer']])
  })

  it('the signature changes when people come and go, not when they move', () => {
    const before = peopleSignature(peopleIn(awarenessWith({ 1: { user: { name: 'a', color: '#123456' }, selection: 1 } })))
    const moved = peopleSignature(peopleIn(awarenessWith({ 1: { user: { name: 'a', color: '#123456' }, selection: 9 } })))
    const joined = peopleSignature(peopleIn(awarenessWith({ 1: { user: { name: 'a', color: '#123456' } }, 2: { user: { name: 'b', color: '#123456' } } })))
    expect(moved).toBe(before)
    expect(joined).not.toBe(before)
  })

  it("draws each remote cursor in its person's colour, with their name", () => {
    const css = cursorStyles(awarenessWith({ 21: { user: { name: 'alice', color: '#ff0000' } } }))
    expect(css).toContain('.yRemoteSelection-21 { background-color: #ff000033; }')
    expect(css).toContain('.yRemoteSelectionHead-21 {')
    expect(css).toContain('content: "alice"')
    expect(css).not.toMatch(/yRemoteSelection-\d+ .*#111111/) // not your own
  })

  it('never lets a name or colour escape into the stylesheet', () => {
    const css = cursorStyles(awarenessWith({ 31: { user: { name: 'x" } body { display: none } .a { content: "', color: 'red; } body { display:none' } } }))
    expect(css).not.toContain('display:none')
    expect(css).toContain('#888888')
    expect(css).toContain('content: "x\\" } body { display: none } .a { content: \\""')
  })

  it('helpers', () => {
    expect(safeColor('#abcdef')).toBe('#abcdef')
    expect(safeColor('#abc')).toBe('#888888')
    expect(safeColor(undefined)).toBe('#888888')
    const backslash = String.fromCharCode(92)
    expect(cssString(`a${backslash}b"c\n</style>`)).toBe(`"a${backslash}${backslash}b${backslash}"c /style"`)
    expect(describePeople([])).toBe('')
    expect(describePeople([{ name: 'a' }])).toBe('a is here')
    expect(describePeople([{ name: 'a' }, { name: 'b', role: 'viewer' }])).toBe('a and b (viewing) are here')
    expect(describePeople([{ name: 'a' }, { name: 'b' }, { name: 'c' }])).toBe('a, b and c are here')
  })
})
