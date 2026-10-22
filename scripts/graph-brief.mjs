#!/usr/bin/env node
// Look the code graph up ON BEHALF of an agent and write the answer to a small file,
// so the agent reads one file instead of being trusted to run graph queries itself.
// Reads graphify-out/graph.json directly: no model tokens, no subprocess per query.
//
//   node graph-brief.mjs task <brief.md> <out.md>     card for an implementer: each label on
//                                                     the brief's Graph line, where it lives,
//                                                     what it uses, and what depends on it
//   node graph-brief.mjs diff <BASE> <out.md>         impact for a reviewer: each symbol
//                                                     changed since BASE and the callers and
//                                                     importers the diff did NOT touch
//   [--graph <path>]  defaults to ./graphify-out/graph.json
//
// Prints one line ("card: ..." or "impact: ...") and always exits 0.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Edges that mean "the source depends on the target". `contains` and `method` are structure.
const DEPENDS = new Set(["calls", "indirect_call", "references", "imports", "imports_from", "dynamic_import", "re_exports", "inherits", "extends", "implements", "uses", "mixes_in", "embeds", "requires"]);
const MAX_ROWS = 20;

const lineOf = (loc) => Number(/L(\d+)/.exec(String(loc ?? ""))?.[1] ?? 0);
const where = (n) => `${n.source_file || "?"}${n.source_location ? `:${n.source_location}` : ""}`;
const norm = (s) => String(s).trim().toLowerCase();
const isCode = (n) => (n.file_type ?? "code") === "code";

export function loadGraph(path) {
  const g = JSON.parse(readFileSync(path, "utf8"));
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const uses = new Map(); // id -> [{node, relation, at}] : what it depends on
  const usedBy = new Map(); // id -> [{node, relation, at}] : what depends on it
  const parent = new Map(); // id -> containing node
  const push = (m, k, v) => (m.get(k) ?? m.set(k, []).get(k)).push(v);
  for (const e of g.links || g.edges || []) {
    const a = nodes.get(e.source);
    const b = nodes.get(e.target);
    if (!a || !b) continue;
    // Documents that mention a symbol (plans, READMEs) are not code that breaks.
    if (!isCode(a) || !isCode(b)) continue;
    if (e.relation === "contains" || e.relation === "method") {
      parent.set(b.id, a);
      continue;
    }
    if (!DEPENDS.has(e.relation)) continue;
    // The edge sits in the dependent's file. Trust that over stored order, which an
    // undirected export does not guarantee.
    let dependent = a;
    let dependency = b;
    if (a.source_file !== b.source_file && e.source_file === b.source_file) [dependent, dependency] = [b, a];
    const at = `${e.source_file || dependent.source_file}${e.source_location ? `:${e.source_location}` : ""}`;
    const tag = e.confidence && e.confidence !== "EXTRACTED" ? ` ${e.confidence}` : "";
    push(uses, dependent.id, { node: dependency, relation: e.relation + tag, at });
    push(usedBy, dependency.id, { node: dependent, relation: e.relation + tag, at });
  }
  return { nodes, uses, usedBy, parent };
}

/** Nodes a label on a Graph line refers to: exact label first, then looser forms. */
export function resolveLabel(graph, label) {
  const all = [...graph.nodes.values()].filter(isCode);
  const want = norm(label);
  const bare = want.replace(/\(\)$/, "").replace(/^\./, "");
  for (const test of [(n) => n.label === label.trim(), (n) => norm(n.label) === want || n.norm_label === want, (n) => norm(n.label).replace(/\(\)$/, "").replace(/^\./, "") === bare]) {
    const hit = all.filter(test);
    if (hit.length) return hit;
  }
  return [];
}

function rows(list, { skipFiles = null } = {}) {
  const seen = new Set();
  const out = [];
  for (const r of list) {
    if (skipFiles && skipFiles.has(r.node.source_file)) continue;
    const key = `${r.node.id}|${r.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out.sort((x, y) => x.at.localeCompare(y.at));
}
const fmt = (list) => {
  const shown = list.slice(0, MAX_ROWS).map((r) => `- ${r.node.label} [${r.relation}] ${r.at}`);
  if (list.length > MAX_ROWS) shown.push(`- ... and ${list.length - MAX_ROWS} more: \`graphify affected "<label>"\` lists them all`);
  return shown;
};

export function taskCard(graph, briefText) {
  const line = /^\*\*Graph:\*\*\s*(.+)$/m.exec(briefText)?.[1] ?? "";
  let labels = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  if (!labels.length && line && !/^\s*(none|<)/i.test(line)) labels = line.split(",").map((s) => s.trim()).filter(Boolean);
  const out = ["# Graph card", "", "Looked up from the code graph for the labels on this brief's `Graph` line. Structure as of the wave's start: the source is the authority on behaviour, and code written in this task is not here.", ""];
  let resolved = 0;
  let dependents = 0;
  for (const label of labels) {
    const hits = resolveLabel(graph, label);
    if (!hits.length) {
      out.push(`## ${label}`, "Not in the graph: it is new code, or the label is spelled differently in the source. Find it with `graphify query`.", "");
      continue;
    }
    resolved++;
    for (const n of hits) {
      const direct = rows(graph.usedBy.get(n.id) ?? []);
      const directIds = new Set(direct.map((r) => r.node.id));
      const indirect = rows(direct.flatMap((r) => graph.usedBy.get(r.node.id) ?? [])).filter((r) => !directIds.has(r.node.id) && r.node.id !== n.id);
      const own = rows(graph.uses.get(n.id) ?? []);
      dependents += direct.length + indirect.length;
      const p = graph.parent.get(n.id);
      out.push(`## ${n.label}`, `Lives at ${where(n)}${p ? `, inside ${p.label}` : ""}.`);
      out.push("", `**Depends on it directly (${direct.length})**, each yours to update or test when you change it:`, ...(direct.length ? fmt(direct) : ["- nothing in the graph"]));
      if (indirect.length) out.push("", `**Reaches it through those (${indirect.length}):**`, ...fmt(indirect));
      if (own.length) out.push("", `**It uses (${own.length}):**`, ...fmt(own));
      out.push("");
    }
  }
  if (!labels.length) out.push("The brief's `Graph` line names no labels. Find what you need with `graphify query`.", "");
  return { text: out.join("\n"), labels: labels.length, resolved, dependents };
}

/** Changed line ranges on the new side of a zero-context diff, per file. */
export function changedRanges(diff) {
  const files = new Map();
  const deleted = [];
  let file = null;
  let old = null;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("--- ")) old = raw.slice(4).trim().replace(/^a\//, "");
    else if (raw.startsWith("+++ ")) {
      const p = raw.slice(4).trim();
      if (p === "/dev/null") {
        if (old && old !== "/dev/null") deleted.push(old);
        file = null;
      } else {
        file = p.replace(/^b\//, "");
        if (!files.has(file)) files.set(file, []);
      }
    } else {
      const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (h && file) {
        const start = Number(h[1]);
        const count = h[2] === undefined ? 1 : Number(h[2]);
        files.get(file).push([start, start + Math.max(count, 1) - 1]);
      }
    }
  }
  return { files, deleted };
}

export function diffImpact(graph, diff) {
  const { files, deleted } = changedRanges(diff);
  const touched = new Set(files.keys());
  const byFile = new Map();
  for (const n of graph.nodes.values()) if (isCode(n) && touched.has(n.source_file)) (byFile.get(n.source_file) ?? byFile.set(n.source_file, []).get(n.source_file)).push(n);
  const changed = new Map();
  const unmapped = [];
  for (const [file, ranges] of files) {
    const nodes = (byFile.get(file) ?? []).sort((a, b) => lineOf(a.source_location) - lineOf(b.source_location));
    if (!nodes.length) {
      unmapped.push(file);
      continue;
    }
    const fileNode = nodes.find((n) => lineOf(n.source_location) <= 1 && !graph.parent.get(n.id) && /\.[a-z0-9]+$/i.test(n.label));
    const symbols = nodes.filter((n) => n !== fileNode);
    for (const [start, end] of ranges) {
      const inside = symbols.filter((n) => lineOf(n.source_location) >= start && lineOf(n.source_location) <= end);
      const before = symbols.filter((n) => lineOf(n.source_location) <= start);
      const owner = before[before.length - 1];
      const hit = [...new Set([...inside, ...(owner ? [owner] : [])])];
      for (const n of hit.length ? hit : fileNode ? [fileNode] : []) changed.set(n.id, n);
      // A change to a file is a change to what importers of the file see.
      if (fileNode && (graph.usedBy.get(fileNode.id) ?? []).length) changed.set(fileNode.id, fileNode);
    }
  }
  const entries = [...changed.values()]
    .map((n) => {
      const all = rows(graph.usedBy.get(n.id) ?? []);
      const outside = rows(all, { skipFiles: touched });
      return { n, outside, inside: all.length - outside.length };
    })
    .sort((a, b) => b.outside.length - a.outside.length || where(a.n).localeCompare(where(b.n)));
  // A file-level entry that only repeats files already listed under one of its symbols is noise.
  const isFileNode = (n) => lineOf(n.source_location) <= 1 && !graph.parent.get(n.id) && /\.[a-z0-9]+$/i.test(n.label);
  const covered = new Set(entries.filter((e) => !isFileNode(e.n)).flatMap((e) => e.outside.map((r) => r.node.source_file)));
  for (const e of entries) if (isFileNode(e.n) && e.outside.every((r) => covered.has(r.node.source_file))) e.outside = [];
  const total = entries.reduce((s, e) => s + e.outside.length, 0);
  const out = ["# Graph impact", "", "Every symbol the diff changed, with the callers and importers the diff did NOT touch, looked up from the code graph. Each one is a place the change can break without appearing in the diff: check it against the change. An edge tagged INFERRED or AMBIGUOUS is the graph's guess: confirm it in the source.", ""];
  const withDeps = entries.filter((e) => e.outside.length);
  for (const e of withDeps.slice(0, 40)) out.push(`## ${e.n.label} (${where(e.n)})`, `Untouched dependents (${e.outside.length}):`, ...fmt(e.outside), "");
  if (withDeps.length > 40) out.push(`... and ${withDeps.length - 40} more changed symbols with untouched dependents.`, "");
  const quiet = entries.filter((e) => !e.outside.length);
  if (quiet.length) out.push(`Changed with no dependent outside the diff (${quiet.length}): ${quiet.slice(0, 30).map((e) => e.n.label).join(", ")}${quiet.length > 30 ? ", ..." : ""}`, "");
  if (deleted.length) out.push(`Deleted files (${deleted.length}), no longer in the graph, so search the code for leftover references by name: ${deleted.join(", ")}`, "");
  if (unmapped.length) out.push(`Changed files the graph has no symbols for (${unmapped.length}): ${unmapped.slice(0, 30).join(", ")}${unmapped.length > 30 ? ", ..." : ""}`, "");
  if (!entries.length && !deleted.length) out.push("The diff changed no symbol the graph knows.", "");
  return { text: out.join("\n"), symbols: entries.length, untouched: total, deleted: deleted.length };
}

function main() {
  const argv = process.argv.slice(2);
  const gi = argv.indexOf("--graph");
  const graphPath = resolve(gi >= 0 ? argv.splice(gi, 2)[1] : "graphify-out/graph.json");
  const [mode, subject, outFile] = argv;
  const kind = mode === "diff" ? "impact" : "card";
  if (!["task", "diff"].includes(mode) || !subject || !outFile) {
    console.error("usage: node graph-brief.mjs task <brief.md> <out.md> | diff <BASE> <out.md>  [--graph <path>]");
    return;
  }
  if (!existsSync(graphPath)) return console.log(`${kind}: none (no graph at ${graphPath})`);
  let graph;
  try {
    graph = loadGraph(graphPath);
  } catch (e) {
    return console.log(`${kind}: none (graph unreadable: ${e.message})`);
  }
  let result;
  let line;
  if (mode === "task") {
    if (!existsSync(subject)) return console.log(`card: none (no brief at ${subject})`);
    result = taskCard(graph, readFileSync(subject, "utf8"));
    if (!result.labels) return console.log("card: none (the brief's Graph line names no labels)");
    line = `card: ${result.resolved} of ${result.labels} labels found, ${result.dependents} dependents -> ${resolve(outFile)}`;
  } else {
    const d = spawnSync("git", ["diff", "--unified=0", "--no-color", "--no-ext-diff", "--no-renames", `${subject}..HEAD`], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (d.status !== 0) return console.log(`impact: none (git diff ${subject}..HEAD failed)`);
    result = diffImpact(graph, d.stdout);
    line = `impact: ${result.symbols} changed symbols, ${result.untouched} dependents the diff did not touch${result.deleted ? `, ${result.deleted} deleted files` : ""} -> ${resolve(outFile)}`;
  }
  mkdirSync(dirname(resolve(outFile)), { recursive: true });
  writeFileSync(outFile, result.text);
  console.log(line);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.log(`graph-brief: none (${e.message})`);
  }
  process.exit(0);
}
