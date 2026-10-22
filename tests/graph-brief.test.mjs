import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { changedRanges, diffImpact, loadGraph, resolveLabel, taskCard } from "../scripts/graph-brief.mjs";
import { node, tempDir, tempRepo } from "./helpers.mjs";

// invoiceTotal() in src/tax.ts is called by checkout() in src/checkout.ts and by report() in src/report.ts.
const GRAPH = {
  nodes: [
    { id: "tax", label: "tax.ts", source_file: "src/tax.ts", source_location: "L1", file_type: "code" },
    { id: "total", label: "invoiceTotal()", source_file: "src/tax.ts", source_location: "L10", file_type: "code" },
    { id: "co", label: "checkout()", source_file: "src/checkout.ts", source_location: "L5", file_type: "code" },
    { id: "rep", label: "report()", source_file: "src/report.ts", source_location: "L3", file_type: "code" },
    { id: "doc", label: "invoiceTotal in plan", source_file: "docs/plan.md", file_type: "document" },
  ],
  links: [
    { source: "tax", target: "total", relation: "contains", source_file: "src/tax.ts" },
    { source: "co", target: "total", relation: "calls", source_file: "src/checkout.ts", source_location: "L7" },
    { source: "rep", target: "total", relation: "calls", source_file: "src/report.ts", source_location: "L4", confidence: "INFERRED" },
    { source: "doc", target: "total", relation: "references", source_file: "docs/plan.md" },
  ],
};

function withGraph(fn) {
  const t = tempDir();
  try {
    const path = join(t.dir, "graph.json");
    writeFileSync(path, JSON.stringify(GRAPH));
    return fn(loadGraph(path), t.dir, path);
  } finally {
    t.cleanup();
  }
}

test("resolveLabel matches exactly, then loosely, and ignores documents", () => {
  withGraph((g) => {
    assert.deepEqual(resolveLabel(g, "invoiceTotal()").map((n) => n.id), ["total"]);
    assert.deepEqual(resolveLabel(g, "invoiceTotal").map((n) => n.id), ["total"]);
    assert.deepEqual(resolveLabel(g, "INVOICETOTAL()").map((n) => n.id), ["total"]);
    assert.deepEqual(resolveLabel(g, "nothing"), []);
  });
});

test("a task card lists what depends on each label, and marks guesses", () => {
  withGraph((g) => {
    const card = taskCard(g, "**Graph:** `invoiceTotal()`, `newThing()`\n");
    assert.deepEqual([card.labels, card.resolved, card.dependents], [2, 1, 2]);
    assert.match(card.text, /checkout\(\) \[calls\] src\/checkout\.ts:L7/);
    assert.match(card.text, /report\(\) \[calls INFERRED\]/);
    assert.ok(!/docs\/plan\.md/.test(card.text.split("## newThing()")[0].split("It uses")[0]), "documents are not dependents");
    assert.match(card.text, /## newThing\(\)\nNot in the graph/);
    assert.equal(taskCard(g, "**Graph:** none\n").labels, 0);
  });
});

test("changedRanges reads new-side ranges and deleted files", () => {
  const d = ["--- a/src/tax.ts", "+++ b/src/tax.ts", "@@ -10,2 +10,3 @@", "--- a/src/gone.ts", "+++ /dev/null", "@@ -1,4 +0,0 @@"].join("\n");
  const r = changedRanges(d);
  assert.deepEqual(r.files.get("src/tax.ts"), [[10, 12]]);
  assert.deepEqual(r.deleted, ["src/gone.ts"]);
});

test("impact: a changed symbol lists the callers the diff did not touch", () => {
  withGraph((g) => {
    const diff = ["--- a/src/tax.ts", "+++ b/src/tax.ts", "@@ -11,1 +11,2 @@", "--- a/src/checkout.ts", "+++ b/src/checkout.ts", "@@ -7,1 +7,1 @@"].join("\n");
    const r = diffImpact(g, diff);
    assert.match(r.text, /## invoiceTotal\(\)/);
    assert.match(r.text, /report\(\) \[calls INFERRED\]/);
    assert.ok(!/## invoiceTotal\(\)[\s\S]*checkout\(\) \[calls\]/.test(r.text), "checkout is in the diff, so it is not 'untouched'");
  });
});

test("CLI: card and impact files are written, and a missing graph is a quiet 'none'", () => {
  const r = tempRepo({ "src/tax.ts": "export const a = 1;\n".repeat(12) });
  try {
    mkdirSync(join(r.dir, "graphify-out"));
    writeFileSync(join(r.dir, "graphify-out", "graph.json"), JSON.stringify(GRAPH));
    writeFileSync(join(r.dir, "brief.md"), "**Graph:** `invoiceTotal()`\n");
    const card = node(r.dir, "graph-brief.mjs", ["task", "brief.md", ".autopilot/graph/01.md"]);
    assert.equal(card.status, 0);
    assert.match(card.out, /^card: 1 of 1 labels found, 2 dependents/);
    assert.match(readFileSync(join(r.dir, ".autopilot", "graph", "01.md"), "utf8"), /# Graph card/);
    const base = r.git("rev-parse", "HEAD").out;
    r.write("src/tax.ts", "export const a = 1;\n".repeat(10) + "export const changed = 2;\n" + "export const a = 1;\n");
    r.commit("change");
    const impact = node(r.dir, "graph-brief.mjs", ["diff", base, "out/impact.md"]);
    assert.match(impact.out, /^impact: \d+ changed symbols/);
    const none = node(r.dir, "graph-brief.mjs", ["task", "brief.md", "x.md", "--graph", "missing.json"]);
    assert.equal(none.status, 0);
    assert.match(none.out, /^card: none \(no graph/);
  } finally {
    r.cleanup();
  }
});
