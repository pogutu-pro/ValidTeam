# ValidTeam roadmap — August 2026 onward

**Verified:** 2026-08-12

This roadmap contains only unfinished work. Current capability lives in
[`STATUS.md`](STATUS.md), released history in
[`../CHANGELOG.md`](../CHANGELOG.md), and agent-loop invariants in
[`AGENT_RUNTIME.md`](AGENT_RUNTIME.md).

## Product direction

ValidTeam is a self-hostable, keyboard-first project system and a trustworthy
control plane for human and AI contributors. The near-term advantage is not the
number of agent entry points; it is one enforceable work graph with attributable
evidence, finite automation, and recoverable effects.

Principles:

- Postgres remains the durable source of truth.
- Configuration must be enforced, not merely displayed or stored.
- Read, propose, approve, apply, audit, retry, cancel, and revert are distinct
  states.
- AI output is scoped and attributable; “deep research” is earned by the full
  provenance/runtime contract.
- Existing dark/unmounted implementations are finished before adjacent surface
  area is added.

## P0 — trust and mutation convergence

| Work                               | Definition of done                                                                                                                                                                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Common workflow transition service | Single issue edit, board drag, bulk action, automation, and agent webhook all validate the same allowed edge, role, condition, validator, approval, post-action, and terminal history. Save/reload/enforcement tests prove it.                                                   |
| Durable approval/apply service     | Proposed effects persist before pause; pre-approval writes are zero; pending/not-expired approval is claimed with atomic compare-and-swap; policy is revalidated; double approval applies once; rejected/expired/stale requests are no-ops; audit and compensation are recorded. |
| Tenant isolation hardening         | Every tenant path uses canonical membership/scope guards; cross-org negative tests cover retrieval, webhooks, exports, admin paths, and effects. RLS is added only with explicit session-context design and rollout tests—never as a documentation claim first.                  |
| Authentication completion          | OAuth identities map to durable users/memberships; session revocation and provider lifecycle work end to end. API keys have scoped, auditable route auth so MCP calls function without cookie sessions.                                                                          |
| Idempotency and quota correctness  | Mutating POSTs and agent dispatch accept stable idempotency keys; unique constraints/effect claims prevent duplicates; concurrent quota reservations cannot exceed limits; webhook states remain terminal-monotonic under replay/out-of-order delivery.                          |

## P1 — durable graph and research product

| Work                          | Definition of done                                                                                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable agent worker          | Versioned run/step/checkpoint/event/effect records, lease/heartbeat/stale recovery, cancel/resume, failure taxonomy, transactional outbox, and replayable event sequence run outside the request lifecycle. Process-loss tests resume exactly.                   |
| Project-agent graph migration | Existing tracking/triage/planning/bulk paths execute through explicit bounded nodes and the common effect service. Every run bounds steps, turns, tools, wall time, tokens, cost, retries, and no-progress cycles.                                               |
| Research provenance           | Source connector result snapshots record URI, hash, retrieved time, organization/project scope, chunk, and provider. Claims link to sources with confidence/contradiction/unresolved state.                                                                      |
| Research experience           | Plan/scope review, bounded parallel retrieval, evidence grading/gap loop, visible activity, interrupt/refine, citation verification, human review, follow-up continuity, and structured source section survive reload/reconnect.                                 |
| Uniform AI safety and budget  | Ask, triage, digests, embeddings, project agents, provider tools, and local/remote sessions share reservation/kill switch, timeout/cancel, prompt-injection/untrusted-content handling, PII redaction policy, egress/tool permissions, and provider retry rules. |
| Trace and replay              | Persistent run/step/tool/effect IDs connect audit logs to OpenTelemetry/Langfuse spans. SSE supports ordered replay from a cursor across processes and replicas.                                                                                                 |

## P1 — product completion

| Work                     | Definition of done                                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP v2                   | Scoped API-key/OAuth auth, current REST contracts, Streamable HTTP, correct resources/templates/tools, per-call audit, and a published package with install smoke tests.                            |
| Notification delivery    | Mentions, watchers, assignments, approvals, agent failures, digests, and user preferences drive in-app/email/push channels with retries and delivery state.                                         |
| Scale track              | Cursor pagination on core collections, keyset-friendly indexes, board/list virtualization, bounded exports, query budgets, and multi-instance/load tests.                                           |
| Finish existing surfaces | Mount and verify completed analytics/time/settings capabilities, deepen importers, close chat attachment and provider/device smoke gaps, and remove remaining truthful stubs or label them clearly. |

## P2 — design evidence and enterprise depth

| Work                            | Definition of done                                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Route evidence manifest v2      | Every route records archetype, primary decision, state, viewport, locale/RTL, evidence artifact, owner, and status. Static checks enforce declared coverage; Playwright adds durable ARIA/visual evidence for high-risk flows. |
| Permission/security enforcement | Organization/project roles, permission schemes, issue-security levels, groups, and SSO policy converge on canonical authorization services with negative tests.                                                                |
| Portfolio and reporting         | Cross-project plans, configurable hierarchy/fields, dashboards, reliable DORA/flow metrics, capacity, forecasts, and export definitions are backed by scoped queries and decision-grade tests.                                 |
| Collaboration/docs depth        | Durable document collaboration, conflict/recovery behavior, linked work evidence, offline UX, and multi-instance/device tests reach parity with issue editing.                                                                 |
| Compliance operations           | Retention/export/delete controls, immutable audit delivery, access reviews, evidence collection, incident/runbook validation, and certification work are verified rather than marketing-only.                                  |

## Definition of done for graph or loop claims

A feature is not marked “engine shipped” because it has a switch statement,
state enum, workflow builder, or graph-shaped UI. It must prove:

1. typed state, explicit nodes/edges/`END`, and versioned topology;
2. finite step/visit/time/token/tool/cost/no-progress limits;
3. transient-only retry and idempotent replay-safe effects;
4. durable checkpoint/resume/cancel and process-loss recovery;
5. atomic HITL interrupt/claim/resume when writes need review;
6. tenant/tool/secret boundaries and adversarial tests;
7. persistent trace/events and client replay;
8. product UI that shows real scope, evidence, state, failure, and recovery.

## Sequencing

1. Converge status mutations and approvals before enabling more autonomous
   writes.
2. Add durable worker/effect infrastructure before wiring the research graph to
   production providers.
3. Close tenant/auth/idempotency gaps in parallel because every later agent and
   MCP feature depends on them.
4. Add research connectors and UI only after source/claim provenance and replay
   contracts exist.
5. Expand enterprise and portfolio work after common enforcement removes the
   current “configured but bypassed” class of bugs.
