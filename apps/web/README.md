# MDM web dashboard (`apps/web`)

Admin dashboard for the MDM platform. Vite + React 19 + TypeScript (strict) + Tailwind CSS v4.
The contract with the API is [`docs/PROTOCOL.md`](../../docs/PROTOCOL.md); `src/lib/types.ts` mirrors it.

## Run

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api and /ws to http://localhost:4000
npm run build    # tsc -b + vite build -> dist/ (served by the API in production)
```

All requests use relative URLs (`/api/...`, WebSocket URL derived from `location`), so the app works
behind the dev proxy and when the API serves `dist/` on the same origin.

## Layout

| Path | What |
|---|---|
| `src/lib/api.ts` | Typed fetch client, `ApiError`, in-memory access token, single-flight refresh + retry on `token_expired` |
| `src/lib/ws.ts` | Single admin WebSocket: ticket per connect, jittered backoff, typed `on()` / `send()`, diagnostics |
| `src/lib/rtc.ts` | Receive-only WebRTC peer for screen sessions (offer/answer/ICE over WS, re-offer on drop, stats) |
| `src/lib/types.ts`, `labels.ts`, `format.ts` | Protocol types, status labels/tones, formatting helpers |
| `src/state/` | Auth, theme, permission catalog, live fleet store (zustand) fed by WS events |
| `src/components/ui/` | Hand-built primitives (Button, Card, Badge, Dialog, ConfirmDialog, Input, Select, Tabs, Table, Skeleton, EmptyState, Tooltip) |
| `src/components/` | App shell, screen-session console, enrollment modal, messages panel, phone frame |
| `src/pages/` | One file per route; `/enroll/:token` is the public, mobile-first landing page |

## Principles

- No mock data: every number comes from the API; null telemetry renders as "Unavailable".
- The phone frame only shows a real `<video>` fed by WebRTC while a consented session is live.
- Roles (`owner > admin > operator > viewer`) gate navigation and actions client-side; the API is the authority.
- Phase 2 features (policies, apps, remote control, camera/mic, iOS) are honest explainer pages.
