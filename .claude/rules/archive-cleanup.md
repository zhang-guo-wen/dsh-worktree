---
paths:
  - "src/archive-cleanup.ts"
  - "tests/archive-cleanup.spec.ts"
---

> 覆盖什么、何时读：归档后自动删除 checkout 的触发时机、判定链与三条不变量。改 `archive-cleanup.ts`、`removeOnSessionArchive` 或排查「归档了但目录还在 / 误删工作区」时读。
>
> 本节原属「设计约束（为什么这么做）」。

## 归档清理（`src/archive-cleanup.ts`）

**harness 没有"会话已归档"事件。** Workspace registry 只提供两处：`workspace/session-activity`（归档**准入**的 waterfall）与 `workspace/session-stop`（归档**落盘之后**发给各 provider 的通知，见 `packages/workspace/workspace/src/index.ts` 的 `archiveSession`）。后者正是本插件要的时机，但 `archiveSession` 只在 `stopActivity: true` 时才 dispatch 它。

触发流程：界面先以 `stopActivity` 缺省值归档 → 会话有活动时 registry 抛 `workspace/session-active`，弹「停止并归档」→ 用户确认后 `stopActivity: true` → 归档落盘 → `workspace/session-stop` → 本模块删 checkout。空闲会话（无活动、无需确认）走缺省归档路径，**不会有这个通知**：该 checkout 留到下一次归档触发时被顺带清掉（`reconcile` 只处理被通知到的那批 session id），或由用户按旧方式手动删除。

一次 reconcile 的判定链（`reconcile` → `discard`）：

1. 读 `workspaceRegistry.archivedSessionIds`；集合为空直接返回。
2. 由 session id 定位工作区：先用 `ctx.get('sessions').get(id)?.header.cwd` 比对路径，回落到 `workspace.sessionIds` 记账。
3. **只认 `workspace.sessionIds[0]` 已在归档集合里的那次归档**：子代理（subagent / fork）与父会话同 cwd，归档子代理绝不能删掉父还在用的工作区。
4. `service.inspectLinkedCheckout(workspace.path)`：判据来自 `git worktree list` 本身，主 worktree 与"只是位于 checkout 内部"的目录都返回 `undefined`，所以仓库自身的工作树永远不是删除目标。
5. `service.remove({ cwd: repositoryRoot, path })`：脏 checkout 由服务自己的 `assertRemovable` 拒绝，本模块**不传 force**——拒绝原因写进日志，checkout 原样保留。
6. 成功后 `workspaceRegistry.delete(workspace.id)` 摘掉工作区记录。

三条不变量：**不拦截归档**（只订阅通知，失败全部降级为日志）；**不丢工作**（脏目录一律保留）；**并发串行**（多个归档同时到达时由模块内的 promise 链排队）。
