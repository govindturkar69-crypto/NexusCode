import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Landing from './Landing'
import { FEATURES, PAGE_TITLE, REPO_URL, SHOTS } from '../landing/content'
import HomeRoute from '../components/HomeRoute'
import AuthProvider from '../auth/AuthProvider'
import ThemeProvider from '../theme/ThemeProvider'
import { fakeJwt, inOneHour, stubRoutes } from '../test/helpers'

function renderAt(path = '/') {
  // The signed-in case loads /me, like the real app
  stubRoutes({ 'GET /me': [200, { id: 1, username: 'alice' }] })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <ThemeProvider>
          <Routes>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/projects" element={<p>Your projects</p>} />
            <Route path="/login" element={<p>Login page</p>} />
          </Routes>
        </ThemeProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('Landing page', () => {
  afterEach(() => localStorage.clear())

  it('shows the pitch, one h1, and a heading for each section', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    for (const name of ['Features', 'How it works', 'Built with', 'Try it with your team']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
    }
  })

  it('lists every feature with its own heading', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>)
    const list = screen.getByRole('heading', { level: 2, name: 'Features' }).nextElementSibling
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(FEATURES.length)
    for (const feature of FEATURES) {
      expect(within(list).getByRole('heading', { level: 3, name: new RegExp(feature.title) })).toBeInTheDocument()
    }
    expect(screen.getByText(/Group video meetings/)).toBeInTheDocument()
  })

  it('links to sign up, sign in and the source code', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Sign up free' })).toHaveAttribute('href', '/login?mode=signup')
    expect(screen.getAllByRole('link', { name: 'Sign in' })[0]).toHaveAttribute('href', '/login')
    const github = screen.getByRole('link', { name: /View on GitHub/ })
    expect(github).toHaveAttribute('href', REPO_URL)
    expect(github).toHaveAttribute('target', '_blank')
    expect(github).toHaveAttribute('rel', 'noopener noreferrer')
    expect(github).toHaveAccessibleName('View on GitHub (opens in a new tab)')
  })

  it('sets the page title while it is shown', () => {
    document.title = 'before'
    const { unmount } = render(<MemoryRouter><Landing /></MemoryRouter>)
    expect(document.title).toBe(PAGE_TITLE)
    unmount()
    expect(document.title).toBe('before')
  })

  it('says honestly that free hosting can be slow to wake', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>)
    expect(screen.getByText(/first request can take up to a minute/)).toBeInTheDocument()
  })
})

describe('the "/" route', () => {
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('shows the landing page to signed-out visitors, with the theme toggle', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/Plan, write, run and ship code/)
    expect(screen.getByRole('button', { name: /theme/i })).toBeInTheDocument()
  })

  it('sends signed-in users to their projects', () => {
    localStorage.setItem('token', fakeJwt({ sub: 'alice', exp: inOneHour() }))
    renderAt('/')
    expect(screen.getByText('Your projects')).toBeInTheDocument()
  })

  it('treats an expired session as signed out', async () => {
    localStorage.setItem('token', fakeJwt({ sub: 'alice', exp: 1 }))
    renderAt('/')
    expect(await screen.findByRole('link', { name: 'Sign up free' })).toBeInTheDocument()
  })
})

describe('index.html meta tags', () => {
  const html = readFileSync('index.html', 'utf-8')

  it('points og:image at a file that ships with the site', () => {
    expect(existsSync('public/og-image.png')).toBe(true)
  })
  it('only shows screenshots that ship with the site, lazily and with alt text', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>)
    const images = screen.getAllByRole('img', { name: SHOTS[0].alt })
    expect(images).toHaveLength(2) // one per theme; CSS shows one
    for (const img of images) {
      expect(img).toHaveAttribute('loading', 'lazy')
      expect(existsSync(`public${img.getAttribute('src')}`)).toBe(true)
    }
    for (const shot of SHOTS) {
      for (const theme of ['light', 'dark']) expect(existsSync(`public/landing/${shot.id}-${theme}.webp`)).toBe(true)
    }
  })
  it.each([
    ['name="description"'],
    ['rel="canonical" href="https://nexus-code-chi.vercel.app/"'],
    ['property="og:title"'],
    ['property="og:description"'],
    ['property="og:url" content="https://nexus-code-chi.vercel.app/"'],
    ['property="og:type" content="website"'],
    ['name="twitter:card" content="summary_large_image"'],
    ['property="og:image" content="https://nexus-code-chi.vercel.app/og-image.png"'],
  ])('has %s', (fragment) => {
    expect(html).toContain(fragment)
  })
})
