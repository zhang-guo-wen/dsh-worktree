/**
 * Pre-change file protection, and the list and restore built on it.
 *
 * The guard is driven through its public entry points — the tool hook that must
 * land a copy before the write, the model-facing declaration tool, and the two
 * the file-backup page calls — because those are the moments a change is
 * announced or undone. The payload fields read are the harness's own
 * (`arguments.file_path`, `agent.session.header.cwd`, `agent.session.id`), so
 * the fixtures mirror those and nothing else.
 *
 * The invariant these cases exist for: **the first copy is authoritative**. A
 * second call for the same file must never replace it, or the backup would hold
 * the already-damaged version.
 */

import { Context } from '@deepseek-ai/cordis'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileGuard, installFileGuard } from '../src/file-guard.ts'

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
 * @returns the workspace path, the backup root, and guard options.
 */
async function scratch(): Promise<{ workspace: string; root: string; guard: FileGuard }> {
  const base = await mkdtemp(join(tmpdir(), 'dsh-guard-'))
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

/** One `tools/pre-execute` payload naming a file. */
function writeCall(workspace: string, file: string, tool = 'write', session = 'session-1') {
  return { name: tool, arguments: { file_path: file, content: 'next' }, agent: agent(workspace, session) }
}

/**
 * The directory holding one session's copies.
 *
 * The name is a hash of the session id, which the spec suite must not
 * reimplement — so it is located the way a user would, by looking for the
 * session's keyed directory under the root.
 * @param root - the backup root.
 * @returns the absolute session directory.
 */
async function sessionDirectory(root: string): Promise<string> {
  const entries = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory())
  expect(entries).toHaveLength(1)
  return join(root, entries[0]!.name)
}

describe('protecting a file before it changes', () => {
  it('copies the file as it was, and never replaces that copy', async () => {
    const { workspace, root, guard } = await scratch()
    const file = join(workspace, 'notes.txt')
    await writeFile(file, 'original')

    const first = await guard.protect(agent(workspace), file)
    await writeFile(file, 'replaced')
    const second = await guard.protect(agent(workspace), file)
    await writeFile(file, 'ruined')

    expect(first.outcome).toBe('protected')
    expect(second.outcome).toBe('already-protected')
    const directory = await sessionDirectory(root)
    expect(await readFile(join(directory, 'notes.txt'), 'utf8')).toBe('original')
    // Both results name the copy: the first because it just took it, the second
    // because that same copy is what a restore still has to use.
    expect(first.backup).toBe(join(directory, 'notes.txt'))
    expect(second.backup).toBe(first.backup)
  })

  it('reports an address that restores the file, so a caller can undo the change', async () => {
    const { workspace, guard } = await scratch()
    const file = join(workspace, 'report.md')
    await writeFile(file, 'the version worth keeping')

    const result = await guard.protect(agent(workspace), file)
    await writeFile(file, 'ruined by the change the copy preceded')

    if (result.backup === undefined) throw new Error('a protected file must report its copy')
    await copyFile(result.backup, file)

    expect(await readFile(file, 'utf8')).toBe('the version worth keeping')
  })

  it('resolves a path relative to the session working directory', async () => {
    const { workspace, root, guard } = await scratch()
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'a.ts'), 'export {}')

    const result = await guard.protect(agent(workspace), join('src', 'a.ts'))

    expect(result.outcome).toBe('protected')
    const directory = await sessionDirectory(root)
    expect(await readFile(join(directory, 'src', 'a.ts'), 'utf8')).toBe('export {}')
  })

  it('copies bytes verbatim, so a binary document survives intact', async () => {
    const { workspace, root, guard } = await scratch()
    const bytes = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from(Array.from({ length: 2048 }, (_, index) => (index * 37) % 256)),
    ])
    const document = join(workspace, 'report.docx')
    await writeFile(document, bytes)

    const result = await guard.protect(agent(workspace), document)

    expect(result.outcome).toBe('protected')
    const directory = await sessionDirectory(root)
    expect(Buffer.compare(bytes, await readFile(join(directory, 'report.docx')))).toBe(0)
  })

  it('protects a path outside the working directory, keeping its location readable', async () => {
    const { workspace, root, guard } = await scratch()
    const outside = join(root, '..', 'other-drive', 'shared.txt')
    await mkdir(join(root, '..', 'other-drive'), { recursive: true })
    await writeFile(outside, 'elsewhere')

    const result = await guard.protect(agent(workspace), outside)

    expect(result.outcome).toBe('protected')
    const directory = await sessionDirectory(root)
    const copied = await readdir(join(directory, 'external'), { recursive: true })
    expect(copied.some(entry => entry.endsWith('shared.txt'))).toBe(true)
    // A file outside the workspace is the case the model has to declare, so its
    // reported address is the only way back to the copy.
    expect(await readFile(result.backup!, 'utf8')).toBe('elsewhere')
  })

  it('keeps nothing for a file that does not exist yet', async () => {
    const { workspace, root, guard } = await scratch()

    const result = await guard.protect(agent(workspace), join(workspace, 'fresh.txt'))

    expect(result.outcome).toBe('absent')
    expect(result.backup).toBeUndefined()
    expect(existsSync(root)).toBe(false)
  })

  it('does not protect a file this session created, but does in a later session', async () => {
    const { workspace, root, guard } = await scratch()
    const file = join(workspace, 'generated.py')

    // The creating session: the file appears, then is edited again.
    expect((await guard.protect(agent(workspace), file)).outcome).toBe('absent')
    await writeFile(file, 'print("hello")\n')
    expect((await guard.protect(agent(workspace), file)).outcome).toBe('absent')

    // A later session: the file now pre-exists, so its first change is protected.
    const next = new FileGuard({ directory: root, denyDestructiveCommands: true })
    const result = await next.protect(agent(workspace, 'session-2'), file)

    expect(result.outcome).toBe('protected')
    // The creating session copied nothing, so it left no directory behind; the
    // later session's directory holds the state from before its first change.
    const entries = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory())
    expect(entries).toHaveLength(1)
    expect(await readFile(join(root, entries[0]!.name, 'generated.py'), 'utf8')).toBe('print("hello")\n')
  })

  it('reports a directory rather than copying it', async () => {
    const { workspace, guard } = await scratch()
    await mkdir(join(workspace, 'src'), { recursive: true })

    const result = await guard.protect(agent(workspace), join(workspace, 'src'))

    expect(result.outcome).toBe('not-a-file')
    expect(result.backup).toBeUndefined()
  })
})

describe('listing and restoring what a session protected', () => {
  it('reports a changed file and a deleted one, flat, and hides an unchanged copy', async () => {
    const { workspace, guard } = await scratch()
    const changed = join(workspace, 'src', 'a.ts')
    const deleted = join(workspace, 'docs', 'gone.md')
    const untouched = join(workspace, 'kept.txt')
    await mkdir(join(workspace, 'src'), { recursive: true })
    await mkdir(join(workspace, 'docs'), { recursive: true })
    await writeFile(changed, 'original a')
    await writeFile(deleted, 'original doc')
    await writeFile(untouched, 'same')
    for (const file of [changed, deleted, untouched]) await guard.protect(agent(workspace), file)
    await writeFile(changed, 'replaced a')
    await rm(deleted)

    const entries = await guard.list('session-1', workspace)

    // The tree is walked as one flat list: a nested file is a row of its own,
    // not a child of a directory row. The copy that still matches its file is
    // left out — there is nothing there to restore.
    expect(entries.map(entry => [entry.name, entry.state])).toEqual([
      ['docs/gone.md', 'deleted'],
      ['src/a.ts', 'modified'],
    ])
    expect(entries.every(entry => entry.backup.startsWith(guard.root))).toBe(true)
    expect(entries[0]!.path).toBe(deleted)
  })

  it('writes a copy back over a changed file, and recreates a deleted one', async () => {
    const { workspace, guard } = await scratch()
    const changed = join(workspace, 'src', 'a.ts')
    const deleted = join(workspace, 'deep', 'nested', 'gone.md')
    await mkdir(join(workspace, 'src'), { recursive: true })
    await mkdir(join(workspace, 'deep', 'nested'), { recursive: true })
    await writeFile(changed, 'original a')
    await writeFile(deleted, 'original doc')
    await guard.protect(agent(workspace), changed)
    await guard.protect(agent(workspace), deleted)
    await writeFile(changed, 'ruined a')
    await rm(deleted)

    const restored = await guard.restore('session-1', workspace, 'deep/nested/gone.md')
    await guard.restore('session-1', workspace, 'src/a.ts')

    // A deleted file's directories come back with it, and the copy survives the
    // restore: the same row can be restored again after a later change.
    expect(restored.path).toBe(deleted)
    expect(await readFile(changed, 'utf8')).toBe('original a')
    expect(await readFile(deleted, 'utf8')).toBe('original doc')
    expect(await guard.list('session-1', workspace)).toEqual([])
  })

  it('refuses a copy path that is not inside the session, and one it never took', async () => {
    const { workspace, guard } = await scratch()
    const file = join(workspace, 'a.txt')
    await writeFile(file, 'a')
    await guard.protect(agent(workspace), file)

    await expect(guard.restore('session-1', workspace, '../../escape.txt')).rejects.toThrow(/holds no backup/u)
    await expect(guard.restore('session-1', workspace, 'missing.txt')).rejects.toThrow(/holds no backup/u)
    await expect(guard.restore('session-1', workspace, join(workspace, 'a.txt'))).rejects.toThrow(/holds no backup/u)
  })

  it('lists an outside file by an absolute name, and refuses one whose path it cannot reconstruct', async () => {
    const { workspace, root, guard } = await scratch()
    const outside = join(root, '..', 'elsewhere', 'shared.txt')
    await mkdir(dirname(outside), { recursive: true })
    await writeFile(outside, 'elsewhere')
    await guard.protect(agent(workspace), outside)
    await writeFile(outside, 'changed elsewhere')

    const entries = await guard.list('session-1', workspace)

    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.path).toBe(outside)
    // The internal `external/…` spelling is not a name anyone recognises, so the
    // row shows the path the copy restores to.
    expect(entry.name).toBe(outside)
    expect(entry.relative.startsWith('external/')).toBe(true)
    await guard.restore('session-1', workspace, entry.relative)
    expect(await readFile(outside, 'utf8')).toBe('elsewhere')
  })

  it('reports nothing for a session that protected nothing', async () => {
    const { workspace, guard } = await scratch()
    expect(await guard.list('session-1', workspace)).toEqual([])
  })
})

describe('the shell gate', () => {
  it('refuses a destructive command and names the tool that fixes it', async () => {
    const { workspace, guard } = await scratch()
    const call = { name: 'bash', arguments: { command: 'rm -rf src' }, agent: agent(workspace) }

    const decision = await guard.beforeTool(call, async () => ({ kind: 'allow' }))

    expect(decision.kind).toBe('deny')
    expect(decision).toHaveProperty('reason', expect.stringContaining('worktree_backup'))
  })

  it('allows a command that only mentions a destructive word', async () => {
    const { workspace, guard } = await scratch()
    const call = { name: 'bash', arguments: { command: 'echo "rm -rf /"' }, agent: agent(workspace) }

    const decision = await guard.beforeTool(call, async () => ({ kind: 'allow' }))

    expect(decision.kind).toBe('allow')
  })

  it('allows an ordinary command', async () => {
    const { workspace, guard } = await scratch()
    const call = { name: 'bash', arguments: { command: 'npm run build' }, agent: agent(workspace) }

    expect((await guard.beforeTool(call, async () => ({ kind: 'allow' }))).kind).toBe('allow')
  })

  it('does not gate commands when the policy is off', async () => {
    const { workspace, root } = await scratch()
    const guard = new FileGuard({ directory: root, denyDestructiveCommands: false })
    const call = { name: 'bash', arguments: { command: 'rm -rf src' }, agent: agent(workspace) }

    expect((await guard.beforeTool(call, async () => ({ kind: 'allow' }))).kind).toBe('allow')
  })
})

describe('protecting through the tool hook', () => {
  it('lands the copy before the delegated call may run', async () => {
    const { workspace, root, guard } = await scratch()
    const file = join(workspace, 'race.txt')
    await writeFile(file, 'before')
    let decision: string | undefined

    const result = await guard.beforeTool(writeCall(workspace, file), async () => {
      // The tool body would run here; the copy must already exist.
      const directory = await sessionDirectory(root)
      decision = await readFile(join(directory, 'race.txt'), 'utf8')
      return { kind: 'allow' }
    })

    expect(result.kind).toBe('allow')
    expect(decision).toBe('before')
  })

  it('lets a call with no file argument through untouched', async () => {
    const { workspace, root, guard } = await scratch()
    const call = { name: 'glob', arguments: { pattern: '**/*.ts' }, agent: agent(workspace) }

    expect((await guard.beforeTool(call, async () => ({ kind: 'allow' }))).kind).toBe('allow')
    expect(existsSync(root)).toBe(false)
  })
})

describe('deleting a session archive', () => {
  it('removes that session backups and leaves the other session alone', async () => {
    const { workspace, root, guard } = await scratch()
    const mine = join(workspace, 'mine.txt')
    const theirs = join(workspace, 'theirs.txt')
    await writeFile(mine, 'mine')
    await writeFile(theirs, 'theirs')
    await guard.protect(agent(workspace, 'session-1'), mine)
    await guard.protect(agent(workspace, 'session-2'), theirs)
    expect((await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory())).toHaveLength(2)

    const removed = await guard.archive('session-1')

    expect(removed).toBe(true)
    const left = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory())
    expect(left).toHaveLength(1)
    expect(await readFile(join(root, left[0]!.name, 'theirs.txt'), 'utf8')).toBe('theirs')
  })

  it('reports nothing to do on a repeated archive', async () => {
    const { workspace, root, guard } = await scratch()
    const file = join(workspace, 'a.txt')
    await writeFile(file, 'a')
    await guard.protect(agent(workspace), file)

    expect(await guard.archive('session-1')).toBe(true)
    expect(await guard.archive('session-1')).toBe(false)
  })

  it('forgets what it protected, so a recreated session copies again', async () => {
    const { workspace, root, guard } = await scratch()
    const file = join(workspace, 'again.txt')
    await writeFile(file, 'first')
    await guard.protect(agent(workspace), file)
    await guard.archive('session-1')
    await writeFile(file, 'second')

    expect((await guard.protect(agent(workspace), file)).outcome).toBe('protected')
    const directory = await sessionDirectory(root)
    expect(await readFile(join(directory, 'again.txt'), 'utf8')).toBe('second')
  })
})

describe('wiring on the host context', () => {
  it('protects through the tool pipeline and stops when the plugin unloads', async () => {
    const { workspace, root } = await scratch()
    const file = join(workspace, 'wired.txt')
    await writeFile(file, 'before')
    const ctx = new Context()
    const fiber = ctx.plugin({
      name: 'guard-wiring',
      apply(sibling: Context) {
        installFileGuard(sibling, { directory: root, denyDestructiveCommands: true })
      },
    })
    await fiber.await()

    await ctx.waterfall('tools/pre-execute', writeCall(workspace, file) as never, async () => 'allow' as never)

    const directory = await sessionDirectory(root)
    expect(await readFile(join(directory, 'wired.txt'), 'utf8')).toBe('before')

    // After disposal the listener is gone, so a further change copies nothing.
    await fiber.dispose()
    await rm(directory, { recursive: true, force: true })
    await writeFile(file, 'changed')
    await ctx.waterfall('tools/pre-execute', writeCall(workspace, file) as never, async () => 'allow' as never)
    expect(existsSync(join(directory, 'wired.txt'))).toBe(false)
  })
})
