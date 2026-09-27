# TaskNebula documentation

This directory contains durable, public documentation. Temporary audits,
handoffs, generated research dumps, deployment-specific notes, and screenshots
do not belong in the tracked repository; Git history preserves removed
snapshots.

| Document                                           | Purpose                                            | Status / owner                          | Last verified            |
| -------------------------------------------------- | -------------------------------------------------- | --------------------------------------- | ------------------------ |
| [`STATUS.md`](STATUS.md)                           | Honest current capability and gap snapshot         | Maintainer; the only live status source | 2026-08-12               |
| [`ROADMAP_2026.md`](ROADMAP_2026.md)               | Prioritized future work and definitions of done    | Maintainer/product                      | 2026-08-12               |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)               | Current system boundaries and data/control flows   | Engineering                             | 2026-08-12               |
| [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md)             | Agent graph/loop invariants, maturity, and rollout | AI/platform engineering                 | 2026-08-12               |
| [`DEPLOYMENT.md`](DEPLOYMENT.md)                   | Portable self-hosting and service configuration    | Operations                              | 2026-08-12               |
| [`OBSERVABILITY.md`](OBSERVABILITY.md)             | Logging, tracing, metrics, and operational signals | Engineering/operations                  | 2026-08-12               |
| [`RELEASE.md`](RELEASE.md)                         | Version and publication runbook                    | Maintainer                              | 2026-08-12               |
| [`TS_STRICT_MIGRATION.md`](TS_STRICT_MIGRATION.md) | Active TypeScript strictness migration             | Engineering                             | Update with each tranche |

Related canonical guides:

- Root setup and product overview: [`../README.md`](../README.md)
- Agent/repository rules: [`../CLAUDE.md`](../CLAUDE.md)
- Product design and evidence: [`../apps/web/DESIGN.md`](../apps/web/DESIGN.md)
- UI token/component contract:
  [`../apps/web/DESIGN_SYSTEM.md`](../apps/web/DESIGN_SYSTEM.md)

## Documentation rules

1. Update the nearest canonical document instead of adding a dated audit.
2. Distinguish current behavior, tested foundation, and planned work.
3. Do not copy volatile counts into agent guides; when a count matters, record
   the command and verification date in `STATUS.md`.
4. Keep examples deployment-neutral and never include operator context.
5. Remove superseded documents once their durable guidance is integrated.
6. Historical release behavior belongs in `CHANGELOG.md`, not a second status
   page.
