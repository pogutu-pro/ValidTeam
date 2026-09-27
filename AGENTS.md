# Agent Instructions

The canonical guide for AI agents and assistants working in this repository
is **[CLAUDE.md](CLAUDE.md)** — it is the single source of truth for the
tech stack, build/test commands, project conventions, the git & release
workflow, and architecture.

Tools that follow the `AGENTS.md` convention should read `CLAUDE.md` as the
full instruction set.

Operator checkouts may also contain an ignored `AGENTS.local.md`. If present,
read it after `CLAUDE.md`; it contains private deployment context and must never
be committed, quoted in public issues/PRs, or copied into tracked source.

> **i18n is mandatory.** The repository contains 30 locale catalogs with
> device auto-detection; catalog/ICU parity is automated while legacy
> linguistic review continues.
> Never hardcode user-facing strings — route every one through `next-intl` and
> add the key to all 30 catalogs in `apps/web/messages/*.json` (key parity:
> `pnpm i18n:check`). See `.claude/rules/frontend.md` and
> `.cursor/rules/i18n.mdc`. Applies to all assistants (Claude/Cursor/Codex/Copilot).

Per-package guides (each `CLAUDE.md` has a sibling `AGENTS.md` pointer):

- [apps/web/CLAUDE.md](apps/web/CLAUDE.md) — Next.js app: route auth idiom, validation, i18n, design system
- [packages/db/CLAUDE.md](packages/db/CLAUDE.md) — Drizzle schema & hand-written migration conventions
- [packages/mcp-server/CLAUDE.md](packages/mcp-server/CLAUDE.md) — MCP tools, API-key boundary, publish gates
- [services/hocuspocus/CLAUDE.md](services/hocuspocus/CLAUDE.md) — Yjs realtime collab server
