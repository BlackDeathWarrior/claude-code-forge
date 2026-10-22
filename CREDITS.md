# Credits

claude-code-forge is original work, but it stands on ideas and tools from the
Claude Code community. The forge does not vendor anyone else's skills; it calls
them when installed and credits them here.

## Patterns this pipeline learned from

- **Superpowers** — the brainstorm → write-plan → subagent-driven-execution →
  review lineage, the fresh-subagent-per-task discipline, and the "rulings, not
  stalls" idea for unattended runs. The forge's `/blueprint` + `/autopilot`
  replace that flow with its own agents rather than depending on it.
- **everything-claude-code** (affaan-m, MIT) — the security-reviewer and
  build-error-resolver roles, the verification command, and session-learning
  (which the forge turns into project- and stack-scoped `lessons.mjs`).

## Skills the pipeline calls when they are installed

These are **not** bundled. Install the ones you want; the forge uses them when
present and degrades where it can when they are not.

- **Matt Pocock's engineering skills** / a `supermatt`-style plugin (MIT) —
  `qa`, `code-review`, `pr`, `tdd`, `resolving-merge-conflicts`,
  `dependency-vetting`. The build pipeline routes to these by name.
- **graphify** (Graphify-Labs, MIT) — the code-graph CLI the forge queries so
  agents read a few hundred tokens of structure instead of whole files.
- **refero-design** and **dataviz** — UI and chart craft for the `ux` agent.
- **security-review** — used by the reviewer's SECURITY pass.

## Reverse engineering

- **rea / reverse-engineer-anything** (morluto, MIT) — the engine behind
  `/recon`. Installed separately with `npx skills add morluto/rea`; **not**
  redistributed here. `/recon` and the `analyst` / `senior-analyst` agents are
  thin, human-in-the-loop wrappers around it.
- **Ghidra** (NSA, Apache-2.0) — the native decompiler rea drives, installed by
  the user.

Every project above is the property of its authors under its own license.
