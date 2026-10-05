'use strict';

/**
 * 测试隔离（preload）：移除指向真实宿主技能目录的环境变量。
 *
 * 用例以临时 HOME 启动 CLI 子进程；若真实宿主根（DSH / Codex / XDG /
 * OpenClaw / Claude 等）经环境变量泄漏进子进程，发现 / 链接 / 迁移类用例
 * 会写穿到真实技能目录并在测试清理后留下坏链。此处在测试进程启动时统一
 * 清除；用例如需覆盖这些变量，在自己的 env 对象里显式传入即可。
 */
const HOST_ROOT_ENV_KEYS = [
  'DSH_HOME',
  'DSH_AGENTS_HOME',
  'OPENCLAW_STATE_DIR',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'XDG_CONFIG_HOME',
  'XDG_STATE_HOME',
  'XDG_DATA_HOME',
  'YOTTA_SKILLS_HOME',
  'YOTTA_SKILLS_HUB',
  'YOTTA_SKILLS_DISCOVERY_ROOTS',
];

for (const key of HOST_ROOT_ENV_KEYS) {
  delete process.env[key];
}
