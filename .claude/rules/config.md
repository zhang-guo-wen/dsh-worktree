---
paths:
  - "src/policy.ts"
  - "src/branch-rule.ts"
  - "src/client/settings-fields.ts"
  - "src/client/settings-store.ts"
  - "tests/settings-fields.spec.ts"
---

> 覆盖什么、何时读：配置字段的取值与默认值、volatile 与启动时字段的分界、两个开关默认值必须两处同步、设置页写入 profile 的规则与常见拒绝原因。改 schema / `policy.ts` / 设置页字段时读。

## 配置

```yaml
- id: worktree
  name: '@guowenzhang/dsh-worktree'
  config:
    # 设置页的五项（volatile：保存即时生效，不用重启）
    nestedRepositories: none        # none（默认，只建父仓库）| submodules | all —— 设置页上就是「创建子仓库」开关：开 = all，关 = none
    nestedScanDepth: 1              # 递归扫描目录层数（正整数；1 = 只看直接子目录）
    defaultPath: agents             # agents（默认，工作区内的 .agents/worktree/）| sibling（仓库同级）| home（用户目录 ~/.agents/worktree）
    fileGuard: true                 # 见 `.claude/rules/file-guard.md` 的「改动前保护」：开（默认）| 关
    denyDestructiveCommands: true   # 删除类命令是否拒掉并要求先申报目标（fileGuard 关时无效）
    # 以下只在启动时生效，改完要重启 host
    agentsDirectory: .agents/worktree   # defaultPath: agents 时的工作区子目录；缺的层级会自动创建
    gitTimeoutMs: 60000             # 单次 git 调用的上限（子模块拉网络时会用满它）
    startSessionRoute: true         # 是否挂 /worktree/api（界面建会话走它）
    removeOnSessionArchive: true    # 归档会话时是否删掉它的 linked checkout（默认开）
```

设置页放这五项；`agentsDirectory`、`gitTimeoutMs`、`startSessionRoute`、`removeOnSessionArchive` 是部署形态，留在 profile 的 patch 里。volatile 字段要求 harness 的 `schemastery` 提供 `.volatile()`（**≥ 3.18.4**）——这也是本插件 `devDependencies` 里那个版本下限的来由；更早的 harness 只支持启动时配置。

**两个开关的 schema 默认都是 `true`，而设置页渲染的是"缺省即默认"**：`src/client/settings-fields.ts` 的 `SWITCH_DEFAULT` 必须与 `policy.ts` 的 `DEFAULT_FILE_GUARD` / `DEFAULT_DENY_DESTRUCTIVE_COMMANDS` 同步。若某天只改一处，页面会把"开"画成"关"，用户就会去"修"一个本来就对的设置——这比不显示更糟。

`agentsDirectory` 必须是工作区相对目录（不能是绝对路径、不能带 `..` 段），`nestedScanDepth` 必须是正整数；两者在服务构造与服务热替换时都会校验，不合法直接抛错。

## 设置页与 profile 的关系

**设置页**（设置 → Worktree）改的就是上面「配置」里的那几个策略字段。它与 profile 的关系是：

`fileGuard` 默认开，所以默认形态就通过 `ctx.inject(['tools'], …)` 注册了 `worktree_backup`——这是插件唯一的模型工具；关掉它就没有工具。`denyDestructiveCommands` 的开关只在守卫打开时有意义。

- 保存写进 **profile 的 `cordis.patch.yml`**（UI 和你手改 YAML 改的是同一处），所以优先级、备份、版本管理都和你手工编辑完全一样；
- 这几个字段在插件里声明为 **volatile**，Host 会在文档更新后立刻把新策略装回正在运行的服务实例上——**不需要重启**；改名、路由开关这类"影响注册"的字段不在这里，它们只在启动时生效；
- 保存被拒绝时会明确说原因。最常见的一条是 **"is overridden by a home patch or command-line overlay"**：如果这个插件是被 `--patch`/home patch 覆盖层加载的，那层在 profile 之上，写 profile 会被它盖住，所以 Host 直接拒绝（这是 harness 的通用规则，不是本插件特有）。用 profile 的 bundle 正常安装就不会遇到。
