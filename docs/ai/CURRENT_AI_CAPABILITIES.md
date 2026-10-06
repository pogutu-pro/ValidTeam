# Current AI capabilities — audited inventory

**Verified against the working tree:** 2026-10-05 · **Version audited:** 0.17.3
(`package.json`)

This is a **fact document**, not a design document. Every row below was read in
source. Where a claim is inherited from another document rather than from code,
it is marked _inherited_ and must not be treated as verified here.

Design intent lives in [`AI_VISION.md`](AI_VISION.md) and
[`AI_OPERATING_SYSTEM_PLAN.md`](AI_OPERATING_SYSTEM_PLAN.md). The runtime
contract lives in [`../AGENT_RUNTIME.md`](../AGENT_RUNTIME.md) and this document
must never contradict it.

## How to read the status marks

| Mark            | Meaning                                                                              |
| --------------- | ------------------------------------------------------------------------------------ |
| **IMPLEMENTED** | Exists in code, reachable from a route or component, and wired end to end.           |
| **PARTIAL**     | Code exists but is dormant, unwired, single-tenant-blind, or fails closed to a stub. |
| **MISSING**     | No table, route, module, or component exists.                                        |
| **DEFECT**      | Exists and is reachable, but is wrong, unsafe, or contradicts `apps/web/DESIGN.md`.  |

Counts used below (285 `route.ts` files, 120 `pgTable`s, 69 journaled
migrations, 30 locale catalogs, 11 MCP tools) are dated tree measurements. When
a count matters later, re-derive it rather than copying this number.

---

## 1. The headline finding

ValidTeam does **not** have an AI subsystem with a chat missing. It has **five
disconnected AI subsystems and no shared substrate between them**.

| #   | Subsystem                                                 | Entry point                                                                  | Durability                                                            | Writes                                            | Approval                                         | Shared with the others                   |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| 1   | Project-agent graph                                       | `POST /api/projects/[projectId]/agents/run`                                  | Durable (`agent_runs` + leased worker)                                | Yes, but preview-only when approval is required   | Partial — cannot enqueue into the approval queue | Provider ladder, credentials, budget     |
| 2   | Feature agents (Ask, triage, standup, janitor)            | `/api/ask`, `/api/issues/[id]/triage`, `/api/cron/*`                         | None. In-request, except standup which upserts                        | Triage only, one narrow path                      | Triage threshold only                            | Provider ladder, credentials, budget     |
| 3   | Assistant features (draft, assist, estimate, catch-me-up) | `/api/ai/*`, `/api/inbox/catch-me-up`                                        | None. In-request                                                      | None — draft is applied by the browser afterwards | Feature flags + workspace toggle                 | Provider ladder (copy-pasted ×3), budget |
| 4   | External coding agents                                    | `/api/issues/[id]/dispatch-agent` + `/api/webhooks/agent-session/[provider]` | Partial — fingerprint receipts are strong, local subprocesses are not | Yes (comments, workflow transitions)              | Yes                                              | `agent_providers`, credentials           |
| 5   | MCP server                                                | `GET/POST /api/mcp`                                                          | None                                                                  | Yes (6 of 11 tools)                               | Delegated to REST `guardAgentAction`             | REST + API keys                          |

**What does not exist at all:**

- **No LLM conversation surface.** `apps/web/src/lib/chat/**` is LiveKit voice
  plus room messaging, not a language model. There is no thread, no message
  history, no assistant turn, no tool-call log, no stream replay. Naming a
  feature "chat" in ValidTeam means _communications_, not _conversation with AI_.
- **No tool registry and no tool-calling loop.** The project agent is a fixed
  three-node graph (`load_context → plan → execute`,
  `apps/web/src/lib/agents/project-agent-graph.ts`) where the provider returns a
  **structured JSON plan** and `engine.ts` applies a **fixed** set of effect
  types: `'issue_triage' | 'sprint_assign_issue'` (`engine.ts:195`) plus
  `'sprint_create'` (`engine.ts:902`). Nothing in the repo lets a model
  choose a function and have its arguments validated. The only tool-shaped
  surface in the codebase is the **MCP server's 11 hand-written tools**, and
  those are exposed to _external_ MCP clients, not to ValidTeam's own AI.
- **No agent memory.** No table stores a fact, preference, decision, or summary
  that the AI wrote down for later. `agent_runs.checkpoint` is per-run
  execution state, not knowledge.
- **No long-running goal.** `agent_run_kind` has exactly four values
  (`project_tracking`, `backlog_triage`, `sprint_planning`,
  `bulk_sprint_creation` — `packages/db/src/schema/agents.ts:18`). None of them
  outlives its own execution.
- **No proactive monitoring loop.** The closest things are the standup cron
  (per-user digest) and the janitor cron (stale-task cleanup). There is no
  "watch this project and tell me when it goes wrong".

So: **ValidTeam's AI can answer, and in two narrow places it can propose. It
cannot be _told_ something, hold a thread, choose its own action from a governed
catalogue, remember, or keep working after the request ends.**

---

## 2. Current AI surfaces (where a user can reach AI today)

Every entry is a real route or component. Auth column uses the idioms defined in
[`apps/web/CLAUDE.md`](../../apps/web/CLAUDE.md).

| Surface                           | Entry                                                                                            | Kind                                                                  | Writes data?                                                | Approval?                                                         | Mark                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- | --------------------- |
| Global Ask sidecar (`Cmd/Ctrl+J`) | `apps/web/src/components/ai/ai-sidecar.tsx` → `POST /api/ask`                                    | SSE RAG Q&A                                                           | No                                                          | No                                                                | IMPLEMENTED           |
| Issue draft dialog                | `components/ai/ai-draft-issue-dialog.tsx` → `POST /api/ai/draft-issues`                          | Propose structured issues; **browser** applies via `POST /api/issues` | No server-side; the browser's create is a normal user write | `202` from `guardAgentAction` if policy demands                   | IMPLEMENTED           |
| Issue assist panel                | `components/ai/ai-issue-assist-panel.tsx` → `POST /api/ai/issue-assist`                          | `summarize`, `rewrite`, `suggest_next`, `suggest_labels`              | No                                                          | n/a (read-only)                                                   | IMPLEMENTED           |
| Issue triage                      | `components/issues/issue-triage-panel.tsx` → `POST /api/issues/[id]/triage` then `/triage/apply` | Propose + apply priority/labels/assignee                              | **Yes** (apply path)                                        | Confidence threshold `>= autoApplyConfidenceFor(org)`, else `412` | IMPLEMENTED           |
| AI effort estimate                | `components/issues/time-tracking-panel.tsx` → `POST /api/issues/[id]/ai-estimate`                | Nearest-neighbour estimate from `content_embeddings`                  | No (browser PATCHes the field)                              | n/a                                                               | IMPLEMENTED           |
| Delivery insight card             | `components/charts/AiInsightCard.tsx` → `GET /api/analytics/insight`                             | One insight per chart                                                 | No                                                          | No                                                                | IMPLEMENTED           |
| Catch-me-up digest                | `components/dashboard/catch-me-up-banner.tsx` → `GET /api/inbox/catch-me-up`                     | Cross-item digest                                                     | No                                                          | No                                                                | IMPLEMENTED           |
| Standup widget                    | `components/dashboard/standup-widget.tsx` → `/api/users/me/standup/today` and `/preview`         | Daily standup from deterministic events + optional digest             | Yes (`standups` upsert)                                     | No                                                                | IMPLEMENTED           |
| Project agent console             | `components/settings/project-ai-agents.tsx`                                                      | Run / resume / cancel the bounded graph; config + capability matrix   | Yes (project config; run effects)                           | Yes for issue writes; **preview-only** for the graph              | IMPLEMENTED           |
| Workspace agent settings          | `components/settings/organization-ai-agents.tsx`                                                 | Provider, model, BYOK, modes, oversight, safety, limits               | Yes (`organizations.settings.aiAgents`)                     | `org:settings`                                                    | IMPLEMENTED           |
| Agent governance panel            | `components/settings/agent-governance-panel.tsx`                                                 | Policy rules + pending approval queue, approve/reject                 | Yes (decisions)                                             | `canManageAgentApprovals`                                         | IMPLEMENTED           |
| AI transparency                   | `app/[locale]/(app)/settings/ai-transparency`                                                    | Model cards + disclosure acknowledgements                             | Acknowledgement only                                        | Permission only                                                   | IMPLEMENTED           |
| Admin agent control               | `components/admin/agent-ops-panel.tsx` → `/api/admin/agent-control`                              | Global enable, allow-writes, max concurrent runs, live SSE            | Yes (`system_settings`)                                     | `isSuperAdmin`                                                    | IMPLEMENTED           |
| Admin AI usage                    | `/api/admin/ai-usage`, `/kill-switch`, `/reset-counters`                                         | Cost/token reporting, per-org kill switch, counter reset              | Yes (`org_token_budgets`)                                   | `isSuperAdmin` or `CRON_SECRET`                                   | IMPLEMENTED           |
| AI disclosure modal               | `components/ai/ai-disclosure-modal.tsx`                                                          | Forced acknowledgment gate                                            | Yes (`ai_disclosures_acknowledged`)                         | —                                                                 | **DEFECT** (see §7.1) |
| MCP server                        | `GET/POST /api/mcp`                                                                              | 11 tools for **external** MCP clients                                 | Yes (6 of 11)                                               | Delegated to REST                                                 | PARTIAL (preview)     |
| Dispatch a coding agent           | `POST /api/issues/[id]/dispatch-agent`                                                           | Hand an issue to Claude/Codex/Cursor/Devin/Copilot/OpenHands/custom   | Creates `agent_sessions`                                    | Assign-level permission                                           | IMPLEMENTED           |
| Documents                         | `components/docs/document-editor.tsx`                                                            | 13 slash commands, **none AI**                                        | —                                                           | —                                                                 | MISSING               |
| Command palette "Ask" tab         | `components/command/command-palette.tsx`                                                         | Routes into the same sidecar                                          | No                                                          | **Not capability-gated**                                          | DEFECT (see §7.2)     |

### Where AI is _absent_ from the UI

Admin (beyond agent ops), Search results (beyond the Ask tab), Inbox, Roadmap,
Initiatives, Modules, Versions/Components, Templates, Intake forms, Import,
Team page, Analytics (beyond the insight card), Settings (beyond AI tabs), and
mobile navigation (`components/mobile/mobile-nav.tsx` has no AI entry — the only
mobile route to AI is the undiscoverable `Cmd/Ctrl+J`).

---

## 3. Current agents, exhaustively

There are **four** places with anything agent-shaped. Naming them accurately
matters more than adding names.

### 3.1 Project-agent bounded graph — the one real agent loop

| Property            | Value                                                                                                                                                                                                                                                                                                              | Source                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Purpose             | Project tracking, backlog triage, sprint planning, bulk sprint creation                                                                                                                                                                                                                                            | `agent_run_kind` enum, `packages/db/src/schema/agents.ts:18`         |
| Ingress             | `POST /api/projects/[projectId]/agents/run`                                                                                                                                                                                                                                                                        | `apps/web/src/app/api/projects/[projectId]/agents/run/route.ts`      |
| Required auth       | `auth()` **and** `getProjectAgentAccess(...).canManage` (`:62`)                                                                                                                                                                                                                                                    | same                                                                 |
| Required input      | `Idempotency-Key` header, regex `^[A-Za-z0-9._:-]+$`, 1–128 chars (`:70`, `:37`)                                                                                                                                                                                                                                   | same                                                                 |
| Admission gates     | global feature flag → workspace `enabled` → project `enabled` → `capabilities[kind]` → run availability; each returns `409`                                                                                                                                                                                        | `:162–196`                                                           |
| Control plane       | `POST /api/projects/[projectId]/agents/runs/[runId]` `{action:'cancel'\|'resume'}`; `GET .../agents/stream` (SSE)                                                                                                                                                                                                  | `runs/[runId]/route.ts`, `stream/route.ts`                           |
| Graph               | `project-agent-v1`: `load_context → plan → execute`                                                                                                                                                                                                                                                                | `lib/agents/project-agent-graph.ts`                                  |
| Runtime             | `runBoundedGraph` with hard bounds                                                                                                                                                                                                                                                                                 | `lib/agents/graph-runtime.ts:284`                                    |
| **Bounds**          | `maxSteps 6`, `maxVisitsPerNode 2`, `maxRuntimeMs 120000`, `maxConsecutiveNoProgress 2`; absolute deadline 120 s from admission                                                                                                                                                                                    | `lib/agents/project-agent-run-store.ts:30` mirrors `agents.ts:81–84` |
| **Tools available** | **None in the tool-calling sense.** Three fixed effect types: `issue_triage`, `sprint_assign_issue` (`engine.ts:195`), `sprint_create` (`engine.ts:902`). The provider emits a typed plan (`TrackingProviderPlan`, `TriageProviderPlan`, `SprintPlanProviderPlan`, `providers.ts:58–62`); `engine.ts` executes it. |                                                                      |
| Reads               | Issues and sprints in the project; project context                                                                                                                                                                                                                                                                 | `load_context`                                                       |
| Writes              | Issue priority/labels/assignee/sprint; sprint creation; sprint membership                                                                                                                                                                                                                                          | `engine.ts:728, 902, 995`                                            |
| Durability          | **Strong.** `agent_runs` (33 cols) with `checkpoint` jsonb, `checkpointVersion` CAS, `currentNode`, `graphVersion`, monotonic `agent_run_step_events`, transactional receipts in `agent_run_effects` (unique `(runId, effectKey)`), lease + heartbeat + `deadlineAt`, `cancelRequestedAt`                          | migration `0063`, `0061`                                             |
| Human approval      | `resolveAgentExecutionPolicy` **forces `dryRun: true` and zero write effects whenever approval is required** (`lib/agents/execution-policy.ts:18–80`) because the durable approval worker only covers `issues:create`, `issues:update`, `comments:create`                                                          |                                                                      |
| Cancellation        | Yes — API + durable flag; documented as reaching provider calls                                                                                                                                                                                                                                                    |                                                                      |
| Budget              | `runWithBudget` wired                                                                                                                                                                                                                                                                                              | `lib/ai/budget.ts`                                                   |
| Providers           | `native`, `openai`, `anthropic`, `azure`, `custom`                                                                                                                                                                                                                                                                 | `agent_provider` enum                                                |
| Streaming           | SSE of run events, **not** an SSE replay source                                                                                                                                                                                                                                                                    | `AGENT_RUNTIME.md:61–63`                                             |

**Limitation that matters most:** the project agent cannot be _conversationally_
driven. It has no memory between runs, no ability to accept a follow-up, no tool
catalogue, and only four fixed objectives. It is an **automation job with an LLM
in the middle**, not an assistant.

### 3.2 Ask — workspace RAG, no conversation

| Property                     | Value                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ingress                      | `POST /api/ask`, SSE                                                                                                                                                            |
| Auth                         | AI feature gate → `auth()` → `resolveOrganizationAccess`; optional `projectId` must be readable **and belong to that org** (`ask/route.ts:98–110`) — correct tenant containment |
| Rate limit                   | 10 req/min per user, Redis-backed with in-process fallback                                                                                                                      |
| Retrieval                    | Issues + documents, **organization-scoped**                                                                                                                                     |
| Citation grammar             | `[TN-<key>]` / `[DOC-<id>]` with `lib/agents/citation-parser.ts`                                                                                                                |
| pgvector leg                 | Intentionally **dormant** (`STATUS.md:113–114`). Lexical retrieval is the active path                                                                                           |
| Rerank                       | Optional Cohere                                                                                                                                                                 |
| Persistence                  | One `llm_call_audit` row (prompt hash, tokens, cost, latency, status) per call                                                                                                  |
| **Conversation persistence** | **NONE.** No thread id, no history, no server-side state. Reload loses everything                                                                                               |
| Client cancellation          | Server honours `request.signal`; **client never sends one** (`components/ai/ai-sidecar-provider.tsx`)                                                                           |
| Provenance                   | `AiBadge` renders without an `operationId`, so `/api/ai/trace/[id]` is unreachable in production                                                                                |
| Mark                         | IMPLEMENTED as retrieval; **MISSING** as a conversation                                                                                                                         |

### 3.3 Triage — the only narrow AI _write_ path

| Property          | Value                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Propose           | `POST /api/issues/[issueId]/triage` — only `canRead` is required, so **any viewer can trigger a billable model call** (`triage/route.ts`)                                                  |
| Store             | `issue_triage_suggestions` (`confidence` 0–100, `appliedAt`/`dismissedAt` mutually exclusive)                                                                                              |
| Read back         | `GET` returns newest 10, no model call                                                                                                                                                     |
| Deliberate design | Re-running creates a second row so model upgrades can be compared — **non-idempotent by intent**                                                                                           |
| Apply             | `POST /api/issues/[issueId]/triage/apply`, requires `canEditIssues`                                                                                                                        |
| Auto-apply        | `autoApplyConfidenceFor(org)` from `organizations.settings.triage.autoApplyConfidence` (default **90**) — below threshold without `{approved:true}` ⇒ `412`                                |
| Mutation scope    | `priority` always replaceable; `labels` union capped at **16**; `assigneeId` **only when currently unset**, re-validated through `resolveOrganizationAccess(..., {allowSuperAdmin:false})` |
| Policy            | Wrapped in `guardAgentAction({actor:'validteam-ai', ...})` — policy enforced even for a human-triggered apply                                                                              |
| Audit             | `createActivity` + `createAuditLog`, best-effort via `Promise.allSettled`                                                                                                                  |
| Known defect      | `payload.team_id` is persisted but never applied — no such column (`triage/apply/route.ts:270–271`)                                                                                        |
| Deferred write    | `triage-enqueue.ts` uses `setImmediate`/`setTimeout(0)` — **not durable**, lost on restart. The only non-durable seam in the agent runtime                                                 |
| Mark              | IMPLEMENTED, but the confidence gate is a crude proxy for approval and the enqueue is fragile                                                                                              |

### 3.4 Janitor and standup — cron-only, no conversation

- **Janitor** (`lib/agents/janitor.ts` decide → `janitor-runner.ts` apply),
  `POST /api/cron/janitor`. Actions: `ping_assignee`, `snooze`,
  `auto_close_with_label:stale-auto`. Safe default: with no `systemUserId`,
  `dryRun` defaults to **true**; explicit `dryRun:false` without a system user
  returns `412` rather than silently downgrading.
- **Standup** (`lib/agents/standup*.ts`), `POST /api/cron/standup` iterates all
  non-suspended orgs (`LIMIT 500`) then members; per-user try/catch. Upserts
  `standups` (unique on `userId + organizationId + date`). `date` is
  `varchar(10)` deliberately.

Both are genuine automation. Neither is an agent: no intent parsing, no tool
choice, no user conversation.

### 3.5 Dormant AI code (exists, zero callers)

| Module                             | Reality                                                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/agents/research-graph.ts`     | Stages `plan → retrieve → grade_evidence → synthesize → verify_citations → human_review`. **No route or worker calls it.**                                                          |
| `lib/ai/batch.ts` (OpenAI Batch)   | Zero callers. `llm_batch_jobs` has a full schema and **no writers**.                                                                                                                |
| `lib/ai/observability/langfuse.ts` | One production caller: `traceLlmCall` in `lib/ai/draft-issue.ts`. Every other AI path — Ask, triage, the project-agent graph, the assistant features — is untraced. Env vars exist. |
| `lib/ai/safety/redact.ts` (PII)    | Zero callers.                                                                                                                                                                       |
| `lib/command/slash-commands.ts`    | 6 commands dispatch `validteam:slash:*`. **No listeners exist.**                                                                                                                    |
| `POST /api/ai/draft-issue`         | No client consumer.                                                                                                                                                                 |
| `GET /api/ai/feature`              | No client consumer, despite `OBSERVABILITY.md` describing it as an operator path.                                                                                                   |
| `GET /api/ai/trace/[id]`           | Reachable only via `useAiTrace(operationId)`; no caller passes `operationId`.                                                                                                       |
| `content_embeddings` for documents | `EmbedContentType` is `issue` and `comment` only. The wiki is never embedded.                                                                                                       |
| `llm_batch_jobs` workloads         | `embedding_backfill`, `weekly_summary`, `stale_janitor`, `release_notes`, `triage_backfill`, `other` — all unused                                                                   |

---

## 4. Tool inventory — what an AI could call today

**There is no in-product AI tool layer.** The only tool catalogue is the MCP
server's 11 tools, which exist for external clients and each wrap one REST
endpoint.

### 4.1 The MCP tools (real, verified)

| Tool                | Read/Write | REST endpoint it wraps                | Permission it inherits            |
| ------------------- | ---------- | ------------------------------------- | --------------------------------- |
| `search_issues`     | R          | `GET /api/search`                     | `resolveApiActor` → org + project |
| `get_issue`         | R          | `GET /api/issues/[issueId]`           | same                              |
| `list_my_assigned`  | R          | `GET /api/issues/my-issues`           | same                              |
| `get_my_workload`   | R          | `GET /api/metrics/my-workload`        | same                              |
| `list_projects`     | R          | `GET /api/projects`                   | `getPermittedOrganizationIds`     |
| `create_issue`      | W          | `POST /api/issues`                    | + `guardAgentAction`              |
| `update_issue`      | W          | `PATCH /api/issues/[issueId]`         | + `guardAgentAction`              |
| `transition_status` | W          | status field of the above             | + workflow transition service     |
| `assign_issue`      | W          | `PATCH /api/issues/[issueId]`         | + `guardAgentAction`              |
| `add_comment`       | W          | `POST /api/issues/[issueId]/comments` | + `guardAgentAction`              |
| `create_subtask`    | W          | `POST /api/issues` with `parentId`    | + `guardAgentAction`              |

Mutating tools inject `agentPolicy: {actor, source, resource, action, targetType}`
via `withAgentPolicy()` (`packages/mcp-server/src/tools/agent-policy.ts:42`).
Actor defaults to `mcp-agent`, overridable by `VALIDTEAM_AGENT_ACTOR`;
`VALIDTEAM_AGENT_POLICY=off` **strips the marker entirely**.

MCP also exposes 4 resources (`validteam://issue/{id}`, `/project/{id}`,
`/user/me`, `/cycle/current`) and 3 prompts (`triage_inbox`, `standup_summary`,
`sprint_planning`). The two mutating prompts ask for confirmation **in prompt
text only** — a soft control, not enforcement.

### 4.2 Capability surface that exists but is not tool-shaped

A future tool layer should wrap these rather than reimplement them:

| Capability                                                                     | Real endpoint                                                                                       | Note                                                                                                                                                           |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full-text + vector search                                                      | `POST /api/search/hybrid`                                                                           | BM25 ∪ pgvector, RRF k=60 (`lib/search/hybrid.ts`). Filter SQL still reads the **legacy** `issues.labels` JSON array, not the `issue_labels` table from `0054` |
| Docs search                                                                    | `GET /api/docs/search`                                                                              | Separate endpoint; no unified REST equivalent of the palette's 5-tab search                                                                                    |
| Analytics                                                                      | `GET /api/analytics/{burndown,cycle-time,dora,forecast,insight,project-health,throughput,velocity}` | Monte Carlo forecast in `lib/analytics/forecast.ts`                                                                                                            |
| Workload                                                                       | `GET /api/metrics/my-workload`                                                                      |                                                                                                                                                                |
| Automations                                                                    | `GET/POST /api/automation-rules`, `GET/PATCH/DELETE [ruleId]`, `GET [ruleId]/executions`            | 8 triggers, 6 actions, **no schedule field**                                                                                                                   |
| Workflows                                                                      | `GET/POST /api/workflows`, statuses, transitions                                                    | Central transition service exists                                                                                                                              |
| Projects, sprints, versions, components, modules, views, labels, custom fields | `/api/projects/**`, `/api/sprints/**`                                                               |                                                                                                                                                                |
| Documents                                                                      | `/api/docs/pages/**` incl. revisions, restore, share, attachments                                   |                                                                                                                                                                |
| Notifications                                                                  | `POST /api/notifications` behaviour, `notification_preferences`                                     | Delivery is synchronous                                                                                                                                        |
| Webhooks                                                                       | `/api/webhooks/**`, 10 outbound events                                                              | **No retry/backoff scheduler**                                                                                                                                 |
| Intake, import, templates, initiatives                                         | `/api/intake-forms/**`, `/api/import/**`, `/api/templates/**`, `/api/initiatives/**`                |                                                                                                                                                                |

---

## 5. Permission, roles and tenancy — what an AI must inherit

### 5.1 The idiom to copy exactly

```
resolveApiActor(request)                 // lib/auth/api-actor.ts:56 — session OR sk_live_*
  → resolveOrganizationAccess(...)       // active user + active membership + org not suspended
  → resolveProjectCapabilityAccess(...)  // per-project can_* matrix
  → guardAgentAction(...)                // lib/agent-policy/guard.ts — allow | deny | require_approval
```

`resolveApiActor` is the strongest control in the codebase: a supplied-but-
malformed programmatic credential **never falls back to the session**, and an
API-key actor keeps the creator's identity and membership with the key's
organization as an immutable boundary. An AI tool layer must take its identity
from this resolver and must **never** accept an `organizationId`, `projectId`, or
`userId` from the model.

### 5.2 The two coexisting permission systems

1. **Organization permissions** — 51 strings (`packages/db/src/utils/permissions.ts:242–301`),
   6 roles (`owner` 45, `admin` 34, `member` 12, `viewer` 8, `guest` 3, super
   admin 51). Checked with `hasPermission(organizationId, permission)`,
   `getPermittedOrganizationIds()`.
2. **Project permissions** — 49 granular `can_*` booleans denormalized onto
   `project_members` (`packages/db/src/schema/projects.ts:78`, stored as
   `varchar(5)`). 7 project roles (`product_owner` 49/49, `tech_lead` 37,
   `scrum_master` 36, `qa_engineer` 23, `developer` 22, `designer` 21,
   `viewer` 7). Checked with `resolveProjectCapabilityAccess` / `canReadProject`.

Plus a **third, unenforced** system: `permission_schemes*` and
`issue_security_levels` are fully CRUD-managed and wired to routes, but
`issues.securityLevelId` is only ever _assigned_ — no read or write path filters
on it. There is also a legacy string matrix `PROJECT_ROLE_PERMISSIONS`
(`permissions.ts:449`) that overlaps both.

### 5.3 Tenancy

- Workspace ≡ organization. Every tenant-scoped table carries `organization_id`.
- **PostgreSQL RLS is NOT implemented.** No `ROW LEVEL SECURITY`, no
  `CREATE POLICY` anywhere. Isolation is 100% application-level `WHERE` clauses.
  This is the single largest structural risk for an AI that generates queries,
  and it is already documented at `CLAUDE.md:82` and `STATUS.md:58–59`.
- Active-state invariants are centralized in
  `lib/auth/access-control.ts:22–47`.

### 5.4 Approval and policy machinery that exists

`lib/agent-policy/` is a real, tested subsystem:

- `evaluator.ts` — `allow | deny | require_approval`; humans bypass; policy
  validation errors ⇒ require approval; unknown AI actor ⇒ require approval;
  destructive action ⇒ require approval; no policy file ⇒ allow; policy file
  with no matching rule ⇒ **deny**.
- `guard.ts` — `guardAgentAction(...)` writes the decision and returns
  `{allowed, body, httpStatus}`.
- `types.ts` — `AgentApprovalRequestStatus` = `pending|executing|approved|rejected|expired|failed`;
  `AgentApprovalEffectStatus` = `pending|processing|completed|failed`.
- `executors.ts` — only `issues:create`, `issues:update`, `comments:create`
  (plus workflow/automation effects).
- `approval-effects.ts` — `processApprovalEffectOutbox`, leased + retried, **at-least-once**.
- Tables: `agent_approval_requests` (stores an **immutable** `proposedPayload` so
  replay trusts the original action, not a second client body) and
  `agent_approval_effect_outbox` (unique `(approvalId, effectType)`).
- Routes: `GET /api/agent-policy`, `GET /api/agent-approvals`,
  `POST /api/agent-approvals/[id]/approve`,
  `POST /api/agent-approvals/[id]/reject`. Approve **re-evaluates** current
  permission/policy and refuses if the original requester can no longer execute.

**Two structural weaknesses that any AI design must fix first** (detailed in
[`AI_SECURITY.md`](AI_SECURITY.md)):

1. **The guard is opt-in and self-asserted.** It only runs when the request body
   carries an `agentPolicy` marker. A REST caller can omit it. MCP can be
   disabled by env var. The actor string inside the marker is client-supplied.
2. **`agent_approval_requests.status` is a `text` column with a TS `$type<>`
   only** — no DB enum, unlike `agent_runs.status`.

---

## 6. Models, providers and cost

### 6.1 What exists

- Providers: `native | openai | anthropic | azure | custom`
  (`packages/db/src/schema/agents.ts:39`).
- Credentials: encrypted workspace/platform envelope with environment fallback —
  `resolveProviderApiKeyFromSettings(orgSettings, provider, platformStore)`
  (`lib/agents/credentials.ts`). BYOK is a first-class product feature
  (`components/settings/platform-ai-credentials.tsx`).
- Registry: `agent_model_configs` (unique `(organizationId, name)`, `isDefault`,
  `isArchived`) + `agent_model_config_revisions`. CRUD at
  `/api/organizations/[orgId]/ai-model-configs`.
- Settings cascade: `system_settings.agent_control_center` →
  `organizations.settings.aiAgents` → `projects.settings.aiAgents` →
  `resolveEffectiveProjectAgentSettings()`.
- Readiness: `getAgentProviderReadiness(provider, model, credentialStatus)` →
  `{ready, summary, reasonCode}`; `getWorkspaceAgentConfigIssues` yields
  `workspace_disabled`, `project_disabled`, `writes_preview_only`,
  `write_approval_required`.
- Cost: `lib/ai/budget.ts` — `checkAndReserveTokens` (row locks),
  `commitUsage`, `refundReservation`, `runWithBudget`, `BudgetExhaustedError`,
  `estimateCostUsd` from a **static per-model price table** (`budget.ts:98`),
  `hashPrompt` (SHA-256; **prompts are never stored**).
- `llm_call_audit` is append-only, enforced by a **migration-installed trigger**
  rejecting `UPDATE`/`DELETE` — not by application code.
- Prompt caching: Anthropic ephemeral blocks, ≤4 breakpoints
  (`lib/ai/cache-blocks.ts`), plus cache-usage telemetry (`lib/ai/audit-hook.ts`).
  Both are called **only** by `providers.ts`.

### 6.2 Provider resolution is copy-pasted

The three assistant routes (`draft-issue`, `draft-issues`, `issue-assist`) each
reimplement the same ladder: requested provider → workspace default → any
resolvable key → anthropic if present → openai if present → `native`.
There is **no shared provider-abstraction module**; there is no `Provider`
interface, no model registry abstraction, no routing policy engine. `ask.ts`,
`standup.ts`, `triage.ts`, `janitor.ts`, and `providers.ts` each reach for a
provider differently.

`catch-me-up` additionally **never fails closed** — if AI is disabled or there
are zero inputs it silently returns a deterministic native digest with `200`.

### 6.3 Verified defect

`apps/web/src/app/api/organizations/[orgId]/ai-agents/route.ts:49` validates
`credential.provider: z.enum(['openai','anthropic'])`, but the write logic at
`:321` and `:331` only handles `provider === 'openai'`. Posting an Anthropic
credential **validates, writes nothing, and returns 200**. Silent credential loss.

---

## 7. UX-surface defects that the AI operating layer must fix first

These are not aesthetic. They are contract violations against
[`apps/web/DESIGN.md`](../../apps/web/DESIGN.md), and they are prerequisites for
trusting an AI that writes.

### 7.1 Provenance is unreachable

`AiBadge` supports a trace link. `/api/ai/trace/[id]` synthesizes the model from
`run.output` and hardcodes `reviewedBy: null`. **No caller passes an
`operationId`.** Every `llm_call_audit` row is therefore invisible to the user.
`DESIGN.md:332, 375–377` requires attributable AI output. Mark: **DEFECT**.

### 7.2 AI affordances offered where AI is off

The command palette shows an "Ask" CTA for any multi-word input or a trailing
`?`, **not gated by `useAiCapability`** (`components/command/command-palette.tsx:502–508`).
Same for `AiInsightCard` and `CatchMeUpBanner`. The user gets a control that
returns a `412`. `DESIGN.md:101`. Mark: **DEFECT**.

### 7.3 A model confidence score is shown to end users

`components/issues/issue-triage-panel.tsx:141` renders the raw `confidence`.
`DESIGN.md:91`, `:391`, `:484` explicitly ban this; the documented shape is
route + state + evidence + severity. Mark: **DEFECT**.

### 7.4 No revert exists anywhere

Grep for `revert|undo` across `app/` and `components/` returns nothing outside
editor internals. Agent runs can be cancelled, but an applied AI write cannot be
undone from the product. `ROADMAP_2026.md` is tracked in git and is binding; it
distinguishes read / propose / approve / apply / audit / retry / cancel / revert.
Six of those eight states exist. Mark: **DEFECT**.

### 7.5 The disclosure modal is a forced gate

`components/ai/ai-disclosure-modal.tsx` blocks every authenticated route and has
no dismiss path. Mark: **DEFECT**.

### 7.6 Streaming AI cannot be cancelled

The Ask server honours `request.signal` (`ask/route.ts:120`). The client never
creates an `AbortController`, so closing the panel or navigating away leaves the
stream running server-side and still billed. The `Cmd/Ctrl+J` handler also fails
to exclude editable targets despite an inline comment claiming it does, and
`Retry-After` on a `429` is never read. Mark: **DEFECT**.

### 7.7 Raw internals leak into workspace settings

`agent-governance-panel.tsx:265–271` renders
`JSON.stringify(approval.proposedPayload)` in a `<pre>`; approvals are
distinguishable only by raw `actor`, `resource:action`, `targetId`
(`:255–263`); the queue is `status=pending` only (`:79`), so there is **no
decision history and no reason field**. Mark: **DEFECT**.

### 7.8 Design-system debt in AI-adjacent UI

67 raw Tailwind palette utilities across 11 files (including
`command-palette.tsx`, `AiInsightCard.tsx`), bare `transition`
(`command-palette.tsx:276`), `backdrop-blur` glass surfaces, a non-circular
`rounded-full` pill and emoji issue-type icons in
`ai-draft-issue-dialog.tsx`, and a **fake-precision "thought for N seconds"
timer** (`:338–361`) — all contrary to `DESIGN_SYSTEM.md`. The most
user-visible is the thinking timer, which invents a latency measurement the app
does not actually make. Mark: **DEFECT**.

### 7.9 Undeclared scope

The dashboard silently uses `firstProjectId` as the default scope for delivery
analytics and the create-issue modal (`dashboard-client.tsx:339, 350–356`).
`DESIGN.md:251–263, 155` require scope disclosure. Mark: **DEFECT**.

---

## 8. Limitations that actually apply

Each is verified. Nothing here is hypothetical.

### AI can answer but not act

No tool registry, no tool-calling loop, no model-chosen action. The project
agent has three hardcoded effect types; everything else is propose-then-browser-
applies. **There is no path by which a user's sentence causes a governed
database mutation.**

### AI cannot create or modify most things

Of ~400 REST operations, the AI surface can write: issue priority/labels/assignee
via triage apply, issue fields and comments via MCP tools (external clients
only), sprint creation and assignment via the project graph, and the
`draft-issues` → browser-create path. It cannot create projects, sprints
directly, documents, comments from AI, automations, workflows, custom fields,
labels, versions, components, modules, views, intake forms, or initiatives. It
cannot delete anything.

### AI cannot understand organizational context

There is no memory. Each surface starts cold. The project agent re-reads project
issues each run; Ask re-retrieves per query; triage sees one issue; catch-me-up
sees 80 notifications. **Decisions, rationale, constraints, terminology, and
history are invisible to the AI** because nothing writes them down and nothing
reads them back. `issue_activities`, `audit_logs`, `issue_status_history`,
`document_page_revisions`, `chat_messages`, and `initiative_updates` all exist —
and none of them are ever given to a model as a narrative.

### AI cannot execute multi-step workflows in general

The only multi-step execution is the fixed 3-node graph. Ask does one retrieval
plus one synthesis. There is no loop, no re-planning, no mid-run refinement.

### AI cannot monitor or detect problems proactively

Standup and janitor are the only scheduled intelligence, and both are
predefined. There is no project health model that runs continuously, no anomaly
detection, no "this project is drifting" signal. `/api/analytics/project-health`
and `/api/analytics/insight` exist but only render when a human opens a chart.

### AI cannot use documents

`EmbedContentType` is `'issue' | 'comment'`. **The wiki — the richest knowledge
surface in the product, with revisions, spaces, links and shares — is not
embedded and is not in the vector index.** `/api/ask` retrieves documents
lexically, so a document is findable by keyword but not answerable by meaning.
There is no document-writing AI at all.

### AI cannot use integrations

GitHub, GitLab, Jira, Slack, Sentry, mobile OAuth and client credentials all
exist (`lib/integrations/`), including 12 Slack slash commands. **No AI path
reads or triggers any of them.** Slack commands are hand-written per-command
string matching, not AI.

### AI cannot distinguish permissions correctly in all paths

- `POST /api/issues/[id]/triage` requires only `canRead`, so a `viewer` can
  trigger model spend.
- `guardAgentAction` is opt-in and the actor is self-asserted (§5.4).
- The MCP HTTP layer accepts any syntactically valid `sk_live_` string for
  capability discovery (`packages/mcp-server/src/http.ts:9–13`).
- Automation actions `assign`, `add_label`, `add_comment`, `set_priority`
  `UPDATE issues WHERE id = ?` **with no `organizationId` predicate**
  (`lib/automation/evaluator.ts:172–187, 191–227, 235–259, 262–281`). Only
  `set_status` scopes by organization.

### AI cannot request approval through its own plan

The approval queue exists and is correct, but only 3 executors exist. The
project graph **refuses to write** rather than enqueue an approval
(`execution-policy.ts:18–80`). So an agent that wants to change 14 deadlines has
no path to ask; it just previews.

### AI cannot maintain long-running goals

Four run kinds, each a single execution with a 120-second deadline. No goal
object, no persistent objective, no multi-day plan, no re-entry.

### AI cannot recover from failed actions

- Triage enqueue is `setImmediate` — lost on restart.
- Automation and outbound webhook dispatch are `void runAutomations(...)`
  fire-and-forget **inside the request**; a pod crash mid-request loses the run.
- Outbound webhooks have **no retry/backoff** despite persisted
  `webhook_deliveries` rows.
- Notification/email delivery is synchronous in the request path with no queue.
- The standalone LLM paths (Ask, draft, assist, triage, catch-me-up, standup,
  janitor) have **no durable worker and no checkpoint**. Only the project graph
  and the approval outbox do.
- Failures are reported inconsistently: `ai_draft_failed` and `agent_run_failed`
  notifications exist and route to AI settings, but Ask failures surface
  hardcoded English strings (`ask/route.ts:74, 93, 106`) and several routes
  return English text that the UI shows verbatim.

### AI cannot explain what it did

There is no user-visible trace. `/api/ai/trace/[id]` is unreachable (§7.1).
Approval payloads show raw JSON with no diff (§7.7). The command palette even
leaks the internal string `'FEAT-25 omnibar'` (`command-palette.tsx:769`).
`AiBadge` timestamps are formatted manually and locale-unaware.

---

## 9. Infrastructure the AI design must reuse, not rebuild

| Need                 | Reuse this                                                                                                                                         | Do **not** build                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Authorization        | `resolveApiActor`, `resolveOrganizationAccess`, `hasPermission`, `resolveProjectCapabilityAccess`, `canReadProject`, `getPermittedOrganizationIds` | A new permission system or a second role model                             |
| Status changes       | `prepareIssueStatusTransition` / `applyPreparedIssueStatusTransition`                                                                              | A parallel transition path                                                 |
| Policy + approval    | `guardAgentAction`, `agent_approval_requests`, `agent_approval_effect_outbox`, `processApprovalEffectOutbox`                                       | A new approvals table                                                      |
| Durability           | `agent_runs` + `agent_run_step_events` + `agent_run_effects`, `processProjectAgentRunQueue`, leases, `Idempotency-Key`                             | A new queue or worker framework                                            |
| Bounded loops        | `runBoundedGraph`, `validateGraphDefinition`, graph versioning                                                                                     | A new agent framework                                                      |
| Streaming            | `agentEventStream`, `createAgentStreamResponse`, SSE conventions                                                                                   | A new realtime transport                                                   |
| Cost control         | `runWithBudget`, `org_token_budgets`, `llm_call_audit`, kill switch                                                                                | A new metering system                                                      |
| Providers            | `agent_provider` enum, `credentials.ts`, `agent_model_configs`                                                                                     | A new provider abstraction _before_ centralizing the existing three copies |
| Retrieval            | `lib/search/hybrid.ts` (BM25 ∪ pgvector, RRF), `content_embeddings`, `/api/cron/embeddings`                                                        | A new vector store                                                         |
| Notifications        | `notifications`, `notification_preferences`, `lib/notifications/*`                                                                                 | A separate AI notification channel                                         |
| Audit                | `createAuditLog`, `audit_logs`, `audit_log_sinks`, `system_audit_logs`                                                                             | A third audit store                                                        |
| Feature gating       | `isAiFeatureEnabled` (`agent_control_center`), `PRODUCT_FEATURE_FLAGS`                                                                             | A second kill switch                                                       |
| Automation           | `automation_rules`, `lib/automation/evaluator.ts`, `automation_executions`                                                                         | A new rules engine                                                         |
| Realtime             | `publishEvent` + `/api/events/stream` + Redis fan-out                                                                                              | A new push channel                                                         |
| Contract enforcement | `resolveAgentExecutionPolicy` (fail-closed)                                                                                                        | Anything that relaxes it                                                   |
| Localization         | 30 catalogs + `pnpm i18n:check`                                                                                                                    | English fallbacks in AI output                                             |

---

## 10. The three reference implementations to imitate

Three subsystems in this repo already solve the hard parts correctly. An AI
operating layer should be modelled on them.

1. **`/api/webhooks/agent-session/[provider]`** — receipt-as-concurrency-gate
   (unique `(workspaceId, sessionId, fingerprint)`), `SELECT … FOR UPDATE` + state
   CAS, a state machine that marks invalid transitions `dropped` and returns
   `200` so providers stop retrying, DB-only effects in the same transaction as
   the receipt, and a typed skip (`transitionSkipped`) instead of a bypass when
   the actor cannot legally transition. In-source comments explain _why_ at each
   hazard.
2. **`lib/ai/budget.ts`** — reserve / true-up / refund with row locks, lazy period
   rollover, and an immutable append-only audit that stores prompt **hashes**
   rather than prompts.
3. **The admin toggle paths** — `pg_advisory_xact_lock`, transactional upsert,
   dual writes to `audit_logs` _and_ `systemAuditLogs` with IP and user-agent,
   and explicit cache invalidation.

The weakest areas are, by contrast, everything claimed but not wired: Langfuse,
batching, redaction, the research graph, and MCP's publication story.

---

## 11. Security findings that gate any write-capable AI

Ranked. The first two are **prerequisites** for letting a model propose
mutations.

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Severity         | Location                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| 1   | Agent policy is opt-in and self-asserted — omit the body marker and skip evaluation; MCP can disable it by env; the actor string is client-supplied                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **Critical**     | `lib/agent-policy/guard.ts`, `packages/mcp-server/src/tools/agent-policy.ts` |
| 2   | Automation `assign`/`add_label`/`add_comment`/`set_priority` write `issues` with **no `organizationId` predicate**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **Critical**     | `lib/automation/evaluator.ts:172–187, 191–227, 235–259, 262–281`             |
| 3   | No Postgres RLS — a missed `WHERE organization_id = ?` is a cross-tenant breach with no DB backstop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **High**         | documented at `CLAUDE.md:82`, `STATUS.md:58`                                 |
| 4   | `/api/saved-filters` GET returns **another workspace's** public filters and POST inserts into **any** supplied `organizationId` — no membership check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **High**         | `apps/web/src/app/api/saved-filters/route.ts:28–124`                         |
| 5   | `/api/search-history` POST runs `DELETE … WHERE createdAt < 30d AND pinned = false` with **no `userId` predicate** — any authenticated user wipes every other user's history                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **High**         | `apps/web/src/app/api/search-history/route.ts:148–160`                       |
| 6   | Prompt-injection scanning covers **3 of N** AI ingress routes. Ask (RAG over user-authored issues and docs), triage, and the project-agent graph ingest untrusted text with no `evaluateInjectionRisk`                                                                                                                                                                                                                                                                                                                                                                                                                                        | **High**         | `lib/ai/safety/sandbox.ts` wiring                                            |
| 7   | Issue security levels and `permission_scheme_grants` are configurable but never enforced in read/write authorization                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **Medium**       | `packages/db/src/schema/permission-schemes.ts`, `issues.securityLevelId`     |
| 8   | MCP capability discovery answers for any syntactically valid `sk_live_` string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **Medium**       | `packages/mcp-server/src/http.ts:9–13`                                       |
| 9   | `agent_providers.hmacSecret` stored plaintext per workspace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **Medium**       | `packages/db/src/schema/agent-sessions.ts`                                   |
| 10  | `llm_call_audit` immutability depends on a hand-written migration trigger, so schema and DB can diverge silently                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **Medium**       | `ai-cost-guard.ts:16–20`                                                     |
| 11  | _Re-audited and **withdrawn**._ `/api/admin/ai-usage/reset-counters` was initially flagged as "resets every org". On re-reading it is correctly built: super-admin **or** `X-Cron-Secret` (timing-safe compare), an **optional** `organizationId` that scopes correctly, and a `system_audit_logs` row recording `affectedOrganizations`. The all-orgs path is a deliberate documented ops feature. No action                                                                                                                                                                                                                                 | **Not a defect** | `apps/web/src/app/api/admin/ai-usage/reset-counters/route.ts:51–160`         |
| 12  | Two limiters with different backends. `lib/auth/rate-limit.ts` is an **in-memory `Map`** (its own comment: "Swap for Redis/Upstash later") and guards only 4 auth flows — `send-verification`, `reset-password`, `request-access`, `forgot-password`. `lib/server/rate-limit.ts` is **Redis-backed with an in-memory fallback** and is consumed by **`/api/ask` only**, despite its doc comment promising "user-facing AI endpoints (Ask ValidTeam RAG, future /api/ai/_ surfaces)". No limiter on signup, sign-in, SCIM, MCP, `/api/ai/_`, triage, or the agent graph. (Public intake has its own Redis limiter, `lib/intake/rate-limit.ts`) | **Medium**       | `lib/auth/rate-limit.ts:7,14`, `lib/server/rate-limit.ts:1–13`               |
| 13  | CSP allows `unsafe-inline` scripts and styles in production                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **Low**          | `lib/security/headers.ts`                                                    |
| 14  | `lib/env.ts` has **zero production importers** — startup env validation never runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **Low**          | `lib/env.ts`                                                                 |
| 15  | `recordAuditLog` (the sink dispatcher) has no production importers — Splunk/Datadog/S3 sinks receive nothing despite being configurable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Medium**       | `lib/audit/log.ts:15–34`                                                     |

---

## 12. Data-model gaps an AI layer would need (and must justify)

Thirteen tables are declared and never queried. Some are directly relevant.

| Table                                                                                                                                                                    | Relevance                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `semantic_search_history`, `search_suggestions`                                                                                                                          | Never referenced. `semantic_search_history` was clearly intended as retrieval telemetry — useful for AI quality work                                                                                                                                                                                                                                                      |
| `resource-management.ts` — all 6 tables (`user_capacity`, `workload_snapshots`, `issue_estimations`, `team_allocations`, `capacity_forecasts`, `smart_assignment_rules`) | **~500 lines of carefully specified capacity/assignment schema that no code reads.** `smart_assignment_rules` is a 14-column auto-assignment policy engine. This is exactly what a Team Agent needs — and it is dead. Decide: wire or delete, before designing anything new                                                                                               |
| `template_reviews`, `template_categories`                                                                                                                                | Marketplace metadata, dead                                                                                                                                                                                                                                                                                                                                                |
| `permission_scheme_grants`                                                                                                                                               | The _grants_ of the permission-scheme system — schemes are wired, grants are not                                                                                                                                                                                                                                                                                          |
| `system_statistics`                                                                                                                                                      | Admin rollup, dead                                                                                                                                                                                                                                                                                                                                                        |
| `verification_tokens`                                                                                                                                                    | NextAuth table; the app uses its own `email_verification_tokens`                                                                                                                                                                                                                                                                                                          |
| `issue_attachments`                                                                                                                                                      | Duplicate of the live `attachments` table with an incompatible location column (`url` vs `filePath`). **Zero references anywhere outside its own schema definition** — no reader, no writer, not even a seed. (The live route `api/issues/[issueId]/attachments/route.ts` uses the `attachments` table; its local `issueAttachments` variable is a coincidence of naming) |

And genuinely **absent**, with no table anywhere:

| Absent                                     | Why an operating layer needs it                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| AI conversation threads / messages / turns | Without it, "one ValidTeam AI" has no continuity                                              |
| Tool-call records                          | Nothing records which capability was invoked with which arguments and what it returned        |
| Agent plans as first-class rows            | Plans live inside `agent_runs.checkpoint` jsonb — not queryable, not listable, not reviewable |
| Goals                                      | No representation of a multi-day objective                                                    |
| Memory (user / org / project)              | No place to write a fact down                                                                 |
| Decisions                                  | Decisions exist only as prose in comments and documents                                       |
| Document embeddings                        | The wiki is unindexed by meaning                                                              |
| Email / Slack conversation memory          | No store of what was said to whom                                                             |
| Per-API-key rate limits                    | Only org token budgets exist                                                                  |
| Notification delivery attempts             | No record of what was actually sent                                                           |

Per `packages/db/CLAUDE.md`, any new table must arrive as hand-written idempotent
SQL plus a `_journal.json` entry whose `when` is strictly greater than the
previous. Migration `0068` is the only recent file that skipped the
`IF NOT EXISTS` guard convention.

---

## 13. Summary of the gap

| Dimension              | Today                                | The one-line gap                                                  |
| ---------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| AI surfaces            | 5, disconnected                      | No shared substrate; each reimplements provider resolution        |
| Conversation           | Ask only, non-persistent             | No threads, no memory, no continuity                              |
| Tools                  | 11 MCP tools for external clients    | No in-product tool registry, no model-driven tool selection       |
| Permission inheritance | Strong idiom exists                  | Enforcement is opt-in and the actor is self-asserted              |
| Approvals              | Correct queue, 3 executors           | The project graph previews instead of asking                      |
| Durability             | Project graph + approval outbox only | Every other AI path dies with the request                         |
| Memory                 | None                                 | The product's own history is never read as narrative              |
| Proactivity            | 2 cron jobs                          | No monitoring, no goals, no follow-through                        |
| Cost                   | Metered, immutable, kill-switchable  | Static price table; no routing policy                             |
| Trust UX               | Present but non-compliant            | Provenance unreachable, confidence shown, no revert, forced modal |
| Knowledge retrieval    | Issues + comments embedded           | Documents excluded; the wiki is invisible to meaning              |
| Multi-agent            | None                                 | Every surface is hand-rolled                                      |

The next document, [`AI_OPERATING_SYSTEM_PLAN.md`](AI_OPERATING_SYSTEM_PLAN.md),
turns this inventory into a target architecture that changes as little of the
above as possible.
