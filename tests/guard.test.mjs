// Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allowed, loadRules, runActive, stripHeredocs, verdict } from "../scripts/guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const guard = join(here, "..", "scripts", "guard.mjs");
const home = homedir();

const BLOCK = [
  "git push --force",
  "git push -f origin autopilot/x",
  "git push --force-with-lease origin autopilot/x",
  "git push origin +autopilot/x",
  "git push origin :old-branch",
  "git push origin --delete old-branch",
  "git push origin main",
  "git push origin HEAD:master",
  "git push -u origin feature:refs/heads/main",
  "git push --no-verify origin autopilot/x",
  "git commit --no-verify -m 'x'",
  "git commit -nm 'x'",
  "git commit -n -m x",
  "HUSKY=0 git commit -m x",
  "git -c core.hooksPath=/dev/null commit -m x",
  "git reset --hard HEAD~1",
  "git reset --hard origin/main",
  "git clean -fdx",
  "git clean -fX",
  "git branch -D feature",
  "git branch --delete --force feature",
  "git branch -f main abc123",
  "git switch -C main abc123",
  "git checkout -B master",
  "git worktree remove --force ../wt",
  "git filter-branch --tree-filter x",
  "git reflog expire --expire=now --all",
  "git update-ref -d refs/heads/x",
  "git gc --prune=now",
  "gh repo delete owner/name --yes",
  "gh pr merge 12 --squash --admin",
  "gh api -X DELETE repos/o/r/git/refs/heads/x",
  "rm -rf /",
  "rm -rf ~",
  "rm -rf ~/",
  "rm -rf $HOME",
  "rm -rf .",
  "rm -rf ..",
  "rm -rf ../other-project",
  "rm -rf *",
  "rm -rf .git",
  "rm -rf /c/Users",
  "rm -rf C:\\Windows",
  `rm -rf "${home}"`,
  "Remove-Item -Recurse -Force C:\\",
  "Remove-Item -Recurse -Force $env:USERPROFILE",
  "rmdir /s /q C:\\Users",
  "cd repo && git push --force",
  "npm test; git push origin main",
  "bash -c 'git push --force'",
  'powershell -Command "git reset --hard HEAD~3"',
  "echo $(git push --force)",
  "& git push --force",
  "sudo rm -rf /usr",
  "eval \"git push --force\"",
  "eval 'rm -rf ~'",
  "git commit -m ok && eval git push origin main",
  "git push origin HEAD:refs/heads/prod",
  "git -C ../other push --force",
];

const ALLOW = [
  "git push -u origin autopilot/checkout",
  "git push origin autopilot/checkout",
  "git push origin HEAD:autopilot/checkout",
  "git commit -m 'fix: do not --force the cache'",
  'git commit -m "chore: drop -n flag from docs"',
  "git commit -am 'wip'",
  "git commit --amend --no-edit",
  "git reset --hard",
  "git reset --hard HEAD",
  "git reset HEAD~1",
  "git clean -n -fdx",
  "git clean -fd",
  "git branch -d autopilot/x/01",
  "git switch -C autopilot/x/01 abc123",
  "git checkout -b feature",
  "git worktree remove ../wt",
  "git merge --no-ff autopilot/x/01",
  "git gc",
  "gh pr create --base main --body-file body.md",
  "gh pr merge 12 --squash",
  "gh api repos/o/r/pulls",
  "rm -rf node_modules",
  "rm -rf ./dist",
  "rm -rf build/tmp",
  "rm file.txt",
  "rm -f *.log",
  `rm -rf "${join(home, "projects", "app", "dist")}"`,
  "Remove-Item -Recurse -Force .\\dist",
  "Remove-Item -Force notes.txt",
  "npm test && npm run build",
  "echo 'git push --force'",
  "grep -r 'rm -rf /' docs",
  "",
  "git commit -m \"$(cat <<'EOF'\nfix: never run git push --force\nEOF\n)\"",
  "cat <<EOF > notes.md\ngit reset --hard HEAD~5\nrm -rf /\nEOF",
  "git branch -D ap/task-7",
  "git branch -D autopilot-lane/foo/01",
  "echo eval is fine",
];


test("blocks what is irreversible or shared", () => {
  for (const c of BLOCK) assert.notEqual(verdict(c, here), null, `should block: ${c}`);
});

test("allows ordinary work", () => {
  for (const c of ALLOW) assert.equal(verdict(c, here), null, `should allow: ${c}`);
});

test("a block names its rule", () => {
  assert.equal(verdict("git push --force", here).id, "force-push");
  assert.equal(verdict("git push origin main", here).id, "protected-push");
  assert.equal(verdict("git commit --no-verify -m x", here).id, "hook-bypass");
  assert.equal(verdict("rm -rf ~", here).id, "recursive-delete");
});

test("heredoc bodies are text, but the command around them still counts", () => {
  assert.equal(stripHeredocs("cat <<EOF\ngit push --force\nEOF"), "cat <<EOF\n");
  assert.notEqual(verdict("git push --force <<EOF\nbody\nEOF", here), null);
  assert.notEqual(verdict("cat <<EOF > f\nx\nEOF\ngit push --force", here), null);
});

test("allow entries: a rule id, or rule:glob that every subject must match", () => {
  const h = (c) => verdict(c, here, []);
  assert.equal(allowed(h("git branch -D tmp/a"), ["branch-force-delete"]), true);
  assert.equal(allowed(h("git branch -D tmp/a tmp/b"), ["branch-force-delete:tmp/*"]), true);
  assert.equal(allowed(h("git branch -D tmp/a feature"), ["branch-force-delete:tmp/*"]), false);
  assert.equal(allowed(h("git branch -D tmp/a"), ["force-push"]), false);
  assert.equal(allowed(h("git push --force origin autopilot/x"), ["force-push:autopilot/*"]), true);
  assert.equal(allowed(h("git push origin main"), ["protected-push:feature/*"]), false);
  assert.equal(allowed(h("rm -rf ~"), ["recursive-delete:*"]), true);
});

test("an allowance covers only its own rule, even in a compound command", () => {
  assert.equal(verdict("git branch -D tmp/a", here, ["branch-force-delete:tmp/*"]), null);
  assert.equal(verdict("git branch -D tmp/a && git push --force", here, ["branch-force-delete:tmp/*"]).id, "force-push");
});

test("the pipeline's own lane branches and worktrees are allowed by default", () => {
  assert.equal(verdict("git branch -D ap/t-3", here), null);
  assert.equal(verdict("git branch -D autopilot-lane/x/01", here), null);
  assert.equal(verdict("git worktree remove --force /srv/app/.autopilot/lanes/t-3", here), null);
  assert.notEqual(verdict("git worktree remove --force /srv/app/src", here), null);
  assert.notEqual(verdict("git branch -D autopilot/x", here), null);
});

test("rules files: allow lists add up, the nearest scope wins, bad files are ignored", () => {
  const root = mkdtempSync(join(tmpdir(), "guard-rules-"));
  try {
    const hm = join(root, "home");
    const repo = join(root, "repo");
    mkdirSync(hm);
    mkdirSync(join(repo, ".autopilot"), { recursive: true });
    const old = process.env.AUTOPILOT_HOME;
    process.env.AUTOPILOT_HOME = hm;
    try {
      writeFileSync(join(hm, "guard.json"), JSON.stringify({ scope: "runs", allow: ["gc-prune"] }));
      writeFileSync(join(repo, ".autopilot", "guard.json"), JSON.stringify({ scope: "always", allow: ["force-push:tmp/*", 7] }));
      assert.deepEqual(loadRules(repo), { scope: "always", allow: ["force-push:tmp/*", "gc-prune"] });
      writeFileSync(join(repo, ".autopilot", "guard.json"), "{ not json");
      assert.deepEqual(loadRules(repo), { scope: "runs", allow: ["gc-prune"] });
      assert.deepEqual(loadRules(root), { scope: "runs", allow: ["gc-prune"] });
    } finally {
      if (old === undefined) delete process.env.AUTOPILOT_HOME;
      else process.env.AUTOPILOT_HOME = old;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runActive: an unfinished run counts, a finished or stale one does not", () => {
  const root = mkdtempSync(join(tmpdir(), "guard-run-"));
  try {
    const ap = join(root, ".autopilot");
    const sub = join(root, "src", "deep");
    mkdirSync(sub, { recursive: true });
    assert.equal(runActive(sub), false, "no .autopilot");
    mkdirSync(join(ap, "plan"), { recursive: true });
    assert.equal(runActive(sub), false, "empty .autopilot");
    writeFileSync(join(ap, "state.json"), JSON.stringify({ phase: "build" }));
    assert.equal(runActive(sub), true, "state in build");
    writeFileSync(join(ap, "state.json"), JSON.stringify({ phase: "done" }));
    assert.equal(runActive(sub), false, "state done");
    writeFileSync(join(ap, "plan", "ledger.md"), "task 1 done\n");
    assert.equal(runActive(sub), true, "ledger without a finish line");
    writeFileSync(join(ap, "plan", "ledger.md"), "task 1 done\nfinish: https://example.test/pr/1\n");
    assert.equal(runActive(sub), false, "ledger with finish");
    writeFileSync(join(ap, "plan", "ledger.md"), "STOP: no credentials\n");
    assert.equal(runActive(sub), false, "ledger with STOP");
    writeFileSync(join(ap, "plan", "ledger.md"), "task 1 done\n");
    const old = new Date(Date.now() - 72 * 3600 * 1000);
    utimesSync(join(ap, "plan", "ledger.md"), old, old);
    assert.equal(runActive(sub), false, "stale ledger");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// End to end, the way the harness calls it: JSON on stdin, exit code out.
// An empty rules home by default, so a guard.json on the machine running the tests cannot change a result.
const emptyHome = mkdtempSync(join(tmpdir(), "guard-home-"));
const run = (payload, env = {}) => spawnSync(process.execPath, [guard], { input: payload, encoding: "utf8", env: { ...process.env, AUTOPILOT_HOME: emptyHome, ...env } });
const call = (command, cwd) => JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd });

test("the hook exits 2 with the rule and the way out on stderr", () => {
  const r = run(call("git push --force", here));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /autopilot guard: blocked \[force-push\]/);
  assert.match(r.stderr, /report it as a blocker/);
});

test("the hook fails open on anything it cannot read", () => {
  for (const payload of [JSON.stringify({ tool_name: "PowerShell", tool_input: { command: "git status" }, cwd: here }), JSON.stringify({ tool_name: "Bash", tool_input: {} }), "not json", ""]) {
    assert.equal(run(payload).status, 0, payload.slice(0, 40));
  }
});

test("scope runs: the hook guards a repository only while a run is in progress", () => {
  const root = mkdtempSync(join(tmpdir(), "guard-scope-"));
  try {
    const hm = join(root, "home");
    const repo = join(root, "repo");
    mkdirSync(hm);
    mkdirSync(join(repo, ".autopilot"), { recursive: true });
    writeFileSync(join(hm, "guard.json"), JSON.stringify({ scope: "runs", allow: ["gc-prune"] }));
    const env = { AUTOPILOT_HOME: hm };
    assert.equal(run(call("git push --force", repo), env).status, 0, "no run in progress");
    writeFileSync(join(repo, ".autopilot", "state.json"), JSON.stringify({ phase: "build" }));
    assert.equal(run(call("git push --force", repo), env).status, 2, "run in progress");
    assert.equal(run(call("git gc --prune=now", repo), env).status, 0, "allowed by the machine rules");
    writeFileSync(join(repo, ".autopilot", "state.json"), JSON.stringify({ phase: "done" }));
    assert.equal(run(call("git push --force", repo), env).status, 0, "run finished");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
