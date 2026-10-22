#!/usr/bin/env node
// UserPromptSubmit hook: route build requests into /autopilot without the user typing it.
// Reads the hook's JSON on stdin. When the prompt looks like a request to build or
// change software, prints a short routing note that Claude reads alongside the prompt.
// Prints nothing for everything else, so ordinary prompts cost no extra tokens.
// Never blocks a prompt and always exits 0.
//
// Off switches: create the file ~/.claude/autopilot-auto.off, or set AUTOPILOT_AUTO=0.
// For one prompt: start it with "quick:" or include "no autopilot".
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const BUILD_VERB = /\b(build|implement|create|develop|add|make|write|code (?:me |up )?(?:a|an|the)|scaffold|set ?up|integrate|refactor|migrate|redesign|rewrite|rework|fix|port|convert|ship|generate|extend|overhaul|introduce|wire up|hook up)\b/i;
// What a build request acts on. A verb alone ("make sense", "add up") is not enough.
const BUILD_OBJECT = /\b(app|application|website|web ?site|site|page|landing page|dashboard|feature|endpoint|api|service|server|backend|frontend|front-end|back-end|ui|ux|screen|component|form|button|modal|flow|auth|authentication|login|sign ?up|checkout|payment|database|schema|migration|table|query|model|module|function|class|script|cli|tool|bot|plugin|extension|library|package|test|tests|bug|error|crash|issue|pipeline|workflow|integration|webhook|cron|job|worker|queue|cache|search|upload|export|import|report|chart|notification|email|sms|chat|game|crm|system|platform|mvp|prototype|project|repo|codebase|code)\b/i;
// Messages the harness delivers as prompts that no person typed.
const MACHINE = /<task-notification>|\[Subagent hand-back\]|<agent-message|\[SYSTEM NOTIFICATION|<cross-session-message|<ci-monitor-event>|\[Artifact comment sent to Claude\]/;

const FIRST = [
  "[autopilot] This prompt looks like a request to build or change software.",
  "If it is multi-step work on a codebase (an app, a feature, a refactor, a fix that needs more than one small edit) and the autopilot pipeline is not already running for this same work in this conversation, call the Skill tool with `autopilot`, passing the user's request as its arguments, before doing anything else.",
  "Answer directly, without autopilot, when it is a question, an explanation, a review, a change you can finish correctly in one edit of a few lines, or not about a codebase.",
  "The user skips the pipeline for one prompt by starting it with `quick:`.",
].join(" ");
const AGAIN = "[autopilot] Reminder: a new multi-step build request goes through the `autopilot` skill; anything that continues the run already in progress in this conversation simply continues it.";

/** "first", "again", or null for a prompt that should pass untouched. */
export function classify(prompt, { nudgedBefore = false } = {}) {
  if (typeof prompt !== "string") return null;
  const text = prompt.trim();
  if (text.length < 15) return null; // an answer, not a request
  if (text.startsWith("/")) return null; // a slash command, /autopilot included
  if (/^quick\s*[:,-]/i.test(text) || /\bno autopilot\b/i.test(text)) return null;
  if (MACHINE.test(text)) return null;
  // Look at what the person wrote, not at pasted logs or code.
  // A request someone quotes ("what happens if I say: 'add a feature'?") is being asked about, not made.
  const own = text
    .replace(/<pasted_content[\s\S]*?<\/pasted_content[^>]*>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/"[^"\n]{10,}"|“[^”\n]{10,}”/g, " ")
    .slice(0, 2000);
  if (!BUILD_VERB.test(own) || !BUILD_OBJECT.test(own)) return null;
  return nudgedBefore ? "again" : "first";
}

function stateFile(sessionId) {
  const dir = join(homedir(), ".claude", "autopilot-state");
  mkdirSync(dir, { recursive: true });
  // Forget sessions older than a week.
  try {
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    for (const f of readdirSync(dir)) if (statSync(join(dir, f)).mtimeMs < cutoff) rmSync(join(dir, f), { force: true });
  } catch {}
  return join(dir, String(sessionId || "unknown").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80));
}

function main() {
  if (process.env.AUTOPILOT_AUTO === "0") return;
  if (existsSync(join(homedir(), ".claude", "autopilot-auto.off"))) return;
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  let file = null;
  let nudgedBefore = false;
  try {
    file = stateFile(input.session_id);
    nudgedBefore = existsSync(file);
  } catch {}
  const kind = classify(input.prompt, { nudgedBefore });
  if (!kind) return;
  try {
    if (file) writeFileSync(file, new Date().toISOString());
  } catch {}
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: kind === "first" ? FIRST : AGAIN } }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch {}
  process.exit(0);
}
