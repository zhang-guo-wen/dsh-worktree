/**
 * Worktree seat state, browser half.
 *
 * One staged boolean and one staged base branch for the Session currently on
 * the new-session screen. The choice decides where that session's workspace IS,
 * and a session's header cwd is fixed when it is created, so the seat is only
 * reachable while the session is blank and the choice is spent by the first
 * start.
 *
 * The store owns no session: starting one calls the Host route, which creates
 * the checkout, registers its project, and starts the session in it as one
 * operation.
 * @module @guowenzhang/dsh-worktree/client/seat-store
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { request, type BranchList, type ListResult, type StartResult, type WorktreeEntry } from './api.ts'

/** The base a new branch starts from when the probe names no local branch. */
const HEAD = 'HEAD'

/** Worktree-seat snapshot. */
export interface WorktreeSeatState {
  /** Whether this control acts on the Session's directory at all. */
  visible: boolean
  /** Whether the session on screen starts inside a new worktree. */
  enabled: boolean
  /** A start is in flight. */
  creating: boolean
  /** The local branch the new branch starts from; `HEAD` when the probe named none. */
  base: string
  /** Local branches offered as a base, or null before the first read. */
  branches: readonly string[] | null
  /**
   * The Session a start already created for this screen, so a second attempt
   * shows that Session instead of creating a second checkout.
   */
  started: string | null
  /** The branch the Session's own checkout holds, empty until a probe names it. */
  checkoutBranch: string
  /**
   * Whether the Session already runs inside a linked checkout. Its choice was
   * made when that checkout was created, so the control shows what was chosen
   * and refuses changes rather than offering a checkout inside a checkout.
   */
  isolated: boolean
  /** A refusal or failure to display, cleared by the next attempt. */
  error: string | null
}

const INITIAL: WorktreeSeatState = {
  visible: false,
  enabled: false,
  creating: false,
  base: HEAD,
  branches: null,
  started: null,
  checkoutBranch: '',
  isolated: false,
  error: null,
}

/**
 * Owns the staged choice for the session currently on the new-session screen.
 */
export class WorktreeSeatController {
  /** Snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<WorktreeSeatState> = createSnapshotStore(INITIAL)

  /** Only the newest probe may publish, so a late reply cannot revive a stale answer. */
  private probeGeneration = 0

  /** The directory the newest probe resolved; the staged choice applies to it. */
  private probedCwd: string | undefined

  /**
   * The base this seat created a checkout from, keyed by that checkout's path.
   *
   * A checkout the seat made can report what it was made from for as long as
   * this page lives; every other checkout reports only the branch it holds.
   */
  private created: { readonly path: string; readonly base: string } | undefined

  /** The directory the staged choice applies to, for the start action to consume. */
  cwd(): string | undefined {
    return this.probedCwd
  }

  /**
   * Probe what this control may offer for a Session's directory.
   *
   * The probe's checkout listing answers three questions at once: whether the
   * directory is a repository this control can act on, which branch its own
   * checkout holds, and whether that checkout is the repository's main one. A
   * Session already inside a linked checkout is isolated by a choice that was
   * made for it, so the control reports that choice and refuses changes — the
   * alternative is a checkout nested inside a checkout, one click after arriving.
   * @param cwd - the Session's working directory, when it has one.
   * @returns once the snapshot reflects the probe.
   */
  async load(cwd: string | undefined): Promise<void> {
    const generation = ++this.probeGeneration
    this.probedCwd = cwd
    if (cwd === undefined) {
      this.set({ visible: false, base: HEAD, branches: null })
      return
    }
    const result = await request<ListResult>('list', { cwd })
    if (generation !== this.probeGeneration) return
    if (!result.ok) {
      // A repository the Host cannot enumerate is one this control cannot start
      // a session in either, so the probe result is also the visibility answer.
      this.set({ visible: false, base: HEAD, branches: null })
      return
    }
    const checkout = checkoutAt(cwd, result.value.worktrees)
    // A directory no listed checkout contains is treated as the main checkout:
    // path spellings can differ between the header and Git, and locking the
    // control over a spelling would take a choice away that still belongs there.
    const isolated = checkout !== undefined && !checkout.main
    // The base follows the Session's own checkout while the Session may still
    // choose. An isolated Session keeps the base this seat created it from, so
    // the control reports the choice that was made rather than the branch that
    // choice produced; a checkout this page did not create reports its branch.
    const created = this.created
    const fromSeat = isolated && created !== undefined && checkout !== undefined
      && pathKey(created.path) === pathKey(checkout.path)
    this.set({
      visible: true,
      isolated,
      checkoutBranch: checkout?.branch ?? '',
      base: fromSeat ? created.base : checkout?.branch ?? HEAD,
    })
  }

  /**
   * Forget a Session this seat already created a checkout for.
   *
   * Called when the screen moves to another Session: that Session's own arrival
   * must not be blocked by the previous one's start.
   */
  resetStart(): void {
    this.set({ started: null })
  }

  /**
   * Read the local branches the base can be picked from.
   *
   * The read happens when the menu opens rather than with the probe: the probe
   * re-runs on every catalog change, and a branch list is only wanted at the
   * moment someone is choosing from it.
   * @returns once the snapshot holds the branches, or an empty list when the read failed.
   */
  async loadBranches(): Promise<void> {
    const cwd = this.probedCwd
    if (cwd === undefined) return
    const result = await request<BranchList>('branches', { cwd })
    if (cwd !== this.probedCwd) return
    // A failed read leaves the staged base selectable and adds nothing: the
    // start itself reports what is wrong with the directory.
    this.set({ branches: result.ok ? result.value.branches : [] })
  }

  /**
   * Stage the local branch a new branch starts from.
   * @param base - the chosen local branch name.
   */
  selectBase(base: string): void {
    this.set({ base })
  }

  /**
   * Stage whether the session starts inside a new worktree.
   * @param enabled - the new staged value.
   */
  setEnabled(enabled: boolean): void {
    this.set({ enabled, error: null })
  }

  /**
   * Start the session inside a new worktree, then hand the started session to
   * the caller so it can be opened.
   *
   * This consumes the staged choice: the session it starts has its directory, so
   * the choice has no further meaning and is cleared whether the start succeeds
   * or fails. A start that created a Session but could not show it keeps that
   * Session on the seat, so the next attempt shows it instead of creating a
   * second checkout; a start the Host refused created nothing and leaves the
   * control able to try again.
   * @param open - shows the started session by id.
   * @returns the started session id, or undefined when the start failed.
   */
  async start(open: (sessionId: string) => void | Promise<void>): Promise<string | undefined> {
    const state = this.store.getSnapshot()
    if (state.creating) return undefined
    if (state.started !== null) {
      await this.open(state.started, open)
      return state.started
    }
    const cwd = this.probedCwd
    if (cwd === undefined) {
      this.set({ error: 'no working directory is selected' })
      return undefined
    }
    this.set({ creating: true, error: null })
    const result = await request<StartResult>('start', { cwd, base: state.base })
    if (!result.ok) {
      this.set({ creating: false, enabled: false, error: result.message })
      return undefined
    }
    const sessionId = result.value.sessionId
    // Remembering the pair lets the locked control in that checkout report what
    // it was created from instead of the branch the creation produced.
    this.created = { path: result.value.worktree.path, base: state.base }
    this.set({ creating: false, enabled: false, started: sessionId, error: null })
    await this.open(sessionId, open)
    return sessionId
  }

  /**
   * Show one started Session, reporting a refusal on the seat.
   * @param sessionId - the Session to show.
   * @param open - shows the started session by id.
   */
  private async open(sessionId: string, open: (sessionId: string) => void | Promise<void>): Promise<void> {
    try {
      await open(sessionId)
      this.set({ error: null })
    } catch (error: unknown) {
      this.set({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  private set(patch: Partial<WorktreeSeatState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }
}

/**
 * The checkout containing one directory.
 *
 * The probe lists every checkout of the repository, so the directory's own
 * checkout is the longest listed root that contains it; a directory inside the
 * main checkout therefore names the main checkout rather than a sibling
 * worktree whose path merely shares its prefix. Windows and macOS report one
 * directory under either case, and Git reports `/` where Node reports `\`, so
 * both spellings compare equal.
 * @param directory - the Session's working directory.
 * @param worktrees - the repository's checkouts, as the route listed them.
 * @returns the containing checkout, or undefined when none contains the directory.
 */
export function checkoutAt(directory: string, worktrees: readonly WorktreeEntry[]): WorktreeEntry | undefined {
  const target = pathKey(directory)
  let found: WorktreeEntry | undefined
  for (const entry of worktrees) {
    const root = pathKey(entry.path)
    if (target !== root && !target.startsWith(`${root}/`)) continue
    if (found === undefined || root.length > pathKey(found.path).length) found = entry
  }
  return found
}

/**
 * Compare one path spelling against another.
 * @param path - a path from Git or from a Session header.
 * @returns the separator-normalized, case-folded form.
 */
function pathKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}
