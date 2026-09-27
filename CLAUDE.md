# TaskNebula — Claude Code Project Guide

AI-native, real-time, keyboard-first project management platform (Jira/Linear alternative).
Monorepo managed with **pnpm + Turborepo**. Node **>=22**, pnpm **>=9**, TypeScript **5.7** (strict).

> Always use `pnpm` (never `npm`/`yarn`). Run repo-wide commands from the root; they fan out via Turbo.
>
> Operator checkouts may contain an ignored `CLAUDE.local.md`. Read it after
> this guide when present, keep its contents private, and never copy its
> deployment-specific values into tracked source or public collaboration.

## Monorepo layout

| Path                  | Purpose                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `apps/web`            | Next.js 15 (App Router, React 19) full-stack app — UI + REST API routes |
| `packages/db`         | Drizzle ORM schema, migrations, seed — Postgres + pgvector              |
| `packages/types`      | Shared TypeScript domain types                                          |
| `packages/config`     | Shared ESLint / TS / Tailwind configs                                   |
| `packages/mcp-server` | `@tasknebula/mcp-server` — MCP server exposing TaskNebula tools         |
| `services/hocuspocus` | Standalone Yjs realtime collab server (WebSocket + Postgres + Redis)    |

## Commands

Run from repo root unless noted. Build/lint/type-check/test fan out across workspaces via Turbo.

```bash
pnpm --filter @tasknebula/web dev  # default local web development
pnpm dev              # all workspaces; requires the Hocuspocus env contract
pnpm build            # build all (runs openapi:gen first)
pnpm lint             # ESLint across monorepo
pnpm type-check       # tsc --noEmit across all packages
pnpm test             # Jest across monorepo
pnpm format           # Prettier write **/*.{ts,tsx,md,json}

# Database (packages/db)
pnpm db:migrate       # apply migrations (tsx packages/db/src/migrate.ts)
pnpm db:studio        # Drizzle Studio
pnpm db:reset         # full reset (scripts/reset-db.sh)
# also in packages/db: db:seed, db:seed:prod, db:migrate:prod, db:push, db:setup
# There is intentionally no db:generate script. Migrations are hand-written SQL;
# see the Database section below.

# Web app (cd apps/web)
pnpm dev              # next dev (port 3000)
pnpm test             # jest
pnpm tests:e2e        # playwright test  (note the plural "tests:")
pnpm openapi:gen      # regenerate public/openapi.json
```

> `openapi:gen` does **not** exist as a root script — from the repo root use
> `pnpm --filter @tasknebula/web openapi:gen`.

**Before committing**, run focused checks for the changed surface. Before a
push, run the complete gate documented in `README.md` (Claude
Code users may invoke `/verify`). Husky `pre-commit` runs `hygiene:check` and
lint-staged (ESLint + Prettier).

## Conventions

- **Commits**: Conventional Commits — `type(scope): subject`, header ≤120 chars. Allowed types include the standard set plus `infra`, `ai`, `integrations`. e.g. `feat(kanban): add drag-and-drop`.
- **Branches**: `feature/`, `fix/`, `docs/`, `refactor/`, `test/`.
- **TypeScript**: explicit types, avoid `any`. Base config is strict; `apps/web` temporarily opts out of `exactOptionalPropertyTypes` while the tracked migration proceeds (see `docs/TS_STRICT_MIGRATION.md`). Don't introduce new violations.
- **Path aliases** (apps/web): `@/*`, `@/components/*`, `@/lib/*`, `@/app/*`.
- **Product design**: `apps/web/DESIGN.md` defines page archetypes, hierarchy, anti-slop acceptance criteria, and the evidence loop. `apps/web/DESIGN_SYSTEM.md` is the token/component contract (square-ish radii: `rounded-sm`=2px pills, `rounded-md`=4px default, `rounded-lg`=6px cards; semantic `accent-*` colors; spring motion 150–200ms; first-class dark mode). See `.claude/rules/frontend.md`.
- **Open-source hygiene**: operator domains, host ports, deployment topology, screenshots, dumps, and temporary notes stay in ignored local files or `/tmp`, never tracked source. This repository is proprietary and internal — it is never published, and `README.md` carries no public license. Prefer updating a canonical document over adding a one-off report. Run `pnpm hygiene:check`. See `.claude/rules/repository-hygiene.md`.
- **Local-only mobile workspace**: the root `mobile/` directory may exist in operator checkouts, but it is intentionally excluded from the public repository. Never add or force-add it, stage/commit/push any descendant, copy its source into tracked artifacts, or add it to public workspace manifests, lockfiles, CI, or release steps. Work inside it only when the user explicitly requests local mobile work; its own workspace and lockfile remain local. `AGENTS.md` makes this rule apply to Codex and other AGENTS-compatible assistants.
- **i18n is MANDATORY — zero new hardcoded user-facing strings.** The repository contains **30 locale catalogs** with device/browser auto-detection; catalog/ICU parity is enforced while legacy linguistic review continues. EVERY new user-facing string (JSX text **and** props like `placeholder`/`aria-label`/`title`/`alt`/`label`/`description`, plus `toast`/error messages) MUST go through `next-intl` — `useTranslations('ns')` in client components, `await getTranslations('ns')` in async server components. Add the English key and a real translation to all 30 locale catalogs; keep parser tests, key/ICU parity, and catalog contracts green with `pnpm i18n:check`. ESLint and `ui:check` catch only part of this policy, so reviewers must inspect props and non-JSX call sites too. **All future work — by any assistant — must follow this.** See `.claude/rules/frontend.md` and `.cursor/rules/i18n.mdc`.

## apps/web structure

- `src/app/page.tsx` is the landing page; `src/app/(public)/` contains public evidence/intake routes; `src/app/[locale]/(app)/` contains authenticated routes; `src/app/auth/`, `join/`, `setup/`, `offline/`, and `share/` are non-app flows; `src/app/api/` contains REST endpoints.
- `src/components/` — `ui/` (shadcn/Radix base), `layout/`, `kanban/`, `issues/`, `forms/`, `ai/`, `dashboard/`, etc.
- State: TanStack Query (server), Zustand (UI), React Hook Form + Zod (forms).
- Auth: NextAuth v5 (beta). Realtime: Tiptap + Yjs via `@hocuspocus/provider`.

## Database

- **Drizzle ORM**. Schema files live in `packages/db/src/schema/` and are re-exported from `index.ts`; migrations live in `packages/db/drizzle/`.
- **Migration workflow (hand-written SQL is the convention here)**: snapshots are frozen at `0012`, so the misleading `db:generate` scripts were removed. Migrations `0013+` are hand-written SQL files plus a matching `drizzle/meta/_journal.json` entry. Workflow: edit schema TS → write an **idempotent** SQL migration (`IF NOT EXISTS` / `duplicate_object` guards) → append a journal entry whose `when` is **strictly greater** than the previous entry's → `pnpm db:migrate`. See `packages/db/CLAUDE.md`.
- **Structural layer (migration `0054_jira_parity_layer`)**: first-class `labels` + `issue_labels` (replacing the legacy `issues.labels` JSONB array — keep back-compat reads in mind), `project_versions` + `issue_fix_versions`/`issue_affects_versions`, `components` + `issue_components`, and `issues.resolution`/`resolved_at`/`flagged`.
- Multi-tenant: `organization_id` on every tenant-scoped table; isolation is **app-level `WHERE` clauses** (Postgres RLS is planned, **not implemented** — never claim RLS exists). PKs are CUID2. Flexible data in JSONB. See `.claude/rules/database.md`.

## Git, branches & PRs

- Remote is **SSH**: `git@github.com:neuraparse/taskNebula.git`. Default branch: `main`.
- **Push work directly to `main`** (`git push origin main`) — this repo's owner prefers no branch/PR ceremony for normal work. Commits are authored as **Neura Parse `<hello@neuraparse.com>`**.
- **Publication requires explicit user authorization.** Never push commits or
  tags, create a GitHub release, or publish Docker images (including moving
  `latest`) unless the user explicitly requests that outward action in the
  current task. Approval to deploy an operator checkout does not authorize a
  GitHub or registry publication, and publication approval for one destination
  does not imply approval for another. Use Conventional Commit messages (see
  Conventions).
- CI (`.github/workflows/ci.yml`) builds the MCP package and runs i18n parity, repository hygiene, UI and documentation contracts, OpenAPI drift, type-check, lint, and unit tests on every push/PR to `main`. Browser E2E remains a proportional local/release gate. Run the complete local gate before every push (`/verify` in Claude Code; otherwise use the command list in `README.md`). This repo is **proprietary and internal** — never commit secrets (see `.gitignore` hardening; `.env`, certs, keys, local files are ignored).
- Work lands on short-lived branches merged into `main` by the maintainer; there is no public review process, no external contribution path, and no publication target.

## Releases & Docker images

- **Versioning**: SemVer, single source of truth is the root `package.json` `version` (check it — do not trust hardcoded versions in docs). Changelog follows _Keep a Changelog_ in `CHANGELOG.md` (`[Unreleased]` → new version section).
- **Image**: published to **Docker Hub** as `neuraparse/tasknebula` (the machine's `docker login` is the `neuraparse` account). Platform `linux/amd64`, runtime port `3000`, health at `GET /api/health`. The web image is a Next.js **standalone** build (`Dockerfile`, entrypoint runs migrations).
- **Build & push** a release:
  ```bash
  docker compose build web                                   # or: docker build -t neuraparse/tasknebula:<v> --build-arg NEXT_PUBLIC_APP_URL=https://app.example.com .
  docker tag neuraparse/tasknebula:latest neuraparse/tasknebula:<v>
  docker push neuraparse/tasknebula:<v> && docker push neuraparse/tasknebula:latest
  ```
- **Version bump touches**: `package.json`, `apps/web/package.json`, `docker-compose.desktop.yml`, README version references, then regenerate `apps/web/public/openapi.json` via `pnpm --filter @tasknebula/web openapi:gen`. `docker-compose.yml` web service defaults to `:latest` and is overridable with `TASKNEBULA_IMAGE`.
- Full step-by-step runbook: **`docs/RELEASE.md`**. To cut a release with Claude, use the `/release` command; to push work safely, use `/ship`.

## Current state & gotchas

Most backends are substantial; the recurring failure mode is disconnected
enforcement and last-mile wiring. `docs/STATUS.md` is the only live product
snapshot and `docs/ROADMAP_2026.md` contains future work.

- **AI calls are real**, but Ask is workspace RAG rather than deep research.
  The bounded graph/research topology in `src/lib/agents` is a tested runtime
  foundation, not yet the durable worker used by every agent path. Read
  `docs/AGENT_RUNTIME.md` before changing claims or orchestration.
- **Human oversight fails closed**: approval-gated project-agent mutations stay
  in preview because that engine is not yet wired to the queue. Covered
  agent-marked issue/comment REST writes persist approval requests and apply the
  database mutation, audit, terminal state, and durable outbox atomically;
  external delivery is at-least-once. Never bypass either guard to make the UI
  look live.
- **Workflow transitions are stored but not consistently enforced**. Status
  changes, bulk operations, automation, and agent webhooks must eventually use
  one transition service.
- **Hocuspocus deployment plumbing exists** in Docker/Compose; a configured
  endpoint and matching secrets are still required for an actual deployment.
- **OAuth remains incomplete** without a DB adapter; do not describe external
  provider sign-in as production-ready.
- **RLS is planned, not implemented**. Every tenant query needs an explicit
  organization filter and authorization check.

## Realtime collab

`services/hocuspocus` hosts Yjs docs backing collaborative editing. Web connects via `NEXT_PUBLIC_HOCUSPOCUS_URL`; JWTs minted at `/api/collab/token` (verified with `AUTH_SECRET`/`NEXTAUTH_SECRET`). State persists to Postgres; Redis pub/sub for multi-instance scale-out.

Separately — and distinct from the Yjs collab above — lightweight **issue/sprint/project events** that keep boards and lists live flow over a **Server-Sent Events** stream at `/api/events/stream`. Mutating API routes call `publishEvent` (`apps/web/src/lib/realtime/events.ts`); delivery is in-process by default and **fans out over Redis pub/sub when `REDIS_URL` is set** (origin-tagged per process to avoid double-delivery), so realtime survives multi-replica/restart deploys. The stream is org-scoped (events without an `organizationId` are dropped, fail-closed). On the client, every issue create/update/delete and the SSE consumer (`use-realtime-sync.ts`) invalidate caches through the shared `invalidateIssueCaches` helper, which is **key/CUID-agnostic** — boards are keyed by the project _key_, never scope issue-cache invalidation by a server CUID (see `apps/web/src/lib/realtime/issue-cache.ts`).

## Per-package guides

Each major workspace has its own nested `CLAUDE.md` (with a sibling `AGENTS.md` pointer for codex-convention tools) — read the one for the package you're editing:

- `apps/web/CLAUDE.md` — route auth idiom, validation, i18n, design system
- `packages/db/CLAUDE.md` — hand-written migration recipe, journal rules, tenancy
- `packages/mcp-server/CLAUDE.md` — tool surface, API-key boundary, remaining OAuth/publish gates
- `services/hocuspocus/CLAUDE.md` — JWT auth, persistence, env vars

## Pointers

- Env template: `.env.example` · Setup: `scripts/setup.sh` (`pnpm setup`)
- Documentation index: `docs/README.md` · Architecture: `docs/ARCHITECTURE.md` · Agent runtime: `docs/AGENT_RUNTIME.md`
- Setup: [`README.md`](README.md) · Live state: [`docs/STATUS.md`](docs/STATUS.md) · Future work: [`docs/ROADMAP_2026.md`](docs/ROADMAP_2026.md)
