'use strict';
/**
 * yotta-skills 技能扫描核心（零依赖 Node.js 18+）
 *
 * 技能生态盘点：扫描各智能体技能目录，解析 SKILL.md frontmatter，
 * 建立本地技能注册表（~/.yottaskills/registry.json）。
 *
 * 自包含原则：本模块只依赖 Node.js 标准库，不依赖任何元技能
 * （不调用元信扫描、不调用元呈渲染、不调用元忆存储）；输出为
 * 结构化 JSON / 简单文本，由调用方（CLI / MCP）自行呈现。
 *
 * 用法（由 bin/yotta-skills.js 与 scripts/yotta-skills-mcp.py 复用）：
 *   const scan = require('../lib/skills-scan');
 *   const result = scan.scanRoots(scan.defaultRoots({ extraDirs, project }));
 *   scan.saveRegistry(result);  // 增量合并写 ~/.yottaskills/registry.json
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const REGISTRY_DIR_NAME = '.yottaskills';
const REGISTRY_FILE_NAME = 'registry.json';
const SKILL_FILE = 'SKILL.md';

// 智能体 -> 用户级默认技能目录（与 bin/yotta-skills.js AGENT_DIRS 同源；
// 依据 agent-skill-dir-map 权威映射，2026-08-23 核实）
const AGENT_DIRS = {
  claude:    { label: 'Claude Code',      dirs: ['.claude/skills'] },
  cursor:    { label: 'Cursor',           dirs: ['.cursor/skills', '.agents/skills'] },
  codex:     { label: 'Codex',            dirs: [] }, // 特判：$CODEX_HOME/skills
  gemini:    { label: 'Gemini CLI',       dirs: ['.gemini/skills', '.agents/skills'] },
  goose:     { label: 'Goose',            dirs: ['.config/goose/skills', '.agents/skills'] },
  amp:       { label: 'Amp',              dirs: ['.config/agents/skills', '.agents/skills'] },
  opencode:  { label: 'OpenCode',         dirs: [] }, // 特判：$XDG_CONFIG_HOME
  windsurf:  { label: 'Windsurf',         dirs: ['.codeium/windsurf/skills'] },
  workbuddy: { label: 'WorkBuddy',        dirs: ['.workbuddy/skills'] },
  kiro:      { label: 'Kiro',             dirs: ['.kiro/skills'] },
  trae:      { label: 'Trae Code CLI',    dirs: ['.traecli/skills'] },
  'trae-cn': { label: 'Trae IDE（国内）',  dirs: ['.trae-cn/skills'] },
  qwen:      { label: 'Qwen Code',        dirs: ['.qwen/skills'] },
  comate:    { label: 'Comate 文心快码',   dirs: ['.comate/skills'] },
  codebuddy: { label: 'CodeBuddy Code',   dirs: ['.codebuddy/skills'] },
  kimi:      { label: 'Kimi Code CLI',    dirs: ['.kimi/skills'] },
  agents:    { label: '通用 AGENTS.md',    dirs: ['.agents/skills'] },
};

/** 解析 SKILL.md 前部 YAML frontmatter（name/version/description 单行值）。 */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  const lines = m[1].split(/\r?\n/);
  let blockKey = null;
  let blockChunks = [];
  for (const raw of lines) {
    if (blockKey) {
      if (!raw.trim()) continue; // 空行：跳过并继续 block
      if (/^\s/.test(raw)) { blockChunks.push(raw.trim()); continue; }
      fm[blockKey] = blockChunks.join(' ');
      blockKey = null;
      blockChunks = [];
    }
    const t = raw.trim();
    if (!t || t.startsWith('#') || t.startsWith('-')) continue;
    const idx = t.indexOf(':');
    if (idx <= 0) continue;
    const key = t.slice(0, idx).trim();
    let val = t.slice(idx + 1).trim();
    if (!val) continue;
    if (/^[>|][-+]?$/.test(val)) {
      blockKey = key; // YAML block scalar（多行 description）
      blockChunks = [];
      continue;
    }
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fm[key] = val;
  }
  if (blockKey) fm[blockKey] = blockChunks.join(' ');
  return fm;
}

/** 扫描单个技能目录：子目录含 SKILL.md 且 frontmatter 有 name 即视为技能。 */
function scanSkillDir(dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return results;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const skillDir = path.join(dir, e.name);
    let text;
    try {
      text = fs.readFileSync(path.join(skillDir, SKILL_FILE), 'utf8');
    } catch (_) {
      continue;
    }
    const fm = parseFrontmatter(text);
    if (!fm || !fm.name) continue;
    results.push({
      slug: String(fm.name).trim(),
      version: fm.version ? String(fm.version).trim() : '',
      description: fm.description ? String(fm.description).trim() : '',
      source_dir: skillDir,
    });
  }
  return results;
}

/** Codex 用户级技能目录：$CODEX_HOME/skills（默认 ~/.codex/skills）。 */
function codexUserDir() {
  const base = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return path.join(base, 'skills');
}

/** OpenCode 用户级技能目录：$XDG_CONFIG_HOME/opencode/skills。 */
function opencodeUserDir() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'opencode', 'skills');
}

function resolveUserDir(rel) {
  if (rel === '.codex/skills') return codexUserDir();
  if (rel === '.config/opencode/skills') return opencodeUserDir();
  return path.join(os.homedir(), rel);
}

/**
 * 默认扫描根（agent-skill-dir-map 用户级目录）。
 * opts: { extraDirs: string[], project: boolean }
 * extraDirs 为任意额外技能目录；project 开启时附加当前项目
 * .agents/skills / .codex/skills。
 */
function defaultRoots(opts) {
  opts = opts || {};
  const roots = [];
  const seen = new Set();
  const add = (dir, label) => {
    if (!dir) return;
    const norm = path.resolve(dir);
    if (seen.has(norm)) return;
    seen.add(norm);
    roots.push({ dir: norm, label });
  };
  const home = os.homedir();
  for (const key of Object.keys(AGENT_DIRS)) {
    const info = AGENT_DIRS[key];
    for (const rel of info.dirs) add(resolveUserDir(rel), info.label);
  }
  add(codexUserDir(), 'Codex');
  add(opencodeUserDir(), 'OpenCode');
  if (Array.isArray(opts.extraDirs)) {
    for (const d of opts.extraDirs) add(d, '指定目录');
  }
  if (opts.project) {
    add(path.join(process.cwd(), '.agents', 'skills'), '项目 .agents/skills');
    add(path.join(process.cwd(), '.codex', 'skills'), '项目 .codex/skills');
  }
  return roots;
}

/**
 * 扫描多根目录并去重合并。
 * 同名技能（slug）合并：记录多个来源；版本不一致时记录 conflicts。
 */
function scanRoots(roots) {
  const map = new Map();
  const scanned = [];
  const errors = [];
  for (const r of roots) {
    if (!fs.existsSync(r.dir)) {
      errors.push({ dir: r.dir, label: r.label, reason: 'missing' });
      continue;
    }
    scanned.push({ dir: r.dir, label: r.label });
    for (const s of scanSkillDir(r.dir)) {
      const key = s.slug;
      const item = map.get(key);
      if (item) {
        if (!item.sources.includes(r.label)) item.sources.push(r.label);
        if (!item.source_dirs.includes(s.source_dir)) item.source_dirs.push(s.source_dir);
        if (item.version && s.version && item.version !== s.version) {
          item.conflicts = item.conflicts || [];
          item.conflicts.push({ dir: s.source_dir, version: s.version });
        }
      } else {
        s.sources = [r.label];
        s.source_dirs = [s.source_dir];
        map.set(key, s);
      }
    }
  }
  return {
    generated_at: new Date().toISOString(),
    skills: Array.from(map.values()).sort((a, b) => a.slug.localeCompare(b.slug)),
    scanned,
    errors,
  };
}

/** 注册表文件路径：~/.yottaskills/registry.json。 */
function registryPath() {
  return path.join(os.homedir(), REGISTRY_DIR_NAME, REGISTRY_FILE_NAME);
}

/** 读取注册表（不存在返回 null）。 */
function readRegistry(filePath) {
  const p = filePath || registryPath();
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * 增量合并：把扫描结果合并进注册表。
 * 新增（added） / 更新（updated，版本或来源变化） / 消失（gone，上次有本次无）。
 * 幂等：技能仍存在且版本来源一致则保持原记录不动。
 */
function mergeRegistry(scanResult, previous) {
  const prev = (previous && previous.skills) ? previous.skills : {};
  const next = {};
  const changes = { added: [], updated: [], gone: [] };
  const now = new Date().toISOString();
  const seen = new Set();
  for (const s of scanResult.skills) {
    seen.add(s.slug);
    const old = prev[s.slug];
    if (!old) {
      next[s.slug] = {
        slug: s.slug,
        version: s.version,
        description: s.description,
        sources: s.sources,
        source_dirs: s.source_dirs,
        first_seen: now,
        last_seen: now,
        status: 'known',
      };
      changes.added.push(s.slug);
    } else {
      const changed = old.version !== s.version
        || old.description !== s.description
        || JSON.stringify(old.sources || []) !== JSON.stringify(s.sources);
      next[s.slug] = {
        ...old,
        version: s.version,
        description: s.description,
        sources: s.sources,
        source_dirs: s.source_dirs,
        last_seen: now,
      };
      if (changed) changes.updated.push(s.slug);
    }
  }
  for (const key of Object.keys(prev)) {
    if (!seen.has(key)) {
      const was = prev[key];
      next[key] = { ...was, last_seen: now, status: 'gone' };
      if (was.status !== 'gone') changes.gone.push(key);
    }
  }
  const registry = {
    updated: now,
    note: '本地技能注册表（yotta-skills --inventory / --reindex 生成）。数据不出本机。',
    skills: next,
  };
  return { registry, changes };
}

/** 原子写注册表（tmp + rename，防写一半损坏）。 */
function saveRegistry(registry, filePath) {
  const p = filePath || registryPath();
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
  return p;
}

/** 把注册表渲染为自包含文本表格（不依赖元呈）。 */
function formatInventory(registry, filePath) {
  const skills = Object.values(registry.skills || {})
    .filter((s) => s.status !== 'gone')
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const lines = [];
  lines.push('已装技能盘点（yotta-skills --inventory）');
  lines.push('技能名/版本/功能/来源');
  for (const s of skills) {
    const ver = s.version ? 'v' + s.version : '-';
    const src = (s.sources || []).join(',');
    lines.push(`${s.slug}  ${ver}  ${s.description || ''}  [${src}]`);
  }
  const rp = filePath || registryPath();
  lines.push(`共 ${skills.length} 个技能；注册表：${rp}`);
  return lines.join('\n');
}

module.exports = {
  AGENT_DIRS,
  parseFrontmatter,
  scanSkillDir,
  defaultRoots,
  scanRoots,
  registryPath,
  readRegistry,
  mergeRegistry,
  saveRegistry,
  formatInventory,
  REGISTRY_DIR_NAME,
  REGISTRY_FILE_NAME,
};
