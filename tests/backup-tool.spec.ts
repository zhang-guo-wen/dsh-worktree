/**
 * What one `worktree_backup` call tells the model.
 *
 * The result is the only record a later turn reads: the copies live under the
 * user's home, and nothing else — no index, no listing tool — maps a file to its
 * copy. So a result that reports "protected" without the copy's absolute path
 * leaves the caller unable to restore anything, which is the failure these cases
 * exist for.
 *
 * Both halves are pinned: the group sentences say what happened to every
 * declared path, and the copy addresses name files that really are on disk with
 * the bytes from before the change.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defineBackupTool, describeBackup } from '../src/backup-tool.ts'
import { FileGuard } from '../src/file-guard.ts'

/** Temporary roots created by one case, removed when it finishes. */
const roots: string[] = []

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  }
})

/**
 * Create a scratch workspace and a backup root beside it.
 * @returns the workspace path, the backup root, and the guard behind the tool.
 */
async function scratch(): Promise<{ workspace: string; root: string; guard: FileGuard }> {
  const base = await mkdtemp(join(tmpdir(), 'dsh-backup-tool-'))
  roots.push(base)
  const workspace = join(base, 'workspace')
  await mkdir(workspace, { recursive: true })
  const root = join(base, 'guard')
  return { workspace, root, guard: new FileGuard({ directory: root, denyDestructiveCommands: true }) }
}

/** The agent fields the guard reads: a session id and its working directory. */
function agent(workspace: string, session = 'session-1') {
  return { session: { id: session, header: { cwd: workspace } } }
}

/**
 * The directory holding one session's copies.
 * @param root - the backup root.
 * @returns the absolute session directory, which is the only one present.
 */
async function sessionDirectory(root: string): Promise<string> {
  const entries = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory())
  expect(entries).toHaveLength(1)
  return join(root, entries[0]!.name)
}

/** One call's arguments, as the model sends them. */
function callArgs(...files: string[]) {
  return { file_paths: files }
}

describe('the account of one call', () => {
  it('states every group even when nothing was copied', () => {
    // The empty groups are what stop "protected 0 file(s)" from reading as
    // "everything was protected"; with no copy there is also nothing to restore.
    expect(describeBackup({
      protected: [], alreadyProtected: [], absent: ['gone.txt'], notAFile: ['src'], copies: [],
    })).toBe('protected 0 file(s) before change; 1 do not exist (nothing to protect): gone.txt'
      + '; 1 are not regular files and were NOT protected: src')
  })

  it('names each copy beside the file it restores', () => {
    expect(describeBackup({
      protected: ['a.ts'], alreadyProtected: ['b.ts'], absent: [], notAFile: [],
      copies: [{ path: 'a.ts', backup: 'guard/key/a.ts' }, { path: 'b.ts', backup: 'guard/key/b.ts' }],
    })).toBe('protected 1 file(s) before change; 1 were already protected this session'
      + '; restore by copying each backup back over its file: a.ts (backup: guard/key/a.ts)'
      + '; b.ts (backup: guard/key/b.ts)')
  })
})

describe('the tool result', () => {
  it('names a copy that exists and holds the bytes from before the change', async () => {
    const { workspace, root, guard } = await scratch()
    const file = join(workspace, 'notes.txt')
    await writeFile(file, 'original')
    const definition = defineBackupTool(guard)
    const args = callArgs(file)

    const value = await definition.execute(args, { agent: agent(workspace) } as never)
    const backup = join(await sessionDirectory(root), 'notes.txt')

    expect(definition.output.render(args, value)).toMatchObject([
      { type: 'text', text: expect.stringContaining(`${file} (backup: ${backup})`) },
    ])
    expect(await readFile(backup, 'utf8')).toBe('original')
  })

  it('keeps naming the first copy when the file is declared again', async () => {
    const { workspace, root, guard } = await scratch()
    const file = join(workspace, 'notes.txt')
    await writeFile(file, 'original')
    const definition = defineBackupTool(guard)
    const args = callArgs(file)
    await definition.execute(args, { agent: agent(workspace) } as never)
    const backup = join(await sessionDirectory(root), 'notes.txt')
    // The file has changed by the time it is declared again; the copy that the
    // result names must still be the one from before the first change.
    await writeFile(file, 'changed')

    const value = await definition.execute(args, { agent: agent(workspace) } as never)

    expect(definition.output.render(args, value)).toMatchObject([
      { type: 'text', text: expect.stringContaining('1 were already protected this session') },
    ])
    expect(definition.output.render(args, value)).toMatchObject([
      { type: 'text', text: expect.stringContaining(`(backup: ${backup})`) },
    ])
    expect(await readFile(backup, 'utf8')).toBe('original')
  })

  it('reports a file that does not exist without inventing a copy for it', async () => {
    const { workspace, guard } = await scratch()
    const definition = defineBackupTool(guard)
    const args = callArgs(join(workspace, 'fresh.txt'))

    const value = await definition.execute(args, { agent: agent(workspace) } as never)

    expect(definition.output.render(args, value)).toMatchObject([
      { type: 'text', text: expect.stringContaining('1 do not exist (nothing to protect)') },
    ])
    expect(definition.output.render(args, value)).toMatchObject([
      { type: 'text', text: expect.not.stringContaining('restore by copying') },
    ])
  })

  it('names the copy for a file outside the working directory too', async () => {
    const { workspace, guard } = await scratch()
    const outside = join(workspace, '..', 'elsewhere', 'shared.txt')
    await mkdir(join(workspace, '..', 'elsewhere'), { recursive: true })
    await writeFile(outside, 'elsewhere')
    const definition = defineBackupTool(guard)
    const args = callArgs(outside)

    const value = await definition.execute(args, { agent: agent(workspace) } as never)
    const rendered = definition.output.render(args, value)
    const text = rendered.flatMap(block => 'text' in block ? [block.text] : []).join('')
    // The address is read back out of the model-facing text and used as given:
    // a path the text states and the disk does not have would be worse than none.
    const start = text.indexOf('(backup: ')
    expect(start).toBeGreaterThan(-1)
    const backup = text.slice(start + '(backup: '.length, text.indexOf(')', start))

    expect(await readFile(backup, 'utf8')).toBe('elsewhere')
  })
})
