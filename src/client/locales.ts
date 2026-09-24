/**
 * Copy for the worktree surfaces, in the shapes its surfaces render.
 * @module @guowenzhang/dsh-worktree/client/locales
 */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Dictionary namespace for this plugin's UI copy. */
export const NS = 'worktree'

/** Chinese copy (the package's primary locale). */
export const zh = {
  'seat.label': 'worktree',
  'seat.hint': '创建当前工作区的一个独立 Git worktree，并在其中开启这个会话。',
  'seat.creating': '创建中…',
  'seat.applied': '已在该 worktree 中运行：{branch}；这个选择不能再改',
  'branch.hint': '新分支从哪个本地分支开始',
  'branch.head': 'HEAD',
  'settings.nav': 'Worktree',
  'settings.title': 'worktree 配置',
  'settings.nested.label': '创建子仓库',
  'settings.nested.hint': '创建 worktree 时同步创建子模块和子仓库。',
  'settings.depth.label': '扫描层级',
  'settings.depth.hint': '递归扫描目录层数。',
  'settings.depth.inactive': '递归扫描目录层数（需先开启「创建子仓库」）。',
  'settings.layout.label': 'worktree 存储位置',
  'layout.path.agents': '<工作区>/.agents/worktree/<分支>',
  'layout.path.sibling': '<仓库名>-wt-<分支>，建在仓库旁边',
  'layout.path.home': '~/.agents/worktree/<分支>，整机共享',
  'option.agents': '工作区内',
  'option.sibling': '仓库同级',
  'option.home': '用户目录',
  'option.none': '只建父仓库',
  'option.submodules': '带上子模块',
  'option.all': '带上所有子仓库',
  'settings.reset': '恢复默认',
  'settings.readOnly': '本部署的设置为只读。',
  'settings.unavailable': '该插件当前未加载，暂时无法配置。',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.saveFailed': '本部署没有接受这些值，已保留供你修改。',
  'settings.invalidNumber': '请填数字；留空表示使用默认值。',
} as const

/** English copy. */
export const en: Record<keyof typeof zh, string> = {
  'seat.label': 'worktree',
  'seat.hint': 'Create an isolated Git worktree of this workspace and start this session inside it.',
  'seat.creating': 'Creating…',
  'seat.applied': 'Running in this worktree: {branch}; the choice can no longer change',
  'branch.hint': 'Local branch the new branch starts from',
  'branch.head': 'HEAD',
  'settings.nav': 'Worktree',
  'settings.title': 'Worktree settings',
  'settings.nested.label': 'Create nested repositories',
  'settings.nested.hint': 'Create submodules and nested repositories along with the worktree.',
  'settings.depth.label': 'Scan depth',
  'settings.depth.hint': 'How many directory levels are searched recursively.',
  'settings.depth.inactive': 'How many directory levels are searched recursively (turn on Create nested repositories first).',
  'settings.layout.label': 'Worktree location',
  'layout.path.agents': '<workspace>/.agents/worktree/<branch>',
  'layout.path.sibling': '<repo>-wt-<branch>, beside the repository',
  'layout.path.home': '~/.agents/worktree/<branch>, shared by the machine',
  'option.agents': 'In the workspace',
  'option.sibling': 'Beside the repository',
  'option.home': 'User directory',
  'option.none': 'Parent only',
  'option.submodules': 'With submodules',
  'option.all': 'With every nested repository',
  'settings.reset': 'Reset to default',
  'settings.readOnly': 'This deployment stores settings read-only.',
  'settings.unavailable': 'This plugin is not loaded, so it cannot be configured right now.',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.saveFailed': 'The deployment did not accept these values; they were left for you to correct.',
  'settings.invalidNumber': 'Enter a number, or leave blank to use the default.',
}

/** One key of this plugin's dictionary. */
export type WorktreeCopyKey = keyof typeof zh

/**
 * The shared settings form's frame copy, read from this plugin's dictionary.
 * @param t - this plugin's locale reader.
 * @returns the labels the settings form renders.
 */
export function formLabels(t: (key: WorktreeCopyKey) => string): SettingsFormLabels {
  return {
    unavailable: t('settings.unavailable'),
    readOnly: t('settings.readOnly'),
    saveFailed: t('settings.saveFailed'),
    save: t('settings.save'),
    saving: t('settings.saving'),
  }
}
