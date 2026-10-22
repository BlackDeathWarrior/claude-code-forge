#!/usr/bin/env node
// Checks the plugin for the mistakes that only show up after install: a reserved or mismatched name, an
// agent or skill whose frontmatter is wrong, a hook that points at a script that is not there, a
// ${CLAUDE_PLUGIN_ROOT} in a file the harness never substitutes, a link or dispatch name that goes nowhere.
//   node tools/validate.mjs [plugin directory]      exits 1 on any error, prints warnings
// `claude plugin validate . --strict` checks the manifest against the real schema; this checks the rest.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RESERVED = new Set(["claude-code-marketplace", "claude-code-plugins", "claude-plugins-official", "anthropic-marketplace", "anthropic-plugins", "agent-skills", "life-sciences"]);
const MODELS = /^(sonnet|opus|haiku|inherit|claude-[a-z0-9.-]+)$/;
// Files where the harness replaces ${CLAUDE_PLUGIN_ROOT}: agent and skill bodies, and hook config.
const SUBSTITUTED = (rel) => /^agents\/[^/]+\.md$/.test(rel) || /^skills\/[^/]+\/SKILL\.md$/.test(rel) || rel === "hooks/hooks.json";
// Files read as prose by people, where the variable is only text.
const PROSE = (rel) => /^(README|CHANGELOG|CONTRIBUTING|SECURITY|ARCHITECTURE|CREDITS)\.md$/.test(rel) || /^docs\//.test(rel);

const read = (p) => readFileSync(p, "utf8");
const json = (p) => JSON.parse(read(p));

function walk(dir, skip = new Set(["node_modules", ".git", "graphify-out", ".autopilot"])) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, skip));
    else out.push(p);
  }
  return out;
}

export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return fm;
}

export function validate(root) {
  root = resolve(root);
  const errors = [];
  const warnings = [];
  const err = (f, msg) => errors.push(`${f}: ${msg}`);
  const warn = (f, msg) => warnings.push(`${f}: ${msg}`);
  const rel = (p) => relative(root, p).replace(/\\/g, "/");

  // manifests
  let plugin = null;
  let market = null;
  try {
    plugin = json(join(root, ".claude-plugin", "plugin.json"));
  } catch (e) {
    err(".claude-plugin/plugin.json", `unreadable (${e.message})`);
  }
  try {
    market = json(join(root, ".claude-plugin", "marketplace.json"));
  } catch (e) {
    warn(".claude-plugin/marketplace.json", `unreadable or absent (${e.message})`);
  }
  const nameOk = (f, n) => {
    if (typeof n !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n)) err(f, `name "${n}" must be lowercase kebab-case`);
    else if (/^(claude|anthropic)[-_]/.test(n) || RESERVED.has(n)) err(f, `name "${n}" is reserved: names that start with claude- or anthropic- cannot be installed from a third party`);
  };
  if (plugin) {
    nameOk("plugin.json", plugin.name);
    if (!/^\d+\.\d+\.\d+/.test(plugin.version ?? "")) err("plugin.json", `version "${plugin.version}" is not semver`);
    if (!plugin.description) err("plugin.json", "no description");
    if (plugin.hooks === "./hooks/hooks.json" || plugin.hooks === "hooks/hooks.json") err("plugin.json", '"hooks" repeats the default hooks/hooks.json, which loads by itself and would load twice');
  }
  if (market) {
    nameOk("marketplace.json", market.name);
    for (const p of market.plugins ?? []) {
      nameOk("marketplace.json plugin", p.name);
      if (plugin && p.source === "./" && p.name !== plugin.name) err("marketplace.json", `lists "${p.name}" for this directory, whose plugin.json says "${plugin.name}"`);
    }
  }

  // agents
  const agents = new Set();
  const agentDir = join(root, "agents");
  if (existsSync(agentDir)) {
    for (const f of readdirSync(agentDir).filter((n) => n.endsWith(".md"))) {
      const file = `agents/${f}`;
      const fm = frontmatter(read(join(agentDir, f)));
      if (!fm) {
        err(file, "no frontmatter");
        continue;
      }
      agents.add(fm.name);
      if (fm.name !== basename(f, ".md")) err(file, `name "${fm.name}" differs from the file name`);
      if (!fm.description) err(file, "no description");
      if (fm.model && !MODELS.test(fm.model)) err(file, `unknown model "${fm.model}"`);
      for (const k of ["permissionMode", "hooks", "mcpServers"]) if (k in fm) err(file, `${k} is ignored in a plugin agent`);
    }
  }

  // skills
  const skills = new Set();
  const skillDir = join(root, "skills");
  if (existsSync(skillDir)) {
    for (const d of readdirSync(skillDir).filter((n) => statSync(join(skillDir, n)).isDirectory())) {
      const file = `skills/${d}/SKILL.md`;
      if (!existsSync(join(root, file))) {
        err(file, "missing");
        continue;
      }
      const fm = frontmatter(read(join(root, file)));
      if (!fm) err(file, "no frontmatter");
      else {
        skills.add(fm.name);
        if (fm.name !== d) err(file, `name "${fm.name}" differs from its directory`);
        if (!fm.description) err(file, "no description");
        else if (fm.description.length > 1024) warn(file, `description is ${fm.description.length} characters; long descriptions are cut when skills are listed`);
      }
    }
  }

  // hooks
  const hooksFile = join(root, "hooks", "hooks.json");
  if (existsSync(hooksFile)) {
    try {
      const h = json(hooksFile);
      for (const [event, groups] of Object.entries(h.hooks ?? {})) {
        for (const g of groups) {
          for (const hk of g.hooks ?? []) {
            if (hk.type !== "command") continue;
            for (const m of String(hk.command).matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/g)) {
              if (!existsSync(join(root, m[1]))) err("hooks/hooks.json", `${event} runs ${m[1]}, which does not exist`);
            }
            if (!/\$\{CLAUDE_PLUGIN_ROOT\}/.test(hk.command)) warn("hooks/hooks.json", `${event} command does not use \${CLAUDE_PLUGIN_ROOT}: ${hk.command}`);
          }
        }
      }
    } catch (e) {
      err("hooks/hooks.json", `unreadable (${e.message})`);
    }
  }

  // every text file
  for (const p of walk(root)) {
    const r = rel(p);
    if (!/\.(md|json|mjs)$/.test(r) || /^tests\//.test(r) || r === "tools/validate.mjs" || r === "package-lock.json") continue;
    const text = read(p);
    if (/\$\{CLAUDE_PLUGIN_ROOT\}/.test(text) && !SUBSTITUTED(r) && !PROSE(r) && !/^scripts\//.test(r) && !/^\.claude-plugin\//.test(r)) {
      err(r, "${CLAUDE_PLUGIN_ROOT} here is never replaced: a file opened with the Read tool shows it literally. Use <scripts> and the root the dispatch or the skill states");
    }
    if (!r.endsWith(".md")) continue;
    // links
    // links inside a template or a code fence are examples for the files a build will write
    const linked = text.replace(/```[\s\S]*?```/g, "").replace(/<([a-z-]+-template|standards-seed)>[\s\S]*?<\/\1>/g, "");
    for (const m of linked.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1].split("#")[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      if (!existsSync(resolve(dirname(p), target))) err(r, `link to ${m[1]} goes nowhere`);
    }
    // scripts named in prose
    for (const m of text.matchAll(/(?:<scripts>|\bscripts)\/([A-Za-z0-9._-]+\.mjs)/g)) {
      if (!existsSync(join(root, "scripts", m[1]))) err(r, `names scripts/${m[1]}, which does not exist`);
    }
    // scoped dispatch names
    if (plugin) {
      for (const m of text.matchAll(new RegExp(`\`${plugin.name}:([a-z-]+)\``, "g"))) {
        if (m[1] !== "<agent>" && !agents.has(m[1]) && !skills.has(m[1])) err(r, `names ${plugin.name}:${m[1]}, which is neither an agent nor a skill here`);
      }
    }
  }

  // the skill that reads other files raw has to say what the root is
  const entry = join(skillDir, "autopilot", "SKILL.md");
  if (existsSync(entry) && !/\$\{CLAUDE_PLUGIN_ROOT\}|Plugin root/.test(read(entry))) warn("skills/autopilot/SKILL.md", "does not state the plugin root for files it reads raw");

  return { errors, warnings };
}

function main() {
  const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..");
  const { errors, warnings } = validate(root);
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.log(`error: ${e}`);
  console.log(errors.length ? `${errors.length} error(s)` : `plugin ok${warnings.length ? ` (${warnings.length} warning(s))` : ""}`);
  return errors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
