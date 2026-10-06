# AI permissions

**Status:** design, with a verified audit of the enforcement that exists today.
Verified claims come from [`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md)
§5 and §11. Adversarial threat analysis is in [`AI_SECURITY.md`](AI_SECURITY.md);
this document defines **who is allowed to do what**.

Covers: the inheritance chain (§2), the capability tiers and risk levels 0–4
(§3, §5.4), the three-layer configurable permission model — Super Admin global,
Org Admin, user (§5.5), actor identity (§4), the tool authorization contract
(§6), enforcement points (§11), and the invariants the AI may never violate
(§12).

---

## 1. The one principle

> **ValidTeam AI is not a principal. It is a proxy acting with the identity and
> the authority of a human who is currently present.**

An AI action is authorized exactly when the **acting human** would be authorized
to take it, at that moment, in that scope, for that resource. Not when the same
human would have been authorized yesterday. Not when the AI thinks the user
would approve.

This kills the failure mode named explicitly in the brief:

```text
✗  "The user asked me, therefore I can do it."

✓  "The user requested this action.
    Does this actor have permission for it, right now?
    Does the action's capability tier require approval?
    What scope does the permission cover?
    Is the policy engine satisfied?
    Has anything changed since the request was made?"
```

### Consequences that are not negotiable

1. **The AI cannot hold permissions.** No ambient authority, no service account
   with extra rights, no "the AI can do it because it is the AI".
2. **The AI cannot escalate.** There is no capability the AI possesses that a
   human with the same scope lacks.
3. **The AI cannot delegate authority.** A tool the AI calls runs with the
   actor's permissions, so a tool can never do more than the caller.
4. **Revocation is immediate.** If a member's role changes mid-run, the next tool
   call fails closed. Existing leases and checkpoints store no authority.
5. **AI is invisible to authorization.** The database does not know an AI was
   involved, except through audit. This is intentional: one authorization path,
   not two.

---

## 2. The inheritance chain

Every AI-initiated mutation resolves through exactly this chain. No step is
optional.

```text
1. AUTHENTICATE      resolveApiActor(request)
                     apps/web/src/lib/auth/api-actor.ts:56
                     → session user  OR  sk_live_* API key
                     A malformed programmatic credential NEVER falls back
                     to the session. This is already implemented and is the
                     strongest single control in the codebase.

2. ACTIVE STATE      access-control.ts:22–47
                     user.status = active
                     organizationMembers.status = active
                     organization.status ≠ suspended

3. SCOPE             organizationId comes from the actor, never the model,
                     the prompt, the URL of the current page, or a retrieved
                     document.
                     For anything that can span orgs, use
                     getPermittedOrganizationIds(userId) — never "the first
                     membership".

4. CAPABILITY        hasPermission(organizationId, <one of 51 strings>)
                     packages/db/src/utils/permissions.ts:242–301

5. RESOURCE SCOPE    resolveProjectCapabilityAccess(projectId, userId)
                     → the 49-key per-project can_* matrix
                     + canReadProject(projectId, userId)

6. OWNERSHIP         where a resource has an owner (drafts, personal notes,
                     private automations), the actor must be that owner.

7. DOMAIN POLICY     prepareIssueStatusTransition(...) for ANY status change,
                     so workflow edges, roles, row locks and status CAS apply.
                     A raw status write from an agent is a defect.

8. AGENT POLICY      guardAgentAction({ actor, resource, action, targetType })
                     apps/web/src/lib/agent-policy/guard.ts
                     → allow | deny | require_approval

9. CAPABILITY TIER   READ | WRITE | EXECUTE | APPROVE | ADMIN (§3)

10. RECEIPT          a stable effectKey committed with the mutation
                    agent_run_effects (unique (runId, effectKey))
```

Any failure at steps 2–9 is a **fail-closed stop**. Not a warning. Not a
downgrade. Not a fallback to a broader scope.

### What must never happen

| Anti-pattern                                                             | Why it is banned                                                                   |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Accept `organizationId` from the model's output                          | A hallucinated or injected org id is a cross-tenant breach                         |
| "Elevate for the duration of the run"                                    | Authority is per-invocation and per-actor                                          |
| A tool that bypasses `resolveApiActor`                                   | Creates a second authorization path, which is how enforcement becomes disconnected |
| A tool that queries the DB directly instead of calling the route/service | Diverges from the audited path                                                     |
| A tool whose `authorize` returns `allow` on error                        | Fail-open is the entire bug class we are closing                                   |
| An approval that re-checks nothing                                       | Approval must re-authorize, or it is a rubber stamp                                |
| Caching a permission decision across a run                               | Revocation must be immediate                                                       |

---

## 3. The capability model

Five tiers. A tool declares exactly one. The tier determines the maximum, the
user experience, and the default policy.

### READ

> AI can retrieve information the user is authorized to access.

- Requires steps 1–5. No approval, ever.
- Scoped strictly to what the actor can see: org membership **∩** project
  visibility **∩** issue security.
- Read tools return a `zod`-validated shape, not raw rows. Minimization is an
  authorization control, not just hygiene.
- ⚠️ **Must not leak existence.** "You don't have access to project X" is itself
  a disclosure. Read tools for unauthorized resources return the same
  not-found shape as a genuinely missing resource.
- Examples: `issues.search`, `analytics.*`, `documents.search`, `people.search`.

### WRITE

> AI can create or modify data the user is authorized to modify.

- Requires steps 1–8.
- Effect is **always previewed** first, even in Autopilot, so the action is
  auditable after the fact.
- `reversible: true` tools get an undo affordance. `reversible: false` tools must
  be in a higher tier — that is the rule.
- Examples: `issues.create`, `issues.update`, `documents.update`,
  `automation.update`.

### EXECUTE

> AI can perform an action using an authorized tool.

- WRITE, plus a side effect outside the database: sending an internal
  notification, posting to Slack, dispatching an agent session, running a report
  job, invoking an integration.
- The integration's own credential and scopes apply — and they are the
  **intersection** of the actor's ValidTeam rights and the integration's granted
  scopes. A Slack connection cannot do what the actor cannot do in ValidTeam,
  even if the connection has the capability.
- Steps 1–8 plus integration authorization.
- Examples: `notifications.send`, `agents.dispatch`, `reports.run`.

### APPROVE

> AI can only perform sensitive actions after explicit human approval.

- Nothing is written before approval. The proposal is persisted as an
  `agent_approval_requests` row with an **immutable** `proposedPayload`.
- On approval, authorization is **re-derived**: the approver's identity is
  captured, the policy is **re-evaluated**, and the original requester's ability
  to execute is **re-checked**. If the requester lost access in the meantime, the
  approval fails.
- Expiring and rejection are typed terminal states, never silent no-ops.
- Detail in [`AI_APPROVALS.md`](AI_APPROVALS.md).
- Examples: `issues.assign`, deadline changes, `automation.*` mutation,
  anything external, bulk changes.

### ADMIN

> Highly privileged operations require explicit administrator authorization.

- `isSuperAdmin()`, or `org:settings` / `org:manage` for workspace-level admin.
- **Never available to an AI acting autonomously.** There is no Autopilot level
  that reaches ADMIN.
- Concrete exclusions, permanently: `api_keys.*`, `sso_configs.*`,
  `scim_tokens.*`, `security-schemes.*`, `permission-schemes.*`,
  `admin/system/*`, `admin/feature-flags/*`, `admin/agent-control*`,
  org deletion, billing.
- Rationale beyond privilege: several of these are **not enforced by all
  consumers today** (§5.3), so an AI operating on them would be operating on
  fiction.

---

## 4. Actor identity: the fix that gates everything

### 4.1 Today

`guardAgentAction` runs **only when the request body carries an `agentPolicy`
marker**:

```jsonc
// packages/mcp-server/src/tools/agent-policy.ts:42 — injected by withAgentPolicy()
{
  "agentPolicy": {
    "actor": "mcp-agent",
    "source": "mcp-server",
    "resource": "issues",
    "action": "update",
  },
}
```

Three problems, all verified:

1. **Opt-in.** A REST caller can omit the marker and skip policy evaluation
   entirely.
2. **Self-asserted.** The `actor` string is client-supplied. A caller can claim
   any identity.
3. **Disableable.** `VALIDTEAM_AGENT_POLICY=off` (or the legacy
   `AGENTOWNERS_POLICY=off`) strips the marker, so the guard never runs.

The evaluator's defaults are good — humans bypass; unknown AI actors require
approval; destructive actions require approval; a policy file with no matching
rule denies — but those defaults only matter **when the guard is invoked**.

### 4.2 The fix

🔵 Derive the actor marker **server-side from the `ApiActor`**, at the request
boundary, before any handler reads a body:

```ts
// The actor is a property of the credential, not of the payload.
type ResolvedAgentActor =
  | { actorType: 'human'; actor: 'user'; userId: string }
  | { actorType: 'ai'; actor: AgentActorKind; runId?: string; delegationOf: string };
```

- `actorType: 'human'` when the credential is an interactive session.
- `actorType: 'ai'` when the credential is an agent-scoped API key, **or** when
  the request originates from an Orchestrator run — in which case `delegationOf`
  is the initiating user id, and the actor is that user's authority.
- The client may add _metadata_ (a reason, a run id) but **never the actor
  itself**. A body-supplied actor that disagrees with the credential is
  rejected with a typed error and audited.
- `VALIDTEAM_AGENT_POLICY` becomes a **server-side enforcement toggle** (useful
  for incident response), not a way for a client to opt out.

**`delegationOf` is the whole model in one field.** The AI is always acting for
a named human, and the chain is `AI → delegationOf → ApiActor → permissions`.
There is no path from an AI to an authority that its initiator does not hold.

### 4.3 Agent-scoped credentials

🔵 A distinct credential class, so the audit trail is honest and the actor is
non-negotiable:

| Property    | Value                                                                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format      | `sk_agent_` prefix (distinct from `sk_live_`) so a leaked agent key is identifiable at a glance                                                                             |
| Storage     | SHA-256 digest + prefix, exactly like `api_keys`                                                                                                                            |
| Org binding | `organizationId` not null, immutable — same rule as `api_keys`                                                                                                              |
| Created by  | A human with `api_key:create`, with an explicit scope list                                                                                                                  |
| Scopes      | 🔵 per-capability: `read`, `write`, `execute`, `approve` — and **never** `admin`                                                                                            |
| Delegation  | 🔵 **required**: the credential is bound to a set of originating user ids, or to a goal with a named human owner. An agent credential with no bound human cannot be created |
| Lifetime    | Expiry required; optional hard cap on runs/day and cost/day                                                                                                                 |
| Revocation  | Immediate, audited, invalidates all in-flight runs at the next tool call                                                                                                    |
| MCP         | 🔵 The MCP HTTP layer must **verify** the key, not pattern-match it. Today `sk_live_`-shaped strings are accepted for capability discovery                                  |

The default `mcp-agent` actor is not in `DEFAULT_KNOWN_AI_ACTORS`, so with no
policy file present every MCP write currently returns `202` pending approval.
That is correct fail-safe behaviour; it is not a bug to fix by loosening the
unknown-actor rule.

---

## 5. The permission substrate AI must inherit

### 5.1 Two systems that coexist (plus a third that does not work)

| System                                         | Shape                                                                                                                                                                | Resolution                                                                                     | AI use                                                                                                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Organization permissions**                   | 51 strings, 6 roles (`owner` 45, `admin` 34, `member` 12, `viewer` 8, `guest` 3, super admin 51) — `permissions.ts:242–301, 306`                                     | `hasPermission(orgId, perm)`, `getPermittedOrganizationIds(userId)`                            | Primary capability gate                                                                                                                              |
| **Project permissions**                        | 49 `can_*` booleans denormalized on `project_members` as `varchar(5)`; 7 roles (`product_owner` 49/49 … `viewer` 7) — `projects.ts:78`, `permissions.ts:10–240, 604` | `resolveProjectCapabilityAccess`, `canReadProject`                                             | Resource-level gate                                                                                                                                  |
| **Permission schemes / issue security levels** | `permission_schemes*`, `issue_security_levels`, `issues.securityLevelId`                                                                                             | **Not enforced.** `securityLevelId` is only ever assigned; no read or write path filters on it | ⛔ **Excluded from AI tools entirely.** Offering a tool that writes to a confidentiality control that does not enforce is worse than not offering it |

A legacy string matrix `PROJECT_ROLE_PERMISSIONS` (`permissions.ts:449`)
overlaps the first two. 🔵 The AI layer should call the **existing resolution
functions** and never touch these tables directly, so it stays correct while the
substrate is consolidated.

### 5.2 Role-aware behaviour, in one table

What the AI may _propose_ vs _do_, by the actor's real role:

| Actor                  | AI can propose                  | AI can do without approval                            | Must ask                                                  | Never                                                        |
| ---------------------- | ------------------------------- | ----------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| `guest` (3 perms)      | read-only summaries             | nothing                                               | any write                                                 | anything outside `project:view`/`issue:view`/`issue:comment` |
| `viewer` (8 perms)     | plans, drafts, analyses         | READ tier only                                        | all writes                                                | member, project, settings actions                            |
| `member` (12 perms)    | task plans, subtasks, labels    | create/edit/comment/transition on issues they can see | assign, delete, project settings                          | member management, workflows, sprints, webhooks, api keys    |
| `admin` (34 perms)     | project plans, workflow changes | most org writes                                       | deletions, org:delete, org:billing, api_key:manage/delete | —                                                            |
| `owner` (45 perms)     | everything non-system           | org-scoped writes                                     | `org:delete`, financial                                   | `system:*`                                                   |
| super admin (51)       | platform admin                  | platform config                                       | anything destructive                                      | —                                                            |
| Project role narrowing | —                               | always intersected with the 49-key matrix             | —                                                         | never widened by org role                                    |

⚠️ **`triage` is currently reachable by `canRead` alone**, so a `viewer` or
`guest` can trigger a billable model call today. 🔵 Tighten it to the WRITE tier
as part of Phase 1. This is a real, verified, low-effort fix.

### 5.3 Personnel decisions are prohibited

The brief is explicit and so is this design. The AI must not make, recommend, or
rank on:

- Performance ratings, promotion signals, termination or reduction signals
- Private one-to-one content in any assessment
- Headcount, compensation, hiring, or org-structure recommendations
- Ordering individuals by a single productivity-like metric

The Team Agent (§4.3 of the plan) may state **facts about work** — who has how
many open issues, who is on three simultaneous blocked chains, who has capacity
this sprint — because those are ordinary project facts visible to anyone with
access. It may **propose** an assignment. It may not **judge** a person.

Enforcement: no such capability exists in the tool catalogue, so no prompt can
reach one. Capability absence, not prompt discipline, is the control.

### 5.4 Risk levels 0–4 — the operational numbering

The five capability tiers above are the _authority_ model. The brief's **risk
levels** are the _user-facing and Autopilot_ model. They are not the same axis,
so both are kept and mapped explicitly.

| Risk  | Name                 | Capability tier | Approval                                 | Autopilot ceiling | Examples                                                                              |
| ----- | -------------------- | --------------- | ---------------------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| **0** | READ                 | READ            | never                                    | T0–T4 (all)       | `search_issues`, `get_issue`, `get_project_health`                                    |
| **1** | LOW-RISK WRITE       | WRITE           | default **off**; 🔵 per-workspace switch | T0–T2             | `add_comment`, `add_label`, `update_due_date`, `create_doc_page`                      |
| **2** | ORGANIZATIONAL WRITE | APPROVE         | **required** — 3 executors exist         | T0–T1             | `create_issue`, `update_issue`, `assign_issue`, `transition_status`, `create_subtask` |
| **3** | EXTERNAL ACTION      | EXECUTE         | **required, no override**                | ⛔ never          | `send_email`, `post_slack_message`, `dispatch_agent`, `invite_member`                 |
| **4** | HIGH-RISK            | ADMIN           | **required + 🔵 second approver**        | ⛔ never          | `delete_issue`, `remove_member`, `restore_doc_revision`, `bulk_import`                |

| Rule                                                                    | Reason                                                                                                   |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Risk is **assigned in code** from the capability, never chosen per call | A model-chosen tier is not a control                                                                     |
| **Bulk variants inherit the maximum** risk of their members             | `bulk_update_issues` is never risk 1 because `update_issue` is not                                       |
| Risk 3 has **no Autopilot override**                                    | An unattended outbound message is the highest-severity AI failure in this product                        |
| Risk 4 always leaves a receipt and always notifies                      | Destructive changes must remain findable                                                                 |
| ⚠️ **Risk 2 is only partially enforced today**                          | Only `issues:create`, `issues:update`, `comments:create` have approval executors. Phase 2 closes the gap |

Full tool-by-tool assignment: [`AI_TOOL_CATALOG.md`](AI_TOOL_CATALOG.md).

### 5.5 The configurable permission model — three layers

The brief requires a configurable model at three levels. The existing substrate
already provides the _actors_ for two of them; it does not yet provide the
_policy layers_.

| Layer            | Who               | What they configure                                                                                                                        | Storage                                                          | Default         |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------- |
| **Global**       | Super Admin       | Which providers exist, model allowlist, hard risk ceilings, the global kill switch, whether risk 3/4 are permitted at all, budget defaults | `system_settings` (`aiGlobalPolicy` 🔵)                          | Restrictive     |
| **Organization** | Org Admin / Owner | Enabled agents, enabled tools, Autopilot ceiling, approval routing, workspace budget, whether documents are retrievable                    | `organizations.settings.aiPolicy` 🔵 + existing `agent_policies` | Inherits global |
| **User**         | Any member        | Their own Autopilot level, whether AI may draft without asking, reduced-scope mode, always-ask list                                        | `users.preferences.aiPolicy` 🔵 (joins `user_appearance`)        | Conservative    |

#### Resolution order — most restrictive wins

```text
effective = min(
    actor's real permission,        // never exceeded
    global risk ceiling,
    organization tool allowlist,    // default-deny
    organization autopilot ceiling,
    project capability flags,       // existing can_* matrix
    user preferences,
    remaining budget
)
```

| Rule                                                                     | Reason                                                |
| ------------------------------------------------------------------------ | ----------------------------------------------------- |
| **No layer can grant** what an actor lacks                               | A configuration layer is a _ceiling_, never a grant   |
| 🔵 Every narrowing is **audited** with `layer`, `key`, `previous`, `new` | So "why was this denied?" is answerable               |
| 🔵 A layer may only **narrow**, never widen, above itself                | An org cannot re-enable what the Super Admin disabled |
| The Super Admin's global layer can be **stricter only**                  | There is deliberately no global "allow all"           |
| 🔵 Policy is **read fresh per tool call**, never cached in the run       | Revocation must be immediate (§1.4)                   |

⚠️ **Precedence is not currently expressible.** `agent_policies` exists and is
evaluated, but there is no three-layer composition, no org-level allowlist, and
no user preference layer. Phase 2 builds the composition; the _resolution
functions_ stay as they are.

#### What each layer can and cannot do

| Layer        | Can enable                            | Can disable                | Can raise a risk level | Can raise a budget        |
| ------------ | ------------------------------------- | -------------------------- | ---------------------- | ------------------------- |
| Global       | providers, models, feature flag       | any tool, any org          | ⛔ no — ceilings only  | ✅ up to the platform max |
| Organization | tools within the global ceiling       | tools, agents, Autopilot   | ⛔ no                  | ✅ up to the global max   |
| User         | nothing — this is a restriction layer | tools, Autopilot, drafting | ⛔ no                  | ⛔ no                     |

---

## 6. The tool authorization contract

```ts
interface ToolDefinition<S, R> {
  name: string;
  capability: 'read' | 'write' | 'execute' | 'approve' | 'admin';

  /** Classify the caller. Server-derived; never read from the body. */
  authorize(actor: ResolvedAgentActor, input: S): Promise<AuthzResult>;

  /**
   * AuthzResult is a discriminated union so a tool cannot accidentally
   * return a truthy object that a caller treats as `allow`.
   */
  //  { kind: 'allow',  scope: {...} }
  //  { kind: 'approval', rule, reason, risk }
  //  { kind: 'deny',   code, reason }
  //  { kind: 'not_found' }   // indistinguishable from a missing resource
}
```

Rules:

1. `authorize` **never throws and never returns a permissive default.** An
   exception becomes `deny` with an internal code, is audited, and surfaces as a
   generic failure to the model — a model must not be able to distinguish
   "permission denied" from "internal error" from "not found".
2. `not_found` is returned for both unauthorized and nonexistent. Enumeration
   resistance.
3. The scope returned by `authorize` is **narrowed** and then used for both the
   write and the audit row, so the audit cannot claim a wider scope than was
   actually granted.
4. `authorize` runs **again at execute time**, not only at plan time. A plan may
   sit for minutes behind an approval.
5. Tests: every tool ships a matrix of negative cases — wrong org, wrong project
   role, wrong org role, suspended org, inactive membership, revoked key,
   cross-tenant id from the model.

### Derived permissions, not stored ones

There is **no `ai_permissions` table and there should not be one.** Authorization
is computed from the actor's real permissions at call time. The only AI-specific
configuration is a **ceiling**:

| Setting                            | Existing home                                                       | Meaning                                    |
| ---------------------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| Per-workspace capability allowlist | 🔵 new, default-deny                                                | Which tools the AI may ever call here      |
| Per-project capability flags       | `projects.settings.aiAgents.capabilities` (exists)                  | Which run kinds / capabilities are on here |
| Autopilot bound                    | 🔵 extension of `executionMode` (exists: `manual\|assistive\|auto`) | Which tier actions may run unattended      |
| Approval defaults per capability   | 🔵 from the tier table                                              | Default policy                             |
| Budget                             | `org_token_budgets` (exists)                                        | Hard ceiling                               |

**A ceiling is a maximum, never a grant.** Effective permission =
`min(actor's real permission, workspace allowlist, project bound, budget)`.
Enabling a capability in settings never grants a permission the user lacks.

---

## 7. Cross-tenant and data-scope rules

### 7.1 The structural risk

**PostgreSQL RLS is not implemented.** There is no `ROW LEVEL SECURITY` and no
`CREATE POLICY` anywhere. Every tenant boundary is an application-level
`WHERE organization_id = ?` plus an authorization check. That is documented at
`CLAUDE.md:82` and `STATUS.md:58–59` and must never be described as RLS.

For an AI this is a larger blast radius than for a hand-written route, because
the AI composes identifiers dynamically. Therefore:

1. 🔵 **Tools never accept a bare id as authorization.** Every id-bearing tool
   resolves the resource through the actor first
   (`resolveProjectCapabilityAccess`, `canReadIssue`) and uses the _resolved_ id.
   A model-invented cuid2 simply fails to resolve.
2. 🔵 **List tools are scoped in SQL, not post-filtered.** The existing
   `/api/issues` pattern — derive readable project ids, then constrain the query —
   is the template.
3. 🔵 **Cross-tenant negative tests are a release gate for every tool**, and for
   Ask retrieval specifically, which `AGENT_RUNTIME.md:191` already requires.
4. 🔵 **Audit rows record the actor, not the claim.** If a run requests a
   cross-tenant id, that attempt is recorded even though it produced no data.

### 7.2 Retrieval scope

Ask and the Knowledge Agent must be scoped by _both_ organization and project
visibility. The existing `/api/ask` implementation already does this correctly —
`projectId` must be readable **and belong to the organization**
(`ask/route.ts:98–110`). That check is the template for every retrieval tool.

### 7.3 Secrets

| Class                         | AI handling                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider API keys (BYOK)      | Never returned by any tool. `credentials.ts` resolves them; no tool reads a secret                                                                |
| Agent session secrets         | `agent_sessions.signedSecret` is already never returned by the API                                                                                |
| Webhook / integration secrets | 🔵 excluded from every tool input/output schema                                                                                                   |
| SMTP, storage, LiveKit config | 🔵 settings context passes field _names and visibility only_, never values                                                                        |
| Prompt content                | `llm_call_audit` stores a SHA-256 `promptHash`, never the prompt — this existing behaviour is correct and must be preserved for every new AI path |
| PII                           | 🔵 `lib/ai/safety/redact.ts` exists with **zero callers**. Wire it before any tool returns comment bodies or documents                            |

---

## 8. Model and prompt-level security boundaries

Authorization protects the database. These protect the reasoning step.

1. **Retrieved content is data, never instruction.** Issues, comments, documents,
   and webhooks are user-authored and may contain instructions. Every retrieval
   result enters the prompt inside the existing `wrapUntrustedContent` boundary
   with `UNTRUSTED_CONTENT_SYSTEM_PROMPT`
   (`lib/ai/safety/sandbox.ts`). 🔵 Today the sandbox is wired into only 3
   routes — Ask, triage, and the project-agent graph ingest untrusted text with
   no scan. That gap is a Phase 1 prerequisite.
2. **The model cannot widen its own tool set.** Tool availability is a property
   of the graph step, resolved before the model runs.
3. **The model cannot change its tier.** Tier is declared on the tool.
4. **The model cannot see the approval policy source path or another workspace's
   configuration.** Policy inputs are IDs and booleans.
5. **Capability tokens are short-lived and per-run.** A long-lived token that
   outlives the initiating user's session is prohibited.
6. **Bounded turns, tools, tokens and cost per run** — required by
   `AGENT_RUNTIME.md:79–81` and enforced by the existing bounds plus
   `runWithBudget`.

---

## 9. Enforcement: how this stays true

Prompts and conventions do not hold authorization together. These do:

| Control                                                                              | Where                                                                                  |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `resolveApiActor` is the only identity source                                        | Already implemented; AI must not bypass it                                             |
| Server-derived agent actor                                                           | 🔵 §4.2 — replaces the body marker                                                     |
| `guardAgentAction` invoked unconditionally for AI-originated requests                | 🔵 §4.2                                                                                |
| Capability allowlists default-deny                                                   | 🔵 control center                                                                      |
| Tier declared on the tool, not inferred at runtime                                   | Tool schema                                                                            |
| Re-authorization at execute time                                                     | 🔵 tool `authorize` runs again                                                         |
| Approve re-evaluates policy **and** requester capability                             | Already implemented in the approve route — preserve it                                 |
| Receipts with stable effect keys                                                     | `agent_run_effects`, unique `(runId, effectKey)`                                       |
| CI rule: every API route imports an auth helper                                      | 🔵 lint rule — the audit's highest-leverage hardening                                  |
| CI rule: a bare `organizationId` from a body/query requires an adjacent access check | 🔵 lint rule. **This would have caught the `/api/saved-filters` cross-tenant finding** |
| CI rule: AI ingress routes must call `evaluateInjectionRisk`                         | 🔵 lint rule                                                                           |
| Cross-tenant negative test per tool                                                  | 🔵 test gate                                                                           |
| `isAiFeatureEnabled` fails closed and 404s                                           | Already implemented — preserve                                                         |

### Existing enforcement defects that this model must fix first

Ranked by blast radius. Full list in
[`AI_SECURITY.md`](AI_SECURITY.md) §2.

1. Agent policy is opt-in and the actor is self-asserted.
2. Automation `assign`/`add_label`/`add_comment`/`set_priority` write `issues`
   with no `organizationId` predicate
   (`lib/automation/evaluator.ts:180–282`). An AI that can create automation
   rules inherits this. **Automation rule mutation must not ship before this is
   fixed.**
3. `/api/saved-filters` GET/POST have no membership check.
4. `/api/search-history` cleanup deletes other users' rows.
5. No RLS.

Items 1 and 2 are hard prerequisites for Phase 3 (action execution). Items 3–5
belong to the tenant-hardening track in `ROADMAP_2026.md` and must at minimum be
excluded from AI-reachable tool paths.

---

## 10. Summary table

| Tier        | Authorization required  | Approval                     | Preview    | Receipt | Reversible      | Autopilot eligible          |
| ----------- | ----------------------- | ---------------------------- | ---------- | ------- | --------------- | --------------------------- |
| **READ**    | steps 1–5               | never                        | n/a        | no      | n/a             | yes                         |
| **WRITE**   | steps 1–8               | policy-driven                | **always** | **yes** | if `reversible` | yes, within bound           |
| **EXECUTE** | steps 1–8 + integration | policy-driven                | **always** | **yes** | usually no      | only internal notify/report |
| **APPROVE** | steps 1–8 + approver    | **always**                   | **always** | **yes** | if `reversible` | **never unattended**        |
| **ADMIN**   | `isSuperAdmin`          | **always** + second approver | **always** | **yes** | no              | **never**                   |

---

## 11. Enforcement points

Where authority is actually checked. Each row is a place the AI cannot route
around.

| #   | Point          | Function                                                                                                     | Status                                                       |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 1   | Identity       | `resolveApiActor(request)` — session **or** `sk_live_*` key; a malformed key never falls back to the session | ✅                                                           |
| 2   | Active state   | user / membership / organization `status`                                                                    | ✅                                                           |
| 3   | Org scope      | `getPermittedOrganizationIds`, `resolveOrganizationAccess`                                                   | ✅                                                           |
| 4   | Capability     | `hasPermission(orgId, permission)`                                                                           | ✅                                                           |
| 5   | Resource scope | `resolveProjectCapabilityAccess(projectId, userId)`, `canReadProject`                                        | ✅                                                           |
| 6   | Ownership      | author/owner checks on drafts, notes, private automations                                                    | ✅                                                           |
| 7   | Domain policy  | `prepareIssueStatusTransition` → `applyPreparedIssueStatusTransition` — edge, role, row lock, status CAS     | ✅                                                           |
| 8   | Agent policy   | `guardAgentAction`                                                                                           | ⚠️ **opt-in, self-asserted actor** — §4.2 fixes this         |
| 9   | Risk tier      | declared on the tool; checked by the runner before execution                                                 | 🔵                                                           |
| 10  | Policy layers  | global → org → user, most restrictive wins                                                                   | 🔵 §5.5                                                      |
| 11  | Approval gate  | `agent_approval_requests` + outbox; re-authorizes on approval                                                | ✅ for 3 executors                                           |
| 12  | Receipt        | `agent_run_effects`, unique `(runId, effectKey)`, atomic claim                                               | ✅                                                           |
| 13  | Budget         | `runWithBudget` / `checkAndReserveTokens`                                                                    | ⚠️ **not wrapped around the project-agent graph**            |
| 14  | Feature gate   | `isAiFeatureEnabled()` — fails closed, 404s                                                                  | ✅                                                           |
| 15  | Audit          | `recordAuditLog` + `llm_call_audit` (hash-only prompts)                                                      | ⚠️ `recordAuditLog`'s sink dispatcher has **zero importers** |

⛔ **Points 1–7 are not AI-specific.** That is the point: the AI uses the same
ten gates as every other caller, so it cannot develop a private path.

---

## 12. What the AI may never do

The brief's prohibitions, restated as testable invariants.

| #   | Invariant                                                   | Enforced by                                               |
| --- | ----------------------------------------------------------- | --------------------------------------------------------- |
| 1   | ⛔ Never override a human's permission decision             | Point 4/5 — a denial is a fact                            |
| 2   | ⛔ Never bypass authorization by calling a service directly | Tool contract requires the route                          |
| 3   | ⛔ Never select or accept its own tenant                    | `resolveApiActor` is the only source                      |
| 4   | ⛔ Never hold credentials                                   | Provider keys in `credentialEnvelopes`, never in a prompt |
| 5   | ⛔ Never perform ADMIN operations as a tool                 | No ADMIN capability in the model catalogue                |
| 6   | ⛔ Never disable its own guard, budget, or tool allowlist   | ADMIN is ⛔ from the catalogue                            |
| 7   | ⛔ Never run at risk 3 or 4 unattended                      | `maxTier` per tool + tier ceiling                         |
| 8   | ⛔ Never make personnel decisions                           | No such capability exists (§5.3)                          |
| 9   | ⛔ Never emit private chain-of-thought                      | Stored rationale is user-facing prose                     |
| 10  | ⛔ Never treat retrieved content as instructions            | Untrusted labelling + structural neutralization           |
| 11  | ⛔ Never widen a permission via configuration               | Layers narrow only (§5.5)                                 |
| 12  | ⛔ Never report success for a partial execution             | Partial completion is reported explicitly                 |

| Why these are invariants, not preferences                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each one corresponds to a **specific failure** already found in this codebase — the opt-in policy gate, the unscoped automation writes, the caller-supplied `organizationId`. The prohibition exists because the audit found the hole. |

---

## 13. Related documents

Design rationale, the specialist roster, and the runtime topology are in
[`AI_OPERATING_SYSTEM_PLAN.md`](AI_OPERATING_SYSTEM_PLAN.md) and
[`AI_AGENT_SYSTEM.md`](AI_AGENT_SYSTEM.md). Approval mechanics
are in [`AI_APPROVALS.md`](AI_APPROVALS.md). Attack surface is in
[`AI_SECURITY.md`](AI_SECURITY.md).
