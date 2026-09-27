# TaskNebula deployment

**Verified:** 2026-08-12

This guide is portable and intentionally contains no operator-specific domain,
port map, credential, or topology. Use ignored environment/Compose overrides
for a real installation.

## Supported baseline

- Node.js 22+ and pnpm 9+ for source builds
- PostgreSQL 16 with pgvector
- Docker Compose for the maintained self-hosted stack
- Redis for multi-instance SSE/presence/rate-limit behavior
- Optional Hocuspocus for collaborative editing and LiveKit for voice

## Configuration

Copy `.env.example` to an ignored `.env` and replace every production secret.
At minimum the Compose stack requires:

- `APP_URL`: browser-visible base URL;
- `AUTH_SECRET`: strong random session/collaboration signing secret;
- Postgres database/user/password values;
- `REDIS_PASSWORD`;
- `CRON_SECRET` for the default approval-effect reconciler;
- production-safe LiveKit credentials and URLs when the `voice` profile is used.

Generate secrets outside the repository, for example:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

External OAuth, AI, email, Sentry, integrations, collaboration, and voice
variables are optional capability settings. Google/GitHub sign-in is not
production-ready until the documented Auth.js database-adapter/user lifecycle
gap is closed; credentials auth is the current reliable bootstrap path.

Never commit `.env`, a Compose override containing secrets, certificates,
database dumps, or live URLs.

## Docker Compose

The root Compose stack runs Postgres, Redis, the web image, and a small
approval-effect reconciler. It pulls `neuraparse/tasknebula:latest` by default;
set `TASKNEBULA_IMAGE` to an immutable version or local tag for reproducible
deployment. The separate `voice` and scheduled-product `cron` profiles are
opt-in.

```bash
cp .env.example .env
# edit .env and replace secrets/default production values
docker compose up -d
docker compose ps
curl --fail http://localhost:3000/api/health
```

The web entrypoint runs journaled migrations. Do not run `db:generate`; that
script does not exist because migrations after `0012` are hand-written.

To build the current checkout rather than pull an image:

```bash
docker compose build web
docker compose up -d --no-deps web
```

Recreating only `web` preserves the database and supporting services. Review
new SQL, take a database backup, and preserve a rollback image before applying
a release to a persistent installation.

### Collaborative editing

Enable the collab overlay and provide a browser-reachable WebSocket URL:

```bash
docker compose -f docker-compose.yml -f docker-compose.collab.yml build web hocuspocus
docker compose -f docker-compose.yml -f docker-compose.collab.yml up -d
```

Set `NEXT_PUBLIC_COLLAB_ENABLED=true` and
`NEXT_PUBLIC_HOCUSPOCUS_URL=wss://collab.example.com`. Because these public
values participate in the Next.js client build, so the explicit build step is
required when they change; runtime environment values cannot retrofit an
already-built web image. Hocuspocus must share the auth secret and database;
Redis is required for multiple Hocuspocus instances. Its container healthcheck
verifies both the collaboration port and Postgres readiness.

The overlay also sets `HOCUSPOCUS_INTERNAL_URL` for the web health endpoint.
For a non-Compose deployment, point that server-only variable at the
Hocuspocus `/healthz` endpoint so `/api/health` can report collaboration
degradation without exposing the internal URL.

### Collaboration on a separate host

When the web app is not on the same machine as Hocuspocus — a serverless web
tier, or a host that deliberately exposes no inbound ports — the two still
have to agree on two values, because `/api/collab/token` mints a JWT the
Hocuspocus server verifies and then authorizes against the database:

- `AUTH_SECRET` must be byte-identical. A mismatch rejects every socket with
  `Invalid collaboration token`.
- `DATABASE_URL` must be the same database. A mismatch passes signature
  verification but fails the per-document check, rejecting every socket with
  `Not authorized for this document`.

Migrations must have run on that database first; Hocuspocus persists Yjs
documents into `collab_documents` (migration `0062`) and has nothing to write
to before then.

Redis is only needed to run more than one Hocuspocus node. A single instance
logs `REDIS_URL not set — running in single-node mode` and works fine, which
keeps a separate host from needing a Redis of its own.

For a host with no public ports, `docker-compose.serverb-collab.yml` runs
Hocuspocus with `expose` (no published ports) alongside `cloudflared`, so the
browser arrives through a Cloudflare Tunnel rather than an open port. Copy
`.env.serverb-collab.example` to `.env` on that host and fill in the three
required values. Because `NEXT_PUBLIC_HOCUSPOCUS_URL` is a client build input,
changing the tunnel hostname means rebuilding and redeploying the web app.

### Voice

LiveKit/WebRTC needs more than a healthy HTTP container. Configure a
browser-reachable `NEXT_PUBLIC_LIVEKIT_URL`, strong API key/secret, advertised
node IP, UDP/TCP ranges, TLS, and TURN behavior for the target network. Verify
from a second device/network before calling voice production-ready.

```bash
docker compose --profile voice up -d livekit
```

The profile uses host networking. Its healthcheck follows `LIVEKIT_PORT`, but
`LIVEKIT_URL` and `NEXT_PUBLIC_LIVEKIT_URL` must also name that chosen port and
remain reachable from the server and browser respectively.

### Approval and scheduled workers

The base Compose lifecycle includes `approval-reconciler`; every minute it
drains both the durable approval-effect outbox and recoverable project-agent
runs. Non-Compose deployments must schedule both
`POST /api/cron/agent-approval-effects` and `POST /api/cron/agent-runs` with
`CRON_SECRET` at least once per minute. The separate `cron` profile enables
standup, janitor, embeddings, version-check, and cycle-rollover schedules:

```bash
docker compose --profile cron up -d cron
```

## Source deployment

For a non-Compose Node deployment:

```bash
pnpm install --frozen-lockfile
pnpm --filter @tasknebula/mcp-server build
pnpm build
pnpm db:migrate
pnpm --filter @tasknebula/web start
```

Supply `DATABASE_URL`, auth/app URL, and optional service credentials through
the process manager. The deployment is responsible for Postgres backups,
Redis/Hocuspocus/LiveKit lifecycle, TLS/reverse proxying, restarts, and log/
trace export.

The repository also supports a Next.js/Vercel-style web deployment, but it does
not provision the Postgres, collaboration, voice, worker, or deployment
secrets automatically. Validate long-running/streaming behavior against the
chosen platform limits.

## Database safety

- Migrations live in `packages/db/drizzle` and are applied by
  `packages/db/src/migrate.ts`.
- Never run `db:reset`, dev seed, `db:push`, truncate, or restore over a
  persistent environment during routine deployment.
- Review idempotency, locks, table rewrites, backfill cost, rollback, and the
  strictly increasing journal timestamp before rollout.
- Take a custom-format backup and test restore procedures; a backup that has
  never been restored is unverified.

## Post-deployment checks

At minimum:

```bash
docker compose ps
curl --fail https://app.example.com/api/health
curl --fail https://app.example.com/api/ready
```

Then verify with a safe fixture/account:

- credentials sign-in, organization and project access;
- issue create/update and board/SSE refresh;
- dark/light and 320px/desktop core routes;
- email/integration/provider flows that are enabled;
- Hocuspocus two-client editing when collaboration is enabled;
- LiveKit two-device audio when voice is enabled;
- Redis-backed behavior across replicas when running more than one web process.

Keep screenshots, logs, backups, hostnames, and rollback notes outside tracked
source.

## Monitoring and rollback

- Health: `GET /api/health`
- Readiness: `GET /api/ready`
- Metrics: authenticated `GET /api/metrics` with
  `Authorization: Bearer $METRICS_TOKEN`; unset tokens fail closed
- Structured application logs: web process/container output
- Detailed signals: [`OBSERVABILITY.md`](OBSERVABILITY.md)

Rollback immediately when migrations fail, health/readiness is not green, the
web process restarts repeatedly, or core smoke tests regress. Restore the prior
immutable web image first; restore a database only when the migration rollback
plan requires it and the recovery consequences are understood.

Release/publishing instructions are separate in [`RELEASE.md`](RELEASE.md).
Building or deploying a local checkout never authorizes GitHub or registry
publication.
