import { test } from "node:test";
import assert from "node:assert/strict";
import { tempDir, node } from "./helpers.mjs";
import { ENTRY } from "../scripts/rea-mcp.mjs";

test("recon passes the same pinned rea server that rea-mcp enables, and writes nothing to the user's config", () => {
  const home = tempDir();
  try {
    const r = node(home.dir, "recon.mjs", ["--print-config"], { HOME: home.dir, USERPROFILE: home.dir });
    assert.equal(r.status, 0);
    const cfg = JSON.parse(r.out);
    assert.deepEqual(cfg.mcpServers.rea, ENTRY);
    assert.ok(cfg.mcpServers.rea.args.some((a) => /^rea-agents@\d+\.\d+\.\d+$/.test(a)), "pinned to an exact version");
  } finally {
    home.cleanup();
  }
});
