import { test } from "node:test";
import assert from "node:assert/strict";
import { scanDiff, scanLine } from "../scripts/scan-diff.mjs";
import { node, tempRepo } from "./helpers.mjs";

const rules = (file, text) => scanLine(file, text).map(([sev, rule]) => `${sev}:${rule}`);

test("secrets are P0 and redacted in the excerpt", () => {
  const key = "AKIA" + "ABCDEFGHIJKLMNOP";
  assert.deepEqual(rules("src/a.ts", `const k = "${key}";`), ["P0:aws-access-key"]);
  assert.ok(!scanLine("src/a.ts", `const k = "${key}";`)[0][2].includes(key));
  assert.deepEqual(rules("src/a.ts", "-----BEGIN RSA PRIVATE KEY-----"), ["P0:private-key"]);
  assert.deepEqual(rules("src/db.ts", 'const url = "postgres://app:s3cr3tpw@db.internal/app"'), ["P0:connection-string-with-password"]);
  assert.deepEqual(rules("src/a.ts", 'const password = "correct-horse-battery";'), ["P0:hardcoded-credential"]);
});

test("placeholders, tests and docs are not secrets", () => {
  assert.deepEqual(rules("src/a.ts", 'const password = process.env.DB_PASSWORD;'), []);
  assert.deepEqual(rules("src/a.ts", 'const k = "sk-your-key-goes-here-xxxxxxxxxxxxxxxx";'), []);
  assert.deepEqual(rules("tests/a.test.ts", 'const password = "correct-horse-battery";'), []);
  assert.deepEqual(rules("README.md", 'password: "correct-horse-battery"'), []);
});

test("leftovers: conflict markers, focused tests, debuggers, logs, todos", () => {
  assert.deepEqual(rules("src/a.ts", "<<<<<<< HEAD"), ["P1:conflict-marker"]);
  assert.deepEqual(rules("src/a.test.ts", "it.only('x', () => {})"), ["P1:focused-test"]);
  assert.deepEqual(rules("src/a.ts", "  debugger;"), ["P1:debugger-statement"]);
  assert.deepEqual(rules("src/a.ts", "console.log(x)"), ["P2:debug-log"]);
  assert.deepEqual(rules("src/a.test.ts", "console.log(x)"), []);
  assert.deepEqual(rules("src/a.ts", "// TODO: later"), ["P3:todo-marker"]);
  assert.deepEqual(rules("docs/a.md", "TODO"), []);
});

test("generated and vendored files are skipped", () => {
  assert.deepEqual(rules("node_modules/x/index.js", "console.log(1); debugger;"), []);
  assert.deepEqual(rules("pnpm-lock.yaml", "AKIAABCDEFGHIJKLMNOP"), []);
});

test("scanDiff reports added lines with their new line numbers, and env files", () => {
  const diff = ["diff --git a/src/a.ts b/src/a.ts", "--- a/src/a.ts", "+++ b/src/a.ts", "@@ -3,0 +4,2 @@", "+const ok = 1;", "+console.log(ok);", "-removed console.log(1)", "diff --git a/.env b/.env", "--- /dev/null", "+++ b/.env", "@@ -0,0 +1 @@", "+A=1"].join("\n");
  const found = scanDiff(diff).map(([sev, file, line, rule]) => `${sev} ${file}:${line} ${rule}`);
  assert.deepEqual(found, ["P2 src/a.ts:5 debug-log", "P0 .env:1 env-file-committed"]);
});

test("CLI: exits 1 on a P0 or P1, 0 on P2 and below, 2 on a bad ref", () => {
  const r = tempRepo({ "src/a.js": "export const a = 1;\n" });
  try {
    const base = r.git("rev-parse", "HEAD").out;
    r.write("src/a.js", "export const a = 1;\nconsole.log(a);\n");
    r.commit("log");
    const soft = node(r.dir, "scan-diff.mjs", [base]);
    assert.equal(soft.status, 0);
    assert.match(soft.out, /\[P2\] src\/a\.js:2 debug-log/);
    const mid = r.git("rev-parse", "HEAD").out;
    r.write("src/b.js", "debugger;\n");
    r.commit("dbg");
    assert.equal(node(r.dir, "scan-diff.mjs", [mid]).status, 1);
    assert.equal(node(r.dir, "scan-diff.mjs", ["no-such-ref"]).status, 2);
  } finally {
    r.cleanup();
  }
});
