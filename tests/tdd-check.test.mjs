import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../scripts/tdd-check.mjs";
import { node, tempRepo } from "./helpers.mjs";

test("classify splits tests from source and ignores everything else", () => {
  const { tests, source } = classify(["A\tsrc/a.ts", "M\tsrc/b.ts", "A\ttests/a.test.ts", "M\tsrc/b.spec.ts", "D\ttests/old.test.ts", "M\tREADME.md", "A\ttest_x.py", "M\tpkg/y.go"].join("\n"));
  assert.deepEqual(source, { added: ["src/a.ts"], changed: ["src/b.ts", "pkg/y.go"] });
  assert.deepEqual(tests, ["tests/a.test.ts", "src/b.spec.ts", "test_x.py"]);
});

// A tiny project whose "tests" are node scripts, so no framework is needed.
const BASE = { "src/calc.js": "export const add = (a, b) => a + b;\n", "package.json": '{"type":"module"}\n' };
const check = (r, base) => node(r.dir, "tdd-check.mjs", [base, "--", "node tests/calc.test.js"]);

test("PASS: the test fails when the changed source is put back", () => {
  const r = tempRepo(BASE);
  try {
    const base = r.git("rev-parse", "HEAD").out;
    r.write("src/calc.js", "export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n");
    r.write("tests/calc.test.js", 'import * as c from "../src/calc.js";\nif (c.mul(2, 3) !== 6) process.exit(1);\n');
    r.commit("mul");
    const out = check(r, base);
    assert.equal(out.status, 0, out.out);
    assert.match(out.out, /^tdd-check: PASS/);
    assert.equal(r.git("status", "--porcelain", "--untracked-files=no").out, "", "tree restored");
  } finally {
    r.cleanup();
  }
});

test("FAIL (exit 1): the test passes with or without the change", () => {
  const r = tempRepo(BASE);
  try {
    const base = r.git("rev-parse", "HEAD").out;
    r.write("src/calc.js", "export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n");
    r.write("tests/calc.test.js", 'import { add } from "../src/calc.js";\nif (add(1, 2) !== 3) process.exit(1);\n');
    r.commit("mul, test of add");
    const out = check(r, base);
    assert.equal(out.status, 1, out.out);
    assert.match(out.out, /^tdd-check: FAIL/);
  } finally {
    r.cleanup();
  }
});

test("WEAK PASS: a test that fails only because a new file is gone", () => {
  const r = tempRepo(BASE);
  try {
    const base = r.git("rev-parse", "HEAD").out;
    r.write("src/extra.js", "export const one = 1;\n");
    r.write("tests/calc.test.js", 'import { one } from "../src/extra.js";\nconsole.log(one);\n');
    r.commit("extra");
    const out = check(r, base);
    assert.equal(out.status, 0, out.out);
    assert.match(out.out, /^tdd-check: WEAK PASS/);
  } finally {
    r.cleanup();
  }
});

test("NO TESTS, SKIPPED on a dirty tree, SKIPPED with no source change, usage error", () => {
  const r = tempRepo(BASE);
  try {
    const base = r.git("rev-parse", "HEAD").out;
    r.write("src/calc.js", "export const add = (a, b) => b + a;\n");
    r.commit("refactor");
    assert.match(check(r, base).out, /^tdd-check: NO TESTS/);
    r.write("src/calc.js", "// dirty\n");
    assert.match(check(r, base).out, /^tdd-check: SKIPPED - the tree has uncommitted changes/);
    r.git("checkout", "--", ".");
    assert.match(check(r, "HEAD").out, /^tdd-check: SKIPPED - no source files changed/);
    assert.equal(node(r.dir, "tdd-check.mjs", [base]).status, 2);
  } finally {
    r.cleanup();
  }
});

const withMul = () => {
  const r = tempRepo(BASE);
  const base = r.git("rev-parse", "HEAD").out;
  r.write("src/calc.js", "export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n");
  r.write("tests/calc.test.js", 'import * as c from "../src/calc.js";\nif (c.mul(2, 3) !== 6) process.exit(1);\n');
  r.commit("mul");
  return { r, base };
};

test("INCONCLUSIVE: a test command that does not exist is not a failing test", () => {
  const { r, base } = withMul();
  try {
    const out = node(r.dir, "tdd-check.mjs", [base, "--", "definitely-not-a-command-xyz"]);
    assert.equal(out.status, 0, out.out);
    assert.match(out.out, /^tdd-check: INCONCLUSIVE/);
  } finally {
    r.cleanup();
  }
});

test("INCONCLUSIVE: a suite that is already red at HEAD proves nothing", () => {
  const { r, base } = withMul();
  try {
    const out = node(r.dir, "tdd-check.mjs", [base, "--", "node -e process.exit(3)"]);
    assert.match(out.out, /^tdd-check: INCONCLUSIVE/);
    assert.match(out.out, /also fails at HEAD/);
    assert.equal(r.git("status", "--porcelain", "--untracked-files=no").out, "", "tree restored");
  } finally {
    r.cleanup();
  }
});

test("a killed run leaves the tree restored", { skip: process.platform === "win32" }, async () => {
  const { r, base } = withMul();
  try {
    const { spawn } = await import("node:child_process");
    const { join } = await import("node:path");
    const { scripts } = await import("./helpers.mjs");
    const child = spawn(process.execPath, [join(scripts, "tdd-check.mjs"), base, "--", "node -e \"setTimeout(function(){},30000)\""], { cwd: r.dir });
    await new Promise((resolve) => setTimeout(resolve, 1500)); // the source is reverted and the command is running
    assert.notEqual(r.git("status", "--porcelain", "--untracked-files=no").out, "", "reverted while running");
    child.kill("SIGTERM");
    await new Promise((resolve) => child.on("close", resolve));
    assert.equal(r.git("status", "--porcelain", "--untracked-files=no").out, "", "restored after SIGTERM");
  } finally {
    r.cleanup();
  }
});
