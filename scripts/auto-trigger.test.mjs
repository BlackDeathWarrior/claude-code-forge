// Run: node auto-trigger.test.mjs
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "./auto-trigger.mjs";

const here = dirname(fileURLToPath(import.meta.url));

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

let failed = 0;
for (const p of TRIGGER) if (classify(p) !== "first") (failed++, console.log(`FAIL (should trigger): ${p}`));
for (const p of PASS) if (classify(p) !== null) (failed++, console.log(`FAIL (should pass untouched): ${p}`));
if (classify(TRIGGER[0], { nudgedBefore: true }) !== "again") (failed++, console.log("FAIL: second nudge in a session should be the short one"));
if (classify("here is the log:\n```\nbuild failed: add feature to app\n```\nwhat went wrong?") !== null) (failed++, console.log("FAIL: words inside a code block should not trigger"));

// End to end, the way the harness calls it.
const run = (payload, env = {}) => spawnSync(process.execPath, [join(here, "auto-trigger.mjs")], { input: payload, encoding: "utf8", env: { ...process.env, ...env } });
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
const checks = [
  ["first nudge names the skill", first.status === 0 && /call the Skill tool with `autopilot`/.test(ctx(first) || "")],
  ["first nudge is valid hook JSON", JSON.parse(first.stdout).hookSpecificOutput.hookEventName === "UserPromptSubmit"],
  ["second nudge is the short reminder", second.status === 0 && /^\[autopilot\] Reminder/.test(ctx(second) || "")],
  ["a question prints nothing", quiet.status === 0 && quiet.stdout === ""],
  ["AUTOPILOT_AUTO=0 prints nothing", off.status === 0 && off.stdout === ""],
  ["bad input exits 0 silently", junk.status === 0 && junk.stdout === ""],
];
for (const [name, ok] of checks) if (!ok) (failed++, console.log(`FAIL: ${name}`));

const total = TRIGGER.length + PASS.length + 2 + checks.length;
console.log(failed ? `${failed} of ${total} failed` : `all ${total} passed`);
process.exit(failed ? 1 : 0);
