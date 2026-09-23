/**
 * Copy for the worktree surfaces, in the shapes its surfaces render.
 * @module @zhang-guo-wen/dsh-worktree/client/locales
 */

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
} as const

/** English copy. */
export const en: Record<keyof typeof zh, string> = {
  'seat.label': 'worktree',
  'seat.hint': 'Create an isolated Git worktree of this workspace and start this session inside it.',
  'seat.creating': 'Creating…',
  'seat.applied': 'Running in this worktree: {branch}; the choice can no longer change',
  'branch.hint': 'Local branch the new branch starts from',
  'branch.head': 'HEAD',
}

/** One key of this plugin's dictionary. */
export type WorktreeCopyKey = keyof typeof zh
