---
paths:
  - "src/service.ts"
  - "src/repository.ts"
  - "src/porcelain.ts"
  - "src/git.ts"
  - "src/session.ts"
  - "tests/service.spec.ts"
---

> 覆盖什么、何时读：为什么 worktree 必然是一个新工作区、创建的三个动作为什么必须原子、记忆为什么不隔离。改 `service.ts` / `session.ts` / 仓库根回溯时读。
>
> 本文件与 nested-repositories / archive-cleanup / checkout-notice / file-guard 四个文件，原是 AGENTS.md 的分组标题 `## 设计约束（为什么这么做）` 下的一节，按主题拆开。

## 会变成一个新工作区——这是刻意的

Workspace 的身份判据是 **`fs.realpath` 之后的路径字符串相等**（`dsh-workspace` 的唯一 canon），会话归属又靠 `header.cwd` 的 realpath 相等。worktree 路径与主 checkout 是两个不同的 realpath，**所以它必然是一个新工作区**。

不把它硬塞进主工作区，是因为那需要把"相等"判据换成"前缀包含"，会让 `C:\repo` 和 `C:\repo-subdir` 互相污染。用带分支名的标题让并列条目可读，是这个代价的正确付法。

## 三个动作必须原子

顺序被工作区注册表强制：会话只在 `header.cwd` 的 realpath 等于工作区 path 时才归属，不一致会 fail loud。所以必须是 **checkout → 工作区记录 → 会话**，且：

- 工作区创建失败 → 删掉 checkout；
- 会话启动失败 → 删掉 checkout（工作区记录保留，可用侧边栏删除）；
- 清理也失败 → 错误里点名目录，绝不静默留下垃圾。

会话已经起来之后再挂账本（`workspace.attachSession`）失败是第四种情况：那时 checkout 与会话都活着，删 checkout 会打断刚在里面启动的会话，所以只报 `[attach]` 并**保留**两者。

## 记忆不隔离，是有意的

`dsh-memory` / `dsh-claude-compat` 会把 linked worktree 的 `{project}` **回溯到主仓库**，所以同一仓库的所有 worktree 共享一份记忆。最终形态：

| 维度 | 行为 |
|---|---|
| 工作区分组 | worktree 独立 |
| 文件与沙箱授权 | 各自独立 |
| 记忆 / `{project}` | 共享主仓库 |

**隔离的是文件和授权，共享的是知识与上下文。**
