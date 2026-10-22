#!/usr/bin/env node
// Do the tests in a change actually test the change?
// Puts the SOURCE files back to how they were at BASE, keeps the TESTS as they
// are now, and runs the test command. Tests that still pass were never testing
// the change. Deterministic, so it costs no model tokens.
//   node tdd-check.mjs <BASE> -- <test command>      (repository root, clean tree)
// Prints one line starting "tdd-check:" and exits 1 only on FAIL.
// PASS means the tests fail without the change. WEAK PASS means they fail only because a new file they
// import is gone: a reviewer has to read the assertions.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const TEST_FILE = /(^|\/)(tests?|__tests__|spec|specs|e2e|cypress|playwright|fixtures?|__fixtures__|mocks?|__mocks__|__snapshots__)\/|\.(test|spec|e2e|cy|stories)\.[a-z]+$|_test\.(go|py|rb|exs?)$|(^|\/)(test_[^/]*|conftest)\.py$|_spec\.rb$|Tests?\.(java|kt|cs|swift|php)$/i;
const MISSING_FILE = /cannot find module|module not found|ModuleNotFoundError|ImportError|cannot find package|failed to resolve import|could not resolve|no such file or directory|ERR_MODULE_NOT_FOUND|package .* is not in (GOROOT|std)|unresolved import|cannot load such file/i;
const CODE_FILE = /\.(m?[jt]sx?|cjs|vue|svelte|astro|py|go|rs|java|kt|kts|rb|php|cs|swift|c|cc|cpp|cxx|h|hpp|scala|exs?|erl|lua|dart|zig)$/i;

/** Split a `git diff --name-status` listing into the test files and source files a check needs. */
export function classify(nameStatus) {
  const tests = [];
  const source = { added: [], changed: [] };
  for (const line of nameStatus.split("\n")) {
    const m = /^([AMD])\t(.+)$/.exec(line.trim());
    if (!m) continue;
    const [, status, file] = m;
    if (TEST_FILE.test(file)) {
      if (status !== "D") tests.push(file);
    } else if (CODE_FILE.test(file)) {
      (status === "A" ? source.added : source.changed).push(file);
    }
  }
  return { tests, source };
}

function main() {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf("--");
  const base = argv[0];
  const command = sep >= 0 ? argv.slice(sep + 1).join(" ") : "";
  const say = (msg, code = 0) => {
    console.log(`tdd-check: ${msg}`);
    return code;
  };
  if (!base || sep < 1 || !command) {
    console.error("usage: node tdd-check.mjs <BASE> -- <test command>");
    return 2;
  }
  const git = (...args) => spawnSync("git", args, { encoding: "utf8" });

  if (git("rev-parse", "--verify", "--quiet", `${base}^{commit}`).status !== 0) return say(`SKIPPED - ${base} is not a commit`);
  if (git("status", "--porcelain", "--untracked-files=no").stdout.trim()) return say("SKIPPED - the tree has uncommitted changes; commit first");

  const listing = git("diff", "--name-status", "--no-renames", `${base}..HEAD`).stdout;
  const { tests, source } = classify(listing);
  const sourceCount = source.added.length + source.changed.length;
  if (!sourceCount) return say(`SKIPPED - no source files changed since ${base.slice(0, 7)}`);
  if (!tests.length) return say(`NO TESTS - ${sourceCount} source file(s) changed and no test was added or changed. Fine for a pure refactor; a finding for a behaviour change`);

  let result;
  let restoreFailed = "";
  const restore = () => {
    const r = git("reset", "-q", "--hard", "HEAD");
    if (r.status !== 0) restoreFailed = r.stderr.trim();
  };
  process.on("SIGINT", () => {
    restore();
    process.exit(130);
  });
  try {
    // Source as it was at BASE; tests as they are at HEAD.
    for (const f of source.added) if (existsSync(f)) rmSync(join(process.cwd(), f));
    for (let i = 0; i < source.changed.length; i += 50) {
      const r = git("checkout", base, "--", ...source.changed.slice(i, i + 50));
      if (r.status !== 0) throw new Error(r.stderr.trim());
    }
    result = spawnSync(command, { shell: true, encoding: "utf8", timeout: 20 * 60 * 1000, env: { ...process.env, CI: "1" } });
  } catch (e) {
    restore();
    return say(`SKIPPED - could not set the source back to ${base.slice(0, 7)}: ${e.message}`);
  }
  restore();
  if (restoreFailed || git("status", "--porcelain", "--untracked-files=no").stdout.trim()) {
    return say(`WARNING - the tree was not restored cleanly${restoreFailed ? ` (${restoreFailed})` : ""}. Run \`git reset --hard HEAD\` before anything else`, 1);
  }

  const shown = tests.slice(0, 6).join(", ") + (tests.length > 6 ? `, +${tests.length - 6} more` : "");
  if (result.error && result.error.code === "ETIMEDOUT") return say(`INCONCLUSIVE - \`${command}\` did not finish in 20 minutes with the source reverted`);
  if (result.status === 0) {
    return say(`FAIL - with the ${sourceCount} changed source file(s) put back to ${base.slice(0, 7)}, \`${command}\` still passes. The tests in this change do not test it: ${shown}`, 1);
  }
  // A new file taken away makes an importing test fail before any assertion runs. That proves the file exists, not that the tests check it.
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (source.added.length && !source.changed.length && MISSING_FILE.test(output)) {
    return say(`WEAK PASS - \`${command}\` fails with the new source file(s) removed, but on a missing import (exit ${result.status}), before any assertion ran. That shows the tests need the file, not that they check it: the reviewer must read their assertions. Tests: ${shown}`);
  }
  return say(`PASS - with the ${sourceCount} changed source file(s) put back to ${base.slice(0, 7)}, \`${command}\` fails (exit ${result.status}), so the tests depend on the change: ${shown}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
