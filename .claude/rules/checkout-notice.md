---
paths:
  - "src/route.ts"
  - "src/client/checkout-notice-store.ts"
  - "src/client/checkout-notice.tsx"
  - "tests/checkout-notice.spec.ts"
---

> 覆盖什么、何时读：归档结果怎么记（removed / kept / unknown）、浏览器侧第二条通知的判定顺序与静默条件。改 `route.ts` 的 `checkout` 探测或归档 toast 时读。
>
> 本节原属「设计约束（为什么这么做）」。

## 归档结果与第二条通知

Worktree 行消失时，浏览器看不到"目录是被删了还是被保留了"——它只看得到行。所以 Host 把结果记下来，浏览器来问：

- `rememberArchiveOutcome(path, { outcome, reason? })`：删除成功记 `removed`，被服务拒绝（脏目录、未知 checkout）记 `kept` + 拒绝原文。表是**进程内 Map**，不落盘——它服务的是紧随归档几秒后的那条 banner，丢一条最多少一次提示，绝不会给出错误提示；同一路径后来的结果直接覆盖前一条（`kept` → 后续 `removed` 也成立）。
- `POST /worktree/api/checkout { path }`（`src/route.ts`）返回 `probeArchiveOutcome(path)`：`removed` / `kept` / `unknown`。**`unknown` 是关键语义**：手动删掉一个工作区记录时目录还在、插件也没碰过它，于是它是 `unknown`，浏览器**不弹任何提示**，不会把"只是注销了工作区"说成"已删除"。

浏览器半边（`src/client/checkout-notice-store.ts` 纯逻辑 + `checkout-notice.tsx` 渲染）：

- 跟随 `ctx.get('workspaces').list`（侧边栏渲染的那份列表）。**第一帧只做基线，不报任何东西**——Client 装载时上一次页面造成的删除早已过去。
- 行消失时先判断"它的会话是否都已归档"：只有归档会结束 checkout，未归档的行是用户自己注销的，不探测、不提示。
- 探测回来 `removed` → 成功 toast（`tone: 'success'`）；`kept` → 警告 toast + 拒绝原因；`unknown` → 静默。
- 座位是 `shell.overlay`（frame 级浮动层，root scope，`ui-layout` 声明它就是给这种"toast 栈"用的），`order: 100`。**这条通知与归档 toast 完全独立**：它只读 Host 已记录的结果，不参与归档请求，所以它渲染失败、延迟、或根本没有这条座位，都不影响归档。
- 判读顺序有个坑：**归档集合必须在判断"行是不是被归档删掉的"之前用当前帧更新**。归档集合与行消失是同帧到达的，先读旧集合会把唯一要报的那种情况漏掉（`tests/checkout-notice.spec.ts` 的两个用例就是钉这条）。
- 缺 `workspaces` 服务时不装配这条通知，归档本身照常（Host 侧照样清理）。
