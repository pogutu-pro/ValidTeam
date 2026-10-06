# AI agent system

**Status:** design. Built on `runBoundedGraph`
(`apps/web/src/lib/agents/graph.ts`) and `AGENT_RUNTIME.md`, which is binding.

**One rule governs this whole document:** the user experiences **one ValidTeam
AI**. Every agent below is an internal routing target with a name the user never
chooses. There are no separate services.

---

## 1. Why agents and not microservices

| Test                                            | Answer for ValidTeam                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Does the agent need its own protocol or port?   | ⛔ No                                                                                               |
| Does it need credentials the app must not have? | ⛔ No — it calls the app's own services                                                             |
| Does it need to scale independently?            | ⛔ Not yet — a tool call is a DB query in the same process                                          |
| Does a separate process make security better?   | ⛔ Worse — a network hop and a second credential                                                    |
| Does the repo have a precedent?                 | `services/hocuspocus` exists only because Yjs needs a persistent WebSocket process. That is the bar |

**Decision: an agent is a bounded graph plus a bound plus a catalogue, inside
`apps/web`.** A "microservice" would be a premature split of code that has not
been written yet.

---

## 2. The agent contract

Every agent — present or future — satisfies the same six requirements. An agent
that cannot is not an agent; it is a prompt.

| #   | Requirement                                                                                            | Enforced by                                       |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 1   | **Declared graph.** Every next node is declared; an undeclared edge fails closed                       | `runBoundedGraph` ✅                              |
| 2   | **Bounded.** Steps, node visits, attempts, wall time, no-progress, tool calls, LLM turns, tokens, cost | Mostly ✅; 🔵 tool-call and turn caps are missing |
| 3   | **Tool-only side effects.** The model emits typed plans; code applies them                             | ✅ `engine.ts`                                    |
| 4   | **Receipt per mutation.** Stable effect key, atomic claim, terminal outcome                            | ✅ `agent_run_effects`                            |
| 5   | **Resumable.** Versioned checkpoint; resume repeats no committed effect                                | ✅ `agent_runs.checkpoint`                        |
| 6   | **Attributable.** Initiated-by, actor, policy, model, operation id, audit row                          | ✅ mostly; 🔵 `agent_run_tool_calls`              |

⛔ **No agent may** open a DB connection, hold a provider key, call a third-party
API directly, or emit SQL.

---

## 3. The fifteen agents

| Agent                | Owns                                                                                                   | Real today?                                                                  | Phase |
| -------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ----- |
| **Orchestrator**     | Routing, planning, step tracking, delegation, budget                                                   | 🔵 generalizes the existing 3-node graph                                     | 1     |
| **Research**         | Multi-source synthesis with claim-level citations                                                      | 🔵 `research-graph.ts` exists, **zero callers**                              | 3     |
| **Database Analyst** | Structured, permission-scoped queries                                                                  | 🔵 via `/api/ask` internals                                                  | 2     |
| **Knowledge / RAG**  | Semantic recall, document grounding                                                                    | ⚠️ Ask exists; documents not embedded                                        | 3     |
| **Task**             | A single issue's lifecycle: classify, extract, duplicate-check, subtask, comment, transition, escalate | ⚠️ the 6 capabilities exist; no orchestrator                                 | 4     |
| **Project**          | Project plan, backlog, sprint, dependencies, health                                                    | ⚠️ fixed graph, 3 effect types                                               | 1 → 4 |
| **Team**             | Workload, capacity, assignment                                                                         | 🔵 `smart_assignment_rules` + capacity tables are **specified but dead**     | 6     |
| **Document**         | Read and write documents, slash commands                                                               | 🔵 routes orphaned; `slash-commands.ts` unwired                              | 3     |
| **Communication**    | Notifications, digests, internal announcements                                                         | ⚠️ notifications type enum has no AI item                                    | 4     |
| **Automation**       | Natural-language rules                                                                                 | ⛔                                                                           | 5     |
| **Analytics**        | Metrics, anomaly, risk narrative                                                                       | ⚠️ deterministic endpoints exist; no NL question path                        | 6     |
| **Meeting**          | Transcript → actions                                                                                   | 🔵 `lib/meetings/` exists (uncommitted); LiveKit audio exists; no extraction | 7     |
| **Planning**         | Goals → sequenced plans                                                                                | ⛔                                                                           | 4     |
| **Monitoring**       | Scheduled checks, digests, alerts                                                                      | ⚠️ 3 separate routes today; no goal monitoring                               | 6     |
| **Admin**            | Platform and org AI configuration                                                                      | ⚠️ settings exist across 6 screens; 1 credential route missing               | 0 → 2 |

⚠️ **Admin is not a privileged agent.** It is the same machinery with ADMIN-tier
tools that are **absent from the model catalogue entirely** and reachable only
through existing, already-authorized admin routes. See
[`AI_PERMISSIONS.md`](AI_PERMISSIONS.md) §6.

---

## 4. Orchestration

### 4.1 Routing

```text
utterance
   ↓
intent classification        (a model call, bounded, cheap model)
   ↓
scope resolution             (deterministic: which projects/records the actor can see)
   ↓
plan                         (a model call, structured zod plan)
   ↓
delegate per node            (one or more agents, each with its own bound)
```

| Rule                                                      | Reason                                               |
| --------------------------------------------------------- | ---------------------------------------------------- |
| Intent classification may not authorize anything          | It selects a route, not a permission                 |
| Scope is resolved before planning                         | So the planner cannot plan against invisible records |
| One agent at a time per step unless reads are independent | Keeps the bound comprehensible                       |
| Delegation is recorded                                    | 🔵 `agent_run_steps.parentStepId`                    |

### 4.2 The plan schema

```ts
type AiPlan = z.object({
  intent: z.enum([...]),            // bounded, not free text
  rationale: z.string().max(800),   // shown to the user, never private CoT
  steps: z.array(z.object({
    agent: AgentKey,
    capability: CapabilityKey,      // must exist in the catalogue
    bound: StepBound,               // maxCalls, allowedTools, deadlineMs
    dependsOn: z.array(z.number()).default([]),
  })).min(1).max(12),
  requiresApproval: z.boolean(),    // advisory only; the gate decides
})
```

| Rule                               | Reason                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `requiresApproval` is **advisory** | The model must not be able to lower a tier. The permission engine recomputes it |
| `capability` must resolve          | An unknown capability fails the plan, it does not pass through                  |
| `rationale` is user-facing prose   | [`AI_UX.md`](AI_UX.md) §3 forbids exposing chain-of-thought                     |
| `dependsOn` enables partial retry  | Step 7 failing does not repeat steps 1–6                                        |

---

## 5. Multi-step execution

Spec §18's example, mapped to real mechanics:

```text
"Prepare the mobile launch project for next week"

 1. Inspect project          read  → projects, modules, targetDate          READ
 2. Inspect milestones       read  → issues filtered by type                READ
 3. Find overdue tasks       read  → issues.dueDate < now                   READ
 4. Find blockers            read  → issue_links blocked_by                 READ
 5. Analyze workload         read  → assignments + capacity tables         READ
 6. Identify missing tasks   read  → issues vs plan comparison             READ
 7. Propose plan             model → typed plan, no writes                 —
 8. Request approval         gate → tier per action; persist effects      —
 9. Execute approved         effect → create/update/assign, per receipt    WRITE
10. Launch-readiness report  write → document_pages draft                  WRITE
```

| Step | Failure behaviour                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------- |
| 1–6  | Read-only, idempotent, cheap to repeat. Repeating them is _correct_                                                   |
| 7    | Plan rejected → return to the user with the reason. No partial execution                                              |
| 8    | Suspended. `agent_approval_requests` + outbox; survives a deploy                                                      |
| 9    | Per-effect atomic claim. A committed effect never re-runs; a failed one retries only on classified transient failures |
| 10   | Runs after 9. If 9 partially completed, the report says **exactly** what completed                                    |

🔵 The reporting requirement is deliberate: a partially-applied plan must be
reported as partial, never smoothed over.

---

## 6. Why step 7 failing does not repeat steps 1–6

| Mechanism                                   | Where                                                                  | Mark |
| ------------------------------------------- | ---------------------------------------------------------------------- | ---- |
| Checkpoint after each step, graph-versioned | `agent_runs.checkpoint`                                                | ✅   |
| Resume starts at the persisted node         | `runBoundedGraph`                                                      | ✅   |
| No-progress detection aborts a looping plan | `maxConsecutiveNoProgress = 2`                                         | ✅   |
| Node visit cap                              | `maxVisitsPerNode = 2`                                                 | ✅   |
| Step cap                                    | `maxSteps = 6` (🔵 raise for real plans)                               | ✅   |
| Absolute deadline                           | `provider-deadline.ts`, 120s from admission                            | ✅   |
| Effect idempotency                          | `agent_run_effects` unique `(runId, effectKey)`, `onConflictDoNothing` | ✅   |
| Max tool calls / LLM turns                  | 🔵 **new**                                                             | 🔵   |

⚠️ `maxSteps = 6` is tuned for the existing 3-node graph, not for a 10-step
launch plan. 🔵 The bound must be **per agent and per step**, not a global
constant.

---

## 7. Transactions

Spec §19. Multi-record operations must not leave partial state.

### 7.1 What already guarantees atomicity

| Operation          | Mechanism                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approval execution | "Approval/rejection and core database effects are **atomic**, expiring, policy-revalidated, and exactly once at the database boundary" (`AGENT_RUNTIME.md:7`) |
| Effect receipt     | Insert-then-claim in one transaction, `onConflictDoNothing` on `(runId, effectKey)`                                                                           |
| Status transitions | `prepareIssueStatusTransition` → `applyPreparedIssueStatusTransition` inside `db.transaction`, with row locks and a status CAS                                |
| Sprint rollover    | `/api/cron/cycle-rollover` in a transaction                                                                                                                   |

### 7.2 The rule for AI tools

> **One tool call = one transaction.** Multi-record tools are written as a single
> service function and wrapped by the tool, never composed by the model.

```ts
// correct: one transaction, one receipt
createProjectWithTasks(input)  →  db.transaction( … )  →  { projectId, issueIds[] }

// forbidden: the model orchestrating partial commits
tool("create_project")  →  ok
tool("create_issue")    →  fails halfway
tool("create_issue")    →  retries, duplicates
```

| Requirement                                                    | Detail                                                                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Composite tools get **one** effect key for the whole operation | So a retry cannot duplicate half of it                                                                     |
| Compensation only where business-safe                          | 🔵 `delete` of a just-created issue is a legitimate compensation; reverting an assignment is not automatic |
| 🔵 `agent_run_effects.payload_pre`                             | The pre-image, so a receipt can show and restore the prior state                                           |
| Every transaction-boundary failure is audited                  | Not just successes                                                                                         |

⚠️ **Revert is not deletion.** Undoing an assignment means restoring the prior
`assigneeId` from the receipt's pre-image, which requires `payload_pre`. That
column does not exist yet and is a Phase 0 item.

---

## 8. Background execution

Spec §20: the browser must not have to stay open.

| Work                                             | Mechanism                                                                 | Mark |
| ------------------------------------------------ | ------------------------------------------------------------------------- | ---- |
| Long research, reports, monitoring sweeps, batch | A run enqueued into `agent_runs`, executed by `POST /api/cron/agent-runs` | ✅   |
| Claimed work                                     | Lease + heartbeat + the `(status, leaseExpiresAt, createdAt)` index       | ✅   |
| Abandoned work                                   | `/api/cron/agent-runs` reclaims; status becomes `recoverable`             | ✅   |
| Waking the executor                              | `pg_notify` + `LISTEN` (✅ precedent in the embedding worker)             | ✅   |
| Progress to a closed browser                     | `agent_run_steps` + SSE resumption from a persisted event position        | ✅   |
| Scheduled evaluation                             | 🔵 `automation_rules.schedule_due_at`, reconciled by the same cron route  | 🔵   |
| Long-lived objectives                            | 🔵 `agent_goals` + `agent_goal_steps`, evaluated as separate short runs   | 🔵   |

🔵 `agent_run_kind` is a `pgEnum` with exactly four values — `project_tracking`,
`backlog_triage`, `sprint_planning`, `bulk_sprint_creation`
(`schema/agents.ts:18–24`). Research, monitoring, and goal kinds need a
migration. Nothing else about the runtime changes.

⚠️ **Never hold a lease between evaluations.** A scheduled goal check is a fresh,
short, bounded run. That is why approvals already survive a deploy, and why a
schedule will too.

---

## 9. Communication and Admin agents

### 9.1 Communication

| Capability                             | Bound                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------- |
| In-app notification to a user          | ✅ `notifications` exists; 🔵 a new `type` for "AI needs your decision" |
| Internal announcement / project update | 🔵 reuse existing notification fan-out                                  |
| Email                                  | ⚠️ Level 3 — APPROVE, no override, **no Autopilot**                     |
| Slack / Jira / GitHub                  | ⚠️ Level 3 — APPROVE, no override, no Autopilot                         |
| Anything sent as a named human         | Requires that human's approval. Attribution is not a formality          |

🔵 A communication tool's input is a **rendered draft**, not instructions to send.
Generation and sending are separate calls, so a draft can be reviewed, edited,
and approved independently.

### 9.2 Admin

| Capability                      | Bound                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------- |
| Read AI configuration and usage | `system:view` / `org:settings`                                               |
| Change org AI settings          | `org:settings`                                                               |
| Change global AI policy         | `system:manage`, super admin                                                 |
| Store or rotate a provider key  | Existing credential envelope; 🔵 every rotation audited (⚠️ today it is not) |
| Enable an agent or tool         | 🔵 global allowlist                                                          |
| Set autonomy limits             | 🔵 never above the super-admin maximum                                       |

⛔ **An ADMIN capability is never in the model's tool catalogue.** The AI may
_explain_ how to configure something; it may not do it for the user through a
tool. Configuration changes flow through the existing, already-authorized admin
routes with a human session.

---

## 10. Human-in-the-loop behaviour

Spec §28. The refusal must be specific, actionable, and honest.

```text
I can prepare this change, but your role does not allow me to execute it.

What I can do:
  • Build the plan and show you the exact diff
  • Create the draft so you can review it

What is blocked:
  projects.settings.update — available to project owners and org admins

Ask Priya Raman (project owner) to review it, or I can hand the request to the
approval queue if your workspace routes it there.
```

| Rule                                                     | Reason                                                  |
| -------------------------------------------------------- | ------------------------------------------------------- |
| Name the missing permission                              | So the user can act, not just be blocked                |
| Name who _can_                                           | Resolved from real membership, never guessed            |
| Offer the nearest permitted alternative                  | Always                                                  |
| Never imply the AI lacks the ability for a policy reason | The limitation is authority, not capability — say which |
| Never retry a denial hoping for a different outcome      | A denial is a fact                                      |

---

## 11. Explanations

Spec §29. Concise summaries, no hidden chain-of-thought.

```text
answer:
  I found 8 overdue tasks.

  I prioritized them by:
    • deadline proximity
    • project priority (issues.priority)
    • dependency status (issue_links blocked_by)
    • current workflow status

  Recommended first: TN-471, TN-455, TN-460.

execution:
  Completed
    ✓ created 3 tasks in Project Orion
    ✓ updated 2 deadlines
    ✓ sent 1 internal notification to Sam Okoye

  Skipped
    • reassigned TN-471 — requires project:assign, which you do not have

  Cost: 12,410 tokens · ~$0.004 · model deepseek-chat (role: plan)
  Revert: available for 7 days from the receipt
```

| Rule                            | Reason                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Criteria, not deliberation      | "I prioritized by deadline and dependency" — not "I thought about it"          |
| Cite the actual fields          | Makes the ranking auditable and challengeable                                  |
| Report skips explicitly         | Silence would imply success                                                    |
| Show the cost                   | Cost awareness is a trust feature ([`AI_COST_CONTROL.md`](AI_COST_CONTROL.md)) |
| Offer revert                    | The single most important trust affordance ([`AI_UX.md`](AI_UX.md) §4)         |
| ⛔ Never emit private reasoning | The stored rationale is a short user-facing justification                      |

---

## 12. Agent quality gates

| Gate               | Requirement                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Declaration        | Every agent's graph is registered with declared routes; an undeclared edge fails closed          |
| Bound              | Max steps, visits, tool calls, turns, tokens, cost, deadline — all set and tested                |
| Authorization      | Every tool's `requiredPermission` resolves for at least one role and denies for a lower one      |
| Tenant             | A cross-tenant negative test per agent                                                           |
| Idempotency        | Re-running a step produces no duplicate effect                                                   |
| Receipt            | Every committed mutation has one, and it resolves from the modified record                       |
| Resumption         | Kill the process mid-step; resume repeats no committed effect                                    |
| Explanation        | Every outcome produces a rationale with no private reasoning                                     |
| Budget             | Budget exhaustion ends the run with `429`-class behaviour and notifies — never silently degraded |
| Accessibility/i18n | Any new UI surface follows [`AI_UX.md`](AI_UX.md) §7–§8                                          |

Related: [`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md) ·
[`AI_TOOL_SYSTEM.md`](AI_TOOL_SYSTEM.md) ·
[`AI_AUTONOMOUS_EXECUTION.md`](AI_AUTONOMOUS_EXECUTION.md) ·
[`AI_SECURITY.md`](AI_SECURITY.md)
