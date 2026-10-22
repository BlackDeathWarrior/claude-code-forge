#!/usr/bin/env node
// PreToolUse tripwire for unattended /autopilot runs.
// Blocks shell commands that are irreversible or that reach shared state:
// force/delete pushes, pushes to a protected branch, hook bypasses, history
// destruction, and recursive deletes of a root, home, or repository.
// Exit 2 blocks the call and stderr tells the agent what to do instead.
// A tripwire, not a sandbox: anything it cannot parse is allowed (fails open).
//
// Every block has a rule id (shown in the message). A user, never an agent, can
// loosen it in a rules file, read from <repo>/.autopilot/guard.json then
// ~/.claude/autopilot/guard.json (AUTOPILOT_HOME overrides the directory):
//   { "scope": "always" | "runs",            // "runs": only guard while a run is in progress
//     "allow": ["force-push", "protected-push:main", "branch-force-delete:tmp/*"] }
// An entry is a rule id, or `rule:glob` to allow it only when every branch, path
// or ref it touches matches the glob.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PROTECTED = /^(main|master|trunk|production|prod|release)$/i;
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "pwsh", "powershell", "cmd", "wsl", "iex", "invoke-expression"]);
// eval runs its arguments, joined, as a command line.
const EVALS = new Set(["eval"]);
// The pipeline's own throwaway lane branches and worktrees. Losing one loses nothing a run needs.
const BUILTIN_ALLOW = ["branch-force-delete:ap/*", "branch-force-delete:autopilot-lane/*", "worktree-force-remove:*/.autopilot/lanes/*"];
const WRAPPERS = new Set(["sudo", "env", "command", "time", "nohup", "&", "exec"]);
const DELETERS = new Set(["rm", "rmdir", "rd", "del", "erase", "ri", "remove-item"]);
// Options whose next token is a value, so that value is never read as a flag.
const COMMIT_VALUE_FLAGS = /^(-[a-zA-Z]*[mFCc]|--message|--file|--author|--date|--fixup|--squash|--reuse-message|--reedit-message|--template|--cleanup)$/;

/** Split a command line into segments of unquoted tokens. */
export function segments(line) {
  const out = [];
  let seg = [];
  let tok = "";
  let has = false;
  let quote = null;
  const endTok = () => {
    if (has) seg.push(tok);
    tok = "";
    has = false;
  };
  const endSeg = () => {
    endTok();
    if (seg.length) out.push(seg);
    seg = [];
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && (line[i + 1] === '"' || line[i + 1] === "\\")) tok += line[++i];
      else tok += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (/\s/.test(c) && c !== "\n") endTok();
    else if (c === "\n" || c === ";" || c === "|" || c === "&") {
      // a lone & is PowerShell's call operator when it opens a segment
      if (c === "&" && !seg.length && !has && line[i + 1] !== "&") continue;
      endSeg();
    } else if ((c === "(" || c === "{") && !has) continue;
    else if (c === ")" || c === "}") endTok();
    else {
      tok += c;
      has = true;
    }
  }
  endSeg();
  return out;
}

/** Drop heredoc bodies: they are text handed to a program (a commit message, a file), not commands. */
export function stripHeredocs(line) {
  return line.replace(/<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n[\s\S]*?\n[ \t]*\2(?=\n|$|\)|`)/g, (m) => m.slice(0, m.indexOf("\n")) + "\n");
}

/** Commands nested in $(...) and backticks, scanned as commands of their own. */
function nested(line) {
  const found = [];
  for (const m of line.matchAll(/\$\(([^()]*)\)/g)) found.push(m[1]);
  for (const m of line.matchAll(/`([^`]*)`/g)) found.push(m[1]);
  return found;
}

const base = (t) => t.replace(/\\/g, "/").split("/").pop().replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
const isCluster = (t, letters) => new RegExp(`^-[a-zA-Z]*[${letters}][a-zA-Z]*$`).test(t);

function currentBranch(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

function dangerousTarget(raw) {
  let p = raw.replace(/\\/g, "/").replace(/\/\*$/, "").replace(/\/+$/, "");
  if (raw === "/" || raw === "\\" || raw === "/*") return "the filesystem root";
  const low = p.toLowerCase();
  if (["~", "$home", "${home}", "$env:userprofile", "%userprofile%", "$env:homepath"].includes(low)) return "your home directory";
  if (p === "." || p === ".." || p === "*" || p.startsWith("../")) return `'${raw}'`;
  if (low === ".git" || low.endsWith("/.git")) return "a repository's .git directory";
  const home = homedir().replace(/\\/g, "/").toLowerCase();
  if (low === home || low.replace(/^\/([a-z])\//, "$1:/") === home) return "your home directory";
  // an absolute path at most one directory below a root: /usr, C:/Windows, /c/Users
  const abs = low.replace(/^([a-z]):/, "/$1").replace(/^\/mnt\//, "/");
  if (/^\/[^/]*$/.test(abs) || /^\/[a-z]\/[^/]*$/.test(abs)) return `'${raw}'`;
  return null;
}

const hit = (id, why, subjects = []) => ({ id, why, subjects });

function checkGit(args, cwd) {
  // global options before the subcommand
  let i = 0;
  let dir = cwd;
  while (i < args.length && args[i].startsWith("-")) {
    if (args[i] === "-C") dir = resolve(dir, args[i + 1] ?? ".");
    if (args[i] === "-c" && /^core\.hookspath=/i.test(args[i + 1] ?? "")) return hit("hook-bypass", "it overrides core.hooksPath to skip the repository's hooks. Fix what the hook reports and commit normally");
    i += args[i] === "-C" || args[i] === "-c" ? 2 : 1;
  }
  const sub = (args[i] ?? "").toLowerCase();
  const rest = args.slice(i + 1);
  const flags = [];
  const positional = [];
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k];
    if (t === "--") {
      positional.push(...rest.slice(k + 1));
      break;
    }
    if (sub === "commit" && COMMIT_VALUE_FLAGS.test(t)) {
      flags.push(t);
      k++;
    } else if (t.startsWith("-")) flags.push(t);
    else positional.push(t);
  }
  const has = (...names) => flags.some((f) => names.includes(f.split("=")[0]));

  if (has("--no-verify") || (sub === "commit" && flags.some((f) => isCluster(f, "n")))) return hit("hook-bypass", "it skips the repository's hooks (--no-verify). Fix what the hook reports and commit normally");

  if (sub === "push") {
    const refspecs = positional.slice(1);
    // the branch names a push touches: HEAD means the current branch
    const targets = (refspecs.length ? refspecs.map((r) => r.replace(/^\+/, "").split(":").pop()) : ["HEAD"]).map((t) => {
      if (t === "HEAD" || t === "@") t = currentBranch(dir);
      return t.replace(/^refs\/heads\//, "");
    });
    if (has("--force", "--force-with-lease", "--mirror", "--delete", "--prune") || flags.some((f) => isCluster(f, "fd")) || refspecs.some((r) => r.startsWith("+") || r.startsWith(":"))) {
      return hit("force-push", "it force-pushes or deletes remote refs. Push new commits to the run's own branch instead", targets);
    }
    for (const t of targets) {
      if (PROTECTED.test(t)) return hit("protected-push", `it pushes straight to the protected branch '${t}'. Push the run's own branch and open a pull request`, targets);
    }
  }
  if (sub === "reset" && has("--hard") && positional.some((p) => p !== "HEAD")) return hit("hard-reset", "it hard-resets to another commit and drops work. Use `git revert` for a commit, or `git reset --hard` with no ref to discard only uncommitted changes", positional);
  if (sub === "clean" && !has("--dry-run") && !flags.some((f) => isCluster(f, "n")) && flags.some((f) => isCluster(f, "xX"))) return hit("clean-ignored", "it deletes ignored files, which include the run's ledger, dependencies and local env files. Remove the specific paths you mean", positional);
  if (sub === "branch") {
    if (flags.some((f) => isCluster(f, "D")) || (has("--delete") && has("--force"))) return hit("branch-force-delete", "it force-deletes a branch that may hold unmerged work. Use `git branch -d`, which refuses unmerged branches", positional);
    if ((has("--force") || flags.some((f) => isCluster(f, "fM"))) && positional.some((p) => PROTECTED.test(p))) return hit("protected-branch-move", "it force-moves a protected branch", positional);
  }
  if ((sub === "switch" || sub === "checkout") && flags.some((f) => isCluster(f, "CB") || f === "--force-create")) {
    if (positional.length && PROTECTED.test(positional[0])) return hit("protected-branch-move", `it resets the protected branch '${positional[0]}'`, [positional[0]]);
  }
  if (sub === "worktree" && positional[0] === "remove" && (has("--force") || flags.some((f) => isCluster(f, "f")))) {
    return hit("worktree-force-remove", "it force-removes a worktree that still has changes. Commit or report those changes, then remove it without --force", positional.slice(1).map((p) => resolve(dir, p).replace(/\\/g, "/")));
  }
  if (sub === "filter-branch" || sub === "filter-repo") return hit("history-rewrite", "it rewrites history");
  if (sub === "reflog" && ["expire", "delete"].includes(positional[0])) return hit("reflog-destroy", "it destroys the reflog, the only record of dropped commits");
  if (sub === "update-ref" && flags.some((f) => isCluster(f, "d"))) return hit("ref-delete", "it deletes a ref directly", positional);
  if (sub === "gc" && flags.some((f) => f.startsWith("--prune"))) return hit("gc-prune", "it prunes unreachable commits that the reflog may still need");
  return null;
}

function checkGh(args) {
  const [area, verb] = args.filter((a) => !a.startsWith("-")).map((a) => a.toLowerCase());
  if (["repo", "release", "secret", "variable"].includes(area) && verb === "delete") return hit("gh-delete", `it deletes a GitHub ${area}`);
  if (area === "repo" && ["archive", "rename", "edit"].includes(verb)) return hit("gh-repo-settings", "it changes repository-level settings");
  if (area === "pr" && verb === "merge" && args.includes("--admin")) return hit("gh-admin-merge", "it merges past branch protection (--admin). Merge only when checks pass");
  if (area === "api") {
    const m = args.findIndex((a) => a === "-X" || a === "--method");
    if (m >= 0 && /^delete$/i.test(args[m + 1] ?? "")) return hit("gh-api-delete", "it sends a DELETE to the GitHub API");
  }
  return null;
}

function checkDelete(cmd, args) {
  const recursive = cmd === "rmdir" || cmd === "rd" || args.some((a) => isCluster(a, "rR") || /^--recursive$/.test(a) || /^\/s$/i.test(a));
  if (!recursive) return null;
  for (const a of args) {
    if (/^-/.test(a) || /^\/[a-z]$/i.test(a)) continue;
    const why = dangerousTarget(a);
    if (why) return hit("recursive-delete", `it recursively deletes ${why}. Delete the specific files or build directory you mean, by literal path`, [a]);
  }
  return null;
}

/** Every rule a command trips, in order. */
function hitsOf(command, cwd, depth) {
  if (depth > 3 || typeof command !== "string") return [];
  command = stripHeredocs(command);
  const found = [];
  for (const inner of nested(command)) found.push(...hitsOf(inner, cwd, depth + 1));
  for (let toks of segments(command)) {
    while (toks.length && (WRAPPERS.has(base(toks[0])) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0]))) {
      if (/^HUSKY=0$/.test(toks[0])) found.push(hit("hook-bypass", "it disables the repository's commit hooks (HUSKY=0). Fix what the hook reports and commit normally"));
      toks = toks.slice(1);
    }
    if (!toks.length) continue;
    const cmd = base(toks[0]);
    const args = toks.slice(1);
    let h = null;
    if (cmd === "git") h = checkGit(args, cwd);
    else if (cmd === "gh") h = checkGh(args);
    else if (DELETERS.has(cmd)) h = checkDelete(cmd, args);
    else if (SHELLS.has(cmd)) {
      for (const a of args) if (/\s/.test(a)) found.push(...hitsOf(a, cwd, depth + 1));
    } else if (EVALS.has(cmd)) found.push(...hitsOf(args.join(" "), cwd, depth + 1));
    if (h) found.push(h);
  }
  return found;
}

const globRe = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);

/** An allow entry is a rule id, or `rule:glob`, which needs every subject of the hit to match the glob. */
export function allowed(h, allow) {
  return allow.some((entry) => {
    const cut = entry.indexOf(":");
    const id = cut < 0 ? entry : entry.slice(0, cut);
    if (id !== h.id) return false;
    if (cut < 0) return true;
    const re = globRe(entry.slice(cut + 1));
    return h.subjects.length > 0 && h.subjects.every((s) => re.test(s));
  });
}

/** The first rule a command trips that is not allowed, as { id, why }, or null. */
export function verdict(command, cwd = process.cwd(), allow = BUILTIN_ALLOW) {
  return hitsOf(command, cwd, 0).find((h) => !allowed(h, allow)) ?? null;
}

const STALE_MS = 48 * 3600 * 1000;
const fresh = (file) => {
  try {
    return Date.now() - statSync(file).mtimeMs < STALE_MS;
  } catch {
    return false;
  }
};

/** True when a run is in progress at or above cwd: state.json not done, or a ledger with no finish/STOP line. Stale files (48 h) do not count. */
export function runActive(cwd) {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const ap = join(dir, ".autopilot");
    if (existsSync(ap)) {
      const state = join(ap, "state.json");
      try {
        if (fresh(state) && JSON.parse(readFileSync(state, "utf8")).phase !== "done") return true;
      } catch {}
      try {
        for (const e of readdirSync(ap, { withFileTypes: true })) {
          const ledger = join(ap, e.name, "ledger.md");
          if (e.isDirectory() && fresh(ledger) && !/^(finish|STOP):/m.test(readFileSync(ledger, "utf8"))) return true;
        }
      } catch {}
    }
    if (dirname(dir) === dir) return false;
  }
}

/** Rules files: the repository's, then the machine's. Allow lists add up; the repository's scope wins. */
export function loadRules(cwd) {
  const files = [];
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".autopilot"))) {
      files.push(join(dir, ".autopilot", "guard.json"));
      break;
    }
    if (dirname(dir) === dir) break;
  }
  files.push(join(process.env.AUTOPILOT_HOME || join(homedir(), ".claude", "autopilot"), "guard.json"));
  const rules = { scope: null, allow: [] };
  for (const f of files) {
    try {
      const j = JSON.parse(readFileSync(f, "utf8"));
      if (Array.isArray(j.allow)) rules.allow.push(...j.allow.filter((a) => typeof a === "string"));
      if (rules.scope === null && (j.scope === "always" || j.scope === "runs")) rules.scope = j.scope;
    } catch {}
  }
  return rules;
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return 0;
  }
  const command = input?.tool_input?.command;
  const cwd = input?.cwd || process.cwd();
  let h = null;
  try {
    const rules = loadRules(cwd);
    if (rules.scope === "runs" && !runActive(cwd)) return 0;
    h = verdict(command, cwd, [...BUILTIN_ALLOW, ...rules.allow]);
  } catch {
    return 0;
  }
  if (!h) return 0;
  process.stderr.write(`autopilot guard: blocked [${h.id}], because ${h.why}. If the task truly needs this, report it as a blocker instead of working around the guard.\n`);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
