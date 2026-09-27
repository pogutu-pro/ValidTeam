# TaskNebula repository instructions

Read the root `AGENTS.md` and `CLAUDE.md` before making changes, then read the
nearest package `CLAUDE.md`. Those files are canonical; this file is only a
Copilot discovery adapter.

- Use pnpm and preserve the public-repository/privacy boundaries.
- Route every user-facing web string through `next-intl` and keep all 30
  catalogs in parity.
- Database migrations after `0012` are hand-written, idempotent SQL plus a
  strictly increasing journal entry. Do not run `db:generate`. PostgreSQL RLS
  is not implemented, so every tenant query needs an explicit organization
  guard.
- Follow `apps/web/DESIGN.md` and `apps/web/DESIGN_SYSTEM.md` for UI changes.
- Never publish Git refs, releases, or container images without explicit user
  authorization for that destination.
