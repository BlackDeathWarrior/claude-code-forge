#!/usr/bin/env node
// Build or refresh the project's code graph (graphify) with no model tokens.
//   node graph-refresh.mjs            (run from the repository root)
// - No graph yet: `graphify extract . --code-only`, then a report with no LLM labels.
// - Graph exists: `graphify update .` (code only), forcing past the shrink guard
//   when code was really deleted.
// - Keeps an untracked graphify-out/ out of `git status` via .git/info/exclude.
// Prints one line starting "graph:" and always exits 0: the graph is an
// optimisation, never a gate.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const graph = join(root, "graphify-out", "graph.json");
const env = { ...process.env, GRAPHIFY_NO_TIPS: "1", GRAPHIFY_NO_CTA: "1", PYTHONIOENCODING: "utf-8" };

const done = (msg) => {
  console.log(`graph: ${msg}`);
  process.exit(0);
};
const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
const graphify = (...args) => spawnSync("graphify", args, { cwd: root, encoding: "utf8", env, shell: process.platform === "win32", timeout: 15 * 60 * 1000 });

function excludeFromGit() {
  if (git("rev-parse", "--is-inside-work-tree").status !== 0) return;
  const common = git("rev-parse", "--git-common-dir").stdout.trim();
  if (!common) return;
  const info = resolve(root, common, "info");
  const file = join(info, "exclude");
  // .autopilot/ holds run state (ledger, graph cards): never part of the repository or the graph.
  // graphify-out/ is left alone when the team tracks it in git.
  const wanted = [".autopilot/"];
  if (git("ls-files", "--error-unmatch", "graphify-out/graph.json").status !== 0) wanted.push("graphify-out/");
  for (const entry of wanted) {
    if (git("check-ignore", "-q", entry).status === 0) continue; // already ignored
    mkdirSync(info, { recursive: true });
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    appendFileSync(file, `${current.endsWith("\n") || !current ? "" : "\n"}${entry}\n`);
  }
}

function stats() {
  try {
    const g = JSON.parse(readFileSync(graph, "utf8"));
    const edges = g.links || g.edges || [];
    return `${g.nodes.length} nodes, ${edges.length} edges`;
  } catch {
    return null;
  }
}

try {
  execFileSync(process.platform === "win32" ? "where" : "which", ["graphify"], { stdio: "ignore" });
} catch {
  done("skipped (graphify is not installed; `uv tool install graphifyy` or `pip install graphifyy`)");
}

excludeFromGit();

if (existsSync(graph)) {
  let r = graphify("update", ".");
  let forced = false;
  if (r.status !== 0 || /refus|shrink/i.test(`${r.stdout}${r.stderr}`)) {
    r = graphify("update", ".", "--force");
    forced = true;
  }
  const s = stats();
  if (r.status !== 0 || !s) done(`stale (update failed: ${String(r.stderr || r.stdout).trim().split("\n").pop()}); agents fall back to reading source`);
  done(`updated, ${s}${forced ? " (forced past the shrink guard after deletions)" : ""} at ${graph}`);
}

const built = graphify("extract", ".", "--code-only");
const s = stats();
if (built.status !== 0 || !s) {
  const out = `${built.stdout}${built.stderr}`;
  done(/found 0 code|graph is empty/i.test(out) ? "none yet (no code to map)" : `none (build failed: ${out.trim().split("\n").pop()})`);
}
graphify("cluster-only", ".", "--no-label", "--no-viz"); // writes GRAPH_REPORT.md without any LLM call
done(`built, ${s} at ${graph}`);
