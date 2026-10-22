#!/usr/bin/env node
// Where a build stands, read from its ledger. No model tokens, always exits 0.
//
//   node status.mjs [plan directory | ledger.md]   one line; the newest ledger under .autopilot/ when none is given
//   node status.mjs --json [path]                  the same as an object
//   node status.mjs --hook                         SessionStart hook: tells the session about an unfinished build, else silent
//
// A build is unfinished when its ledger has no `finish:` or `STOP:` line and was touched in the last 48 hours.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const STALE_MS = 48 * 3600 * 1000;
const RANK = { dispatched: 1, done: 2, integrated: 3 };

/** Parse ledger text (and the plan's task table, when given) into counts and the last event. */
export function parseLedger(text, planText = "") {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const plan = /^# autopilot ledger:\s*(.+)$/.exec(lines[0] ?? "")?.[1]?.trim() ?? null;
  const tasks = new Map(); // id -> state
  let wave = 0;
  let waveStep = "";
  let finish = null;
  let stop = null;
  for (const l of lines) {
    let m;
    if ((m = /^task (\d+):\s*(dispatched|done|integrated|blocked|parked)/.exec(l))) {
      const [, id, st] = m;
      const prev = tasks.get(id);
      if (st === "blocked" || st === "parked") tasks.set(id, st);
      else if (!prev || prev === "blocked" || RANK[st] > (RANK[prev] ?? 0)) tasks.set(id, st);
      if (st === "dispatched" && (m = /wave (\d+)/.exec(l))) wave = Math.max(wave, Number(m[1]));
    } else if ((m = /^wave (\d+):\s*(\w+)/.exec(l))) {
      wave = Math.max(wave, Number(m[1]));
      waveStep = m[2];
    } else if ((m = /^finish:\s*(.+)$/.exec(l))) finish = m[1].trim();
    else if ((m = /^STOP:\s*(.+)$/.exec(l))) stop = m[1].trim();
  }
  const count = (st) => [...tasks.values()].filter((s) => s === st).length;
  const rows = [...planText.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) => m[1]);
  const total = rows.length || tasks.size;
  return {
    plan,
    total,
    integrated: count("integrated"),
    inFlight: count("dispatched") + count("done"),
    parked: count("parked") + count("blocked"),
    wave,
    waveStep,
    last: lines[lines.length - 1] ?? "",
    finish,
    stop,
    running: !finish && !stop,
  };
}

function ledgerPaths(root) {
  const ap = join(root, ".autopilot");
  if (!existsSync(ap)) return [];
  return readdirSync(ap, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ap, e.name, "ledger.md")))
    .map((e) => join(ap, e.name, "ledger.md"))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

/** Read one ledger and its plan. */
export function readStatus(ledger) {
  const text = readFileSync(ledger, "utf8");
  const first = /^# autopilot ledger:\s*(.+)$/m.exec(text)?.[1]?.trim();
  let planText = "";
  try {
    if (first) planText = readFileSync(join(first, "plan.md"), "utf8").split(/^## Task graph/m)[1] ?? "";
  } catch {}
  const s = parseLedger(text, planText);
  s.ledger = ledger.replace(/\\/g, "/");
  s.fresh = Date.now() - statSync(ledger).mtimeMs < STALE_MS;
  return s;
}

const oneLine = (s) => {
  const name = s.plan ? s.plan.replace(/\\/g, "/").split("/").pop() : "build";
  const parts = [`${s.integrated}/${s.total} tasks integrated`];
  if (s.inFlight) parts.push(`${s.inFlight} in flight`);
  if (s.parked) parts.push(`${s.parked} parked`);
  if (s.wave) parts.push(`wave ${s.wave}${s.waveStep ? ` (${s.waveStep})` : ""}`);
  const end = s.finish ? ` - finished: ${s.finish}` : s.stop ? ` - stopped: ${s.stop}` : "";
  return `autopilot ${name}: ${parts.join(", ")}${end}. Last: ${s.last.slice(0, 100)}`;
};

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const hook = argv.includes("--hook");
  const arg = argv.find((a) => !a.startsWith("--"));
  let ledger = null;
  if (arg) {
    const p = resolve(arg);
    ledger = /ledger\.md$/.test(p) ? p : existsSync(join(p, "ledger.md")) ? join(p, "ledger.md") : join(resolve(".autopilot"), p.split(/[\\/]/).pop(), "ledger.md");
  } else {
    let input = {};
    if (hook) {
      try {
        input = JSON.parse(readFileSync(0, "utf8"));
      } catch {}
    }
    for (let dir = resolve(input.cwd || process.cwd()); ; dir = dirname(dir)) {
      const found = ledgerPaths(dir);
      if (found.length || dirname(dir) === dir) {
        ledger = found[0] ?? null;
        break;
      }
    }
  }
  if (!ledger || !existsSync(ledger)) return hook ? undefined : console.log("autopilot: no build found under .autopilot/");
  const s = readStatus(ledger);
  if (hook) {
    if (!s.running || !s.fresh) return;
    const msg = `[autopilot] An /autopilot build is unfinished: ${oneLine(s)}. Ledger: ${s.ledger}. Run /autopilot to resume it, or ignore this if the work is no longer wanted.`;
    return console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: msg } }));
  }
  console.log(json ? JSON.stringify(s) : oneLine(s));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.log(`autopilot: status unavailable (${e.message})`);
  }
  process.exit(0);
}
