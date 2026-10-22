# Architecture

How the pieces fit, and the rules that keep them from breaking.

```
 you ── /autopilot ──► main session (routes, interviews)
                          │  blueprint steps 1-5
                          ▼
                       planner (Opus)  ── spec.md, plan.md, tasks/
                          │  you approve
                          ▼
                       conductor (Sonnet) ── ledger.md ──► CHECKPOINT ─┐
                          │ waves of lanes                              │ fresh conductor
          ┌───────────────┼───────────────┐                             │ resumes from the
          ▼               ▼               ▼                             │ ledger
        coder / ux / db  (one worktree each)  ◄─────────────────────────┘
          │
          ▼  runner (merge, gate)  ·  reviewer  ·  senior (escalation)
          ▼
        branch or pull request
```

## Who does what

- **Main session**: finds the phase, interviews, relays. It dispatches the planner and the conductor and nothing else.
- **Conductor**: dispatches, reads reports, rules, keeps the ledger. It runs no builds itself. Its memory is `.autopilot/<plan>/ledger.md`, not its context.
- **Implementers** (`coder`, `ux`, `db`): one task each, test first, in their own worktree.
- **Reviewer, runner, senior**: independent reads, command sequences, and the Opus escalation.
- **Scripts** (`scripts/`): everything deterministic — guard, graph cards, TDD check, leftover scan, lessons, host load, status. They cost no model tokens.

## Rules that matter

1. **Agents are dispatched by scoped name**, `autopilot-forge:coder`, so a user's own `coder` cannot shadow them.
2. **Lane branches are `autopilot-lane/<slug>/NN`.** The integration branch is `autopilot/<slug>`, and git refuses a ref that is also a directory, so a lane under `autopilot/<slug>/` could never be created.
3. **`${CLAUDE_PLUGIN_ROOT}` is replaced only in agent and skill bodies and in hook config.** A file opened with the Read tool shows it literally. So files the pipeline reads raw (`PLAN-FORMAT.md`, `GRAPH.md`) say `<scripts>`, and the entry skill states the real root. `npm run validate` enforces this.
4. **The ledger is the source of truth.** A conductor that restarts, whether after a crash or a checkpoint, trusts the ledger and `git log` over memory. A checkpoint after every third wave keeps one conductor's context from rotting.
5. **Rulings, not stalls.** Four things stop a run (failed preflight, an irreversible action, a missing credential, a plan so broken every path is a guess). Everything else is a ruling written to the ledger with what it costs if wrong.
6. **The guard is advisory.** It stops accidents, not a determined agent. Safety comes from the branch model (nothing lands on a protected branch without a pull request) as much as from the guard.

## State on disk

| Path | What | Lives |
|---|---|---|
| `docs/plans/<plan>/` | spec, plan, tasks | committed |
| `.autopilot/<plan>/` | ledger, graph cards, reports | git-ignored, per repository |
| `.autopilot/LESSONS.md` | lessons that apply here, rendered | git-ignored |
| `~/.claude/autopilot/lessons.json` | the cross-project lessons store | per machine |
| `~/.claude/autopilot/guard.json`, `<repo>/.autopilot/guard.json` | guard allowances and scope | yours |
