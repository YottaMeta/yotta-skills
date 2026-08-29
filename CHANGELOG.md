# 更新日志

## v0.1.2 (2026-08-29)

安装方法清晰化：install.sh 用途与 README 中英「安装」章节对齐。

- 修正 install.sh 头部注释：明确其只把「元阁安装器技能」本身装进智能体/目录（自带 SKILL.md，
  让代理能调用元阁），并提示装齐 22 个 yotta-* 技能需再跑 `node bin/yotta-skills.js install`；
  避免用户误以为 `bash install.sh` 一次就装齐全家。
- 版本同步升至 0.1.2。

## v0.1.1 (2026-08-29)

文档修正：明确「元阁是全家安装器、与单个技能安装不同」。

- 更正 README 中英版「安装」章节：先分清「拿到安装器」与「装齐全家」两层（元阁本身不内置 22 个技能本体）；方式二 git clone / 方式三 Download ZIP 示例由 `--list` 改为 `install --dir <目标目录>`；方式四 install.sh 说明「只把安装器技能本身装进智能体目录」，装齐 22 个技能仍需再跑一次 `install`。
- 澄清：`--list` 只查看清单、不安装；克隆 / 解压只拿到安装器，不含任何技能本体。
- SKILL.md 增补「与单个技能安装不同」说明；版本同步升至 0.1.1。


## v0.1.0 (2026-08-29)

初始发布：

- 定位：元阁 —— 全家技能一键安装 CLI（「分发与安装」家族，市场主线 M2「全渠道分发」第一步，
  降低「n 个技能逐个装」门槛）。
- CLI（bin/yotta-skills.js，零依赖 Node.js 18+）：
  - `--list` 列出全家技能 + 版本 + 说明（可按技能名过滤）；
  - `install --agent <name>` / `install --dir <path>` 装全家或指定技能；
  - `update` 增量更新（补齐缺失 / 升级版本不一致）；
  - `--dry-run` 预览不联网不改动；`--pin` 锁死清单精确版本；
  - `--force` / `--skip-scan` / `--npm` / `--python` / `--verify` 等选项。
- 清单：skills.json 收录 22 个已发布技能（登记表为权威源，2026-08-29 校准；
  元安全 / 元测 / 元造 / 元守 / 元察 / 元情 / 元钥 / 元链 / 元鉴 等补入）。
- 机制：逐技能 `npm pack` → 系统 tar 解压 → 元信装前摘要（若可用，仅提示不拦截）→
  落位 `<dest>/<slug>` → 汇总报告（✔ 成功 / - 跳过 / ✘ 失败，有失败项退出码 1）。
- 幂等：目标 `<slug>/SKILL.md` frontmatter version 与清单一致即跳过；`update` 只补缺失 /
  版本不一致。
- 版本策略：默认 range（`major.x` 取同 major 最新 patch）；`--pin` 锁死可复现。
- 支持智能体：内置 17 个键名（claude / cursor / codex / gemini / goose / amp / opencode /
  windsurf / workbuddy / kiro / trae / trae-cn / qwen / comate / codebuddy / kimi / agents）；
  未收录用 `--dir` 指目录。
- Windows npm 解析：定位 npm.cmd 同目录 npm-cli.js 用 node 直跑（规避 EINVAL / cmd 引号坑）。
- 测试：12 用例全绿（--list / 临时目录安装断言 / 幂等 / --pin / update / 异常路径 /
  元信 scan 集成）+ 全家族联网实测 22/22 安装成功、版本全对齐、幂等复跑 22 跳过。
- 文档：SKILL.md（中立版）+ references 三件（skill-list 全家清单 / install-flow 内部机制 /
  tutorial 中文教程）+ README 中英双版。
- 发布件：LICENSE（MIT）/ NOTICE / banner（1280×640）/ install.sh。
