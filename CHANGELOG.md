# Changelog

## Unreleased

- auto-trigger can route to another skill (`AUTOPILOT_SKILL` or `~/.claude/autopilot-auto.skill`); the hook tests no longer read the host's own off file.

## 0.2.0

**Fixes that stopped the plugin from installing or working as written**
- Renamed the plugin to `autopilot-forge`: names that start with `claude-` are reserved, so `claude plugin validate` rejected 0.1.0. Install with `/plugin install autopilot-forge@autopilot-forge`.
- Removed the manifest's `hooks` key: `hooks/hooks.json` loads by itself, and naming it again loads it twice.
- Lane branches are now `autopilot-lane/<slug>/NN`. `autopilot/<slug>/NN` could not exist beside the integration branch `autopilot/<slug>`, so every parallel wave would have failed at its first branch.
- Agents are dispatched by scoped name (`autopilot-forge:coder`), so a user's own agent of the same name cannot take their place.
- Files the pipeline reads with the Read tool no longer carry a `${CLAUDE_PLUGIN_ROOT}` that is never substituted; the entry skill states the root.
- `/recon` pins `rea-agents` to the same version as `rea-mcp`, instead of `@latest`.
- `lessons.mjs` no longer overwrites a hand-kept global `LESSONS.md`; its readable copy is `lessons-all.md`.

**Guard**
- Every block has a rule id. A rules file (`.autopilot/guard.json`, `~/.claude/autopilot/guard.json`) can set `scope` (`always` or `runs`) and `allow` entries (`rule` or `rule:glob`).
- Text in a heredoc is no longer scanned as commands (a commit message that quotes `git push --force` was blocked), unless it feeds a shell or interpreter (`bash <<EOF`, `... | sh`), and `eval` is followed.
- Shell keywords (`then`, `do`, `while`) and wrappers with options (`sudo -u`, `env -i`, `timeout 10`, `nice`, `xargs`, `watch`, `script -c`) no longer hide the command behind them; a backslash-newline joins lines; git's abbreviated long options (`--no-verif`) and `branch -df` are caught; `git push --all` counts as a push to every protected branch; `gh` flags that take values (`-R o/r`) and `gh api -XDELETE` are read correctly; `rm -rf "$PWD"`, `./..` and the repository's own path are blocked.
- Worktrees under `.claude/worktrees/` (where agent isolation puts them) can be force-removed.
- The pipeline's own lane branches and lane worktrees can be force-removed.

**Scripts**
- `tdd-check` restores the tree on SIGINT, SIGTERM and SIGHUP and leaves a marker so a SIGKILLed run is repaired by the next one; a test command that cannot run, or a suite already red at HEAD, is INCONCLUSIVE instead of PASS.
- `scan-diff` judges a placeholder word only inside the matched value, so a real key on a line with `${...}` or "example" is found; env files added empty or by rename are found; paths with non-ASCII names are scanned.
- `lessons` refuses to write over a `lessons.json` it cannot parse (a copy is kept), and keeps a hand-kept `LESSONS.md` as `LESSONS.hand.md` before replacing it. `rea-mcp` keeps the config's permissions and follows a symlink.

**New**
- `host-load.mjs`: the conductor sizes each wave to what the machine can carry.
- `status.mjs`: one line of progress from the ledger, and a SessionStart hint when a build is unfinished.
- Conductor checkpoints after every third wave and is resumed fresh, so a long build does not rot one context.
- Early draft pull request after the first green wave, so CI runs throughout.
- Per-task `Security: yes` adds a security review to the wave that holds it.
- Planner rules for fast builds: ~45-minute tasks, a wide graph of five waves or fewer, disjoint `Touches`; security criteria written as criteria.
- Standards seed: replay-window, idempotency-release and untracked-package lines.
- `tdd-check` reports `WEAK PASS` when the tests failed only because a new file they import was gone.
- `lessons import` and an automatic one-time import of a hand-kept `.autopilot/LESSONS.md`.

**Project**
- `package.json`, `node:test` suites for every script (previously two), `tools/validate.mjs`, GitHub Actions on Linux, macOS and Windows.
- README, ARCHITECTURE, SECURITY and CONTRIBUTING.

## 0.1.0

First release.
