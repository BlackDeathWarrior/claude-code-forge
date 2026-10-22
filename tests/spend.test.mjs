import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { node, tempDir } from "./helpers.mjs";
import { collect, render } from "../scripts/spend.mjs";

const turn = (id, iso, { cr = 0, cw = 0, out = 10, inp = 1 } = {}, model = "claude-sonnet-5-5") =>
  JSON.stringify({ timestamp: iso, message: { id, role: "assistant", model, usage: { input_tokens: inp, cache_read_input_tokens: cr, cache_creation_input_tokens: cw, output_tokens: out } } });

function fixture() {
  const t = tempDir();
  const proj = join(t.dir, "projects", "-p");
  mkdirSync(join(proj, "sess", "subagents"), { recursive: true });
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 10 * 60e3).toISOString(); // 10 minutes on: the 5 minute cache has expired
  writeFileSync(join(proj, "main.jsonl"), [turn("a", now, { cw: 30000 }), turn("b", later, { cr: 30000, cw: 500 }), "not json"].join("\n"));
  const sub = join(proj, "sess", "subagents", "agent-1");
  writeFileSync(`${sub}.meta.json`, JSON.stringify({ agentType: "autopilot-coder" }));
  // a subagent whose second turn re-writes the whole 40k context after 10 idle minutes, and repeats a streamed line
  writeFileSync(`${sub}.jsonl`, [turn("s1", now, { cw: 40000 }), turn("s1", now, { cw: 40000 }), turn("s2", later, { cr: 100, cw: 40100 })].join("\n"));
  return t;
}

test("spend totals tokens by day, agent type and cache misses, and counts a streamed line once", async () => {
  const t = fixture();
  try {
    const r = await collect(join(t.dir, "projects"), 7);
    const coder = r.kinds.get("autopilot-coder");
    assert.equal(coder.agents, 1);
    assert.equal(coder.turns, 2);
    assert.equal(coder.cw, 80100);
    assert.equal(Math.round(coder.first / coder.agents), 40001); // baseline: context at the first turn
    assert.equal(r.kinds.get("main").turns, 2);
    const ttl = r.miss.get("sub|ttl (>5 min idle)");
    assert.equal(ttl.n, 1);
    assert.equal(ttl.cw, 40100);
    assert.match(render(r, 7), /autopilot-coder/);
  } finally {
    t.cleanup();
  }
});

test("spend runs from the command line and says so when there is nothing to read", async () => {
  const t = fixture();
  try {
    const out = node(t.dir, "spend.mjs", ["7", "--dir", join(t.dir, "projects")]);
    assert.equal(out.status, 0);
    assert.match(out.out, /cache misses/);
    assert.match(node(t.dir, "spend.mjs", ["--dir", join(t.dir, "nope")]).out, /no transcripts/);
  } finally {
    t.cleanup();
  }
});
