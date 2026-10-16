/**
 * The model-facing declaration tool: `worktree_backup`.
 *
 * It exists for the changes no argument names — a command the model is about to
 * run, a script's side effects, a rename, and anything outside the working
 * directory, including other drives. The model declares what it is about to
 * touch, and the guard copies those files aside.
 *
 * Every copy's absolute path is part of the answer. The copy is only useful to
 * a caller that can name it, and the caller here is a later turn — often a
 * different model run — that has no other way to learn where the bytes went:
 * the result is the only record it reads.
 *
 * This lives apart from the guard itself on purpose. Defining a tool requires
 * `defineTool`, which carries a runtime dependency on the tool registry and, in
 * turn, on the services the registry resolves at import time. The guard needs no
 * such dependency to copy a file, so keeping the definition in its own module is
 * what lets the guard be exercised without a composed Host.
 *
 * @module @guowenzhang/dsh-worktree/backup-tool
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { BACKUP_TOOL_NAME, type FileGuard } from './file-guard.ts'

/** One declared file and the copy that restores it. */
export interface BackupCopy {
  /** The file as the caller declared it. */
  readonly path: string
  /** Absolute path of the copy; copying it back over {@link path} restores the file. */
  readonly backup: string
}

/** The outcome groups the tool reports, in a stable order. */
export interface BackupOutcomes {
  /** Copied out by this call. */
  readonly protected: readonly string[]
  /** Already copied earlier in this session; the first copy stands. */
  readonly alreadyProtected: readonly string[]
  /** Do not exist, so there is no prior state to keep. */
  readonly absent: readonly string[]
  /** Not regular files, so nothing was copied. */
  readonly notAFile: readonly string[]
  /**
   * Every declared file that has a copy, with the address to restore from.
   *
   * Both `protected` and `already-protected` files appear here, because both
   * have a usable copy on disk.
   */
  readonly copies: readonly BackupCopy[]
}

/**
 * The model-facing account of one call.
 *
 * Every group is stated even when empty, so a missing group can never be read as
 * "everything was protected" — the failure mode in which an incomplete backup
 * looks complete. The copies come last and carry their absolute paths: a result
 * that says a file was protected without saying where the copy is leaves the
 * caller unable to use it.
 * @param outcomes - the per-group paths from one call.
 * @returns one sentence per group, in a fixed order.
 */
export function describeBackup(outcomes: BackupOutcomes): string {
  const parts = [`protected ${outcomes.protected.length} file(s) before change`]
  if (outcomes.alreadyProtected.length > 0) {
    parts.push(`${outcomes.alreadyProtected.length} were already protected this session`)
  }
  if (outcomes.absent.length > 0) {
    parts.push(`${outcomes.absent.length} do not exist (nothing to protect): ${outcomes.absent.join(', ')}`)
  }
  if (outcomes.notAFile.length > 0) {
    parts.push(`${outcomes.notAFile.length} are not regular files and were NOT protected: ${outcomes.notAFile.join(', ')}`)
  }
  if (outcomes.copies.length > 0) {
    const pairs = outcomes.copies.map(copy => `${copy.path} (backup: ${copy.backup})`).join('; ')
    parts.push(`restore by copying each backup back over its file: ${pairs}`)
  }
  return parts.join('; ')
}

/**
 * Build the registry-ready declaration tool.
 * @param guard - the guard that performs the copies.
 * @returns the tool definition for `ctx.tools.register`.
 */
export function defineBackupTool(guard: FileGuard) {
  return defineTool({
    name: BACKUP_TOOL_NAME,
    description: 'Copy files aside before changing or deleting them, so the change can be undone. '
      + 'Call this before writing any file, and before running any command that rewrites or deletes files '
      + 'the current task did not create. It works for any path, including files outside the working '
      + 'directory. Files that already exist are copied; a file created later needs no copy, and a file '
      + 'already copied this session is not copied twice. Every copy is reported by its absolute path: '
      + 'restore a file by copying that backup back over it, and declaring an already-copied file again '
      + 'reports the address of the first copy.',
    parameters: {
      file_paths: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'Files to protect, absolute or relative to the working directory. '
          + 'Provide `file_paths` before any other argument.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          protected: {
            type: 'array', items: { type: 'string' }, required: true,
            description: 'Copied out of the working set by this call.',
          },
          alreadyProtected: {
            type: 'array', items: { type: 'string' }, required: true,
            description: 'Already copied earlier in this session.',
          },
          absent: {
            type: 'array', items: { type: 'string' }, required: true,
            description: 'Do not exist, so there is no prior state to keep.',
          },
          notAFile: {
            type: 'array', items: { type: 'string' }, required: true,
            description: 'Not regular files and therefore not protected.',
          },
          copies: {
            type: 'array', required: true,
            description: 'Every declared file that has a copy on disk, with the path to restore from.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: {
                  type: 'string', required: true,
                  description: 'The file as declared.',
                },
                backup: {
                  type: 'string', required: true,
                  description: 'Absolute path of the copy; copy it back over `path` to restore that file.',
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: describeBackup(value) }],
    },
    async execute(args, exec) {
      const results = await guard.protectAll(exec.agent, args.file_paths)
      return {
        protected: results.filter(result => result.outcome === 'protected').map(result => result.path),
        alreadyProtected: results.filter(result => result.outcome === 'already-protected').map(result => result.path),
        absent: results.filter(result => result.outcome === 'absent').map(result => result.path),
        notAFile: results.filter(result => result.outcome === 'not-a-file').map(result => result.path),
        copies: results.flatMap(result => result.backup === undefined
          ? []
          : [{ path: result.path, backup: result.backup }]),
      }
    },
  })
}
