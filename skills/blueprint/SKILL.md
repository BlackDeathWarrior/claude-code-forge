---
name: blueprint
description: "Plan a build by interview: grill every decision out of you, then have the planner write the spec, task graph and execution contract that /autopilot builds hands-free."
argument-hint: "[what you want built]"
disable-model-invocation: true
---

# Blueprint

Turn `$ARGUMENTS` into a **blueprint**: a plan directory that `/autopilot` builds with nobody watching. `/autopilot` runs this procedure as its Plan phase; typed on its own, `/blueprint` plans now and leaves the build for later. This is the only stage where the user answers anything, so every decision an implementer would otherwise guess gets settled here. This skill is the whole planning process for this run, standing in for any brainstorming or plan-writing skill, and it writes no product code.

**Two tiers plan, and each does what it is priced for.** This session, on whatever model it is running, finds the facts and interviews the user. The `planner` agent, on Opus 5.5 at high effort, does the design: it turns the settled decisions into the spec, the task graph and the contract. The session's model is never changed, and the expensive tier is spent only on the step that needs it.

Keep this session lean. The **code graph** answers structural questions for a few hundred tokens each, so ask it first. **Scouts** do the reading the graph cannot: dispatch `Explore` agents for behaviour inside the code and `runner` agents for commands, in parallel, give each scout the GRAPH path, and take back conclusions, never file contents.

PLAN is `docs/plans/<YYYY-MM-DD>-<slug>/` in the repository. `PLAN/decisions.md` is the interview's record and the planner's only brief: create it in step 1 and write to it as you go, so an interrupted session resumes from it. Four references sit beside this file:

- [PLAN-FORMAT.md](PLAN-FORMAT.md): the format of `decisions.md` and the Contract fields you must settle. Read those two sections at the start of step 1; the rest of the file is the planner's.
- [SKILL-ROUTING.md](SKILL-ROUTING.md): which specialist skill each kind of work gets. Read it during step 1, once the stack is known.
- [STANDARDS-SEED.md](STANDARDS-SEED.md): a coding standards starting point. Read it only when the repository documents no standards of its own.
- [GRAPH.md](../autopilot/GRAPH.md): the code graph's commands and how to read their answers. Read it at the start of step 1 for any repository that already has code.

## 1. Ground

Facts before questions, and facts are your job. Through the graph and scouts, establish:

- **Repository**: greenfield or existing, default branch, clean or dirty tree, a remote and whether `gh auth status` passes.
- **Commands**: the exact install, lint, typecheck, test (full, and one focused test), build and start commands, and whether the full gate is green right now.
- **Rails already there**: CI, pre-commit hooks, `GLOSSARY.md`, ADRs, coding standards, `docs/agents/`.
- **Lessons**: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs" sync` from the repository root. It prints the repository's stack tags and, when earlier builds left any, writes `.autopilot/LESSONS.md`: what went wrong before in this repository, in other projects on the same stack, and on this machine. Read that file. Each line that bears on a Contract field or on how a task should be cut settles it now, and the ones that matter go under Facts for the planner.
- **Codebase shape**, for a repository that already has code: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/graph-refresh.mjs"` from the repository root first. It builds the code graph when there is none and refreshes it when there is, with no model tokens. Then learn the shape from the graph: read `graphify-out/GRAPH_REPORT.md`, run `graphify god-nodes --top 15`, and `graphify query` each area the idea touches. Scouts go only where the graph leaves a question about behaviour.
- **Documents in the graph**: when the repository's specs, ADRs or design docs matter to this build and the graph holds only code, tell the user once that `/graphify . --update` would add them, at a cost in model tokens, and carry on either way.
- **Tools on this machine**: `codex` (a second model family for the final review), a browser tool (QA of a web app), `tmux` (QA of a terminal app).
- **Specialist skills**: match the stack (each database engine, the UI layer, charts, LLM calls, document formats) against the session's skill listing using SKILL-ROUTING.md. List the skills that will be routed to, and every domain in the stack that has none.

Write all of it under **Facts** in `decisions.md`. Done when every Contract field that is a fact has a value there, and every domain in the stack is either matched to a skill or listed as a gap.

## 2. Grill

Call the Skill tool with `grilling` and run it on the idea until its frontier is empty. The design tree has these roots; work each to its leaves:

1. **Problem and users**: who has it, and what done looks like to them.
2. **Scope**: what is in, and what is explicitly out.
3. **Behaviour**: every user story, with its unhappy paths (bad input, empty state, failure midway, the same action twice).
4. **Shape**: modules and their interfaces, data model, API contracts, what existing code is reused.
5. **Interface**, when there is a UI: screens, states, look and feel.
6. **Dependencies**: each new package or service.
7. **Testing seams**: where behaviour is tested, and which critical user flows get an end-to-end test that stays in the repository. Prefer existing seams and the highest seam possible.
8. **Standards**: what the code is held to. A repository with no standards document gets one from STANDARDS-SEED.md, each line kept, changed or struck by the user.
9. **Specialists**: each skill gap from step 1, resolved the way SKILL-ROUTING.md says, and whether the build gets a security review (recommend yes when it touches authentication, payments, personal data, file upload, or input from outside).
10. **Contract**: every Contract field that is a decision, recommending a value for each from the facts of step 1.

Reach for a skill where its branch comes up:

- A UI: call the Skill tool with the design skills SKILL-ROUTING.md routes to (`refero-design`, and `impeccable` when installed) and do the research now, ending in a **Design Lock** the user approves. A look or a state model that words cannot settle: `prototype`.
- A data model: call the Skill tool with the engine's skill (`planetscale:postgres`, `planetscale:mysql`) before settling schema, keys and indexes, so the plan starts from the engine's own practice.
- A fuzzy or overloaded term, or a hard-to-reverse decision worth an ADR: `domain-modeling`.
- A module's shape or where a seam belongs: `codebase-design`.
- A fact that lives in external docs: `research`.
- A new package: `supermatt:dependency-vetting`, before it enters the Contract.

After every round, write what was settled into `decisions.md`, in the user's own words where they gave exact values. An answer of "your call" is recorded as **delegated**, for the planner to decide.

Done when the frontier is empty, the user confirms the shared understanding, and `decisions.md` holds every answer.

## 3. Draft the plan

Dispatch one `planner` with the absolute PLAN path, the GRAPH path when there is a graph, and the LESSONS path when that file exists. Wait for its report.

- `NEEDS_DECISIONS`: put its questions to the user as one more round of step 2, with its recommended answers, write the answers into `decisions.md`, and send them to the same planner as ANSWERS (a message to the agent that is still holding its context, or a fresh dispatch when that is not possible).
- `DRAFTED`: the spec, the tasks and `plan.md` are on disk with `Status: draft`.

## 4. Audit in a fresh context

The planner wrote the plan, so it shares the plan's blind spots. Dispatch one `reviewer` with this AUDIT brief and the PLAN path:

> Report: (a) places the spec contradicts itself, contradicts decisions.md, or a task contradicts the spec; (b) user stories no task's acceptance criteria cover; (c) decisions the current codebase cannot support as written, citing the file; (d) acceptance criteria no command or observation could check; (e) two tasks with no blocking edge between them that touch the same module; (f) an interface a task consumes that no task produces, or whose name or type differs between tasks; (g) anything an implementer would have to guess. Quote the line for each finding. Under 400 words.

A finding with one clear fix goes back to the planner as FINDINGS. A finding that needs a decision goes to the user as another round of step 2 first.

## 5. Approve and hand off

Show the user the goal in one sentence, the Task graph, the Contract, and every Delegated decision from the planner's report, and ask whether to approve or change the plan. This approval is the last thing the build asks of them, so a change here loops back to the step it touches.

Once approved, set `Status` in `plan.md` to `approved <YYYY-MM-DD>`. When `/autopilot` is running this procedure, planning is done: return to it, and it builds next. Typed on its own, end with exactly this, the path filled in:

```
Blueprint approved: <PLAN>
Build it hands-free, now or later, with: /autopilot <PLAN>
```
