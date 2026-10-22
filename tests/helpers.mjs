import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const scripts = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");

/** Run a command; returns { status, out, err }. */
export function sh(cwd, cmd, args = [], env = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

export const node = (cwd, script, args = [], env = {}) => sh(cwd, process.execPath, [join(scripts, script), ...args], env);

/** A throwaway git repository with one commit; call .cleanup() when done. */
export function tempRepo(files = { "README.md": "# t\n" }) {
  const dir = mkdtempSync(join(tmpdir(), "forge-test-"));
  const git = (...a) => sh(dir, "git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...a]);
  git("init", "-q", "-b", "main");
  const write = (rel, text) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  for (const [f, t] of Object.entries(files)) write(f, t);
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return {
    dir,
    git,
    write,
    commit: (msg) => (git("add", "-A"), git("commit", "-q", "-m", msg), git("rev-parse", "HEAD").out),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function tempDir(prefix = "forge-tmp-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
