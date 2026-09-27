# TaskNebula Product Design

This document records product intent and the review loop for TaskNebula's web
interface. `DESIGN_SYSTEM.md` remains the token and component contract; this
file explains how those pieces compose into pages and how the result is proven.

## Product intent

TaskNebula is a calm, dense workspace for engineers, product teams, and
operators who spend hours in the product. It should feel fast, architectural,
and trustworthy:

- The work is visually louder than the navigation around it.
- Typography and spacing create hierarchy before color, borders, or shadows.
- One blue primary accent communicates action. Semantic colors communicate
  state; they are not decoration.
- Screens are compact enough for power users without turning into a wall of
  equal-weight controls.
- AI is an accountable collaborator in the workflow, not a visual theme.

The interface must not resemble a generic generated dashboard. Avoid equal
grids of interchangeable cards, gradient headings, ornamental icon tiles,
oversized radii, excessive badges, fake precision, and copy that merely
restates a heading.

## Product signature

TaskNebula's distinctive visual language is **work topology**, not outer-space
decoration. When a relationship helps someone act, the interface can expose the
accountable path:

```text
request -> issue -> plan -> agent or person -> review -> release
```

Use that path as a quiet evidence rail, dependency line, activity sequence, or
release trace. It must show real state and ownership; it must not become a
background constellation, glowing node cloud, or ornamental graph.

The recurring visual signature is:

- A stable identifier and current state at the leading edge.
- One primary work surface in the middle.
- Ownership, provenance, and the next handoff in a quieter evidence rail.
- Thin orthogonal connectors only when they explain a dependency or sequence.
- Monospaced text for identifiers and machine evidence, not entire interfaces.

## Workbench 2026 direction

The application shell is a workbench, not a marketing frame. It separates
three layers without making them compete:

1. **Global rail** — quiet, icon-led access to the workspace-level tools a
   person uses repeatedly.
2. **Context panel** — the current workspace, project, team, saved view, or
   settings scope and its local navigation.
3. **Work canvas** — the only visually dominant surface; headers, view controls,
   data, detail, and evidence align to one content grid.

The rail may be dark so it remains a stable location cue. The context panel and
command bar use the same neutral surface family as the canvas and must not form
a second competing application. Navigation labels, counts, and controls recede
until they are active, focused, or needed.

This direction synthesizes current product-management interaction principles;
it is not a visual copy of another product. TaskNebula keeps IBM Plex,
square-ish geometry, the single action blue, and its accountable work-topology
signature. Competitor assets, wording, proprietary icons, brand color systems,
and one-to-one shell anatomy are never implementation references.

## Agentic workbench operating model

TaskNebula is not made agentic by placing a chat window beside every page.
Agents participate in the same accountable work graph as people. The interface
therefore optimizes for supervision, judgment, and handoff:

```text
attention
  -> human owner and delegated contributor
    -> bounded run or proposal
      -> evidence and proposed effects
        -> review or requested input
          -> durable apply, retry, cancel, revert, or end
```

The dashboard's primary question is **what needs judgment now?** Its dominant
surface is an attention queue, not a grid of unrelated widgets. Human-owned
work, blocked or overdue work, agent questions, approval requests, and failed
runs may enter that queue when the product has real evidence for them. They are
ranked with understandable state and priority rules; the interface must not
invent a confidence score or fake precision.

Agents remain attached to the records they affect:

- A human assignee remains accountable when an issue is delegated to an agent.
- Agent activity is attributable and filterable in the same issue, project,
  inbox, and activity views used for human work.
- “Running,” “waiting for input,” “proposed,” “approval required,” “applying,”
  “applied,” “failed,” “cancelled,” and “reverted” are distinct states.
- A review queue contains decisions, not generic notifications. It exposes the
  scope, evidence, effects, risk or policy reason, and the next valid action.
- A conversation may initiate or explain work, but the work item, proposal,
  approval, run, effect, and audit record remain the durable product objects.

The shell supports this model with one global command surface and clear scope.
Search, create, agent invocation, and navigation share predictable access,
while route-local filters remain attached to the data they affect. A
collapsible context panel may expose project, teamspace, saved-view, settings,
or agent-run scope, but it must not become a fourth competing navigation system.

## Audience and decisions

The default user is an operator on a desktop or laptop asking a 60-second
question: **what needs action now?**

Secondary users are:

- Leads checking whether a project is on track.
- Analysts explaining why flow or delivery changed.
- Administrators configuring a workspace safely.
- Contributors using a public intake, trust, shared document, or auth flow.

Pages should make the primary decision obvious before presenting supporting
metadata.

## Page archetypes

Every route should fit one archetype. New routes must select an archetype before
markup is written.

### Command

Examples: My Issues, Inbox, Backlog, Board, Drafts.

- The queue, board, or table is the dominant surface.
- Filters and bulk actions stay compact and close to the data they affect.
- Rows are keyboard reachable and preserve context on hover or focus.
- Summary metrics, when useful, occupy one compact strip rather than a bento
  grid.

### Overview

Examples: Dashboard, Projects, Project home, Sprint overview.

- One hero answer or next action wins the squint test.
- Supporting metrics are visibly subordinate.
- At least three content types may appear above the fold, but they must not all
  have equal weight.
- Comparisons are plain secondary text; status is a dot or concise label.

### Analysis

Examples: Project analytics, Roadmap.

- The time range or comparison scope is explicit.
- Charts use the simplest correct encoding and direct labels where practical.
- Numerals use tabular figures and precision matches the decision.
- Loading skeletons preserve the geometry of the eventual chart or table.

### Detail

Examples: Issue detail, Initiative detail, Sprint detail, Project docs.

- Identity and current state precede secondary metadata.
- The primary action remains stable across view states.
- Related information is grouped by proximity, not nested cards.
- Long-form content keeps a readable line length.

### Configuration

Examples: Organization, Members, Integrations, Notifications, Project settings.

- One setting group answers one question.
- Tabs switch sibling views and mirror the URL; unrelated destinations use
  navigation.
- Explanatory copy is short and appears beside the decision it informs.
- Save, destructive, success, and permission states are explicit.

### Public evidence

Examples: Trust Center, AI Model Cards, shared documents, public intake.

- Editorial reading rhythm takes precedence over app density.
- A compact public header makes ownership and escape routes obvious.
- Claims are specific and attributable; compliance and AI disclosures use real
  state rather than marketing language.
- Tables become stacked key/value rows on narrow screens.

### Auth and setup

Examples: Sign in, sign up, password recovery, first-run setup.

- The form remains 360–400px wide and the submit action wins the squint test.
- The supporting panel shows one honest product proof, not decorative artwork.
- Errors appear with the affected operation and a next step.
- The complete flow survives at 320px without horizontal scrolling.

### Recovery and status

Examples: offline, authentication error, unavailable shared resource.

- State is named in a semantic heading before technical detail.
- One working recovery action is primary; an escape route is secondary.
- Retry preserves the user's context and reports pending or repeated failure.
- The page has `main`, heading, and status semantics even when application data
  is unavailable.

## Route coverage contract

[`design-route-manifest.json`](design-route-manifest.json) maps every
`src/app/**/page.tsx` to one archetype and one primary user decision. It is the
machine-readable surface inventory, not a claim that screenshots have already
been reviewed.

`pnpm ui:check` fails when a page is added, removed, duplicated, or left without
an archetype and decision. A route change therefore starts by updating the
contract, then implementing and checking the applicable evidence matrix:

- desktop and mobile, light and dark;
- keyboard and pointer;
- loading or pending;
- empty or unavailable;
- error or recovery.

Authenticated flows also require the correct role and a safe fixture before
browser evidence can be accepted. Never weaken authentication or operate on
real user data to manufacture a screenshot.

## Composition contract

For each viewport, name these four levels before polishing:

1. **Primary** — the decision, queue, content, or action the page exists for.
2. **Secondary** — context required to act on the primary.
3. **Tertiary** — navigation, filters, and supporting metadata.
4. **Quaternary** — timestamps, identifiers, and low-frequency controls.

Adjacent levels must differ clearly in size, weight, contrast, surface area, or
position. A page with two competing primary elements is unfinished.

Use these structural defaults:

- App content padding: 16px at dense/mobile widths, 20–24px on desktop.
- App headers: compact, border-light, and aligned with their content column.
- List/table rows: 40–48px unless the content genuinely needs more.
- Section spacing must be larger than spacing within the section.
- Empty states contain one explanation and at most one primary action.
- Icons come from Lucide, share a consistent size in a row, and are removed when
  the label already carries the meaning.

## Global shell and scope contract

- Global, organization, teamspace, project, and personal scope are visibly
  distinct. A create, search, agent, or settings action must expose the scope it
  will affect whenever ambiguity could cause a wrong write.
- The global rail contains destinations, not miniature labels. Accessible names
  and tooltips carry the full destination; the context panel carries readable
  local navigation.
- Project navigation has one canonical location. Do not repeat the same target
  in the rail, context panel, page header, and content as equally prominent
  controls.
- Search, navigation, create, and contextual actions share the command surface.
  Keyboard, pointer, and touch users reach the same authorized actions.
- The work canvas may be inset from desktop chrome to clarify ownership, but it
  becomes edge-to-edge on small screens. Chrome must never reduce the usable
  mobile width below the route's content contract.

## View-state contract

List and board are the primary work-item views. Timeline is added where time or
dependencies are the actual decision. All supported views share one vocabulary
for filter, grouping, ordering, visible fields, and density:

- State that should survive refresh, Back, or sharing lives in the URL.
- Personal display preferences may override a view default without silently
  changing the shared view for everyone.
- Sticky group headers preserve scope while scrolling. Counts and estimates are
  secondary evidence, not decorative badges.
- Compact mode removes optional card metadata before reducing target size or
  hiding state. A preview or detail surface carries the complete record.
- Empty groups, completed work, and secondary fields are explicit display
  choices; they are not inconsistently hidden by individual routes.

## Detail reveal contract

One record may be revealed at three depths without becoming three unrelated
implementations:

1. **Preview** — a keyboard- and pointer-triggered glance that never contains a
   critical action available nowhere else.
2. **Context detail** — a side sheet or split pane that preserves the current
   list/board position for triage and editing.
3. **Canonical page** — the durable URL for long editing, audit history,
   collaboration, and deep linking.

The same validation, permissions, fields, and mutation contracts apply at every
depth. Focus returns to the invoking row/card after context detail closes. On
mobile, context detail recomposes as a full-screen surface rather than a narrow
desktop drawer.

## Responsive recomposition matrix

| Surface        | Desktop                            | Tablet / narrow desktop                           | 320–390px mobile                                                 |
| -------------- | ---------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| Global shell   | rail + context panel + canvas      | collapsible context panel                         | compact top/bottom navigation + edge-to-edge canvas              |
| List/table     | persistent key columns and toolbar | lower-priority columns collapse                   | stacked rows or intentional horizontal region with a visible cue |
| Board/timeline | multi-column working surface       | fewer visible lanes, controlled horizontal scroll | list fallback or touch-safe horizontal surface; no clipped cards |
| Context detail | side sheet or split pane           | wider overlay sheet                               | full-screen surface with explicit back/close                     |
| Actions        | inline toolbar                     | overflow menu after primary action                | 44px primary touch targets; no hover-only action                 |

Every shell or layout change is checked at 320px and 390px, 200% zoom, a
relevant RTL locale, light and dark color modes, keyboard input, and reduced
motion. Responsive work means recomposition, not shrinking the desktop until it
technically fits.

## Premium behavior bar

Polish is not an effect layer. The interface earns a premium feel when location,
response, and recovery remain predictable:

- Tabs, filters, sort, density, and selected views use the URL when the state
  should survive refresh, sharing, or Back.
- Focus is placed after navigation or validation, returns after dialogs close,
  and is never trapped behind an overlay.
- Async actions show pending state immediately, prevent accidental duplicate
  submission, and end in a visible success or actionable error state.
- Optimistic changes either persist or expose undo/retry; the interface never
  simulates success.
- Low-frequency row controls appear on hover and focus without shifting content
  or hiding the same actions from touch and keyboard users.
- Tables and boards keep headers and identifiers legible while scrolling.
- AI output exposes source, scope, author, review state, and apply/revert
  behavior wherever those facts affect trust.
- Layout does not flash, jump, clip, or replace real geometry with an unrelated
  skeleton.

## Operational flow contracts

The UI must expose the same gates that the backend enforces. A configuration
control is unfinished when it only stores metadata or changes presentation.

### Workflow transition

```text
current state
  -> allowed edge
    -> condition and validator
      -> role and approval policy
        -> atomic transition
          -> post-action and history
            -> retry, recovery, or stable end state
```

- Every status mutation—single edit, board drag, bulk action, automation, and
  agent webhook—uses the same transition decision.
- A forbidden edge cannot be made to work through a different UI surface.
- Pending approval, validation failure, partial failure, recovery, and final
  state are visibly distinct.
- Editing a transition and reloading must preserve every enforced property; a
  field shown only in local UI state is not a feature.

### Agent mutation

```text
scope and policy
  -> bounded plan or preview
    -> attributable proposed effects
      -> human approval when required
        -> idempotent atomic apply
          -> evidence and audit
            -> review, retry, revert, cancel, or end
```

- Before approval, a write-capable run produces zero project mutations.
- Source scope, model/config revision, budget, run/step identity, review state,
  and proposed effects remain attributable.
- Apply, retry, timeout, cancellation, and double submission cannot duplicate
  an effect.
- “Generated,” “approved,” “applied,” “rejected,” “failed,” and “reverted” are
  different states, not one success-colored badge.
- Research output distinguishes retrieved sources, cited claims, unresolved
  claims, and human review. Workspace RAG must not be labeled deep research
  unless it has the complete multi-step provenance flow.

### AI proposal and run surface

AI is presented as an attributable work object, not a decorative chat layer.
Where the runtime provides the information, a proposal or run exposes scope,
source coverage, model/config revision, budget, rationale, effects, approval,
apply/revert state, cancellation/resume, and audit history. The UI must not
invent confidence or imply an effect was applied before the durable runtime
confirms it.

The TaskNebula-specific representation is the evidence path:

```text
request -> evidence -> plan -> proposed effect -> review -> apply -> release
```

Each node is addressable and each transition has a real state. A loop back to
evidence, planning, retry, or review is visible and bounded rather than rendered
as an endless spinner.

The runtime maturity and termination contract live in
[`docs/AGENT_RUNTIME.md`](../../docs/AGENT_RUNTIME.md). Product surfaces must
not imply that a planned durability or approval stage is already wired.

## Anti-slop acceptance bar

A product surface is ready only when all applicable checks pass:

- The squint test produces one focal point.
- A single primary accent has at most five prominent placements in the initial
  viewport.
- There is no equal-weight grid of generic feature/stat cards.
- Structure is readable with fewer, softer separators.
- Navigation is quieter than content.
- Generic cards use `rounded-lg`; controls use `rounded-md`; pills and status
  chips use `rounded-sm` or a true circular treatment.
- Decorative gradients do not appear in authenticated product UI.
- Every visible control completes a real action or navigates to a real route;
  logging a click, simulating success, or linking to an unpublished target does
  not count as an implementation.
- Every numeric comparison uses `tabular-nums`.
- Idle, loading, empty, error, and permission-denied states are intentional;
  conflict/offline/success states are added where the interaction can produce
  them.
- Focus order is logical, focus is visible, and motion remains useful with
  `prefers-reduced-motion`.
- Mobile behavior is checked at 320px and 390px, not inferred from desktop.
- Dark and light modes both use the semantic token system.
- Transitions name the properties they animate; product UI does not use
  `transition-all`.
- A badge is earned by status or compact metadata. It is not a default container
  for every label, filter, and count.
- Automation and AI evidence stays attributable: generated, reviewed, applied,
  reverted, and failed are visibly different states.

## Design graph

Changes should flow through the smallest shared node that owns the decision:

```text
DESIGN.md (intent)
  -> design-route-manifest.json (surface + decision)
    -> DESIGN_SYSTEM.md (tokens and primitives)
      -> src/components/ui (reusable mechanics)
        -> layout and domain components (page patterns)
          -> route pages (content and data)
            -> loading / empty / error / offline states
              -> static + browser evidence
```

Do not patch dozens of route leaves when a shared primitive is the actual
owner. Do not push a one-off page preference into a global primitive.

This is a traceability graph, not a reason to add an orchestration framework.
Cycles belong in the review process: evidence can send a change back to the
smallest owning node until the acceptance bar passes.

## Engineering loop

The design loop is evidence-driven and converges one high-impact problem at a
time:

1. Inventory the route and its states.
2. Capture desktop and mobile screenshots in light and dark mode.
3. Name the hierarchy and the user decision.
4. Fix the highest-impact hierarchy or composition issue.
5. Re-run the full acceptance bar from the first check.
6. Run the executable quality gates.
7. Drive the route's real task with keyboard and pointer input.
8. Verify URL, persistence, focus return, and recovery behavior.
9. Compare screenshots and record any accepted minor issue.

The loop is bounded to three maker/checker cycles per surface batch. Each cycle
fixes the highest-severity unresolved problem at the smallest owning node, then
restarts the hard gates. End only when no high/medium finding remains. If a
product decision or design-system conflict remains after the third cycle, stop
with structured evidence instead of silently changing the acceptance bar.

Use a maker/checker split for broad work: the implementing agent must not be
the only reviewer of its screenshots or acceptance-bar result. The checker
returns route, state, viewport, evidence, severity, and confidence—not a single
unexplained “taste score.”

## Executable harness

Run from the repository root:

```bash
pnpm ui:check
pnpm i18n:check
pnpm --filter @tasknebula/web type-check
pnpm --filter @tasknebula/web lint
pnpm --filter @tasknebula/web test
pnpm --filter @tasknebula/web tests:e2e:public
```

`pnpm ui:check` enforces deterministic design invariants that are safe to check
statically, including complete route-manifest coverage. Browser review remains
mandatory because hierarchy, rhythm, accessibility-tree behavior, persistence,
and responsive composition cannot be proven by source scanning alone.

## Research basis

- Impeccable,
  [site](https://impeccable.style/#worlds) and
  [open-source repository](https://github.com/pbakaus/impeccable) (reviewed
  2026-08-20): define the surface mode before designing, preserve the incumbent
  token/component system, remove unearned complexity, and combine deterministic
  anti-pattern checks with rendered judgment. Its visual world is not a
  TaskNebula implementation reference.

- Linear,
  [“A calmer interface for a product in motion”](https://linear.app/now/behind-the-latest-design-refresh)
  (2026): recede navigation, reduce icon treatments, and let softened structure
  support the work.
- Notion,
  [“Updating the design of Notion pages”](https://www.notion.com/blog/updating-the-design-of-notion-pages)
  (2026): spacing responds to neighboring content so lists cluster while prose
  breathes.
- Raycast,
  [“A technical deep dive into the new Raycast”](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast)
  (2026): polish is behavior as much as styling; flicker, clipping, keyboard
  behavior, and platform conventions are product quality.
- Vercel, [Web Interface Guidelines](https://vercel.com/design/guidelines):
  interaction, accessibility, focus, content, and performance form one finish
  bar.
- OpenAI,
  [“Harness engineering”](https://openai.com/index/harness-engineering/)
  (2026): repository-local intent, custom linters, browser legibility, and
  recurring garbage collection turn taste into a compounding system.
- Vercel,
  [“Teaching agents product design at Vercel”](https://vercel.com/blog/teaching-agents-product-design-at-vercel)
  (June 2026): durable product judgment, executable rules, and evidence intake
  make design decisions legible to agents instead of leaving taste in chat.
- Atlassian,
  [June](https://confluence.atlassian.com/cloud/blog/2026/06/atlassian-cloud-changes-jun-1-to-jun-8-2026)
  and [July](https://confluence.atlassian.com/cloud/blog/2026/07/atlassian-cloud-changes-jul-6-to-jul-13-2026)
  2026 Jira changes: customizable collapsible navigation, harmonized board
  layouts, and a work-item field refresh prioritize orientation and less visual
  clutter.
- Plane,
  [Navigation 2.0](https://plane.so/blog/introducing-plane-navigation-2),
  [agentic workflows](https://plane.so/blog/how-modern-teams-run-agentic-workflows-in-plane),
  and [AI actions](https://plane.so/blog/introducing-plane-ai-actions): global
  versus project context, collapsible chrome, stateful work records, explicit
  approvals, and activity trails inform scope and supervision without supplying
  a visual template.
- Atlassian,
  [Jira Summer 2026](https://www.atlassian.com/blog/development/jira-summer-release)
  and
  [current Jira navigation](https://support.atlassian.com/jira-software-cloud/docs/what-is-the-new-navigation-in-jira/):
  customizable chrome, rebuilt work views, and agent-readable work objects
  reinforce the separation between navigation, command utilities, and work.
- Linear,
  [agents](https://linear.app/docs/agents-in-linear) and
  [assignment/delegation](https://linear.app/docs/assigning-issues): agent
  delegation does not remove human accountability, and agent contribution stays
  visible in ordinary issue, inbox, search, and insight surfaces.
- OpenAI,
  [Codex app](https://openai.com/index/introducing-the-codex-app/) (2026):
  project-grouped long-running threads, isolated parallel work, in-context diff
  review, and a review queue inform the supervision model.
- Devin,
  [2026 release notes](https://docs.devin.ai/release-notes/2026): nested child
  sessions, focus mode, waiting status, inline work logs, test evidence, and
  review progress inform long-running run legibility.
- Notion,
  [Custom Agents](https://www.notion.com/help/custom-agents): explicit triggers,
  tools/access, model choice, activity, permissions, and version history inform
  configuration and governance surfaces.
- Atlassian,
  [Rovo walkthrough](https://www.atlassian.com/software/rovo/guides/admin-guide/rovo-walkthrough):
  agent profiles expose creator, instructions, knowledge, actions, and starting
  tasks before a user invokes them.
- GitHub,
  [Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects)
  and [June 2026 adjustable row heights](https://github.blog/changelog/2026-06-25-saved-views-for-repository-issues-and-adjustable-row-heights-in-projects/):
  the same data supports table, board, roadmap, saved views, and user-selected
  density.
- Google Labs,
  [“Introducing DESIGN.md”](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/)
  (2026): explicit visual intent makes implementation constraints portable
  across tools and sessions.
- Anthropic,
  [“Effective harnesses for long-running agents”](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents):
  structured completion criteria, incremental progress, and real browser
  testing make long-running implementation more reliable.
- Playwright,
  [ARIA snapshots](https://playwright.dev/docs/aria-snapshots) and
  [visual comparisons](https://playwright.dev/docs/test-snapshots): behavior and
  accessibility evidence complement screenshots; pixel baselines remain
  environment-sensitive.
- [`ibelick/ui-skills`](https://github.com/ibelick/ui-skills) and
  [`Nutlope/hallmark`](https://github.com/Nutlope/hallmark): current
  community-maintained anti-slop checks informed the emphasis on hierarchy,
  restrained surfaces, and interaction finish.
- [`educlopez/ui-craft`](https://github.com/educlopez/ui-craft): measurable
  anti-slop and finish-bar checks informed the static gate and visual acceptance
  bar above.
