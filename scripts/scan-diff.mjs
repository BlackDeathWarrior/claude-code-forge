#!/usr/bin/env node
// Leftover scan: reads the lines a branch ADDED since BASE and flags what should
// never ship. Deterministic, so it costs no model tokens.
//   node scan-diff.mjs <BASE> [HEAD]        (run from inside the repository)
// Prints one finding per line as "[P#] file:line rule - excerpt" and exits 1
// when any P0 or P1 finding exists, 0 otherwise.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SKIP_FILE = /(^|\/)(node_modules|dist|build|out|vendor|coverage|\.next|\.autopilot)\/|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|go\.sum|composer\.lock|Gemfile\.lock)$|\.(min\.js|min\.css|map|snap|svg|png|jpe?g|gif|webp|ico|pdf|woff2?)$/;
const DOC_FILE = /\.(md|mdx|txt|rst|adoc)$/i;
const TEST_FILE = /(^|\/)(tests?|__tests__|spec|e2e|fixtures?|mocks?)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|(^|\/)test_[^/]*\.py$/i;
const CODE_JS = /\.(m?[jt]sx?|vue|svelte|astro)$/i;
const PLACEHOLDER = /(process\.env|import\.meta\.env|os\.environ|getenv|\$\{|<[^>]+>|x{4,}|\*{4,}|your[_-]|example|placeholder|changeme|dummy|redacted|not[_-]?a[_-]?real|test[_-]?(key|token|secret)|fake)/i;

const SECRET_RULES = [
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["private-key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
  ["anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["openai-style-key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}/],
  ["github-token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}/],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["stripe-live-key", /\b[sr]k_live_[A-Za-z0-9]{16,}/],
  ["planetscale-token", /\bpscale_(?:tkn|pw|oauth)_[A-Za-z0-9_.-]{20,}/],
  ["connection-string-with-password", /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s:@/'"]+:[^\s@/'"]{6,}@/i],
  ["hardcoded-credential", /(?:api[_-]?key|secret|token|passwd|password|private[_-]?key)["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i],
];

const redact = (s) =>
  s
    .replace(/(:\/\/[^\s:@/'"]+:)[^\s@/'"]+@/g, "$1[redacted]@")
    .replace(/([A-Za-z0-9_\-+/=.]{6})[A-Za-z0-9_\-+/=.]{10,}/g, "$1…[redacted]");
const clip = (s) => (s.length > 110 ? s.slice(0, 110) + "…" : s);

/** Findings for one added line. */
export function scanLine(file, text) {
  const out = [];
  const f = file.replace(/\\/g, "/");
  if (SKIP_FILE.test(f)) return out;
  const isDoc = DOC_FILE.test(f);
  const isTest = TEST_FILE.test(f);

  for (const [rule, re] of SECRET_RULES) {
    const m = re.exec(text);
    if (!m) continue;
    // A placeholder word elsewhere on the line (a template string, a type annotation) must not hide a real key:
    // judge only the matched value, except for the two rules whose value is a quoted string next to a name.
    if ((rule === "hardcoded-credential" || rule === "connection-string-with-password") && (PLACEHOLDER.test(m[0]) || isTest || isDoc)) continue;
    if (PLACEHOLDER.test(m[0]) && rule !== "private-key") continue;
    out.push(["P0", rule, redact(text.trim())]);
    break;
  }
  if (/^(<{7}|>{7})( |$)/.test(text)) out.push(["P1", "conflict-marker", text.trim()]);
  if (isDoc) return out;
  if (/\b(?:describe|context|it|test)\.only\s*\(|\b(?:fdescribe|fit)\s*\(/.test(text)) out.push(["P1", "focused-test", text.trim()]);
  if (/^\s*debugger\s*;?\s*$/.test(text) || /\bbinding\.pry\b|\bpdb\.set_trace\(\)|^\s*breakpoint\(\)\s*$/.test(text)) out.push(["P1", "debugger-statement", text.trim()]);
  if (!isTest && CODE_JS.test(f) && /\bconsole\.(log|debug)\s*\(/.test(text) && !/eslint-disable|allow-console/.test(text)) out.push(["P2", "debug-log", text.trim()]);
  if (!isTest && /\.rs$/.test(f) && /\bdbg!\s*\(/.test(text)) out.push(["P2", "debug-log", text.trim()]);
  if (/\b(TODO|FIXME|HACK|XXX)\b/.test(text)) out.push(["P3", "todo-marker", text.trim()]);
  return out;
}

const ENV_FILE = /(^|\/)\.env(\.(local|production|prod|staging|development))?$/;

/** Env files among the paths a change added (from `git diff --name-status --no-renames`), empty ones and renames included. */
export function addedEnvFiles(nameStatus) {
  return nameStatus.split("\n").map((l) => /^A\t(.+)$/.exec(l.trim())?.[1]).filter((f) => f && ENV_FILE.test(f));
}

/** Findings for a unified diff: only added lines, with their new-file line numbers. */
export function scanDiff(diff) {
  const findings = [];
  let file = null;
  let line = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of diff.split("\n")) {
    // inside a hunk every line is body, even one that happens to start with "+++ " or "--- "
    if (oldLeft > 0 || newLeft > 0) {
      if (raw.startsWith("+")) {
        newLeft--;
        if (file) for (const [sev, rule, excerpt] of scanLine(file, raw.slice(1))) findings.push([sev, file, line, rule, clip(excerpt)]);
        line++;
      } else if (raw.startsWith("-")) oldLeft--;
      else if (!raw.startsWith("\\")) {
        oldLeft--;
        newLeft--;
        line++;
      }
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4).trim();
      file = p === "/dev/null" ? null : p.replace(/^b\//, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (hunk) {
      line = Number(hunk[2]);
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
      continue;
    }
    if (!file || raw.startsWith("---") || raw.startsWith("\\")) continue;
    if (raw.startsWith("+")) {
      for (const [sev, rule, excerpt] of scanLine(file, raw.slice(1))) findings.push([sev, file, line, rule, clip(excerpt)]);
      line++;
    } else if (!raw.startsWith("-")) line++;
  }
  return findings;
}

function main() {
  const [base, head = "HEAD"] = process.argv.slice(2);
  if (!base) {
    console.error("usage: node scan-diff.mjs <BASE> [HEAD]");
    return 2;
  }
  let diff;
  try {
    diff = execFileSync("git", ["-c", "core.quotePath=false", "diff", "--unified=0", "--no-color", "--no-ext-diff", `${base}..${head}`], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  } catch (e) {
    console.error(`scan-diff: git diff ${base}..${head} failed: ${String(e.stderr || e.message).trim()}`);
    return 2;
  }
  const names = execFileSync("git", ["-c", "core.quotePath=false", "diff", "--name-status", "--no-renames", `${base}..${head}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const envs = addedEnvFiles(names).map((f) => ["P0", f, 1, "env-file-committed", "an env file is being added to the repository"]);
  const findings = [...envs, ...scanDiff(diff)].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [sev, file, line, rule, excerpt] of findings) console.log(`[${sev}] ${file}:${line} ${rule} - ${excerpt}`);
  const count = (s) => findings.filter((f) => f[0] === s).length;
  console.log(`scan-diff: ${findings.length} finding(s) in ${base}..${head} (P0 ${count("P0")}, P1 ${count("P1")}, P2 ${count("P2")}, P3 ${count("P3")})`);
  return count("P0") + count("P1") > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
