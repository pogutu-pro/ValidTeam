# ValidTeam

The internal operating system StratNovo runs its team on — people, teams,
projects, tasks and goals in one accountable place, with AI that assists the
work instead of taking it over.

**Proprietary and internal.** This repository is not open source and carries no
public license. It is licensed to StratNovo for internal use only. Do not
redistribute, publish, or expose it outside the company.

Live product: [rumiamanage.com](https://rumiamanage.com)

## Stack

| Area       | Technology                                                  |
| ---------- | ----------------------------------------------------------- |
| Web app    | Next.js 15 (App Router), React 19, TypeScript               |
| Styling    | Tailwind CSS with ValidTeam design tokens                   |
| Data       | PostgreSQL via Drizzle ORM                                  |
| Validation | Zod                                                         |
| Auth       | Auth.js (NextAuth v5)                                       |
| Realtime   | Yjs via Hocuspocus (collaborative editing), LiveKit (voice) |
| i18n       | next-intl, 30 locales                                       |
| Packages   | pnpm + Turborepo monorepo                                   |

## Repository layout

```
apps/web/            Next.js application (the product)
packages/db/         Drizzle schema and migrations
packages/types/      Shared TypeScript types
packages/mcp-server/ MCP server exposing ValidTeam tools
services/hocuspocus/ Yjs collaborative-editing server
docs/                Architecture, deployment, observability, release
scripts/             Setup, quality gates, maintenance
```

Each package has its own `CLAUDE.md` with package-specific conventions; the
root `CLAUDE.md` is the single source of truth for the whole repository.

## Getting started

```bash
cp .env.example .env        # then fill in AUTH_SECRET, Postgres and Redis
pnpm setup                  # provisions local Postgres/Redis and migrates
pnpm dev                    # runs the web app on http://localhost:3000
```

`pnpm setup` generates the random secrets and writes the local database URL.
Local Postgres and Redis run in Docker; the app itself runs on the host.

## Quality gates

Run these before every push. Each is also wired into `.husky/pre-commit` or CI.

| Command              | Checks                                                  |
| -------------------- | ------------------------------------------------------- |
| `pnpm type-check`    | TypeScript across the monorepo                          |
| `pnpm lint`          | ESLint                                                  |
| `pnpm test`          | Jest unit tests                                         |
| `pnpm i18n:check`    | Key parity and ICU validity across all 30 catalogs      |
| `pnpm ui:check`      | UI conventions, design-system and route contract        |
| `pnpm hygiene:check` | No leaked operator domains, ports, screenshots or dumps |
| `pnpm docs:check`    | Documentation links and structure                       |
| `pnpm format:check`  | Prettier                                                |

OpenAPI drift is covered by `apps/web` unit tests. After changing a documented
API route, regenerate the public document:

```bash
cd apps/web && npx tsx scripts/generate-openapi.ts
```

## Conventions

- **Never hardcode user-facing strings.** Every string goes through
  `next-intl`, and new keys must be added to all 30 files in
  `apps/web/messages/*.json` (`pnpm i18n:check` enforces parity).
- **Brand identity is centralized** in `apps/web/src/config/brand.ts`. Product
  name, company, domain, palette and routes all come from there or from
  environment overrides — never inline them.
- **Preserve internal contract identifiers.** `VALIDTEAM_*` environment
  variables, `X-ValidTeam-*` headers and `@validteam/*` package names are
  wire-level contracts with deployed services. They are not branding and should
  not be renamed casually.
- **Database changes are hand-written migrations** in `packages/db`, not
  generated snapshots.

## Documentation

- `CLAUDE.md` — canonical agent and contributor guide
- `docs/ARCHITECTURE.md` — system design
- `docs/DEPLOYMENT.md` — deployment and operations
- `docs/STATUS.md` — current live state
- `docs/RELEASE.md` — release process
- `docs/OBSERVABILITY.md` — metrics, logs and alerting
