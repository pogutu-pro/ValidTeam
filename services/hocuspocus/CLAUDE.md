# services/hocuspocus — Yjs realtime collab server

Standalone Hocuspocus (WebSocket) server backing collaborative editing (Tiptap + Yjs) in `apps/web`.
Plain Node ESM (`src/server.mjs`) — no TypeScript build step. Root guide: `/CLAUDE.md`.
Persistence helpers use the built-in Node test runner.

## Commands (run in services/hocuspocus)

```bash
pnpm dev      # node --watch src/server.mjs
pnpm start    # node src/server.mjs
pnpm check    # syntax-check production modules
pnpm test     # node --test src/*.test.mjs
```

## How it works

- **Auth**: clients connect with a JWT minted by the web app at `/api/collab/token`; verified here with
  `AUTH_SECRET` (falls back to `NEXTAUTH_SECRET`) — the secret must match the web app's.
- **Persistence**: Yjs document state persists to **Postgres** (`DATABASE_URL`). The
  database migration layer owns `collab_documents` (`0062`); this service only
  performs a read-only schema probe at boot.
- **Scale-out**: **Redis pub/sub** (`REDIS_URL`) syncs awareness/updates across multiple instances.

## Env vars

| Var                               | Purpose                                        |
| --------------------------------- | ---------------------------------------------- |
| `HOCUSPOCUS_PORT`                 | listen port (default `1234`)                   |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | JWT verification secret (shared with apps/web) |
| `DATABASE_URL`                    | Postgres for doc persistence                   |
| `REDIS_URL`                       | Redis pub/sub for multi-instance               |

## Deployment note

The web client and Docker/Compose build/runtime variables are wired. A
deployment must still set a reachable `NEXT_PUBLIC_HOCUSPOCUS_URL`, matching
auth secret, Postgres, and (for multiple instances) Redis; code wiring is not a
live-service smoke test.
