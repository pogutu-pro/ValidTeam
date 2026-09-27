# apps/web — Next.js full-stack app

Next.js 15 (App Router) + React 19. UI **and** the REST API live in this workspace.
Root guide: `/CLAUDE.md`. Run commands from `apps/web/` unless noted.

## Commands

```bash
pnpm dev               # next dev (port 3000)
pnpm build             # next build
pnpm test              # Jest
pnpm tests:e2e         # playwright test (plural "tests:"); tests:e2e:ui for UI mode
pnpm type-check        # tsc --noEmit
pnpm lint              # ESLint CLI over src/
pnpm openapi:gen       # regenerate public/openapi.json (openapi:check verifies no drift)
```

## Layout

- `src/app/page.tsx` landing · `src/app/(public)/` public evidence/intake · `src/app/[locale]/(app)/` authenticated · `src/app/{auth,join,setup,offline,share}/` non-app flows · `src/app/api/` REST.
- `src/components/` — `ui/` (shadcn/Radix), `layout/`, `kanban/`, `issues/`, `forms/`, `ai/`, `dashboard/`, …
- `src/lib/` — domain logic; `src/lib/auth/` holds the canonical guards.
- State: TanStack Query (server), Zustand (UI), React Hook Form + Zod (forms). Aliases: `@/*`, `@/components/*`, `@/lib/*`, `@/app/*`.

## API route conventions

- **Auth idiom**: browser-only routes use `const session = await auth();` (from `@/auth`). REST routes shared
  with the current MCP tool surface use `resolveApiActor(request)` from `src/lib/auth/api-actor.ts`, then the
  same canonical permission guards. A supplied malformed/invalid programmatic credential fails closed; API
  keys are additionally confined to their immutable organization. Prefer the **canonical guards** in
  `src/lib/auth/access-control.ts` and `src/lib/auth/guards.ts` over hand-rolled checks.
- **Tenant scoping**: every query filters by the caller's `organization_id`. There is **no RLS backstop** — a
  forgotten WHERE clause is a cross-org breach. Never trust org/project ids from the request body.
- **Validation**: Zod on every body/query — use `withValidation` from `src/lib/api-validation.ts` (400 with
  `VALIDATION_FAILED` on failure).
- Keep `public/openapi.json` in sync (`pnpm openapi:gen`); audit-log mutating actions where the schema supports it.

## Gotchas

- **Labels back-compat**: first-class `labels`/`issue_labels` tables (migration 0054) are now the source of
  truth, but the legacy `issues.labels` JSONB string array still exists — check ownership/back-compat before
  reading or writing either side; don't filter labels with `LIKE` on the JSONB.
- **OAuth is broken** (no DB adapter — sessions map to no `users` row); credentials auth works.
- i18n is next-intl with `[locale]` routing — no hardcoded locale strings or `en-US` date calls.
- **Product design**: `apps/web/DESIGN.md` defines page composition, archetypes, anti-slop acceptance criteria,
  and browser evidence. `apps/web/DESIGN_SYSTEM.md` defines tokens/components — `rounded-md` (4px) default,
  `rounded-sm` pills, `rounded-lg` cards; semantic `accent-*` colors; dark mode first-class. See
  `.claude/rules/frontend.md` + `.claude/rules/api.md`.
- **Agent runtime**: `src/lib/agents/graph-runtime.ts` and
  `research-graph.ts` provide tested finite routing/checkpoint primitives.
  They are not yet the durable production worker for every AI path;
  `docs/AGENT_RUNTIME.md` is the maturity contract.
