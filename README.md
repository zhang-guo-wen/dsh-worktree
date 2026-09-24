# @guowenzhang/dsh-worktree

在独立的 Git worktree 里开一个 DSH 会话：创建 checkout、把它注册成一个独立工作区、并让会话以它为工作目录启动。

## 它解决什么

DSH 的会话工作目录是**创建时冻结**的不可变头字段（`SessionHeader.cwd`），bash 工作目录、文件读写围栏、`workspace-write` 沙箱授权根、终端启动位置、文件名搜索根全部由它推导。所以"进入另一个目录"不是切换状态，而是**开一个新会话**。

本插件把这件事变成一次操作：勾选 → 创建 worktree → 新会话就跑在里面。隔离强度来自 DSH 既有机制，不需要改动 harness 任何一行。

## 组件

| 组件 | 位置 | 作用 |
|---|---|---|
| `worktree` 服务 | `src/service.ts` | 仓库根解析、创建/列举/删除 linked worktree、按布局推导默认路径 |
| 模型工具 | `src/tools.ts` | `worktree_create` / `worktree_list` / `worktree_remove` |
| Host 路由 | `src/route.ts` | `POST /worktree/api/{start,list,branches}`：原子地"建 checkout → 注册工作区 → 开会话 → 把会话挂进该工作区"，并给界面提供本地分支列表 |
| 浏览器控件 | `src/client/` | 新会话屏幕 `选择工作区 / 模式` 那一行右侧的一个胶囊：左边是本地分支下拉，右边是 `worktree` 勾选 |
| 设置页 | `src/client/SettingsSection.tsx` | 设置 → **Worktree**，标题「worktree 配置」，三行：**创建子仓库**开关（默认关）、**扫描层级**（默认 1）、**worktree 存储位置**（工作区内 / 仓库同级 / 用户目录；说明文字跟着选项显示对应路径）。右下角 `[恢复默认] [保存]`。行式左右布局（同「通用设置」）。保存即生效，不需要重启 |

创建与删除都覆盖**父子结构的多 git 仓库**：打开设置页的「创建子仓库」开关后，子模块会被初始化，独立嵌套仓库会在新 checkout 的对应位置各拿一个 linked worktree 和自己的新分支（开关默认关闭，见「父子仓库一起拉过去」）。

**设置页**（设置 → Worktree）改的就是下面「配置」里的那几个策略字段。它与 profile 的关系是：

- 保存写进 **profile 的 `cordis.patch.yml`**（UI 和你手改 YAML 改的是同一处），所以优先级、备份、版本管理都和你手工编辑完全一样；
- 这几个字段在插件里声明为 **volatile**，Host 会在文档更新后立刻把新策略装回正在运行的服务实例上——**不需要重启**；改名、路由开关这类"影响注册"的字段不在这里，它们只在启动时生效；
- 保存被拒绝时会明确说原因。最常见的一条是 **"is overridden by a home patch or command-line overlay"**：如果这个插件是被 `--patch`/home patch 覆盖层加载的，那层在 profile 之上，写 profile 会被它盖住，所以 Host 直接拒绝（这是 harness 的通用规则，不是本插件特有）。用 profile 的 bundle 正常安装就不会遇到。

## 用起来

### 1. 挂载

```sh
dsh plugin --profile web add C:/path/to/dsh-worktree
```

或手工在 profile 的 `cordis.patch.yml` 里：

```yaml
- insert:
    - id: worktree
      name: '@guowenzhang/dsh-worktree'
```

host 半边是进程内模块，**改完要重启宿主**；浏览器半边刷新页面即可。

### 2. 从界面用

在 Git 仓库里开**新会话**时，`选择工作区 / 模式` 那一行的右端出现一个胶囊：`⑂ <分支> ▾ │ ☐ <新建工作区图标> worktree`。左边是**本地分支下拉**（新分支从哪个本地分支开始，默认是当前会话所在 checkout 的分支，取不到就是 `HEAD`；列表在打开菜单时才去读，按最近提交排序，只列 `refs/heads`——远端分支或 tag 会让 `git worktree add` 悄悄进 detached HEAD，所以不给选），右边勾上即创建独立 worktree 并立即在里面开启会话：

1. 在**主仓库**上执行 `git worktree add -b <branch> <path> <base>`（会话即使已经在某个 linked worktree 里，也会回溯到主仓库）。分支名由 Host 自动生成：**所选 base 分支名（`/` 换成 `-`）+ 6 位随机数字**，例如 `dev-482913`；base 不是本地分支（`HEAD`、某个 SHA、`origin/x`）时用 `worktree-<6 位随机数字>`。界面不需要输入分支名。默认路径是**当前工作区目录下的 `.agents/worktree/<分支名>`**，缺的每一级都会自动创建——这样它在工作区树里挂在当前工作区下面，而不是变成旁边一个平级目录；旧行为（仓库旁边 `<repo>-wt-<branch>`）用 `defaultPath: sibling` 保留；
2. 把新目录注册成一个工作区，标题形如 `repo · dev-482913`；
3. 用新目录作为 `meta.cwd` 启动会话；
4. 把该会话挂进工作区的账本（`workspace.attachSession`）。工作区归属只认这本账：不挂的话会话在 GUI 里是"未分组"，而 `选择工作区` 也没有名字可显示——所以这一步失败会单独报 `[attach]`，并且**不删 checkout**（会话已经在里面跑着了）。

浏览器侧再刷新一次会话目录表，然后切到该会话——新会话是 Host 在**客户端 Session Controller 之外**创建的，不先拉一次目录，导航会以 `unknown session` 拒绝这个 id，人就会停在原来的会话里。

**勾选是单向的**：勾上就执行创建，没有"取消勾选"的路径。失败分两种：**Host 拒绝**（分支名冲突、不是仓库等）什么都没建，控件回到未勾选并显示原因，再勾是重试；**建好了但没切过去**（导航失败）时控件记住那个新会话，再勾是把它打开，不会建第二个 checkout。**每个会话独立、且不可更改**：会话的工作目录是创建时冻结的头字段，所以这个控件只在会话还是空白（没跑过第一轮）时出现；跑过之后它就不显示了——想换目录只能新开会话。这是设计约束，不是缺陷。

**已在 worktree 里的会话：控件继续显示，但锁住。** 它显示当初选的 base 分支和已勾选的 `worktree`（chevron 收起、两段都禁用），悬停提示当前实际所在分支。这样切过去之后既不会"看错分支"，也不会再点一次在一个 checkout 里套出下一个。页面刷新会丢掉"这个 checkout 是我建的"这层记忆，那时锁住的控件显示该 checkout 自己的分支——分支名本身就是 `<base>-<6 位随机数字>`，来源照样看得出来。

| 状态 | 控件 | 原因 |
|---|---|---|
| 空白会话 + 目录在主 checkout 里 | 可操作 | 还能选 |
| 会话已在某个 linked worktree 里 | 显示但锁住（base + 已勾选） | 它已经隔离好了；再给一次会在一个 checkout 里套出下一个 |
| 会话已跑过至少一轮 | 隐藏 | `header.cwd` 已冻结，Host 会拒绝 |
| 目录不是 Git 仓库 | 隐藏 | 没有可隔离的仓库 |

### 3. 从命令行 / 模型用

```js
// 一个会话里
worktree_create({ branch: 'fix/123' })
worktree_list()
worktree_remove({ path: '/abs/path' })
```

## 设计约束（为什么这么做）

### 会变成一个新工作区——这是刻意的

Workspace 的身份判据是 **`fs.realpath` 之后的路径字符串相等**（`dsh-workspace` 的唯一 canon），会话归属又靠 `header.cwd` 的 realpath 相等。worktree 路径与主 checkout 是两个不同的 realpath，**所以它必然是一个新工作区**。

不把它硬塞进主工作区，是因为那需要把"相等"判据换成"前缀包含"，会让 `C:\repo` 和 `C:\repo-subdir` 互相污染。用带分支名的标题让并列条目可读，是这个代价的正确付法。

### 三个动作必须原子

顺序被工作区注册表强制：会话只在 `header.cwd` 的 realpath 等于工作区 path 时才归属，不一致会 fail loud。所以必须是 **checkout → 工作区记录 → 会话**，且：

- 工作区创建失败 → 删掉 checkout；
- 会话启动失败 → 删掉 checkout（工作区记录保留，可用侧边栏删除）；
- 清理也失败 → 错误里点名目录，绝不静默留下垃圾。

### 记忆不隔离，是有意的

`dsh-memory` / `dsh-claude-compat` 会把 linked worktree 的 `{project}` **回溯到主仓库**，所以同一仓库的所有 worktree 共享一份记忆。最终形态：

| 维度 | 行为 |
|---|---|
| 工作区分组 | worktree 独立 |
| 文件与沙箱授权 | 各自独立 |
| 记忆 / `{project}` | 共享主仓库 |

**隔离的是文件和授权，共享的是知识与上下文。**

### 父子仓库一起拉过去

**默认是关的**（设置页的「创建子仓库」开关，对应 `nestedRepositories: none`）：新建的 checkout 只有父仓库自己的内容。打开后才走下面两条路——因为拉子模块要联网、给独立子仓库建分支会写进父仓库不跟踪的那些仓库，两件事都不该让人事后才发现。

一个 checkout 里可能挂着两类子仓库，**Git 对它们的处理完全不同**，所以插件分两条路走：

| 子仓库类型 | `git worktree add` 单独做出来的结果 | 插件的做法 |
|---|---|---|
| **子模块**（父仓库记为 gitlink） | 目录存在但**完全是空的**（gitlink 只还原挂载点） | 在新 checkout 里跑 `git submodule update --init --recursive`，内容按父仓库记录的那个 commit 落位 |
| **独立嵌套仓库**（父仓库只 ignore 它） | **根本不存在**（父仓库不跟踪它），只有原 checkout 知道它在哪 | 在原路径的对应位置给它开一个 linked worktree，并按父仓库同样的规则**建一条新分支**（`<它当前分支>-<6 位随机数字>`） |

三个关键事实（都是实测出来的，不是推断）：

1. **不会污染原 checkout 的子模块**。linked worktree 里的子模块有**自己独立的 git dir**（`<主仓库>/.git/worktrees/<wt>/modules/<name>`），和主 checkout 的 `<主仓库>/.git/modules/<name>` 是两份。所以在工作区里改子模块，原来的 checkout 一点不动。
2. **子模块是 detached HEAD**：gitlink 的语义就是钉在某个 commit 上，不是分支。想要分支就把它当独立嵌套仓库（`nestedRepositories: all` 也只对"自己带 `.git` 目录"的仓库建分支，子模块不算）。
3. **删除必须子仓库先行**。新的 checkout 里那些子仓库的目录是**别的仓库的 worktree**：先删父目录，它们各自仓库里就会留下一条"路径已不存在"的记录。所以 `worktree_remove` 先按深度倒序删掉嵌套 checkout，再删父 checkout；**任何一步发现未提交的改动都会在动手之前拒绝**（删父之前也会先查父自己的改动，且不把即将被删掉的子仓库目录算作父的脏)。

扫描规则（开关打开时）：从**仓库根**开始按 `nestedScanDepth`（默认 **1 层**，即只看直接子目录）找带 `.git` **目录**的子目录——带 `.git` 文件的是子模块或别的仓库的 worktree，都不在这里处理；`.git` 与 `node_modules` 不进入；嵌套里的嵌套也会被找到（层数够的话），且**父先子后**创建（子的目录在父里面）。

存储位置（`defaultPath`，设置页三选一）：

| 值 | 界面 | 目录 |
|---|---|---|
| `agents`（默认） | 工作区内 | `<工作区>/.agents/worktree/<分支>`，出现在工作区树里 |
| `sibling` | 仓库同级 | `<仓库名>-wt-<分支>`，建在仓库旁边，不进工作区树 |
| `home` | 用户目录 | `~/.agents/worktree/<分支>`，整台机器共用一个位置 |

## 失败模式

| 情况 | 行为 |
|---|---|
| 目标分支已存在 | 创建失败，不留残留记录（自动 `worktree prune`） |
| 分支名非法 | 在启动 git **之前**拒绝；浏览器也先行拒绝，两侧共用同一条规则 |
| 目录有改动 | `worktree_remove` 拒绝；要删需显式 `force` |
| 删除主 checkout | 拒绝 |
| 删除未列出的路径 | 拒绝（请求路径先与仓库自己的列举比对，模型编造的路径到不了 git） |
| 非 Git 仓库 | 控件不渲染（探测失败即隐藏） |
| **子模块拉不下来**（网络、鉴权、或本地路径子模块被 Git 的 `protocol.file.allow` 拒绝） | 创建整体回滚：已建的嵌套 checkout 先删、父 checkout 再删，错误原样抛出 |
| **某个嵌套仓库建不了分支**（例如它还没有任何 commit，没有 HEAD 可拉） | 同上，整体回滚，错误点名那个目录 |
| **删除带已初始化子模块的 checkout** | Git 对这类 worktree 一律拒绝（哪怕干净），所以插件先自己查改动、干净时才用 `--force`；有改动照样拒绝 |
| 回滚时清理也失败 | 错误里同时给出原始原因和没删掉的目录，绝不静默留下垃圾 |
| `webServer` / `workspaceRegistry` / `agents` 缺失 | host 工具照常挂载，只是没有路由（handler 三个都要用，缺一个就不挂） |
| 会话挂不进工作区 | 报 `[attach]`，checkout 与会话都保留（删掉 checkout 会打断刚在里面启动的会话） |

## 已知限制

- **不自动清理**：会话结束后 worktree 不会自动删除。未提交的工作不该被自动丢弃，删除只能显式发起。
- **不检查 live 会话**：删除一个仍有会话在跑的 worktree 目前不做拦截。
- **分支名默认值**是 `<base>-<6 位随机数字>`（没有可记录的 base 时 `worktree-<6 位随机数字>`），不跟随首条消息；随机后缀只有 6 位数字，同一 base 撞名（约百万分之一）时 `git worktree add` 会直接报错，再点一次即可。**base 分支本身不落盘**，但它就在分支名里，所以工作区标题、checkout 目录、`git branch` 都看得见。
- **默认 checkout 在工作区内的 `.agents/worktree/` 下**，所以它出现在主 checkout 的 `git status` 里（未跟踪目录）。要清静就把 `.agents/worktree/` 加进 `.gitignore` / `.git/info/exclude`，或改用「仓库同级」/「用户目录」。
- **「用户目录」是整机共享的位置**：`~/.agents/worktree/<分支>` 不属于任何工作区，几个仓库的 checkout 会并排放在一起；那里也需要你自己按需加进 `.gitignore`（如果它落在某个仓库里）。
- **不能给分支起名**：分支在工作区标题里可见，但界面不提供输入。需要指定分支用 `worktree_create`。
- **子模块是 detached HEAD**：这是 gitlink 的语义，不是缺陷；要"带分支的子仓库"就用独立嵌套仓库。
- **嵌套仓库只认带 `.git` 目录的**：一个子目录如果自己是别的仓库的 linked worktree（`.git` 是文件），或者是个子模块，都不会被镜像成新分支。
- **本地路径的子模块需要 Git 的 `file` 传输许可**（`protocol.file.allow`）。插件**不覆盖** Git 的这个安全开关：仓库用自己的 `.gitmodules` 指向本地路径时，得由 git 配置（全局或仓库级）放行，否则创建会带着 Git 的原话失败并整体回滚。子模块用 https/ssh 时不受影响。
- **嵌套仓库的分支会留在它自己的仓库里**：和工作区自己的分支一样，删除 checkout 不会删分支（未提交的工作不该被自动丢弃）。
- **胶囊与 `选择工作区 / 模式` 同一行是靠 CSS 对齐的**：hero 那一行的两个槽（`conversation.hero.workspace`、`conversation.hero.agentPreset`）都是 single 槽，第三方插件没有可注册的座位。控件实际注册在 `conversation.input.dock`（order -10，排在最前），在 `data-phase='hero'` 时把这一行压成 0 高度、抵消 `.composerHero` 的 8px 行距，再用 `bottom: calc(100% + 4px)` 悬在输入卡片上方 4px 处、`right: 28px` 收在卡片右边缘内 12px——下边距取 4px，右边距取 12px 是因为卡片右上角是 22px 圆角，靠太近会像压在弧线上；12px 也正好是左侧 workspace 胶囊图标距卡片左边缘的距离。胶囊自身 24px 高、13px 字，和旁边 28px 的 ghost 胶囊同一种语言（无边框、无底色，靠 hover 填充和两段之间 12px 高的细分隔线成形），整体矮一档；`worktree` 一段是 `☐ <新建工作区图标> worktree`：图标跟在勾选框之后、紧贴文字，用的是 `IconProjectAddOutlineRegular`——侧边栏「添加工作区」那个图标，因为这个 check 的结果正是"这个 checkout 变成一个新工作区"；勾选框、图标、文字同在一个 label 里，点哪里都是勾选。两段的字都是 13px/500，和左侧 ghost 胶囊一致。两者顶边对齐。因此：非 hero 阶段它仍退回自己的一行（此时本来也不渲染），hero 行距若被上游改动，对齐会差一点；若别的插件往这个 dock 里注册了 order < -10 的条目，控件会贴到那条的上面。
- **"开关只在首条消息时才创建"做不到**：客户端 composer 的提交是 ui-conversation 内部的输入状态机，槽位里没有"提交前"钩子（`conversation.composer` 是 chain，选中者只能自己重写整个 composer；`conversation.composer.bar` 是 single，注册进去会把输入框顶掉），Host 侧也只有 `session/prompt` 这个 RPC；而 `SessionHeader.cwd` 又是创建时冻结的不可变字段。所以"先开关、首条消息再建"需要给 harness 加一个提交前扩展点，插件自身无法实现。当前行为是**点击即创建并切过去**。

## 配置

```yaml
- id: worktree
  name: '@guowenzhang/dsh-worktree'
  config:
    # 设置页的三行（volatile：保存即时生效，不用重启）
    nestedRepositories: none        # none（默认，只建父仓库）| submodules | all —— 设置页上就是「创建子仓库」开关：开 = all，关 = none
    nestedScanDepth: 1              # 递归扫描目录层数（正整数；1 = 只看直接子目录）
    defaultPath: agents             # agents（默认，工作区内的 .agents/worktree/）| sibling（仓库同级）| home（用户目录 ~/.agents/worktree）
    # 以下只在启动时生效，改完要重启 host
    agentsDirectory: .agents/worktree   # defaultPath: agents 时的工作区子目录；缺的层级会自动创建
    gitTimeoutMs: 60000             # 单次 git 调用的上限（子模块拉网络时会用满它）
    createToolName: worktree_create
    listToolName: worktree_list
    removeToolName: worktree_remove
    startSessionRoute: true
```

设置页只放**会改变 checkout 长什么样**的三项；`agentsDirectory`、`gitTimeoutMs`、工具名是部署形态，留在 profile 的 patch 里。volatile 字段要求 harness 的 `schemastery` 提供 `.volatile()`（**≥ 3.18.4**）——这也是本插件 `devDependencies` 里那个版本下限的来由；更早的 harness 只支持启动时配置。

## 测试

```sh
# 从 Harness checkout 根运行
node_modules/.bin/vitest run --root dsh-worktree
```

用例覆盖：porcelain 两种分隔格式与 prunable/locked 元数据、分支列表解析、仓库根回溯（linked worktree / submodule 区分）、分支与路径校验、三种存储布局（工作区内 / 仓库同级 / 用户目录）与 `agentsDirectory` 校验、真实 git 上的创建/列举/删除/脏目录/主 checkout 拒绝/从 linked worktree 内再创建/按指定 base 分支新建、**子模块与独立嵌套仓库的创建与删除（开关默认关、含扫描深度、整体回滚、带子模块 checkout 的拒绝语义、原 checkout 子模块状态不受影响）**、**服务策略热替换**、**设置页的注册门控/字段投影/保存与清理**、路由的原子性与回滚、`branches` 方法、浏览器侧分支规则与路由客户端、座位的基础分支与分支列表、控件"先拉会话目录、再导航"的次序（含导航被拒后的报错）。

浏览器半边那四个 spec（`seat` / `registration` / `navigation` / `settings`）要 checkout 的 pnpm store 才能解析运行时依赖，走 `--config vitest.harness.config.ts` 的全量配置：

```sh
node_modules/.bin/vitest run --root dsh-worktree --config vitest.harness.config.ts
```

`tsconfig.harness.json` 走 checkout 的 `paths` 解析到**源码**做类型检查——安装态的各包跨多个发布线，混在一起会得到任何真实部署都不存在的 slot/service 合并结果：

```sh
node_modules/.bin/tsc --noEmit -p dsh-worktree/tsconfig.harness.json
```

## 构建

```sh
npm run build     # tsdown（host → lib/index.mjs）+ node build-client.mjs（lib/client.js）
```

开发装依赖时用 `npm install --force`：已发布的 Harness 线把 `@deepseek-ai/schemastery` 精确锁在 3.18.2，而本插件要用它的 `.volatile()`（≥ 3.18.4），peer 图会因此报 ERESOLVE。host 半边是进程内模块，`npm run build` 之后要重启宿主；浏览器半边刷新页面即可。
