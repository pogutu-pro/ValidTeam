# Autonomous and proactive workflows

**Status:** design. Builds on `automation_rules`, `automation_executions`,
`agent_runs`, the leased worker, and the seven `/api/cron/*` routes that already
exist. Verified current state:
[`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md) §3.4, §8.

---

## 1. Reactive today, and why that is the ceiling

Every autonomous capability in ValidTeam is currently a **cron route** firing a
**predefined function**:

| Job              | Route                                   | What it does                                                  | What it cannot do                   |
| ---------------- | --------------------------------------- | ------------------------------------------------------------- | ----------------------------------- |
| Standup          | `POST /api/cron/standup`                | Deterministic event summary per user, optional digest         | Notice that a project is in trouble |
| Janitor          | `POST /api/cron/janitor`                | `ping_assignee`, `snooze`, `auto_close_with_label:stale-auto` | Understand _why_ something is stale |
| Agent runs       | `POST /api/cron/agent-runs`             | Reclaim and execute leased `agent_runs`                       | Decide what to work on              |
| Approval effects | `POST /api/cron/agent-approval-effects` | Drain the effect outbox                                       | —                                   |
| Cycle rollover   | `POST /api/cron/cycle-rollover`         | Sprint rollover                                               | —                                   |
| Embeddings       | `POST /api/cron/embeddings`             | Drain the embedding queue                                     | —                                   |
| Version check    | `POST /api/cron/version-check`          | Release check                                                 | —                                   |

There is no path by which a schedule **asks the AI a question**, and no
persistence for an objective that outlives its run. Both are the subject of this
document.

---

## 2. The scheduling model

### 2.1 Reuse the leased worker, not a new scheduler

⛔ **Do not add a scheduler, a queue broker, or a held request.** ValidTeam has
the correct substrate already:

```text
automation_rules / goals          (what should happen, and when)
        ↓
a due-at row in an existing table  🔵 automation_rules.schedule_due_at
        ↓
POST /api/cron/agent-runs          (the existing reconciler)
        ↓
agent_runs + lease + heartbeat     (the existing durable runtime)
        ↓
agent_run_effects                  (the existing receipt)
```

A scheduled evaluation is a **separate, short-lived run** with its own bounds
and its own receipt. Nothing holds a lease between evaluations. This is the same
reason goals work at all ([`AI_OPERATING_SYSTEM_PLAN.md`](AI_OPERATING_SYSTEM_PLAN.md)
§7) and the reason a deploy does not lose a monitoring schedule.

### 2.2 🔵 The one schema change this requires

`automation_rules` (`packages/db/src/schema/workflows.ts:100–121`) has
`trigger`, `conditions`, `actions` jsonb columns and **no recurrence field at
all**. "Every Friday afternoon" is currently impossible.

| Addition                                    | Rationale                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schedule` jsonb                            | `cron` or `interval`, plus timezone                                                                                                               |
| `schedule_due_at` timestamptz               | The next firing time. 🔵 **First-class column**, not inside jsonb — `AGENT_RUNTIME.md:161–162` requires queryable scheduling fields to be columns |
| `schedule_timezone` text                    | "Friday afternoon" is meaningless without a zone                                                                                                  |
| `schema_version` integer                    | 🔵 The rule body becomes AI-authored. Unversioned JSON cannot be migrated                                                                         |
| `execution_cap` integer / null              | Circuit breaker                                                                                                                                   |
| `consecutive_failure_count` integer         | Circuit breaker input                                                                                                                             |
| `ai_authored` boolean + `created_by_run_id` | So an operator can filter and bulk-disable everything the AI created                                                                              |

Plus **zod schemas for `trigger`, `conditions`, `actions`** with a `schemaVersion`
discriminator. Today these are unvalidated JSONB — the weakest-typed part of the
model, and the one place bad data cannot be caught at any layer. An AI author
makes this materially worse, because the AI will produce structurally valid JSON
that is semantically nonsense.

### 2.3 The scheduling loop

```text
cron reconciler
  → claim due rules  (SELECT … FOR UPDATE SKIP LOCKED)
  → enqueue a bounded run per rule   (one run = one evaluation)
  → rule execution cap / circuit breaker check
  → evaluate: does the trigger condition hold?
       ├─ no  → record "skipped" in automation_executions, done
       └─ yes → the AI proposes effects (always previewed)
                 ├─ low risk + within bound → execute + receipt
                 ├─ medium/high risk        → approval request + notify
                 └─ hard stop               → escalate to the human owner
  → compute next due_at
```

Delivery semantics: **at-least-once**, exactly like the approval effect outbox
(`agent_approval_effects`). `automation_executions` records every outcome with
`triggeredAt`, `triggerPayload`, `durationMs`, `error`, and per-action results —
so a duplicate execution is detectable and a missed one is visible.

⚠️ **Two invariants that must be tested:**

1. **A rule never triggers a rule.** No rule-chain evaluation, no recursive
   dispatch. This is what keeps a self-amplifying configuration impossible.
2. **A failed action never aborts the remaining actions.** The current engine
   already isolates per-action failures (`evaluator.ts:581–584`); preserve it, and
   surface the partial outcome in `automation_executions`.

---

## 3. Daily project monitoring

### What it checks

Every signal below is a **real query** against existing data. No new tables are
required.

| Signal                | Source                                                                                 | Real endpoint                              |
| --------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------ |
| Overdue tasks         | `issues.dueDate < now`, status not done                                                | `/api/issues` filters                      |
| Blocked tasks         | `issue_links.type = 'blocked_by'` where the blocker is open; status category `blocked` | `/api/issues/[id]/links`                   |
| Stalled tasks         | No `issue_status_history` row for N days                                               | `GET /api/issues/[id]/time-in-status`      |
| Upcoming deadlines    | `issues.dueDate` within a window; `projects.targetDate`                                |                                            |
| Missing owners        | `issues.assigneeId IS NULL`, or `project_modules` with no lead                         |                                            |
| Workload imbalance    | Open issues per assignee vs `sprints` capacity                                         | `/api/metrics/my-workload`                 |
| Project health        | The existing aggregate                                                                 | `GET /api/analytics/project-health`        |
| Throughput / velocity |                                                                                        | `GET /api/analytics/{throughput,velocity}` |
| Cycle time            |                                                                                        | `GET /api/analytics/cycle-time`            |
| Dwell-time regression | `issue_status_history` per status                                                      | `GET /api/issues/[id]/time-in-status`      |
| Unassigned capacity   | Members with zero open work                                                            |                                            |

### What it produces

Ranked findings, each with: the observation, the evidence, the recommended
action, and the tier.

```text
Mobile Launch — 3 findings

1. TN-460 has been blocked 9 days behind TN-401 (in review, 6 days).
   Recommended: unblock TN-401 first, or re-baseline TN-460's date.
   Approve to reassign · Dismiss

2. Sprint 12 closes Friday. 4 committed issues are unplanned and
   2 are overdue. Realistic completion: 60%.
   Recommended: move TN-455 and TN-471 to Sprint 13.
   Approve 2 moves · Dismiss

3. Sam Okoye holds 11 open issues across 2 projects; 4 are overdue.
   Recommended: move 2 to Priya Raman (3 days capacity).
   Approve 2 reassignments · Dismiss
```

**Rules.** Every number is traceable to a tool response. No ranking of people by
productivity. No "you are behind" judgements about individuals. Recommendations
are proposals; execution follows the tier rules in
[`AI_APPROVALS.md`](AI_APPROVALS.md).

**Quiet, by default.** A daily digest, not 30 notifications. Notifications carry
`notification_preferences`, which already supports `doNotDisturbStart` and per-event
in-app/email toggles. A monitoring pass that violates a user's preferences is a
bug.

---

## 4. Weekly project management

An ordered pipeline. Each step is a separate bounded run with its own receipt, so
a mid-pipeline failure loses nothing and duplicates nothing.

```text
1. Analyze activity        issue_activities + issue_status_history for the window
2. Identify progress       done/created ratio, throughput, cycle-time delta
3. Identify blockers       blocked_by graph, dwell regressions, missing owners
4. Generate report         structured; every claim evidence-backed
5. Identify risks          at_risk / blocked / capacity signals → risk entries
6. Propose next priorities proposals only; nothing is written at this step
7. Notify stakeholders     notification_preferences + quiet hours + approvers
```

Delivery: the report is a **draft** by default. It is never sent externally
without approval. `document_page_revisions` is the right home for a durable
weekly report in the project's document space, so it is versioned, linkable, and
searchable — reusing existing affordances instead of inventing a report store.

### What "status report" must contain

Never a vibe. Always: period, scope, shipped, in-flight, blocked, risks,
decisions needed, next week, and the **evidence for each line**. Anything the AI
cannot source is marked unresolved rather than smoothed over
(`AGENT_RUNTIME.md:99–101`).

---

## 5. Task lifecycle automation

The illustrative flow from the brief, mapped to real mechanics:

```text
Task created
    ↓  automation_rules trigger: issue.created
AI understands task
    ↓  Task Agent capability: extract fields, classify, detect duplication
       (duplicate-detect.ts already exists in lib/agents/)
Suggests subtasks
    ↓  APPROVE tier — this creates real work items
Assigns based on rules
    ↓  APPROVE tier — assignment changes human expectation
       (or automatic when explicitly inside an Autopilot bound)
Monitors progress
    ↓  scheduled evaluation: no status movement in N days?
Detects blockage
    ↓  issue_links blocked_by + workflow status category 'blocked'
Alerts appropriate person
    ↓  notifications with notification_preferences + quiet hours
Suggests resolution
    ↓  draft only; never a unilateral unblock
Updates project status
    ↓  project_modules / analytics rollup
```

### The rules that make this safe

| Rule                                                                    | Why                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creation of subtasks requires approval                                  | It creates work other people now own                                                                                                                                                  |
| Assignment always requires approval **unless** inside an explicit bound | Expectation-setting                                                                                                                                                                   |
| **A task can never be closed by the AI**                                | `auto_close_with_label:stale-auto` exists in the janitor, but it is a workspace-enabled policy with a system actor, an audit row, and a visible label — never an inference by a model |
| Unblocking is never automatic                                           | A blocker may be blocked for a reason the AI cannot see                                                                                                                               |
| Every step is a receipt                                                 | Otherwise the chain is unauditable                                                                                                                                                    |
| Deadlines are always APPROVE                                            | Deadlines are commitments                                                                                                                                                             |

---

## 6. Natural-language automation

> "Whenever a task becomes overdue, notify the assignee and project manager."

### 5 triggers exist today and map directly

| Statement                              | Existing trigger                       |
| -------------------------------------- | -------------------------------------- |
| "when a task is created"               | `issue.created`                        |
| "when a task is updated"               | `issue.updated`                        |
| "when a task moves status"             | `issue.status_changed`                 |
| "when a task is assigned"              | `issue.assigned`                       |
| "when a sprint starts / completes"     | `sprint.started` / `sprint.completed`  |
| "when a project is created / archived" | `project.created` / `project.archived` |

🔵 **Gaps that require a small, principled extension** — each maps to an existing
`webhook_event` or a queryable predicate, so none needs new infrastructure:

| Statement                         | Needs                                                                                                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "when a task becomes **overdue**" | 🔵 A derived trigger. Overdue is a _query_ (`dueDate < now`, status not done), not an event. **Design as a scheduled scan** rather than a fake event — that also makes it correct after a rule is created |
| "every Friday afternoon"          | 🔵 `schedule` (cron + timezone)                                                                                                                                                                           |
| "at 09:00 on weekdays"            | 🔵 `schedule`                                                                                                                                                                                             |
| "when a comment mentions me"      | 🔵 `issue.updated` + condition on mentions (the payload is available)                                                                                                                                     |
| "when a document changes"         | 🔵 `document.*` audit actions already exist in the `audit_log_action` enum                                                                                                                                |

⚠️ **Do not fake events.** "Becomes overdue" is not an event anyone emits;
modelling it as one produces rules that silently miss tasks. A scheduled scan is
both simpler and correct.

### The compilation pipeline

```text
"notify the assignee and project manager"
      ↓
1. Resolve every noun to a real identifier BEFORE proposing
     assignee        → issues.assigneeId
     project manager → project_members where canManageSprints/canEditIssues,
                       then projects.leadId, then org admins
   A noun that does not resolve is a question, not a guess.
      ↓
2. Classify the trigger
     "when a task becomes overdue" → scheduled scan + predicate
      ↓
3. Compile conditions and actions against the zod schemas (§2.2)
      ↓
4. Simulate against the last 30 days of real data
      ↓
5. Preview in the approval UI: what it matched, what it would have done
      ↓
6. APPROVE
      ↓
7. Create the rule, marked ai_authored, with a schema_version
```

### Non-negotiable properties

1. **Nouns are resolved, not guessed.** "The project manager" is ambiguous in
   most teams. The AI must show which resolution it chose, or ask. Silently
   picking one is how automation becomes mysterious.
2. **Simulation before approval.** Always. The preview shows matches, not a
   description.
3. **A rule inherits its approver's capability ceiling** and cannot exceed it
   later.
4. **Every execution is separately audited**, naming the rule and the approval
   that authorized it. Approving a rule is not approving its executions.
5. **A rule's schema version is fixed.** Changing a rule means a new revision, not
   an in-place mutation of unversioned JSON.
6. **Rules are visible and disableable as a set.** An admin must be able to answer
   "what has the AI been permitted to do here" and turn it all off.

---

## 7. Goal monitoring

> "Help me get this project ready for launch by Friday."

Monitoring is one scheduled evaluation of a goal record, not a new subsystem.

```text
goal { objective, success_criteria, scope, owner, budget, state, steps[] }

each scheduled evaluation (a separate short run):
  1. measure current state against success_criteria
  2. compute state: on_track | at_risk | blocked | satisfied
  3. identify the single most useful next step
  4. propose or execute within the bound
  5. update step list and criteria if reality changed
  6. notify only when the state changes, or when a threshold is crossed
     (NOT on every evaluation — that is alert fatigue)
  7. stop at satisfied, cancelled, expired, or budget exhaustion
```

### Reporting rules

- **State changes only.** No daily "still on track" spam. An `at_risk` or
  `blocked` transition notifies; a steady state does not.
- **Honest failure.** Blocked and expired are first-class states with reasons.
  A goal that quietly stops is worse than one that fails.
- **Budget is a hard stop.** `runWithBudget` exhaustion ends the goal and
  notifies the owner.
- **The owner is human.** The AI reports; a person decides.
- **Criteria changes are visible.** If reality moved, the criteria change is
  proposed and approved — never silently rewritten.

---

## 8. Circuit breakers and safety limits

| Mechanism                   | Purpose                                                         | Setting                                                                               |
| --------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Per-rule execution cap      | A rule that fires 10,000 times a day                            | 🔵 `execution_cap`                                                                    |
| Consecutive-failure breaker | A rule failing on every trigger                                 | 🔵 `consecutive_failure_count` → auto-disable + notify                                |
| Per-run bounds              | The existing 4                                                  | `maxSteps 6`, `maxVisitsPerNode 2`, `maxRuntimeMs 120s`, `maxConsecutiveNoProgress 2` |
| Per-run tool/turn caps      | New; required by `AGENT_RUNTIME.md:79–81`                       | 🔵                                                                                    |
| Goal budget                 | `org_token_budgets` + per-goal                                  | ✅ / 🔵                                                                               |
| Global kill switch          | `agent_control_center.globalEnabled` — fails closed, 404-shaped | ✅                                                                                    |
| Per-org kill switch         | `org_token_budgets.killSwitchEnabled`                           | ✅                                                                                    |
| Quiet hours                 | `notification_preferences.doNotDisturbStart`                    | ✅                                                                                    |
| Daily admission             | UTC 00:00 reset, serialized in Postgres                         | ✅                                                                                    |

---

## 9. What must never be autonomous

No Autopilot level, at any configuration, may:

- Delete issues, projects, sprints, documents, or automations
- Send anything outside the platform
- Change permissions, roles, membership, security levels, API keys, SSO, SCIM
- Make or imply a personnel decision
- Set or move a deadline
- Reassign work, outside an explicit per-scope bound
- Approve anything
- Change organization settings
- Incur spend beyond the configured budget
- Run unbounded — every run has a deadline and a step cap
- Operate without a receipt and an audit row

---

## 10. Phasing

| Capability                     | Needs                                             | Phase |
| ------------------------------ | ------------------------------------------------- | ----- |
| Scheduled AI evaluation at all | `schedule` + `schedule_due_at` + `schema_version` | 5     |
| NL → rule compilation          | zod schemas + simulation + noun resolution        | 5     |
| "Becomes overdue"              | Derived trigger as a scheduled scan               | 5     |
| Circuit breakers               | `execution_cap`, `consecutive_failure_count`      | 5     |
| Daily monitoring               | Monitoring graph + quiet-hours-aware notification | 6     |
| Weekly report                  | Monitoring + `document_pages` draft               | 6     |
| Task lifecycle chain           | Automation Agent + Task Agent with approval       | 6     |
| Goal monitoring                | Goal records + scheduled evaluation               | 7     |
| Autopilot within a bound       | Capability allowlists + bound enforcement         | 8     |

**Ordering constraint:** finding **#2** in
[`AI_SECURITY.md`](AI_SECURITY.md) — automation actions writing `issues` without
an `organizationId` predicate — must be fixed **before** any AI can author
automation rules. Until then, an AI-authored rule is a cross-tenant write
primitive.

Related: [`AI_OPERATING_SYSTEM_PLAN.md`](AI_OPERATING_SYSTEM_PLAN.md) ·
[`AI_APPROVALS.md`](AI_APPROVALS.md) ·
[`AI_IMPLEMENTATION_ROADMAP.md`](AI_IMPLEMENTATION_ROADMAP.md)
