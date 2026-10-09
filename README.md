# @guowenzhang/dsh-worktree

English | [中文](<README.zh.md>)

## Why this plugin

Our project spans multiple repositories and needs parallel development. Git worktrees provide isolated workspaces so file changes from different tasks do not interfere with each other.

This plugin lets you tick `worktree` on the DeepSeek Harness (DSH) New Session screen to create an isolated workspace and start a session inside it. It can also set up submodules and nested repositories alongside the parent checkout.

In the plugin list, display names and descriptions follow the Harness language setting in English or Chinese (English is the default fallback); English names use the package name without its npm scope, Chinese names describe the purpose, and installation still uses the unchanged real package name.

## Screenshots

Select a base branch and tick `worktree` to create a workspace and open the new session.

![The worktree control on the New Session screen](<docs/images/new-session.png>)

Configure child repositories, scan depth, and storage location in Settings → Worktree. Valid changes save automatically and take effect immediately; no Save or Reset to default button is needed.

![The Worktree settings page](<docs/images/worktree-settings.png>)

## Install

```sh
npx @deepseek-ai/dsh plugin --profile web add @guowenzhang/dsh-worktree
```

Restart DSH after installation. Git must be installed and available on the host's PATH.

## Notes

- **Upgrading to 2.x**: model-facing Worktree tools have been removed. Create worktrees through the New Session control; archive notifications may clean up clean worktrees. Integrations that call the removed model tools must be updated.

- **Multi-repository support is off by default**: enable “Create child repositories” in settings and adjust the scan depth to your directory layout (default: 1 level). Submodules use the commit recorded by the parent repository in detached HEAD; independent nested repositories get new branches.
- **Uncommitted changes are not copied**: the worktree starts from a commit on the selected branch, with an automatically generated branch name.
- **Storage defaults to inside the workspace**: `<workspace>/.agents/worktree/<branch>`. Add `.agents/worktree/` to your Git ignore rules, or choose a location beside the repository or in the user home directory.
- **Archiving may clean up the worktree**: an archive notification triggers a cleanup attempt. Uncommitted changes prevent removal, and branches are kept. Stopping the host does not clean up worktrees; manually removing a workspace registration does not delete files either.
- **Check that no other session is using the directory before cleanup**: worktree removal does not check for running sessions.

See [AGENTS.md](https://github.com/zhang-guo-wen/dsh-worktree/blob/master/AGENTS.md) for other installation methods, configuration, and development details.

## License

[Apache-2.0](<LICENSE>); see also [NOTICE](<NOTICE>).
