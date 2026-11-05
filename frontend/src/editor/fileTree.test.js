import { describe, it, expect } from 'vitest'
import { baseName, buildTree, isInFolder, renameFolderPath } from './fileTree'

const file = (path) => ({ id: path, path })
const names = (nodes) => nodes.map((n) => n.name)

describe('buildTree', () => {
  it('nests by slashes, folders first, each level sorted', () => {
    const tree = buildTree(['z.py', 'src/b.py', 'src/deep/c.py', 'src/a.py', 'a.md', 'lib/x.py'].map(file))
    expect(names(tree)).toEqual(['lib', 'src', 'a.md', 'z.py'])
    const src = tree[1]
    expect(src.path).toBe('src')
    expect(names(src.children)).toEqual(['deep', 'a.py', 'b.py'])
    expect(src.children[0].path).toBe('src/deep')
    expect(src.children[0].children[0].file.path).toBe('src/deep/c.py')
  })

  it('is empty with no files', () => {
    expect(buildTree([])).toEqual([])
  })

  it('marks folders with files, at every level', () => {
    const [outer] = buildTree([file('a/b/c.py')])
    expect(outer.hasFiles).toBe(true)
    expect(outer.children[0].hasFiles).toBe(true)
  })

  it('shows empty folders, and the parents they need', () => {
    const tree = buildTree([file('a.py')], ['new/inner'])
    expect(names(tree)).toEqual(['new', 'a.py'])
    expect(tree[0].hasFiles).toBe(false)
    expect(tree[0].children[0].path).toBe('new/inner')
    expect(tree[0].children[0].hasFiles).toBe(false)
  })

  it('does not duplicate an empty folder that now has files', () => {
    const tree = buildTree([file('new/a.py')], ['new'])
    expect(names(tree)).toEqual(['new'])
    expect(tree[0].hasFiles).toBe(true)
  })

  it('an empty folder inside one with files only marks the outer one', () => {
    const [outer] = buildTree([file('a/x.py')], ['a/empty'])
    expect(outer.hasFiles).toBe(true)
    expect(outer.children.find((n) => n.name === 'empty').hasFiles).toBe(false)
  })
})

describe('path helpers', () => {
  it('isInFolder does not match a shared prefix', () => {
    expect(isInFolder('src/a.py', 'src')).toBe(true)
    expect(isInFolder('srcfoo/a.py', 'src')).toBe(false)
    expect(isInFolder('src', 'src')).toBe(false)
  })

  it('baseName', () => {
    expect(baseName('a/b/c.py')).toBe('c.py')
    expect(baseName('c.py')).toBe('c.py')
  })

  it('renameFolderPath moves the folder and what is inside', () => {
    expect(renameFolderPath('a', 'a', 'b')).toBe('b')
    expect(renameFolderPath('a/x', 'a', 'b/c')).toBe('b/c/x')
    expect(renameFolderPath('ab', 'a', 'b')).toBe('ab')
  })
})
