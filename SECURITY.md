# Security

## What the guard is

`scripts/guard.mjs` is a **tripwire for accidents**. It reads a shell command, splits it into segments, and blocks the ones that are irreversible or reach shared state: force and delete pushes, pushes to a protected branch, hook bypasses, history rewrites, force-deletes of branches and worktrees, and recursive deletes of a root, home or `.git`.

It is **not a sandbox**. It does not stop:

- a command it cannot parse (it fails open, on purpose: a guard that blocks on a parse error blocks real work);
- a destructive action by a tool other than Bash and PowerShell, or through a script the agent wrote and then ran (`node cleanup.js`);
- obfuscation: variables, `base64 -d | sh`, or building a command out of pieces;
- anything an agent can do after editing `guard.json` or `hooks.json`. The rules file is meant to be edited by you, but nothing stops an agent that has write access to the repository from writing `.autopilot/guard.json`. Put allowances you rely on in `~/.claude/autopilot/guard.json` and review changes to repository files.

Real protection is the branch model (work happens on a branch, a pull request is the only way in) and your repository's branch protection.

## Other things that touch your machine

- `scripts/rea-mcp.mjs` edits `~/.claude.json`, only when you run `enable` or `disable`, and keeps a `.rea-toggle.backup` beside it.
- `scripts/lessons.mjs` writes under `~/.claude/autopilot/` and `<repo>/.autopilot/`, and appends `.autopilot/` to the repository's `.git/info/exclude`.
- `scripts/tdd-check.mjs` temporarily rewrites source files in the working tree to check your tests, then restores them with `git reset --hard HEAD`. It refuses to start on a dirty tree.
- `/recon` runs a target only after you approve it, and never alone.

## Reporting a problem

Open a private security advisory on the repository, or email the maintainer listed on their GitHub profile. Please include the command or input, and what you expected the guard or script to do.
