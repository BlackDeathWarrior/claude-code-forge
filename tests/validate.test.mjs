import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { frontmatter, validate } from "../tools/validate.mjs";
import { tempDir } from "./helpers.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

test("this plugin validates with no errors", () => {
  const { errors } = validate(repo);
  assert.deepEqual(errors, []);
});

test("frontmatter reads simple keys and quoted values", () => {
  assert.deepEqual(frontmatter('---\nname: x\ndescription: "a: b"\nmodel: sonnet\n---\nbody'), { name: "x", description: "a: b", model: "sonnet" });
  assert.equal(frontmatter("no frontmatter"), null);
});

function fixture(files) {
  const t = tempDir("forge-plugin-");
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(t.dir, f)), { recursive: true });
    writeFileSync(join(t.dir, f), typeof text === "string" ? text : JSON.stringify(text));
  }
  return t;
}
const GOOD = {
  ".claude-plugin/plugin.json": { name: "demo-plugin", version: "1.0.0", description: "d" },
  "agents/a.md": "---\nname: a\ndescription: d\nmodel: sonnet\n---\nbody ${CLAUDE_PLUGIN_ROOT}/scripts/x.mjs\n",
  "skills/s/SKILL.md": "---\nname: s\ndescription: d\n---\nuse `demo-plugin:a`\n",
  "scripts/x.mjs": "",
  "hooks/hooks.json": { hooks: { PreToolUse: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/x.mjs"' }] }] } },
};

test("a clean fixture passes", () => {
  const t = fixture(GOOD);
  try {
    assert.deepEqual(validate(t.dir).errors, []);
  } finally {
    t.cleanup();
  }
});

test("each known mistake is an error", () => {
  const cases = [
    ["a reserved name", { ".claude-plugin/plugin.json": { name: "claude-demo", version: "1.0.0", description: "d" } }, /reserved/],
    ["a repeated default hooks path", { ".claude-plugin/plugin.json": { name: "demo-plugin", version: "1.0.0", description: "d", hooks: "./hooks/hooks.json" } }, /loads by itself/],
    ["a bad version", { ".claude-plugin/plugin.json": { name: "demo-plugin", version: "one", description: "d" } }, /semver/],
    ["an agent named differently from its file", { "agents/a.md": "---\nname: b\ndescription: d\n---\n" }, /differs from the file name/],
    ["an unknown model", { "agents/a.md": "---\nname: a\ndescription: d\nmodel: gpt\n---\n" }, /unknown model/],
    ["a skill without a description", { "skills/s/SKILL.md": "---\nname: s\n---\n" }, /no description/],
    ["a hook script that is missing", { "hooks/hooks.json": { hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/gone.mjs"' }] }] } } }, /does not exist/],
    ["the plugin root in a file read raw", { "skills/s/NOTES.md": "run ${CLAUDE_PLUGIN_ROOT}/scripts/x.mjs" }, /never replaced/],
    ["a broken link", { "skills/s/NOTES.md": "see [x](missing.md)" }, /goes nowhere/],
    ["a script that does not exist", { "skills/s/NOTES.md": "run <scripts>/nope.mjs" }, /does not exist/],
    ["a scoped agent that does not exist", { "skills/s/NOTES.md": "dispatch `demo-plugin:ghost`" }, /neither an agent nor a skill/],
  ];
  for (const [name, patch, re] of cases) {
    const t = fixture({ ...GOOD, ...patch });
    try {
      const { errors } = validate(t.dir);
      assert.ok(errors.some((e) => re.test(e)), `${name}: ${JSON.stringify(errors)}`);
    } finally {
      t.cleanup();
    }
  }
});
