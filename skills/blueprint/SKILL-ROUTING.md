# Skill routing

Every task names the **specialist skills** its implementer loads before building, on its `Skills` line. A general implementer with the right specialist skill loaded beats a general implementer guessing, so routing is part of planning, and it is decided here, while the user is present.

The session's own skill listing is the source of truth for what is installed. This file holds the pairings that listing cannot tell you.

## Route by what the task touches

| The task touches | Agent | Skills line |
|---|---|---|
| Postgres schema, migrations, queries, indexes, connection handling | `db` | `planetscale:postgres` |
| MySQL or InnoDB schema, migrations, queries, indexes, locking | `db` | `planetscale:mysql` |
| A Vitess or sharded PlanetScale database, VSchema, keyspaces | `db` | `planetscale:vitess` |
| Sharded Postgres on Neki | `db` | `planetscale:neki` |
| PlanetScale branches, deploy requests, the `pscale` CLI | `db` | `planetscale:planetscale-pscale-cli-automation`, `planetscale:planetscale-change-gates-and-approval-contract` |
| Tagging application queries for PlanetScale Insights | `coder` | `planetscale:planetscale-codebase-sqlcommenter-instrumentation` |
| Screens, components, layout, styling, motion, UX copy | `ux` | `refero-design`, plus `impeccable` when installed |
| Charts, dashboards, stat tiles, any data visualisation | `ux` | `dataviz` |
| Calls to the Claude API or an agent built on it | `coder` | `claude-api` |
| A module's interface or where a seam belongs | `coder` | `codebase-design` |
| A defect whose cause is not yet known | `coder` | `diagnosing-bugs` |
| Pre-commit hooks in the walking skeleton | `coder` | `setup-pre-commit` |
| CLAUDE.md, AGENTS.md, or a skill file | `coder` | `writing-for-agents` |
| Generating a PDF, Word, Excel or PowerPoint file | `coder` | the matching `anthropic-skills:` skill |

A skill installed on this machine that fits a task and is missing from this table still goes on the task's `Skills` line: match every task against the live skill listing, and treat the table as the minimum.

## Rules

- **Name a skill only where the task works in its domain.** Each loaded skill costs the implementer context on every turn, so one or two per task is normal and none is fine.
- **Database work goes to `db`**, UI work to `ux`, everything else to `coder`. A task that would need two agents is two tasks with a blocking edge.
- **The reviewer gets the same lens.** A wave's review loads the skills its tasks named, so a schema is judged by the engine's standard and a screen by the design standard.
- **Design skills at planning too.** The Design Lock in the spec is produced with the same design skill the `ux` tasks will name, so the plan and the build speak one design language. With `impeccable` installed, use its `shape` command while locking the design; `ux` then runs its `audit` and `polish` after building.
- **Database safety is a Contract decision.** Fill the `Database` field with the engine, the scratch database the build may change (a local container, a test schema, a PlanetScale development branch), and the statement that production is a human step. The PlanetScale connector must be authorised by the user before any task can use it.

## Filling a gap

A domain in the plan with no installed specialist skill is a question for the user, asked in step 2 with the other decisions:

1. Search for one: call the Skill tool with `find-skills`, or the skill-search tool when the session has it.
2. Vet what you find before recommending it: call the Skill tool with `supermatt:dependency-vetting`. A skill is instructions an agent will follow with the user's permissions, so its source matters as much as a package's.
3. Put the choice to the user with the upstream's own install command. Installing is theirs to do; a new skill is available to sessions started after it is installed, which the build session is.
4. When they decline, the task goes ahead on the general agent, and the plan's Constraints carry the domain rules that matter most.
