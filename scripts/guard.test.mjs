// Run: node guard.test.mjs
// Each case is a command and whether the guard must block it.
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verdict } from "./guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
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
];

let failed = 0;
const check = (cmd, want) => {
  const got = verdict(cmd, here) !== null;
  if (got !== want) {
    failed++;
    console.log(`FAIL (${want ? "should block" : "should allow"}): ${cmd}`);
  }
};
BLOCK.forEach((c) => check(c, true));
ALLOW.forEach((c) => check(c, false));

// End to end, the way the harness calls it: JSON on stdin, exit code out.
const run = (payload) => spawnSync(process.execPath, [join(here, "guard.mjs")], { input: payload, encoding: "utf8" });
const e2e = [
  [JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push --force" }, cwd: here }), 2],
  [JSON.stringify({ tool_name: "PowerShell", tool_input: { command: "git status" }, cwd: here }), 0],
  [JSON.stringify({ tool_name: "Bash", tool_input: {} }), 0],
  ["not json", 0],
  ["", 0],
];
for (const [payload, want] of e2e) {
  const r = run(payload);
  if (r.status !== want) {
    failed++;
    console.log(`FAIL (exit ${r.status}, want ${want}): ${payload.slice(0, 60)}`);
  } else if (want === 2 && !/autopilot guard: blocked/.test(r.stderr)) {
    failed++;
    console.log(`FAIL (no reason on stderr): ${payload.slice(0, 60)}`);
  }
}

const total = BLOCK.length + ALLOW.length + e2e.length;
console.log(failed ? `${failed} of ${total} failed` : `all ${total} passed`);
process.exit(failed ? 1 : 0);
