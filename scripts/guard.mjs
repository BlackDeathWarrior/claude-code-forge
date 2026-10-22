#!/usr/bin/env node
// PreToolUse tripwire for unattended /autopilot runs.
// Blocks shell commands that are irreversible or that reach shared state:
// force/delete pushes, pushes to a protected branch, hook bypasses, history
// destruction, and recursive deletes of a root, home, or repository.
// Exit 2 blocks the call and stderr tells the agent what to do instead.
// A tripwire, not a sandbox: anything it cannot parse is allowed (fails open).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

const PROTECTED = /^(main|master|trunk|production|prod|release)$/i;
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "pwsh", "powershell", "cmd", "wsl", "iex", "invoke-expression"]);
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

function checkGit(args, cwd) {
  // global options before the subcommand
  let i = 0;
  let dir = cwd;
  while (i < args.length && args[i].startsWith("-")) {
    if (args[i] === "-C") dir = args[i + 1] ?? dir;
    if (args[i] === "-c" && /^core\.hookspath=/i.test(args[i + 1] ?? "")) return "it overrides core.hooksPath to skip the repository's hooks. Fix what the hook reports and commit normally";
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

  if (has("--no-verify") || (sub === "commit" && flags.some((f) => isCluster(f, "n")))) return "it skips the repository's hooks (--no-verify). Fix what the hook reports and commit normally";

  if (sub === "push") {
    if (has("--force", "--force-with-lease", "--mirror", "--delete", "--prune") || flags.some((f) => isCluster(f, "fd"))) return "it force-pushes or deletes remote refs. Push new commits to the run's own branch instead";
    const refspecs = positional.slice(1);
    if (refspecs.some((r) => r.startsWith("+") || r.startsWith(":"))) return "it force-pushes or deletes remote refs. Push new commits to the run's own branch instead";
    const targets = refspecs.length ? refspecs.map((r) => r.split(":").pop()) : ["HEAD"];
    for (let t of targets) {
      if (t === "HEAD" || t === "@") t = currentBranch(dir);
      t = t.replace(/^refs\/heads\//, "");
      if (PROTECTED.test(t)) return `it pushes straight to the protected branch '${t}'. Push the run's own branch and open a pull request`;
    }
  }
  if (sub === "reset" && has("--hard") && positional.some((p) => p !== "HEAD")) return "it hard-resets to another commit and drops work. Use `git revert` for a commit, or `git reset --hard` with no ref to discard only uncommitted changes";
  if (sub === "clean" && !has("--dry-run") && !flags.some((f) => isCluster(f, "n")) && flags.some((f) => isCluster(f, "xX"))) return "it deletes ignored files, which include the run's ledger, dependencies and local env files. Remove the specific paths you mean";
  if (sub === "branch") {
    if (flags.some((f) => isCluster(f, "D")) || (has("--delete") && has("--force"))) return "it force-deletes a branch that may hold unmerged work. Use `git branch -d`, which refuses unmerged branches";
    if ((has("--force") || flags.some((f) => isCluster(f, "fM"))) && positional.some((p) => PROTECTED.test(p))) return "it force-moves a protected branch";
  }
  if ((sub === "switch" || sub === "checkout") && flags.some((f) => isCluster(f, "CB") || f === "--force-create")) {
    if (positional.length && PROTECTED.test(positional[0])) return `it resets the protected branch '${positional[0]}'`;
  }
  if (sub === "worktree" && positional[0] === "remove" && (has("--force") || flags.some((f) => isCluster(f, "f")))) return "it force-removes a worktree that still has changes. Commit or report those changes, then remove it without --force";
  if (sub === "filter-branch" || sub === "filter-repo") return "it rewrites history";
  if (sub === "reflog" && ["expire", "delete"].includes(positional[0])) return "it destroys the reflog, the only record of dropped commits";
  if (sub === "update-ref" && flags.some((f) => isCluster(f, "d"))) return "it deletes a ref directly";
  if (sub === "gc" && flags.some((f) => f.startsWith("--prune"))) return "it prunes unreachable commits that the reflog may still need";
  return null;
}

function checkGh(args) {
  const [area, verb] = args.filter((a) => !a.startsWith("-")).map((a) => a.toLowerCase());
  if (["repo", "release", "secret", "variable"].includes(area) && verb === "delete") return `it deletes a GitHub ${area}`;
  if (area === "repo" && ["archive", "rename", "edit"].includes(verb)) return "it changes repository-level settings";
  if (area === "pr" && verb === "merge" && args.includes("--admin")) return "it merges past branch protection (--admin). Merge only when checks pass";
  if (area === "api") {
    const m = args.findIndex((a) => a === "-X" || a === "--method");
    if (m >= 0 && /^delete$/i.test(args[m + 1] ?? "")) return "it sends a DELETE to the GitHub API";
  }
  return null;
}

function checkDelete(cmd, args) {
  const recursive = cmd === "rmdir" || cmd === "rd" || args.some((a) => isCluster(a, "rR") || /^--recursive$/.test(a) || /^\/s$/i.test(a));
  if (!recursive) return null;
  for (const a of args) {
    if (/^-/.test(a) || /^\/[a-z]$/i.test(a)) continue;
    const why = dangerousTarget(a);
    if (why) return `it recursively deletes ${why}. Delete the specific files or build directory you mean, by literal path`;
  }
  return null;
}

/** Returns the reason a command is blocked, or null. */
export function verdict(command, cwd = process.cwd(), depth = 0) {
  if (depth > 3 || typeof command !== "string") return null;
  for (const inner of nested(command)) {
    const why = verdict(inner, cwd, depth + 1);
    if (why) return why;
  }
  for (let toks of segments(command)) {
    while (toks.length && (WRAPPERS.has(base(toks[0])) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0]))) {
      if (/^HUSKY=0$/.test(toks[0])) return "it disables the repository's commit hooks (HUSKY=0). Fix what the hook reports and commit normally";
      toks = toks.slice(1);
    }
    if (!toks.length) continue;
    const cmd = base(toks[0]);
    const args = toks.slice(1);
    let why = null;
    if (cmd === "git") why = checkGit(args, cwd);
    else if (cmd === "gh") why = checkGh(args);
    else if (DELETERS.has(cmd)) why = checkDelete(cmd, args);
    else if (SHELLS.has(cmd)) {
      for (const a of args) if (/\s/.test(a)) why ??= verdict(a, cwd, depth + 1);
    }
    if (why) return why;
  }
  return null;
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return 0;
  }
  const command = input?.tool_input?.command;
  let why = null;
  try {
    why = verdict(command, input?.cwd || process.cwd());
  } catch {
    return 0;
  }
  if (!why) return 0;
  process.stderr.write(`autopilot guard: blocked, because ${why}. If the task truly needs this, report it as a blocker instead of working around the guard.\n`);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
