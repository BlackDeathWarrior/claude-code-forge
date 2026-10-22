import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { node, tempDir } from "./helpers.mjs";

test("rea-mcp toggles the server in ~/.claude.json, keeps a backup, and touches nothing else", () => {
  const home = tempDir();
  const env = { HOME: home.dir, USERPROFILE: home.dir };
  const cfg = join(home.dir, ".claude.json");
  try {
    writeFileSync(cfg, JSON.stringify({ theme: "dark", mcpServers: { other: { command: "x" } } }));
    assert.match(node(home.dir, "rea-mcp.mjs", ["status"], env).out, /off/);
    assert.match(node(home.dir, "rea-mcp.mjs", ["enable"], env).out, /ENABLED/);
    const on = JSON.parse(readFileSync(cfg, "utf8"));
    assert.equal(on.theme, "dark");
    assert.ok(on.mcpServers.other);
    assert.ok(on.mcpServers.rea.args.some((a) => /^rea-agents@\d+\.\d+\.\d+$/.test(a)), "pinned to an exact version");
    assert.ok(existsSync(`${cfg}.rea-toggle.backup`));
    assert.match(node(home.dir, "rea-mcp.mjs", ["enable"], env).out, /already on/);
    assert.match(node(home.dir, "rea-mcp.mjs", ["disable"], env).out, /disabled/);
    assert.equal(JSON.parse(readFileSync(cfg, "utf8")).mcpServers.rea, undefined);
    assert.equal(node(home.dir, "rea-mcp.mjs", ["bogus"], env).status, 1);
  } finally {
    home.cleanup();
  }
});

test("rea-mcp leaves an unreadable config alone", () => {
  const home = tempDir();
  const env = { HOME: home.dir, USERPROFILE: home.dir };
  try {
    writeFileSync(join(home.dir, ".claude.json"), "{ not json");
    const r = node(home.dir, "rea-mcp.mjs", ["enable"], env);
    assert.equal(r.status, 0);
    assert.match(r.out, /cannot read/);
    assert.equal(readFileSync(join(home.dir, ".claude.json"), "utf8"), "{ not json");
  } finally {
    home.cleanup();
  }
});

test("rea-mcp keeps the config's permissions and writes through a symlink", { skip: process.platform === "win32" }, async () => {
  const { chmodSync, lstatSync, statSync, symlinkSync, mkdirSync } = await import("node:fs");
  const home = tempDir();
  const env = { HOME: home.dir, USERPROFILE: home.dir };
  try {
    mkdirSync(join(home.dir, "dotfiles"));
    const real = join(home.dir, "dotfiles", "claude.json");
    writeFileSync(real, JSON.stringify({ mcpServers: {} }));
    chmodSync(real, 0o600);
    symlinkSync(real, join(home.dir, ".claude.json"));
    assert.match(node(home.dir, "rea-mcp.mjs", ["enable"], env).out, /ENABLED/);
    assert.ok(lstatSync(join(home.dir, ".claude.json")).isSymbolicLink(), "still a symlink");
    assert.equal(statSync(real).mode & 0o777, 0o600);
    assert.ok(JSON.parse(readFileSync(real, "utf8")).mcpServers.rea, "the target was updated");
  } finally {
    home.cleanup();
  }
});
