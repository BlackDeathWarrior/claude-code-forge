# autopilot-forge

(The repository is `claude-code-forge`; the plugin is installed as `autopilot-forge`, because plugin names that start with `claude-` are reserved.)

A [Claude Code](https://claude.com/claude-code) plugin with two tools:

- **`/autopilot`** — a hands-free build pipeline. You answer an interview once; it plans, builds, tests, reviews, and opens a pull request using tiered subagents while you're away.
- **`/recon`** — a human-in-the-loop reverse-engineering skill built on [rea](https://github.com/morluto/rea), gated so nothing runs a target or touches config without your say-so.

Both share a safety guard, a code-graph layer that keeps context cheap, and a cross-project memory of what earlier runs learned.

> **Status:** v0.2. Every script has tests (`npm test`; CI is set up for Linux, macOS and Windows), and `npm run validate` plus `claude plugin validate . --strict` check the plugin's shape. Each agent and stage has been exercised in isolation on sample projects, and the pipeline's design has run real builds elsewhere, but the full chain in this plugin — a typed prompt carried all the way to a merged PR, and a live `/recon` against a real target — has **not** been run end to end. Treat it as a strong scaffold to try on low-stakes work first, not a proven autopilot.

## What's inside

| Component | What it does |
|---|---|
| `/autopilot` | Entry point. Finds the phase (plan vs build vs resume) and runs it end to end. |
| `/blueprint` | The planning interview: grills every decision out of you, then an Opus `planner` writes the spec, task graph and execution contract. |
| `/verify` | One-shot readiness check on a branch (gate + leftover scan + TDD check). |
| `/recon` | Reverse engineering with authorization and scope gates; dispatches evidence-first `analyst` subagents. |
| 10 agents | `conductor` (runs a build), `coder` / `ux` / `db` (implementers), `reviewer`, `runner`, `senior` (Opus escalation), `planner` (Opus), `analyst` + `senior-analyst` (RE, Sonnet + Opus escalation). |
| Scripts | `guard` (blocks destructive commands), `graph-refresh` / `graph-brief` (code graph), `tdd-check` (proves new tests fail without the change), `scan-diff` (secrets / debug leftovers), `lessons` (cross-project memory), `host-load` (how many lanes this machine can carry), `status` (where a build stands, and a resume hint at session start), `auto-trigger` (routes build prompts into the pipeline), `rea-mcp` (toggle the RE engine). |

### How a build runs

1. **Plan (with you):** `/autopilot <what you want>` interviews you — scope, behaviour and its unhappy paths, data, UI, dependencies, test seams, and whether to stop at a PR or merge. Your answers are saved so an interrupted plan resumes.
2. **Build (you can leave):** a `conductor` works the task graph in waves. Independent tasks run in parallel, each in its own worktree. Every implementer gets a graph "card" of what depends on the code it touches and builds test-first; after each wave the full gate runs, a script confirms the new tests actually fail without the change, and a reviewer checks the callers the diff didn't touch. Up to three fix rounds, the third on Opus.
3. **Verify & ship:** leftover scan, optional browser QA, optional security review, a full code review with one fix pass, then a branch or PR. Everything decided in your absence — and what it costs if wrong — is in the final report.

### Model tiers

The session model only drives light orchestration; the work is pinned per agent, so you can run on Sonnet and let Opus kick in only where it's needed.

| Tier | Agents |
|---|---|
| Sonnet (medium) | coder, ux, db, reviewer, conductor |
| Sonnet (low) | runner |
| Sonnet (high) | analyst |
| Opus (high) | planner, senior, senior-analyst — escalation and design only |

## Install

```
/plugin marketplace add BlackDeathWarrior/claude-code-forge
/plugin install autopilot-forge@autopilot-forge
```

Then set your session permission mode to **Auto** before approving a plan, so the build runs unattended.

### Prerequisites

- **Node.js 22.19+, 24.11+, or 26+** (the scripts and rea need it).
- **git**, and **gh** authenticated if you want `/autopilot` to open pull requests.
- Optional: **codex** (a second-model-family peer reviewer), **tmux** (terminal-app QA), a browser (web-app QA).

### Companion skills (not bundled)

The pipeline calls skills it does not ship. Install the ones you want; see [CREDITS.md](CREDITS.md) for who made them.

- Build reviews and TDD: a `supermatt`-style skill set (`qa`, `code-review`, `pr`, `tdd`, `resolving-merge-conflicts`, `dependency-vetting`).
- Cheaper context on existing codebases: **graphify** — `npm i -g graphifyy` (or `uv tool install graphifyy`).
- UI and charts: **refero-design**, **dataviz**.
- Reverse engineering: **rea** — `npx skills add morluto/rea --skill reverse-engineer-anything`, then `npx rea-agents setup` to register its MCP server, plus **Ghidra** for native binaries.

Where a companion is missing, the forge still runs the parts it can and reports the rest as blocked rather than faking it.

## Usage

- **Build:** `/autopilot add a refunds feature to the billing module`
- **Plan now, build later:** `/blueprint ...`, then `/autopilot docs/plans/<dir>`
- **Skip the pipeline for a one-liner:** start the prompt with `quick:` — no interview, no subagents.
- **Check a branch:** `/verify`
- **Reverse engineer (human-gated):** `/recon <target>`. rea is opt-in to save tokens; enable it first:
  ```
  node "<plugin>/scripts/rea-mcp.mjs" enable   # then restart Claude Code
  ```

## Safety

- **The guard** (a PreToolUse hook) blocks force-pushes, pushes to protected branches, hook bypasses, history rewrites, force-deletes of branches and worktrees, and recursive deletes of a root, home, or `.git`. It is a tripwire, not a sandbox: see [SECURITY.md](SECURITY.md) for what it does not catch. Every block names its rule (`[force-push]`), and the agent is told to report a blocker rather than work around it.
- **Loosening it is your call, not the agent's.** Put a rules file at `<repo>/.autopilot/guard.json` or `~/.claude/autopilot/guard.json`:
  ```json
  { "scope": "runs", "allow": ["branch-force-delete:tmp/*", "force-push:my-feature/*"] }
  ```
  `"scope": "runs"` guards a repository only while a build is in progress there, so your own sessions are left alone. An `allow` entry is a rule id, or `rule:glob` to allow it only when every branch or path the command touches matches. The pipeline's own throwaway lane branches (`autopilot-lane/*`) and lane worktrees are allowed already.
- **`/recon` never crosses two lines on its own:** whether a teardown is authorized at all, and whether anything may run a target or write machine config. Both are your explicit yes.

## Development

```
npm test                                  # every script, on node:test
npm run validate                          # names, frontmatter, links, hook scripts, ${CLAUDE_PLUGIN_ROOT} placement
claude plugin validate . --strict         # the manifest against Claude Code's own schema
claude --plugin-dir .                     # try the working tree in a session
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## License

MIT — see [LICENSE](LICENSE). Companion tools remain under their own licenses.
