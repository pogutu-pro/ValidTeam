# ValidTeam AI — vision

**Status:** the north star. Everything else in `docs/ai/` is an elaboration of
this document.

---

## 1. The idea in one paragraph

> ValidTeam's AI is **one colleague who knows the work**, not a feature you switch
> on. It is present where the work happens, it understands the shape of a project,
> it **proposes** rather than acts, and every action it takes can be reviewed,
> approved, attributed, and undone. It is competent enough to be useful and
> bounded enough to be trusted.

---

## 2. Why now

ValidTeam already has the hard parts. Nobody has connected them.

| Already built                                                                | What it makes possible                                         |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| The permissions system — roles, permissions, capability access, tenancy      | The AI can be given _exactly_ a human's authority, and no more |
| The workflow engine — states, transitions, role gates, row locks             | Actions obey the same rules the product obeys                  |
| The agent runtime — a bounded graph, leases, checkpoints, resumability, SSE  | Long work survives a deploy, a crash, or a slow request        |
| The approval machinery — policy, requests, an effect outbox                  | Nothing consequential happens without a human in the loop      |
| The audit log — an enum that already anticipates AI actions                  | Every AI change can be attributed before it happens            |
| Token budgets, a kill switch, a global agent control                         | Autonomy is already possible to bound                          |
| Real data — issues, sprints, documents, analytics, activity, status history  | The AI can reason over the whole workspace, not a toy subset   |
| The research graph, capacity schema, batch pipeline, PII redaction, Langfuse | Capabilities that exist and are unused                         |

**The gap is not intelligence. The gap is a shared substrate and a trust
surface.** ValidTeam's AI can answer, and in two narrow places it can propose. It
cannot hold a thread, choose a governed action from a catalogue, remember
anything, or keep working after the request ends.

So this is a programme of **activation and unification**, not invention.

---

## 3. The conceptual model

```text
                     ┌───────────────────────────────────┐
                     │        ONE AI SURFACE             │
                     │   ask · propose · approve · trace │
                     └────────────────┬──────────────────┘
                                      │ intent
                     ┌────────────────▼──────────────────┐
                     │            ROUTER                 │
                     └────────────────┬──────────────────┘
        ┌──────────────┬──────────────┼──────────────┬──────────────┐
        ▼              ▼              ▼              ▼              ▼
     Task Agent   Project Agent  Monitoring     Knowledge      Automation
                                  Agent           Agent          Agent
        └──────────────┴──────────────┴──────────────┴──────────────┘
                                      │ tools only
                     ┌────────────────▼──────────────────┐
                     │        TOOL CATALOGUE            │
                     │   tier · bound · zod · approvable │
                     └────────────────┬──────────────────┘
                                      │ calls existing services
        ┌──────────────┬──────────────┼──────────────┬──────────────┐
        ▼              ▼              ▼              ▼              ▼
      Issues       Workflows      Documents       Analytics     Automations
        └──────────────┴──────────────┴──────────────┴──────────────┘
                                      │ every mutation
                     ┌────────────────▼──────────────────┐
                     │  authorization · receipt · audit   │
                     │   the SAME code path as a human    │
                     └───────────────────────────────────┘
```

**Six ideas carry the whole design.**

| #   | Idea                              | Consequence                                                                                                              |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | **One AI, many specialities**     | The user learns one place to go; the complexity stays where it can be tested                                             |
| 2   | **The AI acts as the human**      | No AI principal, no AI permissions, no AI authority to audit. It borrows a person's authority, re-derived per invocation |
| 3   | **Propose, never surprise**       | Every consequential action is previewed first. Trust is earned before it is asked for                                    |
| 4   | **Everything is tool-shaped**     | A capability is real only if a model can call it through a governed catalogue with a tier, a bound, and a schema         |
| 5   | **Same code path as a human**     | Tools call the same services the routes call. Never a parallel implementation of a rule                                  |
| 6   | **Every action leaves a receipt** | What changed, who authorised it, under which policy, with which model, at what cost — and how to undo it                 |

---

## 4. What it feels like

```text
Tuesday. Priya opens Project Orion and asks: "prep the release".

The AI reads six issues, two blockers, and the release checklist.

"One paragraph, three proposals, one question."

  → Move TN-455 to Sprint 13          (because Friday is close)
  → Reassign TN-471 Sam → Priya       (Sam is 4 issues deep, Priya has room)
  → Label TN-460 at-risk              (blocked 9 days)

She approves two. Adjusts one. Dismisses nothing.
Each approved change lands with a receipt.
TN-460 now links back to the run that touched it.

Later: "track this as a goal until Friday."
Later still: the AI tells her — once — that TN-401 closed and the release is on track.
```

No modal she has to accept. No magic. No surprises. **A colleague who did the
reading and told her what it means.**

---

## 5. Principles

1. **Trust before capability.** Fix the trust surface before shipping the next
   capability. Always.
2. **One surface.** Seven AI entry points is a bug, not a feature set.
3. **Authority is a ceiling, never a grant.** Autopilot and policies may only
   _narrow_ what a human could do.
4. **Explainability is a feature.** Rationale, evidence, and citations are
   first-class, not a debug panel.
5. **Steady state is quiet.** A digest, not a stream of notifications.
6. **Honest failure.** Refusal and error are stated, with an alternative.
7. **The system of record is not the AI.** Durable state lives in issues,
   documents, and audit rows.
8. **Dormant assets get a decision.** Existing capability is wired or deleted —
   never duplicated by something new.
9. **Unenforced controls get deleted.** A security setting that does nothing is
   worse than none, because users trust it.
10. **Design for the 30th locale.** Every string is translated from day one.

---

## 6. What it is not

| Not this                                    | Why                                                 |
| ------------------------------------------- | --------------------------------------------------- |
| A chatbot                                   | It acts on the work, not just discusses it          |
| A new microservice                          | The runtime exists and is disciplined               |
| An autopilot on day one                     | Autonomy multiplies whatever the default is         |
| A second permission system                  | Extend what exists                                  |
| A fine-tuned model                          | Data would leave the platform for no proven benefit |
| A feature with a trust model invented later | Approval and audit are architecture, not polish     |
| Magic                                       | Competent, bounded, explainable                     |

---

## 7. How we know it worked

1. **One place.** A user asks for AI help in exactly one place and gets it.
2. **No surprises.** Every change is previewed, receipted, and usually reversible.
3. **Bounded.** The user can see, at any moment, what the AI can reach and what
   it has spent.
4. **Honest.** Refusals are visible; citations resolve or say they do not.
5. **Attributeable.** Any AI change answers "who authorised this, why, at what
   cost".
6. **Quiet.** The AI speaks when it matters.
7. **Defensible.** No capability exists without a permission tier, a preview, and
   an audit row.

---

## 8. Where the detail lives

```text
CURRENT_AI_CAPABILITIES.md          What is true today (audited, 2026-10-05)
        │
        ├── AI_OPERATING_SYSTEM_PLAN.md    The architecture: surface, router,
        │                                    specialists, tools, goals, memory
        │         │
        │         ├── AI_PERMISSIONS.md   Authority, tiers, tenancy
        │         ├── AI_APPROVALS.md                 When a human says yes
        │         ├── AI_SECURITY.md                  How it gets attacked
        │         ├── AI_AUDIT.md             How it stays accountable
        │         ├── AI_MODEL_STRATEGY.md            Providers, routing, cost
        │         │
        ├── AI_UX_SIMPLIFICATION.md        What we remove and why
        │         └── AI_UX.md             How it looks, sounds, and behaves
        │
        ├── AUTONOMOUS_WORKFLOWS.md       Schedules, monitors, goals, rules
        │
        ├── AI_FEATURE_MATRIX.md          Every capability, one row each
        │
        ├── AI_IMPLEMENTATION_ROADMAP.md  Phases 0–8 and their gates
        │
        └── AI_VISION.md                  This document
```

**Read in that order if you are new.** If you are auditing the current state,
start with [`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md). If you are
building, start with the [roadmap](AI_IMPLEMENTATION_ROADMAP.md) and obey its
gates.

---

## 9. The one-sentence version

> **One AI that knows the work, proposes before it acts, and can always explain,
> be questioned, and be reversed.**
