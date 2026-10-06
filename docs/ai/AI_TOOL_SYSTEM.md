# AI tool system

**Status:** design.

A tool is a **typed, authorized, audited function** the AI can call instead of
writing SQL, calling a provider, or guessing at business rules.

Spec §26 is the requirement. This document is the design that satisfies it.

---

## 0. The pattern already exists

ValidTeam already contains the correct tool architecture — it is just not
called one. The MCP server is a tool registry:

```ts
// packages/mcp-server/src/tools/types.ts
export interface ToolDefinition<Input extends ZodTypeAny = ZodTypeAny> {
  name: string; // unique, stable
  description: string; // one line, shown to the model
  inputSchema: Input; // zod
  handler: (input, ctx) => Promise<unknown>;
}

// packages/mcp-server/src/tools/create-issue.ts
export const createIssueTool = {
  name: 'create_issue',
  description: 'Create a new issue in a ValidTeam project.',
  inputSchema: createIssueInput,
  handler: (input, { client }) => client.post('/api/issues', withAgentPolicy(input)),
};
```

| Property                  | Verdict                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Typed input               | ✅ zod at the boundary                                                                                     |
| Thin over existing routes | ✅ `client.post('/api/issues')` — no business logic duplicated                                             |
| Policy attached           | ✅ `withAgentPolicy(input)`                                                                                |
| **Authorization**         | ✅ **not duplicated** — the REST route authorizes; the tool cannot bypass it because it _is_ the REST call |
| Audited                   | ✅ via the route's `recordAuditLog`                                                                        |

**Decision: the internal AI tool registry reuses this shape and these 11 tools.
** It is not a new architecture, and it is not a parallel catalogue.

⚠️ One honest caveat: because MCP tools proxy to REST, they inherit the route's
authorization — which is the point — but they also inherit its bugs. The
unscoped automation writes ([`AI_CURRENT_STATE.md`](AI_CURRENT_STATE.md) §7) must
be fixed **before** a write-capable AI points at them, not after.

---

## 1. Two registries, one definition

| Registry   | Purpose                                                        | Caller                                |
| ---------- | -------------------------------------------------------------- | ------------------------------------- |
| `mcpTools` | ValidTeam's capabilities exposed to **external** coding agents | Claude Desktop, Cursor, etc. over MCP |
| `aiTools`  | The same capabilities exposed to **ValidTeam's own agents**    | the orchestrator's tool router        |

Both consume one `ToolDefinition` set. The differences are three fields:

| Field                  | External MCP                                    | Internal AI                                 |
| ---------------------- | ----------------------------------------------- | ------------------------------------------- |
| `riskLevel`            | required                                        | required                                    |
| `approvalRequired`     | required                                        | required                                    |
| `requiresHumanSession` | always `true` (MCP carries a delegated API key) | `true` for tier ≥ 2 unless a goal is active |

⛔ **A tool must never exist in one registry and be hidden from the other
arbitrarily.** If it is unsafe for internal AI, that is a defect in the tool.

---

## 2. The full tool contract

The MCP `ToolDefinition` is the minimum. The AI registry adds the fields that
make a tool governable.

```ts
export interface AiToolDefinition<I extends ZodTypeAny = ZodTypeAny> extends ToolDefinition<I> {
  // identity
  capability: CapabilityKey; // links to AI_FEATURE_MATRIX.md
  category: 'read' | 'write' | 'external' | 'admin';

  // safety
  riskLevel: 0 | 1 | 2 | 3 | 4; // AI_PERMISSIONS.md §4
  approvalRequired: boolean; // default derived from riskLevel
  maxTier: 1 | 2 | 3 | 4; // highest autopilot tier that may run it

  // data
  outputSchema: ZodTypeAny; // 🔵 required — the current one is optional
  tenantScoped: 'organization' | 'project' | 'none';
  returnsRecords: boolean; // false ⇒ never enter the prompt verbatim

  // execution
  idempotency: { keyFrom: string[]; windowSec: number } | null;
  compensable: boolean; // can payload_pre undo it?
  transactional: boolean; // 🔵 true ⇒ one tool call = one tx

  // governance
  auditEvent: string; // e.g. 'ai.tool.invoked'
  enabledByDefault: boolean; // global kill switch in agent_settings
  costHint?: { tokens?: number; ms?: number };
}
```

| Field                 | Why it exists                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `capability`          | One key that ties the tool to the matrix, to permissions, and to the UI                                                           |
| `outputSchema`        | Without it, a tool can return anything into the prompt. This is the **injection surface** ([`AI_SECURITY.md`](AI_SECURITY.md) §4) |
| `tenantScoped`        | A tool that is not org-scoped must be provably safe (aggregates, health)                                                          |
| `returnsRecords`      | Enables the redaction pipeline for `returnsRecords: true` tools                                                                   |
| `idempotency.keyFrom` | Lets the runner collapse retries into one effect                                                                                  |
| `compensable`         | Drives whether "Revert" appears on the receipt                                                                                    |
| `maxTier`             | The autopilot ceiling — separate from the approval gate                                                                           |
| `enabledByDefault`    | A global off switch per tool, no redeploy                                                                                         |

---

## 3. Execution flow

```text
model emits a tool call
   ↓
1. name exists?                      → unknown ⇒ reject, never guess
2. input parses (zod)                → invalid ⇒ reject with the schema
3. agent allowed this tool?          → per-agent allowlist (AI_AGENT_SYSTEM.md)
4. tier allows this riskLevel?       → tier ceiling + maxTier
5. actor + organization + project    → server-side, never from the model
6. hasPermission + capability access → 403 with the reason
7. approval required?                → suspend; persist effect; stop the run
8. execute (one transaction)         → audit in the same transaction
9. validate against outputSchema     → invalid ⇒ treat as a failure
10. redact / truncate / summarize    → before it reaches the prompt
11. record agent_run_tool_calls      → tokens, ms, outcome, effect key
12. return to the model
```

### 3.1 Rules that are not negotiable

| Rule                                                                | Consequence of breaking it                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Steps 5–6 run **before** execution and **again** inside the route   | The AI's view of authority can go stale mid-run (a role change, a removed member) |
| The model **never** supplies `organizationId`, `userId`, or `actor` | Cross-tenant access                                                               |
| Unknown tool name ⇒ hard failure                                    | Silent substitution is how a prompt injection becomes an action                   |
| Output is redacted and truncated **before** the model sees it       | Untrusted content must not be able to instruct the model                          |
| Every invocation is audited, including reads                        | Read patterns are how exfiltration looks                                          |
| A 403 is reported to the user with the reason, not swallowed        | A hidden denial becomes a silent capability gap                                   |

---

## 4. Tiering

Spec §29 defines five levels. What "approval" means mechanically:

| Level                      | Example                                                                               | Approval                                  | Autopilot |
| -------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- | --------- |
| **0 READ**                 | `search_issues`, `get_issue`, `list_my_workload`, `get_project_health`                | none                                      | T0–T4     |
| **1 LOW-RISK WRITE**       | `create_comment`, `add_label`, `update_due_date`                                      | none by default, 🔵 per-workspace switch  | T0–T2     |
| **2 ORGANIZATIONAL WRITE** | `create_issue`, `update_issue`, `assign_issue`, `create_subtask`, `transition_status` | 🔵 **required** (3 executors exist today) | T0–T1     |
| **3 EXTERNAL ACTION**      | `send_email`, `post_slack`, `sync_jira_issue`, `dispatch_agent`                       | **required**, no override                 | T0 only   |
| **4 HIGH-RISK**            | `delete_issue`, `transfer_ownership`, `bulk_import`, `modify_workflow`                | **required** + 🔵 second approver         | ⛔ never  |

| Rule                                                           | Reason                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| Tier is **derived from the capability**, not set per call      | A model-chosen tier is not a control                            |
| Raising a tier requires a code change + an audit event         | Prevents silent drift                                           |
| 🔵 Bulk variants inherit the **highest** tier of their members | `bulk_update_issues` is never level 1 because `update_issue` is |
| Tier 3 has **no Autopilot override** by design                 | An agent that can email customers unattended is a liability     |
| Tier 4 always leaves a receipt and always notifies             | Destructive changes must be findable                            |

⚠️ **Current state:** only `issues:create`, `issues:update`, and `comments:create`
have approval executors. Tier 2 is therefore _partially_ enforced today —
`transition_status` and `assign_issue` currently run without approval because
the write path routes through the REST API and the existing
`/agents/run` preview only applies to declared effect types. Phase 2 closes
this. [`AI_APPROVALS.md`](AI_APPROVALS.md) has the executor list.

---

## 5. What the model sees

```ts
// in the tool-routing prompt
Available tools (10 of 23 shown — 13 filtered by your role):

  search_issues        READ   Find issues by text, label, status, assignee
  get_issue            READ   One issue with comments and activity
  update_issue         WRITE  Change title, description, type, priority, due date
                       ⚠ requires approval before it is applied
  ...
```

| Rule                                        | Reason                                                                |
| ------------------------------------------- | --------------------------------------------------------------------- |
| **Only tools the actor may use are listed** | Defence in depth: the model cannot even see a capability it lacks     |
| Tier and approval are visible               | So it can say "this needs your approval" before the user is surprised |
| Descriptions are one line and imperative    | The description is the model's only documentation                     |
| Never list a disabled tool                  | Availability is not a documentation concern                           |

---

## 6. Errors the model must be able to recover from

| Error             | Model sees                                   | Must not see                             |
| ----------------- | -------------------------------------------- | ---------------------------------------- |
| Validation failed | The zod path and the expected type           | A stack trace                            |
| Permission denied | `forbidden: project:assign` + who holds it   | Anything suggesting a retry              |
| Approval pending  | `suspended_pending_approval`                 | A false success                          |
| Rate limited      | `retry_after: 30s`                           | Silent retry loops                       |
| Budget exhausted  | `budget_exhausted`                           | Silent degradation to a weaker answer    |
| Not found         | `not_found` (or 403 — do not leak existence) | Whether the record exists in another org |

⚠️ **Cross-tenant existence must not be distinguishable.** "Not found" and
"forbidden" collapse to the same response for records outside the actor's
organization, or the AI becomes an enumeration oracle for other tenants' IDs.

---

## 7. Adding a tool

| #   | Requirement                                                                              |
| --- | ---------------------------------------------------------------------------------------- |
| 1   | Reuse an existing route or service function. **Do not re-implement business logic**      |
| 2   | `inputSchema` in zod, including every bound (`max`, `min`, enum)                         |
| 3   | `outputSchema` — required for anything that returns records                              |
| 4   | `requiredPermission` mapped to an existing `Permission` key                              |
| 5   | `riskLevel` assigned with the tiering rules above                                        |
| 6   | `auditEvent` named; the route already audits — confirm it                                |
| 7   | Registered in both `aiTools` and `mcpTools` unless deliberately withheld                 |
| 8   | Added to `AI_TOOL_CATALOG.md` with its real route                                        |
| 9   | Added to the capability matrix with the roles that hold it                               |
| 10  | Tested: allowed role succeeds, lower role 403, cross-tenant denied, replay is idempotent |

---

## 8. Catalogue and matrix

- [`AI_TOOL_CATALOG.md`](AI_TOOL_CATALOG.md) — every tool, its real endpoint, tier, permission.
- [`AI_FEATURE_MATRIX.md`](AI_FEATURE_MATRIX.md) — capability × role, derived from the tool registry so it cannot drift.

⚠️ Both must be **generated from `aiTools`**, not maintained by hand. A
hand-written catalogue of a code registry is a lie within one release.

Related: [`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md) ·
[`AI_DATABASE_ACCESS.md`](AI_DATABASE_ACCESS.md) ·
[`AI_PERMISSIONS.md`](AI_PERMISSIONS.md) ·
[`AI_SECURITY.md`](AI_SECURITY.md)
