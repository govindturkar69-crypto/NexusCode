import { describe, it, expect } from 'vitest'
import { buildPreviewDocument, defaultEntry, isHtmlFile, resolveProjectPath } from './preview'

function project(files) {
  return (path) => Promise.resolve(path in files ? files[path] : null)
}

async function build(files, entryPath = 'index.html') {
  const { html, warnings } = await buildPreviewDocument({ entryPath, read: project(files), token: 'tok123' })
  return { html, warnings, doc: new DOMParser().parseFromString(html, 'text/html') }
}

describe('resolveProjectPath', () => {
  it.each([
    ['index.html', 'style.css', 'style.css'],
    ['index.html', './style.css', 'style.css'],
    ['pages/a.html', 'b.css', 'pages/b.css'],
    ['pages/a.html', '../b.css', 'b.css'],
    ['pages/deep/a.html', '../../css/b.css', 'css/b.css'],
    ['pages/a.html', '/css/b.css', 'css/b.css'],
    ['index.html', 'a.css?v=2', 'a.css'],
    ['index.html', 'a.html#top', 'a.html'],
    ['index.html', 'my%20file.css', 'my file.css'],
    ['index.html', 'a//b.css', 'a/b.css'],
    ['index.html', '100%.css', '100%.css'],
  ])('from %s, %s is %s', (from, reference, expected) => {
    expect(resolveProjectPath(from, reference)).toBe(expected)
  })

  it.each([
    'https://cdn.test/a.css', 'http://x.test/a.js', '//cdn.test/a.css', 'data:text/css,a', 'mailto:a@b.test', 'javascript:alert(1)', '#top', '', '   ', '?x=1',
  ])('%s is not a project file', (reference) => {
    expect(resolveProjectPath('index.html', reference)).toBeNull()
  })

  it('cannot climb above the project root', () => {
    expect(resolveProjectPath('index.html', '../secret.css')).toBeNull()
    expect(resolveProjectPath('a/b.html', '../../x.css')).toBeNull()
  })

  it('handles a missing reference', () => {
    expect(resolveProjectPath('index.html', null)).toBeNull()
  })
})

describe('choosing the entry file', () => {
  it('recognises html files', () => {
    expect(isHtmlFile('a.html')).toBe(true)
    expect(isHtmlFile('B.HTM')).toBe(true)
    expect(isHtmlFile('a.html.txt')).toBe(false)
  })

  it.each([
    [['z.html', 'index.html', 'a.py'], 'index.html'],
    [['docs/index.html', 'about.html'], 'docs/index.html'],
    [['a/b/index.html', 'c/index.html'], 'c/index.html'],
    [['zz.html', 'a.html'], 'a.html'],
    [['deep/page.html', 'b.html'], 'b.html'],
    [['main.py'], null],
    [[], null],
  ])('%j gives %s', (paths, expected) => {
    expect(defaultEntry(paths)).toBe(expected)
  })
})

describe('buildPreviewDocument', () => {
  it('inlines linked css and js by path', async () => {
    const { doc, warnings } = await build({
      'index.html': '<html><head><link rel="stylesheet" href="css/site.css"></head><body><script src="js/app.js"></script></body></html>',
      'css/site.css': 'h1 { color: red; }',
      'js/app.js': 'console.log("hi")',
    })
    expect(warnings).toEqual([])
    expect(doc.querySelector('link')).toBeNull()
    expect(doc.querySelector('style[data-from="css/site.css"]').textContent).toBe('h1 { color: red; }')
    const script = doc.querySelector('script[data-from="js/app.js"]')
    expect(script.textContent).toBe('console.log("hi")')
    expect(script.hasAttribute('src')).toBe(false)
  })

  it('resolves paths relative to an entry in a folder', async () => {
    const { doc } = await build({
      'pages/a.html': '<link rel="stylesheet" href="../shared.css"><script src="local.js"></script>',
      'shared.css': 'p{}',
      'pages/local.js': 'var x = 1',
    }, 'pages/a.html')
    expect(doc.querySelector('style[data-from="shared.css"]')).not.toBeNull()
    expect(doc.querySelector('script[data-from="pages/local.js"]')).not.toBeNull()
  })

  it('leaves links to other sites alone', async () => {
    const { doc, warnings } = await build({
      'index.html': '<link rel="stylesheet" href="https://cdn.test/a.css"><script src="https://cdn.test/a.js"></script><img src="https://cdn.test/a.png">',
    })
    expect(doc.querySelector('link').getAttribute('href')).toBe('https://cdn.test/a.css')
    expect(doc.querySelector('script[src]').getAttribute('src')).toBe('https://cdn.test/a.js')
    expect(doc.querySelector('img').getAttribute('src')).toBe('https://cdn.test/a.png')
    expect(warnings).toEqual([])
  })

  it('warns about missing files and drops their tags', async () => {
    const { doc, warnings } = await build({ 'index.html': '<link rel="stylesheet" href="no.css"><script src="no.js"></script>' })
    expect(warnings).toEqual(['Can\'t find no.css, linked from index.html.', 'Can\'t find no.js, loaded by index.html.'])
    expect(doc.querySelector('link')).toBeNull()
    expect(doc.querySelector('script[data-from]')).toBeNull()
  })

  it('throws if the entry is gone', async () => {
    await expect(build({}, 'gone.html')).rejects.toThrow("Can't find gone.html")
  })

  it('code cannot break out of its inlined tag', async () => {
    const { doc } = await build({
      'index.html': '<link rel="stylesheet" href="a.css"><script src="a.js"></script><p id="after">x</p>',
      'a.css': 'a::after { content: "</style><script>bad()</script>"; }',
      'a.js': 'var s = "</script><img src=x onerror=bad()>"; var c = "<!--";',
    })
    expect(doc.querySelector('img')).toBeNull()
    expect(doc.querySelectorAll('script[data-from]')).toHaveLength(1)
    expect(doc.querySelector('#after')).not.toBeNull()
  })

  it('keeps script order and moves deferred scripts after the page', async () => {
    const { doc } = await build({
      'index.html': '<html><head><script src="later.js" defer></script><script src="first.js"></script></head><body><p>content</p><script src="second.js"></script></body></html>',
      'later.js': 'later', 'first.js': 'first', 'second.js': 'second',
    })
    const order = [...doc.querySelectorAll('script[data-from]')].map((s) => s.getAttribute('data-from'))
    expect(order).toEqual(['first.js', 'second.js', 'later.js'])
    expect(doc.querySelector('script[data-from="later.js"]').parentElement.tagName).toBe('BODY')
    expect(doc.querySelector('script[data-from="later.js"]').hasAttribute('defer')).toBe(false)
  })

  it('warns that module imports between files are not supported', async () => {
    const { warnings } = await build({
      'index.html': '<script type="module" src="a.js"></script>',
      'a.js': 'import { x } from "./b.js";\nconsole.log(x)',
      'b.js': 'export const x = 1',
    })
    expect(warnings[0]).toMatch(/a\.js imports other project files/)
  })

  it('does not warn about an ordinary script', async () => {
    const { warnings } = await build({ 'index.html': '<script src="a.js"></script>', 'a.js': 'const important = "./x";' })
    expect(warnings).toEqual([])
  })

  describe('css', () => {
    it('follows @import, once each, even in a cycle', async () => {
      const { doc, warnings } = await build({
        'index.html': '<link rel="stylesheet" href="a.css">',
        'a.css': '@import "b.css";\n.a{}',
        'b.css': '@import url("a.css");\n.b{}',
      })
      const css = doc.querySelector('style').textContent
      expect(css).toContain('.a{}')
      expect(css).toContain('.b{}')
      expect(css).not.toContain('@import')
      expect(warnings).toEqual([])
    })

    it('warns about a missing @import and keeps external ones', async () => {
      const { doc, warnings } = await build({
        'index.html': '<link rel="stylesheet" href="a.css">',
        'a.css': '@import "no.css";\n@import "https://fonts.test/a.css";',
      })
      expect(warnings).toEqual(["Can't find no.css, imported by a.css."])
      expect(doc.querySelector('style').textContent).toContain('https://fonts.test/a.css')
    })

    it('resolves url() in linked css relative to that css file', async () => {
      const { doc } = await build({
        'index.html': '<link rel="stylesheet" href="css/a.css">',
        'css/a.css': 'b { background: url("../img/x.svg"); } i { background: url(../img/x.svg); }',
        'img/x.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
      })
      const css = doc.querySelector('style').textContent
      expect(css.match(/data:image\/svg\+xml/g)).toHaveLength(2)
      expect(css).not.toContain('../img')
    })

    it('processes inline style tags too', async () => {
      const { doc } = await build({ 'index.html': '<style>@import "a.css";</style>', 'a.css': '.a{}' })
      expect(doc.querySelector('style').textContent).toContain('.a{}')
    })
  })

  describe('images', () => {
    it('inlines project svg, and warns about binaries it cannot have', async () => {
      const { doc, warnings } = await build({
        'index.html': '<img id="a" src="logo.svg"><img id="b" src="photo.png">',
        'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      })
      expect(doc.querySelector('#a').getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
      expect(warnings).toEqual(["photo.png can't be shown. The preview only has the project's text files."])
    })
  })

  describe('isolation', () => {
    it('puts the policy and console bridge before any project code', async () => {
      const { doc } = await build({ 'index.html': '<html><head><script>project()</script></head></html>' })
      const [policy, bootstrap, project_] = doc.head.children
      expect(policy.getAttribute('http-equiv')).toBe('Content-Security-Policy')
      expect(bootstrap.textContent).toContain('"tok123"')
      expect(project_.textContent).toBe('project()')
    })

    it('blocks forms and base tags', async () => {
      const { doc } = await build({ 'index.html': '<base href="https://evil.test/"><p>x</p>' })
      expect(doc.querySelector('base')).toBeNull()
      const policy = doc.querySelector('meta[http-equiv]').getAttribute('content')
      expect(policy).toContain("form-action 'none'")
      expect(policy).toContain("base-uri 'none'")
      expect(policy).toContain("default-src 'none'")
    })

    it('starts with a doctype, for standards mode', async () => {
      const { html } = await build({ 'index.html': '<p>x</p>' })
      expect(html.startsWith('<!doctype html>')).toBe(true)
    })
  })
})
