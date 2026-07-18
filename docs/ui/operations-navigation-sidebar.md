# Operations navigation and persistent sidebar

## Scope

The global **Operations** item targets `/operations`. That page renders the
existing cross-project Operations dashboard. **Projects** remains `/bids`, and
per-project operational surfaces remain under `/bids/[id]`; this change does
not alter project-scoped routing or data access.

Authenticated requests to `/` continue through the existing proxy rule to
`/bids`. Keeping `/operations` as an explicit protected page prevents an
Operations click from passing through that root redirect and converging on
Projects.

## Shell behavior

The authenticated shell is constrained to the dynamic viewport height. Below
the environment banner and topbar, the desktop rail is a non-shrinking flex
sibling and the main work surface owns vertical scrolling. The rail therefore
remains in the viewport on long pages without overlaying or double-offsetting
content. Hover and persisted pin expansion continue to change the reserved
rail width from 64 to 240 pixels.

Below 768 pixels, the rail remains a fixed off-canvas drawer and does not
reserve horizontal space. While closed it uses `visibility: hidden`, removing
its links from keyboard navigation. The open control exposes `aria-controls`
and `aria-expanded`; opening moves focus to the close control, Tab stays within
the drawer, and Escape/backdrop/close-control dismissal restores focus to the
trigger. Reduced-motion preferences disable rail transitions.

## Local verification

- `npm run test:e2e` uses `AUTH_DISABLED=true` and a throwaway SQLite fixture.
- `npm run test:e2e:auth` uses a separate throwaway SQLite fixture and a
  synthetic credential account to exercise the real Auth.js/proxy redirect.
- Neither suite is staging or production certification.
