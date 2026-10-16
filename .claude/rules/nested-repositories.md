---
paths:
  - "src/nested.ts"
  - "src/validate.ts"
  - "tests/nested.spec.ts"
---

> 覆盖什么、何时读：父子仓库（子模块 / 独立嵌套仓库）一起拉过去的规则与删除顺序，以及扫描层级与三种存储布局。改嵌套仓库逻辑、布局推导或 `nestedScanDepth` 时读。
>
> 「父子仓库一起拉过去」原属「设计约束（为什么这么做）」一节；「扫描与布局」原属同名 `##` 节。

## 父子仓库一起拉过去

**默认是关的**（设置页的「创建子仓库」开关，对应 `nestedRepositories: none`）：新建的 checkout 只有父仓库自己的内容。打开后才走下面两条路——因为拉子模块要联网、给独立子仓库建分支会写进父仓库不跟踪的那些仓库，两件事都不该让人事后才发现。

一个 checkout 里可能挂着两类子仓库，**Git 对它们的处理完全不同**，所以插件分两条路走：

| 子仓库类型 | `git worktree add` 单独做出来的结果 | 插件的做法 |
|---|---|---|
| **子模块**（父仓库记为 gitlink） | 目录存在但**完全是空的**（gitlink 只还原挂载点） | 在新 checkout 里跑 `git submodule update --init --recursive`，内容按父仓库记录的那个 commit 落位 |
| **独立嵌套仓库**（父仓库只 ignore 它） | **根本不存在**（父仓库不跟踪它），只有原 checkout 知道它在哪 | 在原路径的对应位置给它开一个 linked worktree，并按父仓库同样的规则**建一条新分支**（`<它当前分支>-<6 位随机数字>`） |

三个关键事实（都是实测出来的，不是推断）：

1. **不会污染原 checkout 的子模块**。linked worktree 里的子模块有**自己独立的 git dir**（`<主仓库>/.git/worktrees/<wt>/modules/<name>`），和主 checkout 的 `<主仓库>/.git/modules/<name>` 是两份。所以在工作区里改子模块，原来的 checkout 一点不动。
2. **子模块是 detached HEAD**：gitlink 的语义就是钉在某个 commit 上，不是分支。想要分支就把它当独立嵌套仓库（`nestedRepositories: all` 也只对"自己带 `.git` 目录"的仓库建分支，子模块不算）。
3. **删除必须子仓库先行**。新的 checkout 里那些子仓库的目录是**别的仓库的 worktree**：先删父目录，它们各自仓库里就会留下一条"路径已不存在"的记录。所以 `remove()` 先按深度倒序删掉嵌套 checkout，再删父 checkout；**任何一步发现未提交的改动都会在动手之前拒绝**（删父之前也会先查父自己的改动，且不把即将被删掉的子仓库目录算作父的脏)。
4. **一个独立嵌套仓库带不过来，不牵连整条创建**。没有 commit（unborn HEAD，拿不到可作起点的 `HEAD`）或 Git 拒绝 checkout 的仓库会被**跳过**，连同原因（`no-commits` / `create-failed`）记进 `CreatedWorktree.nestedSkipped`，界面在 worktree 胶囊上用警告图标与悬停文案点出；父 checkout 与其余子仓库照常到位。只有**子模块**拉不下来才整体回滚——那是父仓库自己记录的树不完整，和"某个无关仓库没有提交"不是一回事。

## 扫描与布局

扫描规则（开关打开时）：从**仓库根**开始按 `nestedScanDepth`（默认 **1 层**，即只看直接子目录）找带 `.git` **目录**的子目录——带 `.git` 文件的是子模块或别的仓库的 worktree，都不在这里处理；`.git` 与 `node_modules` 不进入；嵌套里的嵌套也会被找到（层数够的话），且**父先子后**创建（子的目录在父里面）。

存储位置（`defaultPath`，设置页三选一）：

| 值 | 界面 | 目录 |
|---|---|---|
| `agents`（默认） | 工作区内 | `<工作区>/.agents/worktree/<分支>`，出现在工作区树里 |
| `sibling` | 仓库同级 | `<仓库名>-wt-<分支>`，建在仓库旁边，不进工作区树 |
| `home` | 用户目录 | `~/.agents/worktree/<分支>`，整台机器共用一个位置 |

`agents` 那一档的子目录由 `agentsDirectory` 决定（默认 `.agents/worktree`），**缺的每一级都会自动创建**；`sibling` / `home` 是绝对路径推导，不读它。分支名进目录前会把 `/` 换成 `-`。
