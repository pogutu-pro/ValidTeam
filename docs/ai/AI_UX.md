# AI UX — interaction design specification

**Status:** design. Binding on every AI surface built from here.
Thesis: [`AI_UX_SIMPLIFICATION.md`](AI_UX_SIMPLIFICATION.md).
Verified current UI defects: [`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md)
§7, §12.

This document specifies how the AI **looks, sounds, and behaves**. It is a design
contract, not a proposal: if a proposed screen violates it, the screen is wrong.

---

## 1. Design principles

| #   | Principle                                                                                        | Consequence in practice                           |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 1   | **Propose, never surprise.** The user sees the change before it exists                           | No write without a preview                        |
| 2   | **Explainability is a feature, not a debug mode.** Rationale and evidence are first-class        | "Why?" is always answerable                       |
| 3   | **One surface.** The user learns one place to go                                                 | See the simplification doc                        |
| 4   | **Calm, not magical.** The AI is a competent colleague, not an oracle                            | No anthropomorphism, no sparkle-as-personality    |
| 5   | **Bounded, and says so.** The user always knows the limits                                       | Budget, scope, tier, and sources are visible      |
| 6   | **Interrupt only when it matters.** Notification is a cost, not a feature                        | Digest over spam                                  |
| 7   | **Honest about failure.** Refusal and error are stated, never smoothed over                      | Visible refusal + alternative                     |
| 8   | **The system of record is not the AI.** Durable state lives in issues, documents, and audit rows | The AI reads and proposes; the database remembers |

---

## 2. Visual language

### 2.1 The AI mark

🔵 **One** subtle mark, everywhere AI-authored content appears.

| Property  | Value                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| Form      | A small geometric glyph — not a robot, not a sparkle-as-brand                                                               |
| Placement | Inline, before or after the content, at the author's baseline                                                               |
| Colour    | The AI accent token, one step below interactive emphasis — **never** the danger or success tokens                           |
| Animation | None. It must not move. Moving AI chrome implies liveness without it                                                        |
| WCAG      | Text label required in `zh` (where a lone glyph is ambiguous) and any locale where the glyph is not a recognised convention |

Replaces `info.ai.disclosureTitle` + `disclosureRequired`. A modal is not
consent; a persistent, low-friction, accurate mark is.

### 2.2 What the AI must never look like

| Banned                                         | Why                                                             |
| ---------------------------------------------- | --------------------------------------------------------------- |
| The primary action button on a page            | The AI is a collaborator, not the main character                |
| A full-bleed hero                              | Same                                                            |
| Purple-gradient "AI magic"                     | Undermines the Calm principle and the design system's restraint |
| An avatar with a face                          | Encourages anthropomorphism and over-trust                      |
| Confidence meters or percentages               | Unfalsifiable numbers; also a security-relevant signal leak     |
| A blinking "thinking…" spinner with no content | Says nothing; see §5                                            |

### 2.3 Provenance, everywhere

🔵 Every AI-authored or AI-modified artifact carries a **provenance line**:

```text
Drafted by ValidTeam AI · 3 sources · Reviewed by Sam Okoye · 2 hours ago
                            ↳ view reasoning        ↳ open run TN-4812
```

The `↳ open run` link is a hard requirement: `AGENT_RUNTIME.md:99–104` requires a
`receiptId` or equivalent, and an unreachable link is a broken promise. Today this
link exists but is unreachable on issues — one of the highest-value small fixes in
the whole programme.

---

## 3. Tone of voice

One voice, whatever the surface.

| Situation         | Voice                                                    | Example                                                                                               |
| ----------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Answering         | Direct, plain, specific                                  | "Six issues are in Ready for QA. Two are blocked on TN-401."                                          |
| Proposing         | Neutral, describes the change                            | "Move TN-455 to Sprint 13" — not "I'll move it for you!"                                              |
| Justifying        | Factual, no self-flattery                                | "Based on your sprint capacity (3 days) and Sam's current load (11 open)"                             |
| Being uncertain   | Explicit and bounded                                     | "I could not confirm this from the available sources."                                                |
| Refusing          | Short, states the reason, offers the nearest alternative | "I can't reassign work outside your project permissions. You can ask Priya, or I can draft the note." |
| Failing           | Says what failed and what to do                          | "The provider didn't respond. Retry, or continue without this step?"                                  |
| Correcting itself | No defensiveness                                         | "You're right — TN-401 is done. Correcting."                                                          |

### Banned constructions

| Banned                                            | Reason                                    |
| ------------------------------------------------- | ----------------------------------------- |
| "Great question!"                                 | Hollow, adds latency, no information      |
| "I apologize for the inconvenience"               | The AI did not have a bad day             |
| "As an AI language model…"                        | Already knows                             |
| Emoji in prose                                    | Not our voice                             |
| Over-hedging ("it seems", "perhaps", "generally") | Uncertainty must be specific, not smeared |
| Certainty the model does not have                 | The single worst failure mode             |
| Asking permission to explain                      | Explain                                   |
| Framing a refusal as a safety lecture             | State the limit, offer the path           |

---

## 4. Trust cues

Trust is not one feature. It is five, and all five must be present.

| Cue             | Requirement                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| **The preview** | A real diff of the real change, before anything is written. Non-negotiable                            |
| **The tier**    | Whether this needs approval, and why, in one phrase: "Needs approval — it changes someone's workload" |
| **The scope**   | What the AI can reach in this session: "Looking at Project Orion only"                                |
| **The sources** | Clickable citations for every factual claim                                                           |
| **The receipt** | After execution: what changed, what it cost, and how to undo it                                       |

### The preview, specified

```text
┌──────────────────────────────────────────────────────────────┐
│ 3 proposed changes                            APPROVE ALL    │
│                                                              │
│ ▸ Move TN-455 "Fix auth redirect" → Sprint 13                │
│     Sprint 12 closes Friday with 4 unplanned issues           │
│     [View issue]                          Commit: +1 sprint   │
│                                                              │
│ ▸ Reassign TN-471 from Sam → Priya                            │
│     Sam: 11 open, 4 overdue. Priya: 3 days capacity          │
│     [View issue]        ⚠ Needs approval — changes workload  │
│                                                              │
│ ▸ Add label "at-risk" to TN-460                              │
│     Blocked 9 days behind TN-401                             │
│     [View issue]                        Already applied? No   │
│                                                              │
│ ☐ Show 2 more proposals                                      │
│                                                              │
│                  [ Approve selected ]  [ Dismiss ]  [ Ask why ]│
└──────────────────────────────────────────────────────────────┘
```

| Must                                               | Must not                                |
| -------------------------------------------------- | --------------------------------------- |
| Render the actual target state, not a description  | Describe without showing                |
| Per-proposal approval, not all-or-nothing only     | Hide which proposals are being approved |
| Show the reason inline                             | Require a separate trip to find out why |
| Distinguish "needs approval" from "will apply now" | Let the user guess                      |
| Be dismissible with no penalty                     | Nag                                     |
| Offer "Ask why" for the whole set                  | Make "why" a per-click detective game   |

🔵 **Do not stream the proposal.** Tokens arrive, then get approved — an approval
must refer to a finished artifact. Streaming is for answers; proposals arrive
whole. (Answers may stream, with citation markers resolved as they land.)

---

## 5. States

Every AI interaction must specify all eight. Missing states are where AI UIs
break.

| State                | Design                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Idle**             | One input. Suggested starters relevant to the current context, as chips — never a fake chat history                            |
| **Working**          | Say **what it is doing**, not that it is thinking. "Checking 6 issues and 2 blockers…" Progress that is real; a spinner is not |
| **Gathering (slow)** | At ~3s, say what is being looked up. At ~8s, offer `Continue in background` and notify on completion                           |
| **Partial**          | Some tools succeeded, some failed. Show what is known, name what is missing, continue rather than discard                      |
| **Refused**          | Visible, explained, with the nearest alternative. Never a silent fallback                                                      |
| **Failed**           | Name the failure class in user terms, offer retry/alternative/cancel. No error codes in the UI                                 |
| **Budget exhausted** | "That used your monthly AI budget. It resumes 1 March." Never silently degrade                                                 |
| **Killed**           | "AI is switched off for this workspace." Distinct from an error, so nobody debugs a policy                                     |

⚠️ **No cancel for Ask.** The request runs to completion or times out; a user
cannot stop generation and has no idea why. Fixing this is one of the cheapest
quality wins available.

---

## 6. Interaction patterns

### 6.1 Inline AI suggestions

🔵 Replaces the `draft-issue`, `extract-ghost`, `suggest-update` full modals.

```text
Issue description
┌──────────────────────────────────────────────────────┐
│ Users report that when they sign in with SSO and the  │
│ workspace has no default project, the redirect lands  │
│ on an empty list. Expected: the last used project.    │
│                                                       │
│ ✦ Drafted by ValidTeam AI  [Improve] [Edit] [Dismiss] │
└──────────────────────────────────────────────────────┘
```

| Rule                                                   | Reason                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| Inline, under the field                                | Keeps the user in the task                                 |
| The user must still press the primary action           | The AI never submits on the user's behalf without approval |
| Dismissal is remembered per surface                    | Do not suggest twice what was declined                     |
| Never rewrite existing text without an explicit action | Silent rewriting destroys trust instantly                  |

### 6.2 The digest, not the dashboard

🔵 Standup, project health, and cron risk are **one** digest surface with a scope
selector. Three panels became three implementations of the same thing.

```text
Today · Project Orion
  Shipped        4 issues closed
  At risk        Sprint 12 closes Friday · 4 unplanned
  Blocked        TN-460 → TN-401 (9 days)
  Your queue     3 needing action · 1 overdue
  [Review 3 items] [Set a goal for launch]
```

| Rule                                                 | Reason                                       |
| ---------------------------------------------------- | -------------------------------------------- |
| Five lines, not fifty                                | A report that cannot be read is not a report |
| Every line links to the underlying records           | Evidence, not summary                        |
| No charts in a digest                                | A chart needs interaction; a link does not   |
| Quiet by default; respect `notification_preferences` | Notification is a cost                       |

### 6.3 Proposals in context

Where a proposal targets a record, offer it **there**:

```text
TN-460 · Blocked
┌────────────────────────────────────────────┐
│ ✦ ValidTeam AI suggests                    │
│   Label: at-risk                             │
│   Reason: blocked 9 days behind TN-401      │
│   [Apply]  [Not now]  [Why?]                │
└────────────────────────────────────────────┘
```

Cheaper, clearer, and it survives on the page — unlike a modal that vanishes.

### 6.4 Approvals

The approval queue is a first-class surface, not a notifications tab.

| Requirement                                          | Reason                                         |
| ---------------------------------------------------- | ---------------------------------------------- |
| Grouped by risk, then by age                         | Triage order                                   |
| Never shows raw JSON                                 | It is not readable and not trustworthy-looking |
| Shows the diff, the reason, and who will be affected | The three questions before approving           |
| Names the person it will notify                      | Social effect                                  |
| Approving is reversible for a defined window         | [`AI_APPROVALS.md`](AI_APPROVALS.md)           |
| Expired approvals are visibly expired, not pending   | Otherwise they leak                            |

### 6.5 Destinations for transparency

`settings/ai-transparency` already exists and is good. It becomes the place that
answers "what does the AI know, and what does it do with my data":

| Section              | Content                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| What the AI can do   | The capability list, and the current bound                                |
| What it has done     | Recent AI-originated changes, with receipts                               |
| What it remembers    | 🔵 Every memory, with source, author, and a delete control                |
| What it costs        | `org_token_budgets`: used, projected, reset                               |
| Where your data goes | 🔵 Per-provider retention posture; the embedding decision                 |
| Switches             | Capabilities, bound, daily ceiling, kill switch                           |
| Rules it created     | Every `ai_authored` automation rule, individually and in bulk disableable |

---

## 7. Accessibility

Accessibility is a requirement, not a pass at the end.

| Rule                                          | Detail                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| Every AI control is keyboard reachable        | Including inline suggestions and approval buttons                                   |
| Visible focus on every interactive AI element | The design system's focus ring applies to AI surfaces with no exceptions            |
| The AI mark is never the only signal          | Text label required; the glyph is decoration                                        |
| Proposals are semantic regions                | `role="region"` + a heading, so they are navigable                                  |
| Diff rendering is text, not images            | A rendered diff must be selectable, copyable, and screen-reader legible             |
| Announce working/completed/refused state      | `aria-live="polite"` for progress, `assertive` only for a refusal that needs action |
| `prefers-reduced-motion` respected            | AI chrome does not animate anyway (§2.1), so this is nearly free                    |
| Contrast ≥ 4.5:1                              | Including AI accent on AI surfaces, and disabled-but-informative states             |
| Do not encode tier in colour alone            | Icon **and** text; colour is the third signal, never the only one                   |

⚠️ The AI surfaces are new UI. They must be added to the same accessibility
review as any other surface — not grandfathered in.

---

## 8. Internationalisation

**Mandatory.** 30 locale catalogs; device auto-detection; `pnpm i18n:check`
enforces key parity. See `AGENTS.md`, `.claude/rules/frontend.md`,
`.cursor/rules/i18n.mdc`.

| Rule                                                                                                                    | Detail                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🔵 **Zero hardcoded user-facing strings.** Every AI string goes through `next-intl` and is added to **all 30** catalogs | `AGENTS.md` is explicit. This is the most commonly violated rule in AI UI code, because prompts and error strings are written inline                         |
| 🔵 **AI-specific namespaces**                                                                                           | `ai.proposal.*`, `ai.approval.*`, `ai.receipt.*`, `ai.refusal.*`, `ai.state.*`, `ai.suggestion.*`. Error classes map to keys, never to raw provider messages |
| No interpolation of model output into messages                                                                          | A model string may contain `{count}`; if it reaches a template it will break. 🔵 Never place model output in a translation string                            |
| Pluralisation via ICU                                                                                                   | "1 change", "3 changes" — `_one`/`_other` as the catalog requires                                                                                            |
| Longer locales                                                                                                          | German and Finnish expand ~35%. Layouts must not assume English width. 🔵 No fixed-width AI panels                                                           |
| RTL                                                                                                                     | Mirroring must be correct for the diff panel and the proposal list                                                                                           |
| Numbers and dates                                                                                                       | Locale-formatted via the existing `formatters`, not `toLocaleString` ad hoc                                                                                  |
| Currency in cost display                                                                                                | Via the existing currency helper, not a raw symbol                                                                                                           |

🔵 **Translation is a design input for AI UI, not a cleanup task.** A proposal
card whose reason is truncated is a broken proposal in German.

---

## 9. Anti-patterns

| Anti-pattern                                                | Why it is banned                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Confidence percentage                                       | Unfalsifiable, and a signal-leak                                                                         |
| "AI is thinking…" with no detail                            | Says nothing; trust requires legibility                                                                  |
| A trust badge or "powered by AI" seal                       | Trust is earned by behaviour, not by a badge                                                             |
| Animate-in AI text                                          | Implies liveness without it                                                                              |
| Auto-executing a low-risk action without a preview          | The preview is the whole trust model                                                                     |
| A chat transcript as the only record                        | Durable state must be in the system of record                                                            |
| Letting the AI "remember" silently                          | Memories must be visible and deletable ([`AI_OPERATING_SYSTEM_PLAN.md`](AI_OPERATING_SYSTEM_PLAN.md) §8) |
| Streaming an approval-target proposal                       | You cannot approve a partially-arrived change                                                            |
| An avatar, a personality, or a first-person emotional voice | Anthropomorphism produces over-trust                                                                     |
| Empty states that tease AI                                  | Users need capability, not marketing                                                                     |
| Hiding the affected people                                  | Assignment changes are social; name them                                                                 |
| A "skip approval" preference                                | Workspace-wide policy forbids it ([`AI_APPROVALS.md`](AI_APPROVALS.md))                                  |

---

## 10. Compliance checklist

Every AI surface ships only when all are true. Wire this into review.

- [ ] One entry point; no specialist picker
- [ ] Every proposal shows a real diff and a reason
- [ ] Tier is stated in words, not just colour
- [ ] Every factual claim is cited
- [ ] Receipt links back from the modified record and resolves
- [ ] Refusal is visible, explained, and offers an alternative
- [ ] All eight states (§5) designed
- [ ] Revert or an explicit reason it is impossible, in the receipt
- [ ] Budget, scope, and kill switch discoverable within two clicks
- [ ] Keyboard reachable; diff is text; `aria-live` wired
- [ ] Zero hardcoded strings; all 30 catalogs updated; `pnpm i18n:check` passes
- [ ] `info.ai.confidence` and the disclosure modal removed
- [ ] Notification respects `notification_preferences` and quiet hours
- [ ] Lint and typecheck pass; no new `any`, no console noise

Related: [`AI_UX_SIMPLIFICATION.md`](AI_UX_SIMPLIFICATION.md) ·
[`AI_APPROVALS.md`](AI_APPROVALS.md) ·
[`AI_AUDIT.md`](AI_AUDIT.md)
