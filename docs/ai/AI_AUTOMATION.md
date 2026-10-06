# AI automation

**Status:** design. **Phase 0 blocker:** this feature must not ship before the
unscoped writes in `lib/automation/evaluator.ts` are fixed.

Spec §25 asks for automations created in plain language:

> _"When a high-priority bug is created, assign it to the on-call engineer and
> post a message in the team channel."_

The engine that would run that **already exists** — and has **no API at all**.

---

## 0. What exists

| Element               | Reality                                                                                                                                                               | Mark |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Table                 | `automation_rules` — `organizationId`, `projectId?`, `name`, `description`, `enabled`, `trigger jsonb`, `conditions jsonb`, `actions jsonb`, `createdBy`, `updatedBy` | ✅   |
| Executions            | `automation_executions` with `actionResults jsonb`                                                                                                                    | ✅   |
| Evaluator             | `lib/automation/evaluator.ts`                                                                                                                                         | ✅   |
| Trigger types         | **7**: `issue.created`, `issue.updated`, `issue.status_changed`, `issue.assigned`, `sprint.started`, `sprint.completed`, `project.created`, `project.archived`        | ✅   |
| Action handlers       | **6**: `set_status`, `assign`, `add_label`, `add_comment`, `set_priority`, `notify_user`                                                                              | ✅   |
| Workflow integration  | `set_status` correctly routes through `prepareIssueStatusTransition`                                                                                                  | ✅   |
| ⚠️ **REST API**       | ⛔ **None.** No route reads or writes `automation_rules`                                                                                                              | ⚠️   |
| ⚠️ **Schedule**       | ⛔ No `schedule` column. "Every Friday at 09:00" is **impossible**                                                                                                    | ⚠️   |
| ⚠️ **Tenant scoping** | `assign`, `add_label`, `add_comment`, `set_priority` write `issues` with **no `organizationId` predicate**                                                            | 🔴   |
| ⚠️ **Permissions**    | 🔴 The evaluator takes no actor and applies no permission check                                                                                                       | 🔴   |

⚠️ **Two of these are not "missing features" — they are vulnerabilities.** An AI
that can create rules would turn them into a repeatable, unattended, cross-tenant
write primitive. Phase 0 fixes them; Phase 5 builds the feature.

---

## 1. Phase 0 — the blockers

### 1.1 Tenant scoping

```ts
// 🔴 current — lib/automation/evaluator.ts:172–187
await db.update(issues).set({ assigneeId }).where(eq(issues.id, issueId)); // ← no organizationId predicate
```

| Fix                                                                       | Detail                                                                 |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Add the org predicate                                                     | Every write filters on `issues.organizationId === rule.organizationId` |
| Derive it from the **rule**, not the payload                              | The payload is attacker-influenced; the rule is not                    |
| Add a cross-tenant test per action                                        | The AI makes these writes reachable at scale                           |
| 🛑 **Automation rule mutation is not exposed to the AI until this lands** | Non-negotiable                                                         |

### 1.2 Authorization

| Fix                                                             | Detail                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Pass the **actor** into the evaluator                           | `runAutomations({ actor, ... })`                                                           |
| Check permission per action                                     | `assign` → `issue:assign`; `set_status` → the workflow's own check (already correct ✅)    |
| 🔵 Check permission at **rule creation** _and_ at **execution** | A member may lose permission after the rule was created                                    |
| Record the author on every execution                            | `automation_executions` must resolve "the AI did this" ([`AI_AUDIT.md`](AI_AUDIT.md) §3.6) |

| Why this is Phase 0                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A rule is a **standing grant**. Today a rule executes with no actor at all, which means it executes with _maximum_ authority — the union of whatever any rule author could do. Adding natural-language rule creation on top of that is how a single sentence becomes a cross-tenant write loop. |

---

## 2. The target design

```text
"when a high-priority bug is created,
 assign it to the on-call engineer and post in #eng"

   ↓  🔵 NL → structured draft (model, read-only)
draft = {
  name, trigger, conditions[], actions[], scope, riskLevel
}
   ↓  🔵 explain in plain language + show the exact diff
   ↓  🔵 tier 2 ⇒ approval required
user approves
   ↓
persist `automation_rules` row   ← the SAME table the UI already models
   ↓
existing evaluator executes it, now tenant-scoped and permission-checked
```

| Rule                                                          | Reason                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| The AI produces a **structured draft**, never executable text | The stored artifact is the existing `jsonb`, not a prompt                     |
| The user **sees the compiled rule** before it is saved        | "Show the rule" is the trust affordance                                       |
| ⚠️ Phase 0 fixes land **first**                               | See §1                                                                        |
| Rules created by the AI are **marked**                        | `createdBy` + 🔵 `source: 'ai'` so they are identifiable and bulk-disableable |
| 🔵 A rule can be edited as text _or_ as a form                | Both edit the same `jsonb`                                                    |
| ⛔ A rule may never create another rule                       | No recursion                                                                  |

---

## 3. Natural-language rules

### 3.1 The pipeline

| Stage       | What it does                                                                  | Tier             |
| ----------- | ----------------------------------------------------------------------------- | ---------------- |
| 1. Parse    | 🔵 NL → the structured draft schema                                           | model, read-only |
| 2. Validate | Trigger type ∈ the 7; action type ∈ the 6; fields exist; references resolve   | **code**         |
| 3. Resolve  | 🔵 "the on-call engineer" → a real rotation/team, or a clarification question | code + model     |
| 4. Explain  | 🔵 Plain-language restatement + the JSON diff                                 | model            |
| 5. Gate     | Tier from the actions; 🔵 tier ≥ 1 approval                                   | code             |
| 6. Persist  | Insert into `automation_rules`                                                | code             |

⚠️ **Step 2 is code, not the model.** An unknown action type must be rejected by
a validator, not "creatively interpreted". `ACTION_HANDLERS[action.type]` already
returns `Unknown action type: ${action.type}` — the validator reuses that map as
its allowlist.

### 3.2 The mapping the model must produce

```ts
const draft = {
  name: 'Assign high-priority bugs to on-call',
  trigger: { type: 'issue.created' }, // ∈ the 7
  conditions: [
    // jsonb
    { field: 'type', op: 'eq', value: 'bug' },
    { field: 'priority', op: 'in', value: ['critical', 'high'] },
  ],
  actions: [
    // jsonb
    { type: 'assign', assignee: { kind: 'rotation', teamId: '…' } },
    { type: 'add_comment', body: 'Assigned to on-call per automation.' },
  ],
  scope: { organizationId, projectId }, // server-derived
};
```

| Rule                                                | Reason                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `organizationId` is **never** in the model's output | [`AI_DATABASE_ACCESS.md`](AI_DATABASE_ACCESS.md) §5                                |
| Unknown fields are dropped, not passed through      | The stored `jsonb` is not a trusted schema                                         |
| 🔵 "post in #eng" needs a real capability           | ⛔ **Slack is not an action handler.** Either add one at tier 3, or say so plainly |
| Conditions are **evaluated in code**                | The model proposes a condition; the engine decides                                 |

⚠️ **The requested example cannot be fully honoured today.** There is no
`post_message` action and no inbound Slack route. The honest response is
"assign" ✅ + "comment in the issue" ✅, and an explicit statement that posting to
a channel is not yet an action. 🔵 A `notify_user` action covers in-app
notification today.

### 3.3 Schedules

⚠️ **The schema has no `schedule` column.** 🔵 Phase 5 adds
`schedule_kind` / `schedule_expr` / `schedule_due_at` — the **same** substrate
Autopilot goals need ([`AI_AUTONOMOUS_EXECUTION.md`](AI_AUTONOMOUS_EXECUTION.md)
§2.4). Build once, consume twice.

| Rule                                 | Reason                            |
| ------------------------------------ | --------------------------------- |
| Validated crontab, timezone-aware    | A regex is not a validator        |
| Reconciled by `/api/cron/agent-runs` | ✅ the existing due-work scan     |
| ⛔ Never `node-cron` in-process      | A redeploy drops every schedule   |
| Missed windows do not stack          | One catch-up run, not twenty-four |

---

## 4. Trigger coverage

Spec §25 wants triggers in natural language. Reality:

| Wanted                             | Exists                    | Gap                                        |
| ---------------------------------- | ------------------------- | ------------------------------------------ |
| A bug is created                   | ✅ `issue.created`        | —                                          |
| A bug is assigned                  | ✅ `issue.assigned`       | —                                          |
| Status changes                     | ✅ `issue.status_changed` | —                                          |
| An issue is updated                | ✅ `issue.updated`        | Too broad — 🔵 field-level filters         |
| A sprint starts/ends               | ✅ both                   | —                                          |
| A project is created/archived      | ✅ both                   | —                                          |
| **An issue becomes overdue**       | ⛔                        | 🔵 derived trigger — a query, not an event |
| **A priority crosses a threshold** | ⛔                        | 🔵 derived trigger                         |
| **A field is empty / unfilled**    | ⛔                        | 🔵 derived trigger                         |
| **A label is added/removed**       | ⛔                        | 🔵 event trigger                           |
| **A comment mentions someone**     | ⛔                        | 🔵 event trigger                           |
| **A scheduled time**               | ⛔                        | 🔵 Phase 5                                 |
| **SLA breach**                     | ⛔                        | 🔵 derived                                 |

| Design decision                                                                | Reason                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------ |
| ⛔ **Do not fake derived triggers with polling SQL on every write**            | That is a performance and correctness trap |
| 🔵 Derived triggers are evaluated by the **same `schedule_due_at` reconciler** | One scheduler, two consumers               |
| 🔵 Each derived trigger names the **query** that detects it                    | So it is reviewable, not magical           |

⚠️ A derived trigger must be a **query over scoped data**, not a model judgement.
"Has this issue been overdue for more than 3 days?" is SQL. Asking a model would
make a deterministic system probabilistic.

---

## 5. Rule management UX

| Requirement                                                   | Detail                                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 🔵 Rules are **listed with their plain-language restatement** | The JSON is not the interface                                                |
| 🔵 "Explain this rule"                                        | 🔵 what triggers it, what it does, what it has changed, what it would do now |
| 🔵 "Edit as text" and "Edit as form"                          | Both write the same `jsonb`                                                  |
| 🔵 Dry-run                                                    | 🔵 show what the rule _would_ do against the last 30 days, without executing |
| 🔵 Execution history                                          | From `automation_executions` ✅, per rule                                    |
| 🔵 Provenance                                                 | 🔵 "Created by Sam on 12 Mar via AI" — and the AI draft                      |
| 🔵 Bulk disable                                               | 🔵 required by [`AI_AUDIT.md`](AI_AUDIT.md) §8                               |
| 🔵 Risk badge                                                 | Derived from the actions, using the tier table                               |
| ⛔ No "enable all AI automations" one-click                   | ⛔ Rules are standing grants; each is deliberate                             |

⚠️ **A dry-run over 30 days is the single most valuable UX affordance here.**
"What would this rule have done?" answers most of the anxiety about standing
grants.

---

## 6. Guardrails

| #   | Rule                                                                                            | Enforced by                                                                          |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | ⛔ A rule never creates or edits another rule                                                   | No such action type                                                                  |
| 2   | ⛔ A rule's actions are limited to the 6 handlers (🔵 + tier-3 external)                        | `ACTION_HANDLERS` allowlist                                                          |
| 3   | ⛔ A rule cannot run at risk 3 or 4 unattended                                                  | Tier table                                                                           |
| 4   | ⛔ Every execution re-checks permission                                                         | 🔵 actor passed in                                                                   |
| 5   | ⛔ Every execution is audited with the rule id and author                                       | 🔵 `automation_executions`                                                           |
| 6   | ⛌ Rate limit: a rule may not create unbounded work                                              | 🔵 per-rule execution budget                                                         |
| 7   | 🔵 **Loop detection**: a rule whose action re-triggers itself is disabled + alerted             | 🔵 The `issue.updated` → `add_comment` → `issue.updated` cycle is real               |
| 8   | 🔵 Every rule has a circuit breaker                                                             | 🔵 N failures → auto-disable + notify                                                |
| 9   | ⛔ No cross-org rule                                                                            | `organizationId` not nullable, not model-supplied                                    |
| 10  | 🔵 Disabling AI does **not** silently change existing rules' behaviour on their next evaluation | 🔵 rules are deterministic code, not model calls — the AI's role is only _authoring_ |

⚠️ Rule 10 is worth stating plainly: once persisted, a rule is **deterministic
JSON executed by code**. No model call happens at execution time. That is why it
is safe to keep a rule running after AI is switched off — and why the _authoring_
path is the only place a model is involved.

⚠️ Rule 7 is not hypothetical. `issue.updated` is a live trigger and
`add_comment` is a live action. An AI-authored rule combining them will loop
forever without a detector.

---

## 7. Implementation

| Phase  | Work                                                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------------- |
| **0**  | 🔴 Fix tenant scoping in the 4 unscoped actions; 🔴 pass the actor and check permission; cross-tenant tests |
| **5**  | 🔵 `schedule_kind` / `schedule_expr` / `schedule_due_at` + reconciler (shared with goals)                   |
| **5**  | 🔵 REST API for `automation_rules` — none exists                                                            |
| **5**  | 🔵 NL → draft pipeline, validator, explainer, approval gate                                                 |
| **5**  | 🔵 Rule list, explain, edit-as-text/form, dry-run, provenance, bulk disable                                 |
| **5**  | 🔵 Derived triggers via the reconciler                                                                      |
| **6**  | 🔵 Loop detection, circuit breaker, per-rule budget                                                         |
| **7+** | 🔵 Tier-3 external actions (Slack/Jira) behind approval                                                     |
| **7+** | 🔵 Goals may create rules; ⛔ rules may never create goals                                                  |

Related: [`AI_AUTONOMOUS_EXECUTION.md`](AI_AUTONOMOUS_EXECUTION.md) ·
[`AI_TOOL_SYSTEM.md`](AI_TOOL_SYSTEM.md) ·
[`AI_PERMISSIONS.md`](AI_PERMISSIONS.md) ·
[`AI_SECURITY.md`](AI_SECURITY.md) ·
[`AI_UX.md`](AI_UX.md)
