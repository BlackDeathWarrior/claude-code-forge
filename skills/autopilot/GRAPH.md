# The code graph

The project's **code graph** (graphify) answers "where is it, what calls it, what breaks if I change it" in a few hundred tokens, where reading the files to find out costs thousands. Every stage asks the graph first and reads source second. GRAPH is `<repository root>/graphify-out/graph.json`.

The graph maps **structure**: files, symbols, imports, calls, inheritance, each with `file:line`. The source stays the authority on **behaviour**: once the graph has pointed at the lines, read those lines.

## Keeping it fresh

One command builds the graph when there is none and refreshes it when there is, using no model tokens (code is parsed locally):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/graph-refresh.mjs"
```

Run it from the repository root. It prints one line starting `graph:` and never fails the caller: `built` or `updated` mean GRAPH is ready; `none yet` (a repository with no code so far), `skipped` or `stale` mean work goes on by reading source. It also keeps an untracked `graphify-out/` out of `git status`.

The script covers code. A graph that also holds documents, papers or images got them from `/graphify`, which spends model tokens on them: that is the user's call, made at planning, and the refresh leaves that layer in place.

## Asking

Add `--graph "<GRAPH>"` whenever the current directory is not the repository root, as in a worktree.

| Question | Command |
|---|---|
| Where does this behaviour live? | `graphify query "<question>" --budget 1200` |
| Only the call chain, less noise | `graphify query "<question>" --context call --budget 800` |
| Follow one chain deep, not the neighbourhood | `graphify query "<question>" --dfs` |
| What is this symbol and what touches it? | `graphify explain "<label>"` |
| What breaks if I change this? | `graphify affected "<label>" --depth 2` |
| How are these two things connected? | `graphify path "<A>" "<B>"` (no path: retry with `--undirected`) |
| What are the hubs of this codebase? | `graphify god-nodes --top 15` |
| The map in prose: hubs, communities, surprising links | read `graphify-out/GRAPH_REPORT.md` |

## Reading the answers

- **Matching is by label, literally.** No stemming, no synonyms: a question worded unlike the code finds nothing. Word questions with names that appear in the code, and take exact labels (`invoiceTotal()`, `SessionStore`, `tax.ts`) from one answer into the next command.
- `No unique node match` means the label is wrong or ambiguous, never that the thing does not exist: run a `query` to get the exact label.
- Every edge carries its confidence: `EXTRACTED` is in the source as written, `INFERRED` was resolved by graphify (a method call matched to a class), `AMBIGUOUS` is a guess. Confirm an `INFERRED` or `AMBIGUOUS` edge in the source before building on it.
- A missing edge is not proof of independence: dynamic dispatch, reflection and string-built names leave no edge. Before claiming nothing uses a symbol, back the graph with one text search for its name.
- The graph is as old as its last refresh. Code written since then, including everything in the current task, is not in it.

## Where each stage uses it

- **Planning** reads `GRAPH_REPORT.md` and `god-nodes` to learn the shape, `query` to find what a feature touches, and `affected` on each symbol a task will change to fill that task's `Touches` and its blocking edges. Each task's `Graph` line carries the exact labels its implementer starts from.
- **The conductor** looks the graph up on everyone's behalf, so no agent has to remember to. `graph-brief.mjs task` writes each task's **card** (what depends on every symbol on its `Graph` line) and `graph-brief.mjs diff` writes each review's **impact** file (every changed symbol and the callers the diff did not touch). Both go out in the dispatch as a file to read. It refreshes the graph after each wave, and rules on conflicts with `affected` and `path`.
- **Implementers** read their card first, and run `query` or `affected` only for what it does not cover.
- **Reviewers** read the impact file right after the diff and check each untouched caller against the change.

## Per-project extras

These change the repository or its settings, so they are the user's to run, once per project:

- `graphify hook install` rebuilds the graph after every commit and checkout, and registers a merge driver so a committed `graph.json` merges cleanly.
- `graphify claude install` adds a CLAUDE.md section and a hook that nudges every session toward the graph before it searches or reads files; `--strict` blocks the first raw file read of a session until one graph query has run.
- `graphify save-result` records whether an answer was `useful`, a `dead_end` or `corrected`, and `graphify reflect` folds those into `graphify-out/reflections/LESSONS.md`. Read that file when it exists.
- A monorepo gets one graph per package (`graphify extract ./pkg --code-only`) merged with `graphify merge-graphs`.
