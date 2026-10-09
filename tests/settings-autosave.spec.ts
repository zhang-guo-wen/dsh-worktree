import { describe, expect, it } from 'vitest'
import type { SettingsFormPathOp, SettingsFormScope } from '@deepseek-ai/dsh-client-ui-primitives'
import { WorktreeSettingsController, type WorktreeSettings } from '../src/client/settings-store.ts'

function setup() {
  let snapshot = {
    status: 'ready' as const, writable: true, revision: 1,
    value: { nestedRepositories: 'none', defaultPath: 'agents', nestedScanDepth: 1 },
    base: {}, user: {},
  }
  const listeners = new Set<() => void>()
  const writes: { ops: readonly SettingsFormPathOp[]; revision?: number; finish: (accepted?: boolean) => void; fail: () => void }[] = []
  const scope: SettingsFormScope<WorktreeSettings> = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate: (ops, revision) => new Promise((resolve, reject) => {
      writes.push({ ops, revision, finish: (accepted = true) => {
        if (accepted) {
          const value = { ...snapshot.value }
          for (const op of ops) if (op.op === 'set') Object.assign(value, { [op.path[0]!]: op.value })
          snapshot = { ...snapshot, value, revision: snapshot.revision + 1 }
          for (const listener of listeners) listener()
        }
        resolve(accepted)
      }, fail: () => { reject(new Error('offline')) } })
    }),
  }
  const controller = new WorktreeSettingsController(scope)
  const face = controller.inject()
  return { controller, face, writes, snapshot: () => snapshot, readOnly: () => { snapshot = { ...snapshot, writable: false } } }
}
const settle = async () => { await Promise.resolve(); await Promise.resolve() }

describe('worktree automatic saving', () => {
  it('saves each kind of valid control without a save action', async () => {
    const test = setup()
    for (const [field, text] of [['nestedRepositories', 'all'], ['nestedScanDepth', '2'], ['defaultPath', 'home']]) {
      test.face.edit(field!, text!)
      expect(test.writes.at(-1)?.ops).toEqual([{ op: 'set', path: [field], value: field === 'nestedScanDepth' ? 2 : text }])
      test.writes.at(-1)?.finish()
      await settle()
    }
    expect(test.face.hooks.worktreeSettings.getSnapshot()).toMatchObject({ dirty: false, saving: false, failed: false })
    test.controller.dispose()
  })

  it('keeps newer edits visible and coalesces them into the next revision-fenced write', async () => {
    const test = setup()
    test.face.edit('defaultPath', 'home')
    test.face.edit('defaultPath', 'sibling')
    test.face.edit('nestedRepositories', 'all')
    test.face.edit('nestedScanDepth', '2')
    test.face.edit('nestedScanDepth', '3')
    expect(test.writes).toHaveLength(1)
    test.writes[0]!.finish()
    await settle()
    expect(test.writes[1]).toMatchObject({ revision: 2, ops: [
      { op: 'set', path: ['defaultPath'], value: 'sibling' },
      { op: 'set', path: ['nestedRepositories'], value: 'all' },
      { op: 'set', path: ['nestedScanDepth'], value: 3 },
    ] })
    expect(test.face.hooks.worktreeSettings.getSnapshot().defaultPath.text).toBe('sibling')
    test.writes[1]!.finish()
    await settle()
    expect(test.snapshot().value).toEqual({ defaultPath: 'sibling', nestedRepositories: 'all', nestedScanDepth: 3 })
    expect(test.face.hooks.worktreeSettings.getSnapshot().dirty).toBe(false)
  })

  it.each(['', ' ', '0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992'])('does not save invalid depth %j or block other controls', async text => {
    const test = setup()
    test.face.edit('nestedScanDepth', text)
    expect(test.writes).toHaveLength(0)
    expect(test.face.hooks.worktreeSettings.getSnapshot().nestedScanDepth.invalid).toBe(true)
    test.face.edit('defaultPath', 'home')
    test.writes[0]!.finish()
    await settle()
    expect(test.snapshot().value.nestedScanDepth).toBe(1)
    test.face.edit('nestedScanDepth', '4')
    test.writes[1]!.finish()
    await settle()
    expect(test.snapshot().value.nestedScanDepth).toBe(4)
  })

  it('removes an unsent valid edit when the user replaces it with invalid text', async () => {
    const test = setup()
    test.face.edit('defaultPath', 'home')
    test.face.edit('nestedScanDepth', '2')
    test.face.edit('nestedScanDepth', '')
    test.writes[0]!.finish()
    await settle()
    expect(test.writes).toHaveLength(1)
    expect(test.face.hooks.worktreeSettings.getSnapshot().nestedScanDepth.text).toBe('')
  })

  it('keeps failed drafts without retrying in a loop, and allows correction', async () => {
    const test = setup()
    test.face.edit('defaultPath', 'home')
    test.writes[0]!.finish(false)
    await settle()
    expect(test.face.hooks.worktreeSettings.getSnapshot()).toMatchObject({ failed: true, dirty: true, saving: false })
    expect(test.writes).toHaveLength(1)
    test.face.edit('defaultPath', 'sibling')
    test.writes[1]!.finish()
    await settle()
    expect(test.face.hooks.worktreeSettings.getSnapshot()).toMatchObject({ failed: false, dirty: false })
  })

  it('handles thrown writes and retries the same selection on a new user edit', async () => {
    const test = setup()
    test.face.edit('defaultPath', 'home')
    test.writes[0]!.fail()
    await settle()
    expect(test.face.hooks.worktreeSettings.getSnapshot().failed).toBe(true)
    test.face.edit('defaultPath', 'home')
    test.writes[1]!.finish()
    await settle()
    expect(test.snapshot().value.defaultPath).toBe('home')
  })

  it('keeps a failed field warning while another field saves successfully', async () => {
    const test = setup()
    test.face.edit('defaultPath', 'home')
    test.writes[0]!.finish(false)
    await settle()
    test.face.edit('nestedRepositories', 'all')
    test.writes[1]!.finish()
    await settle()
    expect(test.face.hooks.worktreeSettings.getSnapshot()).toMatchObject({ failed: true, dirty: true })
    test.face.edit('defaultPath', 'home')
    test.writes[2]!.finish()
    await settle()
    expect(test.face.hooks.worktreeSettings.getSnapshot()).toMatchObject({ failed: false, dirty: false })
  })

  it('does not write unchanged controls or read-only settings', () => {
    const test = setup()
    test.face.edit('defaultPath', 'agents')
    test.readOnly()
    test.face.edit('defaultPath', 'home')
    expect(test.writes).toHaveLength(0)
  })

  it('finishes saving after the page face is replaced, but stops queued writes on plugin disposal', async () => {
    const test = setup()
    test.face.edit('defaultPath', 'home')
    test.face.edit('nestedRepositories', 'all')
    expect(test.controller.inject().hooks.worktreeSettings.getSnapshot().defaultPath.text).toBe('home')
    test.controller.dispose()
    test.writes[0]!.finish()
    await settle()
    expect(test.writes).toHaveLength(1)
    test.face.edit('defaultPath', 'sibling')
    expect(test.writes).toHaveLength(1)
  })
})
