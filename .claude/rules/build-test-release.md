---
paths:
  - "package.json"
  - "build-client.mjs"
  - "tsdown.config.ts"
  - "typecheck-harness.mjs"
  - "tsconfig.json"
  - "tsconfig.harness.json"
  - "vitest.config.ts"
  - "vitest.harness.config.ts"
  - "tests/**"
  - "README.md"
  - "README.zh.md"
  - "docs/**"
---

> 覆盖什么、何时读：安装变体、构建流水线与两条测试命令、typecheck 的双 Program 机制、发版与打 tag 步骤。准备构建 / 跑测试 / 发版 / 改安装文档时读。

## 安装

四个变体，全部走官方命令；它把参数转发给 profile 目录里的 pnpm，**并自行维护 profile 清单**（依赖与 `dsh.profile.bundles` 一起加，不要手写）：

```sh
# npm 官方源
npx @deepseek-ai/dsh plugin --profile web add @guowenzhang/dsh-worktree

# HTTPS
npx @deepseek-ai/dsh plugin --profile web add https://github.com/zhang-guo-wen/dsh-worktree.git

# SSH
npx @deepseek-ai/dsh plugin --profile web add git+ssh://git@github.com/zhang-guo-wen/dsh-worktree.git

# 锁定发布 tag，默认分支上后续的临时提交不会被拉到
npx @deepseek-ai/dsh plugin --profile web add "git+ssh://git@github.com/zhang-guo-wen/dsh-worktree.git#v1.0.0"

# 本地目录开发安装，pnpm 建 symlink，重建 lib/ 后重启即生效，无需重装
npx @deepseek-ai/dsh plugin --profile web add C:/path/to/dsh-worktree

# 卸载：依赖条目与 bundle 层一起移除
npx @deepseek-ai/dsh plugin --profile web remove @guowenzhang/dsh-worktree
```

`lib/` 已提交进仓库，所以从 git 装完即可运行，**使用者不需要构建**。装完要重启宿主（见 `.claude/rules/architecture.md` 的「部署与生效语义」）。

也可以不动 profile 清单，手工在 profile 的 `cordis.patch.yml` 里插入同一段 `- insert:`（见 `.claude/rules/architecture.md` 的「组合接线」）——但那样 profile 的 `dependencies` 与 `dsh.profile.bundles` 要你自己维护。

## 构建

```sh
npm install --force
npm run build     # tsdown（host → lib/index.mjs）+ node build-client.mjs（lib/client.js）
```

- host：`tsdown` 打 `src/index.ts` → `lib/index.mjs`，所有 `@deepseek-ai/*` 保持 external。
- client：`build-client.mjs`（rolldown）→ `lib/client.js`，包成 `window.__ModuleLoader__.load({ id, factory })`，react / `@deepseek-ai/*` external，`.module.css` 用 lightningcss 编译并内联。id 与 `HANDOFF_ID = '@guowenzhang/dsh-worktree'` 一致。
- CSS module 的类名先按字母排序再写进产物：lightningcss 的 `exports` 对象没有稳定键序，不排序的话每次构建的 `lib/client.js` 字节都不同，提交进仓库的产物会天天出假 diff。
- 开发装依赖时用 `npm install --force`：已发布的 Harness 线把 `@deepseek-ai/schemastery` 精确锁在 3.18.2，而本插件要用它的 `.volatile()`（≥ 3.18.4），peer 图会因此报 ERESOLVE。
- 本插件没有 `@Remote` 这类装饰器，所以 `tsdown.config.ts` 不需要 sibling 插件里的 `lowerDecorators` transform。

## 测试

```sh
# 从 Harness checkout 根运行
node_modules/.bin/vitest run --root dsh-worktree
```

用例覆盖：porcelain 两种分隔格式与 prunable/locked 元数据、分支列表解析、仓库根回溯（linked worktree / submodule 区分）、分支与路径校验、三种存储布局（工作区内 / 仓库同级 / 用户目录）与 `agentsDirectory` 校验、真实 git 上的创建/列举/删除/脏目录/主 checkout 拒绝/从 linked worktree 内再创建/按指定 base 分支新建、**linked checkout 探测（linked / 主 worktree / checkout 内部目录三种答案）**、**子模块与独立嵌套仓库的创建与删除（开关默认关、含扫描深度、跳过一个建不了分支的嵌套仓库并把它记进 `nestedSkipped`、带子模块 checkout 的拒绝语义、原 checkout 子模块状态不受影响）**、**归档清理（删 checkout 与工作区记录、未归档不动、非 linked 不动、脏目录保留、子代理归档不误删父工作区、同一条通知同时删掉该会话的文件备份）与归档结果记录（removed / kept + 原因 / unknown、同路径后一次覆盖前一次的真实原因）**、**第二条通知的判定（基線不报、已归档的行消失才探测、removed/kept 各出一条、unknown 静默、未归档不探测、dispose 后丢弃迟到答案）**、**服务策略热替换**、**设置页的注册门控/字段投影/保存与清理**、**文件保护（首次复制且第二次不覆盖、相对路径解析、二进制逐字节相同、工作区外仍可保护、不存在的文件不保护、AI 新建的文件在本会话不保护而在新会话保护、目录不复制、删除命令被拒且点名工具、引号内不误伤、策略关闭时不拦、复制先于委派调用落盘、无文件参数不触发、按会话删除备份且不影响别的会话、重复删除返回 false、重新创建的同 id 会话会再复制一次、dispose 后不再监听）**、**设置页字段取值转换（缺省即 schema 默认而非 false、开关写布尔值、非法文本被拒、其它字段仍严格）**、路由的原子性与回滚、`branches` 方法、浏览器侧分支规则与路由客户端、座位的基础分支与分支列表、控件"先拉会话目录、再导航"的次序（含导航被拒后的报错）、**草稿迁移（多行文字 + 引用芯片 + 附件一起搬、创建期间继续输入取最新一版、导航被拒时两侧都回滚且原草稿保留后重试只建一次、目标已有草稿就拒绝、Host 拒绝创建时不动草稿、创建期间切走会话就不再搬别人的草稿）**。

浏览器半边那四个 spec（`seat` / `registration` / `navigation` / `settings`）要 checkout 的 pnpm store 才能解析运行时依赖，走 `--config vitest.harness.config.ts` 的全量配置：

```sh
node_modules/.bin/vitest run --root dsh-worktree --config vitest.harness.config.ts
```

`npm run typecheck` 通过 `typecheck-harness.mjs` 将 Host 与 Client 分为两个严格检查的 Program，并沿用同一 Harness checkout 的分面 project references；同时分别检查宿主 aggregate，不把 vendor 或两侧同名服务合并压平到插件 Program。`tsconfig.harness.json` 仅提供插件的严格编译选项与源码清单，不直接以它运行 tsc。宿主需已有同一 checkout 的项目产物及生成 Remote 合约；准备方式见宿主开发指南，可用 `DSH_HARNESS_ROOT` 指定 checkout。

```sh
npm run typecheck
```

## 发版（Release）

`lib/` 是提交进仓库的，所以**发版 = 改版本号 + 构建 + 提交产物 + 打 tag**。别人按 tag 安装，`master` 上的临时提交不会被他们拿到。

1. 改根 `package.json` 的 `version`。
2. `npm run build`，确认 `lib/index.mjs` 与 `lib/client.js` 是最新。
3. 提交源码与 `lib/`（不要把 `lib/` 落在外面的工作区）。
4. 打带注释的 tag 并推送：

   ```sh
   git tag -a v<version> -m "dsh-worktree <version>"
   git push dsh-worktree master --follow-tags
   ```

5. 验证安装（仓库根即包，不再需要 `path:` 参数）：

   ```sh
   dsh plugin --profile web add \
     "git+ssh://git@github.com/zhang-guo-wen/dsh-worktree.git#v<version>"
   ```
