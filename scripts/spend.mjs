#!/usr/bin/env node
// Where did the Claude Code tokens go? Reads the session transcripts under ~/.claude/projects.
// No model tokens. Always exits 0.
//
//   node spend.mjs [days]            by day, by agent type, and cache misses; default 7 days
//   node spend.mjs --dir <projects>  read another projects directory (default: $CLAUDE_CONFIG_DIR/projects or ~/.claude/projects)
//
// "w-units" weigh tokens like API prices relative to a fresh input token (cache read 0.1, cache write 1.25,
// output 5). They rank cost; Anthropic does not publish how a subscription's weekly limit counts cache
// tokens, so read them as a guide, not as your quota.
//
// A cache miss is a turn that re-wrote most of the previous context: after more than 5 idle minutes
// the 5 minute cache expired (long builds and test runs), otherwise the context was compacted or changed.
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const M = (n) => `${(n / 1e6).toFixed(1)}M`;
const weigh = (cr, cw, out, inp = 0) => inp + 0.1 * cr + 1.25 * cw + 5 * out;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".jsonl")) yield p;
  }
}

function agentType(path) {
  if (!/[\\/]subagents[\\/]/.test(path)) return null;
  try {
    return JSON.parse(readFileSync(path.replace(/\.jsonl$/, ".meta.json"), "utf8")).agentType || "?";
  } catch {
    return "?";
  }
}

/** Totals for every transcript under `root` touched since `days` ago. */
export async function collect(root, days = 7, now = Date.now()) {
  const cut = now - days * 86400e3;
  const day = new Map(); // "date|kind|model" -> counters
  const kinds = new Map(); // agent type -> counters
  const miss = new Map(); // "who|kind" -> { n, cw }
  const bump = (map, key) => map.get(key) ?? map.set(key, { turns: 0, cr: 0, cw: 0, out: 0, w: 0, agents: 0, first: 0 }).get(key);

  for (const path of walk(root)) {
    if (statSync(path).mtimeMs < cut) continue;
    const type = agentType(path);
    const sub = type !== null;
    const label = type ?? "main";
    const seen = new Set();
    let prev = null;
    let prevT = 0;
    let n = 0;
    const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"usage"')) continue;
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      const m = d.message ?? {};
      const u = m.usage;
      if (!u || m.role !== "assistant") continue;
      const key = `${m.id}|${u.output_tokens}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const t = Date.parse(d.timestamp);
      const cr = u.cache_read_input_tokens ?? 0;
      const cw = u.cache_creation_input_tokens ?? 0;
      const out = u.output_tokens ?? 0;
      const inp = u.input_tokens ?? 0;
      const ctx = cr + cw + inp;
      n++;
      if (t >= cut) {
        const model = String(m.model ?? "?").replace("claude-", "").replace("-5-5", "");
        for (const c of [bump(day, `${d.timestamp.slice(0, 10)}|${sub ? "sub" : "main"}|${model}`), bump(kinds, label)]) {
          c.turns++; c.cr += cr; c.cw += cw; c.out += out; c.w += weigh(cr, cw, out, inp);
        }
        if (n === 1) {
          const k = bump(kinds, label);
          k.agents++; k.first += ctx;
        }
        if (prev !== null && ctx > 20000 && cr < 0.5 * prev) {
          const mk = `${sub ? "sub" : "main"}|${t - prevT >= 300e3 ? "ttl (>5 min idle)" : "compact/other"}`;
          const e = miss.get(mk) ?? miss.set(mk, { n: 0, cw: 0 }).get(mk);
          e.n++; e.cw += cw;
        }
      }
      prev = ctx;
      prevT = t;
    }
  }
  return { day, kinds, miss };
}

export function render({ day, kinds, miss }, days) {
  const out = [`== last ${days} days: tokens by day / kind / model`];
  out.push(`${"day".padEnd(11)}${"kind".padEnd(5)}${"model".padEnd(10)}${"turns".padStart(7)}${"cacheRd".padStart(10)}${"cacheWr".padStart(9)}${"out".padStart(7)}${"w-units".padStart(9)}`);
  let total = 0;
  for (const [k, c] of [...day].sort(([a], [b]) => a.localeCompare(b))) {
    const [d, kind, model] = k.split("|");
    total += c.w;
    out.push(`${d.padEnd(11)}${kind.padEnd(5)}${model.padEnd(10)}${String(c.turns).padStart(7)}${M(c.cr).padStart(10)}${M(c.cw).padStart(9)}${M(c.out).padStart(7)}${M(c.w).padStart(9)}`);
  }
  out.push(`total w-units ${M(total)}`, "", "== by agent type (main = the session you type in; baseline = context at an agent's first turn)");
  out.push(`${"type".padEnd(28)}${"agents".padStart(7)}${"turns".padStart(7)}${"t/agent".padStart(8)}${"baseline".padStart(9)}${"cacheRd".padStart(9)}${"cacheWr".padStart(9)}${"w-units".padStart(9)}`);
  for (const [k, c] of [...kinds].sort(([, a], [, b]) => b.w - a.w)) {
    const a = c.agents || 1;
    out.push(`${k.padEnd(28)}${String(c.agents).padStart(7)}${String(c.turns).padStart(7)}${(c.turns / a).toFixed(0).padStart(8)}${`${(c.first / a / 1e3).toFixed(0)}k`.padStart(9)}${M(c.cr).padStart(9)}${M(c.cw).padStart(9)}${M(c.w).padStart(9)}`);
  }
  out.push("", "== cache misses (most of the previous context was re-written)");
  for (const [k, e] of [...miss].sort(([a], [b]) => a.localeCompare(b))) {
    const [who, kind] = k.split("|");
    out.push(`${who.padEnd(5)}${kind.padEnd(20)}${String(e.n).padStart(5)} events  ${M(e.cw)} tokens re-written`);
  }
  return out.join("\n");
}

async function main(argv) {
  let days = 7;
  let root = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") root = argv[++i];
    else if (/^\d+$/.test(argv[i])) days = Number(argv[i]);
  }
  if (!existsSync(root)) {
    console.log(`spend: no transcripts at ${root}`);
    return 0;
  }
  console.log(render(await collect(root, days), days));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main(process.argv.slice(2)));
