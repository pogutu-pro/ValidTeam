# ValidTeam documentation

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

## AI programme

Read [`ai/AI_VISION.md`](ai/AI_VISION.md) first. It is the north star; every
other AI document elaborates it.

| Document                                                             | Purpose                                                                                                    | Status                    | Last verified |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------- | ------------- |
| [`ai/AI_VISION.md`](ai/AI_VISION.md)                                 | North star: one AI that knows the work, proposes before it acts, and can always explain and be reversed    | Design                    | 2026-10-05    |
| [`ai/CURRENT_AI_CAPABILITIES.md`](ai/CURRENT_AI_CAPABILITIES.md)     | Audited fact document: every AI surface, capability, tool, and data model in the tree today                | Audited against `v0.17.3` | 2026-10-05    |
| [`ai/AI_OPERATING_SYSTEM_PLAN.md`](ai/AI_OPERATING_SYSTEM_PLAN.md)   | Target architecture: one surface, router, specialists, tool catalogue, goals, memory, Autopilot            | Design                    | 2026-10-05    |
| [`ai/AI_PERMISSIONS.md`](ai/AI_PERMISSIONS.md)                       | Authority model: capability tiers, actor inheritance, tenancy, policy as a floor                           | Design                    | 2026-10-05    |
| [`ai/AI_APPROVALS.md`](ai/AI_APPROVALS.md)                           | Approval lifecycle, risk tiers, diffs, expiry, and non-negotiable rules                                    | Design                    | 2026-10-05    |
| [`ai/AI_SECURITY.md`](ai/AI_SECURITY.md)                             | Adversarial analysis: trust boundaries, injection, tool abuse, data leakage, hardening roadmap             | Design + verified posture | 2026-10-05    |
| [`ai/AI_AUDIT.md`](ai/AI_AUDIT.md)                                   | Receipts, rationale, trace visibility, retention, audit queries                                            | Design                    | 2026-10-05    |
| [`ai/AI_MODEL_STRATEGY.md`](ai/AI_MODEL_STRATEGY.md)                 | Provider abstraction, model routing, cost controls, embeddings, evaluation                                 | Design                    | 2026-10-05    |
| [`ai/AI_UX_SIMPLIFICATION.md`](ai/AI_UX_SIMPLIFICATION.md)           | What to merge, what to remove, and the migration path                                                      | Design                    | 2026-10-05    |
| [`ai/AI_UX.md`](ai/AI_UX.md)                                         | Binding interaction design contract: visual language, voice, trust cues, states, accessibility, i18n       | Design                    | 2026-10-05    |
| [`ai/AUTONOMOUS_WORKFLOWS.md`](ai/AUTONOMOUS_WORKFLOWS.md)           | Schedules, daily and weekly monitoring, task lifecycle automation, natural-language rules, goal monitoring | Design                    | 2026-10-05    |
| [`ai/AI_FEATURE_MATRIX.md`](ai/AI_FEATURE_MATRIX.md)                 | Every capability in one row: status, tier, data model, phase                                               | Design                    | 2026-10-05    |
| [`ai/AI_IMPLEMENTATION_ROADMAP.md`](ai/AI_IMPLEMENTATION_ROADMAP.md) | Phases 0–8, their gates, dependencies, risks, and the first 30 days                                        | Design                    | 2026-10-05    |

Two rules govern this set:

1. `ai/CURRENT_AI_CAPABILITIES.md` is a **fact** document and must never contain
   design intent; the rest are design documents and must never present an
   intention as an implemented fact. Re-derive its dated counts rather than
   copying them.
2. None of it may contradict [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md), which remains
   the binding runtime contract.

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
7. An AI capability is designed only where it has a row in
   [`ai/AI_FEATURE_MATRIX.md`](ai/AI_FEATURE_MATRIX.md), and it ships only after
   its gate in [`ai/AI_IMPLEMENTATION_ROADMAP.md`](ai/AI_IMPLEMENTATION_ROADMAP.md).
