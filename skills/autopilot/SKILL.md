---
name: autopilot
description: "Build pipeline from idea to pull request: interviews the user until every decision is settled, then builds, tests, reviews and ships with subagents, hands-free. Use when the user asks to build an app or a feature, to make a multi-step change, refactor or fix in a codebase, or to resume a plan under docs/plans/. Skip for questions, explanations, reviews and one-edit changes."
argument-hint: "[what you want built, or a plan directory]"
---

# Autopilot

The one entry point. You take `$ARGUMENTS` from wherever it stands to a finished branch or pull request, moving through three **phases** without the user steering between them: **Plan** (with the user), **Build** (without them), **Report**.

This session stays on whatever model it is running: you route, interview and relay. The work that needs a particular tier goes to an agent pinned to it: the `planner` (Opus 5.5 high) designs the plan, and the `conductor` (Sonnet 5.5 medium) builds it.

## 1. Find the phase

Look before asking. PLAN candidates are the directories under `docs/plans/` in this repository; a plan's state is its `Status` line in `plan.md` and its ledger at `.autopilot/<plan directory name>/ledger.md`. A plan directory that holds `decisions.md` and no `plan.md` yet is a draft still in its interview.

| What you find | Phase |
|---|---|
| `$ARGUMENTS` names a plan directory, or the newest plan is `approved`, and its ledger has no `finish:` or `STOP:` line | **Build** that plan (a ledger that already exists means the conductor resumes it) |
| The newest plan is `draft` and `$ARGUMENTS` is empty or describes the same thing | **Plan**, continuing that draft from the step its files show is unfinished |
| `$ARGUMENTS` describes something to build | **Plan** it |
| Nothing to go on | Ask the one question: what should be built? |

Say which phase you chose, and why, in one line, then start it.

This skill also starts by itself when a prompt asks for a build. When the request turns out to be smaller than that, a change you can finish correctly in one edit of a few lines, or a question, do that directly, and say in one line that autopilot was skipped and why. The user forces the pipeline by typing `/autopilot`, and skips it for one prompt by starting the prompt with `quick:`.

## 2. Plan

Read `${CLAUDE_PLUGIN_ROOT}/skills/blueprint/SKILL.md` in full and carry out its steps 1 to 5 as written, on `$ARGUMENTS`. That file is the planning procedure, and its sibling files are its references.

Before the approval question in its step 5, remind the user of the one thing the build needs from this session: **permission mode set to Auto**, since everything after approval runs unattended and inherits this session's mode.

Their approval is the last thing asked of them. When it comes, set the plan's `Status` to `approved` and go straight to Build in the same turn.

## 3. Build

Dispatch one `conductor` agent with the absolute PLAN path and the repository root as its whole prompt. It runs in its own fresh context on its own model tier, so none of the planning conversation rides along and nothing about this session's model changes what the build costs. Let it run in the background, and tell the user in two lines that the build has started, where the ledger is, and that they can leave.

When the conductor reports back:

- Its message starts `OUTCOME:`: go to Report.
- Its message starts `STOP:`: go to Report with the stop reason and the decision it needs.
- Anything else (it ran out of turns, crashed, or returned without a verdict): dispatch a fresh `conductor` with the same prompt. It resumes from the ledger. Do this at most twice, then Report what the ledger shows.

In this phase you dispatch the conductor and nothing else: every building agent is the conductor's to dispatch.

## 4. Report

Relay the conductor's final message as it stands, leading with the outcome and the pull request URL or branch. When a notification tool is available, send one line: the outcome and the link, or the decision that is waiting.

Then stop. A follow-up from the user starts at step 1 again: a change to the idea is a new Plan, a `STOP:` they have now answered is a Build that resumes.
