---
paths:
  - "src/git-accounts/**"
  - "src/client/git-accounts/**"
  - "src/client/git-accounts-api.ts"
  - "tests/git-accounts-*.spec.*"
---

> 覆盖什么、何时读：Git 账号能力（GitHub/GitLab/Gitee 的访问令牌或 SSH 密钥登录、Windows/本机已有授权扫描、全局 Git 身份、按账号看项目）的存储、路由、扫描来源、安全不变量、页面注册与测试隔离。改 `src/git-accounts/**`、`src/client/git-accounts*` 或对应 spec 之前读。

## 能力边界（本轮刻意不做的事）

- 页面只做四件事：**账号**（添加/移除/列出）、**全局 Git 身份**（读/写 `user.name` / `user.email`）、**扫描本机已有授权并自动添加**、**按账号列出自己的项目**（搜索、翻页、复制 HTTPS 克隆地址、浏览器打开）。
- **不克隆、不建 worktree、不碰本地仓库**：项目行上的操作只有复制地址与打开网页；"克隆到本地/从项目新建 worktree"是后续范围。
- 登录方式只有两种：**访问令牌（PAT）**与**本机 SSH 私钥**。不注册 OAuth 应用、不做浏览器授权码/设备码流程；GitLab 支持自建地址（`gitlab.arcuchi.com` 这类域名），GitHub Enterprise 走 `<host>/api/v3`。
- **SSH 账号只证明"这把钥匙被这个 host 当成某个登录"**：它没有 REST API 凭据，因此**不能列项目**；项目列表只属于 token 账号。把 SSH 账号塞进项目列表、或在 projects 路由里拿它试 API 都是错的。
- 添加流程有一个独立的**「验证连接」**动作（`accounts.verify`，不写凭据），失败不挡保存：SSH 主机不可达时仍保存为**未验证**账号；token 账号的价值就是验证身份，因此网络失败仍不保存。
- 扫描的结果用**普通通知（Toast）**报告"新增了哪个账号"，不再渲染来源/note/跳过行的结果卡片。
- 机密**只进不出**：token 只存在凭据记录里，路由响应、扫描报告、日志、页面都没有 token 字段；SSH 只记录**私钥路径**，任何人都**不读私钥内容**（Host 只把路径交给 `ssh -i`），页面也不展示路径之外的内容。

## 存储：Harness 凭据缝，不另起文件

- 账号通过 `ctx.credentials`（`@deepseek-ai/dsh-credentials` 的 `CredentialProvider`）存成 **grant 记录**：`key = worktree/<provider>-<12 hex>`，payload 是本能力自己的 JSON（`version: 1` + provider/host/auth/login/verified/name/email/profileUrl/scopes/addedAt/origin，token 账号带 `token`、SSH 账号带 `keyPath`）。
- **payload 向后兼容**：`version` 仍是 1；旧记录没有 `auth` 字段，`parseStoredAccount()` 按 `token` 账号读（旧版本只会写这种），没有 `verified` 字段按已验证读。新记录才写 `auth: 'token' | 'ssh'` 与 `verified`。
- `scope` 用插件注册名 `worktree`；id 必须满足凭据缝的 `[a-z][a-z0-9-]*` 语法，`accountKey()` 在拼 key 前校验。
- **payload 跨磁盘**，所以每次读取都过 `parseStoredAccount()`：token 账号必须有非空 `token`，SSH 账号必须有非空 `keyPath`；`kind !== 'grant'`、版本不符、字段缺失或 origin 不在集合内一律当作"本能力不认识"跳过并 `warn`，不让一条坏记录拖垮整页。
- 读取只取本能力需要的四个方法（`listRecords` / `readRecord` / `modifyRecord` / `deleteRecord`），类型是 `AccountCredentialStore = Pick<CredentialProvider, …>`；**不要**把整个 provider 传进来或自己写凭据文件。
- 没有凭据服务的部署：路由照常挂载，`snapshot` 返回 503 `credentials_unavailable`，页面显示原因；不要静默隐藏入口。

## 路由 `/worktree/git/api`

- 独立于 `/worktree/api`：本路由只依赖 `webServer`（`ctx.inject(['webServer'], …)`），不要求 workspaceRegistry/agents；缺 webServer 就不挂。
- 方法：`snapshot`、`accounts.add`、`accounts.verify`、`accounts.remove`、`accounts.scan`、`ssh.keys`、`projects.list`、`identity.set`；全部 POST + JSON body，响应 `{ error: { message, code, stage } }` 里 `stage` = 方法名。`accounts.verify` 与 `accounts.add` 用同一份输入，只验证不写。
- 错误映射：`GitAccountsError.code` → `statusForAccountsError()` 一处决定（invalid_input/ssh_no_api/scan_unsupported 400、unauthorized 401、forbidden 403、not_found/account_not_found 404、rate_limited 429、credentials_unavailable 503、network/provider_unavailable 502、git_* 500）。
- body 校验留在路由：字符串/非空字符串/页码；provider 合法性、host 归一化、token 形态、auth 取值、keyPath 非空由服务再校验（`invalid_input`）。**只接受凭据 key id 与私钥路径这两个"标识"，不接受任何目录**；路由只回 summary，绝不回 token 或私钥内容。

## providers + http

- 一家 host family 一个 `ProviderSpec`：`normalizeHost` / `userRequest` / `parseProfile` / `projectsRequest` / `parseProjects`；服务层只认这个接口，不写 `if (provider === 'github')` 分支。
- 方言差异固定在三处：GitHub 用 `Authorization: Bearer` + `Link rel="next"` 翻页；GitLab 用 `PRIVATE-TOKEN` + `x-next-page`；Gitee 把 `access_token` 放 query（所以 HTTP 错误消息必须 `sanitizeRequestUrl` 去掉 query/fragment/credentials）。GitHub Enterprise 的 API 根是 `https://<host>/api/v3`，GitLab 是 `/api/v4`，Gitee 是 `/api/v5`。
- 新增平台：`types.ts` 的 `GIT_PROVIDERS`/`DEFAULT_PROVIDER_HOSTS`、`providers.ts` 的 spec、扫描的 `inferProvider`、页面品牌名与 locale 一起改；`tests/git-accounts-providers.spec.ts` 补请求构造与解析夹具。
- 翻页 `hasMore` 以 host 自己的说法为准（Link / x-next-page），拿不到时用"返回满一页"兜底；解析器对可选字段容忍 `null`，但对 page 需要的 `login` / project `fullName` / `webUrl` / `httpsUrl` 必须报 `ProviderDataError`。

## SSH 授权（`src/git-accounts/ssh.ts`）

- 验证方式是一次**非交互**的 `ssh -T git@<host>`：`BatchMode=yes`（加密私钥直接失败而不是等口令）、`IdentitiesOnly=yes`、`StrictHostKeyChecking=accept-new`，且 `UserKnownHostsFile` 指向 `mkdtemp` 出来的**临时 known_hosts**——**绝不修改操作者自己的 `~/.ssh/known_hosts` 或 config**。
- **host key 不能关校验**：用 `accept-new` + 临时文件，既不污染用户文件，也不接受已变更的 host key。
- **结论只看 banner，不看退出码**：GitHub 成功认证后仍以非零退出，因此先 `parseSshBanner()`；GitHub/GitLab/Gitee 各有一种成功措辞（Gitee 的 `Hi …` 与 GitHub 相似，必须先匹配 `GITEE.COM` 尾巴再匹配 GitHub），banner 同时给出**登录名**与**host family**。banner 认证成功但没名字 → `provider_unavailable`（不能记 login 的账号没有意义）。
- banner 的 host family **优先于调用方声明的 provider**（自建域名猜错平台时修正），这是服务层唯一一处"以远端为准"；token 账号仍按请求的 provider 走。
- 失败分类：`permission denied (publickey)` → `unauthorized`（401）；DNS/超时/拒绝 → `network`（502）；passphrase/私钥不存在/不可读 → `invalid_input`（400，文案提示 ssh-agent 或换未加密私钥）；其余 → `provider_unavailable`（502，只带 stderr 首行，**不带私钥内容**）。
- **探测预算 5 秒**：可达 host 远低于 1 秒，所以 `PROBE_BUDGET_MS = 5000`；有 443 备用端点时第一次最多 3 秒、备用端点用剩下 2 秒，整次验证仍在 5 秒内结束（HTTP 侧 `REQUEST_TIMEOUT_MS` 同为 5 秒）。别把两个端点各自 5 秒顺序试——那会让用户等 10 秒。
- **443 备用端点**：`github.com` → `ssh.github.com:443`，`gitlab.com` → `altssh.gitlab.com:443`；只在没写自定义端口、且主机正是这两个规范域名时启用，顺序是 22 再 443，失败信息列出试过的端点。自建 GitLab 与 Gitee 没有备用端点。
- **网络失败时 SSH 仍保存（未验证）**：`add` 捕获 `network` 后不再抛错，而是用密钥文件名当临时 login、`verified: false` 入库；`unauthorized`/`invalid_input`/token 网络失败仍拒绝。同一 `keyPath` 以后再添加且验证成功时，按 keyPath 找到原记录、把 login 与 verified 升级（id 不变）；已 `verified` 的账号在重连失败时保持原样，不降级。
- 添加对话框有**验证连接**按钮（Host `verifyAccount`），成功显示 host 报的 login（走 443 时显示端点），失败显示可操作原因；它只读不写，关闭对话框清空结果。
- `ssh.keys` 只列 `~/.ssh` 下 `id_*` 私钥与 config `IdentityFile` 的**路径和文件名**（最多 12 个），不读内容、不返回内容；添加对话框用它做快捷选择，同时仍允许手填路径。
- 扫描自动采纳 SSH 的条件很窄：**只有 `~/.ssh/config` 里同时有可识别 host（`inferProvider` 有结果）和显式 `IdentityFile` 的 Host 块**才成为候选（最多 6 个）。未配对的密钥只进 note，由用户手动在对话框里选择——扫描不该为一把钥匙向每个 host 开连接。
- SSH 账号的 projects 请求**在 Host 侧就拒绝**：`ssh_no_api`（400），文案让用户另加 token 账号；页面对 SSH 账号**根本不发 projects 请求**，直接显示同一句解释。

## 扫描：只读、先验证、再入库

- 来源与顺序（`SCAN_SOURCES` 五项固定顺序）：环境变量（`GH_TOKEN`/`GITHUB_TOKEN`、`GITLAB_TOKEN`/`GITLAB_PRIVATE_TOKEN`、`GITEE_TOKEN`/`GITEE_ACCESS_TOKEN`）→ `~/.git-credentials` → `gh auth token` → Windows 凭据管理器（`CredEnumerate` 只读当前用户 generic 凭据，PS 5.1 的 `Add-Type` + `advapi32`；blob 按 UTF-16LE 优先解码）→ SSH（只按上面的窄条件成为候选）。SSH 密钥仍然会有一条 `ssh-keys-found` note 说明发现了什么。
- 扫描是**发现**不是**信任**：每个 token 候选都要用对应 host 的 `/user` 验证成功才写账号；验证失败记 `unverified` + 错误码，不写。未知 host 由 `accounts.ts` 依次探测 gitlab → github → gitee（自建域名不必带产品名），已猜到的 provider 失败后仍会尝试其余 provider。SSH 候选只探测 host 一次，由 banner 定 provider。
- 去重：同 provider+host+login+**auth** 已存在时——token 账号看 token 是否相同，SSH 账号看 `keyPath` 是否相同；相同 = `duplicate`（不写），不同 = `updated`（替换该账号凭据，保留 id）。同一次扫描内 token 候选按 `${auth}|${provider}|${host}|${token}`、SSH 候选按 `${auth}|${provider}|${host}|${keyPath}` 去重。
- `scan` 的 `scan` 实现可注入（`GitAccountsServiceOptions.scan`），SSH 探测可注入（`GitAccountsServiceOptions.verifySsh`）：测试用假扫描 + 假探测，**绝不允许测试触发真实 PowerShell/gh/ssh，或读取真实 `~/.git-credentials`/`~/.ssh`**；真机验证脚本时只打印 target 名、用户名与数量，绝不打印密码/token，也不打印私钥内容。
- 扫描结果仍回 `report.sources`（五项固定顺序，含 supported/available）+ `notes` + `accounts`（刷新后的完整列表），但**页面不渲染这些明细**：扫描完成只弹一条 Toast，写明新增账号的 login（没有新增时写更新/跳过数量），不再有结果卡片；扫描失败仍保留卡片内行内错误与重试。

## Git 身份

- 读：`git config --global --get user.name/user.email`，退出码 1 = 未设置（空字符串，不算失败）；读不了全局配置或 Git 缺失 → `available: false` + `error: 'git_missing' | 'git_failed'`，表单禁用并说明。
- 写：先校验**两个字段**再写任何一个（名称 ≤200、邮箱长度/格式、禁止控制字符）；空字段 = `git config --global --unset`，**退出码 5（本来就没设置）视为成功**；写完读回返回。校验失败 → `invalid_input`（400），Git 失败 → 500。
- 测试隔离：`runGitWithExit(cwd, args, environment)` 的第三参把 `GIT_CONFIG_GLOBAL` / `HOME` / `USERPROFILE` 指向临时目录（再 `GIT_CONFIG_NOSYSTEM=1`），**任何 identity 测试都不许碰真实的 `~/.gitconfig`**。

## 浏览器页面

- 页面是**主面板**，不是设置页/侧边栏标签页：`src/client/index.ts` 同时注册 `main`（keyed，key = `git-accounts`）与 `sidebar.panellist`（`id` 必须是同一个 `git-accounts`，order 20），`GitAccountsPage` 的 props 是 `PropsRuntime<'main'> & InjectFace<GitAccountsInjected> & PropsLocale<'worktree'>`。
- **设置 → 文件备份页的第一张卡「Git 账号」是连接管理入口**（`src/client/git-accounts/SettingsGitAccountsCard.tsx`）：同一份 `GitAccountsInjected` 面从 `src/client/index.ts` 的设置注册注入（`WorktreeSettingsFace + { gitAccounts, openAccountsPage }`），卡内提供添加/扫描/移除，并复用 `AddAccountDialog` 与 `RemoveAccountDialog`；「在『Git 账号』页查看项目」必须先调设置页 owner 的 `close()` 再 `ctx.layout.selectPanel('git-accounts')`。设置页有自己的快照读取（两个面可能同时挂载），但**不新增第二种传输**、不处理 token。
- 数据全部走注入的 `snapshot/addAccount/verifyAccount/removeAccount/scan/sshKeys/projects/saveIdentity`（`src/client/git-accounts-api.ts` 构造，`createGitAccountsFace()` 每次插件激活建一个，反复注入同一对象）；**组件内不 fetch、不 import api 路由、不碰 token/私钥**。
- **账号列表的每一项都是一张独立卡片**（主面板与设置侧卡一致）：`border: 0.5px var(--dsw-alias-border-l1)` + `--dsw-radius-md` + `gap: 10px`，主面板行用 `bg-layer-2`（卡片上抬）、设置卡内行用 `bg-layer-1`（卡片内下凹），选中行只改描边为 `state-business-primary`；不要再退回"一条分隔线连排"的列表。未验证 SSH 账号额外显示 `auth.unverifiedBadge`（warning Tag，带 `account.unverifiedHint` 的 title）。
- **添加对话框的认证方式是 `SegmentedControl`**（`访问令牌` / `SSH 密钥`）：token 形态显示 token 输入与创建令牌链接；SSH 形态显示私钥路径输入 + `ssh.keys` 探测到的密钥快捷按钮 + "SSH 不能列项目、加密私钥要先加载 ssh-agent"提示。密钥列表**只在首次切到 SSH 时请求一次**（用 ref 防重，别把 loading 状态作为 effect 依赖——那会让 effect 的 cleanup 取消自己的 promise）；关闭对话框清除 token/keyPath、验证结果，并重置为 token 形态。
- **验证连接**是对话框 footer 左侧的独立按钮（`css.verifyAction`，`margin-right: auto`），不触发保存；成功文案在字段下方保持（`.verifyOk`），改动任一输入即清除。`添加`仍会验证（token 必须验证成功后入库；SSH 网络失败按上面的未验证规则入库）。
- **对话框里的字段用 `.addField`（无 flex），不要用身份卡的 `.field`**：`.field` 带 `flex: 1 1 240px`，放进纵向 flex 表单会把两行撑成全屏高度；这是真实踩过的缺陷（见 failure-modes 第 22 条）。
- 项目区选中 SSH 账号时**不请求**，显示 `gitAccounts.projects.sshUnavailable` + hint。
- 可见文案一律进 `src/client/locales.ts` 的 `zh`/`en` 字典（含 aria-label、placeholder、空态/错误态、来源与扫描 note 文案）；品牌名 GitHub/GitLab/Gitee 不翻译。
- 按 `.claude/rules/plugin-ui-standard.md`：内容列 `max-width: calc(960px + 2 * clamp(24px, 4vw, 48px))` + 同款 padding；h1 `var(--dsw-font-l-20)`；卡片 `--dsw-radius-xl` + `0.5px var(--dsw-alias-border-l1)` + `--dsw-alias-bg-layer-1`；颜色只用 `--dsw-alias-*`，控件高度只 28/32/36，焦点 `:focus-visible` 带 `--dsw-focus-ring-color` fallback，触屏 44px，`prefers-reduced-motion` 关闭动效。
- 状态语义：刷新/翻页/扫描期间保留上一次成功内容，只让局部 busy；失败保留数据 + 行内原因 + 重试；空态说明"为什么空、下一步做什么"；单项异步写（身份、添加、移除、扫描、验证连接）都要有进行中/成功/失败三种可见反馈；扫描成功只发 Toast（点名新增账号），失败仍在卡内说明。
- 主面板与设置卡都**没有**内联扫描报告组件；`ScanReportPanel.tsx` 已删除，`SOURCE_KEYS`/`NOTE_KEYS`/`OUTCOME_KEYS` 与 `scan.*`/`note.*`/`outcome.*`/`source.*` 文案一并移除；Host 的 report 字段保留（测试与未来诊断用），页面不再渲染。

## 测试与命令

- 自足 spec（`vitest.config.ts` 覆盖）：`tests/git-accounts-providers.spec.ts`、`tests/git-accounts-scan.spec.ts`、`tests/git-accounts-identity.spec.ts`、`tests/git-accounts-ssh.spec.ts`（banner 解析、路径展开、`listSshKeys`/`collectSshKeyCandidates`、5 秒预算与 22→443 端点选择、不存在私钥在 spawn 前就拒绝）、`tests/git-accounts-route.spec.ts`（真实 HTTP server + 内存凭据 provider + stub fetch + 假扫描 + 假 SSH 探测；含 `accounts.verify` 不写、SSH 网络失败未验证入库并升级、拒绝时不留账号）。
- 浏览器 spec：`tests/git-accounts-page.spec.tsx`（主面板）与 `tests/git-accounts-settings.spec.tsx`（设置页连接卡，真实设置页 + Add/Remove 对话框 + Toast + SSH 密钥选择），`// @vitest-environment jsdom` 首行，走 `vitest.harness.config.ts`。
- 本机命令（Windows/pwsh）：`$env:DSH_HARNESS_ROOT='C:\02-codespace\DeepSeek\deepseekharness'`；**pwsh 下用 `node_modules\.bin\vitest.cmd`**，无扩展名的 `.bin/vitest` 是 bash shim，在 pwsh 里静默不执行。
- 改 `src/` 之后先 `npm run build` 再跑读产物的套件；`lib/` 必须一起提交。
