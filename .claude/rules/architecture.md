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
| 改动前保护 | `src/file-guard.ts` + `src/backup-tool.ts` | AI 第一次改动某个已存在文件之前，把它的字节复制到 `~/.agents/file-guard/<会话哈希>/`。自动路径靠 `tools/pre-execute` 的 `file_path`，明确路径靠模型调 `worktree_backup`；删除命令被拒；会话归档时整个目录删掉。不碰 `fs/*`。同一份副本树也是备份页的数据源：`list` 列出与副本不一致的文件、`restore` 把一份副本写回、`compare` 把副本与当前文件做行级对比（不依赖 Git）。见 `.claude/rules/file-guard.md` 的「改动前保护」「列出与还原」「对比」三节 |
| 行级对比引擎 | `src/compare.ts` + `src/comparison-types.ts` | 纯函数 `compareTexts(before, after)`：用 `diff`（jsdiff）的 `diffLines` 算行级差异，展开成 `context` / `change` / `gap` 行，长文件折叠未改动行、超限截断、超时退化为整块替换。`comparison-types.ts` 不 import 任何东西，Host 与浏览器半边共用同一套行类型 |
| 会话树解析 | `src/session-tree.ts` | 变更记录页要回答两个问题：一份副本还原到哪个目录、页面覆盖哪些会话。前者按 **live 会话存储 → `sessionPersistence.stat` 的 header** 解析（已停止的 teammate、宿主重开后的历史会话没有 live Agent）；后者用 `subagents.listDescendants` 读**持久化 subagent catalog**（不唤醒 Agent），把派生子会话连同 label/depth 一起返回，**fork 不算**（不在 catalog 里）。缺服务或读失败都降级为只解析当前会话，不失败。见 `.claude/rules/file-guard.md` 的「列出与还原」 |
| Host 路由 | `src/route.ts` | `POST /worktree/api/{start,list,branches,init-files,init,check,checkout,backups,restore,compare}`：原子地"建 checkout → 注册工作区 → 开会话 → 把会话挂进该工作区"，并给界面提供本地分支列表、归档结果探测，以及文件备份的读取、还原与对比。备份类方法的工作目录只由 Host 现算（live 在内存、否则读持久化 header），不读请求体；`backups` 合并当前会话与派生子会话的副本并逐条标 `sessionId` / `depth` / `sessionLabel`。开会话本身在 `src/session.ts` |
| 浏览器控件 | `src/client/` | 新会话屏幕 `选择工作区 / 模式` 那一行右侧的一个胶囊：左边是本地分支下拉，右边是 `worktree` 勾选；`WorktreeChip.tsx` 渲染，`seat-store.ts` 管状态，`api.ts` 是路由客户端 |
| 变更记录页（侧边栏） | `src/client/BackupPanel.tsx` + `BackupPanel.module.css` | 右侧边栏的 `worktree-backup` 标签页主体：把**这个会话及其子会话**里被改动或删除的文件**平铺成一行一个**（不展示目录层次），每行显示路径与**还原**按钮，按钮自身带「还原中 / 已还原 / 失败」三种可见状态；子会话的副本在路径下多一行归属标签（`subsessionLabel`，无 label 时只写「子会话」），行的 `data-backup-session` 与还原/对比都发**副本所属会话**的 id。点路径把列表换成该文件的左右两栏对比（`BackupDetail.tsx` + `BackupDetail.module.css` + `diff-columns.ts`：左侧副本、右侧当前文件、逐行对齐、纵向联动滚动、打开定位第一处改动），详情头部同样标出子会话归属。数据经注册时注入的 `list` / `restore` / `compare` 走 Host 路由；`src/client/index.ts` 注册标签类型与「开始」页入口，开关关掉时整个类型注销 |
| 草稿迁移 | `src/client/draft-transfer.ts` | 切到新建 checkout 里的会话之前，把原输入框里未发送的草稿搬过去（文字、引用、附件一起），并保证任何一步失败都完整回滚、原草稿不丢 |
| 归档通知（浏览器） | `src/client/checkout-notice-store.ts` + `checkout-notice.tsx` | 跟随 Workspace 列表，有人归档后行消失就探测 Host 的结果，**成功/保留各弹一条独立 toast**（`shell.overlay` 座位）；纯逻辑与渲染分开，前者能在自足 suite 里跑（见 `.claude/rules/checkout-notice.md`） |
| 设置页 | `src/client/SettingsSection.tsx` | 设置 → **文件备份**，页内标题「文件备份」，三张卡片（`.card`，设置卡材料）。上卡「Git 账号」（`src/client/git-accounts/SettingsGitAccountsCard.tsx`）紧凑列出已连接账号（每个账号一张小卡片，未验证 SSH 账号带 warning Tag），提供**添加账号 / 扫描已有授权 / 移除**（复用 Git 账号页的 `AddAccountDialog`、`RemoveAccountDialog`，令牌或私钥路径仍只在添加对话框的局部 state 里；扫描结果只出 Toast，无结果卡），并在有账号时提供「在『Git 账号』页查看项目」——先调设置页的 `close()` 关闭弹窗，再 `ctx.layout.selectPanel('git-accounts')` 切主面板。中卡「Worktree 设置」三行：**创建子仓库**开关（默认关）、**扫描层级**（默认 1）、**worktree 存储位置**（工作区内 / 仓库同级 / 用户目录；说明文字跟着选项显示对应路径）。下卡「自动备份」三行：**会话文件保护**开关（默认**开**）、**拦截删除命令**开关（默认开，需前者开启才可用）、**显示变更记录侧边栏**开关（默认**开**，同样需前者开启才可用）。设置页的注入面因此是 `WorktreeSettingsFace + { gitAccounts, openAccountsPage }`。无「恢复默认」或「保存」按钮。行式左右布局（同「通用设置」）。有效修改自动保存并即时生效，不需要重启；`settings-store.ts` 串行执行 revision-fenced 写入，保存期间的新修改排队保留，空值或非正整数扫描层级不写入配置，失败保留草稿并提示。字段的取值转换在 `src/client/settings-fields.ts`（无运行时依赖，所以可被自足 suite 直接测） |
| 设置页字段词汇 | `src/client/settings-fields.ts` | 七个可编辑字段的集合、`formatSetting` / `parseSetting`、以及四个开关的 schema 默认值。**故意不 import `settings-store.ts`**：store 会拉进 `@deepseek-ai/dsh-client-store`（运行时依赖 `zustand`），自足 suite 解析不到。同 `policy.ts` 的理由 |
| Git 账号能力（Host） | `src/git-accounts/` | 令牌或 SSH 密钥登录与验证、本机授权扫描、全局 Git 身份、按账号列项目。`accounts.ts` 是服务（凭据缝 grant 记录、扫描采纳、去重/刷新、错误码、`ssh_no_api`、`verified` 未验证保存）；`route.ts` 挂 `/worktree/git/api`（只依赖 `webServer`，方法 `snapshot` / `accounts.add` / `accounts.verify` / `accounts.remove` / `accounts.scan` / `ssh.keys` / `projects.list` / `identity.set`）；`providers.ts` + `http.ts` 是三家 REST 方言与错误分类（5 秒请求预算）；`ssh.ts` 是一次性 `ssh -T` 探测（5 秒预算、GitHub/GitLab 22→443 备用端点）、banner 解析、私钥发现与 `~/.ssh/config` 候选；`scan.ts` + `scan-parsers.ts` 读环境变量/`.git-credentials`/gh/凭据管理器/SSH 配对并给提示；`identity.ts` 读写全局 `user.name`/`user.email`；`types.ts` 是两侧共享的线类型与页面注入面。令牌只在 Host 内存与凭据库里，路由/页面/日志都没有它；SSH 只存路径、不读私钥内容。见 `.claude/rules/git-accounts.md` |
| Git 账号页（浏览器） | `src/client/git-accounts/` + `src/client/git-accounts-api.ts` | 左侧栏「Git 账号」主面板：账号列表（每个账号一张独立卡片，带 SSH/未验证标签）与添加弹窗（认证方式可选访问令牌/SSH 密钥，footer 有独立的**验证连接**按钮）、扫描按钮（完成只弹点名新增账号的 Toast，不再渲染报告卡片）、Git 身份卡、按账号的项目列表（搜索/翻页/复制 HTTPS 地址/浏览器打开；SSH 账号明确不请求、只说明不能列项目）。注册在 `src/client/index.ts`：`main`（key `git-accounts`）+ `sidebar.panellist`（同 id，order 20）；数据全靠注入的 `snapshot` / `addAccount` / `verifyAccount` / `removeAccount` / `scan` / `sshKeys` / `projects` / `saveIdentity`，组件内不 fetch、不碰令牌与私钥 |
| 两侧共享 | `src/policy.ts` / `src/branch-rule.ts` / `src/validate.ts` | 默认值与取值集合（`policy.ts` 不 import 任何东西，浏览器 bundle 才能直接用）、Host 与浏览器必须逐字一致的分支名规则、路径与目录校验 |

**界面上建 / 列 / 删 checkout 都是用户操作，模型没有对应的工具。** 界面负责全部三件；唯一的自动删除是归档回调（见 `.claude/rules/archive-cleanup.md` 的「归档清理」）。模型工具只有一个：`fileGuard` 默认开，因此默认形态就会注册 `worktree_backup`（见 `.claude/rules/file-guard.md` 的「改动前保护」），关掉它才没有工具；注册走 `ctx.inject(['tools'], …)`，所以没有工具注册表的部署照样挂载。曾经的 `src/tools.ts`（`worktree_create` / `worktree_list` / `worktree_remove`）与 `createToolName` / `listToolName` / `removeToolName` 三个配置字段已随此决定删除。

- `lib/` —— 构建产物：**已提交进仓库**（`index.mjs` host + `client.js` 浏览器 handoff），
  这样别人可以直接从 git 安装。改完源码**记得 `npm run build` 并把 `lib/` 一起提交**。
- `cordis.patch.yml` —— 把插件行插入组合的 bundle 层。
- `tests/` —— `service` / `porcelain` / `route` / `plugin` / `session` / `session-tree` / `nested` / `archive-cleanup` / `checkout-notice` / `client` / `file-guard` / `file-guard-compare` / `compare` / `diff-columns` / `settings-fields` / `git` / `worktree-layout` / `git-accounts-providers` / `git-accounts-scan` / `git-accounts-identity` / `git-accounts-ssh` / `git-accounts-route` 属于自足子集，
  `seat` / `registration` / `navigation` / `settings` / `settings-autosave` / `settings-toast` / `backup-panel` / `git-accounts-page` / `git-accounts-settings` 是浏览器半边 spec，按 `vitest.harness.config.ts` 跑。两个 runner 见 `.claude/rules/build-test-release.md` 的「测试」。

## 组合接线（cordis.patch.yml）

`cordis.patch.yml` 把插件行插入组合的 bundle 层：

```yaml
- insert:
    - id: worktree
      name: '@guowenzhang/dsh-worktree'
```

`package.json` 的 `dsh` 字段声明它在 profile 里的接线：`dsh.bundle.patch` 指向上面这份 patch，`dsh.client.inject` 列全浏览器半边挂载时要用到的宿主 client 包，`platform` 为 `web`；`exports` 另导出 `./client`（`lib/client.js`）与 `./cordis.patch.yml`。

行 id 是 `worktree`：它同时是 host 插件导出的 `name` 与设置命名空间 `SETTINGS_NAMESPACE`，也是 `/worktree/api` 前缀的由来。

host 插件导出 `{ name, Config, apply }`，**没有 `inject`**：模型工具只有守卫那一个，而且注册也走 `ctx.inject(['tools'], …)`，所以对工具注册表没有硬依赖。`webServer` / `workspaceRegistry` / `agents` 由 `registerRoute` 里的 `ctx.inject` 等，`workspaceRegistry` 由 `installArchiveCleanup` 里的 `ctx.inject` 等，settings 也用 `ctx.inject(['settings'], …)` 软探测——缺 `webServer` / `workspaceRegistry` / `agents` 之一就不挂路由（handler 三个都要用），缺 settings 就只是不能在线改策略，缺 `tools` 就只是不注册 `worktree_backup`（守卫自己的 `tools/pre-execute` 监听照常）。服务照常提供，插件不会整体不激活。**Git 账号路由是另一条**：`registerGitAccountsRoute` 只等 `webServer`，凭据服务由服务构造时传入的 `() => ctx.get('credentials')` 现取——缺凭据服务时路由照删并回 503 `credentials_unavailable`，不影响工作区路由与工具。

浏览器半边注册三处座位：`conversation.input.dock`（id `worktree`，order -10，排在最前）、`settings.section`（id `worktree`，order 30）与 `shell.overlay`（id `worktree-checkout`，order 100，归档结果的第二条通知），并注册 `worktree` 字典。另有一处**跨插件的贡献**：`ctx.inject(['slots','sidebarRightTabs'], …)` 里向右侧边栏的标签注册表登记 `worktree-backup` 类型、并把页面主体注册进 `sidebar.right.pane.tab`——前者由设置页的 `backupSidebar` 开关决定注册与否（关掉即没有类型、没有「开始」页入口），后者常驻，好让某个会话日志里残留的标签仍能被派发到页面而不是落进宿主的"不可查看"占位。缺 `sidebarRightTabs`（没有右侧边栏的部署）时只少这一个页面，其余座位照常。**Git 账号页**是第四处：`main` 座位（keyed，key = `git-accounts`）承载页面，`sidebar.panellist`（id 必须同为 `git-accounts`，order 20）提供左侧栏入口，两处都用 `src/client/git-accounts-api.ts` 构造的同一份注入面；页面始终注册，凭据服务缺失时由页面自己说明。

## 部署与生效语义

**host 半边是进程内模块：重建 `lib/index.mjs` 不会替换正在运行的那份代码。** 只有 `dsh plugin add/remove` 造成的重组才会把它 import 进进程，之后改源码必须**重启宿主**才生效。

client 半边相反：bundle 按内容 revision 提供，重建后刷新页面即可加载新产物；`HANDOFF_ID` 必须始终等于包名，不得用于缓存失效。必要时强刷浏览器。

一个例外是「配置」里标为 volatile 的字段：它们由 Host 在文档更新后装回运行中的服务实例，**不需要重启**。设置页呈现其中七项（见 `.claude/rules/config.md` 的「配置」）。
