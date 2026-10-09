# @guowenzhang/dsh-worktree

[English](<README.md>) | 中文

## 为什么做这个插件

我们的项目由多个仓库组成，也需要并行开发，因此需要用 Git worktree 创建隔离的工作区，避免不同任务的文件改动互相干扰。

这个插件让 DeepSeek Harness（DSH）在新会话界面勾选 `worktree`，就能创建独立工作区并在其中启动会话；也支持同时创建子模块和嵌套仓库的工作区。

插件列表的显示名称与介绍支持英文和中文，随 Harness 语言设置显示，英文为默认回退；英文名称为去掉 npm scope 的原包名，中文名称说明用途，安装仍使用不变的真实包名。

## 截图

选择起始分支，勾选 `worktree` 即可创建工作区并进入新会话。

![新会话中的 worktree 控件](<docs/images/new-session.png>)

在「设置 → Worktree」中配置子仓库、扫描层级和存储位置，有效修改自动保存并立即生效，无需「保存」或「恢复默认」按钮。

![Worktree 设置页](<docs/images/worktree-settings.png>)

## 安装

```sh
npx @deepseek-ai/dsh plugin --profile web add @guowenzhang/dsh-worktree
```

安装后重启 DSH。宿主需已安装 Git，且能通过 PATH 找到它。

## 注意事项

- **升级到 2.x**：已移除面向模型的 Worktree 工具，请通过新会话控件创建；归档通知可能清理没有未提交改动的 worktree。调用旧模型工具的集成需要更新。

- **多仓库支持默认关闭**：在设置中打开「创建子仓库」，按目录结构调整扫描层级（默认 1 层）。子模块按父仓库记录的提交检出，处于 detached HEAD；独立嵌套仓库会创建新分支。
- **未提交改动不会带入新工作区**：worktree 从所选分支的提交创建，分支名自动生成。
- **默认存放在工作区内**：路径为 `<工作区>/.agents/worktree/<分支>`。建议将 `.agents/worktree/` 加入 Git 忽略规则，或选择「仓库同级」「用户目录」。
- **归档可能清理 worktree**：归档通知触发后会尝试删除对应工作区；有未提交改动时保留，分支不会删除。关闭宿主不会清理，手动移除工作区记录也不会删除文件。
- **清理前确认没有其他会话使用该目录**：删除 worktree 不检查仍在运行的会话。

更多安装方式、配置与开发说明见 [AGENTS.md](https://github.com/zhang-guo-wen/dsh-worktree/blob/master/AGENTS.md)。

## 许可

[Apache-2.0](<LICENSE>)，另见 [NOTICE](<NOTICE>)。
