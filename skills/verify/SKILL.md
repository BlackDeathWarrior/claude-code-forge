---
name: verify
description: "Run the project's full gate and a leftover scan on the current branch, and print a one-screen readiness report."
argument-hint: "[fixed point; default: the default branch]"
disable-model-invocation: true
model: sonnet
effort: low
---

# Verify

Answer one question about the current branch: is it ready for a pull request? This skill reports and changes nothing.

1. **Find the gate.** When a plan under `docs/plans/` names this branch as its `Integration branch`, its Contract's `Gate` is the gate. Otherwise read the project's own commands (package scripts, Makefile, CI workflow) for build, typecheck, lint and tests, in that order.
2. **Find the fixed point**: `$ARGUMENTS`, or the default branch (`git symbolic-ref --short refs/remotes/origin/HEAD`, else `main`). BASE is `git merge-base <fixed point> HEAD`.
3. **Run it** with one `runner` dispatch, every step marked `continue on failure`: each gate command, then `node "${CLAUDE_PLUGIN_ROOT}/scripts/scan-diff.mjs" <BASE>`, then, when the tree is clean, `node "${CLAUDE_PLUGIN_ROOT}/scripts/tdd-check.mjs" <BASE> -- <the test command>`, then `git status --short`.
4. **Report**, and stop:

```
VERIFY: READY | NOT READY

Build:  ok | FAIL
Types:  ok | <n> errors
Lint:   ok | <n> issues
Tests:  <passed>/<total>
Scan:   P0 <n>, P1 <n>, P2 <n>, P3 <n>
TDD:    PASS | FAIL | NO TESTS | SKIPPED
Tree:   clean | <n> uncommitted files
```

READY means every gate command passed, the scan found no P0 or P1, and the TDD check did not FAIL (the new tests must fail when the source is put back to BASE). Under the table, list each failure with its `file:line` and the scan's P0 and P1 lines as printed. A check the project does not have is reported as `none`, never as ok.
