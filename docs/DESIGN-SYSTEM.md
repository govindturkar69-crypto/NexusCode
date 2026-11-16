# NexusCode design system

This is the frontend's shared design system: tokens, components and motion. Any new UI is built from these parts. There is no UI library: everything is plain React plus CSS variables, and the icons come from `lucide-react`, imported one icon at a time.

| Layer | Where |
| --- | --- |
| Tokens | `frontend/src/styles/tokens.css` |
| Component styles | `frontend/src/styles/components.css` |
| App shell | `frontend/src/styles/shell.css` |
| Page styles | `frontend/src/styles/theme.css` |
| Motion | `frontend/src/styles/motion.css`, `frontend/src/motion/` |
| Components | `frontend/src/components/ui/` |
| Monaco themes | `frontend/src/editor/monacoThemes.js` |

## Tokens

Every colour, size and duration is a CSS variable on `:root`.

**Themes.**
- `[data-theme="light"]` and `[data-theme="dark"]` swap the colour and shadow tokens. Nothing else changes between themes.
- The inline script in `index.html` sets `data-theme` before the first paint, so the page never flashes the wrong theme. It uses the signed-in user's saved choice, then the shared choice, then the operating-system setting.
- A test (`theme/theme.test.jsx`) checks that both themes define the same tokens.

**Colour.**
- Surfaces: `--color-bg` → `--color-surface` → `--color-surface-raised` (`--color-surface-hover`).
- Borders: `--color-border` and `--color-border-strong`.
- Text: `--color-text`, `--color-text-muted` and `--color-text-subtle`.
- Each status has a solid tone and a `-soft` tint for backgrounds: accent, danger, success and warning.
  - `--color-accent-text` is the accent for text.
  - `--color-on-accent` and `--color-on-danger` are for text on solid fills.
  - `--color-danger-on-soft` is for danger text on the `-soft` tint (badges). In light mode it is a shade darker than `--color-danger`, so it keeps 4.5:1 even on tinted surfaces.
- Also `--color-focus`, `--color-backdrop` and the skeleton colours.
- Every text pair meets **WCAG AA (4.5:1)** on `bg`, `surface` and `surface-raised` in both themes. That includes accent text on its soft tint: light theme #0550ae on the soft accent is 6.2:1.
- After C6, axe finds no violations on any page in either theme.

**Type.**
- System font stacks: `--font-sans` and `--font-mono`. No web fonts and no render-blocking requests.
- Sizes: `--text-2xs` 11 px up to `--text-3xl`, plus a fluid `--text-hero` on the landing page.
- Weights: `--weight-medium`, `--weight-semibold` and `--weight-bold`.

**Space and shape.**
- Spacing: `--space-1` to `--space-8` (4, 8, 12, 16, 24, 32, 48, 64 px).
- Radius: `--radius-sm`, `--radius`, `--radius-lg`, `--radius-xl` and `--radius-full`.
- Shadows: `--shadow-xs` to `--shadow-lg`, plus `--shadow-lift` for a dragged card.

**Layers.** Use these names; never write a raw z-index.

| Token | Value |
| --- | --- |
| `--z-sticky` | 10 |
| `--z-header` | 20 |
| `--z-sidebar` | 30 |
| `--z-dropdown` | 1000 |
| `--z-overlay` | 1100 |
| `--z-modal` | 1200 |
| `--z-toast` | 1300 |
| `--z-tooltip` | 1400 |

**Layout.**
- `--sidebar-width` is 232 px and `--header-height` is 56 px.
- `--touch-target` is 44 px. Buttons, tabs and segmented controls grow to it under `(pointer: coarse)`.

## Components (`components/ui/`)

| Component | Use | Notes |
| --- | --- | --- |
| `Button` | Every action | Variants: `primary`, `secondary`, `ghost`, `subtle`, `danger`, `danger-solid`, `link`. Sizes: `sm`, `lg`, `icon` (icon-only buttons need an `aria-label`). `loading` shows a spinner, sets `aria-busy` and disables the button. `icon` puts an icon before the label. |
| `Input` | Text, password and multiline fields | `label` is required; `hideLabel` keeps it for screen readers only. `error` marks the field invalid and links the message with `aria-describedby`. `type="password"` gets a Show/Hide toggle. |
| `Select` | Labelled native select | Native, so it works with the keyboard and on mobile. |
| `Modal` | Dialogs | Rendered in a portal. Traps focus, locks scrolling and closes on Escape. The close button is last in the Tab order. Sizes: default, `lg`, `wide`. Becomes a bottom sheet below 480 px. |
| `ConfirmDialog` | Destructive confirmations | Wraps `Modal`. Focus starts on Cancel. |
| `Menu` | Dropdown menus (account, project switcher) | Uses menu/menuitem roles. Arrow keys, Home, End, Escape and Tab work, and focus returns to the trigger. If a trigger names itself from its visible text, pass `aria-label={undefined}` after the spread props. |
| `Tooltip` | A short hint on hover or keyboard focus | Shows on focus only when it is `:focus-visible`. Escape hides it. Never put essential information in it. |
| `Toast` / `useToast()` | Confirmations after an action | A polite live region showing at most 4 toasts. Each has a timeout bar that pauses on hover or focus. `useToast()` does nothing outside the provider. |
| `Badge`, `Avatar`, `AvatarStack` | Status chips and people | Avatar colour comes from `collab/colors.js`. Keep that module import-free: anything it imports lands in the main bundle. A test enforces this. |
| `Tabs` | Real tab panels (AI Assistant) | WAI-ARIA tabs with arrow/Home/End keys. Children is a render function `(activeId) => panel`. |
| `Card`, `Page`, `PageHeader` | Layout | `Page` is a `div`, because the shell owns the single `<main>`. `PageHeader` takes `title`, `description` and `actions`. |
| `Skeleton`, `SkeletonText`, `LoadingRegion` | Loading states | Shaped like the content that replaces them, so nothing jumps. `LoadingRegion` adds `role="status"` with a hidden label. |
| `EmptyState`, `ErrorState` | Empty lists and failed loads | Every empty state offers its next action. `ErrorState` uses `role="alert"` and has a Try again button. |
| `Alert`, `Spinner` | Inline messages and progress | Error alerts are `role="alert"`; the other tones are `status`. |

Every page has loading, empty and error states. Its skeleton has the same size as the content that replaces it, so nothing shifts.

## Motion

**Rules.**
- 120–320 ms (`--duration-fast` 120, `--duration-base` 200, `--duration-slow` 320).
- Easing: `--ease-out` for entering, `--ease-in` for leaving.
- Only `transform` and `opacity` are animated.
- Lists stagger by `--stagger` (40 ms per item, capped at 10 items).

**One switch.**
- `data-motion` on `<html>` can be `reduce` or `full`. When it is absent, the page follows `prefers-reduced-motion`.
- Users set it in **Settings → Appearance → Motion** (System / Reduced / Full). It is saved in `localStorage` and applied before the first paint.
- Under reduced motion, `--motion-distance` becomes `0px` and `--motion-scale` becomes `1`. Every slide or zoom then becomes a plain fade, and the shimmer, pulses and blinking stop.
- JavaScript-driven animation checks `motionAllowed()` (`motion/motion.js`).

**CSS utilities** (`styles/motion.css`):
- `.motion-fade-in`, `.motion-rise-in`, `.motion-scale-in`, `.motion-pop`.
- `.motion-stagger`: its children set `style={{ "--i": index }}`.
- `.page-transition`: on route change.
- `.reveal-pending` / `.reveal-in`: used by `useReveal`.

**Helpers** (`motion/`):

| Helper | What it does |
| --- | --- |
| `useReveal()` | Reveals an element once, the first time it scrolls into view. It only hides elements that start below the fold, so first-screen content and LCP never wait for JavaScript. |
| `animateOut(el)` | Exit animation for something its parent unmounts. It animates an inert copy with the Web Animations API. |
| `withViewTransition(fn)` | Runs `fn` inside a View Transition where the browser supports it. |
| `setMotionPreference(v)` | Sets the motion switch: `"reduce"`, `"full"` or `null` (follow the system). |
| `durationMs(token)` | Reads a duration token in milliseconds. |

**No motion library.** CSS keyframes, the Web Animations API and View Transitions cover every case below. A library would add 30–60 kB to every route for nothing.

### Animation inventory

| Where | What | How |
| --- | --- | --- |
| Route change | Content rises in | `.page-transition`, keyed by pathname |
| Theme switch | Crossfade without a flash | View Transition; colour transition as fallback; instant under reduced motion |
| Lists (projects, stats, notifications) | Staggered entrance | `.motion-stagger` |
| Skeletons | Shimmer | `::after` translate; stops under reduced motion |
| Modals | Backdrop fades; panel scales in; exit animated | CSS plus `animateOut` |
| Menus, tooltips | Scale and fade from their anchor | `data-state` open/closing |
| Toasts | Slide in; stack; timeout bar; slide out | `nx-slide-in-right`, `nx-progress` (scaleX) |
| Buttons, inputs | Hover/press/focus; spinner while loading; copy-success check pops | Transitions; `.motion-pop` |
| Kanban | Lifted card while dragging (scale, rotate, shadow); drop settle; new-card entrance; count badge pops; drop column highlights | `task-card--dragging/--dropping/--fresh`, `kanban__column--over` |
| Notifications | Unread badge pops on change; panel and items enter | `.motion-pop` keyed on the count; `.motion-stagger` |
| Editor | Tab hover; agent timeline steps rise in; run result scales in; output fades in | `.motion-rise-in`, `.motion-scale-in` |
| Collaboration | Presence avatars in the status bar; remote cursors | CSS |
| Meeting | Speaking ring pulses (opacity); tiles scale in; status dot blinks while joining or reconnecting | `nx-blink`; steady under reduced motion |
| Landing | Hero staggers in (CSS only, so the LCP text paints immediately); sections reveal once; feature cards lift on hover | `.motion-stagger`, `useReveal`, transitions |

## Accents and contrast

`theme/appearance.js` is the source of truth for five accent presets (blue, the default,
then violet, green, orange and pink) and a high-contrast mode. They are chosen in
Settings > Appearance, kept on this device, and applied as `data-accent` and
`data-contrast` on `<html>`. `index.html` applies them before the first paint, like the
theme. `styles/accents.css` holds the matching token overrides:

- Each accent sets `--color-accent`, `-hover`, `-text`, `-soft`, `--color-on-accent` and
  `--color-focus`.
- High contrast sets stronger text, borders and focus rings.

`theme/appearance.test.jsx` checks that the CSS matches the JS. It also checks WCAG AA for
all 20 combinations (light or dark × accent × contrast):

| What | Minimum |
| --- | --- |
| Body text in high contrast | 7:1 |
| Body text otherwise | 4.5:1 |
| Muted text, subtle text and accent text, on every surface and on the accent tint | 4.5:1 |
| Text on a filled accent button | 4.5:1 |
| The accent as a UI colour (focus rings) | 3:1 |

Add an accent in `ACCENTS`, regenerate the CSS block, and the test covers it.

## Keyboard shortcuts

`shortcuts/shortcuts.js` lists every shortcut once. The `?` overlay (`ShortcutsDialog`,
lazy), tooltips (`<Tooltip shortcut={hint("theme")}>`), menus (`hint` on a menu item) and
the palette read from it. The rules:

- Single keys (`?`, `n`, `/`, `Shift+T`, `g` then a letter) never fire while you type in
  a field or in Monaco (`isTypingTarget`), or while a dialog is open.
- Editor shortcuts use Alt+key (matched by `event.code`, so Mac Option characters work)
  or Ctrl/Cmd+Enter. Monaco leaves both free.
- Show keys with `<Kbd keys={["Mod", "K"]} />`. `Mod` renders as Ctrl, or ⌘ on a Mac.

## Shared pieces added in C12

| Piece | Where | Notes |
| --- | --- | --- |
| `Kbd` | `components/ui/Kbd.jsx` | Keycaps; `"then"` between keys for sequences. |
| `ShortcutsDialog` | `shortcuts/` | Built on `Modal` (`size="lg"`), so it is a bottom sheet on phones. |
| `WelcomeTour` | `onboarding/` | A non-modal checklist in the corner. Escape closes it, and progress is kept per user (`tour.js`). |
| Bottom navigation | `AppShell`, `.bottom-nav` | Under 760 px wide. Targets are 44 px and it respects the safe area. Sets `--bottom-nav-height` so the tour, toasts and the update prompt sit above it. |
| Update prompt | `pwa/register.js` | Plain DOM: no React needed, and not in the main bundle. |
| Dashboard rows | `styles/home.css` | Lazy with the page. |

## Icons

Icons come from `lucide-react` 1.65, imported per icon: `import { Bot } from "lucide-react"`.
- **Decorative icons** get `aria-hidden="true"` and sit next to visible text.
- **Icon-only buttons** need an `aria-label`, and usually a `Tooltip`.
- **GitHub** has no lucide icon, so `components/icons/GithubIcon.jsx` uses the Octicons mark (MIT).
- No emoji are used as icons anywhere.

## Monaco

The editor, the AI diff and the agent diffs use one theme per light/dark × accent ×
contrast (`nexus-dark-blue`, `nexus-light-violet-hc`, and so on). They are defined from
the token values in `editor/monacoThemes.js`, because Monaco cannot read CSS variables.
Pass these two props to any new `<Editor>` or `<DiffEditor>`:

- `beforeMount={defineNexusThemes}`
- `theme={monacoTheme(theme, accent, contrast)}`, all three from `useTheme()`

The editor's text size, word wrap and minimap come from `editor/viewSettings.js`, which
keeps them on this device.

## Bundle rules

- Every route is `lazy()`.
- These libraries may only be reached through a lazy page or a dynamic `import()`: Yjs, Monaco, Recharts, LiveKit, Pyodide and the drag-and-drop library.
- `src/test/bundleBoundaries.test.js` fails if any of them becomes statically reachable from `main.jsx`.
- The numbers are in `docs/UI-AUDIT.md`.
