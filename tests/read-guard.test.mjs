import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { scripts, tempDir } from "./helpers.mjs";

const IMG = '{"x":{"type":"image"}}\n';

/** Run the hook the way Claude Code does: the call as JSON on stdin. */
function guard(input, env = {}) {
  const r = spawnSync(process.execPath, [join(scripts, "read-guard.mjs")], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status, err: (r.stderr ?? "").trim() };
}

test("read-guard blocks an image read once the transcript holds the limit, and says how to carry on", () => {
  const t = tempDir();
  try {
    const few = join(t.dir, "few.jsonl");
    const many = join(t.dir, "many.jsonl");
    writeFileSync(few, IMG.repeat(5));
    writeFileSync(many, IMG.repeat(12));
    assert.equal(guard({ tool_input: { file_path: "/a/b.png" }, transcript_path: few }).status, 0);
    const blocked = guard({ tool_input: { file_path: "/a/b.PNG" }, transcript_path: many });
    assert.equal(blocked.status, 2);
    assert.match(blocked.err, /contact sheet/);
    assert.equal(guard({ tool_input: { file_path: "/a/b.png" }, transcript_path: many }, { AUTOPILOT_IMAGE_LIMIT: "20" }).status, 0);
  } finally {
    t.cleanup();
  }
});

test("read-guard ignores non-images and fails open on bad input", () => {
  const t = tempDir();
  try {
    const many = join(t.dir, "many.jsonl");
    writeFileSync(many, IMG.repeat(12));
    assert.equal(guard({ tool_input: { file_path: "/a/b.ts" }, transcript_path: many }).status, 0);
    assert.equal(guard("not json").status, 0);
    assert.equal(guard({ tool_input: { file_path: "/a/b.png" }, transcript_path: join(t.dir, "missing.jsonl") }).status, 0);
  } finally {
    t.cleanup();
  }
});
