# AGENTS.md

本仓 `dsh-worktree` 是**独立于 harness monorepo** 的 DeepSeek Harness (DSH) 插件：
在独立的 Git worktree 里开一个 DSH 会话——创建 checkout、把它注册成一个独立工作区、并让会话以它为工作目录启动。
它不打包 `@deepseek-ai/*`，运行时从宿主 harness 解析这些包。

姊妹插件：[`dsh-memory`](../dsh-memory)（Claude 记忆目录与 memory 工具）、
[`dsh-claude-compat`](../dsh-claude-compat)（CLAUDE.md 指令文件、技能、作用域规则）。三者互不 import、互不依赖，可单独安装。

## 目录

仓库根**就是**包：`package.json` 即 `@guowenzhang/dsh-worktree`。
这不是风格选择——`dsh plugin add <git-url>` 取的是仓库根，包放在 `packages/*` 下会被装成错误的东西。

- `src/` host 半边：`service.ts`（worktree 增删查 + 布局推导）、`route.ts`（`/worktree/api/*`）、`session.ts`、
  `archive-cleanup.ts`（归档后清理）、`file-guard.ts` + `backup-tool.ts`（改动前保护）、`policy.ts` / `branch-rule.ts` / `validate.ts`（两侧共享）。
- `src/client/` 浏览器半边：`WorktreeChip.*`（hero 行胶囊）、`seat-store.ts`、`draft-transfer.ts`、
  `checkout-notice-*`（归档结果 toast）、`SettingsSection.*`（设置 → Worktree）、`settings-*.ts`。
- `lib/` 构建产物（`index.mjs` host + `client.js` 浏览器 handoff）**已提交进仓库**，别人可以直接从 git 安装；
  改完源码**记得 `npm run build` 并把 `lib/` 一起提交**。
- `tests/` 15 个 spec、`cordis.patch.yml` 组合插件行、`README*.md` / `docs/` 文档。
- 逐组件职责与接线细节见 [.claude/rules/architecture.md](.claude/rules/architecture.md)。

## 构建与测试

```sh
npm install --force
npm run build     # tsdown（host → lib/index.mjs）+ node build-client.mjs（lib/client.js）

# 从 Harness checkout 根运行
node_modules/.bin/vitest run --root dsh-worktree
node_modules/.bin/vitest run --root dsh-worktree --config vitest.harness.config.ts   # 浏览器半边四个 spec

npm run typecheck
```

## 硬约束

- **host 半边是进程内模块**：重建 `lib/index.mjs` 不替换运行中的代码，改源码必须**重启宿主**；client 半边刷新页面即生效，
  且 `HANDOFF_ID` 必须始终等于包名（它是宿主启动图找 factory 的键）。
- **三个动作必须原子**：`checkout → 工作区记录 → 会话`；工作区/会话失败要删掉 checkout，清理也失败则错误里点名目录，绝不静默留下垃圾。
  会话起来之后再挂账本失败是例外：只报 `[attach]`，checkout 与会话都保留。
- **删除的安全语义**：脏目录一律拒绝（archive 清理也不传 force）；删除先子后父、未提交改动在动手之前就拒绝；
  主 worktree 与未列出的路径永远不是删除目标。
- **改动前保护**（fileGuard，默认开）：同一会话第一次的副本是权威的、第二次改动不覆盖；只保护已存在的文件；
  没有大小上限；每个会话一份、会话归档即删除。**不碰 `fs/*`**，删除类命令一律 `deny` 并点名 `worktree_backup`。
- **归档清理三条不变量**：不拦截归档（失败降级为日志）、不丢工作（脏目录保留）、并发串行。
- **记忆不隔离是刻意的**：worktree 是独立工作区、文件与授权各自独立，但 `{project}` 回溯到主仓库，记忆与上下文共享。
- `ctx.get('x')` 取服务，**不要** `ctx.x`；CSS module 里 JSX 引用的类必须都有定义，否则静默无样式。
- **跨文件契约必须一起改**：`policy.ts` 的取值集合 ↔ 设置页/浏览器半边；`policy.ts` 的 `DEFAULT_FILE_GUARD` /
  `DEFAULT_DENY_DESTRUCTIVE_COMMANDS` ↔ `settings-fields.ts` 的 `SWITCH_DEFAULT`；`defineTool` 必须留在 `backup-tool.ts`。
- **配置校验**：`agentsDirectory` 必须是工作区相对目录（无盘符、无 `..`），`nestedScanDepth` 必须是正整数——不合法直接抛错，插件加载即失败。
- **volatile 与启动时字段分开**：设置页那五项保存即生效（不重启）；`agentsDirectory` / `gitTimeoutMs` / `startSessionRoute` /
  `removeOnSessionArchive` 只在启动时生效。
- **未明确要求不发版**：不自行递增 `version`、不打 tag。

## 规则加载机制（`.claude/rules/`）

明细都在 `.claude/rules/*.md`，由 `dsh-claude-compat` 按 Claude Code 的作用域规则加载：

- 每个文件带**非空 `paths:`** frontmatter（项目根相对、正斜杠 glob）。**带 `paths:` 的**在你 `read` 到匹配 glob 的文件后、
  于**下一次请求**注入，每会话至多一次；这正是「按需」的含义。**不带 `paths:` 的**会像 `CLAUDE.md` 一样每次会话首次请求就注入，
  所以明细一律带 `paths:`。
- 规则**成组加载**：一次 `read` 命中的**所有**规则一起折进下一次请求，所以各文件挂的是**互不重叠的窄 glob**
  （如 `src/file-guard.ts`、`src/client/**`、`tests/**`），避免多个大主题叠在一次读取上。
- 需要时也可以**主动读取**对应的 `.claude/rules/*.md`，不必等命中 glob。
- 新增/修改明细请放进 `.claude/rules/`（不进 npm 包，`package.json` 的 `files` 未列它），不要为了打包移进 `docs/`。

## 详细规则

- [.claude/rules/architecture.md](.claude/rules/architecture.md)：模块地图与逐组件职责、`cordis.patch.yml` / `dsh` 接线、host/client 生效语义。
- [.claude/rules/workspace-design.md](.claude/rules/workspace-design.md)：为什么必然是新工作区、三个动作的原子性、记忆不隔离的取舍。
- [.claude/rules/nested-repositories.md](.claude/rules/nested-repositories.md)：子模块与独立嵌套仓库的创建/删除、扫描层级、三种存储布局。
- [.claude/rules/archive-cleanup.md](.claude/rules/archive-cleanup.md)：归档删除的触发时机、6 步判定链、三条不变量。
- [.claude/rules/checkout-notice.md](.claude/rules/checkout-notice.md)：归档结果记录（removed / kept / unknown）与浏览器第二条通知。
- [.claude/rules/file-guard.md](.claude/rules/file-guard.md)：改动前保护的发现机制、删除命令拦截、四条不变量、备份存储与失败语义。
- [.claude/rules/config.md](.claude/rules/config.md)：全部配置字段与默认值、volatile 分界、设置页写入 profile 的规则。
- [.claude/rules/client-ui.md](.claude/rules/client-ui.md)：手机断点、hero 行 CSS 对齐、草稿迁移时序、设置页列宽与触摸尺寸。
- [.claude/rules/failure-modes.md](.claude/rules/failure-modes.md)：失败模式总表与易崩清单 11 条。
- [.claude/rules/build-test-release.md](.claude/rules/build-test-release.md)：安装变体、构建流水线、两条测试命令与用例覆盖、发版打 tag。
