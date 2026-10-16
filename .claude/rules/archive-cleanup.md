---
paths:
  - "src/archive-cleanup.ts"
  - "tests/archive-cleanup.spec.ts"
---

> 覆盖什么、何时读：归档后自动删除 checkout 的触发时机、判定链与三条不变量。改 `archive-cleanup.ts`、`removeOnSessionArchive` 或排查「归档了但目录还在 / 误删工作区」时读。
>
> 本节原属「设计约束（为什么这么做）」。

## 归档清理（`src/archive-cleanup.ts`）

**registry 自己的事件里没有"会话已归档"。** Workspace registry 只提供两处：`workspace/session-activity`（归档**准入**的 waterfall）与 `workspace/session-stop`（归档**落盘之后**发给各 provider 的通知，见 `packages/workspace/workspace/src/index.ts` 的 `archiveSession`）。后者时机正确，但 `archiveSession` **只在 `stopActivity: true` 时才 dispatch 它**。

界面两条归档路径因此行为不同：会话有活动时先归档失败 → 弹「停止并归档」→ `stopActivity: true` → 落盘 → `workspace/session-stop` → 本模块收到通知；**空闲会话（无活动、无需确认，也就是侧边栏直接归档的常见路径）走缺省归档，谁都不通知**。

**但归档这次写入本身是被广播的。** registry 的状态存在 `workspace` 存储域的全局单例里（`workspaceDomainSpec`，`name: 'workspace'`），storage-domain 对**每一次落盘成功后的全局写入**都会 `ctx.emit('domain/changed', …)`（`packages/storage/storage-domain/src/domain.ts`），harness 自己的 `workspace-controller` 就是它的消费方。于是触发有两条腿，都无需轮询：

| 触发 | 机制 | 覆盖 |
|---|---|---|
| `domain/changed` | `domain === 'workspace'` 且 `operation === 'put'` 且 `table === '' && key === ''`（全局单例）→ 下一事件循环读 `workspaceRegistry.archivedSessionIds` 对账 | **所有归档**，包括空闲归档 |
| `workspace/session-stop` | 通知到达后串行处理该 session id，重试待清理备份 | 「停止并归档」的并行取消请求，**不是回合结束通知**；FileGuard 关闭该会话的保护以阻止晚到副本 |

宿主 `storage-domain/src/domain.ts` 在 global.set 的异步操作内部发事件；`workspace/src/index.ts` 的 `setState` 要等 `await global.set` 返回后才更新 registry 内存。因此只排一个 Promise 微任务仍可能读到旧归档集合；本模块用 `setImmediate` 延迟读取，不改变归档落盘或阻塞归档。宿主 `agent/src/archive-admission.ts` 对 stop 仅调用 cancel、不等待 settlement，不能把两个监听器的先后注册当成停止完成屏障。

**领域事件的 payload 不读。** 它只当"归档集合可能变了"的触发器，权威数据仍取 `workspaceRegistry.archivedSessionIds`——这样只依赖域名单例这一件事（域名为 `'workspace'`、写入是全局 put），不依赖快照字段的结构。

**不追溯（刻意如此，也没有任何定时补扫）。** 进程启动时把当时的归档集合灌进 `handled`：那时已在集合里的归档发生在"没有宿主在看"的时候，删它等于替用户执行一次本进程没见过的归档。只有**运行期间新到**的 id 才被清理。于是：

- 历史归档的备份与 checkout 都不会被后来的宿主翻旧账；要清就用户自己删。
- **取消归档会"复位"**：id 从集合里消失时从 `handled` 与备份待重试集合里忘掉，并调用 `guard.resume(id)` 恢复保护；之后再次归档按新归档处理。

新到 id 加入 `handled` 与备份待重试集合。逐个 `guard.archive(id)`，成功才退出待重试集合；失败逐会话记日志并保留，后续 workspace 全局写入或有效 stop 事件重试，不阻断其他会话与 checkout。没有定时重试、启动补扫或跨进程失败队列。对新归档 id 仅在 `removeCheckouts` 为 true 时调用 `reconcile`；备份删除与 checkout 开关独立，checkout 检查/删除失败仍沿用保留并记录的行为。

一次 reconcile 的判定链（`reconcile` → `discard`）：

1. 读 `workspaceRegistry.archivedSessionIds`；集合为空直接返回。
2. 由 session id 定位工作区：先用 `ctx.get('sessions').get(id)?.header.cwd` 比对路径，回落到 `workspace.sessionIds` 记账。
3. **只认 `workspace.sessionIds[0]` 已在归档集合里的那次归档**：子代理（subagent / fork）与父会话同 cwd，归档子代理绝不能删掉父还在用的工作区。
4. `service.inspectLinkedCheckout(workspace.path)`：判据来自 `git worktree list` 本身，主 worktree 与"只是位于 checkout 内部"的目录都返回 `undefined`，所以仓库自身的工作树永远不是删除目标。
5. `service.remove({ cwd: repositoryRoot, path })`：脏 checkout 由服务自己的 `assertRemovable` 拒绝，本模块**不传 force**——拒绝原因写进日志，checkout 原样保留。
6. 成功后 `workspaceRegistry.delete(workspace.id)` 摘掉工作区记录。

三条不变量：**不拦截归档**（只订阅事件与读集合，失败全部降级为日志）；**不丢工作**（脏目录一律保留）；**并发串行**（两条触发腿共用同一条 promise 链，两个归档同时到达不会在一个 registry 上打架）。

`removeOnSessionArchive` 只决定 **checkout** 删不删；备份的归档清理永远安装（`installArchiveCleanup` 无条件调用）。同理 `fileGuard` 关掉时仍会构造一个 guard 对象供清理使用——只是不再注册保护与工具。
