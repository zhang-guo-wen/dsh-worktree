---
paths:
  - "src/archive-cleanup.ts"
  - "tests/archive-cleanup.spec.ts"
---

> 覆盖什么、何时读：归档后自动删除 checkout 的触发时机、判定链与三条不变量。改 `archive-cleanup.ts`、`removeOnSessionArchive` 或排查「归档了但目录还在 / 误删工作区」时读。
>
> 本节原属「设计约束（为什么这么做）」。

## 归档清理（`src/archive-cleanup.ts`）

**harness 没有"会话已归档"事件。** Workspace registry 只提供两处：`workspace/session-activity`（归档**准入**的 waterfall）与 `workspace/session-stop`（归档**落盘之后**发给各 provider 的通知，见 `packages/workspace/workspace/src/index.ts` 的 `archiveSession`）。后者时机正确，但 `archiveSession` **只在 `stopActivity: true` 时才 dispatch 它**。

界面两条归档路径因此行为不同：会话有活动时先归档失败 → 弹「停止并归档」→ `stopActivity: true` → 落盘 → `workspace/session-stop` → 本模块收到通知；**空闲会话（无活动、无需确认，也就是侧边栏直接归档的常见路径）走缺省归档，只写归档集合，谁都不通知**。

所以触发有两条腿，**缺一不可**：

| 触发 | 机制 | 覆盖 |
|---|---|---|
| `workspace/session-stop` | 通知到达即处理该 session id | 「停止并归档」，立即（不等一个周期） |
| **周期对账（sweep）** | 每 `ARCHIVE_SWEEP_INTERVAL_MS`（30 s）重读 `workspaceRegistry.archivedSessionIds`，处理本进程还没处理过的 id | 空闲归档——只写集合、谁都不通知的那条路 |

**对账不追溯（刻意如此）。** 进程启动时先把当时的归档集合**同步**灌进 `handled`：那时已经在集合里的归档发生在"没有宿主在看"的时候，删它等于替用户执行一次本进程没见过的归档。只有**运行期间新到**的 id 才被清理——也正是缺通知那条路丢掉的正是这种情况。所以：

- **没有启动补扫**：历史归档的备份与 checkout 都不会被后来的宿主翻旧账；要清就由用户自己删。
- **取消归档会"复位"**：id 从集合里消失时从 `handled` 里忘掉，之后再次归档按新归档处理。

sweep 的动作：集合里的新 id 逐个 `guard.archive(id)`（备份属于发起它的会话，归档即结束），并对同一批 id 调 `reconcile`（删该次归档结束掉的 checkout）。

一次 reconcile 的判定链（`reconcile` → `discard`）：

1. 读 `workspaceRegistry.archivedSessionIds`；集合为空直接返回。
2. 由 session id 定位工作区：先用 `ctx.get('sessions').get(id)?.header.cwd` 比对路径，回落到 `workspace.sessionIds` 记账。
3. **只认 `workspace.sessionIds[0]` 已在归档集合里的那次归档**：子代理（subagent / fork）与父会话同 cwd，归档子代理绝不能删掉父还在用的工作区。
4. `service.inspectLinkedCheckout(workspace.path)`：判据来自 `git worktree list` 本身，主 worktree 与"只是位于 checkout 内部"的目录都返回 `undefined`，所以仓库自身的工作树永远不是删除目标。
5. `service.remove({ cwd: repositoryRoot, path })`：脏 checkout 由服务自己的 `assertRemovable` 拒绝，本模块**不传 force**——拒绝原因写进日志，checkout 原样保留。
6. 成功后 `workspaceRegistry.delete(workspace.id)` 摘掉工作区记录。

三条不变量：**不拦截归档**（只订阅通知与读集合，失败全部降级为日志）；**不丢工作**（脏目录一律保留）；**并发串行**（通知与 sweep 共用同一条 promise 链；`setInterval` 用 `unref()`，绝不让 sweep 拖住进程退出）。

`removeOnSessionArchive` 只决定 **checkout** 删不删；备份的归档清理永远安装（`installArchiveCleanup` 无条件调用）。同理 `fileGuard` 关掉时仍会构造一个 guard 对象供清理使用——只是不再注册保护与工具。
