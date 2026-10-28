---
paths:
  - "src/**"
  - "tests/**"
---

> 覆盖什么、何时读：失败模式总表（每种情况插件怎么表现）与易崩清单 30 条（一改就崩的接线点）。排查「为什么没删除 / 为什么报错 / 为什么备份页空着 / 为什么 Git 账号页空白或扫描没结果」、动跨文件契约（`policy.ts` / `settings-fields.ts` / `file-guard.ts` / `backup-tool.ts` / `session-tree.ts` / 备份页注册 / `src/git-accounts/**` / 设置页的 Git 账号卡）之前读。

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
| 根会话不在 live 会话存储里（已停止的子会话、宿主重开后的历史会话） | 读 `sessionPersistence.stat` 的 header 拿到目录，`backups` / `restore` / `compare` 照常工作——这是修复"读取变更记录失败"的那条路 |
| 子会话的目录解析不出来 / 子会话树读取失败 | 跳过该子会话（它的副本无法对比与还原）；子会话树整体读取失败或缺 `subagents` 服务时**降级为只列当前会话**并记 warn，页面不失败 |
| 根会话两个存储都不认、且该会话没有副本 | `backups` 答 **200 空列表**（页面显示"还没有变更记录"）；`restore` / `compare` 仍答 404 |
| 根会话两个存储都不认、但它确实留有副本 | `backups` 答 **404** 并说明目录未知、副本无法对比或还原；**不读请求体里的目录**，绝不猜工作目录 |
| 还原请求的副本不存在 / `relative` 越出会话目录 / 目标不是普通文件 | 路由答 **404**，页面在该行显示宿主的原因，按钮回到可用状态 |
| 对比请求的副本不存在 / `relative` 越界 | 路由答 **404**，详情视图显示宿主原因并可重试；**绝不读请求体里给的任何路径** |
| 对比的任一侧是二进制 / 超过 2 MiB / 已不是普通文件 | 只回字节数（`binary` / `oversized` / `unreadable`），不画两栏；还原按钮照常可用；`identical` 时显示"内容已与备份一致" |
| 对比的行数超过上限 / 行差异超时 | 长段未改动行折叠成 gap（两侧各留 3 行）；超过 2,400 行截断并注明；超时退化为整块替换并标 `coarse`——都不静默丢改动 |
| 工作区外的副本是 Windows UNC 路径（没有盘符可反推） | `list` 跳过它、`restore` 拒绝它——宁可少一行，也不把文件写到一个猜出来的位置 |
| `sessions` / `sessionPersistence` 服务缺失 | 其余路由方法照常（它们不用它们）；`backups` / `restore` / `compare` 按"会话不在存储里"处理，有副本时 404 |
| `subagents` 服务缺失（或宿主没有 subagent catalog） | 备份页只列当前会话，不报错；子会话的行不会出现 |
| `sidebarRightTabs` 缺失（没有右侧边栏的部署） | 不注册备份页；芯片、设置页、归档通知照常 |
| 没有凭据服务（部署缺 `@deepseek-ai/dsh-credentials-local`） | Git 账号路由照挂，`snapshot` 答 **503 `credentials_unavailable`**，页面显示宿主说明；入口不隐藏，工作区功能不受影响 |
| 访问令牌被平台拒绝 / 过期 / 权限不足 | `accounts.add` 答 401（`unauthorized`）或 403（`forbidden`），页面在对话框内显示可操作原因；**不写凭据记录** |
| 扫描到的是密码而不是令牌 / 主机已下线 / 无权限 | 该候选验证失败，记 `unverified` + 错误码且不写账号；其他候选照常采纳，扫描整体不失败 |
| 未知主机（自建 GitLab 域名不含产品名） | 未标注 provider 的候选依次探测 gitlab → github → gitee；都不通记 `unverified`，绝不猜平台写账号 |
| 同平台 + 同主机 + 同登录名重复添加/扫描 | 同 token 视为 `duplicate` 不写；不同 token 刷新该账号令牌并保留 id，页面提示"已刷新" |
| Git 未安装 / 全局配置读不出来 | 身份卡显示原因并禁用输入；读写全局身份失败不影响账号、项目列表与其他功能 |
| 扫描来源缺失（无 gh、凭据管理器不可用、非 Windows） | 该来源标 `available: false` / `supported: false`，其余来源照常；扫描不因单个来源失败而整体失败 |
| 自签证书的 GitLab | 网络错误原样上报（消息已脱敏）；宿主 Node 运行环境需信任该证书，README 已说明 |
| **令牌出现在 URL 里（Gitee `access_token` query）** | HTTP 错误统一经 `sanitizeRequestUrl` 去掉 query/fragment/credentials；路由响应、扫描报告、日志都不出现 token |
| SSH 私钥不存在 / 不可读 / 加密 / 被 host 拒绝 / host 不可达 | `invalid_input`（400，加密密钥文案提示 ssh-agent 或换未加密私钥）或 `unauthorized`（401，publickey 被拒）→ **不写账号**；`network`（502）→ SSH 账号以 `verified: false` 保存（用密钥文件名当临时 login），token 账号仍不保存；私钥内容从不出现在错误里 |
| SSH 主机 TCP 可连通但握手被中间网络阻断 | 每次探测最多 5 秒（22 首段 3 秒 + 443 备用 2 秒），失败后 SSH 账号仍可保存为未验证；**Git over SSH 同样会被阻断**，这是网络问题不是插件问题，提示用户检查网络/代理/VPN |
| 验证连接与添加 | 「验证连接」只读不写；SSH 网络失败不挡保存，token 网络失败仍拒绝；`unauthorized`/`invalid_input` 永远不保存，避免把被拒绝的凭据记成有效账号 |
| 扫描结果展示 | 成功只弹 Toast（点名新增账号的 login），不渲染来源/note/跳过行卡片；失败保留卡内行内错误与重试 |
| 宿主 PATH 上没有 `ssh` | `ssh.keys` 仍可列路径（只读文件）；添加 SSH 账号答 502 `provider_unavailable` 并说明缺 OpenSSH 客户端；token 账号与其余功能不受影响 |
| SSH 账号被选进项目列表 | Host 直接答 400 `ssh_no_api`；页面根本不发请求，显示"SSH 不能列项目，需要令牌账号"的说明，不显示笼统失败 |
| SSH host key 未见过 / 变了 | 用临时 known_hosts + `accept-new`：首次信任写入临时文件，不污染 `~/.ssh/known_hosts`；host key 变化仍按验证失败处理（502），不静默信任 |

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
17. 把子会话树改成按持久化 header 的 `parentSession` 走树（而不是 `subagents.listDescendants`）→ **fork 会被当成子会话**（fork 有 `parentSession`，但不在 subagent catalog、且是另一段对话），页面会把分叉分支的改动混进本会话。
18. 备份页的行按 `relative` 单独做 key/状态 → 根会话与子会话改过同一路径时两行会互相顶掉（key 重复、还原状态串行）；行身份必须是「`sessionId` + `relative`」，还原/对比也必须发副本自己的 `sessionId`。
19. Git 账号的凭据 key 必须落在凭据缝语法 `<scope>/<id>`（scope `worktree`，id 形如 `github-<12 hex>`），且每次读取都要过 `parseStoredAccount` → 否则一条手改/版本不符的记录会让整页 500 或被当成账号；坏记录应跳过并 `warn`。
20. `GitAccountsService` 的 `scan` / `environment` / `git` 选项是**测试隔离缝**：测试里用真实实现就会读本机凭据、真实 `~/.gitconfig`、真跑 gh/PowerShell；identity 测试必须把 `GIT_CONFIG_GLOBAL` + `HOME` + `USERPROFILE` 指向临时目录（`GIT_CONFIG_NOSYSTEM=1`）。
21. 未知主机探测只对**没标注 provider** 的候选生效；来自环境变量/已知主机的候选只验证它自己的平台，否则一次「令牌过期」会被其它平台 URL 的 `not_found` 盖掉（已有测试钉住 `unverified + unauthorized`）。
22. 页面窄容器把 `.form` 改成列向后，字段的 `flex: 1 1 240px` 会变成 240px **高度**把身份卡撑爆；列向时必须 `.field { flex: none }`，并且改样式后要用真实浏览器在 390px 复核卡片高度（jsdom 与构建都不报这个错）。
23. 设置页 Git 账号卡的「在『Git 账号』页查看项目」必须先调 owner 的 `close()` 关闭设置弹窗、再 `ctx.layout.selectPanel('git-accounts')`：顺序反了主面板会在弹窗背后切换，用户只看到设置页还开着。导航服务要按调用时 `ctx.get('layout')` 取，缺它时只保留卡片内的列表操作，不影响其余设置。
24. 添加对话框的字段用身份卡的 `.field`（`flex: 1 1 240px`）而不是 `.addField` → 纵向 flex 里两行字段各占 240px 高度，对话框被撑到近全屏、字段之间出现巨大空白；任何"纵向表单 + `.field`"的组合都必须 `flex: none` 或换 `.addField`，并用真实浏览器量一次对话框高度（jsdom/构建不报此错）。
25. SSH 密钥列表的 effect 把 `keys.status` 作为依赖，又在 cleanup 里把回调标记为失效 → `setKeys(loading)` 触发 cleanup，自己请求的 promise 回来时被丢弃，列表永远停在"正在查找 SSH 密钥…"。用 ref 做一次性门闩（`keysRequested`），依赖只放 `open/auth/sshKeys`；关闭对话框时把 ref 与状态一起重置。
26. 用 `parseSshBanner` 判 SSH 成功时只看 GitHub 的 `Hi …` 措辞 → Gitee 的 `Hi … GITEE.COM` 会被误判成 GitHub，账号记到错误平台。Gitee 的分支必须先于 GitHub 匹配；并且**成功与否看 banner，不看退出码**（GitHub 认证成功也返回非零）。
27. 「验证连接」如果复用了 `add` 而不是新的只读 `accounts.verify` → 用户点一次测试就在背后写了一条凭据记录；验证必须是纯读路径，测试断言 store 为空。
28. SSH 的 5 秒必须是**整次验证**预算：有 443 备用端点时第一次 3 秒、备用端点吃剩下 2 秒；若两个端点各给 5 秒，用户会等 10 秒（实测过 10.2 秒的旧行为）。备用端点只对规范 `github.com` / `gitlab.com` 且未写自定义端口时启用，自建 host 与 Gitee 不试。
29. 网络失败时允许 SSH 保存为未验证，但只限 SSH + `network`，且 login 只能取密钥文件名；**`unauthorized` / `invalid_input` 和 token 的任何网络失败都不能写**。同一 `keyPath` 再添加成功时按 keyPath 命中原记录升级 login/verified（id 不变），已验证账号重连失败时保持原记录，不得降级。
30. 扫描结束后不要再渲染结果卡片：页面必须只弹 Toast 点名新增账号。`ScanReportPanel.tsx` 已删除，`SOURCE_KEYS`/`NOTE_KEYS`/`OUTCOME_KEYS` 与对应文案也已移除，别把旧组件或旧断言找回来。
