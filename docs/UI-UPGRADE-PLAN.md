# UI upgrade plan (Phase C12)

This plan comes from an audit of the app as it was at `v1.4`. The audit used 138
screenshots of the local demo stack: 23 page states, each at 1440, 768 and 390 px wide
in light and dark. The goal is to go from "polished" to "feels like a premium developer
tool" without breaking anything. There are no backend changes, and everything new is
lazy-loaded.

## What the audit found

**Strong already.** The C6 design system is in good shape. It has:
- one set of tokens and a motion switch;
- skeletons, plus empty and error states on most pages;
- a command palette;
- reduced motion that is respected;
- AA contrast;
- route chunks with idle prefetch.

**Weak spots, most visible first:**

- **First run.** A new account lands on "No projects yet" with a single button. Nothing
  shows what the product can do: chat, the editor, the agent, meetings or the palette.
  The palette is only discoverable through the "Ctrl K" chip.
- **Dashboard.** It shows four totals and a donut. None of it is actionable. It doesn't
  say what's assigned to me, what changed recently or where I was working.
- **Keyboard.** Ctrl+K and Ctrl+Enter exist but are invisible. There is no
  shortcut reference, and no single-key navigation of the kind developer tools have
  (`g p`, `n`, `?`).
- **Board.** The only filter is assignee. There is no priority filter or text search,
  no per-column quick-add, and nothing shows done-versus-total. On a phone the three
  columns scroll sideways, with the next column cut off.
- **Mobile.** Navigation lives behind the hamburger, so it takes two taps to reach
  anything. Dialogs are centred cards that leave the bottom half of a phone unused.
- **Editor chrome.** Font size, word wrap and the minimap are fixed. Tabs only close
  one at a time. The file path appears only as a tooltip.
- **Personalisation.** There is only light or dark. There is no accent choice and no
  high-contrast option.
- **Installability.** There is no manifest, no app icon and no offline fallback.
  Developers expect to "install" a tool like this.

## Top 15 improvements, by impact versus effort

| # | Improvement | Impact | Effort | Why |
| --- | --- | --- | --- | --- |
| 1 | Home dashboard: my tasks, recent projects, recent activity, quick actions | High | M | The first signed-in screen should answer "what do I do next?". All of it is built from existing endpoints. |
| 2 | Welcome tour for new users (skippable, keyboard-accessible, progress saved) | High | M | It turns a blank first run into five clear next steps. |
| 3 | Shortcuts overlay (`?`) plus `g`-navigation, `n` new task, `Alt+N` new file, `Alt+1/2/3` panels | High | S | Keyboard-first is what makes a tool feel "pro". It costs about 2 kB, lazy-loaded. |
| 4 | Board filters (priority, text search) with counts, and a done/total progress bar | High | S | Finding a task on a busy board is the most common action. |
| 5 | Mobile bottom navigation and touch targets of at least 44 px | High | S | One tap to any section on phones. |
| 6 | Sheet-style dialogs on phones | Medium | S | They are thumb-reachable and use the whole screen width. |
| 7 | Accent presets (5) and high-contrast mode, AA in every combination, applied to Monaco | Medium | S | Personalisation that is also an accessibility feature. |
| 8 | Installable PWA: manifest, icons, app-shell service worker, offline page, update prompt | Medium | M | "Install app" on desktop and phone. No API or auth data is ever cached. |
| 9 | Editor view settings (font size, word wrap, minimap), remembered | Medium | S | The most-asked editor preferences. |
| 10 | Editor tabs: "Close others", "Close all", and a path breadcrumb above the code | Medium | S | Less clutter when many files are open, and the file's location is always visible. |
| 11 | Empty states with one clear primary action everywhere (board columns, files, dashboard) | Medium | S | Every blank area tells you what to do. |
| 12 | Hints for shortcuts in tooltips, menus and the palette | Medium | S | Teaches the shortcuts in passing. |
| 13 | Per-column quick-add on the board | Medium | S | Add a task straight into "In progress". |
| 14 | Landing page refreshed with the new screenshots | Low | S | Honest marketing that matches the product. |
| 15 | Kanban card detail as a side drawer, inline title edit, label filter | Low | L | Labels and inline edit need API fields that don't exist (out of scope: no backend changes). The modal remains. |

## Out of scope, and why

- **Labels on tasks, and drag to reorder editor tabs.** Labels need a new column and
  API field, which this phase rules out. Tab drag is low value next to "close others".
- **A separate demo-project button for new users.** Seeding through the existing APIs
  would make about 15 requests and leave half-made projects if one failed. The tour's
  "Create a project" step is the safe version.
- **Self-hosted web fonts.** The app uses system fonts on purpose: there are zero font
  downloads and no layout shift.

## Rules followed

- New UI reuses the tokens, motion tokens and `components/ui` primitives. New shared
  pieces (`Kbd`, `ShortcutsDialog`, `Tour`, `BottomNav`) go in shared folders, not in
  page-only styles.
- The main bundle stays within +5 kB gzip. The tour, the shortcuts dialog and the
  service-worker registration are all lazy.
- `prefers-reduced-motion` and the in-app motion switch govern every new animation.

## Status after C12

| # | Status |
| --- | --- |
| 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 14 | Done |
| 6 | Already in place: dialogs were bottom sheets on phones since C6 |
| 13 | Not done: creating a task can't set its column, so a per-column add would need a second request or an API change |
| 15 | Not done: labels and inline edit need API fields |

**Bundle.** The main JS went from 294.08 kB (94.37 kB gzip) to 306.94 kB (98.68 kB gzip),
which is +4.31 kB gzip. The main CSS went from 12.34 kB to 13.64 kB gzip. Everything else
is in lazy chunks:

| Chunk | Size (gzip) |
| --- | --- |
| Shortcuts overlay | about 1 kB |
| Welcome tour | about 2 kB |
| Service-worker registration | 0.73 kB |
| Dashboard | its page chunk, plus `home.css` |

