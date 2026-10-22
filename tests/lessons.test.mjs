import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { add, applicable, detectStack, importLegacy, similarity } from "../scripts/lessons.mjs";
import { node, tempDir, tempRepo } from "./helpers.mjs";

const empty = () => ({ version: 1, lessons: [] });

test("similarity is word overlap, ignoring filler words", () => {
  assert.ok(similarity("the build fails when pnpm is not on PATH", "build fails if pnpm not on the PATH") > 0.6);
  assert.ok(similarity("rate limit keys must differ", "database migrations run twice") < 0.2);
  assert.equal(similarity("", "x y z"), 0);
});

test("a repeated lesson is reinforced, not duplicated", () => {
  const s = empty();
  assert.equal(add(s, { scope: "repo", text: "tests need the dev database running first -> start compose before pytest", project: "/a" }).what, "added");
  assert.equal(add(s, { scope: "repo", text: "tests need the dev database running first -> start compose before pytest", project: "/a" }).what, "reinforced");
  assert.equal(s.lessons.length, 1);
  assert.equal(s.lessons[0].count, 2);
});

test("a repo lesson a second project reports is promoted to machine", () => {
  const s = empty();
  add(s, { scope: "repo", text: "husky hook fails when node is missing from the hook PATH -> use an absolute node path", project: "/a" });
  const r = add(s, { scope: "repo", text: "husky hook fails when node is missing from the hook PATH -> use an absolute node path", project: "/b" });
  assert.equal(r.what, "promoted");
  assert.equal(s.lessons[0].scope, "machine");
});

test("lessons apply by scope: repo to its repository, stack by tag, machine everywhere", () => {
  const s = empty();
  add(s, { scope: "repo", text: "only repo a uses port 4000 for the api", project: "/a" });
  add(s, { scope: "stack", tags: ["prisma"], text: "prisma migrate dev needs a shadow database url", project: "/a" });
  add(s, { scope: "machine", text: "this machine has no tmux so terminal qa scenarios are blocked", project: "/a" });
  const a = applicable(s, "/b", ["node", "prisma"]);
  assert.deepEqual([a.repo.length, a.stack.length, a.machine.length], [0, 1, 1]);
  assert.deepEqual(applicable(s, "/a", ["node"]).repo.length, 1);
  assert.deepEqual(applicable(s, "/a", ["node"]).stack.length, 0);
});

test("the store keeps each group within its cap", () => {
  const s = empty();
  for (let i = 0; i < 60; i++) add(s, { scope: "machine", text: `unique lesson number ${i} about thing${i}x${i * 7} and widget${i * 13}y`, project: "/a" });
  assert.ok(s.lessons.length <= 40, String(s.lessons.length));
});

test("importLegacy reads a hand-kept file by section and strips decoration", () => {
  const s = empty();
  const text = [
    "# Lessons",
    "## Every project on this machine",
    "- 2026-10-11 reviewers that checkout with --work-tree are refused -> use git show and git diff (from App A)",
    "## This stack (node, prisma)",
    "- 2026-10-12 [prisma] this one is a rendered stack line and is skipped (seen 2x)",
    "## This project",
    "- 2026-10-13 the e2e suite needs port 5433 free -> stop the old container (seen 3x)",
    "- 2026-10-13 short",
  ].join("\n");
  assert.equal(importLegacy(s, text, "/proj"), 2);
  const [m, r] = s.lessons;
  assert.equal(m.scope, "machine");
  assert.equal(m.text, "reviewers that checkout with --work-tree are refused -> use git show and git diff");
  assert.equal(m.first, "2026-10-11");
  assert.equal(r.scope, "repo");
  assert.equal(r.text, "the e2e suite needs port 5433 free -> stop the old container");
  assert.equal(importLegacy(s, text, "/proj"), 0, "importing twice adds nothing");
});

test("detectStack reads package.json and lockfiles", () => {
  const t = tempDir();
  try {
    writeFileSync(join(t.dir, "package.json"), JSON.stringify({ dependencies: { next: "1", "@prisma/client": "5" }, devDependencies: { vitest: "1" } }));
    writeFileSync(join(t.dir, "pnpm-lock.yaml"), "");
    const tags = detectStack(t.dir);
    for (const want of ["node", "nextjs", "prisma", "vitest", "pnpm"]) assert.ok(tags.includes(want), want);
  } finally {
    t.cleanup();
  }
});

test("CLI: add, sync, drop, and a hand-kept LESSONS.md is taken in once", () => {
  const repo = tempRepo({ "package.json": '{"dependencies":{"express":"4"}}' });
  const home = tempDir();
  const env = { AUTOPILOT_HOME: home.dir };
  try {
    assert.match(node(repo.dir, "lessons.mjs", ["sync"], env).out, /lessons: none yet \(stack: express, node/);
    assert.match(node(repo.dir, "lessons.mjs", ["add", "--scope", "repo", "start the stub server before running the e2e suite -> npm run stub &"], env).out, /added for this repository/);
    assert.match(node(repo.dir, "lessons.mjs", ["add", "--scope", "stack:express", "trust proxy must be set behind a load balancer -> app.set('trust proxy', 1)"], env).out, /added for stack express/);
    assert.match(node(repo.dir, "lessons.mjs", ["add", "--scope", "nonsense", "x"], env).out, /not added/);
    const sync = node(repo.dir, "lessons.mjs", ["sync"], env).out;
    assert.match(sync, /1 for this repository, 1 for its stack/);
    const file = join(repo.dir, ".autopilot", "LESSONS.md");
    assert.match(readFileSync(file, "utf8"), /^<!-- generated by lessons\.mjs/);
    assert.ok(existsSync(join(home.dir, "lessons-all.md")), "the readable copy is lessons-all.md");
    assert.ok(!existsSync(join(home.dir, "LESSONS.md")), "a global LESSONS.md is never written");
    assert.match(repo.git("status", "--porcelain").out, /^$/, ".autopilot is kept out of git status");
    assert.match(node(repo.dir, "lessons.mjs", ["drop", "stub server"], env).out, /dropped 1/);
    // a hand-kept file is imported, then replaced by the rendered one
    writeFileSync(file, "# Lessons\n## This project\n- 2026-10-01 the seed script must run before the first test -> npm run seed\n");
    assert.match(node(repo.dir, "lessons.mjs", ["sync"], env).out, /2 for this repository|1 for this repository/);
    assert.match(readFileSync(file, "utf8"), /seed script must run/);
    assert.match(readFileSync(file, "utf8"), /^<!-- generated/);
  } finally {
    repo.cleanup();
    home.cleanup();
  }
});

test("CLI: import takes a flat global file as machine lessons, and refuses its own output", () => {
  const repo = tempRepo();
  const home = tempDir();
  const env = { AUTOPILOT_HOME: home.dir };
  try {
    const flat = join(home.dir, "flat.md");
    writeFileSync(flat, "- 2026-10-02 sudo pnpm cannot find pnpm -> pass PATH through sudo env\n");
    assert.match(node(repo.dir, "lessons.mjs", ["import", flat, "--scope", "machine"], env).out, /imported 1/);
    assert.match(node(repo.dir, "lessons.mjs", ["import", join(home.dir, "lessons-all.md"), "--scope", "machine"], env).out, /imported 0/);
  } finally {
    repo.cleanup();
    home.cleanup();
  }
});

test("CLI: a damaged store is never overwritten", () => {
  const repo = tempRepo();
  const home = tempDir();
  const env = { AUTOPILOT_HOME: home.dir };
  try {
    node(repo.dir, "lessons.mjs", ["add", "--scope", "machine", "always pass PATH through sudo env -> sudo env PATH=$PATH pnpm"], env);
    const store = join(home.dir, "lessons.json");
    const broken = readFileSync(store, "utf8").replace(/\]\s*\}\s*$/, "],}");
    writeFileSync(store, broken);
    const r = node(repo.dir, "lessons.mjs", ["add", "--scope", "machine", "another lesson that is long enough -> do the other thing"], env);
    assert.match(r.out, /not valid JSON/);
    assert.equal(readFileSync(store, "utf8"), broken, "the store is untouched");
    assert.ok(readdirSync(home.dir).some((f) => f.startsWith("lessons.json.damaged-")), "a copy was kept");
  } finally {
    repo.cleanup();
    home.cleanup();
  }
});

test("CLI: sync keeps a hand-kept LESSONS.md it cannot fully import", () => {
  const repo = tempRepo();
  const home = tempDir();
  const env = { AUTOPILOT_HOME: home.dir };
  try {
    mkdirSync(join(repo.dir, ".autopilot"), { recursive: true });
    const hand = "# Lessons\n## This project\n- Always run make seed before the tests -> make seed\n- 2026-10-01 the stub server must start first -> npm run stub\n";
    writeFileSync(join(repo.dir, ".autopilot", "LESSONS.md"), hand);
    const out = node(repo.dir, "lessons.mjs", ["sync"], env).out;
    assert.match(out, /1 line\(s\) .* not in the dated/);
    assert.equal(readFileSync(join(repo.dir, ".autopilot", "LESSONS.hand.md"), "utf8"), hand);
  } finally {
    repo.cleanup();
    home.cleanup();
  }
});
