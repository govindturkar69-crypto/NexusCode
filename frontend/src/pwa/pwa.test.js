import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { canRegister, registerServiceWorker, showUpdatePrompt } from './register'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf-8')

// ---------------------------------------------------------------- registration

function fakeWorker(state = 'installed') {
  const listeners = {}
  return { state, postMessage: vi.fn(), addEventListener: (type, fn) => { listeners[type] = fn }, fire(type) { listeners[type]?.() } }
}

function fakeWindow({ controller = null, waiting = null } = {}) {
  const swListeners = {}
  const regListeners = {}
  const registration = { waiting, installing: null, update: vi.fn(() => Promise.resolve()), addEventListener: (type, fn) => { regListeners[type] = fn } }
  const serviceWorker = {
    controller,
    register: vi.fn(() => Promise.resolve(registration)),
    addEventListener: (type, fn) => { swListeners[type] = fn },
  }
  const win = {
    navigator: { serviceWorker },
    isSecureContext: true,
    location: { reload: vi.fn() },
    setInterval: vi.fn(),
    document: { visibilityState: 'visible', addEventListener: vi.fn() },
  }
  return { win, registration, serviceWorker, fireSw: (type) => swListeners[type]?.(), fireReg: (type) => regListeners[type]?.() }
}

describe('service worker registration', () => {
  it('needs a browser with service workers in a secure context', () => {
    expect(canRegister({ navigator: {} })).toBe(false)
    expect(canRegister({ navigator: { serviceWorker: {} }, isSecureContext: false })).toBe(false)
    expect(canRegister({ navigator: { serviceWorker: {} }, isSecureContext: true })).toBe(true)
  })

  it('registers /sw.js without the HTTP cache, and checks for new deploys', async () => {
    const { win, serviceWorker } = fakeWindow()
    await registerServiceWorker({ win })
    expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
    expect(win.setInterval).toHaveBeenCalled()
  })

  it('a first install offers nothing and never reloads the page', async () => {
    const { win, fireSw } = fakeWindow({ controller: null, waiting: fakeWorker() })
    const onUpdate = vi.fn()
    await registerServiceWorker({ win, onUpdate })
    fireSw('controllerchange')
    expect(onUpdate).not.toHaveBeenCalled()
    expect(win.location.reload).not.toHaveBeenCalled()
  })

  it('a waiting new version is offered; it takes over only when asked, then reloads once', async () => {
    const waiting = fakeWorker()
    const { win, fireSw } = fakeWindow({ controller: {}, waiting })
    const onUpdate = vi.fn()
    await registerServiceWorker({ win, onUpdate })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(waiting.postMessage).not.toHaveBeenCalled()
    onUpdate.mock.calls[0][0]()
    expect(waiting.postMessage).toHaveBeenCalledWith('SKIP_WAITING')
    fireSw('controllerchange')
    fireSw('controllerchange')
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  it('a version found while the page is open is offered once it has installed', async () => {
    const { win, registration, fireReg } = fakeWindow({ controller: {} })
    const onUpdate = vi.fn()
    await registerServiceWorker({ win, onUpdate })
    const worker = fakeWorker('installing')
    registration.installing = worker
    fireReg('updatefound')
    expect(onUpdate).not.toHaveBeenCalled()
    worker.state = 'installed'
    worker.fire('statechange')
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('update prompt', () => {
  afterEach(() => document.querySelectorAll('.update-prompt').forEach((el) => el.remove()))

  it('offers Reload and Later, politely, once', () => {
    const apply = vi.fn()
    showUpdatePrompt(apply)
    showUpdatePrompt(apply)
    const bars = document.querySelectorAll('.update-prompt')
    expect(bars).toHaveLength(1)
    expect(bars[0]).toHaveAttribute('role', 'status')
    const [reload, later] = bars[0].querySelectorAll('button')
    reload.click()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(reload).toBeDisabled()
    later.click()
    expect(document.querySelector('.update-prompt')).toBeNull()
  })
})

// ---------------------------------------------------------------- sw.js itself

// Runs public/sw.js against fake caches and fetch, the way a browser would
function loadWorker({ online = true } = {}) {
  const handlers = {}
  const stores = new Map()
  const openCache = (name) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)
    return {
      addAll: (urls) => Promise.all(urls.map((u) => store.set(u, `cached ${u}`))),
      match: (req) => Promise.resolve(store.get(typeof req === 'string' ? req : new URL(req.url).pathname)),
      put: (req, res) => { store.set(new URL(req.url).pathname, res); return Promise.resolve() },
    }
  }
  const caches = {
    open: (name) => Promise.resolve(openCache(name)),
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name) => Promise.resolve(stores.delete(name)),
    match: (url) => Promise.resolve([...stores.values()].map((s) => s.get(url)).find(Boolean)),
  }
  const network = vi.fn((req) => (online ? Promise.resolve({ ok: true, type: 'basic', from: 'network', url: req.url, clone() { return this } }) : Promise.reject(new TypeError('offline'))))
  const self = {
    location: { origin: 'https://app.test' },
    addEventListener: (type, fn) => { handlers[type] = fn },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(() => Promise.resolve()) },
  }
  new Function('self', 'caches', 'fetch', read('../../public/sw.js'))(self, caches, network)

  async function fetchEvent(url, { mode = 'cors', method = 'GET', headers = {} } = {}) {
    let responded = null
    const request = { url, mode, method, headers: { has: (k) => k in headers } }
    handlers.fetch({ request, respondWith: (p) => { responded = p } })
    return responded ? { intercepted: true, response: await responded } : { intercepted: false }
  }
  async function lifecycle(type) {
    let wait
    handlers[type]({ waitUntil: (p) => { wait = p }, data: type === 'message' ? 'SKIP_WAITING' : undefined })
    await wait
  }
  return { self, stores, network, fetchEvent, lifecycle, handlers }
}

describe('sw.js: the app shell only, never stale code', () => {
  it('pages always come from the network', async () => {
    const sw = loadWorker()
    await sw.lifecycle('install')
    const { intercepted, response } = await sw.fetchEvent('https://app.test/projects/1', { mode: 'navigate' })
    expect(intercepted).toBe(true)
    expect(response.from).toBe('network')
  })

  it('offline, pages fall back to the offline page', async () => {
    const sw = loadWorker({ online: false })
    await sw.lifecycle('install')
    const { response } = await sw.fetchEvent('https://app.test/dashboard', { mode: 'navigate' })
    expect(response).toBe('cached /offline.html')
  })

  it('never touches the API, other origins, writes or authorised requests', async () => {
    const sw = loadWorker()
    expect((await sw.fetchEvent('https://api.example.com/projects')).intercepted).toBe(false)
    expect((await sw.fetchEvent('https://app.test/assets/index-abc.js', { method: 'POST' })).intercepted).toBe(false)
    expect((await sw.fetchEvent('https://app.test/assets/index-abc.js', { headers: { Authorization: 'Bearer x' } })).intercepted).toBe(false)
    expect((await sw.fetchEvent('https://app.test/pyodide/0.29.0/pyodide.mjs')).intercepted).toBe(false)
  })

  it('caches content-hashed /assets files under this build\'s name', async () => {
    const sw = loadWorker()
    await sw.fetchEvent('https://app.test/assets/index-abc.js')
    await sw.fetchEvent('https://app.test/assets/index-abc.js')
    expect(sw.network).toHaveBeenCalledTimes(1)
    expect([...sw.stores.keys()].some((name) => name.startsWith('nexus-assets-'))).toBe(true)
  })

  it('a new build deletes the old caches, and waits to be asked before taking over', async () => {
    const sw = loadWorker()
    sw.stores.set('nexus-shell-oldbuild', new Map())
    sw.stores.set('nexus-assets-oldbuild', new Map())
    sw.stores.set('someone-elses-cache', new Map())
    await sw.lifecycle('install')
    expect(sw.self.skipWaiting).not.toHaveBeenCalled()
    await sw.lifecycle('activate')
    expect([...sw.stores.keys()].sort()).toEqual(['nexus-shell-__BUILD_ID__', 'someone-elses-cache'])
    sw.handlers.message({ data: 'SKIP_WAITING' })
    expect(sw.self.skipWaiting).toHaveBeenCalled()
  })

  it('the build stamps one id into it, and Vercel never caches it', () => {
    expect(read('../../public/sw.js').match(/__BUILD_ID__/g)).toHaveLength(1)
    const vercel = JSON.parse(read('../../vercel.json'))
    const rule = vercel.headers.find((r) => r.source === '/sw.js')
    expect(rule.headers.find((h) => h.key === 'Cache-Control').value).toMatch(/no-cache/)
  })

  it('the manifest is installable', () => {
    const manifest = JSON.parse(read('../../public/manifest.webmanifest'))
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true)
    expect(read('../../index.html')).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
  })
})
