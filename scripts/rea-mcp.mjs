#!/usr/bin/env node
// Turn the rea reverse-engineering MCP server on or off in ~/.claude.json.
// rea exposes ~200 tools that load into every session, but you only need them
// during /recon, so it is off by default to save tokens. Turn it on before a
// reverse-engineering session, then RESTART Claude Code for it to connect.
//
//   node rea-mcp.mjs enable    add rea to the MCP servers
//   node rea-mcp.mjs disable   remove it (the token-saving default)
//   node rea-mcp.mjs status    report whether it is on
//
// Always exits 0 (1 only on a usage error). Backs up the config before writing.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CONFIG = join(homedir(), ".claude.json");
const ENTRY = process.platform === "win32"
  ? { command: "cmd.exe", args: ["/d", "/c", "npx", "-y", "rea-agents@6.5.0", "mcp"] }
  : { command: "npx", args: ["-y", "rea-agents@6.5.0", "mcp"] };

function main() {
  const cmd = (process.argv[2] || "status").toLowerCase();
  if (!["enable", "disable", "status"].includes(cmd)) {
    console.error('usage: node rea-mcp.mjs enable | disable | status');
    return 1;
  }
  let c;
  try {
    c = JSON.parse(readFileSync(CONFIG, "utf8"));
  } catch (e) {
    console.log(`rea-mcp: cannot read ${CONFIG} (${e.message})`);
    return 0;
  }
  c.mcpServers = c.mcpServers || {};
  const on = !!c.mcpServers.rea;
  if (cmd === "status") {
    console.log(`rea-mcp: ${on ? "ON (loads in every session)" : "off (opt-in; run 'enable' then restart Claude Code before /recon)"}`);
    return 0;
  }
  const want = cmd === "enable";
  if (want === on) {
    console.log(`rea-mcp: already ${on ? "on" : "off"}; nothing to change.`);
    return 0;
  }
  copyFileSync(CONFIG, CONFIG + ".rea-toggle.backup");
  if (want) c.mcpServers.rea = ENTRY;
  else delete c.mcpServers.rea;
  writeFileSync(CONFIG, JSON.stringify(c, null, 2));
  console.log(`rea-mcp: ${want ? "ENABLED" : "disabled"}. Restart Claude Code for the change to take effect${want ? " (then rea's tools are available to /recon)" : ""}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
