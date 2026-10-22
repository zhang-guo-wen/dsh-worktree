---
paths:
  - "src/**"
  - "tests/**"
---

> 覆盖什么、何时读：失败模式总表（每种情况插件怎么表现）与易崩清单 14 条（一改就崩的接线点）。排查「为什么没删除 / 为什么报错 / 为什么备份页空着」、动跨文件契约（`policy.ts` / `settings-fields.ts` / `file-guard.ts` / `backup-tool.ts` / 备份页注册）之前读。

## 失败模式

| 情况 | 行为 |
|---|---|
| 目标分支已存在 | 创建失败，不留残留记录（自动 `worktree prune`） |
| 分支名非法 | 在启动 git **之前**拒绝；浏览器也先行拒绝，两侧共用同一条规则 |
| 目录有改动 | `remove()` 拒绝（UI 删除不传 force）；归档清理同样不传 force，checkout 原样保留 |
| 删除主 checkout | 拒绝（`inspectLinkedCheckout` 对主 worktree 也返回 `undefined`，归档清理根本不会尝试） |
| 删除未列出的路径 | 拒绝（请求路径先与仓库自己的列举比对，模型编造的路径到不了 git） |
| 非 Git 仓库 | 控件不渲染（探测失败即隐藏） |
| **子模块拉不下来**（网络、鉴权、或本地路径子模块被 Git 的 `protocol.file.allow` 拒绝） | 创建整体回滚：已建的嵌套 checkout 先删、父 checkout 再删，错误原样抛出 |
| **某个嵌套仓库建不了分支**（例如它还没有任何 commit，没有 HEAD 可拉；或 Git 拒绝了这次 checkout） | **只跳过这一个**：创建照常成功，父 checkout 与其余子仓库照常到位，该仓库连同原因（`no-commits` / `create-failed`）记进 `CreatedWorktree.nestedSkipped`，Host 侧 `warn` 日志点名它，界面在 worktree 胶囊上用警告图标 + 悬停文案列出 |
| **删除带已初始化子模块的 checkout** | Git 对这类 worktree 一律拒绝（哪怕干净），所以插件先自己查改动、干净时才用 `--force`；有改动照样拒绝 |
| 回滚时清理也失败 | 错误里同时给出原始原因和没删掉的目录，绝不静默留下垃圾 |
| `webServer` / `workspaceRegistry` / `agents` 缺失 | 服务照常提供，只是没有路由（handler 三个都要用，缺一个就不挂）；缺 `workspaceRegistry` 时归档清理也不装配 |
| 路由未挂 / 探测请求失败 | 浏览器半边的 `checkout` 探测退化为 `unknown`，因此**不弹第二条通知**；归档与第一条通知不受影响 |
| 会话挂不进工作区 | 报 `[attach]`，checkout 与会话都保留（删掉 checkout 会打断刚在里面启动的会话） |
| **草稿搬不过去**（源会话正在提交、目标会话已有草稿、宿主没有 `rebindDraftFiles`、引用快照与文本对不上） | 该次导航整体回滚：新会话清空、附件重新绑回源会话，**原草稿一字不丢**，原因显示在 worktree 胶囊上；已创建的 checkout 与会话照常保留，用户可照常进入后手动粘贴 |
| **创建期间用户又切了会话** | 不导航、不动任何草稿（`shown !== sourceId`），已建好的 checkout 与会话仍在侧边栏里 |
| 备份页读到的东西与副本一致 | 该行**不列出**（没有可还原的东西）；全部一致时显示空态并说明副本何时产生 |
| 还原请求的副本不存在 / `relative` 越出会话目录 / 目标不是普通文件 | 路由答 **404**，页面在该行显示宿主的原因，按钮回到可用状态 |
| 对比请求的副本不存在 / `relative` 越界 | 路由答 **404**，详情视图显示宿主原因并可重试；**绝不读请求体里给的任何路径** |
| 对比的任一侧是二进制 / 超过 2 MiB / 已不是普通文件 | 只回字节数（`binary` / `oversized` / `unreadable`），不画两栏；还原按钮照常可用；`identical` 时显示"内容已与备份一致" |
| 对比的行数超过上限 / 行差异超时 | 长段未改动行折叠成 gap（两侧各留 3 行）；超过 2,400 行截断并注明；超时退化为整块替换并标 `coarse`——都不静默丢改动 |
| 会话不在本宿主的会话存储里（例如已归档、或换了宿主） | `backups` / `restore` / `compare` 答 404 并点名会话；**不读请求体里的目录**，绝不猜工作目录 |
| 工作区外的副本是 Windows UNC 路径（没有盘符可反推） | `list` 跳过它、`restore` 拒绝它——宁可少一行，也不把文件写到一个猜出来的位置 |
| `sessions` 服务缺失 | 其余路由方法照常（它们不用它），只有 `backups` / `restore` 报会话未知 |
| `sidebarRightTabs` 缺失（没有右侧边栏的部署） | 不注册备份页；芯片、设置页、归档通知照常 |

## 易崩清单

1. 重建 `lib/` 不重启宿主 → host 半边还是旧代码（`lib/index.mjs` 是进程内模块）。
2. 改 client 未重建 / 未刷新 → 浏览器跑旧 bundle；修改 `HANDOFF_ID` 会使宿主启动图找不到包名对应 factory。
3. CSS module 里 JSX 引用但 CSS 未定义的类 → `undefined`，静默无样式（改样式后核对类名齐全）。
4. `ctx.x` 属性访问未 inject 的服务 → 抛错（用 `ctx.get('x')`）。
5. `agentsDirectory` 写成绝对路径或带 `..` 段、`nestedScanDepth` 不是正整数 → 服务构造/`reconfigure` 抛错，插件加载即失败。
6. `startSessionRoute: false` 却从界面勾选 → 路由没挂，客户端只会报 "the worktree route is unreachable"。
7. 改 `src/policy.ts` 的取值集合后忘了同步设置页/浏览器半边 → 两侧对"哪些值合法"不再一致，Host 拒绝的值可能已经在页面上被暂存。
8. hero 行距或那个 dock 的 order 被上游改动 → 胶囊不再与 `选择工作区 / 模式` 同一行（见 `.claude/rules/client-ui.md` 的「界面实现细节」）。
9. 改 `policy.ts` 的 `DEFAULT_FILE_GUARD` / `DEFAULT_DENY_DESTRUCTIVE_COMMANDS` / `DEFAULT_NEW_SESSION_WORKTREE` / `DEFAULT_BACKUP_SIDEBAR` 却忘了同步 `src/client/settings-fields.ts` 的 `SWITCH_DEFAULTS` → 设置页把"开"画成"关"（或反之），用户会去改一个本来就对的设置。两者必须一起改。
10. 把 `defineTool` 从 `src/backup-tool.ts` 挪回 `src/file-guard.ts` → 守卫会因此在**导入期**拉进工具注册表及其服务依赖（`dsh-tools` → `dsh-scope` 等），自足 suite 立刻加载失败。拆成两个模块就是为了让守卫本身不依赖注册表。
11. 改 `file-guard.ts` 的 `place()` 或 `archive()` 时忘了两边都用 `sessionKeyOf` → 写进一个键、删另一个键，归档后备份目录永远留着。
12. 备份页的注入面**每次渲染返回新对象**（例如在 `inject: (sessionId) => ({ list, restore })` 里现造闭包）→ 组件里以它为依赖的 effect 每次渲染都重跑，变成"读一次、渲染、再读一次"的循环。注册时构造**一个**面对象并原样返回。
13. 备份页 `sidebar.right.pane.tab` 的 `key` 与 `sidebarRightTabs.register` 的 `id` 不一致 → 席位按类型的 `id` 派发，两者不一致时页面永远不渲染（宿主显示"不可查看"占位），而注册本身不报错。
14. 还原时接受调用方给的**目标路径**而不是副本路径 → 浏览器传一个别的目录就能把 `notes.txt` 写进那儿；只接受 `list` 返回的 `relative`，目标由 Host 用会话自己的工作目录现算。`compare` 同样只认 `relative`，目标由 Host 现算——绝不读任意路径。
15. 给对比加"用 Git（`git diff` / `git show`）算变化"的依赖或把基线换成 HEAD → 无 Git 机器整页失效，且基线语义从"本会话首次改动前"漂成"上次提交"，多会话归因也消失；对比只读两份文本。
16. 两栏行数不一致、或行高不固定（文本换行、行里再包多行结构）→ 纵向同步后左右错行；行由 `toColumns` 对等生成、行高固定 `1lh`，这是对齐的前提，不是样式偏好。
