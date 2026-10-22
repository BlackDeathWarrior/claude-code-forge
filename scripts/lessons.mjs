#!/usr/bin/env node
// The pipeline's memory across builds and across projects. No model tokens.
//
// Every lesson has a scope:
//   repo          true of one repository (its commands, its flaky test)
//   stack:<tag>   true of a technology wherever it is used (nextjs, prisma, postgres ...)
//   machine       true of this computer, its tools, or the pipeline itself, in every project
// A repo lesson that a second project reports too is promoted to machine by itself.
//
//   node lessons.mjs sync                         write the lessons that apply to THIS repository
//                                                 to .autopilot/LESSONS.md and print one line
//   node lessons.mjs add --scope <scope> "<what happened -> what to do instead>"
//   node lessons.mjs drop "<text fragment>"       remove matching lessons that apply here
//   node lessons.mjs list                         everything, all projects
//
// Store: ~/.claude/autopilot/lessons.json (rendered beside it as LESSONS.md for reading).
// AUTOPILOT_HOME overrides that directory. Always exits 0.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CAP = { repo: 40, stack: 25, machine: 40 };
const SIMILAR = 0.6;
const STOP = new Set("a an the of to in on at for and or but with without by from is are was were be been it its this that these those as so not no do does did use used using run runs ran running when then than into out up".split(" "));

// ---------- stack detection: which technologies does this repository use? ----------
const NPM_TAGS = {
  next: "nextjs", react: "react", "react-dom": "react", vue: "vue", nuxt: "nuxt", svelte: "svelte", "@sveltejs/kit": "sveltekit", astro: "astro", "@angular/core": "angular", "solid-js": "solid",
  express: "express", fastify: "fastify", "@nestjs/core": "nestjs", hono: "hono", koa: "koa", "@trpc/server": "trpc", graphql: "graphql", "socket.io": "socketio",
  prisma: "prisma", "@prisma/client": "prisma", "drizzle-orm": "drizzle", typeorm: "typeorm", sequelize: "sequelize", mongoose: "mongodb", mongodb: "mongodb", knex: "knex",
  pg: "postgres", postgres: "postgres", mysql2: "mysql", mysql: "mysql", "better-sqlite3": "sqlite", sqlite3: "sqlite", redis: "redis", ioredis: "redis", "@planetscale/database": "planetscale",
  "@supabase/supabase-js": "supabase", firebase: "firebase", "firebase-admin": "firebase", stripe: "stripe", "next-auth": "nextauth", "@clerk/nextjs": "clerk", "@anthropic-ai/sdk": "claude-api", openai: "openai",
  tailwindcss: "tailwind", vite: "vite", webpack: "webpack", turbo: "turborepo", typescript: "typescript", eslint: "eslint", prettier: "prettier", husky: "husky",
  jest: "jest", vitest: "vitest", "@playwright/test": "playwright", playwright: "playwright", cypress: "cypress", mocha: "mocha",
  electron: "electron", expo: "expo", "react-native": "react-native", "whatsapp-web.js": "whatsapp", "@whiskeysockets/baileys": "whatsapp", bullmq: "bullmq", zod: "zod",
};
const PY_TAGS = { django: "django", flask: "flask", fastapi: "fastapi", sqlalchemy: "sqlalchemy", pytest: "pytest", celery: "celery", pydantic: "pydantic", psycopg: "postgres", psycopg2: "postgres", pymysql: "mysql", pymongo: "mongodb", redis: "redis", anthropic: "claude-api", openai: "openai", streamlit: "streamlit", pandas: "pandas", torch: "pytorch", alembic: "alembic" };

export function detectStack(root) {
  const tags = new Set();
  const read = (f) => {
    try {
      return readFileSync(join(root, f), "utf8");
    } catch {
      return null;
    }
  };
  const pkg = read("package.json");
  if (pkg) {
    tags.add("node");
    try {
      const p = JSON.parse(pkg);
      for (const dep of Object.keys({ ...p.dependencies, ...p.devDependencies, ...p.peerDependencies })) if (NPM_TAGS[dep]) tags.add(NPM_TAGS[dep]);
    } catch {}
    for (const [f, t] of [["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lockb", "bun"], ["bun.lock", "bun"], ["package-lock.json", "npm"]]) if (existsSync(join(root, f))) tags.add(t);
  }
  if (existsSync(join(root, "tsconfig.json"))) tags.add("typescript");
  const py = [read("requirements.txt"), read("pyproject.toml"), read("Pipfile")].filter(Boolean).join("\n").toLowerCase();
  if (py) {
    tags.add("python");
    for (const [dep, t] of Object.entries(PY_TAGS)) if (new RegExp(`(^|[^a-z0-9_-])${dep}([^a-z0-9_-]|$)`, "m").test(py)) tags.add(t);
  }
  for (const [f, t] of [["go.mod", "go"], ["Cargo.toml", "rust"], ["Gemfile", "ruby"], ["composer.json", "php"], ["pom.xml", "java"], ["build.gradle", "gradle"], ["build.gradle.kts", "gradle"], ["pubspec.yaml", "flutter"], ["Dockerfile", "docker"], ["docker-compose.yml", "docker"], ["compose.yaml", "docker"], ["schema.prisma", "prisma"], ["prisma/schema.prisma", "prisma"], ["vercel.json", "vercel"], ["netlify.toml", "netlify"], [".github/workflows", "github-actions"]]) {
    if (existsSync(join(root, f))) tags.add(t);
  }
  const gem = read("Gemfile");
  if (gem && /\brails\b/.test(gem)) tags.add("rails");
  const composer = read("composer.json");
  if (composer && /laravel\/framework/.test(composer)) tags.add("laravel");
  if (process.platform === "win32") tags.add("windows");
  return [...tags].sort();
}

// ---------- the store ----------
const home = () => process.env.AUTOPILOT_HOME || join(homedir(), ".claude", "autopilot");
const storePath = () => join(home(), "lessons.json");

export function load() {
  try {
    const s = JSON.parse(readFileSync(storePath(), "utf8"));
    if (Array.isArray(s.lessons)) return s;
  } catch {}
  return { version: 1, lessons: [] };
}
function save(store) {
  mkdirSync(home(), { recursive: true });
  const tmp = `${storePath()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, storePath());
  writeFileSync(join(home(), "LESSONS.md"), renderAll(store));
}

const today = () => new Date().toISOString().slice(0, 10);
const words = (t) => new Set(String(t).toLowerCase().replace(/[^a-z0-9_./-]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));
export function similarity(a, b) {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

export function projectRoot(cwd = process.cwd()) {
  const r = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, encoding: "utf8" });
  // The common dir is <main checkout>/.git, also from inside a linked worktree.
  const root = r.status === 0 && r.stdout.trim() ? resolve(r.stdout.trim(), "..") : resolve(cwd);
  return root.replace(/\\/g, "/");
}
const key = (p) => p.toLowerCase();

/** Add or reinforce a lesson. Returns what happened, for the one-line report. */
export function add(store, { scope, tags = [], text, project }) {
  text = String(text).trim().replace(/\s+/g, " ");
  const now = today();
  const sameKind = (l) => (scope === "stack" ? l.scope === "stack" && l.tags.some((t) => tags.includes(t)) : true);
  let best = null;
  for (const l of store.lessons) {
    if (scope === "stack" ? !sameKind(l) : l.scope === "stack") continue;
    const s = similarity(l.text, text);
    if (s >= SIMILAR && (!best || s > best.s)) best = { l, s };
  }
  if (best) {
    const l = best.l;
    l.count++;
    l.last = now;
    if (!l.projects.some((p) => key(p) === key(project))) l.projects.push(project);
    for (const t of tags) if (!l.tags.includes(t)) l.tags.push(t);
    if (l.scope === "repo" && (scope === "machine" || new Set(l.projects.map(key)).size >= 2)) {
      l.scope = "machine";
      l.promoted = now;
      return { what: "promoted", lesson: l };
    }
    return { what: "reinforced", lesson: l };
  }
  const lesson = { id: `${now}-${Math.random().toString(36).slice(2, 8)}`, scope, tags: [...tags], text, projects: [project], count: 1, first: now, last: now };
  store.lessons.push(lesson);
  prune(store, project);
  return { what: "added", lesson };
}

function prune(store, project) {
  const rank = (a, b) => b.last.localeCompare(a.last) || b.count - a.count;
  const keep = new Set();
  const groups = [store.lessons.filter((l) => l.scope === "machine").sort(rank).slice(0, CAP.machine)];
  const repos = new Set(store.lessons.filter((l) => l.scope === "repo").flatMap((l) => l.projects.map(key)));
  for (const r of repos) groups.push(store.lessons.filter((l) => l.scope === "repo" && l.projects.some((p) => key(p) === r)).sort(rank).slice(0, CAP.repo));
  const tags = new Set(store.lessons.filter((l) => l.scope === "stack").flatMap((l) => l.tags));
  for (const t of tags) groups.push(store.lessons.filter((l) => l.scope === "stack" && l.tags.includes(t)).sort(rank).slice(0, CAP.stack));
  for (const g of groups) for (const l of g) keep.add(l.id);
  store.lessons = store.lessons.filter((l) => keep.has(l.id));
}

/** The lessons that apply to one repository, by scope. */
export function applicable(store, project, stack) {
  const rank = (a, b) => b.last.localeCompare(a.last) || b.count - a.count;
  return {
    repo: store.lessons.filter((l) => l.scope === "repo" && l.projects.some((p) => key(p) === key(project))).sort(rank),
    stack: store.lessons.filter((l) => l.scope === "stack" && l.tags.some((t) => stack.includes(t))).sort(rank).slice(0, CAP.stack),
    machine: store.lessons.filter((l) => l.scope === "machine").sort(rank).slice(0, CAP.machine),
  };
}

const line = (l, { showTags = false, showOrigin = false } = {}) => {
  const tags = showTags && l.tags.length ? `[${l.tags.join(", ")}] ` : "";
  const seen = l.count > 1 ? ` (seen ${l.count}x)` : "";
  const origin = showOrigin ? ` (from ${[...new Set(l.projects.map((p) => basename(p)))].slice(0, 4).join(", ")})` : "";
  return `- ${l.last} ${tags}${l.text}${seen}${origin}`;
};

export function renderFor(store, project, stack) {
  const a = applicable(store, project, stack);
  const out = ["# Lessons", "", "What earlier builds learned the hard way, here and in other projects. Act on every line that applies to the work in front of you.", ""];
  if (a.repo.length) out.push("## This repository", ...a.repo.map((l) => line(l)), "");
  if (a.stack.length) out.push(`## This stack (${stack.join(", ")})`, "Learned in any project that uses the same technology.", ...a.stack.map((l) => line(l, { showTags: true, showOrigin: true })), "");
  if (a.machine.length) out.push("## Every project on this machine", ...a.machine.map((l) => line(l, { showOrigin: true })), "");
  return { text: out.join("\n"), counts: { repo: a.repo.length, stack: a.stack.length, machine: a.machine.length } };
}

function renderAll(store) {
  const out = ["# Autopilot lessons (all projects)", "", "Rendered from lessons.json by lessons.mjs. To remove a lesson, run `node lessons.mjs drop \"<text fragment>\"` from the project it applies to, or delete its entry from lessons.json.", ""];
  const machine = store.lessons.filter((l) => l.scope === "machine");
  const stack = store.lessons.filter((l) => l.scope === "stack");
  const repo = store.lessons.filter((l) => l.scope === "repo");
  out.push(`## Every project (${machine.length})`, ...machine.map((l) => line(l, { showOrigin: true })), "");
  out.push(`## By technology (${stack.length})`, ...stack.map((l) => line(l, { showTags: true, showOrigin: true })), "");
  out.push(`## One repository only (${repo.length})`, ...repo.map((l) => `${line(l)} (${basename(l.projects[0])})`), "");
  return out.join("\n");
}

/** .autopilot/ is run state: it must never show up in `git status`. */
function keepOutOfGit(project) {
  const git = (...args) => spawnSync("git", args, { cwd: project, encoding: "utf8" });
  if (git("rev-parse", "--is-inside-work-tree").status !== 0) return;
  if (git("check-ignore", "-q", ".autopilot/").status === 0) return;
  const common = git("rev-parse", "--path-format=absolute", "--git-common-dir").stdout.trim();
  if (!common) return;
  const file = join(common, "info", "exclude");
  mkdirSync(join(common, "info"), { recursive: true });
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, `${current}${current.endsWith("\n") || !current ? "" : "\n"}.autopilot/\n`);
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const project = projectRoot();
  const store = load();
  if (cmd === "sync") {
    const stack = detectStack(project);
    const { text, counts } = renderFor(store, project, stack);
    const total = counts.repo + counts.stack + counts.machine;
    const stackNote = `stack: ${stack.length ? stack.join(", ") : "none detected"}`;
    if (!total) return console.log(`lessons: none yet (${stackNote})`);
    const file = join(project, ".autopilot", "LESSONS.md");
    mkdirSync(join(project, ".autopilot"), { recursive: true });
    writeFileSync(file, text);
    keepOutOfGit(project);
    return console.log(`lessons: ${counts.repo} for this repository, ${counts.stack} for its stack, ${counts.machine} for this machine (${stackNote}) -> ${file.replace(/\\/g, "/")}`);
  }
  if (cmd === "add") {
    const si = argv.indexOf("--scope");
    const scopeArg = si >= 0 ? argv[si + 1] : "";
    const text = argv.filter((a, i) => i > 0 && i !== si && i !== si + 1).join(" ");
    const m = /^(repo|machine)$|^stack:([a-z0-9,._ -]+)$/i.exec(scopeArg || "");
    if (!m || !text.trim()) return console.log('lessons: not added (usage: add --scope repo|machine|stack:<tag>[,<tag>] "<what happened -> what to do instead>")');
    const scope = m[1] ? m[1].toLowerCase() : "stack";
    const tags = m[2] ? m[2].toLowerCase().split(",").map((t) => t.trim()).filter(Boolean) : [];
    const r = add(store, { scope, tags, text, project });
    save(store);
    const where = r.lesson.scope === "machine" ? "every project" : r.lesson.scope === "stack" ? `stack ${r.lesson.tags.join(", ")}` : "this repository";
    return console.log(`lessons: ${r.what} for ${where}${r.what === "promoted" ? ` (reported by ${new Set(r.lesson.projects.map(key)).size} projects)` : ""}: ${r.lesson.text.slice(0, 90)}`);
  }
  if (cmd === "drop") {
    const frag = argv.slice(1).join(" ").trim().toLowerCase();
    if (frag.length < 4) return console.log("lessons: nothing dropped (give at least 4 characters of the lesson's text)");
    const stack = detectStack(project);
    const a = applicable(store, project, stack);
    const ids = new Set([...a.repo, ...a.stack, ...a.machine].filter((l) => l.text.toLowerCase().includes(frag)).map((l) => l.id));
    store.lessons = store.lessons.filter((l) => !ids.has(l.id));
    save(store);
    return console.log(`lessons: dropped ${ids.size}`);
  }
  if (cmd === "list") return console.log(renderAll(store));
  console.log('lessons: usage: sync | add --scope repo|machine|stack:<tag> "<text>" | drop "<fragment>" | list');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.log(`lessons: skipped (${e.message})`);
  }
  process.exit(0);
}
