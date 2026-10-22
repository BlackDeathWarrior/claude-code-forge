// Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "../scripts/auto-trigger.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "auto-trigger.mjs");

const TRIGGER = [
  "Build me a CRM for WhatsApp leads with a dashboard",
  "add dark mode to the settings page",
  "Implement Stripe checkout for the booking flow",
  "can you create a REST API for tickets with auth?",
  "please fix the login bug where sessions expire early",
  "I want to refactor the payments module into smaller services",
  "set up a Postgres schema and migrations for the DSA app",
  "make a landing page for Horizon Travel",
  "we need to migrate the database from MySQL to Postgres",
  "write a script that exports the report to Excel",
  "Integrate the WhatsApp webhook into the ticketing system",
  "how do I add a feature flag system to this project",
];

const PASS = [
  "yes",
  "option 2",
  "looks good, approve",
  "what does this function do?",
  "explain how the session store works",
  "why is the sky blue and what makes sunsets red",
  "does that make sense to you at all",
  "thanks, that all adds up nicely now",
  "/autopilot build me a CRM",
  "/verify",
  "quick: add a console.log to the checkout function",
  "Quick - fix the typo in the login page title",
  "rename this variable, no autopilot please, just fix the code",
  "<task-notification><summary>Agent finished: build the app feature</summary></task-notification>",
  "[Subagent hand-back] STATUS: DONE implement feature tests pass",
  "tell me about your weekend plans and hobbies",
  "summarise this article for me in three bullet points",
  "what is the capital of France and its population",
  "does it also use a memory skill just like in everything claude code?",
  'so what if I say this in a new session : "I want to add these features to my existing app ....". What will the workflow look like?',
  "is the code in this repo any good, and what would you change first",
];

test("requests to build or change software trigger the nudge", () => {
  for (const p of TRIGGER) assert.equal(classify(p), "first", p);
});

test("questions, replies and small asks pass untouched", () => {
  for (const p of PASS) assert.equal(classify(p), null, p);
});

test("the second nudge in a session is the short one", () => {
  assert.equal(classify(TRIGGER[0], { nudgedBefore: true }), "again");
});

test("words inside a code block do not trigger", () => {
  assert.equal(classify("here is the log:\n```\nbuild failed: add feature to app\n```\nwhat went wrong?"), null);
});

// End to end, the way the harness calls it.
const stateDir = mkdtempSync(join(tmpdir(), "nudge-state-"));
const emptyHome = mkdtempSync(join(tmpdir(), "nudge-empty-home-")); // a host's own off or skill file must not change results
const run = (payload, env = {}) => spawnSync(process.execPath, [script], { input: payload, encoding: "utf8", env: { ...process.env, HOME: emptyHome, USERPROFILE: emptyHome, AUTOPILOT_SKILL: "", AUTOPILOT_AUTO: "", AUTOPILOT_STATE_DIR: stateDir, ...env } });
const sid = `test-${process.pid}-${Date.now()}`;
const first = run(JSON.stringify({ session_id: sid, prompt: TRIGGER[0], cwd: here, hook_event_name: "UserPromptSubmit" }));
const second = run(JSON.stringify({ session_id: sid, prompt: TRIGGER[1], cwd: here, hook_event_name: "UserPromptSubmit" }));
const quiet = run(JSON.stringify({ session_id: sid, prompt: "what does this function do?", cwd: here }));
const off = run(JSON.stringify({ session_id: `${sid}-off`, prompt: TRIGGER[0], cwd: here }), { AUTOPILOT_AUTO: "0" });
const junk = run("not json");
const ctx = (r) => {
  try {
    return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  } catch {
    return null;
  }
};
test("end to end: nudge once in full, then short; silent when off or on bad input", () => {
  const checks = [
    ["first nudge names the skill", first.status === 0 && /call the Skill tool with `autopilot-forge:autopilot`/.test(ctx(first) || "")],
    ["first nudge is valid hook JSON", JSON.parse(first.stdout).hookSpecificOutput.hookEventName === "UserPromptSubmit"],
    ["second nudge is the short reminder", second.status === 0 && /^\[autopilot\] Reminder/.test(ctx(second) || "")],
    ["a question prints nothing", quiet.status === 0 && quiet.stdout === ""],
    ["AUTOPILOT_AUTO=0 prints nothing", off.status === 0 && off.stdout === ""],
    ["bad input exits 0 silently", junk.status === 0 && junk.stdout === ""],
  ];
  for (const [name, ok] of checks) assert.ok(ok, name);
});

test("targetSkill: default, env override, file override, bad values ignored", async () => {
  const { targetSkill } = await import("../scripts/auto-trigger.mjs");
  const home = mkdtempSync(join(tmpdir(), "nudge-home-"));
  mkdirSync(join(home, ".claude"), { recursive: true });
  assert.equal(targetSkill({}, home), "autopilot-forge:autopilot");
  writeFileSync(join(home, ".claude", "autopilot-auto.skill"), "autopilot\n");
  assert.equal(targetSkill({}, home), "autopilot");
  assert.equal(targetSkill({ AUTOPILOT_SKILL: "my:skill" }, home), "my:skill");
  assert.equal(targetSkill({ AUTOPILOT_SKILL: "bad name`;rm" }, home), "autopilot");
});
