# AI autonomous execution

**Status:** design.

Spec §18 defines two capabilities that sound alike and are not:

| Capability               | Definition                                                        | Needs a goal? | Needs a schedule? |
| ------------------------ | ----------------------------------------------------------------- | ------------- | ----------------- |
| **Multi-step execution** | One request, several steps, then stop                             | ⛔            | ⛔                |
| **Autopilot**            | A recurring objective, evaluated repeatedly, without a new prompt | ✅            | ✅                |

Spec §18's second requirement is explicit:

> **Autopilot runs on an explicit goal with strict boundaries.**

So there are **three** tiers, not two.

---

## 0. The three tiers

| Tier  | Name            | Triggered by                         | Terminates                                           |
| ----- | --------------- | ------------------------------------ | ---------------------------------------------------- |
| **A** | Multi-step task | A human prompt                       | When the plan completes, fails, or is cancelled      |
| **B** | Goal            | A human-defined objective + schedule | When the goal is achieved, paused, or cancelled      |
| **C** | Monitoring      | A human-defined condition + schedule | When the condition resolves, or when it is cancelled |

⚠️ **Tier B is not implemented and must not be.** `agent_run_kind` is a `pgEnum`
with exactly four values — `project_tracking`, `backlog_triage`,
`sprint_planning`, `bulk_sprint_creation` (`schema/agents.ts:18–24`). None of
them is a long-lived goal. 🔵 Phase 4 adds the kind; it does not overload one.

---

## 1. Tier A — multi-step task

Fully specified in [`AI_AGENT_SYSTEM.md`](AI_AGENT_SYSTEM.md) §5. The
autonomy-relevant properties:

| Property    | Guarantee                                               |
| ----------- | ------------------------------------------------------- |
| Origin      | A human prompt. **No Tier A run may start without one** |
| Termination | Terminal state within its bound. It cannot re-enter     |
| Idempotency | Every effect has a stable key; a retry cannot duplicate |
| Approval    | Suspends rather than proceeding                         |
| Explanation | Rationale + criteria + what was skipped                 |

```text
prompt → plan → steps → effects → terminal state
                 ↓
           approval (suspends)
```

---

## 2. Tier B — Autopilot goals

### 2.1 What a goal is

> An **explicit, human-authored objective**, with a schedule, a boundary, a
> budget, and a stop condition.

Not a suggestion. Not a standing instruction to "keep things tidy". A sentence a
human wrote, with a name they will recognize in a notification.

```ts
interface AgentGoal {
  id: string;
  organizationId: string;
  projectId: string | null;

  objective: string; // human-authored, ≤ 2000 chars
  createdByUserId: string; // ⛔ never null — a goal always has an author

  // schedule
  schedule: GoalSchedule; // 🔵 cron or interval; see §2.4
  timezone: string; // IANA; 🔵 'UTC' default

  // boundaries
  maxTier: 0 | 1 | 2; // ⛔ never 3 or 4 — see §3
  allowedTools: string[]; // ⛔ must be a subset of the org allowlist
  allowedProjects: string[]; // explicit; never "all projects"
  budget: { tokens: number; usd?: number; period: 'daily' | 'monthly' };

  // lifecycle
  status: 'active' | 'paused' | 'achieved' | 'cancelled' | 'exhausted';
  stopCondition: StopCondition;
  expiresAt: Date | null; // 🔵 mandatory for autonomous goals

  evaluation: {
    maxEvaluations: number; // hard stop after N checks
    maxConsecutiveNoProgress: number;
    lastEvaluatedAt: Date | null;
    progressMetric: string; // how "progress" is measured
  };
}
```

### 2.2 The four boundaries — all mandatory

| #   | Boundary            | Rule                                                     | Why                                                                            |
| --- | ------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | **Tool allowlist**  | Explicit list. Never "all tools"                         | A goal should not be able to reach a capability its author did not consider    |
| 2   | **Project scope**   | Explicit list                                            | An org-wide autonomous goal is a blast radius, not a feature                   |
| 3   | **Tier ceiling**    | `maxTier ≤ 2`                                            | Risk 3 is outbound/external; risk 4 is destructive. Neither is ever unattended |
| 4   | **Budget + expiry** | Hard tokens/USD, hard `expiresAt`, hard evaluation count | Autonomy without a stop condition is an unbounded liability                    |

⚠️ **`expiresAt` must be mandatory.** A goal that runs forever accumulates
permissions drift, edge cases, and cost. Every goal must expire.

### 2.3 Stop conditions

A goal must be able to finish, or it is a permanent background process with a
model attached.

| Type             | Example                                                              |
| ---------------- | -------------------------------------------------------------------- |
| Metric threshold | `open_critical_issues <= 3`                                          |
| Goal achieved    | `all_release_checklist_tasks.status = done`                          |
| Budget exhausted | automatic ✅                                                         |
| Expiry           | automatic ✅                                                         |
| Max evaluations  | automatic ✅                                                         |
| No progress      | `N` consecutive evaluations with zero delta → 🔵 auto-pause + notify |
| Escalation       | 🔵 a condition that is not the AI's to fix → stop and ask a human    |
| Human cancel     | always available, always immediate                                   |

| Rule                                                        | Reason                                            |
| ----------------------------------------------------------- | ------------------------------------------------- |
| Stop conditions are **evaluated by code**, not by the model | A model that decides it is done is not stopping   |
| The metric is stored on the goal                            | So progress is measurable, not narrated           |
| 🔵 Auto-pause on no-progress                                | Failure modes must terminate, not retry forever   |
| A paused goal notifies its author with the reason           | Silence is the failure mode of autonomous systems |

### 2.4 Scheduling

⚠️ **Nothing in the schema supports this today.** `automation_rules` has **no
schedule column** — "every Friday at 09:00" is currently impossible. 🔵 Phase 5
adds:

```sql
automation_rules:
  schedule_kind        text   -- 'none' | 'cron' | 'interval'
  schedule_expr        text   -- validated crontab, tz-aware
  schedule_due_at      timestamptz   -- next fire; indexed
```

| Rule                                                | Reason                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| ⛔ **Never** `node-cron` inside the Next.js process | A redeploy silently drops every schedule                                                   |
| ✅ Reuse the existing cron reconciler               | `/api/cron/agent-runs` already scans for due work — the same `schedule_due_at` index works |
| `schedule_expr` validated by a real parser          | A regex is not a crontab validator                                                         |
| 🔵 Timezone stored per goal                         | "9am" means different things in Lagos and Berlin                                           |
| Missed windows do **not** stack                     | A goal that was offline for a day runs once on return, not 24 times                        |
| 🔵 Overlapping runs are prevented by lease          | Same mechanism as any other run                                                            |

⚠️ **This is the same `schedule_due_at` mechanism the Automation agent needs**
([`AI_AUTOMATION.md`](AI_AUTOMATION.md)). Build it once, in Phase 5, and both
consume it.

---

## 3. Why Autopilot is capped at tier 2

| Tier                   | Autopilot         | Reason                                                                            |
| ---------------------- | ----------------- | --------------------------------------------------------------------------------- |
| 0 READ                 | ✅ T0–T4          | Reading cannot cause harm                                                         |
| 1 LOW-RISK WRITE       | ✅ up to T2       | Comments and labels are visible, attributable, and revertible                     |
| 2 ORGANIZATIONAL WRITE | ✅ **T0–T1 only** | Issues and assignments are real work. Revertible, receipted, and owned by a human |
| 3 EXTERNAL ACTION      | ⛔                | An email, Slack post, or Jira sync leaves the system and cannot be recalled       |
| 4 HIGH-RISK            | ⛔                | Deletion and bulk changes are irreversible in practice                            |

| The real argument                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tier 2 changes **ValidTeam's own records**, which have receipts, pre-images, and a revert path. A mistake is visible to the team and correctable. Tier 3 changes **someone else's world** — a customer's inbox, a partner's tracker — where a mistake is discovered late, attributed to you, and often not correctable at all. |

⚠️ There is deliberately **no** "trust the AI" override for tier 3. If that is
ever wanted, it is a per-workspace decision made by a human admin, audited, and
still capped — not a global setting.

---

## 4. Tier C — proactive monitoring

Spec §18.6: _"Proactive monitoring and reporting — watch the workspace and tell
me what matters."_

⚠️ Today monitoring is **three unrelated cron routes** with no shared model:
`agent-approval-effects`, `agent-runs`, and the janitor. There is **no goal
monitoring** — nothing watches a condition and reports.

### 4.1 What monitoring means

> A **condition** the AI evaluates on a schedule, and reports on when it
> becomes true. No writes by default.

```ts
interface AgentMonitor {
  id: string;
  organizationId: string;
  condition: {
    kind: 'threshold' | 'staleness' | 'drift' | 'queue' | 'custom';
    spec: Record<string, unknown>; // evaluated by code, not by the model
  };
  schedule: GoalSchedule;
  severity: 'info' | 'warn' | 'critical';
  notify: ('in_app' | 'email' | 'digest')[]; // ⛔ no external by default
  lastTriggeredAt: Date | null;
  status: 'active' | 'paused';
}
```

### 4.2 Built-in monitors from real endpoints

| Monitor                    | Condition                                                  | Source                         | Mark |
| -------------------------- | ---------------------------------------------------------- | ------------------------------ | ---- |
| Overdue critical work      | any issue `dueDate < now` and priority in (critical, high) | `issues`                       | 🔵   |
| Approval backlog           | pending approvals older than 24h                           | `agent_approval_requests`      | 🔵   |
| Stale in-progress          | status `in_progress` with no update in 7d                  | `issues`                       | 🔵   |
| Blocked chain              | `issue_links` `blocked_by` with a blocked parent           | `issues`                       | 🔵   |
| Unassigned work            | no `assigneeId` in a team backlog                          | `issues`                       | 🔵   |
| Sprint burn                | burndown vs elapsed time                                   | `/api/analytics/burndown` ✅   | 🔵   |
| Cycle-time drift           | 7d vs 30d cycle time                                       | `/api/analytics/cycle-time` ✅ | 🔵   |
| Embedding backlog          | `content_embeddings_queue` pending count                   | ✅ table exists                | 🔵   |
| Failed runs                | `agent_runs` in `failed` with no retry                     | ✅ table exists                | 🔵   |
| DORA regression            | 4 of 5 DORA metrics declining                              | `/api/analytics/dora` ✅       | 🔵   |
| Meeting actions unactioned | actions with no issue created                              | 🔵 meetings                    | 🔵   |

| Rule                                                                | Reason                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Conditions are evaluated in SQL, not by the model**               | A model deciding whether a threshold is met is not a monitor |
| 🔵 Default severity is `info`, and default cadence is daily         | Proactive ≠ noisy                                            |
| 🔵 Repeated identical alerts are suppressed until the state changes | Alert fatigue destroys the feature                           |
| Tier 0 always — monitors **report**, they do not fix                | Autonomy and monitoring are separable concerns               |
| A monitor that always fires is auto-disabled and reported           | Self-correcting                                              |

---

## 5. Recurring evaluation

```text
cron  /api/cron/agent-runs
  ↓
goals where status = 'active'
      and schedule_due_at <= now()
      and (lease is null or leaseExpiresAt < now())     ← lease prevents overlap
  ↓
enqueue a fresh, short, bounded run
  ↓
evaluate stop condition
  ├─ met            → status = 'achieved', notify author
  ├─ budget spent   → status = 'exhausted', notify org admin
  ├─ no progress ×N → status = 'paused', notify author   🔵
  └─ otherwise      → execute the bounded plan, then reschedule
  ↓
write schedule_due_at = next occurrence
```

| Rule                                             | Reason                                                  |
| ------------------------------------------------ | ------------------------------------------------------- |
| **Each evaluation is a separate short run**      | Never hold a lease between evaluations                  |
| A goal run carries `kind = 'goal_evaluation'` 🔵 | It is not any of the four existing kinds                |
| 🔵 The goal's author is recorded on every run    | "the AI did this" is not an acceptable answer           |
| Runs are **idempotent per evaluation**           | `requestHash` already exists on `agent_runs` — reuse it |
| A goal cannot approve itself                     | It stops and escalates                                  |

⚠️ **Approvals in Autopilot are a real design question.** A goal that hits a
tier-2 tool it is not allowed to execute must **stop and notify**, not queue an
approval that a human will not connect to a goal they did not watch being
created. Escalation beats a silent stall.

---

## 6. Notify — or it did not happen

| Event                          | Recipient          | Channel                     | Mark |
| ------------------------------ | ------------------ | --------------------------- | ---- |
| Goal achieved                  | Author             | in-app 🔵 + optional email  | 🔵   |
| Goal paused (no progress)      | Author             | in-app 🔵                   | 🔵   |
| Goal exhausted (budget)        | Author + Org Admin | in-app 🔵                   | 🔵   |
| Goal escalated (needs a human) | Author             | in-app 🔵                   | 🔵   |
| Monitor triggered              | Creator            | in-app 🔵, digest 🔵        | 🔵   |
| Daily/weekly digest            | Creator            | in-app + email              | 🔵   |
| Any effect executed            | Affected users     | existing `notifications` 🔵 | 🔵   |

⚠️ `notifications.type` is a `pgEnum` with **no AI member**. 🔵 Add one, or an
AI action is indistinguishable from a human one in the notification centre.

| Rule                                                  | Reason                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| ⛔ **External notification from a goal is forbidden** | Risk 3 is never autonomous                                     |
| Notifications are **deduplicated** per goal + state   | A daily failing goal must not produce 1,000 emails             |
| 🔵 Every notification links to the run trace          | "Why did I get this?" must be one click                        |
| 🔵 Quiet hours respected                              | `notification_preferences.doNotDisturbStart` already exists ✅ |

---

## 7. What a goal may never do

| #   | Prohibition                        | Enforced by                                           |
| --- | ---------------------------------- | ----------------------------------------------------- |
| 1   | ⛔ Create another goal             | No `create_goal` capability exists                    |
| 2   | ⛔ Modify its own boundaries       | Boundaries are immutable after creation 🔵            |
| 3   | ⛔ Reach risk 3 or 4               | `maxTier ≤ 2`                                         |
| 4   | ⛔ Write outside `allowedProjects` | Server-side scope, not a prompt                       |
| 5   | ⛔ Run with no `expiresAt`         | Required field                                        |
| 6   | ⛔ Approve its own proposal        | No approval capability                                |
| 7   | ⛔ Notify anyone externally        | Tool not in the allowlist                             |
| 8   | ⛔ Survive the author's departure  | 🔵 goals are suspended when the author is deactivated |
| 9   | ⛔ Escalate its own tier           | Not a parameter                                       |
| 10  | ⛔ Act while its org is suspended  | `resolveOrganizationAccess` ✅                        |

⚠️ Rule 8 matters and is easy to miss: a goal authored by someone who leaves the
company must not keep executing with their authority.

---

## 8. UX

From [`AI_UX.md`](AI_UX.md):

| Requirement              | Detail                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| The user creates a goal  | 🔵 A goal composer with: objective, schedule, projects, tools, budget, expiry. **No prompt-only creation**                                      |
| Always show the boundary | "This goal can: comment, label, create issues in Project Orion. It cannot: email, invite, delete. It stops on: budget, expiry, or no progress." |
| 🔵 Live status           | Next run, last run, spend, effect count, escalations                                                                                            |
| 🔵 One-click pause       | Always visible, never buried                                                                                                                    |
| 🔵 Receipts              | Every effect has one, with revert where possible                                                                                                |
| Digest, not spam         | 🔵 a daily summary rather than per-action notifications                                                                                         |
| Explain the escalation   | "I stopped because I hit the token budget. Raise it or narrow the scope."                                                                       |

---

## 9. Implementation

| Phase  | Work                                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------- |
| **0**  | Fix the unscoped automation writes (`lib/automation/evaluator.ts:172–281`) — a goal running rules would inherit them |
| **4**  | 🔵 `agent_goals` + `agent_goal_steps`; 🔵 new `agent_run_kind` value                                                 |
| **5**  | 🔵 `schedule_due_at` on `automation_rules`, shared by goals and automations                                          |
| **6**  | 🔵 `agent_monitors`, built-in conditions, notification routing, digest                                               |
| **7+** | 🔵 Goals may create automations; automations may never create goals                                                  |

⚠️ **Sequencing is a safety argument, not a preference.** Goals depend on the
schedule substrate (Phase 5) and on automation writes being tenant-safe (Phase 0).
Building goals earlier would put unattended writes on unscoped queries.

Related: [`AI_AGENT_SYSTEM.md`](AI_AGENT_SYSTEM.md) ·
[`AI_AUTOMATION.md`](AI_AUTOMATION.md) ·
[`AI_APPROVALS.md`](AI_APPROVALS.md) ·
[`AI_PERMISSIONS.md`](AI_PERMISSIONS.md) ·
[`AI_SECURITY.md`](AI_SECURITY.md)
