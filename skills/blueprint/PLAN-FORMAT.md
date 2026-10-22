# Plan format

The files of a plan directory. The interviewing session writes `decisions.md`; the `planner` reads it and writes `spec.md`, `plan.md` and `tasks/`; the `conductor` builds from those three. A plan is the set of decisions an implementer cannot make alone: names, interfaces, exact values, proofs. Function bodies are theirs to write.

## decisions.md

The interview's record and the planner's only brief. Written as the interview goes, so it is also how an interrupted session resumes. Record answers, never the conversation.

<decisions-template>

# <Feature>: decisions

## Idea

What the user asked for, in their own words.

## Facts

What step 1 established, one line each: repository state and default branch; the exact install, lint, typecheck, test, focused-test, build and start commands; whether the gate is green now and at which commit; CI, pre-commit, glossary, ADRs, standards documents; whether there is a code graph; tools on this machine (`codex`, a browser tool, `tmux`); the installed specialist skills that match the stack, and each domain with none; lessons from earlier builds that apply.

## Decisions

Numbered, one per decision, grouped under the design tree's roots (Problem and users, Scope, Behaviour, Shape, Interface, Dependencies, Testing seams, Standards, Specialists). Each line is the question and the answer, with exact values (names, copy, limits, status codes) verbatim. Mark a decision the user handed over as **delegated**.

## Design Lock

Only when there is a UI: the references chosen and the locked values the user approved.

## Contract

A value for every Contract field below that the user decided or step 1 established. Leave the task-shaped fields (`Lanes`, `Shared resources`) to the planner unless the user fixed them.

## Out of scope

What the user said this build leaves alone.

</decisions-template>

## spec.md

<spec-template>

# <Feature>: spec

## Problem

The problem, from the user's perspective.

## Solution

The solution, from the user's perspective.

## User stories

A long numbered list covering every aspect of the feature, unhappy paths included:

1. As a <actor>, I want <feature>, so that <benefit>

## Implementation decisions

Modules built or modified and their interfaces, schema changes, API contracts, architectural choices, specific interactions. Exact names and types. When a provider and consumer evolve separately, name the one authoritative contract and its owner.

## Testing decisions

- **Seams under test**, as agreed with the user. Implementers test at these seams and no others.
- What a good test is here: external behaviour through a public interface.
- Prior art: existing tests of the same kind, by path.

## Design Lock

Only when there is a UI. The references chosen and what is taken from each, then the locked decisions: type scale, colour tokens, spacing scale, component inventory, each screen's states, responsive rules, motion, copy tone. Exact values.

## Delegated

Each decision the user handed over ("your call"), with what was decided and why.

## Out of scope

What this build leaves alone.

</spec-template>

## plan.md

<plan-template>

# <Feature>: plan

**Status:** draft | approved <YYYY-MM-DD>
**Goal:** <one sentence>
**Spec:** [spec.md](spec.md)
**Build:** `/autopilot <this directory>`

## Contract

| Field | Value |
|---|---|
| Base branch | <the branch the work starts from and the PR targets> |
| Integration branch | `autopilot/<slug>` |
| Setup | <commands a fresh checkout needs before tests run, or none> |
| Gate | <the full required gate, exact commands in order: lint, typecheck, tests, build> |
| Test | <the command that runs the whole test suite and nothing else; the build re-runs it against the old source to prove new tests fail without the change> |
| Gate baseline | <green at `<sha7>`, or "none yet: task 01 creates it"> |
| Focused test | <how to run one test file or case> |
| Lanes | <most tasks to run in parallel; 1 means serial in this checkout> |
| Shared resources | <ports, databases, caches or build output parallel lanes could collide on, and each lane's assignment; or none> |
| TDD skill | <`tdd`, or `supermatt:tdd` for mutation-checked tests> |
| Database | <engine; the scratch database the build may change; "production is a human step"; or none> |
| QA | <start command, URL or entry point, seed data or test account; or none> |
| Review skill | <`supermatt:code-review`, or `code-review`> |
| Peer | <`codex` to let the final review send the diff to a second model family, or none> |
| Security review | <yes, or no> |
| New dependencies | <vetted packages the build may add, or none> |
| Off-limits | <paths, services and actions the build must leave alone> |
| Commit plan docs | <yes, or no> |
| Finish | <`pr`, `draft-pr`, `branch`, or `merge`> |

## Constraints

Project-wide requirements every task inherits, one line each, exact values copied from the spec: version floors, naming and copy rules, accessibility and platform requirements.

## Task graph

| # | Task | Agent | Skills | Blocked by | Touches |
|---|---|---|---|---|---|
| 01 | <title> | coder | <skill names, or none> | none | <modules or directories> |

</plan-template>

### Choosing Contract values

- **Lanes** above 1 pays when `Setup` is cheap and the tasks need no shared database, port or build output. When Setup is slow, or a shared resource cannot be given one per lane, choose 1.
- **TDD skill**: `supermatt:tdd` adds a mutation check on every changed file, which catches tests that prove nothing and costs many more turns. Recommend it where a silent defect loses money, data or access; `tdd` elsewhere.
- **Peer**: `codex` sends the diff to another vendor's model. Recommend it only when `codex` is installed and the user accepts that.
- **Finish**: recommend `pr`. `merge` squash-merges with nobody reading the diff, and only when the gate, QA and review are all clean.
- **QA** of a terminal program needs `tmux`; without it those scenarios will be reported blocked.
- **Database**: name a database the build can break without consequence (a local container, a test schema, a PlanetScale development branch). The build never changes a production or shared database: the `db` agent prepares the migration, or the deploy request, and reports it as waiting for a human.
- **Security review**: recommend yes when the build touches authentication, payments, personal data, file upload, or input from outside the system.
- **QA** credentials and seed data use reserved values (`.test` or `example.com` addresses, obviously fake keys), so a scan never mistakes them for a leak and a real account is never touched.

## tasks/NN-slug.md

<task-template>

# NN: <title>

**Agent:** coder | ux | db
**Skills:** <the specialist skills the implementer loads first, from SKILL-ROUTING.md and the live skill listing; or none>
**Graph:** <exact code-graph labels to start from, as the graph prints them, e.g. `invoiceTotal()`, `SessionStore`, `tax.ts`; or none for code that does not exist yet>
**Blocked by:** <NN, NN> | none
**Touches:** <the modules or directories this task changes>
**Security:** yes | no

## What to build

The end-to-end behaviour this task makes work, from the user's perspective. Spec: <user story numbers and section names>.

## Interfaces

- **Consumes:** <exact names, signatures and types this task uses from earlier tasks or existing code>
- **Produces:** <exact names, signatures and types later tasks rely on>

## Acceptance criteria

- [ ] <observable behaviour>. Proof: <a test at seam X | a command and its expected output | what to see in the running app>

## Notes

Decisions from the interview that bind this task, and any prototype snippet that encodes a decision more precisely than prose. Omit when empty.

</task-template>

## Slicing rules

- Each task is a **tracer bullet**: a narrow but complete path through every layer it needs (schema, API, UI, tests), demoable or verifiable alone. Size it for one fresh context: one behaviour family, finished in one sitting.
- An implementer sees only their own task, the spec and the plan. The `Interfaces` block is how they learn the names and types neighbouring tasks use, so the same name is spelled the same way in every task that mentions it.
- **Blocking edges** come from two sources: a task that consumes what another produces, and any two tasks that touch the same module. The second kind is what lets every pair of unblocked tasks run in parallel and merge without conflict. With a code graph, `graphify affected` on each symbol a task changes decides `Touches`: the callers and importers it lists are touched too.
- Prefactoring comes first: make the change easy, then make the easy change.
- A **wide refactor** (one mechanical change that breaks call sites everywhere) is sequenced expand, migrate in batches, contract, each batch its own task blocked by the expand.
- A greenfield build starts with task 01 as the **walking skeleton**: the scaffold, the gate commands working end to end, pre-commit and CI. Every other task is blocked by it.
- A task whose deliverable is an interface a person looks at goes to `ux`, and one whose deliverable is schema, migrations, queries or indexes goes to `db`. Split a slice across agents only when each part is verifiable alone, with a blocking edge between the parts.
- A schema change that existing code depends on is sequenced **expand, migrate, contract**: add the new shape, move readers and writers, remove the old shape, each its own task.
- Documentation a user reads (README, env example, changelog) changes in the task that changes the behaviour, as one of its acceptance criteria.
- Every acceptance criterion names its proof, and every proof is something an agent can run or observe on this machine. A behaviour is proved by a test at an agreed seam, written before the code and seen to fail; what a test cannot reach (how a screen looks, a one-off migration) is proved by an observation the criterion spells out.
- One criterion is one behaviour, because the implementer builds one red-green cycle per criterion. Split a criterion that says "and".
- **Size for speed.** About 45 minutes of one agent's work per task: one screen, or one API module, or one engine. "API and screens" is two tasks. A task that touches more than about a dozen files or two screens is too big. A build is only as fast as its slowest task, and a late failure in a big task costs the whole task.
- **Wide, not deep.** Most tasks should depend only on the walking skeleton and the schema or contract tasks, so every lane stays busy. Keep the longest chain of blocking edges to five waves or fewer. Two tasks that can run in the same wave have disjoint `Touches`, or they would conflict at merge.
- **Security: yes** marks a task that handles authentication, payment, personal data, upload, a signed or replayed request, or input from outside. The conductor adds a security review to the wave that holds it. Write such a task's limits as criteria, not notes: a rate limit is a criterion with a key that is not the default one, proved by showing a second key unaffected; a replay window is a criterion proved at the edge of the signature's tolerance.
