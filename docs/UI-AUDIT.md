# UI / UX audit (phase C6)

Baseline taken on 2026-11-14 from the local demo stack (throwaway Postgres seeded
with `scripts/seed_demo.py`, demo accounts only): 21 pages and states, each at 1440,
768 and 390 px, in light and dark (126 screenshots, kept outside the repo). Accessibility
was checked with axe-core 4.14 through Playwright, and load metrics were measured on
the production build. Every number below comes from those runs.

## Baseline numbers

| | Baseline |
|---|---|
| Main bundle (`index-*.js`) | 265.73 kB, 84.91 kB gzipped |
| Main CSS (`index-*.css`) | 20.79 kB, 4.52 kB gzipped |
| axe serious/critical | `color-contrast` 31 nodes on 5 pages; `nested-interactive` 12 (board); `aria-required-children` 2 (editor, critical) |
| axe moderate/minor | `region` 14 nodes on 7 pages; `aria-allowed-role` 2 (AI page) |
| Horizontal scroll at 320 px | none on the 12 pages checked |
| Landing (median of 3 cold loads) | FCP 92 ms, LCP 528 ms, CLS 0, TBT 0 ms, 87 kB JS |
| Editor (median of 3 cold loads) | FCP 84 ms, LCP 704 ms, CLS 0.005, TBT 143 ms, 1283 kB JS (Monaco) |

"Lighthouse" here means the equivalent set measured with Playwright's Performance API
(FCP, LCP, CLS, total blocking time from long tasks, JS transferred): Lighthouse itself
was not installed.

## Problems across the app (ordered by impact)

1. **No app shell.** Every page builds its own header. Navigation is a row of buttons on
   the projects page only (Dashboard, AI Assistant, Connect GitHub and *Log out* side by
   side with page actions); other pages only have a "← Back" link. Theme, notifications
   and settings float in an absolutely positioned corner bar that **collides with page
   headers on phones** (board, editor, meeting) and sits outside any landmark (axe
   `region`, 14 nodes). There is no user menu and no project switcher.
2. **Light-theme users see a dark flash on every load.** The CSS defaults to the dark
   tokens and the theme attribute is only set when the JavaScript runs.
3. **Missing building blocks.** There is no Toast, Skeleton, Spinner, Tooltip,
   Menu/Dropdown, Tabs, EmptyState, ErrorState, Avatar or Badge component, so
   pages improvise: loading is a line of text, errors are raw server messages,
   empty states are a sentence with no action, menus are hand-built divs.
4. **No motion system.** No keyframes, no `prefers-reduced-motion` handling, two ad-hoc
   0.15 s transitions. Modals, menus and new list items appear and disappear instantly,
   so state changes are easy to miss.
5. **Icons are emoji** (62 uses of 39 different emoji in 20 files). They render
   differently on every OS, can't follow the text colour, and mix with text badly.
6. **Typography and styling drift.** Page titles are monospace with terminal-style
   eyebrows (`$ code --edit`); `Inter` is named in the font stack but never loaded (the
   system font always renders); the type scale stops at 16 px, with 24/26/28 px set
   inline; 88 inline `style={{…}}` objects; `src/App.css` is 184 lines of the Vite
   starter template and nothing imports it.
7. **Contrast.** `--color-text-subtle` and hint/placeholder text fail WCAG AA in places
   (axe `color-contrast`, 31 nodes: sign-up hints, board chips and tips, editor, settings).
8. **Colour as the only signal** in a few places: agent change cards (accepted/failed is
   only a border colour), the meeting speaking indicator, the overdue task border.

## Page by page

| Page | Problems | Fix |
|---|---|---|
| Landing | Plain, no product visual, no motion; header has only the theme toggle | Real screenshot in the hero, nav with Sign in / Sign up, scroll-reveal sections, card hover lift |
| Sign in / up, forgot / reset / verify | Google/GitHub buttons and "Forgot password?" pop in after `/auth/options` (layout shift); no password visibility toggle; validation only on submit; terminal eyebrow | Reserve the space while options load; password toggle; inline validation with `aria-describedby`; button loading state |
| Projects | Nav and Log out mixed with actions; create form squeezed to "Project n…" on phones; red Delete on every card; empty state is one sentence; loading is text; errors show "Internal Server Error" with no retry | Shell nav; "New project" button opening a dialog; delete moved into a card menu; illustrated EmptyState with CTA; skeleton cards; ErrorState with Retry |
| Board | **Phone layout bug**: cards clip and overlap the next column, the keyboard tip overlaps the last card, the new-task input shrinks to a tiny box; header links collide with the corner bar; delete buttons nested inside the drag handle (axe `nested-interactive`); drop targets not visible while dragging; members/activity/files/chat stacked below the board make the page very long | Fix column sizing; visible drop zones and a lifted card while dragging; delete moved out of the drag handle; chips with icons; column counts; page sections behind tabs on small screens |
| Task modal | No enter/exit motion; cramped | Dialog with scale/fade, wider form grid, field hints |
| Editor | Monaco's built-in `vs`/`vs-dark` backgrounds don't match the app; no status bar (language, cursor, who is here); presence is text only; tab list fails axe `aria-required-children`; AI panel drops far below the editor on tablet/phone; file tree has no file-type icons | Monaco themes built from the app tokens; status bar with avatars; proper tab roles; collapsible AI side panel; file icons |
| Agent panel | Change state shown only by border colour; timeline items appear abruptly | Status badges with icon + text; timeline steps animate in |
| Chat / activity | Plain lists, no sense of new items | New items slide in; avatars; relative times |
| Notifications | Hand-built dropdown (no menu semantics), overlaps content, badge never draws the eye | Menu component with keyboard support, badge pop when the count changes |
| Meeting | Lobby is a plain card; controls are text + emoji; speaking shown by border colour only | Lobby card with device hints; icon control bar with labels/tooltips; speaking ring with pulse plus an icon |
| Dashboard | Monospace numbers, plain cards | Stat cards from the design system |
| AI Assistant | Mode switch looks like tabs but isn't (axe `aria-allowed-role`) | Real Tabs component |
| Settings | Long single column, little hierarchy | Section cards with headings and descriptions |
| 404 | Terminal styling | EmptyState-style page with a way home |

## Plan

1. **Foundation**: one token set (colours with AA contrast in both themes, type scale,
   spacing, radius, shadows, borders, z-index, motion: 120/200/320 ms, easing, stagger),
   system font stack (no web-font download), theme set before first paint, remove the
   dead `App.css`.
2. **Motion layer**: CSS keyframes/transitions keyed off the tokens, one global switch
   (`data-motion="reduce"` plus `prefers-reduced-motion`), a tiny `useReveal` hook
   (IntersectionObserver) and View Transitions for route changes with a fallback.
   **No motion library**: everything needed is CSS, the Web Animations API and View
   Transitions, so the main bundle doesn't grow for it.
3. **Components**: Button (loading, sizes, icon), Field/Input/Textarea/Select (inline
   errors, password toggle), Modal and ConfirmDialog (animated, focus-trapped), Menu,
   Tooltip, Toast, Badge, Avatar, Card, Tabs, Skeleton, Spinner, EmptyState, ErrorState.
   Icons: `lucide-react`, imported per icon so only the icons used are bundled (no UI
   library).
4. **App shell**, then pages in the order of the table above, then accessibility
   (axe serious/critical to zero), then the after-measurements and screenshots.
