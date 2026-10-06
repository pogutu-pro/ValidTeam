# AI implementation roadmap

**Status:** design. Sequenced against the constraints in
[`AI_SECURITY.md`](AI_SECURITY.md), the runtime contract in
[`../AGENT_RUNTIME.md`](../AGENT_RUNTIME.md), and the inventory in
[`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md).

⚠️ **Sequencing is the plan.** Building capability before the trust surface
multiplies a weak trust model across every surface. Every phase below inherits
every gate above it.

---

## 1. The shape of the programme

| Phase | Theme                                     | Gate it opens                                                    |
| ----- | ----------------------------------------- | ---------------------------------------------------------------- |
| **0** | Trust surface                             | The AI may propose anything reversible                           |
| **1** | One AI surface + the in-product tool loop | The AI can act, inside a session                                 |
| **2** | Threads + Control Center consolidation    | The AI can hold context; governance is one place                 |
| **3** | Memory + documents                        | The AI knows this workspace, and documents join retrieval        |
| **4** | Task and Project Agents                   | The AI can run a multi-step workflow end to end                  |
| **5** | Automation                                | The AI can be told to happen on a schedule                       |
| **6** | Monitoring and analytics                  | The AI notices problems before a human does                      |
| **7** | Goals + external reach                    | The AI can pursue an objective over days, and use external tools |
| **8** | Autopilot within a bound                  | The AI acts without a prompt                                     |

---

## 2. Phase 0 — Trust surface (the gate on everything)

No new capability ships before this. Every item is either a security fix or a
trust affordance, and each is small relative to its importance.

### 2.1 Security fixes — blocking

| Item                                                                                                      | Fix                                                               | Ref                     |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------- |
| Derive the agent actor server-side; invoke `guardAgentAction` unconditionally                             | Remove `body.agentPolicy` as the trigger and `actor` as the input | `AI_SECURITY.md` #1     |
| Scope every automation issue write by `organizationId`                                                    | `evaluator.ts:172–187, 191–227, 235–259, 262–281`                 | `AI_SECURITY.md` #2     |
| Wire `evaluateInjectionRisk` into Ask, triage, and the project-agent graph                                | `lib/ai/safety/sandbox.ts`                                        | `AI_SECURITY.md` #4     |
| Membership check on `/api/saved-filters`; `userId` predicate + `requireCronAuth` on `/api/search-history` | both routes                                                       | `AI_SECURITY.md` #5, #6 |

⚠️ One Phase 0 item was **removed during cross-checking**: an earlier draft
claimed `/reset-counters` resets every organization's quota without an org scope.
Re-reading the route showed it is super-admin-gated with a timing-safe cron
secret, an optional scoping `organizationId`, and an audit row. The finding was
withdrawn rather than shipped as a work item. **This is why every security claim
in these documents carries a source citation.**

### 2.2 Trust affordances

| Item                                                   | Requirement                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **Structured previews**                                | 🔵 Replace raw JSON with a typed preview per effect kind: field, before, after, reason, tier, affected people |
| **Receipts**                                           | 🔵 Add `payload_pre` to `agent_run_effects`; link from the modified record back to the run                    |
| **Revert**                                             | 🔵 Every reversible effect gets a revert path from its receipt; irreversible effects must say so explicitly   |
| **Approval inbox**                                     | 🔵 A real surface, grouped by risk and age, not a notifications tab                                           |
| **Refund-before-next**                                 | 🔵 The project agent's own approval path: enqueue into the outbox instead of previewing forever               |
| **Structured approval reasons**                        | 🔵 Provider `refusal` reasons arrive as a JSON string; parse it or at minimum surface it safely               |
| **Kill switch discoverability**                        | 🔵 Within two clicks of the AI surface                                                                        |
| **Unreachable-provenance fix**                         | The receipt link on issues currently goes nowhere                                                             |
| **No-AI consistency**                                  | 🔵 Hide AI affordances when the workspace toggle is off (including the non-gated command-palette Ask tab)     |
| **Add `runWithBudget` around the project-agent graph** | Budget enforcement is currently bypassed on the one durable AI path                                           |
| **Rate-limit every AI route**                          | Redis-first; Ask has it, nothing else does                                                                    |
| **Cancel streaming AI**                                | The user can stop a generation                                                                                |

### 2.3 Exit criteria

- [ ] Cross-tenant negative test per AI entry point passes
- [ ] A proposal cannot write without a preview
- [ ] Every committed mutation has a receipt, and every receipt resolves from
      the record it changed
- [ ] Every effect a tool can produce is either reversible or explicitly
      marked irreversible in the preview
- [ ] The kill switch stops every AI surface within one request
- [ ] `pnpm lint`, `pnpm typecheck`, and the AI test suite pass

**Effort:** moderate. **Risk:** low. **Nothing here is visible as a feature** —
which is the point. It is felt as "the AI stopped surprising me".

---

## 3. Phase 1 — One AI surface + the tool loop

### 3.1 The tool layer (the centrepiece)

| Item                                | Detail                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔵 `lib/agents/tool-registry.ts`    | One catalogue: name, description, tier, zod input schema, output schema, backing operation, approvable or not                                       |
| 🔵 Wrap existing services           | Each tool calls the **same service function the route calls**, with a server-resolved actor. ⛔ Never re-implement an authorization check in a tool |
| 🔵 Route the 11 MCP tools into it   | They are already correct: `resolveApiActor`, org + project scope, real service calls. Reuse them rather than writing a parallel catalogue           |
| 🔵 Bound set per step               | The bound is resolved **before** the model runs and **cannot** be widened by model output                                                           |
| 🔵 zod validation on every argument | The only way a hallucinated id is safe is if it fails to parse _and_ fails to resolve                                                               |
| 🔵 Minimize outputs                 | No secrets, no unbounded lists. A `limit` on every list tool                                                                                        |
| 🔵 `maxToolCalls` and `maxLLMTurns` | Required by `AGENT_RUNTIME.md:79–81`                                                                                                                |

### 3.2 The AI surface

| Item                                                 | Detail                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 🔵 One surface                                       | The consolidation described in [`AI_UX_SIMPLIFICATION.md`](AI_UX_SIMPLIFICATION.md) §3.1    |
| 🔵 Router, not a picker                              | Intent → specialist. The user never selects one                                             |
| Merge `/api/ask` and the project-agent entry into it | Two backends, one frontend                                                                  |
| ⛔ Do **not** collapse the backend routes            | Seven routes stay; the frontend unifies. Route churn buys nothing                           |
| Citation markers must resolve                        | If a marker cannot be resolved, say so                                                      |
| Strip `info.ai.confidence`                           | 🔵 An unsourced number                                                                      |
| Move the inline AI buttons into the surface          | Keep the buttons; they are good. Re-express them as context-aware starters                  |
| Consolidate digest routes                            | 🔵 `health-digest` + `cron-risk-digest` + `daily-standup` → one `GET /api/ai/digest?scope=` |

### 3.3 Exit criteria

- [ ] One entry point; no specialist picker anywhere
- [ ] The AI can execute at least 5 distinct tool types in one session
- [ ] Every tool call resolves its ids through the actor first
- [ ] A hallucinated id fails safely
- [ ] Every capability in [`AI_FEATURE_MATRIX.md`](AI_FEATURE_MATRIX.md) §4 is
      registered with a tier
- [ ] `info.ai.confidence` removed from the UI and the message catalog

**Effort:** large. **Risk:** medium — this is the first true "AI can act" phase.

---

## 4. Phase 2 — Threads and the Control Center

| Item                                                        | Detail                                                                                                                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔵 `agent_threads`, `agent_messages`, `agent_conversations` | 🔵 New tables. Preserve hash-only prompts (`llm_call_audit` precedent) and never store completions                                                                                |
| `POST /api/ai/chat`                                         | Already reserved for exactly this                                                                                                                                                 |
| Thread scoping                                              | Project-scoped, organization-scoped, and visibility-filtered at read time — the `/api/ask` triple is the template                                                                 |
| 🔵 Control Center consolidation                             | Six settings screens (`project-ai-agents`, `organization-ai-agents`, `agent-governance-panel`, `ai-transparency`, `agent-ops-panel`, `ai-usage`) become one surface with sections |
| Extend `settings/ai-transparency`                           | Add: capabilities, current bound, recent AI-originated changes, cost, data destinations                                                                                           |
| AI audit filters                                            | `agent_run.*`, `agent_effect.*`, `ai_security.*` in `settings/audit-log`                                                                                                          |
| 🔵 `recordAuditLog` adoption                                | So configured SIEM sinks receive AI activity                                                                                                                                      |
| MCP alignment                                               | MCP tools become the same catalogue entries, so external clients and the in-product AI cannot drift                                                                               |

### Exit criteria

- [ ] A conversation survives a page reload and a deploy
- [ ] One governance surface for AI configuration
- [ ] Audit log can answer "what did the AI change, when, and who approved it"

**Effort:** moderate–large. **Risk:** medium — persistence is where privacy risk
accrues.

---

## 5. Phase 3 — Memory and documents

| Item                                              | Detail                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 🔵 `agent_memories`                               | 🔵 `kind` (`preference` \| `decision` \| `fact`), scope, source, author, expiry. **Every row user-visible and deletable** |
| ⛔ Memory is never written from retrieved content | A document saying "remember that…" is injection ([`AI_SECURITY.md`](AI_SECURITY.md) §3.2)                                 |
| 🔵 Embed documents                                | Extend `EmbedContentType` to `'document'`; backfill via the existing `embedding_backfill` batch workload                  |
| 🔵 Wire `research-graph.ts`                       | `grade_evidence`, `verify_citations`, `human_review` — this is the citation guarantee Ask should have had                 |
| Wire the orphaned routes                          | `draft-doc`, `suggest-update`, `extract-ghost`, the 6 slash commands                                                      |
| Remove the disclosure modal                       | 🔵 Replace with the AI mark ([`AI_UX.md`](AI_UX.md) §2.1)                                                                 |
| 🔵 Embedding egress becomes an explicit decision  | Per-workspace, stated in transparency ([`AI_MODEL_STRATEGY.md`](AI_MODEL_STRATEGY.md) §6)                                 |
| 🔵 Adopt `redact.ts`                              | On any tool returning comment or document content                                                                         |

### Exit criteria

- [ ] Every memory is visible, attributable, and deletable
- [ ] Ask answers from documents with resolvable citations
- [ ] No AI-authored content lacks an AI mark

**Effort:** large. **Risk:** high — this is where the poisoning and privacy risks
live.

---

## 6. Phase 4 — Task and Project Agents

| Item                                                     | Detail                                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔵 Task Agent                                            | Classify, extract, duplicate-detect, subtask, comment, transition, escalate — the six dormant capabilities get an orchestrator                            |
| 🔵 Project Agent                                         | Generalise beyond 3 effect types; add dependency analysis, blocker reading, due-date handling                                                             |
| 🔵 New tools                                             | `add_label`, `remove_label`, `set_due_date`, `create_sprint`, `move_issues_to_sprint`, `get_blocked_by`, `get_time_in_status`, `get_workflow_transitions` |
| 🔵 Approval executor for every WRITE tool                | Or mark it explicitly non-approvable. Silence is not acceptable                                                                                           |
| 🔵 Wire `smart_assignment_rules` and the capacity tables | ~500 lines of dead, well-specified schema is exactly this agent's assignment engine. Or delete it — do not build a third thing                            |
| 🔵 Evaluation set                                        | 🔵 A fixed set of scenarios with expected outcomes; the AI quality gate                                                                                   |
| 🔵 Extend Langfuse tracing                               | `traceLlmCall` is called from `draft-issue.ts` only; Ask, triage, the agent graph, and every new specialist must be traced                                |
| Due dates are always APPROVE                             | Commitments to other people                                                                                                                               |
| Transitions keep using `prepareIssueStatusTransition`    | ⛔ Never bypass the workflow service                                                                                                                      |

### Exit criteria

- [ ] A multi-step workflow (classify → subtasks → assign → transition) runs end
      to end with receipts on every step
- [ ] Every WRITE tool has an approval story
- [ ] The evaluation set runs in CI

**Effort:** large. **Risk:** high — this is where blast radius grows.

---

## 7. Phase 5 — Automation

### Blocking prerequisite

⛔ `AI_SECURITY.md` #2 must be fixed (Phase 0) before AI-authored rules ship.
Until then an AI-authored rule is a cross-tenant write primitive.

| Item                                                                     | Detail                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 🔵 zod schemas for `trigger`, `conditions`, `actions` + `schema_version` | Unvalidated JSONB becomes dangerous the moment a model writes it               |
| 🔵 `schedule`, `schedule_due_at`, `schedule_timezone`                    | First-class columns — `AGENT_RUNTIME.md:161–162` requires queryable scheduling |
| 🔵 `ai_authored`, `created_by_run_id`                                    | An operator must be able to find and bulk-disable everything the AI created    |
| 🔵 `execution_cap`, `consecutive_failure_count`                          | Circuit breakers                                                               |
| 🔵 Reuse `POST /api/cron/agent-runs` as the reconciler                   | ⛔ No new scheduler                                                            |
| Derived triggers as scheduled scans                                      | "Becomes overdue" is a query, not an event                                     |
| NL → rule with simulation                                                | Always simulate against real history; always resolve nouns                     |
| ⛔ Rules never trigger rules                                             | Test this invariant                                                            |

### Exit criteria

- [ ] A rule can be created in plain language, simulated, approved, and audited
- [ ] A misbehaving rule self-disables and notifies
- [ ] No rule can be triggered into an unbounded loop

**Effort:** large. **Risk:** high — automation is where autonomy bites.

---

## 8. Phase 6 — Monitoring and analytics

| Item                          | Detail                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| 🔵 Monitoring Agent           | Unify standup, health, and risk into one digest with a scope                                  |
| Daily project monitoring      | §3 of [`AUTONOMOUS_WORKFLOWS.md`](AUTONOMOUS_WORKFLOWS.md); every signal is an existing query |
| 🔵 NL analytics questions     | Replace the 11 `?preset=` enumerations with a resolved query over the analytics views         |
| 🔵 Anomaly and risk narrative | From `org_health_snapshots` + status history                                                  |
| 🔵 Weekly report              | 🔵 A draft in the project's document space, so it is versioned and linkable                   |
| Quiet by default              | `notification_preferences`, `doNotDisturbStart`, state-change-only notification               |
| ⛔ No ranking of people       | Never a productivity judgement about a human                                                  |

### Exit criteria

- [ ] One digest surface for all three periodic reports
- [ ] Every claim in a report is traceable to a tool response
- [ ] Notifications respect preferences and stop when the user does

**Effort:** moderate. **Risk:** low–medium — read-only, but reputationally
sensitive.

---

## 9. Phase 7 — Goals and external reach

| Item                                 | Detail                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| 🔵 `agent_goals`, `agent_goal_steps` | Human owner, budget, deadline, success criteria, state                                        |
| Scheduled goal evaluation            | 🔵 A separate short run per evaluation; ⛔ never a long-held lease                            |
| Honest failure                       | `blocked` and `expired` are first-class, with reasons                                         |
| 🔵 Notification actions              | 🔵 New `notifications.type` value for "AI needs your decision"                                |
| External sends                       | 🔵 APPROVE tier, no override, no autonomy, full rendered message shown, re-authorized at send |
| 🔵 In-product MCP client             | Read-only at first                                                                            |
| Jira/GitHub content into retrieval   | 🔵 Requires an explicit egress decision                                                       |
| 🔵 Meeting → actions                 | LiveKit audio exists; extraction does not                                                     |
| 🔵 Slides from project data          | Lowest priority in this phase; genuinely a nice-to-have                                       |

### Exit criteria

- [ ] A goal can run for days across deploys, with a receipt per step
- [ ] Budget exhaustion and expiry are explicit, not silent
- [ ] Nothing leaves the platform without a human approving the exact text

**Effort:** large. **Risk:** high.

---

## 10. Phase 8 — Autopilot within a bound

The last phase, deliberately.

| Item                           | Detail                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 🔵 Capability allowlist        | **Default-deny.** Enabling is an explicit, audited act                                                          |
| 🔵 Bound as a ceiling          | `min(actor's permission, workspace allowlist, project bound, budget)` — re-derived per invocation, never cached |
| 🔵 Autopilot config validation | ⛔ Reject any configuration containing a high-risk capability — at save time, not at run time                   |
| 🔵 Human owner + cancel        | Every goal and every bound has an owner and a cancel                                                            |
| 🔵 Rate and volume caps        | Beyond the circuit breakers in Phase 5                                                                          |
| ⛔ The §9 prohibition list     | Non-negotiable at every level                                                                                   |

### Exit criteria

- [ ] A bound cannot exceed any individual permission
- [ ] Disabling a capability takes effect immediately
- [ ] A full autopilot day can be reconstructed from receipts and audit rows

**Effort:** large. **Risk:** highest. Do not ship before Phases 0–4.

---

## 11. Dependency graph

```text
0  Trust surface                     ── everything
   └─ 1  AI surface + tool loop
        ├─ 2  Threads + Control Center
        │    └─ 3  Memory + documents
        │         └─ 4  Task + Project Agents
        │              ├─ 5  Automation        (needs #2 fixed in Phase 0)
        │              └─ 6  Monitoring
        │                   └─ 7  Goals + external
        │                        └─ 8  Autopilot
        └─ 2 → MCP catalogue alignment
```

| Hard constraint                   | Reason                                                                    |
| --------------------------------- | ------------------------------------------------------------------------- |
| Phase 5 after `AI_SECURITY.md` #2 | AI-authored rules would inherit a cross-tenant write primitive            |
| Phase 8 after Phase 4             | Autonomy multiplies whatever the default is; get the defaults right first |
| Any WRITE after Phase 0           | A new write path without previews and receipts multiplies blast radius    |
| Phase 3 after Phase 2             | Memory without visibility and deletion is a privacy defect                |
| External sends after Phase 0      | The worst possible first impression                                       |

---

## 12. Risk register

| Risk                                                  | Likelihood | Impact     | Mitigation                                                                                        |
| ----------------------------------------------------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------- |
| Autonomy outruns trust                                | Medium     | Severe     | Phase order is the mitigation; Autopilot is last                                                  |
| AI-authored automation amplifies itself               | Low        | Severe     | ⛔ Rules never trigger rules; cap; breaker                                                        |
| Prompt injection via stored content                   | **High**   | Medium     | Sandbox everywhere; structural separation; citations; injection cannot widen scope                |
| Cross-tenant data leak                                | Low        | **Severe** | No RLS is the root cause; actor resolution in every tool; negative tests; RLS on the tenant track |
| Trust erosion from a bad auto-apply                   | Medium     | High       | Triage auto-apply threshold defaults matter; make it conservative                                 |
| Cost blow-up from goals or loops                      | Medium     | Medium     | `runWithBudget`, per-goal budgets, daily admission, max calls/turns, kill switch                  |
| Privacy leak via transcripts                          | Low        | High       | Hash-only prompts; no completion storage; memory is visible and deletable                         |
| Reputation damage from an AI external send            | Low        | **Severe** | APPROVE with no override; no autonomy; full rendered message                                      |
| Feature bloat — 24 dormant features activated at once | **High**   | Medium     | The matrix forces one row per capability; phases force one row per phase                          |
| An unenforced security control is trusted             | **High**   | Medium     | 🛑 Enforce or delete `issue_security_levels` and `permission_scheme_grants`                       |

---

## 13. Success criteria

The programme is working when:

1. **One place** — a user asks for AI help in exactly one place and gets it.
2. **No surprises** — every change is previewed, receipted, and usually reversible.
3. **Bounded** — the user can see, at any moment, what the AI can reach and what
   it has spent.
4. **Honest** — refusals are visible; failures are named; uncertainty is specific;
   citations resolve or say they do not.
5. **Attributeable** — any AI change answers "who authorised this, under which
   policy, with which model, costing what".
6. **Steady state is quiet** — the AI speaks when it matters and not otherwise.
7. **Defensible** — no capability exists without a permission tier, a preview, and
   an audit row.

---

## 14. First 30 days

Concrete, ordered, and small enough to be true.

| #   | Work                                                                                                | Ref                  |
| --- | --------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | Server-derived agent actor; unconditional `guardAgentAction`                                        | `AI_SECURITY.md` #1  |
| 2   | Scope automation issue writes by `organizationId`                                                   | `AI_SECURITY.md` #2  |
| 3   | `/api/saved-filters` membership check; `/api/search-history` `userId` predicate + `requireCronAuth` | #5, #6               |
| 4   | Wire injection scanning into Ask and the project-agent graph                                        | `AI_SECURITY.md` #4  |
| 5   | Add `runWithBudget` around the project-agent graph                                                  | Phase 0              |
| 6   | `payload_pre` on `agent_run_effects`; structured previews; revert for reversible effects            | Phase 0              |
| 7   | Project-agent approval path enqueues into the outbox                                                | `AI_APPROVALS.md`    |
| 8   | Fix the unreachable provenance link                                                                 | `AI_UX.md` §2.3      |
| 9   | Strip `info.ai.confidence`; hide AI affordances when AI is off                                      | `AI_UX.md` §2.2      |
| 10  | Redis rate limits on every AI route; cancel streaming AI                                            | Phase 0              |
| 11  | Stand up `lib/agents/tool-registry.ts` with the 11 MCP tools registered                             | Phase 1              |
| 12  | Write the cross-tenant negative test suite; make it a release gate                                  | `AI_SECURITY.md` §10 |

Nothing in that list is a new user-facing feature. That is intentional: **the
programme becomes trustworthy before it becomes impressive.**

Related: [`AI_FEATURE_MATRIX.md`](AI_FEATURE_MATRIX.md) ·
[`AI_SECURITY.md`](AI_SECURITY.md) ·
[`AI_APPROVALS.md`](AI_APPROVALS.md) ·
[`AI_AUDIT.md`](AI_AUDIT.md)
