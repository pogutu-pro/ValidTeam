# Human approval framework

**Status:** design. Builds on the approval subsystem that already exists in
`apps/web/src/lib/agent-policy/` and migrations `0055` / `0061`. Verified
current state: [`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md) §5.4.

---

## 1. The design tension

Two failure modes pull in opposite directions:

- **Ask too much** → confirmation fatigue → users click Approve reflexively →
  the approval gate becomes theatre. This is worse than no gate, because it
  manufactures false confidence.
- **Ask too little** → the AI does something consequential and irreversible
  without a human decision. This destroys trust in a single incident.

The resolution is not a global threshold. It is:

> **Approval is a property of the action's consequence, decided by a
> deterministic classifier — not of the model's confidence, and not of a
> user-tunable slider that gets left on "approve everything".**

Three rules follow:

1. **Confidence is not a gate.** A 95%-confident proposal to reassign four
   people's work is still an APPROVE action. `DESIGN.md` also bans showing
   confidence numbers to users at all.
2. **Low-risk actions must not prompt.** If the AI cannot act without asking on
   work it is obviously permitted to do, the product trains users to approve
   reflexively, and the gate stops protecting anything.
3. **Bundles are one decision.** "Change 14 deadlines, assign 3 tasks, notify 5
   people" is one approval with a reviewable diff, not 22 prompts.

---

## 2. Risk classification

Deterministic, computed from the tool's declared capability plus context
(blast radius, reversibility, externality, target). Never from model output.

### Low risk — execute automatically

| Action                                                              | Why it is low                       |
| ------------------------------------------------------------------- | ----------------------------------- |
| Read anything the user can read                                     | No state change                     |
| Summarize, search, rank, explain                                    | No state change                     |
| Draft content (comment, announcement, email, spec, brief)           | Produces a draft, not a message     |
| Create personal notes / scratch drafts                              | `drafts` is user-owned              |
| Suggest plans, propose assignments, propose decompositions          | Proposals are the output            |
| Create a **private** AI artifact (a personal summary, a saved view) | User-owned, user-visible, deletable |
| Nudge internal notifications to the requesting user only            | Self-directed, in-app               |
| Regenerate a report                                                 | Read-only recomputation             |

These run with a receipt and an audit row, so an admin can always see what
autonomy actually did.

### Medium risk — confirm, policy-dependent

| Action                                                                   | Default                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Assign or unassign tasks                                                 | **Ask.** Assignment is a person's expectation                                         |
| Change deadlines                                                         | **Ask.** Deadlines are commitments                                                    |
| Create tasks on a sprint                                                 | Ask, unless Autopilot + within bound                                                  |
| Transition status along an allowed workflow edge                         | Ask unless Autopilot; never ask if the edge requires no project-transition permission |
| Modify project settings, sprint config, workflow definitions             | **Ask**                                                                               |
| Send an internal announcement                                            | **Ask**                                                                               |
| Create or modify an automation rule                                      | **Ask, always** — see §2.1                                                            |
| Create a project, sprint, document, version, component, label            | Ask                                                                                   |
| Bulk changes (more than one resource class, or above a configured count) | **Ask**                                                                               |
| Change issue priority en masse                                           | **Ask**                                                                               |

Configurable per workspace, with these as the defaults. ⚠️ Note the asymmetry
rule in §5: **a workspace may relax a default downward (more automation) only by
also raising its audit retention, never by weakening approval on ADMIN or
external actions.**

### High risk — explicit approval, never relaxable

| Action                                                                              | Why                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------- |
| Delete issues, projects, sprints, documents, automations                            | Irreversible                                      |
| Bulk delete of any kind                                                             | Irreversible at scale                             |
| **Any** external communication — email, Slack, Jira/GitHub comment, webhook         | Reputation is outside the system of record        |
| Change organization security settings                                               | Security                                          |
| Change permissions, roles, project membership                                       | Security                                          |
| Change API keys, SSO configs, SCIM tokens                                           | Credential surface                                |
| Change issue security levels or permission schemes                                  | Confidentiality (and currently unenforced — §5.1) |
| Financial actions (billing, plan changes, usage that incurs cost beyond the budget) | Money                                             |
| Irreversible operations of any kind                                                 | Irreversible                                      |
| Actions affecting many users (mass notifications, org-wide writes)                  | Blast radius                                      |
| Anything at ADMIN capability                                                        | Privilege                                         |

There is no workspace setting that makes a high-risk action automatic. An
Autopilot configuration that attempts to include one is **rejected at save
time**, not at run time.

### 2.1 Automation rules are special

Creating an automation rule is medium risk in principle but treated as
**always-ask** in this design, for a structural reason: a rule is a _standing
grant_ to act repeatedly. Approving a single notification is not approving a rule
that will assign work every weekday at 09:00 for a year.

Therefore, in addition to the ordinary approval:

- The rule must be **simulated** before approval — "this rule would have matched
  41 issues in the last 30 days, and would have sent 41 notifications."
- The approval record stores the **rule body**, not a summary.
- Every future execution of an AI-authored rule produces its own audit row
  naming the rule and the approval that authorized it. Approval of a rule is not
  blanket approval of its executions.
- The rule's own capability ceiling is inherited from its approver at creation
  time and cannot exceed it later, even if the approver's permissions grow.

---

## 3. Existing machinery to reuse

This is already built and already correct in its core. Do not build a second
approval system.

| Element             | Location                                                               | Reuse as-is                                                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Policy evaluation   | `lib/agent-policy/evaluator.ts`                                        | `allow \| deny \| require_approval`, with humans bypassing, unknown AI actors requiring approval, destructive actions requiring approval, and a policy file with no matching rule **denying** |
| The guard           | `lib/agent-policy/guard.ts` — `guardAgentAction(...)`                  | Write the decision; return `{allowed, body, httpStatus}`                                                                                                                                      |
| Approval requests   | `agent_approval_requests`                                              | Stores an **immutable** `proposedPayload`, so replay trusts the original action rather than a second client body                                                                              |
| Effect outbox       | `agent_approval_effect_outbox`                                         | Unique `(approvalId, effectType)`, leased, at-least-once                                                                                                                                      |
| Effect processing   | `lib/agent-policy/approval-effects.ts` — `processApprovalEffectOutbox` | 5-minute lease, max 8 attempts, reclaims expired leases                                                                                                                                       |
| Approver permission | `lib/agent-policy/approval-permissions.ts` — `canManageAgentApprovals` | Any approve/reject surface                                                                                                                                                                    |
| Approve route       | `POST /api/agent-approvals/[id]/approve`                               | **Already re-evaluates policy, claims the row transactionally, re-verifies the requester, and drains the outbox**                                                                             |
| Reject route        | `POST /api/agent-approvals/[id]/reject`                                | Typed `expired` terminal state, CAS on `pending` + unexpired, `409` on race, `410` on expired                                                                                                 |
| Listing             | `GET /api/agent-approvals`                                             | Validate `status` against the allowed set, `LIMIT 100`                                                                                                                                        |

### States today

```text
AgentApprovalRequestStatus  = pending | executing | approved | rejected | expired | failed
AgentApprovalEffectStatus   = pending | processing | completed | failed
```

### 🔴 What must be added

| Gap                                                                        | Why it blocks the design                                                                                                                                                                        | Fix                                                                                                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Only 3 executors** (`issues:create`, `issues:update`, `comments:create`) | The project graph cannot enqueue; `resolveAgentExecutionPolicy` forces `dryRun: true` and zero writes when approval is required (`execution-policy.ts:18–80`). Agents preview instead of asking | 🔵 Add executors keyed to the tool catalogue. **Every WRITE/EXECUTE/APPROVE tool needs one**, or it must be marked non-approvable                   |
| **`status` is `text` with a TS `$type<>` only**                            | No DB enum, unlike `agent_runs.status`. Any non-app writer can insert an invalid status                                                                                                         | 🔵 Hand-written idempotent migration to a real `pgEnum`                                                                                             |
| **No proposal preview stored**                                             | An approver sees `JSON.stringify(proposedPayload)` in a `<pre>` (`agent-governance-panel.tsx:265–271`) — the single biggest trust failure in the current UI                                     | 🔵 A structured `preview` payload (before/after per field) rendered as a diff                                                                       |
| **No decision history in the UI**                                          | The queue is `status=pending` only, so there is no "who approved what, when, why"                                                                                                               | 🔵 `GET /api/agent-approvals?status=all` exists already — the UI must show decided rows with `decidedBy`, `decidedAt`, and a reason                 |
| **No decision reason field**                                               | Approve/Reject are one-click with no rationale and no confirm                                                                                                                                   | 🔵 Add `decisionReason`; require it for rejection and for ADMIN-tier approval                                                                       |
| **No bundles**                                                             | 22 changes = 22 rows = fatigue                                                                                                                                                                  | 🔵 One request, many effects: reuse the outbox's `(approvalId, effectType)` uniqueness by introducing `(approvalId, effectIndex)` and a stored plan |
| **No expiry policy**                                                       | `expiresAt` exists on the schema but nothing sets or sweeps it                                                                                                                                  | 🔵 Default TTL by tier (WRITE 24 h, EXECUTE 4 h, ADMIN 1 h, external 1 h); a sweep marks them `expired`                                             |
| **No escalation / delegation**                                             | A single unavailable approver stalls a goal                                                                                                                                                     | 🔵 Ordered approver list derived from `project.leadId`, then `team.leadId`, then org admins — with the same authorization re-check at claim time    |
| **Approval grants nothing**                                                | Correct today, must stay correct                                                                                                                                                                | 🔵 Approve executes **as the approver's authority**, bounded by the original requester's authority. Never as the AI's                               |

### The single most important approval property

> **Approving an action is not approving a future action, and is not approving a
> broader action.**

The approve route already re-evaluates policy and re-verifies the requester.
That must be extended so it also re-verifies that the **payload has not
changed** — the immutable `proposedPayload` is the mechanism; the approval flow
must never re-read a client body.

---

## 4. Approval UX

### 4.1 The single decision

```text
ValidTeam AI wants to:

  Change 14 task deadlines          → Mobile Launch, 8 due dates pushed by 1–3 days
  Assign 3 tasks                    → TN-412, TN-418, TN-455 → Sam Okoye
  Send a team announcement          → #mobile-launch, "Heads up: sprint scope change"

  Nothing has been changed yet.

  [ Review changes ]  [ Approve 18 changes ]  [ Reject ]
```

Required properties:

- **Counts, not prose.** "18 changes across 3 actions."
- **Scope stated.** Which project, which people, which channel.
- **Reversibility stated.** "Reversible" / "Not reversible" — driven by the
  tool's `reversible` field, so the UI cannot lie.
- **Nothing has happened.** Explicit.
- **Reject asks for a reason**, and a rejection is fed back to the AI as
  structured input so it can revise rather than re-propose the same thing.
- **Reject is not a dead end.** "Reject" offers "Reject and re-plan".

### 4.2 Review changes

A per-effect diff, grouped by resource:

```text
TN-412  Set due date     2026-10-12  →  2026-10-15        ← changed
TN-418  Set due date     2026-10-12  →  2026-10-16        ← changed
TN-455  Set due date     (none)      →  2026-10-16        ← changed
…
TN-460  Set due date     2026-10-12  →  2026-10-12        ← no change, drop it
```

⛔ **Rows with no actual change must be removed from the plan before display.**
An approval that lists 14 changes and applies 11 teaches users to skim.

The diff must render **from structured data, never raw JSON**, and must not leak
internal identifiers as the only label. If an effect cannot be rendered as a
diff, it must not be approvable.

### 4.3 Where approvals surface

| Location                                                | Purpose                                                                                                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inline**, in the conversation that produced it        | The primary path. Approval is part of the thread                                                                                                                |
| **Inbox notification**, typed `agent.approval_required` | So a user who was not watching is still reached. 🔵 new notification type (the enum has 13 values, none for this)                                               |
| **Dashboard attention queue**                           | 🔵 The current row is a _link to settings_ — the most severe item has no in-place path (`dashboard-client.tsx:271–290`). It must be actionable where it appears |
| **Settings › AI governance**                            | Full history, filters, bulk reject                                                                                                                              |
| **Goal detail**                                         | Approvals a goal is blocked on                                                                                                                                  |

Do **not** build a separate "Approvals" product area. One queue, five entrances.

### 4.4 Accessibility and keyboard

The product is keyboard-first (`CLAUDE.md`). An approval must be completable
without a mouse and must be announced:

- Focus moves to the approval card when it enters an active thread.
- `A` approve / `R` reject / `Enter` review, documented in
  `lib/help/shortcuts-registry.ts` — which today is hardcoded English and lists
  `G…`/`N…` chords the product does not implement. 🔵 Fix the registry rather
  than adding an unlisted shortcut.
- The count of changes must be in the `aria-label`, not only visible text.
- An `aria-live` region announces state transitions (proposed → approved →
  applied → reverted). This does not exist for any AI surface today.

---

## 5. Policy configuration

### 5.1 Defaults

| Capability tier                                     | Default policy                                | Configurable |
| --------------------------------------------------- | --------------------------------------------- | ------------ |
| READ                                                | allow                                         | no           |
| WRITE (reversible, single resource)                 | allow within bound                            | yes          |
| WRITE (multi-resource)                              | require_approval                              | yes          |
| WRITE (irreversible)                                | require_approval                              | **no**       |
| EXECUTE (internal)                                  | allow within bound                            | yes          |
| EXECUTE (external)                                  | require_approval                              | **no**       |
| APPROVE (deadline, assignment, automation mutation) | require_approval                              | yes          |
| ADMIN                                               | require_approval + **two distinct approvers** | **no**       |

### 5.2 Three constraints on configuration

1. **Cannot weaken high-risk.** `require_approval` for external, irreversible,
   and ADMIN actions is not adjustable.
2. **Cannot exceed the approver.** A policy may only _raise_ the required
   approval level relative to the tier default; it may not grant an authority
   the approver lacks.
3. **Never more permissive than the actor's own permissions.** A policy is a
   floor, not a grant — the same intersection rule as the Autopilot bound.

### 5.3 The AGENTOWNERS file

`GET /api/agent-policy` exposes the parsed policy document, its `sourcePath`,
`parsedAt`, and validation errors, sourced by `lib/agent-policy/source.ts` from an
on-disk `AGENTOWNERS`-style file (`docs/examples/AGENTOWNERS.example`). 🔵 AI
tool **capabilities** should be declarable in the same document so operators who
already manage policy in one place keep doing so. If a policy file fails to
parse, the evaluator's behaviour is already correct: **require_approval**.

### 5.4 AI-authored rules

🔵 An AI-authored automation rule is marked as such on the row and in every
audit entry it produces, so an operator can filter "everything the AI created"
and turn it all off in one action. A workspace must be able to answer: _what has
the AI been permitted to do here, and what has it actually done?_ — see
[`AI_AUDIT.md`](AI_AUDIT.md).

---

## 6. Anti-patterns to refuse in review

| Anti-pattern                                                   | Why                                                                                                                                                |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Approve all changes" as the primary button                    | Trains reflexive approval. Individual approve, plus a separate deliberate bulk action for genuinely homogeneous batches                            |
| Showing a confidence % on the approval card                    | `DESIGN.md:91, 391, 484` bans it; confidence is not a risk measure                                                                                 |
| Approving a plan and letting the AI fill in details afterwards | The approval must cover exactly what was reviewed. `proposedPayload` immutability is the mechanism                                                 |
| An approval that can be reused for a second run                | Every run gets its own request                                                                                                                     |
| Auto-approving anything because the user is an owner           | Approval is about consequence, not seniority                                                                                                       |
| Treating a timeout or an error as a rejection                  | Must be a typed terminal state with a retry path                                                                                                   |
| Approvals that skip authorization re-checks                    | The approve route already does this; preserve it                                                                                                   |
| Hiding the blast radius ("update tasks")                       | Always name project, count, and people                                                                                                             |
| One approval for a mixed-tier bundle                           | Split by tier. An external send inside a task-tidy bundle forces the whole bundle to the higher tier, which is exactly the fatigue we are avoiding |

---

## 7. Acceptance criteria

An approval framework is done when:

- [ ] Every WRITE/EXECUTE/APPROVE tool has an executor, or is explicitly marked
      non-approvable — no silent "preview only" gaps.
- [ ] `agent_approval_requests.status` is a real `pgEnum` with the six states.
- [ ] Pre-approval writes are provably zero, and there is a test asserting it.
- [ ] A run blocked on approval holds **no lease** and resumes correctly after a
      deploy.
- [ ] Approval re-derives the actor, re-evaluates policy, re-verifies the
      requester, and verifies the payload is unchanged.
- [ ] Every approval renders as a structured diff, never raw JSON.
- [ ] A no-op change never appears in a proposal.
- [ ] Expired, rejected, and failed requests are typed terminal states visible in
      history with actor and reason.
- [ ] Approve and reject are keyboard-completable and `aria-live`-announced.
- [ ] The Autopilot configuration **rejects** any attempt to make a high-risk
      action automatic.
- [ ] Audit rows record the rule, the approver, and every execution the rule
      later caused.

Related: [`AI_PERMISSIONS.md`](AI_PERMISSIONS.md) ·
[`AI_AUDIT.md`](AI_AUDIT.md) ·
[`AI_UX.md`](AI_UX.md)
