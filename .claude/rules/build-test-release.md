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

- host：`tsdown` 打 `src/index.ts` → `lib/index.mjs`，所有 `@deepseek-ai/*` 保持 external；行级对比用的 `diff`（jsdiff）是**生产依赖**（`package.json` 的 `dependencies`，BSD-3-Clause、零传递依赖），在 `tsdown.config.ts` 的 `deps.neverBundle` 里同样保持 external，装插件时由包管理器安装。`package-lock.json` 必须一起更新。
- client：`build-client.mjs`（rolldown）→ `lib/client.js`，包成 `window.__ModuleLoader__.load({ id, factory })`，react / `@deepseek-ai/*` external，`.module.css` 用 lightningcss 编译并内联。id 与 `HANDOFF_ID = '@guowenzhang/dsh-worktree'` 一致。
- CSS module 的类名先按字母排序再写进产物：lightningcss 的 `exports` 对象没有稳定键序，不排序的话每次构建的 `lib/client.js` 字节都不同，提交进仓库的产物会天天出假 diff。
- 开发装依赖时用 `npm install --force`：已发布的 Harness 线把 `@deepseek-ai/schemastery` 精确锁在 3.18.2，而本插件要用它的 `.volatile()`（≥ 3.18.4），peer 图会因此报 ERESOLVE。
- 本插件没有 `@Remote` 这类装饰器，所以 `tsdown.config.ts` 不需要 sibling 插件里的 `lowerDecorators` transform。

## 测试

```sh
# 从 Harness checkout 根运行
node_modules/.bin/vitest run --root dsh-worktree
```

上面这条命令跑的是 `vitest.config.ts` 的自足子集（当前排除了浏览器半边那几个 spec），Host 半边的服务、路由、策略、嵌套仓库、归档清理与文件保护 spec 都在其中，各自断言自己那块行为；**用例清单不在此复述**——它就在 `tests/*.spec.ts` 里，抄一份到这里只会随代码漂移。

浏览器半边那几个 spec（`seat` / `registration` / `navigation` / `settings` / `settings-autosave` / `settings-toast` / `backup-panel`）要 checkout 的 pnpm store 才能解析运行时依赖，走 `--config vitest.harness.config.ts` 的全量配置：

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
