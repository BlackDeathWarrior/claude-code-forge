import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { node, tempRepo } from "./helpers.mjs";

const hasGraphify = spawnSync("graphify", ["--help"], { stdio: "ignore", shell: process.platform === "win32" }).status === 0;

test("without graphify installed it says so and never fails the caller", () => {
  const r = tempRepo();
  try {
    const out = node(r.dir, "graph-refresh.mjs", [r.dir], { PATH: "/nonexistent" });
    assert.equal(out.status, 0);
    assert.match(out.out, /^graph: skipped \(graphify is not installed/);
  } finally {
    r.cleanup();
  }
});

test("a repository with no code reports 'none yet' (or skips) and keeps .autopilot out of git status", { skip: !hasGraphify && "graphify is not installed" }, () => {
  const r = tempRepo({ "README.md": "# docs only\n" });
  try {
    const out = node(r.dir, "graph-refresh.mjs", [r.dir]);
    assert.equal(out.status, 0);
    assert.match(out.out, /^graph: /);
    assert.match(readFileSync(join(r.dir, ".git", "info", "exclude"), "utf8"), /\.autopilot\//);
  } finally {
    r.cleanup();
  }
});
