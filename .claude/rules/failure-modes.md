---
paths:
  - "src/**"
  - "tests/**"
---

> 覆盖什么、何时读：失败模式总表（每种情况插件怎么表现）与易崩清单 11 条（一改就崩的接线点）。排查「为什么没删除 / 为什么报错」、动跨文件契约（`policy.ts` / `settings-fields.ts` / `file-guard.ts` / `backup-tool.ts`）之前读。

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

## 易崩清单

1. 重建 `lib/` 不重启宿主 → host 半边还是旧代码（`lib/index.mjs` 是进程内模块）。
2. 改 client 未重建 / 未刷新 → 浏览器跑旧 bundle；修改 `HANDOFF_ID` 会使宿主启动图找不到包名对应 factory。
3. CSS module 里 JSX 引用但 CSS 未定义的类 → `undefined`，静默无样式（改样式后核对类名齐全）。
4. `ctx.x` 属性访问未 inject 的服务 → 抛错（用 `ctx.get('x')`）。
5. `agentsDirectory` 写成绝对路径或带 `..` 段、`nestedScanDepth` 不是正整数 → 服务构造/`reconfigure` 抛错，插件加载即失败。
6. `startSessionRoute: false` 却从界面勾选 → 路由没挂，客户端只会报 "the worktree route is unreachable"。
7. 改 `src/policy.ts` 的取值集合后忘了同步设置页/浏览器半边 → 两侧对"哪些值合法"不再一致，Host 拒绝的值可能已经在页面上被暂存。
8. hero 行距或那个 dock 的 order 被上游改动 → 胶囊不再与 `选择工作区 / 模式` 同一行（见 `.claude/rules/client-ui.md` 的「界面实现细节」）。
9. 改 `policy.ts` 的 `DEFAULT_FILE_GUARD` / `DEFAULT_DENY_DESTRUCTIVE_COMMANDS` 却忘了同步 `src/client/settings-fields.ts` 的 `SWITCH_DEFAULT` → 设置页把"开"画成"关"（或反之），用户会去改一个本来就对的设置。两者必须一起改。
10. 把 `defineTool` 从 `src/backup-tool.ts` 挪回 `src/file-guard.ts` → 守卫会因此在**导入期**拉进工具注册表及其服务依赖（`dsh-tools` → `dsh-scope` 等），自足 suite 立刻加载失败。拆成两个模块就是为了让守卫本身不依赖注册表。
11. 改 `file-guard.ts` 的 `place()` 或 `archive()` 时忘了两边都用 `sessionKeyOf` → 写进一个键、删另一个键，归档后备份目录永远留着。
