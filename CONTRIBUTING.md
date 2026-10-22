# Contributing

```
npm test            # all tests, node:test, no dependencies
npm run validate    # the plugin's shape
claude plugin validate . --strict
```

- Node 22 or newer. The plugin has no runtime dependencies; keep it that way.
- A script gets a test in `tests/` that runs it the way the harness does (JSON on stdin, exit code out) as well as its pure functions. A new block in the guard gets one case that must block and one nearby case that must not.
- Scripts take no model tokens, always exit 0 unless their header says otherwise, and print one summary line.
- Agents and skills are prose that other agents act on: short, concrete, no step that depends on a person being present. `npm run validate` catches broken links, missing scripts and an unsubstituted `${CLAUDE_PLUGIN_ROOT}`.
- Do not put machine-specific paths, host names or project names in lessons, seeds or examples.
- Bump `version` in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` together, and add a line to `CHANGELOG.md`.
