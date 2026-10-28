/**
 * The chip's start action end to end through the browser half's wiring.
 *
 * The Host creates the worktree's Session outside the Client's Session
 * Controller, so the action has to catalogue that Session before navigating:
 * navigation refuses an identity the Client cannot resolve, and that refusal is
 * what left the user on the original Session after a start that had succeeded.
 * These cases drive the registration's inject face with a fake Session
 * Controller and a stub route, and assert the pull-then-open order.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/client/index.ts'
import type { WorktreeChipInjected } from '../src/client/WorktreeChip.tsx'
import { configFormsDouble } from './config-forms-double.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DraftInput, InputState, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * A composer standing in for the real input shell.
 *
 * It reproduces the two behaviors the carry depends on: `setDraft` takes a
 * whole semantic draft and re-attaches its reference chips (the Host's own
 * cross-session carry does the same), and a chip's span is the text it stands
 * for. A snapshot whose chips do not match its text is refused, as the real
 * draft schema refuses it.
 *
 * With `textOnly` the double reproduces the older host instead (0.2.0-rc.x):
 * `setDraft` takes plain text only and throws the way the real editor's
 * `text.replace` throws on an object.
 */
function inputDouble(textOnly = false): SessionInput & { setDraft(draft: DraftInput): void } {
  const state = createSnapshotStore<InputState>({ draft: '', attachmentIds: [], draftRev: 0, phase: 'plain', occurrences: [], queue: [] })
  const bump = (patch: Partial<InputState>): void => {
    state.set({ ...state.getSnapshot(), ...patch, draftRev: state.getSnapshot().draftRev + 1 })
  }
  return {
    state,
    setDraft: (input) => {
      if (textOnly && typeof input !== 'string') throw new TypeError('text.replace is not a function')
      const next = typeof input === 'string' ? { text: input, references: [] } : input
      for (const reference of next.references) {
        if (reference.length !== reference.clipboardText.length) throw new Error('draft reference length mismatch')
        if (next.text.slice(reference.offset, reference.offset + reference.length) !== reference.clipboardText) {
          throw new Error('draft reference does not match the draft text')
        }
      }
      bump({ draft: next.text, occurrences: next.references.map((reference, index) => ({ ...reference, occurrenceId: index })) })
    },
    addAttachments: ids => { bump({ attachmentIds: [...state.getSnapshot().attachmentIds, ...ids] }); return true },
    removeAttachment: id => { bump({ attachmentIds: state.getSnapshot().attachmentIds.filter(value => value !== id) }); return true },
    insertReference: (ref, span) => {
      const old = state.getSnapshot()
      if (span.draftRev !== old.draftRev) return false
      bump({ occurrences: [...old.occurrences, { ...ref, occurrenceId: old.draftRev, offset: span.start, length: span.end - span.start }].sort((a, b) => a.offset - b.offset) })
      return true
    },
    beginCommand: () => false, pruneAttachments: () => {}, submit: () => {}, notify: () => {}, focus: () => {},
  }
}

afterEach(() => { vi.unstubAllGlobals() })

/** One Session row as the Client catalog holds it. */
interface Row {
  readonly cwd?: string
  readonly blank?: boolean
}

/** What one mounted browser half exposes to a case. */
interface Mounted {
  /** The registration's inject face: the chip's data and actions. */
  readonly face: WorktreeChipInjected
  /** Session rows the fake catalog holds; a refresh may add to them. */
  readonly rows: Record<string, Row>
  /** Recorded actions, in order. */
  readonly calls: string[]
  /** Session ids the fake navigation opened. */
  readonly opened: string[]
  /** Catalog subscribes and unsubscribes, in order. */
  readonly gates: string[]
  /** Catalog listeners still subscribed. */
  readonly listeners: Set<() => void>
  readonly inputs: Record<string, SessionInput>
  readonly rebind: ReturnType<typeof vi.fn>
  readonly retained: Set<object>
}

/** A promise the fake navigation resolves when it is asked to open a Session. */
interface OpenAttempt {
  /** Resolves with the id navigation was asked for, before it is refused. */
  readonly attempted: Promise<string>
  /** The observer handed to {@link mount}. */
  readonly record: (sessionId: string) => void
}

/**
 * Track the first navigation attempt.
 * @returns the attempt promise and its observer.
 */
function openAttempt(): OpenAttempt {
  let record!: (sessionId: string) => void
  const attempted = new Promise<string>(resolve => { record = resolve })
  return { attempted, record }
}

/**
 * Mount the browser half over the Client services the chip's action reads.
 * @param options - what each list pull catalogues, the navigation observer,
 * and whether the started Session's composer takes plain text only.
 * @returns the inject face and the recorded state.
 */
async function mount(options: {
  refresh?: (pull: number, rows: Record<string, Row>) => void
  onOpen?: (sessionId: string) => void
  textOnlyTargets?: boolean
} = {}): Promise<Mounted> {
  const rows: Record<string, Row> = { sid: { cwd: '/repo', blank: true } }
  const calls: string[] = []
  const gates: string[] = []
  const opened: string[] = []
  const listeners = new Set<() => void>()
  const inputs: Record<string, SessionInput> = {
    sid: inputDouble(),
    's-1': inputDouble(options.textOnlyTargets ?? false),
    'sid-2': inputDouble(),
  }
  const rebind = vi.fn()
  const retained = new Set<object>()
  const conversation = {
    input: { for: (ctx: { id: string }) => inputs[ctx.id] },
    rebindDraftFiles: rebind,
  }
  let pulls = 0
  let face: WorktreeChipInjected | undefined

  const list = {
    getSnapshot: () => ({ ids: Object.keys(rows), byId: rows }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      gates.push('subscribe')
      return () => { listeners.delete(listener); gates.push('unsubscribe') }
    },
  }
  const scope = {
    get: (name: string) => (name === 'sessions' ? {
      list,
      retain: (id: string) => {
        if (rows[id] === undefined) throw new Error(`sessions.retain: unknown session ${id}`)
        const reference = { binding: { ctx: { id } }, release: () => { retained.delete(reference) } }
        retained.add(reference)
        return reference
      },
      refresh: async () => {
        pulls += 1
        calls.push('refresh')
        options.refresh?.(pulls, rows)
      },
    } : name === 'conversation' ? conversation : undefined),
    effect: (fn: () => unknown) => { fn() },
    uiWorkspace: {
      openSession: (sessionId: string) => {
        calls.push('open')
        options.onOpen?.(sessionId)
        // The rule the real navigation enforces: an identity the catalog does
        // not hold cannot be retained.
        if (rows[sessionId] === undefined) throw new Error(`sessions.retain: unknown session ${sessionId}`)
        opened.push(sessionId)
      },
    },
    slots: {
      inject: (_name: string, callback: () => unknown) => { callback(); return () => {} },
      // Only a seat this case drives carries an inject face; the Git-accounts
      // page registers with one too, but its face is not what this case reads.
      register: (entry: { inject?: () => WorktreeChipInjected }) => {
        if (typeof entry.inject === 'function') face = entry.inject()
        return () => {}
      },
    },
    // The file-backup page registers a tab type with the right Sidebar; this
    // case drives the chip, so the registry only has to exist.
    sidebarRightTabs: { register: () => () => {}, subscribe: () => () => {} },
  }

  const ctx = new Context()
  // The plugin's own `inject` must resolve before it applies; the inner
  // `ctx.inject` override below supplies the scope the chip registers into.
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key } as never)
  ctx.provide('slots', {} as never)
  ctx.provide('conversation', {} as never)
  ctx.provide('uiWorkspace', {} as never)
  // The settings page is part of the browser half; its form service must be
  // present for the plugin to apply, even though this case drives the chip.
  ctx.provide('configForms', configFormsDouble().service as never)
  ctx.inject = ((_deps: unknown, cb: (scope: unknown) => unknown) => {
    cb(scope)
    return undefined
  }) as typeof ctx.inject
  await ctx.plugin(plugin, {}).await()

  if (face === undefined) throw new Error('the browser half registered no chip')
  return { face, rows, calls, opened, gates, listeners, inputs, rebind, retained }
}

/**
 * Stub the Host route for one case.
 * @param start - the body `start` answers with.
 */
function stubRoute(start: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const method = String(url).split('/').pop()
    const body = method === 'start'
      ? start
      : { worktrees: [{ path: '/repo', branch: 'main', head: 'a'.repeat(40), main: true }] }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}

/**
 * Probe the Session and stage the choice.
 * @param mounted - the mounted half.
 */
async function stage(mounted: Mounted): Promise<void> {
  await mounted.face.load('sid')
  mounted.face.setEnabled(true)
}

describe('worktree chip navigation', () => {
  const started = { sessionId: 's-1', worktree: { path: '/repo-wt' }, workspaceId: 'w-1' }
  const catalogue = (_pull: number, rows: Record<string, Row>) => { rows['s-1'] = { cwd: '/repo-wt', blank: true } }
  const settled = () => new Promise(resolve => { setImmediate(resolve) })

  it('moves multiline text, reference chips and attachments before navigation without sending', async () => {
    stubRoute(started)
    const mounted = await mount({ refresh: catalogue, onOpen: () => {
      expect(mounted.inputs['s-1']!.state.getSnapshot().draft).toBe('请检查 @file\n保留全部内容')
      expect(mounted.retained.size).toBe(2)
    } })
    const from = mounted.inputs.sid!
    from.setDraft('请检查 @file\n保留全部内容')
    from.insertReference({ source: 'files', ref: '/repo/file', label: 'file', clipboardText: '@file', appearance: 'file' }, { start: 4, end: 9, draftRev: from.state.getSnapshot().draftRev })
    from.addAttachments(['image-1', 'file-2'] as never)
    await stage(mounted)
    await settled()
    expect(mounted.opened).toEqual(['s-1'])
    expect(from.state.getSnapshot()).toMatchObject({ draft: '', attachmentIds: [] })
    expect(mounted.inputs['s-1']!.state.getSnapshot()).toMatchObject({ attachmentIds: ['image-1', 'file-2'], occurrences: [{ ref: '/repo/file', offset: 4 }] })
    expect(mounted.rebind).toHaveBeenCalledWith('s-1', ['image-1', 'file-2'])
    expect(mounted.retained.size).toBe(0)
  })

  it('carries the draft as plain text where the host takes only text', async () => {
    stubRoute(started)
    const mounted = await mount({ refresh: catalogue, textOnlyTargets: true })
    const from = mounted.inputs.sid!
    from.setDraft('带图草稿')
    from.addAttachments(['image-1'] as never)
    await stage(mounted)
    await settled()
    expect(mounted.opened).toEqual(['s-1'])
    expect(from.state.getSnapshot()).toMatchObject({ draft: '', attachmentIds: [] })
    expect(mounted.inputs['s-1']!.state.getSnapshot()).toMatchObject({ draft: '带图草稿', attachmentIds: ['image-1'] })
    expect(mounted.rebind).toHaveBeenCalledWith('s-1', ['image-1'])
    expect(mounted.face.hooks.worktreeSeat.getSnapshot().error).toBeNull()
  })

  it('rolls back on a text-only host when navigation is refused, then retries once', async () => {
    stubRoute(started)
    let refuse = true
    const mounted = await mount({ refresh: catalogue, textOnlyTargets: true, onOpen: () => { if (refuse) throw new Error('navigation refused') } })
    mounted.inputs.sid!.setDraft('不要丢失')
    await stage(mounted)
    await settled()
    expect(mounted.inputs.sid!.state.getSnapshot()).toMatchObject({ draft: '不要丢失', attachmentIds: [] })
    expect(mounted.inputs['s-1']!.state.getSnapshot()).toMatchObject({ draft: '', attachmentIds: [] })
    expect(mounted.retained.size).toBe(0)
    refuse = false
    mounted.face.setEnabled(true)
    await settled()
    expect(mounted.opened).toEqual(['s-1'])
    expect(mounted.inputs['s-1']!.state.getSnapshot().draft).toBe('不要丢失')
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/start'))).toHaveLength(1)
  })

  it('takes the latest draft after refresh, including edits made while creation is pending', async () => {
    stubRoute(started)
    const mounted = await mount({ refresh: (pull, rows) => {
      catalogue(pull, rows)
      mounted.inputs.sid!.setDraft('创建期间继续输入')
    } })
    mounted.inputs.sid!.setDraft('最初内容')
    await stage(mounted)
    await settled()
    expect(mounted.inputs['s-1']!.state.getSnapshot().draft).toBe('创建期间继续输入')
  })

  it('preserves the source and rolls back the target on navigation failure, then retries once', async () => {
    stubRoute(started)
    let refuse = true
    const mounted = await mount({ refresh: catalogue, onOpen: () => { if (refuse) throw new Error('navigation refused') } })
    mounted.inputs.sid!.setDraft('不要丢失')
    mounted.inputs.sid!.addAttachments(['file-1'] as never)
    await stage(mounted)
    await settled()
    expect(mounted.inputs.sid!.state.getSnapshot()).toMatchObject({ draft: '不要丢失', attachmentIds: ['file-1'] })
    expect(mounted.inputs['s-1']!.state.getSnapshot()).toMatchObject({ draft: '', attachmentIds: [] })
    expect(mounted.retained.size).toBe(0)
    expect(mounted.rebind).toHaveBeenLastCalledWith('sid', ['file-1'])
    refuse = false
    mounted.face.setEnabled(true)
    await settled()
    expect(mounted.opened).toEqual(['s-1'])
    expect(mounted.inputs['s-1']!.state.getSnapshot().attachmentIds).toEqual(['file-1'])
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/start'))).toHaveLength(1)
  })

  it('does not overwrite an existing target draft', async () => {
    stubRoute(started)
    const mounted = await mount({ refresh: catalogue })
    mounted.inputs.sid!.setDraft('source')
    mounted.inputs['s-1']!.setDraft('target')
    await stage(mounted)
    await settled()
    expect(mounted.opened).toEqual([])
    expect(mounted.inputs.sid!.state.getSnapshot().draft).toBe('source')
    expect(mounted.inputs['s-1']!.state.getSnapshot().draft).toBe('target')
    expect(mounted.retained.size).toBe(0)
  })

  it('keeps the draft when the Host refuses creation', async () => {
    stubRoute(started)
    const mounted = await mount()
    mounted.inputs.sid!.setDraft('source')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      String(url).endsWith('/start') ? { error: 'creation refused' } : { worktrees: [] },
    ), { status: String(url).endsWith('/start') ? 500 : 200 })))
    await stage(mounted)
    await settled()
    expect(mounted.opened).toEqual([])
    expect(mounted.inputs.sid!.state.getSnapshot().draft).toBe('source')
  })

  it('does not navigate or take a different session draft after the user switches away', async () => {
    stubRoute(started)
    const mounted = await mount({ refresh: async (pull, rows) => {
      catalogue(pull, rows)
      rows['sid-2'] = { cwd: '/other', blank: true }
      await mounted.face.load('sid-2')
    } })
    mounted.inputs.sid!.setDraft('source')
    mounted.inputs['sid-2']!.setDraft('other')
    await stage(mounted)
    await settled()
    expect(mounted.opened).toEqual([])
    expect(mounted.inputs.sid!.state.getSnapshot().draft).toBe('source')
    expect(mounted.inputs['sid-2']!.state.getSnapshot().draft).toBe('other')
  })

  it('catalogues the started Session before opening it', async () => {
    stubRoute({ sessionId: 's-1', worktree: { path: '/repo-wt' }, workspaceId: 'w-1' })
    const attempt = openAttempt()
    const mounted = await mount({
      refresh: (pull, rows) => { if (pull === 1) rows['s-1'] = { cwd: '/repo-wt', blank: true } },
      onOpen: attempt.record,
    })

    await stage(mounted)
    expect(await attempt.attempted).toBe('s-1')
    expect(mounted.calls).toEqual(['refresh', 'open'])
    expect(mounted.face.hooks.worktreeSeat.getSnapshot().error).toBeNull()
  })

  it('pulls again when the first pull joined a read older than the Session', async () => {
    stubRoute({ sessionId: 's-1', worktree: { path: '/repo-wt' }, workspaceId: 'w-1' })
    const attempt = openAttempt()
    const mounted = await mount({
      // A list read that started before the Host created the Session cannot
      // contain it; only the second pull catalogues the row.
      refresh: (pull, rows) => { if (pull === 2) rows['s-1'] = { cwd: '/repo-wt', blank: true } },
      onOpen: attempt.record,
    })

    await stage(mounted)
    expect(await attempt.attempted).toBe('s-1')
    expect(mounted.calls).toEqual(['refresh', 'refresh', 'open'])
  })

  it('reports a navigation refusal on the seat instead of failing silently', async () => {
    stubRoute({ sessionId: 's-1', worktree: { path: '/repo-wt' }, workspaceId: 'w-1' })
    const attempt = openAttempt()
    const mounted = await mount({ onOpen: attempt.record })

    await stage(mounted)
    expect(await attempt.attempted).toBe('s-1')
    // The refusal is raised after navigation was asked, so let the seat's own
    // error handling run before reading the failure back.
    await new Promise(resolve => { setImmediate(resolve) })
    expect(mounted.opened).toEqual([])
    expect(mounted.calls).toEqual(['refresh', 'refresh', 'open'])
    expect(mounted.face.hooks.worktreeSeat.getSnapshot().error).toBe('sessions.retain: unknown session s-1')
  })

  it('keeps one catalog subscription for the Session on screen', async () => {
    stubRoute({ sessionId: 's-1', worktree: { path: '/repo-wt' }, workspaceId: 'w-1' })
    const mounted = await mount()
    mounted.rows['sid-2'] = { cwd: '/repo-2', blank: true }

    await mounted.face.load('sid')
    expect(mounted.listeners.size).toBe(1)
    // Switching Sessions replaces the gate: a listener left behind would
    // re-publish the previous Session's directory on every catalog change.
    await mounted.face.load('sid-2')
    expect(mounted.listeners.size).toBe(1)
    expect(mounted.gates).toEqual(['subscribe', 'unsubscribe', 'subscribe'])
  })
})
