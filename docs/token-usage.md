# Spending fewer tokens

What a subscription's weekly limit counts is not published, so this page sticks to what can be measured in your own transcripts and what changed when it was fixed. Measure first with `node scripts/spend.mjs 7` (by day, by agent type, and cache misses); it reads `~/.claude/projects` and costs no model tokens.

## What drove the spend (one personal setup, 5 days of heavy `/autopilot` use)

- Re-reading context, not writing: 1,485M cache-read and 121M cache-write tokens against 3.3M output.
- Subagents were 76% of reads and 96% of writes.
- Every subagent started at about 34k tokens (tool definitions, the skill list, tool names from MCP servers) and re-read that on each turn.
- About a third of the cost, weighted like API prices, was **cache re-writes after a miss**. Subagents get a 5 minute cache unless told otherwise, so a long build or test run idles it out and the whole context is written again. Compaction near 215k tokens did the rest.
- One agent told to read 62 screenshots was about 15% of the week by itself.

## What this plugin does about it

- `hooks/hooks.json` runs `scripts/read-guard.mjs` on `Read`: the 13th image in one transcript is blocked, with the command that tiles the rest into one contact sheet (`AUTOPILOT_IMAGE_LIMIT` changes the limit).
- `agents/coder.md` has a `tools:` allowlist. Measured at the agent's first turn: 44.9k tokens before, 34.7k after.
- `scripts/recon.mjs` loads the `rea` MCP server for one `/recon` session only (`node scripts/recon.mjs "target and question"`), so its ~200 tool names are not in every other session. Nothing is written to `~/.claude.json`.

## Settings worth changing yourself (`~/.claude/settings.json`)

| Setting | Why | Measured |
|---|---|---|
| `"subagentPromptCacheTtl": "1h"` | stops idle subagents from re-writing their context every few minutes; 1 hour writes cost more, so compare with `spend.mjs` before and after | the idle-expiry re-writes were 47M tokens |
| `"skillOverrides": { "<skill>": "name-only", ... }` | keeps a skill callable by name but drops its description from every turn | 84 skills: -7k tokens per turn |
| `"disableClaudeAiConnectors": true` | claude.ai connectors add their tool names to every session | |
| `"promptSuggestionEnabled": false`, `"awaySummaryEnabled": false` | two background model calls that re-read the whole context | |
| `tools:` and `maxTurns:` in your own agents | an agent without `tools:` inherits every tool, including MCP ones | 29.5k to 15.4k at first turn (-48%) |

Notes that cost someone a bad afternoon:

- Give an agent `ToolSearch` rather than `Monitor` and `TaskStop` directly. Named in `tools:`, they load their full schemas (+3.3k tokens); with `ToolSearch` they stay deferred and load on demand.
- `ux` and `reviewer` are left without an allowlist here: both can drive a browser tool, and an allowlist would remove it. Add one in your own copy if yours does not.
- Agent definitions load when a session starts. Edit them, then start a new session.
- A plugin agent's `tools:` is honoured; its `hooks`, `mcpServers` and `permissionMode` are ignored.
