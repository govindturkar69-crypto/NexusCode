import { describe, it, expect } from 'vitest'
import { filterByAssignee, isOverdue, localToday, moveTask } from './tasks'

const t = (id, status) => ({ id, status })
const ids = (list, status) => list.filter((x) => x.status === status).map((x) => x.id)

describe('moveTask', () => {
  const board = [t(1, 'todo'), t(2, 'todo'), t(3, 'todo'), t(4, 'done')]

  it('reorders within a column', () => {
    expect(ids(moveTask(board, 3, 'todo', 0), 'todo')).toEqual([3, 1, 2])
    expect(ids(moveTask(board, 1, 'todo', 2), 'todo')).toEqual([2, 3, 1])
    expect(ids(moveTask(board, 1, 'todo', 1), 'todo')).toEqual([2, 1, 3])
  })

  it('moves to an exact spot in another column and changes its status', () => {
    const moved = moveTask(board, 2, 'done', 0)
    expect(ids(moved, 'done')).toEqual([2, 4])
    expect(ids(moved, 'todo')).toEqual([1, 3])
    expect(ids(moveTask(board, 2, 'done', 1), 'done')).toEqual([4, 2])
  })

  it('moves into an empty column', () => {
    expect(ids(moveTask(board, 1, 'in_progress', 0), 'in_progress')).toEqual([1])
  })

  it('does not change the input or lose tasks', () => {
    const before = [...board]
    expect(moveTask(board, 3, 'done', 0)).toHaveLength(4)
    expect(board).toEqual(before)
    expect(moveTask(board, 99, 'done', 0)).toBe(board)
  })
})

describe('isOverdue', () => {
  it('compares dates in the local calendar', () => {
    expect(isOverdue({ due_date: '2030-01-09', status: 'todo' }, '2030-01-10')).toBe(true)
    expect(isOverdue({ due_date: '2030-01-10', status: 'todo' }, '2030-01-10')).toBe(false) // due today isn't late
    expect(isOverdue({ due_date: '2030-01-11', status: 'in_progress' }, '2030-01-10')).toBe(false)
  })

  it('ignores done tasks and tasks without a date', () => {
    expect(isOverdue({ due_date: '2020-01-01', status: 'done' }, '2030-01-10')).toBe(false)
    expect(isOverdue({ due_date: null, status: 'todo' }, '2030-01-10')).toBe(false)
  })

  it('localToday pads month and day', () => {
    expect(localToday(new Date(2030, 0, 5))).toBe('2030-01-05')
  })
})

describe('filterByAssignee', () => {
  const tasks = [{ id: 1, assignee_id: 7 }, { id: 2, assignee_id: null }, { id: 3, assignee_id: 8 }]

  it('filters by member, unassigned, or nothing', () => {
    expect(filterByAssignee(tasks, '')).toHaveLength(3)
    expect(filterByAssignee(tasks, 'unassigned').map((x) => x.id)).toEqual([2])
    expect(filterByAssignee(tasks, '8').map((x) => x.id)).toEqual([3])
  })
})
