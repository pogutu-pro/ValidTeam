# Agent and research runtime contract

**Verified:** 2026-08-12

**Status:** bounded graph foundation shipped; the project-agent graph is
durable, while deep research and the shared cross-product runtime remain
partial.

This document is the canonical contract for ValidTeam agent loops, research
graphs, workflow mutation gates, and human approval. It deliberately separates
what exists from the target architecture.

## Current maturity

| Capability                                                | State                      | Evidence / limitation                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit nodes, declared edges, conditional cycles, `END` | Foundation shipped         | `apps/web/src/lib/agents/graph-runtime.ts` validates routes; `research-graph.ts` defines plan → retrieve → grade → synthesize → verify → review                                                                                                                                                                                                                                                                                                |
| Finite termination                                        | Foundation shipped         | Step, per-node visit, wall-time, no-progress, retrieval-round, and retry-attempt bounds are tested                                                                                                                                                                                                                                                                                                                                             |
| Checkpoint and resume contract                            | Foundation shipped         | Serializable checkpoints, graph version checks, per-step callbacks, and review interrupt/resume are tested                                                                                                                                                                                                                                                                                                                                     |
| Durable checkpoint store and worker                       | Shipped for project agents | Migration `0063` adds versioned JSON checkpoints, current node/CAS version, monotonic step events, finite bounds, leases/heartbeats, cancellation, stale recovery, and transactional domain-effect receipts. Base Compose reconciles every minute; other installs must schedule `POST /api/cron/agent-runs`. Research and local coding-agent runs do not use this store.                                                                       |
| Project-agent engine migration                            | Shipped, bounded scope     | `engine.ts` now runs `load_context → plan → execute → END`; provider plans and exact project context are checkpointed before execution. Starts require `Idempotency-Key`, UTC daily/global admission is serialized in Postgres, transient provider attempts are bounded, and incompatible graph versions fail terminally.                                                                                                                      |
| Human approval apply path                                 | Shipped for issue writes   | Migration `0061` aligns lifecycle states; approval claim, issue/comment mutation, audit, terminal state, and durable outbox enqueue share one transaction. Base Compose reconciles leased delivery; non-Compose installs must schedule the endpoint. Redis acceptance is awaited before ACK, while lease recovery makes realtime delivery at-least-once, not externally exactly-once                                                           |
| Ask citations                                             | Working contract           | Prompt, parser, SSE, unresolved markers, and Sidecar use `[TN-…]` / `[DOC-…]` consistently; organization membership is explicit and provider streaming is bounded                                                                                                                                                                                                                                                                              |
| Deep research                                             | Not shipped                | Ask retrieves workspace issues/docs and synthesizes once; web crawling, durable research runs, claims/evidence persistence, interrupts during research, and complete activity history are not wired                                                                                                                                                                                                                                            |
| Local Claude/Codex execution                              | Contained, not durable     | Child environments use a provider-specific allowlist; execution still runs in the request process and has no leased restart recovery                                                                                                                                                                                                                                                                                                           |
| Remote coding-agent webhooks                              | Contained                  | Outbound destinations are SSRF/timeout bounded; inbound events atomically commit the tenant/session fingerprint receipt, session CAS and comment. Terminal issue moves use the common workflow gate; rejected policy is durably recorded as a typed skip rather than bypassed.                                                                                                                                                                 |
| Workflow transition persistence                           | Shipped foundation         | Roles, approval policy, targets, conditions, validators, and post-actions survive builder save/reload through migration `0060`                                                                                                                                                                                                                                                                                                                 |
| Workflow transition enforcement                           | Shipped fail-closed core   | PATCH/board/MCP, bulk, automation, approved agent actions, remote agent webhooks, Slack and janitor share tenant/workflow validation, project transition permission, exact edge/role checks, row locks, status CAS and atomic history. Trusted system jobs and superadmins are explicit service-level actors. Workflow approval and non-empty untyped conditions/validators/post-actions reject with typed codes until durable executors ship. |

Do not describe the application as having a production deep-research engine or
a durable runtime shared by every agent surface until the remaining rows above
are closed.

## Shipped project-agent durability boundary

- Durable runs persist graph version/current node, complete checkpoint state,
  CAS version, bounds, deadline, lease/heartbeat/cancel fields, and monotonic
  step events. A stale or lease-less durable `running` row is reclaimable. The
  absolute deadline is 120 seconds from admission, so crash/reclaim cannot
  reset the wall-clock bound.
- Admission and the initial audit/event commit together. The caller must send a
  stable `Idempotency-Key`; a same-request replay returns the existing run and a
  changed request fails with `409`, even if provider/model policy changed after
  acceptance. Daily admission resets at 00:00 UTC.
- The start endpoint returns a safe run projection with `202` immediately after
  admission, then schedules a best-effort post-response drain. The cron
  reconciler is authoritative for process-loss recovery. Durable input,
  checkpoints, request hashes and lease metadata are never returned to the
  browser; public failures expose a typed code and localized generic copy.
- Triage and bulk sprint effects fence the current, unexpired lease, revalidate
  current workspace/project/system write policy, then commit receipt, mutation,
  activity, and audit in one transaction. A stale context CAS fails rather than
  overwrite a human priority/label/sprint change. `writeActionsCount` is the
  run's total represented durable effects, including receipts recovered after
  resume, not only writes made by the latest worker invocation.
- Approval-required project runs remain preview-only and perform zero issue or
  sprint domain writes. They are not yet resumable through the separate issue
  approval queue.
- Provider planning may be invoked again only if the process dies before its
  completed plan checkpoint commits. Database domain effects do not repeat;
  their realtime fan-out remains best-effort and can be absent after a process
  loss immediately after commit. Persisted graph events are an operational
  record, not yet an SSE replay source.
- Resume/cancel are tenant-scoped control APIs. The settings UI polls accepted
  runs, invalidates issue/sprint data on terminal transitions, and exposes
  Cancel for active runs and Resume for failed/cancelled runs. Resume reserves
  the global active-run slot under the same admission lock as a new start,
  clears stale terminal output, and does not consume the UTC daily quota again.

## Runtime invariants

Every loop or graph must have all of the following:

1. **Typed state and versioned topology.** Nodes accept and return serializable
   state. Checkpoints record the exact graph version; incompatible versions do
   not resume silently.
2. **Explicit routing.** Every possible next node is declared. An unknown or
   undeclared edge fails closed. Completion is an explicit `END`.
3. **Finite budgets.** At minimum: maximum steps, visits per node, attempts,
   wall time, and consecutive no-progress states. LLM paths additionally bound
   turns, tool calls, input/output tokens, and cost.
4. **Cancellation propagation.** Request cancellation and run cancellation
   reach provider calls, tools, subprocesses, and retry delays through an
   `AbortSignal` or equivalent durable cancellation flag.
5. **Checkpoint before acknowledgement.** A step is not reported as durable
   until state and event position are persisted. Resume repeats no committed
   side effect.
6. **Idempotent effects.** Each external or database mutation has a stable
   effect key, atomic claim, and terminal outcome. Retry is limited to
   classified transient failures.
7. **Human approval is an interrupt.** Proposed effects are persisted before
   pause; pre-approval writes are zero. Approval/rejection and core database
   effects are atomic, expiring, policy-revalidated, and exactly once at the
   database boundary. Realtime outbox delivery awaits Redis acceptance before
   ACK, but is explicitly at-least-once because a crash between Redis publish
   and database ACK causes lease recovery to republish; consumers must be
   idempotent. Automation subscriber webhooks retain their separate
   best-effort delivery contract.
8. **Attributable evidence.** Research records source identity, URI, content
   hash/snapshot, retrieval time, claim-to-source links, unresolved claims, and
   review state.
9. **Replayable observability.** Run, step, attempt, tool, effect, trace, and
   event IDs survive processes. Client streams resume from a persisted event
   position; in-memory emitters are only a local optimization.
10. **Tenant and tool boundaries.** Organization/project scope is resolved from
    authorization, not trusted prompt input. Retrieved content is untrusted;
    tool permissions, egress, secret redaction, and subprocess environments are
    explicit.

## Canonical research topology

```text
clarify / plan
  -> retrieve sources in bounded parallel work
    -> deduplicate and grade evidence
      -> gap check
         ├─ insufficient + rounds remain -> retrieve
         └─ sufficient or round bound -> synthesize
              -> verify claim/source coverage
                 ├─ resolvable gap + rounds remain -> retrieve
                 ├─ review required -> INTERRUPT
                 └─ approved/read-only -> END
```

The library implementation currently combines clarify/plan and leaves parallel
retrieval to the adapter. That is acceptable for the foundation; the durable
worker must checkpoint fan-out/fan-in work independently.

## Canonical mutation topology

```text
authorize scope and policy
  -> plan / preview
    -> persist proposed effects
      -> approval interrupt when required
        -> atomically claim approval and revalidate policy
          -> apply idempotent effects in a transaction/outbox
            -> persist audit and terminal event
              -> END / compensate / retry transient failure
```

All project-agent, automation, board, bulk, webhook, and workflow-transition
write paths should converge on the same effect/transition services. UI approval
metadata is not enforcement.

## Durable data model and remaining target

Extend or add persistent records only through the repository's hand-written,
idempotent migration process:

- `agent_runs` now carries project-agent graph version/current node, serialized
  checkpoint and CAS version, deadline/budgets, cancellation, lease/heartbeat,
  request hash, and organization-scoped idempotency key.
- `agent_run_step_events` is the append-only monotonic project-agent lifecycle
  stream. Input/output hashes, token/tool counters and SSE replay are still
  future work.
- `agent_run_effects` now gives project-agent database mutations stable effect
  keys with atomic receipt/apply. External delivery needs a separate outbox.
- research sources/claims: source snapshot metadata and claim-source edges.

JSON blobs may carry provider-specific detail, but fields needed for recovery,
lease ownership, policy, tenancy, and queries must be first-class columns.

## Rollout order

1. **Containment (shipped):** approval-required project runs preview only;
   citation grammar and unresolved markers agree end to end; local child env is
   allowlisted; pure graph and research topology are tested.
2. **Project-agent durability (shipped):** checkpoint/event/effect tables and a
   leased worker provide heartbeat, stale recovery, cancellation, idempotent
   starts and database effects. Realtime still needs an outbox.
3. **Convergence:** move project agents and workflow mutations onto common
   policy/effect services; make approval an atomic interrupt/resume path.
4. **Research product:** add source connectors/snapshots, claim persistence,
   bounded parallel retrieval, progress/activity replay, follow-up continuity,
   and review UI.
5. **Operations:** trace every node/tool/guard/effect; replay streams across
   replicas; add budgets and kill switches to every AI path.

## Required tests before production wiring

- graph compile/routing/`END`, max-step/visit/time/no-progress termination;
- checkpoint then process loss → exact resume; graph-version mismatch;
- transient-only retry; provider/tool/child cancellation propagation;
- same idempotency key and concurrent quota requests → one effect and no limit
  overrun;
- pre-approval zero writes; parallel double approval → exactly one apply;
- expired/rejected/stale-policy approval → no effect;
- mid-batch failure → rollback or exact resume without duplicates;
- citation prompt/parser/SSE/UI round trip and unresolved-claim handling;
- cross-organization retrieval negative tests;
- duplicate/out-of-order webhook replay preserves terminal monotonic state;
- worker restart/stale lease recovery and multi-replica event replay;
- secret allowlist, prompt-injection, PII, egress, and tool-permission adversarial
  tests.

## 2026 engineering baseline

This is an industry baseline, not a single normative standard:

- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence),
  [interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts),
  and [idempotent tasks](https://docs.langchain.com/oss/javascript/langgraph/functional-api)
- [OpenAI Agents runner](https://openai.github.io/openai-agents-js/guides/running-agents/),
  [human-in-the-loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/),
  and [tracing](https://openai.github.io/openai-agents-js/guides/tracing/)
- [Anthropic long-running agent harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

These references informed the finite-loop, checkpoint, replay-safe side effect,
HITL, and trace requirements; they do not require adopting a particular vendor
runtime.
