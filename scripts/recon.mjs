#!/usr/bin/env node
// Start Claude Code with the rea MCP server loaded for this one session, then run /recon.
// rea exposes ~200 tools; keeping it out of every other session saves their tool names on each turn,
// and nothing is written to ~/.claude.json, so there is nothing to switch off afterwards.
//
//   node recon.mjs "the target and what you want to learn"
//   node recon.mjs --print-config        show the MCP config it would pass, run nothing
//
// The server entry is the one rea-mcp.mjs pins, so both paths use the same rea-agents version.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ENTRY } from "./rea-mcp.mjs";

export const config = () => ({ mcpServers: { rea: ENTRY } });

function main(argv) {
  if (argv[0] === "--print-config") {
    console.log(JSON.stringify(config(), null, 2));
    return 0;
  }
  const dir = mkdtempSync(join(tmpdir(), "forge-recon-"));
  const file = join(dir, "rea.mcp.json");
  writeFileSync(file, JSON.stringify(config()));
  try {
    const prompt = ["/autopilot-forge:recon", ...argv].join(" ");
    const r = spawnSync("claude", ["--mcp-config", file, prompt], { stdio: "inherit", shell: process.platform === "win32" });
    if (r.error) {
      console.error(`recon: could not start claude (${r.error.message})`);
      return 1;
    }
    return r.status ?? 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
