# AI audit and observability

**Status:** design, with a verified audit of what is recorded today.
Verified claims: [`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md) §5.4,
§6.1, §7.1, §7.7, §11.

Covers: what exists (§2), the record that must be captured (§3), the
**eight-link observability chain — request → model → tools → queries →
permissions → approvals → execution → cost** (§3.7), the rationale contract (§4),
visibility surfaces (§5), retention and immutability (§6), anti-patterns (§7),
acceptance criteria (§8), and metrics, dashboards, and alerts (§9).

---

## 1. Two questions, not one

Most audit systems answer only the first.

> **Q1 — What did the AI do?** Reconstructable from receipts, effect rows, and
> mutation timestamps. ValidTeam already does this well for the project-agent
> graph.

> **Q2 — Why did it do that?** The intent, the evidence it used, the permission
> decision, the approval, and the reasoning summary. ValidTeam answers this
> **nowhere**, and this is the question users and auditors actually ask.

Q2 is the one that makes AI trustworthy. "It changed 14 deadlines" is a fact.
"Fourteen deadlines were slipping with no movement for nine days while the
blocking dependency sat in TN-401, so it proposed a three-day re-baseline and
asked me, because changing a date commits other people" is an explanation someone
can agree or disagree with.

**Design rule:** an AI audit record must be able to answer Q2 from stored data
alone, without re-running the model and without trusting the model's memory.

---

## 2. What exists today

ValidTeam has **six** stores. Two of them are genuinely strong.

| Store                   | Schema                                | Strength                                                                                                                                                                    | Weakness                                                                                                                 |
| ----------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `agent_runs`            | `packages/db/src/schema/agents.ts:47` | 33 columns: graph version, current node, checkpoint + CAS version, bounds, deadline, lease/heartbeat, cancel, `requestHash` idempotency, `writeActionsCount`, mode, dry-run | `kind` is one of 4 values; no conversation, no goal, no explicit actor field, no rationale column                        |
| `agent_run_step_events` | `agents.ts:121`                       | Append-only, monotonic, unique `(runId, sequence)`                                                                                                                          | **Input/output hashes, token and tool counters, and SSE replay are future work** (`AGENT_RUNTIME.md:155–156`)            |
| `agent_run_effects`     | `agents.ts:161`                       | **The strongest design in the repo.** Stable `effectKey`, atomic claim, terminal outcome, unique `(runId, effectKey)`, commits with the mutation                            | `agent_run_effects` has no per-effect permission-decision or approval link                                               |
| `llm_call_audit`        | `ai-cost-guard.ts:87`                 | Append-only via a **DB trigger** rejecting `UPDATE`/`DELETE`; stores `promptHash` only, **never the prompt**; `status`, `feature`, `cachedTokens`, `latencyMs`              | **No first-class model column** — `/api/ai/trace/[id]` synthesizes it from `run.output` and hardcodes `reviewedBy: null` |
| `audit_logs`            | `audit-logs.ts:9`                     | 81-value `audit_log_action` enum, ~48 `createAuditLog` call sites                                                                                                           | The Drizzle declaration exposes **only `id` and `issueId`**. The enum is far richer than the table shape                 |
| `system_audit_logs`     | `system.ts:17`                        | Admin-plane actions with IP + user-agent, ~35 insert sites                                                                                                                  | Workspace-plane AI actions do not reach it                                                                               |

### Two structural problems

**Problem 1 — sinks are dead.** `lib/audit/log.ts` `recordAuditLog` is the
unified dispatcher that would fan out to `audit_log_sinks` (`webhook`,
`splunk_hec`, `datadog`, `s3`). It has **zero production importers**. Every one
of the ~48 `createAuditLog` sites bypasses it. **An admin can configure a
Splunk sink and it will never receive anything.** The only real dispatcher is the
Slack issue bridge.

This is a "hardening" bug with direct audit consequences: adopting
`recordAuditLog` at every AI write site is cheap and makes enterprise AI
governance real.

**Problem 2 — the trace is unreachable.** `AiBadge` supports a link,
`/api/ai/trace/[id]` exists, `useAiTrace(operationId)` exists — and **no caller
passes an `operationId`**. Every `llm_call_audit` row is invisible. This
directly violates `DESIGN.md:332, 375–377`.

### Enum drift to fix

Ten actions exist in the DB enum but not in the TS union
(`project.invite_link_created|revoked|accepted|signup`,
`organization.member_added_to_project`, `scim_token.created|revoked`,
`sso_config.created|updated|deleted`). 🔵 The AI design must not extend the
drift — any new `agent.*` audit action must be added to **both** the `pgEnum` and
the TS union in the same change, enforced by a test.

---

## 3. The record: what must be captured

Per the brief, and mapped onto the stores that already exist. **New columns are
marked 🔵; the goal is to add few.**

### 3.1 Per run (`agent_runs`)

| Field                              | Status | Source                                                                                                                                          |
| ---------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Run id                             | ✅     | `id`                                                                                                                                            |
| User                               | ✅     | 🔵 **add `requestedByUserId`** — currently there is no explicit actor on the run row; the audit has to be joined back from audit logs           |
| Organization                       | ✅     | `organizationId`                                                                                                                                |
| Project                            | ✅     | `projectId`                                                                                                                                     |
| AI agent / specialist              | ✅     | `kind` (extended 🔵 with new `agent_run_kind` values)                                                                                           |
| Model + provider                   | 🔵     | **first-class `model`, `provider` columns.** Today the model is reconstructed from output and `/api/ai/trace/[id]` hardcodes `reviewedBy: null` |
| Graph version                      | ✅     | `graphVersion`                                                                                                                                  |
| Requested action (verbatim intent) | 🔵     | `objective` / `requestText` — **the user's own words, stored once, never paraphrased**                                                          |
| **Why** (decision rationale)       | 🔵     | `rationale` — a bounded, structured summary the run wrote **before** acting: evidence used, options considered, why this action                 |
| Mode / autonomy                    | ✅     | `mode` (`manual\|assistive\|auto`) + `dryRun`                                                                                                   |
| Budget                             | ✅     | bounds + `runWithBudget` reservation                                                                                                            |
| Result / failure                   | ✅     | `status` + output; `getLocalizedRunFailureCopy` exists                                                                                          |
| Start / end                        | ✅     | created + completed timestamps                                                                                                                  |

### 3.2 Per step (`agent_run_step_events`)

| Field                                            | Status                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sequence, node, type, payload, timestamp         | ✅                                                                                                                                                                 |
| Tool called, with which arguments, returned what | 🔵 **first-class columns**, not only inside `payload` jsonb. This is what makes the execution timeline renderable from the database rather than from a live stream |
| Input/output hashes                              | 🔵 (documented as future work at `AGENT_RUNTIME.md:155–156`)                                                                                                       |
| Token / cost counters per step                   | 🔵, joined from `llm_call_audit`                                                                                                                                   |
| **SSE replay source**                            | 🔵 `AGENT_RUNTIME.md:62–63` is explicit that persisted graph events are "an operational record, not yet an SSE replay source"                                      |

### 3.3 Per effect (`agent_run_effects`) — the most important row

This is the row that answers "what changed". It already has the right shape; it
needs three additions.

| Field                                      | Status | Why                                                                                                                                                              |
| ------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `effectKey`, run id, kind, status, receipt | ✅     | Already the atomic-claim design                                                                                                                                  |
| **Before / after values**                  | 🔵     | Without this, an admin can see _that_ a field changed but not _what it became_. The approval diff needs the same data, so store it once and render it everywhere |
| **Permission decision**                    | 🔵     | `permissionChecked`, `permissionRule`, `permissionDecision` (allow/deny/approval), `actorKind` (human/ai), `delegatedFromUserId`                                 |
| **Approval link**                          | 🔵     | `approvalRequestId` when the effect was approved. Makes "every consequential action is traceable" a queryable fact                                               |
| Reversibility                              | 🔵     | `reversible`, `compensatedAt`, `compensationEffectKey`                                                                                                           |
| Target identity                            | 🔵     | `targetType`, `targetId`, `targetLabel` — a human-readable label so an audit list never shows bare cuids                                                         |

### 3.4 Per approval (`agent_approval_requests`)

Already strong: `requestedBy`, `actor`, `resource`, `action`, `targetType`,
`targetId`, **immutable `proposedPayload`**, `matchedRule`, `decisionReason`,
`expiresAt`, `decidedBy`, `decidedAt`.

🔵 Additions: `decisionReason` must be populated (nothing requires it today),
`decidedByUserId` and `decidedByRole`, a structured `preview` payload alongside
the raw one, and bundle support (`(approvalId, effectIndex)`).

### 3.5 Per model call (`llm_call_audit`)

Already: `promptHash` (never the prompt), status, feature, cached tokens,
latency, cost. 🔵 Add `provider`, `model`, `runId`, `operationId` (the id the UI
can actually use), and a correlation key.

⚠️ **Never store the prompt or the completion.** The existing hash-only design is
deliberate and correct: it makes cost attribution and duplicate detection
possible without turning an audit table into a transcript store containing other
people's content. The _rationale_ field on the run is the AI's own bounded
explanation, which is a different thing from a transcript.

### 3.6 Non-AI actions taken by AI

⚠️ `automation_rules` executions produced by AI-authored rules must record the
rule id and the approval that authorized the rule. Without this, "what did the AI
do" has a hole: the AI's action is the rule's action.

### 3.7 The observability chain

Eight links. A single correlation id must join all of them, or "why did it do
that?" is unanswerable.

```text
① request
   ↓ operationId  (returned by every AI route, rendered by AiBadge)
② model call
   ↓ operationId + runId + stepId
③ tools
   ↓ toolName + effectKey
④ queries
   ↓ readModelId + rowCount (never the SQL string from a model, always the digest)
⑤ permissions
   ↓ capability + decision + reason
⑥ approvals
   ↓ approvalId + approver + decision reason
⑦ execution
   ↓ effectKey + before/after + outcome
⑧ cost
   ↓ tokens + costUsd + provider + model + role
```

| Link          | Record                                                                                           | Store                                | Status                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------- |
| ① Request     | `operationId`, actor, org, project, feature, latency                                             | `llm_call_audit` (partial)           | ⚠️ `operationId` is never emitted by a caller                          |
| ② Model       | `promptHash` (**never** the prompt), `model`, `provider`, tokens, cached tokens, latency, status | `llm_call_audit`                     | ⚠️ no first-class `model` column — synthesized in `/api/ai/trace/[id]` |
| ③ Tools       | `toolName`, args digest, result digest, outcome, duration                                        | `agent_run_step_events`              | 🔵 columns absent (`AGENT_RUNTIME.md:155–156`)                         |
| ④ Queries     | `readModelId`, row count, duration, `organization_id` predicate present                          | 🔵 `agent_run_tool_calls`            | 🔵 new                                                                 |
| ⑤ Permissions | `requiredCapability`, `decision` (`allow`/`deny`/`approval`), `reason`                           | `agent_run_effects`                  | 🔵 no column today                                                     |
| ⑥ Approvals   | `approvalId`, approver, decision, reason, expiry                                                 | `agent_approval_requests`            | ✅ mostly — decision **reason** is not enforced                        |
| ⑦ Execution   | `effectKey`, before/after, actor kind, delegation, approval link, reversibility                  | `agent_run_effects`                  | ✅ strongest in repo; 🔵 no `payload_pre`                              |
| ⑧ Cost        | tokens, `costUsd`, provider, model, role, budget context                                         | `llm_call_audit` + `llm_usage_stats` | ⚠️ unattributed to a run                                               |

#### Correlation rules

| Rule                                                                        | Reason                                                         |
| --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `operationId` is generated **once**, at the route boundary, and passed down | A per-hop id cannot join anything                              |
| `runId` → `stepId` → `effectKey` are a strict hierarchy                     | Lets one query answer "all effects of step 3 of run X"         |
| 🔵 `agent_run_tool_calls` is the join table for ③④⑤                         | Effects alone cannot explain a read that informed a write      |
| Prompt and tool-argument **content** is hashed, never stored                | Already the rule for prompts; extend it to arguments           |
| 🔵 A missing correlation id is a **hard failure**, not a degraded mode      | An unjoinable audit row is worse than none — it looks complete |

#### The nine admin questions

A single query each, or the audit layer is decoration:

| #   | Question                                          | Primary source                                      |
| --- | ------------------------------------------------- | --------------------------------------------------- |
| 1   | What did the AI change in this project this week? | `agent_run_effects` ⋈ `agent_runs`                  |
| 2   | Who approved it, and when?                        | `agent_approval_requests`                           |
| 3   | Which model produced it?                          | `llm_call_audit` ⋈ `runId`                          |
| 4   | What did it cost?                                 | `llm_call_audit.tokens` + cost table                |
| 5   | Which permissions were checked?                   | `agent_run_effects` 🔵                              |
| 6   | What was the rationale?                           | `agent_runs.rationale` 🔵                           |
| 7   | What data did it read?                            | `agent_run_tool_calls` 🔵                           |
| 8   | Which runs are still active?                      | `agent_runs` lease + status                         |
| 9   | Can I disable all AI in this org right now?       | `organizations.settings.aiEnabled` ✅ + kill switch |

---

## 4. "Why" — the rationale contract

The rationale must be **structured, bounded, and written before execution**, not
generated afterwards from memory.

```ts
interface DecisionRationale {
  intent: string; // the user's words, verbatim
  evidence: Array<{
    type: 'tool_result' | 'user_statement' | 'policy' | 'inference';
    ref: string; // effectKey, tool call id, or run step sequence
    summary: string; // bounded, no raw content
  }>;
  options: Array<{ summary: string; rejected_because?: string }>;
  decision: string; // what it did
  uncertainty: string; // what it is not sure about
  escalations: string[]; // why it is asking rather than acting
}
```

Rules:

1. **Bounded length.** A rationale that can grow unbounded is a transcript.
2. **References, not copies.** Evidence points at receipts. It does not inline
   other people's comments.
3. **Written before the effect.** If the rationale is generated after, it is a
   rationalisation.
4. **Uncertainty is mandatory.** An empty `uncertainty` on a consequential run is
   a signal that the field is being filled in performatively.
5. **Honest failure.** When the AI cannot decide, the rationale says so and the
   run escalates. Silent failure is worse than an admitted gap.

---

## 5. Visibility surfaces

Three audiences, three levels of detail, one source of truth.

### 5.1 The user — "what did you ask, what did it do?"

Reachable **without** admin permission, for the user's own runs.

```text
You asked                       "get the mobile launch ready for friday"
Actions taken                   6 tasks created · 4 assigned · 2 left for approval
Why                             TN-460 had been blocked 9 days behind TN-401;
                                the Friday date needed 6 subtasks that did not exist
Approvals                       1 requested (deadline changes) · approved by you 14:22
Cost                            31,400 tokens · $0.21
Can I undo this?                6 of 6 changes reversible · Undo
```

🔵 Requires: the `operationId` threaded from the AI routes into the response and
into `AiBadge`, and `GET /api/ai/trace/[id]` made to actually resolve. Both
mechanisms exist; the wiring does not.

### 5.2 The approver — the pending diff

Covered in [`AI_APPROVALS.md`](AI_APPROVALS.md) §4. From an audit standpoint: the
approver sees the **before/after** of every effect, the **rationale**, the
**permission decision**, and their own identity recorded against the decision.

### 5.3 The admin — "what has the AI been doing here?"

| Question                                         | Where the answer comes from                           |
| ------------------------------------------------ | ----------------------------------------------------- |
| Which runs executed, by whom, when               | `agent_runs` + `requestedByUserId`                    |
| Which tools were called, with what               | `agent_run_step_events` (🔵 first-class tool columns) |
| What changed, with before/after                  | `agent_run_effects` + 🔵 before/after                 |
| Which actions were approved by whom              | `agent_approval_requests` + 🔵 `decidedByUserId`      |
| Which were denied, and by which rule             | `agent_run_effects.permission*`                       |
| What did it cost                                 | `llm_call_audit` + `org_token_budgets`                |
| What did the AI create that keeps acting         | `automation_rules` marked AI-authored                 |
| Which goals are running, blocked, or over budget | 🔵 goal records                                       |
| What can the AI reach here                       | 🔵 capability allowlist + tool catalogue              |

🔵 Two views the product lacks today:

- **Agent activity timeline** — one query, per workspace, joined across runs,
  effects, approvals, and automations.
- **"Turn the AI off and tell me what it was doing"** — a kill switch already
  exists (`org_token_budgets.killSwitchEnabled`) but produces no summary. An
  operator disabling AI for an incident should immediately receive the last N
  hours of AI activity. This is a small feature with real incident value.

### 5.4 External export

`audit_log_sinks` already supports `webhook`, `splunk_hec`, `datadog`, `s3`, with
server-generated signing secrets, HTTPS enforcement, and a documented insecure-HTTP
opt-in. 🔵 **Adopting `recordAuditLog` makes AI activity flow into these sinks**
with no new exporter. Until then, AI activity is invisible to enterprise
compliance tooling — a governance gap, not a feature gap.

---

## 6. Retention, immutability, and privacy

| Property                     | Requirement                                                                                                                                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Immutability**             | `llm_call_audit` already has a DB trigger rejecting `UPDATE`/`DELETE` ⚠️ but it lives in a hand-written migration, not the Drizzle schema, so schema and database can diverge silently. 🔵 Move it into the schema declaration, or add a CI test asserting the trigger exists |
| **Append-only runs**         | `agent_run_step_events` is append-only by design; preserve. Do not add an update path                                                                                                                                                                                         |
| **Correction, not mutation** | A mistaken record is superseded by a new compensating record, never edited                                                                                                                                                                                                    |
| **Retention**                | 🔵 Workspace-configurable, with a default that keeps runs and effects ≥ 12 months (long enough for a delivery cycle) and step events ≥ 90 days                                                                                                                                |
| **Erasure**                  | When a user is deleted or a workspace is purged, run **rationale** and evidence summaries must cascade. Receipts that record a change to a deleted resource keep their shape and lose their content                                                                           |
| **No transcript storage**    | Preserve the hash-only design for prompts. Rationale ≠ transcript                                                                                                                                                                                                             |
| **No cross-tenant reads**    | Every audit query is organization-scoped, then permission-scoped. An admin sees their workspace; a super admin sees the platform; a user sees themselves. There is no fourth view                                                                                             |

---

## 7. Anti-patterns

| Anti-pattern                                                | Why it is rejected                                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| "The AI said it did X" as the record                        | Model output is not evidence. A receipt is                                                                       |
| Rationale generated after execution                         | It is a rationalisation, not a record                                                                            |
| Storing full prompts/completions for "debuggability"        | Turns an audit table into a transcript of other people's content. Hash + bounded rationale is the right trade    |
| Showing a raw `JSON.stringify` payload as the "explanation" | This is what `agent-governance-panel.tsx` does today, and it is developer output presented as a user explanation |
| Audit rows that claim a wider scope than was granted        | The scope recorded must be the scope resolved                                                                    |
| Audit for the AI only, not for the human who approved       | Both parties are accountable                                                                                     |
| Deleting AI history on plan downgrade                       | Retroactive erasure of an accountability trail                                                                   |
| Bare cuid2 targets in a user-facing list                    | An audit row nobody can read is not a user-facing audit                                                          |

---

## 8. Acceptance criteria

- [ ] `requestedByUserId`, `model`, `provider`, `objective`, and `rationale`
      exist as first-class columns on `agent_runs`, per `AGENT_RUNTIME.md:161–162`
      ("fields needed for recovery, lease ownership, policy, tenancy, and
      queries must be first-class columns").
- [ ] Tool name, arguments digest, and result digest are first-class step-event
      columns.
- [ ] Every effect row carries before/after, permission decision, actor kind,
      delegation, approval id, reversibility, and a human-readable target label.
- [ ] A single `operationId` is returned by every AI route and rendered by
      `AiBadge`, so `/api/ai/trace/[id]` is reachable.
- [ ] A user can read their own run history without an admin permission.
- [ ] An admin can answer all nine questions in §5.3 with one query each.
- [ ] Approve/reject require and store a decision reason.
- [ ] Rejections and expiries are typed terminal states visible in history.
- [ ] AI-authored automation rules are identifiable and bulk-disableable.
- [ ] Every AI write site goes through `recordAuditLog`, so configured SIEM
      sinks actually receive AI activity.
- [ ] Prompts are still never stored.
- [ ] New `agent.*` audit actions are added to the `pgEnum` **and** the TS union
      in the same change, enforced by a test.
- [ ] The kill switch produces an immediate activity summary for the incident.
- [ ] `operationId` is emitted at the route boundary and propagated to
      `llm_call_audit`, `agent_runs`, `agent_run_step_events`, and
      `agent_run_tool_calls` — a missing correlation id fails the run.

---

## 9. Metrics, dashboards, and alerts

Observability is not only a forensic record. It is the operating surface an admin
watches to decide whether the AI is healthy.

### 9.1 Service metrics

| Metric                       | Why it matters                                   | Alert                 |
| ---------------------------- | ------------------------------------------------ | --------------------- |
| Run success rate             | The headline health number                       | < 90% over 1h         |
| Run duration p50/p95         | Detects retrieval or tool regressions            | 🔵 p95 > 30s          |
| `failed_no_progress` rate    | The loop detector firing — a real bug signal     | 🔵 any sustained > 1% |
| Approval rate + median wait  | If approvals spike, the AI is proposing too much | 🔵 wait > 24h         |
| Approval rejection rate      | Users disagreeing with the AI's proposals        | 🔵 > 20%              |
| Effect retry rate            | Non-idempotent tools or transient failures       | 🔵 > 5%               |
| Lease reclaim rate           | Crashes or stuck workers                         | 🔵 any                |
| Tool error rate by tool      | Localizes a bad tool immediately                 | 🔵 > 5% for one tool  |
| Retrieval empty-rate         | The RAG regression detector                      | 🔵 > 30%              |
| Citation unresolved rate     | The hallucination proxy                          | 🔵 > 15%              |
| Tokens per answered question | Efficiency                                       | 🔵 trend              |
| Cost per org / per user      | Who is spending                                  | 🔵 budget             |

### 9.2 Dashboards

| Dashboard       | Audience                | Content                                                                           |
| --------------- | ----------------------- | --------------------------------------------------------------------------------- |
| **AI Health**   | Super Admin             | success rate, p95 latency, error rate by tool, provider health, kill-switch state |
| **AI Cost**     | Org Admin + Super Admin | spend by model/provider/feature/user, budget utilization, projected month-end     |
| **AI Activity** | Org Admin               | runs, effects, approvals, top tools, most active users                            |
| **AI Trust**    | Org Admin               | rejection rate, revert rate, escalation rate, unresolved citations                |
| **Run trace**   | The user                | their own runs: what was asked, what was done, what was skipped, cost, revert     |

### 9.3 Alerts

| Trigger                            | Action                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `budget` exhausted                 | Notify the user + org admin; **fail loudly, never degrade silently**             |
| Kill switch engaged                | Log the switch, the actor, the reason; notify super admins immediately           |
| Provider outage / error-rate spike | 🔵 Fail over per the provider strategy; alert; surface the degradation in the UI |
| Approval queue stalled             | 🔵 Alert the org admin; AI must not sit holding a lease waiting                  |
| Cross-tenant denial spike          | 🔵 **Page.** Either an attack or a bug; both matter                              |
| Unresolved-citation spike          | 🔵 Warn; retrieval or model quality regression                                   |
| Effect retry storm                 | 🔵 Warn; a downstream dependency is failing                                      |

### 9.4 Trace quality — what makes a trace trustworthy

| Requirement                                             | Reason                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| Traces survive a deploy                                 | Checkpoints + effects are in Postgres, not memory                        |
| Traces are **append-only**                              | `llm_call_audit` already rejects UPDATE/DELETE via trigger — preserve it |
| Traces never contain prompt text                        | Hash only ✅                                                             |
| 🔵 Traces redact tool arguments                         | Arguments can contain customer data                                      |
| A trace shows **skips and denials**, not just successes | A trace that shows only successes is marketing                           |
| Every run terminates in a **typed** state               | 🔵 `completed` / `failed` / `cancelled` / `expired` / `budget_exhausted` |

⚠️ **Langfuse exists with one caller.** `traceLlmCall` is invoked only from
`draft-issue.ts`. 🔵 Phase 2 routes every provider call through it, or the
external tracing claim in any settings UI is false.

Related: [`AI_APPROVALS.md`](AI_APPROVALS.md) ·
[`AI_OPERATING_SYSTEM_PLAN.md`](AI_OPERATING_SYSTEM_PLAN.md) ·
[`AI_SECURITY.md`](AI_SECURITY.md) ·
[`../OBSERVABILITY.md`](../OBSERVABILITY.md)
