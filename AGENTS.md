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
  `archive-cleanup.ts`（归档后清理）、`file-guard.ts` + `backup-tool.ts`（改动前保护）、`session-tree.ts`（变更记录页的会话树：
  副本所属 cwd 与派生子会话）、`compare.ts` + `comparison-types.ts`（副本与当前文件的行级对比，两侧共享行类型）、
  `policy.ts` / `branch-rule.ts` / `validate.ts`（两侧共享）。
- `src/client/` 浏览器半边：`WorktreeChip.*`（hero 行胶囊）、`seat-store.ts`、`draft-transfer.ts`、
  `checkout-notice-*`（归档结果 toast）、`BackupPanel.*`（右侧边栏「变更记录」页：平铺列表 + 子会话归属标签 + 逐个还原）、
  `BackupDetail.*` + `diff-columns.ts`（同一标签页内的左右两栏对比）、
  `SettingsSection.*`（设置 → 文件备份：Git 账号、Worktree 设置与自动备份三张卡，Git 账号在最上面）、`settings-*.ts`、
  `git-accounts/`（Git 账号主面板：账号 / Git 身份 / 扫描 / 项目；另有设置页的 `SettingsGitAccountsCard`）+ `git-accounts-api.ts`（`/worktree/git/api` 客户端）。
- `src/git-accounts/` host 侧 Git 账号能力：`accounts.ts`（服务、凭据 grant 记录、扫描采纳）、
  `route.ts`（`/worktree/git/api`）、`providers.ts` + `http.ts`（GitHub/GitLab/Gitee 的 API 方言与错误分类）、
  `ssh.ts`（SSH 密钥探测与 banner 解析、`~/.ssh` 私钥发现、config 候选）、
  `scan.ts` + `scan-parsers.ts`（环境变量 / `.git-credentials` / gh CLI / Windows 凭据管理器 / SSH 配对与提示）、
  `identity.ts`（全局 `user.name` / `user.email`）、`types.ts`（两侧共享的线类型与页面注入面）。
- `lib/` 构建产物（`index.mjs` host + `client.js` 浏览器 handoff）**已提交进仓库**，别人可以直接从 git 安装；
  改完源码**记得 `npm run build` 并把 `lib/` 一起提交**。
- `tests/` 32 个 spec、`cordis.patch.yml` 组合插件行、`README*.md` / `docs/` 文档。
- 逐组件职责与接线细节见 [.claude/rules/architecture.md](.claude/rules/architecture.md)。

## 构建与测试

```sh
npm install --force
npm run build     # tsdown（host → lib/index.mjs）+ node build-client.mjs（lib/client.js）

# 从 Harness checkout 根运行
node_modules/.bin/vitest run --root dsh-worktree
node_modules/.bin/vitest run --root dsh-worktree --config vitest.harness.config.ts   # 浏览器半边 spec

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
  没有大小上限；每个会话一份、会话归档即删除。**结果必须回带副本的绝对路径**（`worktree_backup` 的文本与结构化输出、
  自动路径的日志）——否则拿到"已保护"的一方无从恢复。**不碰 `fs/*`**，删除类命令一律 `deny` 并点名 `worktree_backup`。
- **变更记录覆盖当前会话及其派生子会话**（`session-tree.ts`）：根会话的 cwd 用 live 会话存储解析，取不到再读
  `sessionPersistence.stat` 的 header（已停止的 teammate、重开后的历史会话）；子会话树用 `subagents.listDescendants`
  读持久化 catalog，**fork 不在内**（不在 catalog、且是另一段对话）。子会话的副本按它自己的 sessionId / cwd 还原与对比，
  每行带 `sessionId` / `depth` / `sessionLabel`。两个存储都不认根会话时：该会话无副本回空列表，有副本才 404。
  **绝不接受请求体里的目录**——目录只由 Host 从这两个存储现算。
- **对比（`compare`）只读副本与当前文件，不依赖 Git**：语义是「本会话首次改动前 → 现在」，不是"本会话改了什么"；
  目标只由 Host 用会话 `cwd` 现算（live → 持久化 header），绝不受理请求体里的路径。行级引擎是宿主侧 `src/compare.ts`（`diff` 依赖），
  客户端只负责两列渲染；超 2 MiB / 二进制 / 非普通文件只回字节数，还原照常可用。
- **归档清理两条触发腿（无轮询）**：`domain/changed`（storage-domain 在**落盘后**广播 workspace 域的全局 put）覆盖所有归档；事件发出时 registry 内存尚未更新，须延迟至下一事件循环再读 `workspaceRegistry.archivedSessionIds`，不读 payload。`workspace/session-stop` 只在「停止并归档」发出，是并行取消请求，**不保证回合已停下**；FileGuard 关闭该会话的保护，防止晚到备份重建。备份删除逐会话捕获失败，后续归档事件重试，不阻断其他会话或 checkout 清理。`removeOnSessionArchive` 只控制 checkout，两条触发均须遵守。**不追溯、无启动补扫**：启动集合直接记为 `handled`，仅清理运行期新归档；取消归档清除待重试并恢复保护。三条不变量：不拦截归档（失败降级为日志）、不丢工作（脏目录保留）、并发串行。
- **记忆不隔离是刻意的**：worktree 是独立工作区、文件与授权各自独立，但 `{project}` 回溯到主仓库，记忆与上下文共享。
- **Git 账号机密只进不出**：令牌存进 Harness 凭据缝的 grant 记录（scope `worktree`），SSH 账号只存私钥路径、从不读私钥内容；路由/页面/日志/扫描报告都没有 token 或私钥内容。扫描、SSH 探测与 Git 身份测试必须隔离真实凭据、真实 `~/.ssh` 与全局 `~/.gitconfig`（见 [.claude/rules/git-accounts.md](.claude/rules/git-accounts.md)）。
- `ctx.get('x')` 取服务，**不要** `ctx.x`；CSS module 里 JSX 引用的类必须都有定义，否则静默无样式。
- **跨文件契约必须一起改**：`policy.ts` 的取值集合 ↔ 设置页/浏览器半边；`policy.ts` 的 `DEFAULT_FILE_GUARD` /
  `DEFAULT_DENY_DESTRUCTIVE_COMMANDS` / `DEFAULT_NEW_SESSION_WORKTREE` / `DEFAULT_BACKUP_SIDEBAR` ↔ `settings-fields.ts` 的
  `SWITCH_DEFAULTS`（**逐字段**，不是一个共享布尔——四个开关的默认不同）；`defineTool` 必须留在 `backup-tool.ts`。
- **`newSessionWorktree` 与 `backupSidebar` 是仅有的两个由浏览器半边消费的策略**：Host 只存取与下发。前者由
  `seat-store.ts` 的 `autoStart` 决定花不花这次 seat（每会话一次，失败不再重试）；后者决定 `src/client/index.ts` 是否向
  右侧边栏注册 `worktree-backup` 标签类型（含「开始」页入口），改它要同时动设置页、注册处与这条规则。
- **配置校验**：`agentsDirectory` 必须是工作区相对目录（无盘符、无 `..`），`nestedScanDepth` 必须是正整数——不合法直接抛错，插件加载即失败。
- **volatile 与启动时字段分开**：设置页那七项保存即生效（不重启）；`agentsDirectory` / `gitTimeoutMs` / `startSessionRoute` /
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
- [.claude/rules/file-guard.md](.claude/rules/file-guard.md)：改动前保护的发现机制、删除命令拦截、四条不变量、备份存储与失败语义，以及列出、还原与对比（`list` / `restore` / `compare`，路由 `backups` / `restore` / `compare`；列表覆盖会话树与冷会话解析）。
- [.claude/rules/config.md](.claude/rules/config.md)：全部配置字段与默认值、volatile 分界、设置页写入 profile 的规则。
- [.claude/rules/client-ui.md](.claude/rules/client-ui.md)：手机断点、hero 行 CSS 对齐、草稿迁移时序、设置页列宽与触摸尺寸、右侧边栏变更记录页的注册、平铺列表（含子会话归属标签）与左右两栏对比。
- [.claude/rules/failure-modes.md](.claude/rules/failure-modes.md)：失败模式总表与易崩清单 30 条。
- [.claude/rules/git-accounts.md](.claude/rules/git-accounts.md)：Git 账号能力（令牌/SSH 密钥登录、本机授权扫描、Git 身份、项目列表）的存储/路由/安全不变量/页面注册与测试隔离。
- [.claude/rules/build-test-release.md](.claude/rules/build-test-release.md)：安装变体、构建流水线、两条测试命令与用例覆盖、发版打 tag。
