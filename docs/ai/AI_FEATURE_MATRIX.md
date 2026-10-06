# AI feature matrix — every capability, one row each

**Status:** design, with a verified inventory of what exists today
(`v0.17.3`, [`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md)).

**Purpose:** one place where every AI feature is listed exactly once, with its
current status, its permission tier, its data model, and the phase that delivers
it. Nothing may be designed anywhere else without a row here.

---

## 1. How to read

| Column     | Meaning                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status** | `IMPLEMENTED` · `PARTIAL` (exists but dormant/unwired) · `DEFECT` (reachable but wrong) · `MISSING` (nothing exists)                           |
| **Tier**   | `READ` · `WRITE` · `EXECUTE` · `APPROVE` · `ADMIN`. A capability can never exceed the tier shown ([`AI_PERMISSIONS.md`](AI_PERMISSIONS.md) §2) |
| **Model**  | The real table or resource it reads/writes. 🔵 = new                                                                                           |
| **Phase**  | `0`–`8` per [`AI_IMPLEMENTATION_ROADMAP.md`](AI_IMPLEMENTATION_ROADMAP.md)                                                                     |

**A capability with no permission tier is not designed yet.**

---

## 2. Matrix A — user-facing capabilities

### 2.1 Issues and tasks

| #   | Capability                                          | Entry                                  | Status                        | Tier  | Model                                            | Phase |
| --- | --------------------------------------------------- | -------------------------------------- | ----------------------------- | ----- | ------------------------------------------------ | ----- |
| A1  | Ask anything about the project                      | `/api/ask`, sidecar `Cmd/Ctrl+J`       | IMPLEMENTED                   | READ  | `issues`, `documents`, `content_embeddings`      | 1     |
| A2  | Summarize / rewrite / suggest next / suggest labels | `/api/ai/issue-assist`                 | IMPLEMENTED                   | READ  | —                                                | 0     |
| A3  | Draft issues from natural language                  | `/api/ai/draft-issues`                 | IMPLEMENTED (browser-applied) | WRITE | `issues` (via user POST)                         | 0     |
| A4  | AI triage: priority, labels, assignee               | `/api/issues/[id]/triage` + `/apply`   | IMPLEMENTED                   | WRITE | `issues`, `issue_labels`                         | 0     |
| A5  | Effort estimate from similar issues                 | `/api/issues/[id]/ai-estimate`         | IMPLEMENTED                   | READ  | `content_embeddings`, `issue_estimations`⚠️ dead | 0     |
| A6  | Duplicate detection                                 | `lib/agents/duplicate-detect.ts`       | PARTIAL — no caller           | READ  | `issues`, embeddings                             | 1     |
| A7  | Classification and field extraction                 | `lib/ai/classifier.ts`, `extractor.ts` | PARTIAL — no caller           | READ  | —                                                | 1     |
| A8  | Break a parent issue into subtasks                  | `auto-create-subtasks`                 | MISSING                       | WRITE | `issues.parentId`                                | 4     |
| A9  | Draft a comment or reply                            | MISSING                                | MISSING                       | WRITE | `comments`                                       | 4     |
| A10 | Bulk triage / bulk edit                             | MISSING                                | MISSING                       | WRITE | `issues`                                         | 5     |
| A11 | Revert an AI-originated change                      | —                                      | MISSING                       | WRITE | `agent_run_effects` receipts                     | **0** |

### 2.2 Projects, sprints and planning

| #   | Capability                              | Entry                                      | Status                       | Tier  | Model                                               | Phase                  |
| --- | --------------------------------------- | ------------------------------------------ | ---------------------------- | ----- | --------------------------------------------------- | ---------------------- |
| A12 | Project agent bounded graph             | `/api/projects/[id]/agents/run`            | IMPLEMENTED (3 effect types) | WRITE | `agent_runs`, `issues`, `sprints`                   | 1                      |
| A13 | Backlog triage at project scale         | same, `backlog_triage`                     | IMPLEMENTED                  | WRITE | `issues`, `agent_runs`                              | 1                      |
| A14 | Sprint planning                         | same, `sprint_planning`                    | IMPLEMENTED                  | WRITE | `sprints`, `sprint_issues`                          | 1                      |
| A15 | Bulk sprint creation                    | same, `bulk_sprint_creation`               | IMPLEMENTED                  | WRITE | `sprints`                                           | 1                      |
| A16 | Sprint rollover                         | `/api/cron/cycle-rollover`                 | IMPLEMENTED (deterministic)  | WRITE | `sprints`                                           | —                      |
| A17 | Feature agent / feature triage          | `/api/ai/feature-agent`, `feature-triage`  | IMPLEMENTED (separate modal) | WRITE | `issues`, `versions`                                | 1                      |
| A18 | Roadmap / initiative summary            | MISSING                                    | MISSING                      | READ  | `roadmap_*`, `versions`                             | 6                      |
| A19 | Dependency and blocker analysis         | MISSING                                    | MISSING                      | READ  | `issue_links`                                       | 4                      |
| A20 | Capacity and assignment recommendations | `/api/metrics/my-workload` (deterministic) | PARTIAL — AI layer missing   | READ  | 🔵 `user_capacity`, `smart_assignment_rules`⚠️ dead | 4 (wire) → 6 (surface) |

### 2.3 Documents and knowledge

| #   | Capability                         | Entry                                | Status                                                     | Tier  | Model                         | Phase |
| --- | ---------------------------------- | ------------------------------------ | ---------------------------------------------------------- | ----- | ----------------------------- | ----- |
| A21 | Document drafting                  | `/api/ai/draft-doc`                  | PARTIAL — orphaned route, no client                        | WRITE | `documents`, `document_pages` | 3     |
| A22 | Document update suggestion         | `/api/ai/suggest-update`             | PARTIAL — orphaned                                         | WRITE | `document_pages`              | 3     |
| A23 | Ghost extraction (spec → tasks)    | `/api/ai/extract-ghost`              | PARTIAL — orphaned                                         | READ  | `issues`                      | 3     |
| A24 | Semantic search over documents     | —                                    | MISSING — `EmbedContentType` is `issue` and `comment` only | READ  | 🔵 embed documents            | 3     |
| A25 | Answer with citations              | `/api/ask` returns `citationMarkers` | PARTIAL — markers can be unresolved; no check              | READ  | `documents`, `issues`         | **1** |
| A26 | Slide generation from project data | MISSING                              | MISSING                                                    | WRITE | 🔵                            | 7     |
| A27 | Meeting → actions                  | `/api/chat/*` (LiveKit)              | MISSING — audio exists, extraction does not                | WRITE | `agent_actions`, `issues`     | 7     |
| A28 | AI slash commands in the editor    | 6 declared, **no listeners**         | PARTIAL — `lib/command/slash-commands.ts`                  | WRITE | `document_pages`              | 3     |

### 2.4 Inbox, notifications and communication

| #   | Capability                                | Entry                                                        | Status                          | Tier               | Model                                           | Phase                      |
| --- | ----------------------------------------- | ------------------------------------------------------------ | ------------------------------- | ------------------ | ----------------------------------------------- | -------------------------- |
| A29 | Catch-me-up digest                        | `/api/inbox/catch-me-up`                                     | IMPLEMENTED (deterministic)     | READ               | activity tables                                 | —                          |
| A30 | Standup from events                       | `/api/users/me/standup/today`, `/api/cron/standup`           | IMPLEMENTED                     | READ               | `standups`                                      | 1                          |
| A31 | LLM-written standup narrative             | `/api/ai/standup-agent`, `health-digest`, `cron-risk-digest` | IMPLEMENTED — 3 separate routes | READ               | `org_health_snapshots`, `automation_executions` | 2 (collapse to one digest) |
| A32 | Notification writing an action or mention | `notifications` type enum has no AI item                     | MISSING                         | WRITE              | 🔵 `agent_actions`                              | 4                          |
| A33 | Draft a reply to a Slack thread           | MISSING                                                      | MISSING                         | EXECUTE (external) | `slack_connections`                             | 7                          |
| A34 | External sends of any kind                | MISSING                                                      | MISSING                         | EXECUTE (external) | webhooks, SMTP                                  | 7                          |

### 2.5 Analytics and reporting

| #   | Capability                          | Entry                                               | Status                      | Tier  | Model                     | Phase |
| --- | ----------------------------------- | --------------------------------------------------- | --------------------------- | ----- | ------------------------- | ----- |
| A35 | Chart insight card                  | `/api/analytics/insight`                            | IMPLEMENTED                 | READ  | analytics views           | —     |
| A36 | Project health aggregate            | `/api/analytics/project-health`                     | IMPLEMENTED                 | READ  | `org_health_snapshots`    | 6     |
| A37 | Throughput / velocity / cycle time  | `/api/analytics/*`                                  | IMPLEMENTED (deterministic) | READ  | `issue_status_history`    | 6     |
| A38 | Natural-language analytics question | MISSING — analytics uses 11 `?preset=` enumerations | MISSING                     | READ  | analytics views           | 6     |
| A39 | Anomaly and risk narrative          | MISSING                                             | MISSING                     | READ  | `org_health_snapshots`    | 6     |
| A40 | Weekly / monthly written report     | MISSING                                             | MISSING                     | WRITE | 🔵 `document_pages` draft | 6     |
| A41 | Custom report builder               | MISSING                                             | MISSING                     | READ  | 🔵                        | 8     |

### 2.6 External and integration surfaces

| #   | Capability                         | Entry                                    | Status                    | Tier               | Model                                  | Phase                          |
| --- | ---------------------------------- | ---------------------------------------- | ------------------------- | ------------------ | -------------------------------------- | ------------------------------ |
| A42 | Dispatch an external coding agent  | `/api/issues/[id]/dispatch-agent`        | IMPLEMENTED (6 providers) | EXECUTE (external) | `agent_sessions`, `agent_fingerprints` | keep                           |
| A43 | Receive an external agent's result | `/api/webhooks/agent-session/[provider]` | IMPLEMENTED               | WRITE              | `agent_sessions`, `comments`, `issues` | keep                           |
| A44 | MCP server for external clients    | `GET/POST /api/mcp`                      | IMPLEMENTED (11 tools)    | mixed              | API keys                               | 2 (widen under the tool layer) |
| A45 | In-product MCP client              | MISSING                                  | MISSING                   | READ               | 🔵                                     | 7                              |
| A46 | AI over Jira / GitHub content      | MISSING (data enters only as activity)   | MISSING                   | READ               | `jira_connections`                     | 7                              |

### 2.7 Administration and governance

| #   | Capability                                 | Entry                                         | Status                                                       | Tier    | Model                                       | Phase          |
| --- | ------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------ | ------- | ------------------------------------------- | -------------- |
| A47 | Global enable / allow-writes / concurrency | `/api/admin/agent-control`                    | IMPLEMENTED                                                  | ADMIN   | `system_settings`                           | 0              |
| A48 | Per-org kill switch                        | `/api/admin/ai-usage/kill-switch`             | IMPLEMENTED                                                  | ADMIN   | `org_token_budgets`                         | 0              |
| A49 | Token and cost reporting                   | `/api/admin/ai-usage`                         | IMPLEMENTED                                                  | ADMIN   | `llm_usage_stats`, `org_token_budgets`      | 0              |
| A50 | Per-org or global counter reset            | that route                                    | IMPLEMENTED — withdrawn defect; correctly scoped and audited | ADMIN   | `org_token_budgets`                         | keep           |
| A51 | Policy rules and approval queue            | `/api/agent-policies`, `/api/agent-approvals` | PARTIAL — client-asserted policy                             | WRITE   | `agent_policies`, `agent_approval_requests` | **0**          |
| A52 | AI transparency page                       | `settings/ai-transparency`                    | IMPLEMENTED (thin)                                           | READ    | `ai_disclosures_acknowledged`               | 2 (extend)     |
| A53 | AI usage analytics per workspace           | `/api/ai/usage`                               | IMPLEMENTED                                                  | READ    | `llm_usage_stats`                           | 0              |
| A54 | Approval inbox as a first-class surface    | notifications tab only                        | PARTIAL                                                      | APPROVE | `agent_approval_requests`                   | **0**          |
| A55 | Audit log as an AI surface                 | `settings/audit-log`                          | IMPLEMENTED (general)                                        | READ    | `audit_logs`                                | 2 (AI filters) |

### 2.8 Platform substrate

| #   | Capability                                | Status                                                                                        | Tier | Notes                                                                       |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------- |
| A56 | Bounded graph runtime                     | IMPLEMENTED — `runBoundedGraph`, leases, checkpoints, SSE, heartbeat                          | —    | The runtime to build on. `AGENT_RUNTIME.md` is binding                      |
| A57 | Provider ladder with 14 model roles       | IMPLEMENTED — copy-pasted in 3+ places                                                        | —    | 🔵 Extract one resolver ([`AI_MODEL_STRATEGY.md`](AI_MODEL_STRATEGY.md) §2) |
| A58 | BYOK per workspace                        | IMPLEMENTED — `agent_providers`                                                               | —    | ⚠️ `hmacSecret` stored plaintext                                            |
| A59 | Token budget enforcement                  | IMPLEMENTED — `runWithBudget`, `org_token_budgets`                                            | —    | Not wrapped around the project graph                                        |
| A60 | Daily admission and budget reset          | IMPLEMENTED — UTC 00:00, serialized                                                           | —    | Keep                                                                        |
| A61 | Prompt-injection sandbox                  | IMPLEMENTED — wired to **3 of N** routes                                                      | —    | 🔵 Wire everywhere ([`AI_SECURITY.md`](AI_SECURITY.md) §3)                  |
| A62 | PII redaction                             | PARTIAL — zero callers                                                                        | —    | 🔵 Adopt                                                                    |
| A63 | LLM call audit                            | IMPLEMENTED — `llm_call_audit` + hash-only prompts                                            | —    | ⚠️ Immutability trigger is hand-written in a migration                      |
| A64 | Audit sink dispatch                       | PARTIAL — `recordAuditLog` has zero production importers                                      | —    | 🔵 Adopt                                                                    |
| A65 | Langfuse tracing                          | PARTIAL — one caller (`lib/ai/draft-issue.ts`); Ask, triage, and the agent graph are untraced | —    | 🔵 Trace every AI path                                                      |
| A66 | OpenAI Batch processing                   | PARTIAL — `llm_batch_jobs` schema, zero writers                                               | —    | 🔵 Adopt for embeddings only                                                |
| A67 | Research graph with citation verification | PARTIAL — `lib/agents/research-graph.ts`, **no caller**                                       | —    | 🔵 Wire into A25                                                            |
| A68 | AI rate limiting                          | PARTIAL — Ask only, 10/min                                                                    | —    | 🔵 Every AI route, Redis-first                                              |
| A69 | Postgres RLS                              | MISSING                                                                                       | —    | Tenant-hardening track                                                      |
| A70 | Streaming AI                              | IMPLEMENTED but **not cancellable**                                                           | —    | 🔵 Add cancellation                                                         |

---

## 3. Matrix B — internal specialists

Specialists are **internal routing targets**. The user never chooses one
([`AI_UX_SIMPLIFICATION.md`](AI_UX_SIMPLIFICATION.md) §3.3).

| Specialist           | Owns                                                                                         | Real today?                                               | Phase |
| -------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----- |
| **Task Agent**       | A single issue's lifecycle: classify, extract, draft, comment, subtask, transition, escalate | PARTIAL — the 6 issue capabilities exist, no orchestrator | 4     |
| **Project Agent**    | The project: plan, sprint, backlog, dependencies, health                                     | IMPLEMENTED as a fixed 3-node graph                       | 1 → 4 |
| **Planning Agent**   | Features, versions, initiatives, roadmap                                                     | PARTIAL — `feature-agent`                                 | 6     |
| **Estimation Agent** | Estimates                                                                                    | IMPLEMENTED — nearest-neighbour                           | 0     |
| **Knowledge Agent**  | Documents, semantic search, cited answers                                                    | PARTIAL — Ask is RAG over issues + sparse documents       | 3     |
| **Monitoring Agent** | Digests, anomalies, risk, daily/weekly reports                                               | IMPLEMENTED as 3 separate routes                          | 2 → 6 |
| **Automation Agent** | Rules from natural language                                                                  | MISSING                                                   | 5     |
| **Code Agent**       | External coding agents; in-product coding                                                    | IMPLEMENTED (dispatch only)                               | 7     |
| **Control Center**   | Config, policy, approvals, cost, kill switch                                                 | PARTIAL — 6 separate settings screens                     | 2     |

🔵 All specialists must satisfy the same contract: bounded steps, tool-only side
effects, receipt per mutation, rationale, and a hard deadline.

---

## 4. Matrix C — the tool catalogue

A capability is only real if it is **tool-shaped**. This is the actual surface an
in-product model may call.

### 4.1 Read tools (READ) — mostly available now via MCP

| Tool                                  | Backing route                       | Phase |
| ------------------------------------- | ----------------------------------- | ----- |
| `search_issues`                       | `GET /api/search`                   | now   |
| `get_issue`                           | `GET /api/issues/[id]`              | now   |
| `list_my_assigned`                    | `GET /api/issues/my-issues`         | now   |
| `get_my_workload`                     | `GET /api/metrics/my-workload`      | now   |
| `list_projects`                       | `GET /api/projects`                 | now   |
| `get_document`, `search_documents`    | 🔵 `/api/docs/*`                    | 3     |
| `get_project_health`                  | `GET /api/analytics/project-health` | 6     |
| `get_sprint`, `list_issues_in_sprint` | `/api/sprints/*`                    | 4     |
| `get_blocked_by`                      | `/api/issues/[id]/links`            | 4     |
| `get_time_in_status`                  | `/api/issues/[id]/time-in-status`   | 4     |
| `list_automation_rules`               | 🔵 needed                           | 5     |
| `get_workflow_transitions`            | `/api/issue-workflows`              | 4     |

### 4.2 Write tools (WRITE) — require a resolved actor + receipt

| Tool                                          | Backing route                                          | Approval executor exists? | Phase              |
| --------------------------------------------- | ------------------------------------------------------ | ------------------------- | ------------------ |
| `create_issue`                                | `POST /api/issues`                                     | ✅ `issues:create`        | now                |
| `update_issue`                                | `PATCH /api/issues/[id]`                               | ✅ `issues:update`        | now                |
| `transition_status`                           | via the update, through `prepareIssueStatusTransition` | ✅                        | now                |
| `assign_issue`                                | `PATCH /api/issues/[id]`                               | ✅                        | now                |
| `add_comment`                                 | `POST /api/issues/[id]/comments`                       | ✅ `comments:create`      | now                |
| `create_subtask`                              | `POST /api/issues` with `parentId`                     | ✅ via `issues:create`    | now                |
| `add_label` / `remove_label`                  | 🔵 needed                                              | 🔵                        | 4                  |
| `set_due_date`                                | 🔵 needed                                              | 🔵                        | 4 — always APPROVE |
| `create_sprint` / `move_issues_to_sprint`     | 🔵 needed                                              | 🔵                        | 4                  |
| `update_document`                             | 🔵 needed                                              | 🔵                        | 3                  |
| `create_rule` / `update_rule` / `delete_rule` | 🔵 needed                                              | 🔵                        | 5                  |

### 4.3 Execute, approve and admin — bounded by construction

| Tool                              | Availability         | Rule                                                           |
| --------------------------------- | -------------------- | -------------------------------------------------------------- |
| `execute_effect`                  | 3 effect types today | 🔵 Extend deliberately                                         |
| `dispatch_external_agent`         | EXISTS               | 🔵 Never autonomous                                            |
| `send_external_message`           | 🔵                   | **APPROVE, no override, no autonomy**                          |
| Any approval tool                 | ⛔                   | **Never in the catalogue.** The AI cannot approve anything     |
| Any credential or permission tool | ⛔                   | **Never in the catalogue.** ADMIN is unreachable from a prompt |

⚠️ A capability without an approval executor must be marked explicitly
non-approvable. Silence is how dangerous tools slip in.

---

## 5. Matrix D — goals, memory and autonomy

| #   | Capability                              | Status                                        | Model                                           | Phase |
| --- | --------------------------------------- | --------------------------------------------- | ----------------------------------------------- | ----- |
| D1  | Long-running goal                       | MISSING                                       | 🔵 `agent_goals`                                | 7     |
| D2  | Goal step list and progress             | MISSING                                       | 🔵 `agent_goal_steps`                           | 7     |
| D3  | Goal monitoring evaluation              | MISSING                                       | 🔵 reuse `agent_runs`                           | 7     |
| D4  | Preference memory                       | MISSING                                       | 🔵 `agent_memories`                             | 3     |
| D5  | Decision memory                         | MISSING                                       | 🔵 `agent_memories` (kind)                      | 3     |
| D6  | Visible/editable memory UI              | MISSING                                       | 🔵 `settings/ai-transparency`                   | 3     |
| D7  | Scheduled workflow                      | MISSING                                       | 🔵 `automation_rules.schedule_due_at`           | 5     |
| D8  | Recurrence expression (cron + tz)       | MISSING                                       | 🔵                                              | 5     |
| D9  | Rule circuit breaker                    | MISSING                                       | 🔵 `execution_cap`, `consecutive_failure_count` | 5     |
| D10 | Rule schema validation                  | MISSING                                       | 🔵 zod + `schema_version`                       | 5     |
| D11 | "Becomes overdue"-style derived trigger | MISSING                                       | 🔵 scheduled scan                               | 5     |
| D12 | Autopilot within a bound                | MISSING                                       | 🔵 `organizations.settings.autopilot`           | 8     |
| D13 | Capability allowlist (default-deny)     | MISSING                                       | 🔵                                              | 8     |
| D14 | Thread / conversation persistence       | MISSING                                       | 🔵 `agent_threads`, `agent_messages`            | 2     |
| D15 | Receipt / revert store                  | PARTIAL — `agent_run_effects` lacks pre-state | 🔵 add `payload_pre`                            | 0     |
| D16 | Evaluation set and quality regression   | MISSING                                       | 🔵                                              | 4     |

---

## 6. Matrix E — dormant assets: wire or delete

⚠️ Each of these exists, is well-specified, and has no caller. Deciding is part
of the work: **an unused table is a maintenance liability that looks like
capability.**

| Asset                                                                                                                                                    | Size                                             | Verdict                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `research-graph.ts` (`plan → retrieve → grade_evidence → synthesize → verify_citations → human_review`)                                                  | one module                                       | 🔵 **Wire** into the Knowledge Agent — it is exactly the citation guarantee A25 needs                                                       |
| `content_embeddings` for documents                                                                                                                       | `EmbedContentType` is `issue` and `comment` only | 🔵 **Extend** to `'document'`                                                                                                               |
| `llm_batch_jobs` (6 declared workloads, zero writers)                                                                                                    | table + `lib/ai/batch.ts`                        | 🔵 **Use for `embedding_backfill` only**; delete the other 5 declared workloads                                                             |
| `resource-management.ts`: `user_capacity`, `workload_snapshots`, `issue_estimations`, `team_allocations`, `capacity_forecasts`, `smart_assignment_rules` | ~500 lines                                       | 🔵 **Wire** — this is the Team Agent's assignment engine, already specified, entirely dead. Or delete. Do not design a new one alongside it |
| `semantic_search_history`                                                                                                                                | table                                            | 🔵 **Use** for retrieval telemetry                                                                                                          |
| `redact.ts` (PII)                                                                                                                                        | module                                           | 🔵 **Adopt**                                                                                                                                |
| `langfuse.ts`                                                                                                                                            | module                                           | 🔵 **Widen** — one caller today (`draft-issue.ts`); extend to every AI path                                                                 |
| `recordAuditLog`                                                                                                                                         | module                                           | 🔵 **Adopt**                                                                                                                                |
| `slash-commands.ts` (6 commands, no listeners)                                                                                                           | module                                           | 🔵 **Wire** to the Document Agent                                                                                                           |
| `/api/ai/draft-issue`, `/api/ai/feature`, `/api/ai/trace/[id]`                                                                                           | routes                                           | 🔵 **Consolidate** into the AI surface; the trace route needs `operationId` plumbing                                                        |
| `permission_scheme_grants`                                                                                                                               | table                                            | 🛑 **Decide** — enforce or delete. Unenforced permissions are worse than absent                                                             |
| `issue_security_levels` (configurable, never enforced)                                                                                                   | column + table                                   | 🛑 **Decide** — enforce or delete. Users already trust it                                                                                   |
| `verification_tokens` (NextAuth)                                                                                                                         | table                                            | 🛑 **Delete** — the app uses `email_verification_tokens`                                                                                    |
| `issue_attachments` (incompatible duplicate of `attachments`)                                                                                            | table                                            | 🛑 **Delete**                                                                                                                               |
| `template_reviews`, `template_categories`, `system_statistics`                                                                                           | tables                                           | 🛑 **Delete**                                                                                                                               |

---

## 7. Matrix F — gaps that block the thesis

| Gap                                    | Blocks                                              | Phase |
| -------------------------------------- | --------------------------------------------------- | ----- |
| No persistent thread                   | "Tell the AI something and have it hold the thread" | 2     |
| No in-product tool loop                | Any real capability beyond 3 effect types           | 1     |
| No memory                              | "Remember that we always deploy on Thursdays"       | 3     |
| No goals                               | "Get this ready for launch by Friday"               | 7     |
| No schedule field                      | Every recurring automation                          | 5     |
| No revert                              | Trust. Full stop                                    | **0** |
| No structured preview                  | Trust. Full stop                                    | **0** |
| Server-derived AI actor absent         | 🔴 **A security hole**                              | **0** |
| Automation writes unscoped by org      | 🔴 **A security hole**                              | **0** |
| Injection sandbox not wired everywhere | 🔴 **A security hole**                              | **0** |
| AI affordances shown when AI is off    | Credibility                                         | 1     |
| Model confidence shown to users        | Credibility                                         | 3     |
| No cancel on streaming AI              | Basic respect for the user                          | 1     |
| One surface, or seven                  | Learnability                                        | 1     |

---

## 8. Matrix G — deliberately not building

Banning these is part of the design.

| Not building                                           | Why                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| A fine-tuned model                                     | Data leaves the platform; unmeasurable benefit. State publicly that we do not |
| Model personality / avatar                             | Over-trust                                                                    |
| Confidence percentages                                 | Unfalsifiable                                                                 |
| Autonomous external communication                      | Reputation                                                                    |
| AI approving anything                                  | Circular authority                                                            |
| A separate microservice                                | The runtime exists                                                            |
| A new permission system                                | Extend `agent_policies`                                                       |
| A second chat surface                                  | One AI                                                                        |
| Per-user "skip approval" preference                    | Would defeat the model                                                        |
| The AI managing permissions, roles, or security levels | ⛔ ADMIN unreachable                                                          |
| Hidden memory                                          | Not memory                                                                    |
| Building a new capacity/assignment schema              | `smart_assignment_rules` already exists                                       |
| Building a new search engine                           | `/api/search` + pgvector + embeddings exist                                   |
| Building a new scheduler                               | The leased worker and cron routes exist                                       |

---

## 9. Coverage summary

| Status                              | Rows in Matrix A (§2, `A1`–`A70`)                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IMPLEMENTED                         | 35                                                                                                                                                                                   |
| PARTIAL (dormant, unwired, or thin) | 16                                                                                                                                                                                   |
| MISSING                             | 19                                                                                                                                                                                   |
| DEFECT                              | 0 in this matrix — the UI defects are catalogued in [`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md) §7 and the security findings in [`AI_SECURITY.md`](AI_SECURITY.md) §2 |

One earlier finding in this matrix was **withdrawn on re-audit**: `A50`
(`/reset-counters`) was flagged as an unscoped reset and is in fact correctly
scoped and audited. Where a claim here looks like a defect, verify it in source
before acting on it.

Beyond Matrix A: **9** internal specialists (§3), **26** tool-catalogue rows (§4),
**16** goals/memory/autonomy rows (§5), **15** dormant-asset decisions (§6),
**14** thesis-blocking gaps (§7), **14** deliberate exclusions (§8).

**The single most important line in this document:** 24 capabilities already exist
in this codebase and are unused. The programme's first job is **activation, not
invention** — the audit in [`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md)
concluded that ValidTeam's AI can answer, and in two narrow places propose. The
gap is a shared substrate and a trust surface, not a shortage of features.

Related: [`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md) ·
[`AI_OPERATING_SYSTEM_PLAN.md`](AI_OPERATING_SYSTEM_PLAN.md) ·
[`AI_IMPLEMENTATION_ROADMAP.md`](AI_IMPLEMENTATION_ROADMAP.md)
