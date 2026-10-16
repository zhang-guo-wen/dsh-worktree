---
paths:
  - "src/index.ts"
  - "cordis.patch.yml"
  - "lib/**"
  - "package.json"
# src/client/index.ts 有意不列：它已由 client-ui.md 的 "src/client/**" 承接，
# 去掉可避免一次 read 同时叠加 architecture + client-ui + failure-modes 三份规则。
---

> 覆盖什么、何时读：本包的模块地图（谁负责什么）、`cordis.patch.yml` 与 `package.json` 的组合接线、host/client 生效语义。改代码、判断某逻辑该放哪、或确认「改完怎么生效」时读。

## 目录

仓库根**就是**包：`package.json` 即 `@guowenzhang/dsh-worktree`。
这不是风格选择——`dsh plugin add <git-url>` 取的是仓库根，包放在 `packages/*` 下会被装成错误的东西。

| 组件 | 位置 | 作用 |
|---|---|---|
| `worktree` 服务 | `src/service.ts` | 仓库根解析、创建/列举/删除 linked worktree、按布局推导默认路径、linked checkout 探测（`inspectLinkedCheckout`）；git 调用与超时在 `src/git.ts`，主仓库回溯在 `src/repository.ts`，`worktree list --porcelain` 解析在 `src/porcelain.ts` |
| 归档清理 | `src/archive-cleanup.ts` | 订阅 `workspace/session-stop`（归档落盘后的通知），删掉被归档会话的 linked checkout 与其工作区记录；同时把结果记进 outcome 表供浏览器半边读取（见 `.claude/rules/archive-cleanup.md` 的「归档清理」） |
| 改动前保护 | `src/file-guard.ts` + `src/backup-tool.ts` | AI 第一次改动某个已存在文件之前，把它的字节复制到 `~/.agents/file-guard/<会话哈希>/`。自动路径靠 `tools/pre-execute` 的 `file_path`，明确路径靠模型调 `worktree_backup`；删除命令被拒；会话归档时整个目录删掉。不碰 `fs/*`。见 `.claude/rules/file-guard.md` 的「改动前保护」一节 |
| Host 路由 | `src/route.ts` | `POST /worktree/api/{start,list,branches,checkout}`：原子地"建 checkout → 注册工作区 → 开会话 → 把会话挂进该工作区"，并给界面提供本地分支列表与归档结果探测；开会话本身在 `src/session.ts` |
| 浏览器控件 | `src/client/` | 新会话屏幕 `选择工作区 / 模式` 那一行右侧的一个胶囊：左边是本地分支下拉，右边是 `worktree` 勾选；`WorktreeChip.tsx` 渲染，`seat-store.ts` 管状态，`api.ts` 是路由客户端 |
| 草稿迁移 | `src/client/draft-transfer.ts` | 切到新建 checkout 里的会话之前，把原输入框里未发送的草稿搬过去（文字、引用、附件一起），并保证任何一步失败都完整回滚、原草稿不丢 |
| 归档通知（浏览器） | `src/client/checkout-notice-store.ts` + `checkout-notice.tsx` | 跟随 Workspace 列表，有人归档后行消失就探测 Host 的结果，**成功/保留各弹一条独立 toast**（`shell.overlay` 座位）；纯逻辑与渲染分开，前者能在自足 suite 里跑（见 `.claude/rules/checkout-notice.md`） |
| 设置页 | `src/client/SettingsSection.tsx` | 设置 → **Worktree**，标题「worktree 配置」，五行：**创建子仓库**开关（默认关）、**扫描层级**（默认 1）、**会话文件保护**开关（默认**开**）、**拦截删除命令**开关（默认开，需前者开启才可用）、**worktree 存储位置**（工作区内 / 仓库同级 / 用户目录；说明文字跟着选项显示对应路径）。无「恢复默认」或「保存」按钮。行式左右布局（同「通用设置」）。有效修改自动保存并即时生效，不需要重启；`settings-store.ts` 串行执行 revision-fenced 写入，保存期间的新修改排队保留，空值或非正整数扫描层级不写入配置，失败保留草稿并提示。字段的取值转换在 `src/client/settings-fields.ts`（无运行时依赖，所以可被自足 suite 直接测） |
| 设置页字段词汇 | `src/client/settings-fields.ts` | 五个可编辑字段的集合、`formatSetting` / `parseSetting`、以及两个开关的 schema 默认值。**故意不 import `settings-store.ts`**：store 会拉进 `@deepseek-ai/dsh-client-store`（运行时依赖 `zustand`），自足 suite 解析不到。同 `policy.ts` 的理由 |
| 两侧共享 | `src/policy.ts` / `src/branch-rule.ts` / `src/validate.ts` | 默认值与取值集合（`policy.ts` 不 import 任何东西，浏览器 bundle 才能直接用）、Host 与浏览器必须逐字一致的分支名规则、路径与目录校验 |

**界面上建 / 列 / 删 checkout 都是用户操作，模型没有对应的工具。** 界面负责全部三件；唯一的自动删除是归档回调（见 `.claude/rules/archive-cleanup.md` 的「归档清理」）。模型工具只有一个：`fileGuard` 默认开，因此默认形态就会注册 `worktree_backup`（见 `.claude/rules/file-guard.md` 的「改动前保护」），关掉它才没有工具；注册走 `ctx.inject(['tools'], …)`，所以没有工具注册表的部署照样挂载。曾经的 `src/tools.ts`（`worktree_create` / `worktree_list` / `worktree_remove`）与 `createToolName` / `listToolName` / `removeToolName` 三个配置字段已随此决定删除。

- `lib/` —— 构建产物：**已提交进仓库**（`index.mjs` host + `client.js` 浏览器 handoff），
  这样别人可以直接从 git 安装。改完源码**记得 `npm run build` 并把 `lib/` 一起提交**。
- `cordis.patch.yml` —— 把插件行插入组合的 bundle 层。
- `tests/` —— 15 个 spec：`service` / `porcelain` / `route` / `plugin` / `session` / `nested` / `archive-cleanup` / `checkout-notice` / `client` / `file-guard` / `settings-fields` 属于自足子集，
  `seat` / `registration` / `navigation` / `settings` 四个浏览器半边 spec 需要 checkout。两个 runner 见 `.claude/rules/build-test-release.md` 的「测试」。

## 组合接线（cordis.patch.yml）

`cordis.patch.yml` 把插件行插入组合的 bundle 层：

```yaml
- insert:
    - id: worktree
      name: '@guowenzhang/dsh-worktree'
```

`package.json` 的 `dsh` 字段声明它在 profile 里的接线：`dsh.bundle.patch` 指向上面这份 patch，`dsh.client.inject` 列全浏览器半边挂载时要用到的宿主 client 包，`platform` 为 `web`；`exports` 另导出 `./client`（`lib/client.js`）与 `./cordis.patch.yml`。

行 id 是 `worktree`：它同时是 host 插件导出的 `name` 与设置命名空间 `SETTINGS_NAMESPACE`，也是 `/worktree/api` 前缀的由来。

host 插件导出 `{ name, Config, apply }`，**没有 `inject`**：模型工具只有守卫那一个，而且注册也走 `ctx.inject(['tools'], …)`，所以对工具注册表没有硬依赖。`webServer` / `workspaceRegistry` / `agents` 由 `registerRoute` 里的 `ctx.inject` 等，`workspaceRegistry` 由 `installArchiveCleanup` 里的 `ctx.inject` 等，settings 也用 `ctx.inject(['settings'], …)` 软探测——缺 `webServer` / `workspaceRegistry` / `agents` 之一就不挂路由（handler 三个都要用），缺 settings 就只是不能在线改策略，缺 `tools` 就只是不注册 `worktree_backup`（守卫自己的 `tools/pre-execute` 监听照常）。服务照常提供，插件不会整体不激活。

浏览器半边注册三处座位：`conversation.input.dock`（id `worktree`，order -10，排在最前）、`settings.section`（id `worktree`，order 30）与 `shell.overlay`（id `worktree-checkout`，order 100，归档结果的第二条通知），并注册 `worktree` 字典。

## 部署与生效语义

**host 半边是进程内模块：重建 `lib/index.mjs` 不会替换正在运行的那份代码。** 只有 `dsh plugin add/remove` 造成的重组才会把它 import 进进程，之后改源码必须**重启宿主**才生效。

client 半边相反：bundle 按内容 revision 提供，重建后刷新页面即可加载新产物；`HANDOFF_ID` 必须始终等于包名，不得用于缓存失效。必要时强刷浏览器。

一个例外是「配置」里标为 volatile 的字段：它们由 Host 在文档更新后装回运行中的服务实例，**不需要重启**。设置页呈现其中五项（见 `.claude/rules/config.md` 的「配置」）。
