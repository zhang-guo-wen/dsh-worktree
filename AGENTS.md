# AGENTS.md

本仓 `dsh-worktree` 是**独立于 harness monorepo** 的 DeepSeek Harness (DSH) 插件：
在独立的 Git worktree 里开一个 DSH 会话——创建 checkout、把它注册成一个独立工作区、并让会话以它为工作目录启动。
它不打包 `@deepseek-ai/*`，运行时从宿主 harness 解析这些包。

姊妹插件：[`dsh-memory`](../dsh-memory)（Claude 记忆目录与 memory 工具）、
[`dsh-claude-compat`](../dsh-claude-compat)（CLAUDE.md 指令文件、技能、作用域规则）。三者互不 import、互不依赖，可单独安装。

## 目录

仓库根**就是**包：`package.json` 即 `@guowenzhang/dsh-worktree`。
这不是风格选择——`dsh plugin add <git-url>` 取的是仓库根，包放在 `packages/*` 下会被装成错误的东西。

| 组件 | 位置 | 作用 |
|---|---|---|
| `worktree` 服务 | `src/service.ts` | 仓库根解析、创建/列举/删除 linked worktree、按布局推导默认路径；git 调用与超时在 `src/git.ts`，主仓库回溯在 `src/repository.ts`，`worktree list --porcelain` 解析在 `src/porcelain.ts` |
| 模型工具 | `src/tools.ts` | `worktree_create` / `worktree_list` / `worktree_remove`，配置字段可改名 |
| Host 路由 | `src/route.ts` | `POST /worktree/api/{start,list,branches}`：原子地"建 checkout → 注册工作区 → 开会话 → 把会话挂进该工作区"，并给界面提供本地分支列表；开会话本身在 `src/session.ts` |
| 浏览器控件 | `src/client/` | 新会话屏幕 `选择工作区 / 模式` 那一行右侧的一个胶囊：左边是本地分支下拉，右边是 `worktree` 勾选；`WorktreeChip.tsx` 渲染，`seat-store.ts` 管状态，`api.ts` 是路由客户端 |
| 设置页 | `src/client/SettingsSection.tsx` | 设置 → **Worktree**，标题「worktree 配置」，三行：**创建子仓库**开关（默认关）、**扫描层级**（默认 1）、**worktree 存储位置**（工作区内 / 仓库同级 / 用户目录；说明文字跟着选项显示对应路径）。右下角 `[恢复默认] [保存]`。行式左右布局（同「通用设置」）。保存即生效，不需要重启；暂存表单在 `settings-store.ts` |
| 两侧共享 | `src/policy.ts` / `src/branch-rule.ts` / `src/validate.ts` | 默认值与取值集合（`policy.ts` 不 import 任何东西，浏览器 bundle 才能直接用）、Host 与浏览器必须逐字一致的分支名规则、路径与目录校验 |

- `lib/` —— 构建产物：**已提交进仓库**（`index.mjs` host + `client.js` 浏览器 handoff），
  这样别人可以直接从 git 安装。改完源码**记得 `npm run build` 并把 `lib/` 一起提交**。
- `cordis.patch.yml` —— 把插件行插入组合的 bundle 层。
- `tests/` —— 11 个 spec：`service` / `porcelain` / `route` / `plugin` / `session` / `nested` / `client` 属于自足子集，
  `seat` / `registration` / `navigation` / `settings` 四个浏览器半边 spec 需要 checkout。两个 runner 见「测试」。

## 组合接线（cordis.patch.yml）

`cordis.patch.yml` 把插件行插入组合的 bundle 层：

```yaml
- insert:
    - id: worktree
      name: '@guowenzhang/dsh-worktree'
```

`package.json` 的 `dsh` 字段声明它在 profile 里的接线：`dsh.bundle.patch` 指向上面这份 patch，`dsh.client.inject` 列全浏览器半边挂载时要用到的宿主 client 包，`platform` 为 `web`；`exports` 另导出 `./client`（`lib/client.js`）与 `./cordis.patch.yml`。

行 id 是 `worktree`：它同时是 host 插件导出的 `name` 与设置命名空间 `SETTINGS_NAMESPACE`，也是 `/worktree/api` 前缀的由来。

host 插件导出 `{ name, inject, Config, apply }`。`inject: ['tools']` 是工具注册的硬依赖；`webServer` / `workspaceRegistry` / `agents` 由 `registerRoute` 里的 `ctx.inject` 等，settings 也用 `ctx.inject(['settings'], …)` 软探测——缺 `webServer` / `workspaceRegistry` / `agents` 之一就不挂路由（handler 三个都要用），缺 settings 就只是不能在线改策略，工具照常注册，插件不会整体不激活。

浏览器半边注册两处座位：`conversation.input.dock`（id `worktree`，order -10，排在最前）与 `settings.section`（id `worktree`，order 30），并注册 `worktree` 字典。

## 安装

四个变体，全部走官方命令；它把参数转发给 profile 目录里的 pnpm，**并自行维护 profile 清单**（依赖与 `dsh.profile.bundles` 一起加，不要手写）：

```sh
# npm 官方源
npx @deepseek-ai/dsh plugin --profile web add @guowenzhang/dsh-worktree

# HTTPS
npx @deepseek-ai/dsh plugin --profile web add https://github.com/zhang-guo-wen/dsh-worktree.git

# SSH
npx @deepseek-ai/dsh plugin --profile web add git+ssh://git@github.com/zhang-guo-wen/dsh-worktree.git

# 锁定发布 tag，默认分支上后续的临时提交不会被拉到
npx @deepseek-ai/dsh plugin --profile web add "git+ssh://git@github.com/zhang-guo-wen/dsh-worktree.git#v0.1.0"

# 本地目录开发安装，pnpm 建 symlink，重建 lib/ 后重启即生效，无需重装
npx @deepseek-ai/dsh plugin --profile web add C:/path/to/dsh-worktree

# 卸载：依赖条目与 bundle 层一起移除
npx @deepseek-ai/dsh plugin --profile web remove @guowenzhang/dsh-worktree
```

`lib/` 已提交进仓库，所以从 git 装完即可运行，**使用者不需要构建**。装完要重启宿主（见「部署与生效语义」）。

也可以不动 profile 清单，手工在 profile 的 `cordis.patch.yml` 里插入同一段 `- insert:`（见「组合接线」）——但那样 profile 的 `dependencies` 与 `dsh.profile.bundles` 要你自己维护。

## 构建

```sh
npm install --force
npm run build     # tsdown（host → lib/index.mjs）+ node build-client.mjs（lib/client.js）
```

- host：`tsdown` 打 `src/index.ts` → `lib/index.mjs`，所有 `@deepseek-ai/*` 保持 external。
- client：`build-client.mjs`（rolldown）→ `lib/client.js`，包成 `window.__ModuleLoader__.load({ id, factory })`，react / `@deepseek-ai/*` external，`.module.css` 用 lightningcss 编译并内联。id 与 `HANDOFF_ID = '@guowenzhang/dsh-worktree'` 一致。
- CSS module 的类名先按字母排序再写进产物：lightningcss 的 `exports` 对象没有稳定键序，不排序的话每次构建的 `lib/client.js` 字节都不同，提交进仓库的产物会天天出假 diff。
- 开发装依赖时用 `npm install --force`：已发布的 Harness 线把 `@deepseek-ai/schemastery` 精确锁在 3.18.2，而本插件要用它的 `.volatile()`（≥ 3.18.4），peer 图会因此报 ERESOLVE。
- 本插件没有 `@Remote` 这类装饰器，所以 `tsdown.config.ts` 不需要 sibling 插件里的 `lowerDecorators` transform。

## 部署与生效语义

**host 半边是进程内模块：重建 `lib/index.mjs` 不会替换正在运行的那份代码。** 只有 `dsh plugin add/remove` 造成的重组才会把它 import 进进程，之后改源码必须**重启宿主**才生效。

client 半边相反：bundle 按内容 revision 提供，刷新页面就会取到新的；改了 client 产物要 bump `HANDOFF_ID` 或强刷浏览器，否则浏览器一直跑旧 bundle。

一个例外是「配置」里标为 volatile 的三个字段：它们由 Host 在文档更新后装回运行中的服务实例，**不需要重启**。

## 设计约束（为什么这么做）

### 会变成一个新工作区——这是刻意的

Workspace 的身份判据是 **`fs.realpath` 之后的路径字符串相等**（`dsh-workspace` 的唯一 canon），会话归属又靠 `header.cwd` 的 realpath 相等。worktree 路径与主 checkout 是两个不同的 realpath，**所以它必然是一个新工作区**。

不把它硬塞进主工作区，是因为那需要把"相等"判据换成"前缀包含"，会让 `C:\repo` 和 `C:\repo-subdir` 互相污染。用带分支名的标题让并列条目可读，是这个代价的正确付法。

### 三个动作必须原子

顺序被工作区注册表强制：会话只在 `header.cwd` 的 realpath 等于工作区 path 时才归属，不一致会 fail loud。所以必须是 **checkout → 工作区记录 → 会话**，且：

- 工作区创建失败 → 删掉 checkout；
- 会话启动失败 → 删掉 checkout（工作区记录保留，可用侧边栏删除）；
- 清理也失败 → 错误里点名目录，绝不静默留下垃圾。

会话已经起来之后再挂账本（`workspace.attachSession`）失败是第四种情况：那时 checkout 与会话都活着，删 checkout 会打断刚在里面启动的会话，所以只报 `[attach]` 并**保留**两者。

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

## 扫描与布局

扫描规则（开关打开时）：从**仓库根**开始按 `nestedScanDepth`（默认 **1 层**，即只看直接子目录）找带 `.git` **目录**的子目录——带 `.git` 文件的是子模块或别的仓库的 worktree，都不在这里处理；`.git` 与 `node_modules` 不进入；嵌套里的嵌套也会被找到（层数够的话），且**父先子后**创建（子的目录在父里面）。

存储位置（`defaultPath`，设置页三选一）：

| 值 | 界面 | 目录 |
|---|---|---|
| `agents`（默认） | 工作区内 | `<工作区>/.agents/worktree/<分支>`，出现在工作区树里 |
| `sibling` | 仓库同级 | `<仓库名>-wt-<分支>`，建在仓库旁边，不进工作区树 |
| `home` | 用户目录 | `~/.agents/worktree/<分支>`，整台机器共用一个位置 |

`agents` 那一档的子目录由 `agentsDirectory` 决定（默认 `.agents/worktree`），**缺的每一级都会自动创建**；`sibling` / `home` 是绝对路径推导，不读它。分支名进目录前会把 `/` 换成 `-`。

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

`agentsDirectory` 必须是工作区相对目录（不能是绝对路径、不能带 `..` 段），`nestedScanDepth` 必须是正整数；两者在服务构造与服务热替换时都会校验，不合法直接抛错。

## 设置页与 profile 的关系

**设置页**（设置 → Worktree）改的就是上面「配置」里的那几个策略字段。它与 profile 的关系是：

- 保存写进 **profile 的 `cordis.patch.yml`**（UI 和你手改 YAML 改的是同一处），所以优先级、备份、版本管理都和你手工编辑完全一样；
- 这几个字段在插件里声明为 **volatile**，Host 会在文档更新后立刻把新策略装回正在运行的服务实例上——**不需要重启**；改名、路由开关这类"影响注册"的字段不在这里，它们只在启动时生效；
- 保存被拒绝时会明确说原因。最常见的一条是 **"is overridden by a home patch or command-line overlay"**：如果这个插件是被 `--patch`/home patch 覆盖层加载的，那层在 profile 之上，写 profile 会被它盖住，所以 Host 直接拒绝（这是 harness 的通用规则，不是本插件特有）。用 profile 的 bundle 正常安装就不会遇到。

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

## 界面实现细节

- **胶囊与 `选择工作区 / 模式` 同一行是靠 CSS 对齐的**：hero 那一行的两个槽（`conversation.hero.workspace`、`conversation.hero.agentPreset`）都是 single 槽，第三方插件没有可注册的座位。控件实际注册在 `conversation.input.dock`（order -10，排在最前），在 `data-phase='hero'` 时把这一行压成 0 高度、抵消 `.composerHero` 的 8px 行距，再用 `bottom: calc(100% + 4px)` 悬在输入卡片上方 4px 处、`right: 28px` 收在卡片右边缘内 12px——下边距取 4px，右边距取 12px 是因为卡片右上角是 22px 圆角，靠太近会像压在弧线上；12px 也正好是左侧 workspace 胶囊图标距卡片左边缘的距离。胶囊自身 24px 高、13px 字，和旁边 28px 的 ghost 胶囊同一种语言（无边框、无底色，靠 hover 填充和两段之间 12px 高的细分隔线成形），整体矮一档；`worktree` 一段是 `☐ <新建工作区图标> worktree`：图标跟在勾选框之后、紧贴文字，用的是 `IconProjectAddOutlineRegular`——侧边栏「添加工作区」那个图标，因为这个 check 的结果正是"这个 checkout 变成一个新工作区"；勾选框、图标、文字同在一个 label 里，点哪里都是勾选。两段的字都是 13px/500，和左侧 ghost 胶囊一致。两者顶边对齐。因此：非 hero 阶段它仍退回自己的一行（此时本来也不渲染），hero 行距若被上游改动，对齐会差一点；若别的插件往这个 dock 里注册了 order < -10 的条目，控件会贴到那条的上面。
- **"开关只在首条消息时才创建"做不到**：客户端 composer 的提交是 ui-conversation 内部的输入状态机，槽位里没有"提交前"钩子（`conversation.composer` 是 chain，选中者只能自己重写整个 composer；`conversation.composer.bar` 是 single，注册进去会把输入框顶掉），Host 侧也只有 `session/prompt` 这个 RPC；而 `SessionHeader.cwd` 又是创建时冻结的不可变字段。所以"先开关、首条消息再建"需要给 harness 加一个提交前扩展点，插件自身无法实现。当前行为是**点击即创建并切过去**。

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

## 发版（Release）

`lib/` 是提交进仓库的，所以**发版 = 改版本号 + 构建 + 提交产物 + 打 tag**。别人按 tag 安装，`master` 上的临时提交不会被他们拿到。

1. 改根 `package.json` 的 `version`。
2. `npm run build`，确认 `lib/index.mjs` 与 `lib/client.js` 是最新。
3. 提交源码与 `lib/`（不要把 `lib/` 落在外面的工作区）。
4. 打带注释的 tag 并推送：

   ```sh
   git tag -a v<version> -m "dsh-worktree <version>"
   git push origin master --follow-tags
   ```

5. 验证安装（仓库根即包，不再需要 `path:` 参数）：

   ```sh
   dsh plugin --profile web add \
     "git+ssh://git@github.com/zhang-guo-wen/dsh-worktree.git#v<version>"
   ```

## 易崩清单

1. 重建 `lib/` 不重启宿主 → host 半边还是旧代码（`lib/index.mjs` 是进程内模块）。
2. 改 client 不 bump `HANDOFF_ID` / 不硬刷新 → 浏览器跑旧 bundle（表现为"改动没生效/控件不变"）。
3. CSS module 里 JSX 引用但 CSS 未定义的类 → `undefined`，静默无样式（改样式后核对类名齐全）。
4. `ctx.x` 属性访问未 inject 的服务 → 抛错（用 `ctx.get('x')`）。
5. `agentsDirectory` 写成绝对路径或带 `..` 段、`nestedScanDepth` 不是正整数 → 服务构造/`reconfigure` 抛错，插件加载即失败。
6. `startSessionRoute: false` 却从界面勾选 → 路由没挂，客户端只会报 "the worktree route is unreachable"。
7. 改 `src/policy.ts` 的取值集合后忘了同步设置页/浏览器半边 → 两侧对"哪些值合法"不再一致，Host 拒绝的值可能已经在页面上被暂存。
8. hero 行距或那个 dock 的 order 被上游改动 → 胶囊不再与 `选择工作区 / 模式` 同一行（见「界面实现细节」）。
