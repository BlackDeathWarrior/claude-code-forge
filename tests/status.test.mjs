import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseLedger } from "../scripts/status.mjs";
import { node, tempRepo } from "./helpers.mjs";

const PLAN = "## Task graph\n\n| # | Task | Agent |\n|---|---|---|\n| 01 | a | coder |\n| 02 | b | coder |\n| 03 | c | ux |\n";
const LEDGER = ["# autopilot ledger: /x/docs/plans/2026-01-01-demo", "preflight: base abc1234", "task 01: dispatched (wave 1, start abc1234)", "task 01: done autopilot-lane/demo/01 @ def5678", "task 01: integrated @ 1112223", "task 02: dispatched (wave 2, start 1112223)", "wave 2: review clean", "task 03: parked: needs a credential"].join("\n");

test("parseLedger counts tasks by their latest state", () => {
  const s = parseLedger(LEDGER, PLAN.split("## Task graph")[1]);
  assert.deepEqual([s.total, s.integrated, s.inFlight, s.parked, s.wave, s.waveStep], [3, 1, 1, 1, 2, "review"]);
  assert.equal(s.running, true);
  assert.equal(s.plan, "/x/docs/plans/2026-01-01-demo");
});

test("finish and STOP end a build; a later state never goes backwards", () => {
  assert.equal(parseLedger(`${LEDGER}\nfinish: https://example.test/pr/9`).running, false);
  assert.equal(parseLedger(`${LEDGER}\nSTOP: no credentials`).stop, "no credentials");
  const s = parseLedger("task 01: integrated @ a\ntask 01: dispatched (wave 3)");
  assert.equal(s.integrated, 1);
});

function build(r, ledgerText) {
  const plan = join(r.dir, "docs", "plans", "demo");
  mkdirSync(plan, { recursive: true });
  writeFileSync(join(plan, "plan.md"), PLAN);
  const run = join(r.dir, ".autopilot", "demo");
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "ledger.md"), ledgerText.replace("/x/docs/plans/2026-01-01-demo", plan));
  return join(run, "ledger.md");
}

test("CLI: one line from the newest ledger, JSON on request, and a hint only for an unfinished fresh build", () => {
  const r = tempRepo();
  try {
    assert.match(node(r.dir, "status.mjs").out, /no build found/);
    const ledger = build(r, LEDGER);
    assert.match(node(r.dir, "status.mjs").out, /^autopilot demo: 1\/3 tasks integrated, 1 in flight, 1 parked, wave 2 \(review\)\. Last: task 03: parked/);
    assert.equal(JSON.parse(node(r.dir, "status.mjs", ["--json"]).out).integrated, 1);
    const hook = JSON.parse(node(r.dir, "status.mjs", ["--hook"]).out);
    assert.equal(hook.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(hook.hookSpecificOutput.additionalContext, /unfinished.*wave 2 \(review\).*Run \/autopilot to resume/);
    const old = new Date(Date.now() - 72 * 3600 * 1000);
    utimesSync(ledger, old, old);
    assert.equal(node(r.dir, "status.mjs", ["--hook"]).out, "", "stale ledger: silent");
  } finally {
    r.cleanup();
  }
});
