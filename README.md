# @guowenzhang/dsh-worktree

English | [中文](README.zh.md)

## Background: DeepSeek Harness

DeepSeek Harness (`dsh`) is the open-source agent harness from DeepSeek AI, where nearly every capability is a plugin on [Cordis](https://github.com/cordiverse/cordis). It is in **developer preview** and iterating fast, so expect compatibility-breaking changes ([docs](https://deepseek-harness.github.io/deepseek-harness/), `0.1.7-alpha.*`); this plugin is a standalone third-party package that resolves `@deepseek-ai/*` from the running host.

## The problem this plugin solves

A session working directory is frozen when the session is created, so working in an isolated Git worktree meant building the checkout and starting a session by hand; this plugin does both from one check on the New Session screen.

## Screenshots

![The worktree capsule on the New Session screen](docs/images/new-session.png)
Ticking `worktree` at the right end of the `选择工作区 / 模式` row creates the checkout and starts the session inside it.

The task-list integration can prompt to initialize a selected non-Git workspace. After explicit confirmation, `/worktree/api/init` accepts its registered workspace ID, lists the workspace's top-level files and folders, then creates `.git` and a first commit containing the selected items and `.gitignore`. Unselected items receive root-anchored ignore rules; the task list then starts a worktree. Existing `.gitignore` rules are preserved.

![The Worktree settings page](docs/images/worktree-settings.png)
设置 → Worktree: 创建子仓库, 扫描层级, and worktree 存储位置, with 恢复默认 / 保存.

## Install

```sh
npx @deepseek-ai/dsh plugin --profile web add @guowenzhang/dsh-worktree
```

From the npm registry: <https://www.npmjs.com/package/@guowenzhang/dsh-worktree> — restart the host afterwards; local checkouts, git sources and troubleshooting are in [AGENTS.md](AGENTS.md).

## Usage

### Start a session in a new worktree

On the New Session screen, the `选择工作区 / 模式` row grows a second capsule at its right end: `⑂ <branch> ▾ │ ☐ <add-workspace icon> worktree`. The left half is the **local branch dropdown** — the local branch the new branch starts from, defaulting to the branch of the checkout the session is in, or `HEAD` when that cannot be read. The list is read only when the menu opens, sorted by most recent commit, and holds `refs/heads` only: a remote branch or a tag would make `git worktree add` enter a detached HEAD silently, so neither is offered. The interface never asks for a branch name.

Ticking the `worktree` half is the whole action, and it runs four steps in order: the checkout is created from the **main repository** with `git worktree add -b <branch> <path> <base>` (a session already inside a linked worktree still resolves back to the main repository); the new directory is registered as a workspace; the session is started with that directory as its `meta.cwd`; and the session is attached to the workspace ledger, because a session belongs to a workspace only through that ledger — without it the session renders as ungrouped and `选择工作区` has no name to display. The browser then refreshes the session catalog and switches to the session, because the Host created it outside the client's Session Controller and navigation refuses an id that has not been catalogued yet.

Ticking is **one-way**: checking creates the checkout and starts the session, and nothing checks it back off. Failures come in two kinds. **The Host refused** — the branch name is taken, the directory is not a repository — created nothing: the control returns to unchecked with the reason, and checking again retries. **Created but not switched to** — navigation failed — keeps that session on the control, so checking again opens it instead of creating a second checkout.

Every session is independent and cannot be changed afterwards: the working directory is frozen in the session header at creation, so the control appears only while the session is still blank (no turn has run). This is a design constraint, not a defect — changing the directory means starting a new session.

### When the worktree control appears

The control's state follows the session and its directory:

| State | Control | Why |
|---|---|---|
| Blank session, directory inside the main checkout | Operable | The choice is still open |
| Session already inside a linked worktree | Shown but locked (base + checked) | It is already isolated; one more choice would nest a checkout inside a checkout |
| Session has run at least one turn | Hidden | `header.cwd` is frozen, and the Host would refuse |
| Directory is not a Git repository | Hidden | There is no repository to isolate |

A locked control offers no change — both segments are disabled and the chevron is collapsed, and the tooltip names the branch the checkout actually holds. After a page refresh the memory that "this checkout was created here" is gone, so the locked control reports the checkout's own branch; that still names its origin, because the branch is `<base>-<6 digits>`.

### Choose the checkout layout

**设置 → Worktree**, titled 「worktree 配置」, explains how isolated workspaces support parallel work and checks whether the Host can run Git. If Git is missing, it prompts you to install Git, add it to the Host's PATH, and restart DSH. The three settings rows retain the usual label-left / control-right form:

- **创建子仓库** — off by default. On means the submodules a checkout records, and the repositories nested inside it, are created along with it; off means the parent repository alone.
- **扫描层级** — how many directory levels below the repository root are searched for nested repositories, defaulting to 1 (the direct children). The row is disabled until **创建子仓库** is on.
- **worktree 存储位置** — 工作区内 / 仓库同级 / 用户目录, with the directory each choice resolves to shown as that row's explanation.

The footer holds `[恢复默认] [保存]` together, and a save takes effect without restarting the host, because the new policy is installed onto the running service instance. Leaving the page drops every staged edit.

| Value | Label | Directory |
|---|---|---|
| `agents` (default) | 工作区内 | `<workspace>/.agents/worktree/<branch>`, inside the workspace tree |
| `sibling` | 仓库同级 | `<repo>-wt-<branch>`, beside the repository and outside the workspace tree |
| `home` | 用户目录 | `~/.agents/worktree/<branch>`, shared by every workspace on the machine |

### Archiving a session removes its checkout

The plugin registers **no model-facing tools**: creating, listing and removing a checkout are user actions, and the interface owns all three.

The one automatic removal is tied to the session lifecycle. Archiving a session removes the linked checkout it was created in, because the archive is what says that line of work is over. The removal runs from the Workspace registry's own archive notification, after the archive is durable; it never intercepts or blocks the archive itself.

**The archive and the removal report themselves separately.** Archiving shows the usual "Session archived" notice; the checkout cleanup follows with a notice of its own — "the worktree was deleted" or, when the removal was refused, "archived, but the worktree was kept" with the reason. The two are independent: the second one only reports an outcome the Host already recorded, so a slow, failing, or missing report never delays or breaks the archive.

- **A checkout holding uncommitted work is never removed.** The removal is refused, the checkout stays exactly where it is, and the second notice says so — archiving ends a session, it does not authorize discarding work.
- **A checkout shared by more than one session survives.** It goes only when the session that owns the workspace is archived, so archiving a subagent never deletes the workspace its parent is still working in.
- **Only a linked checkout is ever removed.** A session archived inside the repository's own working tree keeps that directory; the main worktree is never a removal target.
- **Deleting a workspace by hand reports nothing.** Removing a Workspace registration never deletes files, so that case gets no notice at all.
- **The branch survives.** Removing a checkout never removes a branch, not even the ones created for nested repositories.

Set `removeOnSessionArchive: false` on the plugin row to turn the whole behavior off and go back to manual removal.

```yaml
- id: worktree
  name: '@guowenzhang/dsh-worktree'
  config:
    removeOnSessionArchive: false
```

### Branch names

The interface never takes a branch name; the Host derives one. It is the chosen base branch name with `/` replaced by `-`, plus 6 random digits — `dev-482913` — and `worktree-<6 digits>` when the base is not a local branch (`HEAD`, a SHA, `origin/x`). The base itself is recorded nowhere, but it stays readable, because the workspace title, the checkout directory and `git branch` all carry the generated name.

## Notes and caveats

- **Cleanup follows the archive, not the end of the process.** A worktree is removed when its session is archived, not when the host stops: closing a session leaves the checkout for you to keep working in.
- **Removal does not check for live sessions.** Deleting a checkout that still has a session running in it is not blocked.
- **A 6-digit suffix can collide.** Two checkouts of one base draw from the same space, about one collision in a million; `git worktree add` then fails with its own message, and checking again retries.
- **The default location shows up in `git status`.** `agents` puts the checkout under `<workspace>/.agents/worktree/`, an untracked directory inside the main checkout. Add `.agents/worktree/` to `.gitignore` or `.git/info/exclude`, or choose 仓库同级 / 用户目录.
- **用户目录 is shared machine-wide.** `~/.agents/worktree/<branch>` belongs to no workspace: checkouts of several repositories sit side by side there, and that directory needs its own `.gitignore` entry when it lands inside a repository.
- **You cannot name the branch.** The branch is visible in the workspace title and in the checkout directory; there is no way to choose it, and no tool to pass one to.
- **Submodules are detached HEAD by design.** That is what a gitlink means, not a defect; a child repository that needs a branch is an independent nested repository.
- **Only a real `.git` directory counts as a nested repository.** A subdirectory that is itself another repository's linked worktree (`.git` is a file), or a submodule, is not mirrored onto a new branch.
- **Local-path submodules need Git's `file` transport permission.** `protocol.file.allow` is Git's own safety switch and this plugin does not override it: a repository whose `.gitmodules` points at a local path needs the permission granted in git configuration (global or repository-level), or creation fails with Git's own message and rolls back. Submodules over https/ssh are unaffected.
- **Removing a checkout never removes branches.** The branches of a worktree — including those created for nested repositories, which live in their own repositories — survive deletion, exactly like the workspace's own branch.
- **Memory is shared; files and authorizations are not.** `dsh-memory` and `dsh-claude-compat` resolve a linked worktree's `{project}` back to the main repository, so every worktree of one repository shares one memory store, while files and sandbox authorizations stay per-checkout. This is deliberate: what is isolated is files and authorizations, what is shared is knowledge and context.

## License

The plugin itself is Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

It ships no DeepSeek Harness source: the harness packages are peer dependencies resolved from the running host.

## Further reading

- [AGENTS.md](AGENTS.md) — install variants, the build, composition wiring, live-update semantics, release steps, design decisions, troubleshooting, and the test runners.
- [dsh-memory](https://github.com/zhang-guo-wen/dsh-memory) — the sibling memory plugin whose `{project}` resolution makes one repository's worktrees share one memory store.
- [DeepSeek Harness documentation](https://deepseek-harness.github.io/deepseek-harness/).
