/**
 * The comparison the backup page opens for one copy.
 *
 * The guard's own read path is what these cases exercise: the copy is located
 * under the session's directory, the target is resolved from the session's
 * working directory, and the answer says what the two sides are. The kinds that
 * are not text are not errors — a document or an oversized file is exactly the
 * kind of thing the guard protects, and the view still offers the restore.
 */

import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileGuard, NoSuchBackupError } from '../src/file-guard.ts'

/** Temporary roots created by one case, removed when it finishes. */
const roots: string[] = []

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  }
})

/** One session id used by every case; the guard keys copies by it. */
const SESSION = 'session-compare'

/**
 * Create a scratch workspace and a backup root beside it.
 * @returns the workspace, the guard root, and the guard.
 */
async function scratch(): Promise<{ workspace: string; root: string; guard: FileGuard }> {
  const base = await mkdtemp(join(tmpdir(), 'dsh-guard-compare-'))
  roots.push(base)
  const workspace = join(base, 'workspace')
  await mkdir(workspace, { recursive: true })
  const root = join(base, 'guard')
  return { workspace, root, guard: new FileGuard({ directory: root, denyDestructiveCommands: true }) }
}

/**
 * Protect one file as the guard's tool hook would, then leave the file in the
 * state the case compares against.
 * @param guard - the guard.
 * @param workspace - the session's working directory.
 * @param relative - the file's path below it.
 * @param before - the content the copy keeps.
 * @param after - the content to leave behind; undefined removes the file.
 * @returns the file's absolute path.
 */
async function protectedFile(
  guard: FileGuard,
  workspace: string,
  relative: string,
  before: string,
  after: string | undefined,
): Promise<string> {
  const file = join(workspace, relative)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, before)
  const result = await guard.protect({ session: { id: SESSION, header: { cwd: workspace } } }, file)
  expect(result.outcome).toBe('protected')
  if (after === undefined) await rm(file, { force: true })
  else await writeFile(file, after)
  return file
}

describe('comparing one protected file', () => {
  it('reports a modified text file as aligned rows and line totals', async () => {
    const { workspace, guard } = await scratch()
    await protectedFile(guard, workspace, 'src/a.ts', 'a\nb\nc\n', 'a\nB\nc\n')

    const comparison = await guard.compare(SESSION, workspace, 'src/a.ts')

    expect(comparison).toMatchObject({
      relative: 'src/a.ts',
      name: 'src/a.ts',
      path: join(workspace, 'src/a.ts'),
      state: 'modified',
      kind: 'text',
      beforeBytes: 6,
      afterBytes: 6,
    })
    expect(comparison.comparison?.rows).toEqual([
      { kind: 'context', left: { no: 1, text: 'a' }, right: { no: 1, text: 'a' } },
      { kind: 'change', left: { no: 2, text: 'b' }, right: { no: 2, text: 'B' } },
      { kind: 'context', left: { no: 3, text: 'c' }, right: { no: 3, text: 'c' } },
    ])
    expect(comparison.comparison).toMatchObject({ added: 1, deleted: 1, truncated: false })
  })

  it('compares a deleted file against nothing, so every old line is on the left', async () => {
    const { workspace, guard } = await scratch()
    await protectedFile(guard, workspace, 'docs/gone.md', 'kept\n', undefined)

    const comparison = await guard.compare(SESSION, workspace, 'docs/gone.md')

    expect(comparison).toMatchObject({ state: 'deleted', kind: 'text', afterBytes: 0 })
    expect(comparison.comparison?.rows).toEqual([
      { kind: 'change', left: { no: 1, text: 'kept' } },
    ])
  })

  it('reports a binary file with its sizes instead of reading it as text', async () => {
    const { workspace, guard } = await scratch()
    const file = join(workspace, 'photo.png')
    await writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
    await guard.protect({ session: { id: SESSION, header: { cwd: workspace } } }, file)
    await writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02, 0x03]))

    const comparison = await guard.compare(SESSION, workspace, 'photo.png')

    expect(comparison).toMatchObject({ kind: 'binary', beforeBytes: 6, afterBytes: 6 })
    expect(comparison.comparison).toBeUndefined()
  })

  it('reports invalid UTF-8 as binary rather than printing replacement characters', async () => {
    const { workspace, guard } = await scratch()
    await protectedFile(guard, workspace, 'legacy.txt', 'plain\n', undefined)
    await writeFile(join(workspace, 'legacy.txt'), Buffer.from([0xff, 0xfe, 0x00]))

    const comparison = await guard.compare(SESSION, workspace, 'legacy.txt')

    expect(comparison.kind).toBe('binary')
  })

  it('reports an oversized side instead of loading it', async () => {
    const { workspace, guard } = await scratch()
    await protectedFile(guard, workspace, 'bundle.js', 'small\n', undefined)
    await writeFile(join(workspace, 'bundle.js'), 'x'.repeat(2 * 1024 * 1024 + 1))

    const comparison = await guard.compare(SESSION, workspace, 'bundle.js')

    expect(comparison).toMatchObject({ kind: 'oversized', beforeBytes: 6 })
    expect(comparison.afterBytes).toBe(2 * 1024 * 1024 + 1)
  })

  it('reports a path that is no longer a regular file as unreadable', async () => {
    const { workspace, guard } = await scratch()
    const file = await protectedFile(guard, workspace, 'was-file.txt', 'before\n', undefined)
    await rm(file, { force: true })
    await mkdir(file)

    const comparison = await guard.compare(SESSION, workspace, 'was-file.txt')

    expect(comparison).toMatchObject({ kind: 'unreadable', state: 'modified' })
  })

  it('refuses a copy its directory does not hold, and any path that leaves it', async () => {
    const { workspace, guard } = await scratch()
    await protectedFile(guard, workspace, 'src/a.ts', 'a\n', 'b\n')

    await expect(guard.compare(SESSION, workspace, 'nope.ts')).rejects.toBeInstanceOf(NoSuchBackupError)
    await expect(guard.compare(SESSION, workspace, '../../outside')).rejects.toBeInstanceOf(NoSuchBackupError)
    await expect(guard.compare(SESSION, workspace, '/etc/passwd')).rejects.toBeInstanceOf(NoSuchBackupError)
  })

  it('keeps the copy after a comparison, so the comparison can be read again', async () => {
    const { workspace, root, guard } = await scratch()
    await protectedFile(guard, workspace, 'src/a.ts', 'a\n', 'b\n')

    await guard.compare(SESSION, workspace, 'src/a.ts')
    const again = await guard.compare(SESSION, workspace, 'src/a.ts')

    expect(again.kind).toBe('text')
    const directories = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory())
    expect(directories).toHaveLength(1)
  })
})
