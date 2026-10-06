# ValidTeam AI operating system — target architecture

**Status:** design. Not implemented. Every 🔵 item in this document is a proposal;
nothing here should be read as shipped. Verified claims about today come from
[`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md).

## Standing constraint

This plan is built on one rule:

> **Converge, do not add a sixth AI subsystem.**

ValidTeam already has a durable agent graph, a working approval queue, a real
permission idiom, a real workflow transition service, a real budget guard, a
real search stack, and a real automation engine. The failure mode of this
product is _disconnected enforcement and last-mile wiring_, not absence of
pieces. So every phase below either **routes an existing capability through a new
shared substrate** or **fixes a seam in an existing subsystem**. Nothing
proposes a new microservice, a second permission model, a second approvals
table, a second vector store, or a new queue framework.

---

## 1. The concept

Users experience **one** thing: ValidTeam AI.

Internally, ValidTeam AI is:

```text
                        ┌─────────────────────────────┐
                        │        ValidTeam AI         │
                        │   one surface, one thread,  │
                        │   one permission model,     │
                        │   one audit trail           │
                        └──────────────┬──────────────┘
                                       │
                              ┌────────▼────────┐
                              │   Orchestrator   │
                              │  (graph runtime) │
                              └────────┬────────┘
                                       │
        ┌──────────────┬───────────────┼───────────────┬──────────────┐
        │              │               │               │              │
   Task Agent   Project Agent   Knowledge Agent  Document Agent  Analytics Agent
        │              │               │               │              │
   Team Agent  Communication     Meeting Agent    Automation Agent
```

The specialist names are **internal routing labels**, not products. A user who
says _"summarize what the mobile launch team did this week"_ should not be
asked which agent is handling it, and should not see a bot switch.

### Why the distinction matters

Splitting "one AI" from "many agents" is what lets us do three things:

1. **Ship incrementally.** The Orchestrator can route to exactly one capability
   in Phase 1 and still present as one coherent assistant.
2. **Enforce centrally.** Authorization, approval, budget, audit, and safety are
   applied once at the Orchestrator boundary instead of being re-derived inside
   five subsystems.
3. **Keep prompts honest.** A specialist's system prompt can be narrow and
   domain-specific while the user's mental model stays singular.

---

## 2. Architectural decision: modules, not services

The prompt explicitly asks whether agents should be separate services, modules,
tool-specialized prompts, stateful workers, or background jobs. For this
codebase the answer is unambiguous, and it is not "microservices".

| Option                                                       | Verdict                               | Reason                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separate services                                            | **Rejected**                          | The product is one Next.js standalone image plus one Hocuspocus service. Adding an AI service means a second deployment, a second auth story, a second network hop, a second failure domain, and a new cross-service tenant boundary — for a product that already has a working in-process leased worker and no RLS. |
| Modules (plain code)                                         | **Rejected as the unit of execution** | A module cannot hold a lease, survive a pod restart, or resume a checkpoint. ValidTeam already learned this with local coding agents, which "still run in the web request process; a restart can lose active work" (`STATUS.md:91–93`).                                                                              |
| **Tool-specialized prompts over the existing durable graph** | **✅ Adopted**                        | `runBoundedGraph` + `agent_runs` already give versioned topology, explicit routing, finite bounds, checkpoints, cancellation, idempotent effects, and leases. A "specialist" is a **declared graph** — a node set, a provider prompt, and a bound tool set — registered into the existing runtime.                   |
| Stateful workers                                             | **✅ Adopted, already exists**        | `processProjectAgentRunQueue` + `/api/cron/agent-runs` is the leased worker. Every new capability registers as another `agent_run_kind` and reuses it.                                                                                                                                                               |
| Background jobs                                              | **✅ Adopted for monitoring only**    | Proactive monitoring needs _time_, not _requests_. That is the existing cron surface (`/api/cron/*`) plus `automation_executions` as the run log.                                                                                                                                                                    |

### Concretely

```text
apps/web/src/lib/ai/
  runtime/          🔵 thin façade over lib/agents/graph-runtime.ts + agent_runs
    orchestrator.ts     one graph: route → gather → plan → propose → execute → report
    specialists/        each exports a GraphDefinition + a bound tool set
      task-agent.ts
      project-agent.ts
      team-agent.ts
      knowledge-agent.ts
      document-agent.ts
      communication-agent.ts
      meeting-agent.ts
      analytics-agent.ts
      automation-agent.ts
  tools/            🔵 the tool registry (see §5)
    registry.ts         typed tool definitions, capability tiers, input schemas
    issues.ts           tools wrapping existing issue routes/services
    projects.ts  sprints.ts  documents.ts  people.ts  analytics.ts
    automation.ts  notifications.ts  search.ts
  context/          🔵 page context capture + resolution
  goals/            🔵 long-running goal objects
  memory/           🔵 read/write memory over content_embeddings + new small tables
```

Every one of these lives inside the existing Next.js app, in the existing
`lib/ai` directory, next to `budget.ts`, `feature-gate.ts`, and `safety/`. No new
package. No new service. No new deployment target.

---

## 3. The Orchestrator

The Orchestrator is the only thing that talks to a user. It is a bounded graph,
not a free-form agent loop.

### 3.1 Responsibilities

| Responsibility                         | How it is realised                                                                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Understand intent                      | One provider call against a compact system prompt + resolved context. Output is a **typed intent**, not prose                                                          |
| Understand context                     | `resolveContext()` — see §6                                                                                                                                            |
| Break complex requests into steps      | `plan` node emits an ordered step list, each naming a specialist and a bound tool set                                                                                  |
| Select the specialist                  | Deterministic routing table on the intent type, with the model only choosing among 2–3 viable candidates                                                               |
| Decide which tools are needed          | The step's declared tool set is a **hard bound**; the model cannot widen it                                                                                            |
| Check permissions                      | **Never by the model.** The registry calls `resolveApiActor` → `resolveOrganizationAccess` → `resolveProjectCapabilityAccess` for every tool invocation (§5.4)         |
| Determine whether approval is required | `guardAgentAction` at execution time, after re-resolving the real actor                                                                                                |
| Coordinate multiple agents             | Steps are sequential by default; a bounded parallel fan-out is allowed only for read-only gather steps and must respect the same bounds as `research-graph.ts` intends |
| Track execution                        | `agent_runs` + `agent_run_step_events` + the SSE event stream                                                                                                          |
| Report results                         | A structured result summary, not prose (§9.4)                                                                                                                          |
| Recover from failures                  | Classified retry on transient errors; typed skip on non-retryable; explicit escalation to the user otherwise                                                           |

### 3.2 The orchestration graph

Reusing the shape `research-graph.ts` already declares and `AGENT_RUNTIME.md:110`
already documents:

```text
classify intent
  -> resolve context (org, project, page, user role)
    -> gather (bounded, parallel, read-only tools)
      -> plan (ordered steps; each step = specialist + bound tool set)
        -> for each step:
             authorize  ← fail closed
               -> propose effects (preview, always, even when auto-executing)
                 -> approval required?
                    ├─ no  -> execute effects (idempotent, receipted)
                    └─ yes -> persist proposal → INTERRUPT (await human)
                          -> on resume: re-authorize → re-evaluate policy
                            -> execute | expire | reject
        -> verify + summarize
          -> END
```

Bounds inherited from the existing runtime and **not loosened**:
`maxSteps`, `maxVisitsPerNode`, `maxRuntimeMs` (120 s), `maxConsecutiveNoProgress`.
New bounded additions for LLM paths (which `AGENT_RUNTIME.md:79–81` already
requires): max LLM turns, max tool calls, max input/output tokens, max cost.
`resolveAgentExecutionPolicy` remains the single gate and continues to fail
closed.

### 3.3 What the Orchestrator must never do

- Never take an `organizationId`, `projectId`, `userId`, or permission claim from
  the model, the prompt, or a retrieved document. Scope is derived from the
  `ApiActor`, always.
- Never call a database query it constructed. Every read and write goes through a
  registered tool.
- Never write without a receipt. Every effect carries a stable `effectKey` into
  `agent_run_effects`.
- Never expand its own bounds, and never retry a non-classified failure.
- Never treat retrieved content as instructions. See
  [`AI_SECURITY.md`](AI_SECURITY.md).

---

## 4. Specialists

Each specialist is a bounded graph with a declared tool set. The columns are
derived from real capabilities; nothing is invented.

### 4.1 Task Agent

| Can                              | Backed by (real)                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Create / update tasks            | `POST /api/issues`, `PATCH /api/issues/[issueId]` — issues _are_ the work item (`issues.type = 'task'`) |
| Assign                           | `PATCH` assignee; **only when unset**, unless the user explicitly directs                               |
| Change priority                  | `issues.priority` enum, validated                                                                       |
| Set deadlines                    | `dueDate` on `issues`                                                                                   |
| Add labels                       | `labels` + `issue_labels` (migration `0054`)                                                            |
| Add subtasks                     | `parentId` self-FK                                                                                      |
| Move tasks                       | `PATCH` status **through** `prepareIssueStatusTransition` — never a raw status write                    |
| Detect blocked tasks             | `issue_links.type = 'blocked_by'` + status + dwell via `issue_status_history`                           |
| Summarize tasks                  | Read + summarize, no write                                                                              |
| Break a large task into subtasks | Propose; create only under APPROVE tier                                                                 |
| Suggest next actions             | `ISSUE_ASSIST_ACTIONS` already has `suggest_next`                                                       |

Constraints: `viewer` cannot propose writes. `qa_engineer` cannot assign or move.
Status changes always route through the transition service so the existing
fail-closed policy (`AGENT_RUNTIME.md:28`) keeps holding.

### 4.2 Project Agent

| Can                         | Backed by                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| Create / configure projects | `POST/PATCH /api/projects`                                                                      |
| Generate a project plan     | Reuse the existing `load_context → plan → execute` graph, extended with a planning output shape |
| Create milestones           | `project_modules` + `versions` (`project_versions`)                                             |
| Analyze project health      | `GET /api/analytics/project-health`, `insight`, `forecast`                                      |
| Detect delays               | `project.startDate/targetDate` + sprint + status history                                        |
| Identify risks              | Cross-signal analysis over existing analytics                                                   |
| Summarize status            | Read-only aggregate                                                                             |
| Recommend priorities        | `issues.priority` proposals                                                                     |
| Generate reports            | Draft only; publishing to email/Slack is EXECUTE tier                                           |

Constraints: `project:create` / `project:settings` required; anything touching
security schemes is ADMIN tier and out of scope for autonomous use.

### 4.3 Team Agent

| Can                             | Backed by                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Understand team workload        | `GET /api/metrics/my-workload`, `issues.assigneeId`, `time_entries`, `sprints` |
| Identify overloaded members     | Same, aggregated                                                               |
| Identify idle capacity          | Same                                                                           |
| Suggest assignments             | Proposals only                                                                 |
| Summarize team activity         | `issue_activities`, `notifications`, `standups`                                |
| Identify collaboration problems | `issue_links`, blocked counts, status dwell                                    |
| Prepare standups                | **Already exists**: `lib/agents/standup.ts`                                    |
| Prepare team updates            | Draft                                                                          |

**Explicit prohibition.** No personnel decisions. No performance ratings, no
promotion/termination signals, no private one-to-one content, no ordering of
individuals by "productivity". Assignment changes are proposals requiring
`issue:assign` from a human who can see the same data. The six dead
`resource-management.ts` tables may eventually back this agent, but that is a
separate decision (§12).

### 4.4 Document Agent

| Can                                  | Backed by                                             |
| ------------------------------------ | ----------------------------------------------------- |
| Read documents                       | `document_pages.contentText` / `contentJson`          |
| Summarize                            | Read-only                                             |
| Write / rewrite documents            | `POST/PATCH /api/docs/pages` → creates a **revision** |
| Meeting notes, specs, project briefs | Same, as new pages under a `document_space`           |
| Convert notes into structured plans  | Proposals against `issues` / `project_modules`        |
| Extract action items                 | Proposals → Task Agent                                |
| Compare documents                    | Two-page read + diff                                  |
| Answer questions about documents     | Requires embedding them — see §8                      |

The editor currently has **13 slash commands, none AI**. Adding an
`/ai-…` command family is the natural inline surface, and it must be added to
all 30 locale catalogs.

### 4.5 Communication Agent

| Can                               | Backed by                                                                   |
| --------------------------------- | --------------------------------------------------------------------------- |
| Draft comments                    | `issue_comments` draft; posting is EXECUTE                                  |
| Draft announcements               | Draft                                                                       |
| Draft updates                     | Draft                                                                       |
| Draft emails                      | `lib/email/sender.ts` + `email_templates` — **draft only, never auto-send** |
| Summarize conversations           | `chat_messages`, `issue_comments`, `notifications`                          |
| Prepare stakeholder updates       | Draft                                                                       |
| Turn activity into status reports | Read `issue_activities` / `audit_logs` → draft                              |

**Sending externally** (Slack post, email, Jira/GitHub comment) requires
APPROVE tier always, per
[`AI_APPROVALS.md`](AI_APPROVALS.md). Existing outbound infrastructure:
10 webhook event types, 12 Slack slash commands, `notification_preferences`.

Note: `chat_messages` is LiveKit room messaging with **no transcription**. The
Communication Agent can summarize _stored_ messages only.

### 4.6 Meeting Agent

| Can                  | Reality                                             |
| -------------------- | --------------------------------------------------- |
| Prepare meetings     | Read: agenda-relevant issues, docs, recent activity |
| Generate agendas     | Draft                                               |
| Summarize meetings   | Only if a transcript is **supplied** — see below    |
| Extract action items | From supplied transcript or from pasted notes       |
| Assign action items  | Proposals → Task Agent                              |
| Follow-up reminders  | Via the Automation Agent                            |
| Track decisions      | **Needs a new record** (§12)                        |

**Transcript reality check.** LiveKit voice rooms exist
(`lib/chat/livekit.ts`) but there is **no STT, no recording, no transcript
table**. So meeting intelligence is honest only in two forms: (a) a user pastes
notes/transcript, or (b) an integration later delivers one. The design must not
imply live transcription exists. If LiveKit transcription or a meeting provider
is added, it arrives as a **tool** that ingests a document — not as a special
agent capability.

### 4.7 Knowledge Agent

The organizational knowledge layer. Answers:

> "Why was this project delayed?" · "What did we decide about the payment
> integration?" · "Show me everything related to the mobile launch." · "What
> still needs to happen before launch?"

| Question type                 | Source                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| "Why delayed?"                | `issues` (`blocked_by` links, `dueDate`), `issue_activities`, `issue_status_history` dwell, `issue_comments`, sprint history |
| "What did we decide?"         | `document_pages` + `document_page_revisions` + `issue_comments` + `audit_logs`. **Decisions are prose today** — see §8.3     |
| "Everything about X"          | Hybrid search across issues, comments, documents, initiatives                                                                |
| "What still needs to happen?" | Open `issues` filtered by project/version/module + target dates                                                              |

It is built on the existing retrieval stack — `lib/search/hybrid.ts` (BM25 ∪
pgvector, RRF k=60) — plus the prerequisite that **documents be embedded**
(§8.1). It must answer **"I don't know"** with the evidence it does have rather
than synthesize. `AGENT_RUNTIME.md:99–101` already requires attributable
evidence; the Agent must emit source identity, retrieval time, and unresolved
claims.

### 4.8 Analytics Agent

Answers:

> "How is the engineering team doing this month?" · "Which projects are at
> risk?" · "Where are we losing the most time?" · "Which tasks keep slipping?" ·
> "What changed this week?"

Every one of these already has a **real** endpoint behind it:
`/api/analytics/{burndown,cycle-time,dora,forecast,insight,project-health,throughput,velocity}`
and `/api/metrics/my-workload`. The Analytics Agent's job is to **choose and
narrate real numbers**, never to compute them from prose.

**Anti-hallucination rule:** the agent's numeric outputs must be traceable to a
tool response. Any number not present in a tool result is a defect, not a
formatting choice. This is enforceable — the tool wrapper can carry the raw
result, and the summary renderer can require it.

### 4.9 Automation Agent

The highest-leverage specialist, because the substrate already exists.

| User says                                                                   | Becomes                                      |
| --------------------------------------------------------------------------- | -------------------------------------------- |
| "Whenever a task becomes overdue, notify the assignee and project manager." | An `automation_rules` row                    |
| "Every Friday afternoon, prepare a project status report."                  | A rule + **a new schedule capability** (§12) |
| "When a task is completed, create a follow-up task for QA."                 | A rule                                       |

Today the engine has **8 triggers** (`issue.created`, `issue.updated`,
`issue.status_changed`, `issue.assigned`, `sprint.started`, `sprint.completed`,
`project.created`, `project.archived`), **6 actions** (`set_status`, `assign`,
`add_label`, `add_comment`, `set_priority`, `notify_user`), dotted-path
conditions with implicit AND and 7 operators, and `automation_executions` as the
run log.

The Automation Agent therefore needs three things, none of which is a new
engine:

1. 🔵 **Zod schemas for `trigger`, `conditions`, `actions` plus a
   `schemaVersion`.** Today these are unvalidated JSONB — "the one place in this
   model where bad data cannot be caught at any layer". A rule the AI writes must
   be validated identically to a rule a human writes, in the same schema.
2. 🔵 **A `schedule` trigger** (cron or interval) with a durable due-at, because
   the schema has no recurrence field at all today.
3. 🔵 **A simulation/preview mode** so the user sees which issues would match
   before the rule is enabled.

Rule creation and rule mutation are **medium risk** → APPROVE by default. The AI
must never be able to author a rule that bypasses the approval gate for the rule's
own effects.

---

## 5. Tool architecture

### 5.1 The pipeline

```text
model
  ↓
Orchestrator (bounded graph)
  ↓
Tool Selection          ← the step's bound tool set; model cannot widen it
  ↓
Permission Gate         ← resolveApiActor → org access → project capability
  ↓
Risk Tier Check         ← READ / WRITE / EXECUTE / APPROVE / ADMIN
  ↓
Policy Gate             ← guardAgentAction (server-derived actor, not body-supplied)
  ↓
Effect Preview          ← always built, even when auto-executing
  ↓
Approval Interrupt      ← only when the tier or policy demands it
  ↓
Execution Service       ← the existing route/service logic, not a new data path
  ↓
Receipt                 ← agent_run_effects (effectKey, atomic claim, terminal outcome)
  ↓
Audit + Realtime        ← createAuditLog + publishEvent
  ↓
Result (structured)     ← returned to the Orchestrator, never raw SQL or raw rows
```

### 5.2 Tool definition shape

Derived from the real MCP tool shape (`packages/mcp-server/src/tools/types.ts`)
so the two systems can share a definition:

```ts
type ToolCapability = 'read' | 'write' | 'execute' | 'approve' | 'admin';

interface ToolDefinition<Schema> {
  name: string; // e.g. 'issues.search'
  capability: ToolCapability;
  description: string;
  inputSchema: Schema; // zod
  outputSchema: Schema; // zod — the model never sees raw rows
  // 🔵 authorization requirements, expressed with EXISTING helpers only:
  authorize: (actor: ApiActor, input: Schema) => Promise<AuthzResult>;
  // 🔵 preview builder — always produces a human-readable diff
  preview: (actor: ApiActor, input: Schema) => Promise<EffectPreview[]>;
  // 🔵 execution: delegate to the existing service/route handler
  execute: (actor: ApiActor, input: Schema, ctx: ToolContext) => Promise<ToolResult>;
  // 🔵 idempotency
  effectKey: (input: Schema, actor: ApiActor) => string;
  cost: { model?: 'cheap' | 'standard' | 'reasoning'; tokens?: number };
  reversible: boolean; // drives whether the UI offers Revert
  reads: string[];
  writes: string[]; // for the control center's data-access view
}
```

`reversible` is a **new, load-bearing field**. Nothing in the product can revert
an AI write today (§7.4 of the audit). A tool that cannot be compensated must be
marked so the UI never offers a false promise.

### 5.3 Tool catalogue — derived from the actual API

**This is the authoritative list.** Every tool names a real endpoint or service
that exists today. Tools marked ➕ are the only genuinely new server-side code,
and each exists only because the underlying route exists.

#### Issues and work items (26 routes exist)

| Tool                       | Cap   | Wraps                                                    |
| -------------------------- | ----- | -------------------------------------------------------- |
| `issues.search`            | read  | `POST /api/search/hybrid`                                |
| `issues.get`               | read  | `GET /api/issues/[issueId]`                              |
| `issues.my_work`           | read  | `GET /api/issues/my-issues`                              |
| `issues.create`            | write | `POST /api/issues`                                       |
| `issues.update`            | write | `PATCH /api/issues/[issueId]`                            |
| `issues.transition`        | write | transition service via `PATCH`                           |
| `issues.bulk_update`       | write | `POST /api/issues/bulk`                                  |
| `issues.delete`            | write | `DELETE /api/issues/[issueId]`                           |
| `issues.assign`            | write | `PATCH` assignee, unset-only by default                  |
| `issues.comment_list`      | read  | `GET /api/issues/[issueId]/comments`                     |
| `issues.comment_create`    | write | `POST /api/issues/[issueId]/comments`                    |
| `issues.link`              | write | `POST /api/issues/[issueId]/links`                       |
| `issues.custom_fields_set` | write | `POST /api/issues/[issueId]/custom-fields`               |
| `issues.components_set`    | write | `PUT /api/issues/[issueId]/components`                   |
| `issues.versions_set`      | write | `PUT /api/issues/[issueId]/versions`                     |
| `issues.attachments_list`  | read  | `GET /api/issues/[issueId]/attachments`                  |
| `issues.activities`        | read  | `GET /api/issues/[issueId]/activities`                   |
| `issues.time_in_status`    | read  | `GET /api/issues/[issueId]/time-in-status`               |
| `issues.triage_propose`    | read  | `POST /api/issues/[issueId]/triage` (proposal, no write) |
| `issues.triage_apply`      | write | `POST /api/issues/[issueId]/triage/apply`                |
| `issues.estimate_suggest`  | read  | `POST /api/issues/[issueId]/ai-estimate`                 |

#### Projects, sprints, portfolio (28 + 8 routes exist)

`projects.search` (read) · `projects.get` (read) · `projects.create` (write) ·
`projects.update` (write) · `projects.members_add` (write) · `projects.modules_*`
(write) · `sprints.list` (read) · `sprints.get` (read) · `sprints.create` (write) ·
`sprints.update` (write) · `sprints.assign_issues` (write) · `cycles.rollover`
(write) · `versions.*` (write) · `components.*` (write) · `initiatives.*` (write) ·
`intake_forms.*` (write) — all real endpoints.

#### Documents (10 routes exist)

`documents.search` (read, `GET /api/docs/search`) · `documents.get` (read) ·
`documents.tree` (read) · `documents.create` (write) · `documents.update` (write,
creates a revision) · `documents.revisions_list` (read) ·
`documents.restore` (write) · `documents.attachments_*` (read/write) ·
`documents.share_set` (write, **APPROVE tier** — changes external exposure) ·
`documents.spaces_*` (write).

#### People and team

`people.search` (read) · `people.get` (read) · `people.my_workload` (read) ·
`teams.list` (read) · `teams.get` (read) · `org.members_list` (read, requires
`member:view`) · `workload.aggregate` (read, ➕ thin aggregation over existing
`issues`/`time_entries`/`sprints` — no new table).

#### Analytics (8 routes exist)

`analytics.project_health` · `analytics.throughput` · `analytics.velocity` ·
`analytics.burndown` · `analytics.cycle_time` · `analytics.dora` ·
`analytics.forecast` · `analytics.insight` — **all read, all existing**. The
agent's only job is selection and narration.

#### Automation and workflow (8 routes exist)

`automation.list` (read) · `automation.get` (read) · `automation.simulate` (read,
➕ **must exist before AI-authored rules are allowed**) · `automation.create`
(write, **APPROVE**) · `automation.update` (write, **APPROVE**) ·
`automation.delete` (write, **APPROVE**) · `automation.executions` (read) ·
`workflow.get` (read) · `workflow.transitions_list` (read).

#### Notifications and search

`notifications.send` (execute — internal in-app only; respects
`notification_preferences`) · `notifications.preferences_get` (read) ·
`search.unified` (read, ➕ — the palette searches issues+docs+people; there is no
single REST equivalent today) · `search.semantic` (read, pgvector leg — dormant
until §8.1 lands).

#### Explicitly **out of scope** for the tool catalogue

| Excluded                                         | Why                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Anything under `/api/admin/**`                   | Platform operations. Not an org-scoped tool surface                                                    |
| `security-schemes.*`, `permission-schemes.*`     | ADMIN tier; and these are **not enforced today**, so an AI touching them would be operating on fiction |
| `api_keys.*`                                     | Credential minting is never automated                                                                  |
| `sso_configs.*`, `scim_tokens.*`                 | Same                                                                                                   |
| `settings.system.*` (SMTP, storage, LiveKit)     | Platform configuration                                                                                 |
| `setup`, `health`, `ready`, `metrics`, `uploads` | Infrastructure                                                                                         |
| Any tool that executes SQL the model composed    | Non-negotiable                                                                                         |

### 5.4 The permission gate, concretely

Every tool's `authorize` composes **only** existing helpers:

```ts
// READ
resolveApiActor(request)                         // lib/auth/api-actor.ts:56
resolveOrganizationAccess(orgId, userId)          // active user + membership + org
getPermittedOrganizationIds(userId)               // for any list tool
resolveProjectCapabilityAccess(projectId, userId) // per-project can_* matrix
canReadProject(projectId, userId)

// WRITE
…plus hasPermission(orgId, 'issue:edit' | 'project:manage' | …)   // 51-string matrix
…plus guardAgentAction({ actor: <server-derived>, … })           // policy + approval
…plus prepareIssueStatusTransition(...)                          // for any status change

// EXECUTE
…plus an integration credential from agent_providers / integration_client_credentials

// APPROVE
…plus an approval request row + a resume path that re-authorizes

// ADMIN
…plus isSuperAdmin()
```

**The single most important change in this plan:** the actor passed to
`guardAgentAction` is derived **server-side from the `ApiActor`** — from whether
the credential is a session or an agent-scoped API key — instead of being read
from a client-supplied body marker. That closes the highest-severity finding in
[`AI_SECURITY.md`](AI_SECURITY.md) and is a prerequisite for Phase 3.

---

## 6. Contextual AI

The user must never have to say "in project MOBILE". Context is resolved, not
asked.

### 6.1 Capture

The existing sidecar already has a context channel
(`lib/ai/sidecar-context.ts` with `setEntity`), but it has **no product caller**.
Wiring it is most of the work.

| On page               | Resolved context                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| Issue detail          | issue, project, sprint, status, labels, assignee, recent activity, recent comments, my permissions on it |
| Project board/backlog | project, my visible filter, sprint, modules, versions, team, my permissions                              |
| Sprint                | sprint, its issues, its team, capacity signals                                                           |
| Document              | page, space, ancestors, linked issues, revisions                                                         |
| Team                  | team, members, their open work, workload                                                                 |
| Analytics             | the chart's metric, period, scope                                                                        |
| Settings              | the settings scope and my admin permissions — **never** the secret values                                |
| Admin                 | platform scope; super-admin only                                                                         |

### 6.2 Resolution rules

1. Scope is **intersected**: page context ∩ my permissions. If the page is a
   project I cannot read, context resolution fails closed and the AI says so.
2. Context is a **bounded summary**, not a page dump. Issue: title, status,
   description excerpt, assignee, dates, counts. The orchestrator can fetch more
   via tools.
3. **Settings values are never injected into the prompt.** Configuration scope is
   passed as _field names and visibility_, never as values, so a prompt can
   never exfiltrate an SMTP password or a webhook secret.
4. Context is shown. The sidecar states which project/issue/team the AI is
   looking at, so the "silent scope" defect in the dashboard (`firstProjectId`
   as an undeclared default) is fixed in one place.

---

## 7. Long-running goals

> "Help me get this project ready for launch by Friday."

### 7.1 What a goal is

A **goal** is a persistent objective with a definition of done, an owner, a
budget, and a schedule. It is _not_ a chat thread. A thread ends when the user
closes it; a goal survives for weeks.

```text
goal
 ├─ objective (user's words, preserved verbatim)
 ├─ success_criteria (derived, user-confirmed)
 ├─ scope (project(s), optional versions/modules/sprints)
 ├─ owner (a human — never the AI)
 ├─ state: active | blocked | at_risk | satisfied | cancelled | expired
 ├─ budget: {maxRuns, maxTokens, maxCostUsd, deadlineAt}
 └─ steps[] → each step is an existing agent_run (kind = goal_step)
```

### 7.2 The loop

```text
1. Analyze current state            → existing read tools + analytics
2. Identify missing work            → diff current vs success criteria
3. Create a plan                    → proposed steps, persisted
4. Obtain approval where required   → INTERRUPT
5. Monitor progress                 → scheduled re-evaluations, NOT a held request
6. Detect blockers                  → links, dwell, staleness, absence of movement
7. Notify the right humans          → notifications + approval requests
8. Update the plan                  → new steps, revised criteria
9. Produce a readiness report       → evidence-backed summary
```

Step 5 is the crux: **a goal is evaluated by the scheduler, not by a long-held
request.** ValidTeam has no long-lived request; it has `agent_runs` with leases
and deadlines, plus seven cron routes. A goal registers a due-at, and a cron pass
(the same pass that reconciles `agent_runs`) picks it up. This is how the goal
survives a deploy.

### 7.3 Hard rules

- **A goal never holds a lease open.** Each evaluation is a separate,
  short-lived run with its own bounds and its own receipt.
- **A goal has a human owner.** The AI reports; a person decides.
- **A goal cannot exceed its budget** — `runWithBudget` and `org_token_budgets`
  apply, and exhaustion stops the goal and notifies the owner.
- **A goal must be able to fail.** Explicit states, explicit reasons, an
  `at_risk` signal, and a human cancel. Silence is a defect.
- **A goal cannot approve itself.**

---

## 8. Memory

Four stores, deliberately separated, all respecting tenancy.

### 8.1 Retrieval memory — extend what exists

`content_embeddings` is `vector(1536)` with a `contentType`/`contentId` unique
index, drained from `content_embeddings_queue` by `/api/cron/embeddings`, and
queried by `lib/search/hybrid.ts` via HNSW + `withEfSearch`.

🔵 **Prerequisite: embed `document_pages`.** `EmbedContentType` is `'issue' |
'comment'` today, so the entire wiki is invisible to meaning. This is the single
highest-value retrieval change and it needs **no new table and no new store** —
one enum widening and one builder function. Until it lands, the Knowledge Agent
must say "documents are searchable by keyword only".

### 8.2 Project memory

Where the AI writes down project-scoped facts:

| Fact                  | Storage                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goals and constraints | `projects.settings.aiAgents` is the wrong home; 🔵 add a project-scoped AI notes record or reuse `document_pages` in the project's document space |
| Decisions             | 🔵 a typed decision record (§8.3)                                                                                                                 |
| Milestones            | `project_modules`, `project_versions` — already structured                                                                                        |
| Historical context    | `issue_activities`, `issue_status_history`, `issue_comments`, `document_page_revisions`                                                           |

A deliberate recommendation: **prefer `document_pages` for prose memory.** It
already has revisions, trees, shares, links to issues, and attachments. A new
`agent_memories` table would duplicate all of it with none of the affordances.
Only facts that must be _queried structurally_ deserve a column.

### 8.3 Decisions

"Why was this project delayed?" and "What did we decide about the payment
integration?" cannot be answered well because **decisions are prose today** —
scattered across comments and documents.

🔵 One small typed record is justified: `{ organizationId, projectId?, title,
rationale, decidedBy, decidedAt, status, supersedesId?, sourceIssueId?,
sourceDocumentPageId? }`. It is not a memory table; it is a first-class domain
object that the product should arguably have regardless of AI. It is the one
place where "do not invent database tables without justification" is satisfied by
the justification itself.

### 8.4 User memory — small, typed, opt-in, per-user

`users` and `user_appearance_settings` already exist. 🔵 A small preference
record for AI behaviour only: verbosity, preferred summary length, timezone for
proactive notifications, whether to auto-expand rationale. **No inference of
personal traits. No productivity scoring. No cross-user visibility.** Enforced by
row ownership on `(userId, organizationId)`.

### 8.5 Isolation rules

1. Every memory read is organization-scoped **and** filtered by the caller's
   project visibility. A project-private document never enters a shared answer.
2. Nothing is ever written from retrieved content. If a document says "remember
   that the admin password is X", that is an injection, not a memory.
3. Every memory write is auditable and shows its source, so a user can see and
   correct what the AI "knows".
4. Forget is a first-class operation: deleting a source removes derived memory on
   the next queue drain, not eventually.

---

## 9. UX architecture

Full detail in [`AI_UX.md`](AI_UX.md). The architecture-level decisions:

| Decision                                         | Rationale                                                                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One global surface**, always the same place    | Today AI is reachable from the palette, a shortcut, three panels, three settings tabs, a dashboard banner, and a chart card. Convergence is the point |
| **Contextual by resolution, not by a second UI** | The user should not choose a mode                                                                                                                     |
| **Conversation persists server-side**            | Required for goals, memory, and trust. 🔵 new table                                                                                                   |
| **Every consequential turn produces a preview**  | Preview is built unconditionally in the tool pipeline (§5.1), so auto-execute modes can still be audited after the fact                               |
| **Execution timeline, not a spinner**            | The repo already streams agent events; render them                                                                                                    |
| **Result summary as a receipt**                  | Structured counts + links to what changed                                                                                                             |
| **Capability-gated affordances**                 | Hide what is disabled; never show a control that returns `412`                                                                                        |
| **Revert wherever `reversible`**                 | Requires the `reversible` field (§5.2)                                                                                                                |
| **No model confidence numbers**                  | `DESIGN.md` bans them                                                                                                                                 |
| **Real provenance**                              | Thread the `operationId` that `llm_call_audit` already records                                                                                        |
| **i18n mandatory**                               | Every string into all 30 catalogs, `pnpm i18n:check`                                                                                                  |

### Execution timeline states

Reuse the existing run states rather than inventing UI states:

```text
Understanding request          (agent_runs.status = running, node = classify)
✓ Checking permissions
✓ Analyzing project
✓ Preparing changes
⏸ Waiting for approval          (agent_approval_requests.status = pending)
✓ Applied
```

### Result summary

```text
Completed

✓ Created 6 tasks
✓ Assigned 4 tasks
✓ Updated project timeline
✓ Notified project manager

2 actions require your approval.  ·  Revert (12 changes)
```

Every verb maps to an `agent_run_effects` row, so the summary is generated from
the receipt list rather than from prose.

---

## 10. Autopilot

Autopilot is **permission-aware and per-scope**, and it maps onto the enum that
already exists: `agent_execution_mode = manual | assistive | auto`
(`packages/db/src/schema/agents.ts:33`), plus the existing
`organizations.settings.aiAgents.executionMode`, `aiOversight`
(`auto | review_required`), and `aiSafetyMode` (`off | warn | strict`).

| Mode           | Meaning                                                                                    | Existing home                                           |
| -------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **Assist**     | Recommends. No writes.                                                                     | `manual`                                                |
| **Confirm**    | Prepares and asks. The current default.                                                    | `assistive`                                             |
| **Auto**       | Executes an allowlist of low-risk actions inside a bound.                                  | `auto` + a bound                                        |
| **Autonomous** | Manages approved workflows within explicitly defined boundaries, with budget and deadline. | `auto` + `requireSupervisionForAutoMode=false` + budget |

⚠️ The `auto` mode already exists in the schema and settings UI. What is missing
is the **bound**: what `auto` is permitted to do. 🔵 That is a capability
allowlist per project (`projects.settings.aiAgents.capabilities` already exists
and is already per-kind), extended from run kinds to tool capabilities, and it
must be intersected with the user's permissions at every invocation — a bound is
a ceiling, never a grant.

```text
Project: Website Launch      Autopilot: Auto

May, without asking:
  ✓ issues.create      ✓ issues.update (non-status)
  ✓ issues.comment_create   ✓ issues.transition (allowed edges only)
  ✓ notifications.send (internal)
  ✓ analytics.* read
  ✓ documents.update

Must ask:
  ⚠ issues.assign
  ⚠ any deadline change
  ⚠ issues.delete / projects.update
  ⚠ automation.* mutation
  ⚠ anything external (Slack, email, webhook)
  ⚠ anything crossing a project boundary

Never:
  ⛔ permission, security scheme, API key, SSO/SCIM, org settings
  ⛔ financial
  ⛔ anything requiring ADMIN capability
```

Two non-negotiable properties: a bound is **always intersected with live
permissions** (a member whose `issue:assign` is revoked stops being assignable
mid-run), and every autonomous action still produces a **receipt and an audit
row**.

---

## 11. Control center

An extension of what exists, not a new admin app. Current admin surfaces to
build on: `/api/admin/agent-control` (global enable, allow-writes, max concurrent
runs), `/api/admin/agent-control/local-runners`, `/api/admin/ai-usage`,
`/kill-switch`, `/reset-counters`, and the per-workspace
`organizations-ai-agents.tsx` / `project-ai-agents.tsx` consoles.

| Control             | Where it lives today                                                     | Delta                                                      |
| ------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Global enable       | `system_settings.agent_control_center.globalEnabled`                     | none                                                       |
| Allow writes        | `.allowWriteActions`                                                     | none                                                       |
| Max concurrent runs | `.maxConcurrentRuns`                                                     | none                                                       |
| Per-org kill switch | `org_token_budgets.killSwitchEnabled`                                    | none                                                       |
| Providers / models  | `agent_model_configs` + revisions                                        | centralize resolution (§12)                                |
| Enabled **agents**  | per-workspace `capabilities{}`                                           | 🔵 extend from run kinds to specialists                    |
| Enabled **tools**   | —                                                                        | 🔵 new: a per-workspace capability allowlist, default-deny |
| Approval policies   | `AGENTOWNERS` file + `agent_approval_requests`                           | 🔵 default tier per capability                             |
| Autopilot           | `executionMode` + `aiOversight`                                          | 🔵 add the capability bound                                |
| Budgets / usage     | `org_token_budgets`, `llm_call_audit`                                    | none                                                       |
| Logs                | `agent_runs`, `agent_run_step_events`, `agent_run_effects`, `audit_logs` | 🔵 user-reachable trace (§`AI_AUDIT.md`)                   |
| Memory              | —                                                                        | 🔵 view + forget per user                                  |
| Data access         | —                                                                        | 🔵 show exactly which tables/tools each agent may touch    |
| Integrations        | `agent_providers`, `integration_connections`                             | none                                                       |
| Goals               | —                                                                        | 🔵 list, budget, cancel                                    |

**Default-deny is the posture.** A workspace that installs the control center has
AI disabled until an admin turns it on. Today that is already true
(`feature_flags.isEnabled` defaults `false`; `isAiFeatureEnabled` fails closed on
a DB error and returns a 404-shaped response so the feature's existence is not
disclosed). Preserve that.

### 11.1 A defect the control center must not inherit

`admin/agent-ops-panel.tsx:44–49` renders `globalEnabled: true` and
`allowWriteActions: true` as defaults **while data is loading** — i.e. the safety
panel shows an "allow writes" position before any data arrives. A safety surface
must render an explicit **unknown/loading** state and default to the _inert_
pose. This is a one-file fix with disproportionate trust value.

---

## 12. The smallest set of new things

Everything else in this plan routes through existing infrastructure. These are
the only genuinely new server-side artifacts, each with its justification.

| #   | New artifact                                         | Justification                                                                                         | Phase |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----- |
| 1   | **Tool registry** (`lib/ai/tools/`)                  | No in-product tool layer exists. Cannot be avoided                                                    | 1     |
| 2   | **Conversation threads/messages**                    | Required for continuity, goals, memory, and trust. No substitute exists                               | 1     |
| 3   | **Server-derived agent actor**                       | Closes the self-asserted-actor finding. Not optional                                                  | 1     |
| 4   | **Specialist graphs**                                | Each maps to a declared `agent_run_kind`; new enum values needed for non-project kinds                | 2     |
| 5   | **`agent_run_kind` extension**                       | `goal_step`, plus a small set for proactive checks. Hand-written idempotent migration + journal entry | 2/7   |
| 6   | **`automation_rules` zod schemas + `schemaVersion`** | Unvalidated JSONB is the weakest-typed part of the model; an AI author makes it worse                 | 5     |
| 7   | **`automation_rules.schedule`**                      | No recurrence field exists; "every Friday" is impossible without it                                   | 5     |
| 8   | **`documents.search`-grade unified search endpoint** | The palette already spans issues+docs+people; there is no REST equivalent                             | 1     |
| 9   | **Goal records**                                     | No representation of a multi-day objective                                                            | 7     |
| 10  | **Decision record**                                  | Required to answer "what did we decide"; also a product gap independent of AI                         | 6     |
| 11  | **Document embeddings**                              | `EmbedContentType` widening only — no new table                                                       | 2     |
| 12  | **Reversible effect compensation**                   | Nothing can be reverted today; needs receipts to be sufficient                                        | 3     |
| 13  | **Shared provider-resolution module**                | Three copy-pasted ladders today; centralize rather than add a fourth                                  | 1     |
| 14  | **Unified audit dispatcher adoption**                | `recordAuditLog` has zero importers, so configured SIEM sinks receive nothing                         | 1     |

Everything else — permissions, approvals, workflows, automations' existing
triggers/actions, search, notifications, email, realtime, cost control, feature
gates, disclosure, i18n — is reused as-is.

**Deliberately NOT proposed:** a vector database, a message broker, an agent
framework dependency, Postgres RLS work (valuable but orthogonal — it belongs in
`ROADMAP_2026.md`'s tenant-hardening track, and the AI layer must simply be
written to survive its arrival), a second permission model, a second approvals
table, a new realtime transport, a mobile app.

---

## 13. How the five existing subsystems converge

| Existing                                                    | Becomes                                                                                              | Migration cost                                                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Project-agent graph (`engine.ts`, `project-agent-graph.ts`) | The **Project Agent specialist**, one graph among several                                            | Low — it is already a graph over `agent_runs`                                               |
| Ask (`lib/agents/ask.ts`)                                   | The **Knowledge Agent's** retrieval step, plus the first turn of the global thread                   | Medium — it currently has no thread, and it duplicates provider resolution                  |
| Triage (`triage.ts`, `triage-enqueue.ts`)                   | A **Task Agent capability** invoked as a tool; its durable enqueue is replaced by a real `agent_run` | Medium — the non-idempotent "second row for comparison" intent must be preserved explicitly |
| Standup + janitor                                           | **Automation Agent** presets, plus a `Team Agent` capability                                         | Low                                                                                         |
| MCP server                                                  | The **external** face of the same tool registry, exposed over MCP instead of over the Orchestrator   | Medium — needs the same server-derived actor, and fixes the syntax-only bearer              |

If a subsystem cannot be migrated into the shared substrate, it stays where it
is. **A sixth parallel surface is a worse outcome than an unmigrated one.**

---

## 14. What "done" means for this architecture

- One place to ask ValidTeam anything, from anywhere, with the right context
  already resolved.
- Every consequential AI action is: previewed, authorized against the real
  `ApiActor`, receipted, audited, and revertible when the tool is marked
  `reversible`.
- A user can ask "what did the AI do and why" and get an answer, for themselves
  and for an admin.
- A goal can survive a deploy, hit its budget, get blocked, and report honestly.
- An admin can see exactly which tools, which capabilities, and which data each
  agent may touch, and turn any of it off without a deploy.
- A workspace with AI off is indistinguishable from a workspace without the
  feature.

Phases, dependencies, and sequencing are in
[`AI_IMPLEMENTATION_ROADMAP.md`](AI_IMPLEMENTATION_ROADMAP.md). Current-state
evidence is in [`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md).
