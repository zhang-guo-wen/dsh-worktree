/**
 * Pre-change file protection: the first time the AI is about to touch an
 * existing file, that file's current bytes are copied out of the workspace, so
 * a bad edit or a deletion is recoverable by copying the file back.
 *
 * Four decisions shape this module, each taken on measured evidence rather than
 * convenience.
 *
 * **One backup per file, per session.** The copy is taken before the first
 * change and is never replaced afterwards. That bounds total storage by the size
 * of the files actually touched, independent of how many turns a session runs —
 * the failure mode that makes Cursor's snapshot store grow without bound, and
 * the reason a per-file version history (VS Code keeps 50) is not needed. It
 * also removes content-addressed deduplication: with one copy per file there is
 * nothing to deduplicate. A file another session already protected is copied
 * again, because backups live and die with the session that asked for them
 * (see the cleanup rule below).
 *
 * **No size cap.** Large files dominate: of 243,529 files under this machine's
 * codespace, the 3,472 above 256 KB are 79.5% of the bytes. Copying VS Code's
 * 256 KB cutoff would silently abandon four fifths of the data to save nothing.
 * Copies move at 623 MB/s here, so the cost is per-file syscall overhead
 * (0.94 ms) rather than bandwidth.
 *
 * **Only files that already exist.** A file the AI creates has no prior state to
 * preserve: deleting it restores the same absent state that existed before. That
 * exemption lasts only for the run that watched the file appear. A file created
 * in an earlier session reads as pre-existing on its first change in a later
 * one, which keeps a generated file's iterations recoverable; only re-editing it
 * inside the creating session stays unprotected.
 *
 * **Backups are session-scoped and end with the session.** Each session owns one
 * directory, and archiving the session deletes it. The alternative — sharing a
 * directory per workspace — cannot answer "who still needs these files" when a
 * workspace outlives all its sessions, and a sweep that guesses risks deleting
 * another live session's latest copy.
 *
 * Discovery is precise, because the cost of protection is a function of how the
 * target is found, not of the copy: a known path is one `copyFile`, while
 * walking this workspace to discover changes costs seconds. The automatic path
 * therefore reads the file a tool named in its own arguments and stays inside
 * the session's working directory; anything else — another directory, another
 * drive — is declared through {@link BACKUP_TOOL_NAME}, which has no scope
 * limit, and the destructive shell commands are refused so the model declares
 * its targets instead of deleting blind.
 *
 * The copies are also the restore list. {@link FileGuard.list} walks one
 * session's directory and reports the files that differ from their copy, and
 * {@link FileGuard.restore} writes one copy back over its file; both work from
 * the tree alone, because a copy that exists is the only thing a restore needs.
 * A change is detected by comparing content, since the copy is written just
 * before the change and shares no timestamp with the state it preserved.
 *
 * @module @guowenzhang/dsh-worktree/file-guard
 */

import { createHash } from 'node:crypto'
import { copyFile, mkdir, open, readdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Pulls the `tools/*` event declarations into this program's type face. The
// registration itself lives in the plugin entry, so this module carries no
// runtime dependency on the tool registry.
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { compareTexts } from './compare.ts'
import type { Comparison, ComparisonKind } from './comparison-types.ts'
import type { FileGuardOptions } from './policy.ts'

/** Tool argument names that carry the path a call is about to change. */
const FILE_TARGET_ARGUMENTS = ['file_path'] as const

/**
 * Tools that change files without naming one.
 *
 * Their arguments cannot name a target, so the destructive ones are refused and
 * the model is told what to do instead.
 */
const SHELL_TOOLS = ['bash', 'pwsh'] as const

/**
 * Command shapes that destroy an existing file or directory.
 *
 * Matched against the command text with quoted spans removed, so a command that
 * merely mentions a destructive word (`echo "rm -rf"`) is not refused. A false
 * positive costs one retry; a false negative costs unprotected data.
 */
const DESTRUCTIVE_COMMAND = /(^|[|&;(\s])(rm|rmdir|del|erase|rd|Remove-Item|ri)(\s|$)/i

/**
 * Name of the model-facing tool that protects declared paths.
 *
 * Declared here rather than beside the tool definition because the refusal text
 * below names it, and the tool definition module imports from this one.
 */
export const BACKUP_TOOL_NAME = 'worktree_backup'

/** Directory segment holding files protected from outside the working directory. */
const EXTERNAL_SEGMENT = 'external'

/** What became of one protection attempt. */
export type ProtectOutcome =
  /** The file's bytes were copied out by this call. */
  | 'protected'
  /** An earlier call already copied this file; the first copy is authoritative. */
  | 'already-protected'
  /** The path does not exist, so there is no prior state to preserve. */
  | 'absent'
  /** The path exists but is not a regular file. */
  | 'not-a-file'

/** One protection attempt's result, for the caller and for the log. */
export interface ProtectResult {
  /** The path as the caller gave it. */
  readonly path: string
  /** What happened. */
  readonly outcome: ProtectOutcome
  /**
   * Absolute path of the copy kept for this file, present exactly when one
   * exists (`protected` and `already-protected`).
   *
   * This is the address a restore needs: copying it back over {@link path}
   * returns the file to the state from before its first change in this session.
   * An `already-protected` result reports the same address the first call
   * reported, because that first copy is the authoritative one.
   */
  readonly backup?: string
}

/** One protected file as the restore list reports it. */
export interface BackupEntry {
  /**
   * The copy's path inside the session's directory, `/`-separated.
   *
   * This is the restore request's key: the directory it is resolved against,
   * plus this path, is the copy to write back. Addressing the copy rather than
   * the target is what keeps a restore from naming a file no copy exists for.
   */
  readonly relative: string
  /** Absolute path a restore writes back to. */
  readonly path: string
  /**
   * The path to show for this copy: workspace-relative for a file the guard
   * protected inside the working directory, absolute for one outside it.
   */
  readonly name: string
  /** Absolute path of the copy itself, the address a user can also read on disk. */
  readonly backup: string
  /** `modified` — the file differs from its copy; `deleted` — the file is gone. */
  readonly state: 'modified' | 'deleted'
}

/**
 * One protected file compared with the file it stands for.
 *
 * `text` carries a line comparison; every other kind exists because the sides
 * cannot be shown line by line, and the byte sizes are all the detail view can
 * say about them.
 */
export interface BackupComparison {
  /** The copy's path inside the session's directory, the key the view was opened with. */
  readonly relative: string
  /** Absolute path the current file occupies, or would occupy after a restore. */
  readonly path: string
  /** The path the list shows for this file. */
  readonly name: string
  /** `modified` — the file differs from its copy; `deleted` — the file is gone. */
  readonly state: 'modified' | 'deleted'
  /** What the two sides are, for the reader. */
  readonly kind: ComparisonKind
  /** Bytes the copy holds. */
  readonly beforeBytes: number
  /** Bytes the current file holds; zero when it is gone. */
  readonly afterBytes: number
  /** The line comparison, present exactly when {@link kind} is `text`. */
  readonly comparison?: Comparison
}

/**
 * A restore that names no copy this session holds.
 *
 * Distinguished from an I/O failure because the two need different answers: a
 * request naming nothing is the caller's mistake, while a copy that exists and
 * cannot be written is a failure of the machine.
 */
export class NoSuchBackupError extends Error {
  /**
   * @param session - the session whose directory was searched.
   * @param relative - the copy path that was not found under it.
   */
  constructor(session: string, relative: string) {
    super(`session ${JSON.stringify(session)} holds no backup at ${JSON.stringify(relative)}`)
    this.name = 'NoSuchBackupError'
  }
}

/**
 * Narrow view of the session, as the tool and event payloads present it.
 *
 * The session id is the backup's identity: it names the directory and it is what
 * archiving deletes. The working directory bounds only the automatic path.
 */
interface SessionLike {
  readonly id?: string
  readonly header?: { readonly cwd?: string }
}

/** Narrow view of the agent the harness attaches to a payload. */
interface AgentLike {
  readonly session?: SessionLike
}

/** The `tools/pre-execute` fields this module reads. */
interface ToolExecutionLike {
  readonly name?: string
  readonly arguments?: unknown
  readonly agent?: AgentLike
}

/** Where one file's copy goes, and under what name. */
interface Placement {
  /** Session whose directory receives the copy. */
  readonly sessionKey: string
  /** Path inside that directory, `/`-separated. */
  readonly relativePath: string
}

/**
 * Copies files out of a session's reach before anything changes them.
 *
 * One instance is created per plugin load and disposed with the plugin fiber.
 * What it remembers is which files each session already copied, which is what
 * makes the first copy authoritative and later ones free.
 */
export class FileGuard {
  private readonly directory: string
  private readonly denyDestructiveCommands: boolean
  /** Paths already copied, keyed by session. */
  private readonly protected_ = new Map<string, Set<string>>()
  /**
   * Paths this run watched appear, keyed by session.
   *
   * A file the AI created has no prior state to preserve while the session that
   * created it is still running, and this is what keeps it unprotected for that
   * window. Deliberately memory-only: a later session constructs a new guard, so
   * a file created earlier reads as pre-existing and is protected on its first
   * change there.
   */
  private readonly created = new Map<string, Set<string>>()
  /** Closed sessions cannot recreate backups while their cancelled tools settle. */
  private readonly archived = new Set<string>()

  /** Allow protection again after an explicit unarchive. */
  resume(session: string): void {
    this.archived.delete(sessionKeyOf(session))
  }

  /**
   * @param options - where copies are kept and the shell policy.
   */
  constructor(options: FileGuardOptions) {
    this.directory = options.directory
    this.denyDestructiveCommands = options.denyDestructiveCommands
  }

  /** Root directory holding every session's protected files. */
  get root(): string {
    return this.directory
  }

  /**
   * Copy one file out, once per session.
   * @param agent - the calling agent; its session owns the copy.
   * @param declared - the file to protect, absolute or relative to its working directory.
   * @returns what happened, which the callers report rather than infer.
   */
  async protect(agent: AgentLike | undefined, declared: string): Promise<ProtectResult> {
    const placement = this.place(agent, declared)
    if (placement === undefined) return { path: declared, outcome: 'absent' }
    const { sessionKey, relativePath } = placement
    if (this.archived.has(sessionKey)) return { path: declared, outcome: 'absent' }
    const destination = join(this.directory, sessionKey, relativePath)
    const known = this.protectedFor(sessionKey)
    // The first copy is the state from before anything touched the file, so a
    // later call must not replace it with the already-damaged version. The
    // address is reported either way: the caller needs it to restore, and the
    // first copy's address is the one that holds the pre-change state.
    if (known.has(relativePath)) return { path: declared, outcome: 'already-protected', backup: destination }
    // A file this run watched appear is the AI's own creation: while that is
    // still the session doing the work, there is no earlier state to keep.
    if (this.createdFor(sessionKey).has(relativePath)) return { path: declared, outcome: 'absent' }

    const target = resolveTarget(agent, declared)
    if (target === undefined) return { path: declared, outcome: 'absent' }
    let info
    try {
      info = await stat(target)
    } catch (error: unknown) {
      if (isMissing(error)) {
        // Remember the absence: a tool naming a missing file is creating it, and
        // its later edits in this session are the same creation continuing.
        this.createdFor(sessionKey).add(relativePath)
        return { path: declared, outcome: 'absent' }
      }
      throw error
    }
    if (!info.isFile()) return { path: declared, outcome: 'not-a-file' }

    await mkdir(dirname(destination), { recursive: true })
    await copyFile(target, destination)
    // An archive can arrive while mkdir/copyFile is in flight. Sweep once more
    // rather than leaving a late copy behind after the lifecycle cleanup.
    if (this.archived.has(sessionKey)) {
      await this.archive(agent!.session!.id!)
      return { path: declared, outcome: 'absent' }
    }
    known.add(relativePath)
    return { path: declared, outcome: 'protected', backup: destination }
  }

  /**
   * Protect every path one `worktree_backup` call declared.
   * @param agent - the calling agent, whose session owns the copies.
   * @param paths - paths to protect, absolute or relative to the working directory.
   * @returns the per-path outcomes the tool reports back to the model.
   */
  async protectAll(agent: AgentLike | undefined, paths: readonly string[]): Promise<readonly ProtectResult[]> {
    const results: ProtectResult[] = []
    for (const path of paths) results.push(await this.protect(agent, path))
    return results
  }

  /**
   * List one session's backups whose file is not what the copy holds.
   *
   * The copy tree is the whole record, so this walks it rather than consulting
   * an index: one directory per session, the file's own path below it. A copy
   * whose file is byte-identical is left out — the copy was not needed, and
   * reporting it as changed would invite a restore that changes nothing. A copy
   * outside the working directory whose original path cannot be reconstructed
   * (a UNC share) is left out rather than pointed at a guessed location.
   * @param session - the session whose backups to list.
   * @param workspace - the absolute working directory the relative copies restore into.
   * @returns the changed and deleted files, by name.
   */
  async list(session: string, workspace: string): Promise<readonly BackupEntry[]> {
    const directory = join(this.directory, sessionKeyOf(session))
    const entries: BackupEntry[] = []
    for (const relative of (await copiesUnder(directory)).sort()) {
      const target = targetOf(workspace, relative)
      if (target === undefined) continue
      const state = await difference(join(directory, relative), target)
      if (state === undefined) continue
      entries.push({
        relative,
        path: target,
        name: nameOf(relative, target),
        backup: join(directory, relative),
        state,
      })
    }
    return entries
  }

  /**
   * Copy one backup back over the file it came from.
   *
   * The copy is the state from before this session's first change, so writing it
   * back is what undoes that change — including for a file that was deleted, in
   * which case the directory holding it is created again. The backup itself is
   * kept: it stays the session's record of the original, and a later restore of
   * the same file uses it again.
   * @param session - the session holding the backup.
   * @param workspace - the absolute working directory the relative copies restore into.
   * @param relative - the copy's path below the session directory, as listed.
   * @returns the absolute path written, and the bytes copied.
   * @throws {NoSuchBackupError} when no copy exists at that path.
   */
  async restore(session: string, workspace: string, relative: string): Promise<{ readonly path: string; readonly bytes: number }> {
    const directory = join(this.directory, sessionKeyOf(session))
    const source = contained(directory, relative)
    const target = source === undefined ? undefined : targetOf(workspace, relative)
    if (source === undefined || target === undefined) throw new NoSuchBackupError(session, relative)
    let info
    try {
      info = await stat(source)
    } catch (error: unknown) {
      if (isMissing(error)) throw new NoSuchBackupError(session, relative)
      throw error
    }
    if (!info.isFile()) throw new NoSuchBackupError(session, relative)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target)
    return { path: target, bytes: info.size }
  }

  /**
   * Compare one protected file with the file it stands for.
   *
   * The two sides are read from disk: the copy the guard kept before this
   * session first changed the file, and the file where it is now. The read is
   * lazy — the list never reads content — and bounded, because a copy can be any
   * size: a side over the byte cap is reported without content rather than
   * loaded, and a side that is not UTF-8 text (a document, an archive, an
   * image — the formats the guard deliberately protects) is reported as binary.
   *
   * The target is resolved from the session's own working directory, exactly as
   * a restore resolves it: the request names a copy, never a path to read.
   * @param session - the session holding the copy.
   * @param workspace - the absolute working directory the copy's path resolves against.
   * @param relative - the copy's path below the session directory.
   * @returns the comparison, or the reason content cannot be shown line by line.
   * @throws {NoSuchBackupError} when no copy exists at that path.
   */
  async compare(session: string, workspace: string, relative: string): Promise<BackupComparison> {
    const directory = join(this.directory, sessionKeyOf(session))
    const source = contained(directory, relative)
    const target = source === undefined ? undefined : targetOf(workspace, relative)
    if (source === undefined || target === undefined) throw new NoSuchBackupError(session, relative)
    let copyInfo
    try {
      copyInfo = await stat(source)
    } catch (error: unknown) {
      if (isMissing(error)) throw new NoSuchBackupError(session, relative)
      throw error
    }
    if (!copyInfo.isFile()) throw new NoSuchBackupError(session, relative)

    const name = nameOf(relative, target)
    let fileInfo
    try {
      fileInfo = await stat(target)
    } catch (error: unknown) {
      if (!isMissing(error)) throw error
      fileInfo = undefined
    }
    const state = fileInfo === undefined ? 'deleted' : 'modified'
    // A path that is no longer a regular file holds no text to compare; the
    // reason is the answer, because reading it would fail for a directory.
    if (fileInfo !== undefined && !fileInfo.isFile()) {
      return { relative, path: target, name, state, kind: 'unreadable', beforeBytes: copyInfo.size, afterBytes: 0 }
    }
    const beforeBytes = copyInfo.size
    const afterBytes = fileInfo === undefined ? 0 : fileInfo.size
    if (beforeBytes > MAX_COMPARISON_BYTES || afterBytes > MAX_COMPARISON_BYTES) {
      return { relative, path: target, name, state, kind: 'oversized', beforeBytes, afterBytes }
    }

    const [copyBytes, fileBytes] = await Promise.all([
      readFile(source),
      fileInfo === undefined ? Promise.resolve(undefined) : readFile(target),
    ])
    const before = decodeText(copyBytes)
    const after = fileBytes === undefined ? null : decodeText(fileBytes)
    if (before === undefined || after === undefined) {
      return { relative, path: target, name, state, kind: 'binary', beforeBytes, afterBytes }
    }
    return {
      relative, path: target, name, state, kind: 'text', beforeBytes, afterBytes,
      comparison: compareTexts(before, after),
    }
  }

  /**
   * Delete one session's backups.
   *
   * Called when the session is archived, which is what makes the protection
   * lifetime the session's lifetime. A repeated call for the same session does
   * nothing, so an archive path that fires twice cannot race itself.
   * @param session - the session whose backups should go.
   * @returns true when a directory was removed, false when there was nothing left.
   */
  async archive(session: string): Promise<boolean> {
    const key = sessionKeyOf(session)
    this.archived.add(key)
    this.protected_.delete(key)
    this.created.delete(key)
    const directory = join(this.directory, key)
    // Asked before the removal because a sweep calls this for every archived
    // session, and the log line is only worth printing when something was there.
    const present = await pathExists(directory)
    try {
      await rm(directory, { recursive: true, force: true })
    } catch (error: unknown) {
      // The lifecycle listener logs this and retains it for a later retry.
      // Never mark a failed removal as handled, or confuse it with an absent copy.
      throw new Error(`could not remove backups for session ${JSON.stringify(session)} at ${JSON.stringify(directory)}: ${String(error)}`, { cause: error })
    }
    if (present) console.log(`dsh-worktree: removed the backups of archived session ${session}`)
    return present
  }

  /**
   * Handle one `tools/pre-execute`: protect what the call names, or refuse a
   * destructive shell command so the model declares its targets first.
   * @param execution - the pending call, with parsed arguments.
   * @param next - the pipeline's delegate; called exactly once on the allow path.
   * @returns the pipeline decision.
   */
  async beforeTool(execution: ToolExecutionLike, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> {
    const agent = execution.agent
    const workspace = workspaceOf(agent)
    if (workspace === undefined) return next()
    const name = execution.name
    if (name !== undefined && SHELL_TOOLS.some(tool => tool === name)) {
      const command = commandOf(execution.arguments)
      if (this.denyDestructiveCommands && command !== undefined && DESTRUCTIVE_COMMAND.test(stripQuoted(command))) {
        return {
          kind: 'deny',
          reason: `"${name}" looks like it deletes files, and a deletion cannot be recovered once it runs. `
            + `Call ${BACKUP_TOOL_NAME} first with the files or directories this command will touch, then retry it.`,
        }
      }
      return next()
    }
    // A path argument alone is not a write intent: read/read_image use it too.
    if (name !== 'write' && name !== 'edit') return next()
    const declared = fileTarget(execution.arguments)
    if (declared === undefined) return next()
    // Awaited on purpose: the copy must be durable before the tool body runs, or
    // the "backup" would race the very write it exists to precede. Measured at
    // 0.94 ms per file.
    const result = await this.protect(agent, declared)
    if (result.outcome === 'protected') {
      // Nothing else records this: the copy tree is the record, and the log is
      // the only place a reader learns a file was taken before its first change.
      // The address is part of that record — without it the copy is unfindable.
      console.log(`dsh-worktree: protected ${result.path} before change, kept at ${result.backup}`)
    }
    return next()
  }

  /**
   * Where one file's copy belongs.
   *
   * A file inside the session's working directory keeps its workspace-relative
   * path, so recovery is a plain copy back. A file outside it — another
   * directory, another drive — is placed under `external/` with its own path
   * preserved, which keeps every backup addressable without an index.
   * @param agent - the calling agent.
   * @param declared - the path as declared.
   * @returns the destination, or undefined when there is no session to own it.
   */
  private place(agent: AgentLike | undefined, declared: string): Placement | undefined {
    const session = agent?.session?.id
    if (typeof session !== 'string' || session.length === 0) return undefined
    const sessionKey = sessionKeyOf(session)
    const target = resolveTarget(agent, declared)
    if (target === undefined) return undefined
    const workspace = workspaceOf(agent)
    if (workspace !== undefined) {
      const inside = relativePathOf(workspace, target)
      if (inside !== undefined) return { sessionKey, relativePath: inside }
    }
    return { sessionKey, relativePath: `${EXTERNAL_SEGMENT}/${externalPathOf(target)}` }
  }

  /** The set of paths one session has already copied. */
  private protectedFor(sessionKey: string): Set<string> {
    return this.setFor(this.protected_, sessionKey)
  }

  /** The set of paths this run watched appear for one session. */
  private createdFor(sessionKey: string): Set<string> {
    return this.setFor(this.created, sessionKey)
  }

  /** One session's set inside a keyed map, created on first use. */
  private setFor(map: Map<string, Set<string>>, key: string): Set<string> {
    let known = map.get(key)
    if (known === undefined) {
      known = new Set()
      map.set(key, known)
    }
    return known
  }
}

/**
 * Install file protection on one Host context.
 *
 * The registration rides the plugin's fiber, so unloading the plugin stops the
 * guard without touching anything already copied. The declaration tool and the
 * archive cleanup are wired by the plugin entry, which owns the registrations
 * that need other services.
 * @param ctx - the Host plugin context.
 * @param options - where copies are kept and the shell policy.
 * @returns the guard, for the other registrations and for the spec suite.
 */
export function installFileGuard(ctx: Context, options: FileGuardOptions): FileGuard {
  const guard = new FileGuard(options)
  ctx.effect(
    () => ctx.on('tools/pre-execute', (execution: ToolExecution, next: () => Promise<PreToolDecision>) => (
      guard.beforeTool(execution, next)
    )),
    'dsh-worktree: protect files before tools may change them',
  )
  return guard
}

/**
 * The path a declared value names, resolved against the session's directory.
 * @param agent - the calling agent, whose session supplies the base directory.
 * @param declared - the path as declared.
 * @returns the absolute path, or undefined when there is no session.
 */
function resolveTarget(agent: AgentLike | undefined, declared: string): string | undefined {
  const session = agent?.session?.id
  if (typeof session !== 'string' || session.length === 0) return undefined
  if (isAbsolute(declared)) return resolve(declared)
  const cwd = workspaceOf(agent)
  if (cwd === undefined) return undefined
  return resolve(cwd, declared)
}

/**
 * The working directory a call protects: the caller session's own.
 * @param agent - the agent the payload carries.
 * @returns the absolute working directory, or undefined when unknown.
 */
function workspaceOf(agent: AgentLike | undefined): string | undefined {
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd.length === 0) return undefined
  return isAbsolute(cwd) ? resolve(cwd) : undefined
}

/**
 * The file a tool call declared, when it declares one.
 * @param args - the call's parsed arguments.
 * @returns the declared path, or undefined for a tool that names no file.
 */
function fileTarget(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  for (const key of FILE_TARGET_ARGUMENTS) {
    const value = (args as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return undefined
}

/**
 * The command text a shell call is about to run.
 * @param args - the call's parsed arguments.
 * @returns the command string, or undefined for another argument shape.
 */
function commandOf(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  for (const key of ['command', 'script', 'cmd']) {
    const value = (args as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return undefined
}

/**
 * Blank out quoted spans so a quoted word is not read as a command.
 *
 * `echo "rm -rf /"` writes text; `rm -rf /` deletes. Only the second is refused.
 * @param command - the command text.
 * @returns the text with single- and double-quoted spans removed.
 */
function stripQuoted(command: string): string {
  return command.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''")
}

/**
 * Express one absolute path relative to its workspace.
 * @param workspace - absolute workspace root.
 * @param target - absolute path.
 * @returns the `/`-separated relative path, or undefined when outside.
 */
function relativePathOf(workspace: string, target: string): string | undefined {
  const rel = relative(workspace, target)
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) return undefined
  return rel.split(sep).join('/')
}

/**
 * The path a target keeps when it lies outside the session's directory.
 *
 * A drive-qualified path keeps its drive letter (`c/Users/...`), and a UNC path
 * collapses to its share, so two files with the same tail on different volumes
 * never collide.
 * @param target - absolute path outside the workspace.
 * @returns a `/`-separated path below `external/`.
 */
function externalPathOf(target: string): string {
  const slashed = resolve(target).replace(/\\/g, '/')
  const withoutLeadingSlashes = slashed.replace(/^\/+/, '')
  return withoutLeadingSlashes.replace(/:/g, '')
}

/**
 * Every copy below a session directory, as `/`-separated paths relative to it.
 *
 * The tree is walked rather than indexed: one copy per file means the tree is
 * the record, and a directory that was never created is simply an empty list.
 * @param directory - the session's directory.
 * @param prefix - the path of `directory` below the walk's root, empty at the top.
 * @returns the copy paths, in directory order.
 */
async function copiesUnder(directory: string, prefix = ''): Promise<string[]> {
  const found: string[] = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error: unknown) {
    if (isMissing(error)) return found
    throw error
  }
  for (const entry of entries) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) found.push(...await copiesUnder(join(directory, entry.name), path))
    else if (entry.isFile()) found.push(path)
  }
  return found
}

/**
 * The absolute file one copy restores to.
 *
 * A workspace-relative copy names a file below the session's working directory.
 * A copy under `external/` names one outside it, and its absolute path is
 * reconstructed from the same rule {@link externalPathOf} wrote — which is why a
 * path that rule cannot express exactly is refused instead of guessed: a Windows
 * share has no drive letter to restore, and a POSIX path can start with a letter
 * that would read as one.
 * @param workspace - the absolute working directory.
 * @param relative - the copy path below the session directory.
 * @returns the absolute target, or undefined when no target can be reconstructed.
 */
function targetOf(workspace: string, relative: string): string | undefined {
  if (relative === EXTERNAL_SEGMENT || relative.startsWith(`${EXTERNAL_SEGMENT}/`)) {
    return externalTargetOf(relative.slice(EXTERNAL_SEGMENT.length + 1))
  }
  return resolve(workspace, relative)
}

/**
 * Reverse one path below `external/` back into an absolute path.
 *
 * Resolved rather than returned as spelled, so a reconstructed Windows path is
 * platform-native (`C:/x` becomes `C:\x`) and reads the same as the path the
 * copy was taken from.
 * @param relative - the `/`-separated path below `external/`.
 * @returns the absolute path, or undefined when this platform has no exact inverse.
 */
function externalTargetOf(relative: string): string | undefined {
  if (process.platform !== 'win32') return resolve(`/${relative}`)
  const [drive, ...rest] = relative.split('/')
  if (drive === undefined || !/^[A-Za-z]$/u.test(drive)) return undefined
  return resolve(`${drive.toUpperCase()}:/${rest.join('/')}`)
}

/**
 * The path the restore list shows for one copy.
 *
 * A copy outside the working directory has no workspace-relative form, so the
 * absolute path it restores to is its name; showing the internal `external/…`
 * spelling instead would name a directory the user never created.
 * @param relative - the copy path below the session directory.
 * @param target - the absolute path the copy restores to.
 * @returns the display path.
 */
function nameOf(relative: string, target: string): string {
  return relative.startsWith(`${EXTERNAL_SEGMENT}/`) ? target : relative
}

/**
 * Resolve one copy path below its directory, refusing anything that leaves it.
 *
 * The path arrives from the browser, so it is the one input that could name a
 * file outside the session's own tree; a resolution that escapes, or that is
 * not a relative path at all, has no copy behind it.
 * @param directory - the session's directory.
 * @param relative - the copy path as requested.
 * @returns the absolute copy path, or undefined when it is not inside `directory`.
 */
function contained(directory: string, relative: string): string | undefined {
  if (relative.length === 0 || isAbsolute(relative)) return undefined
  const target = resolve(directory, relative)
  return relative_(directory, target) === undefined ? undefined : target
}

/** `path.relative` as a containment test: undefined when the child is not below the parent. */
function relative_(parent: string, child: string): string | undefined {
  const back = relative(parent, child)
  return back.length === 0 || back.startsWith('..') || isAbsolute(back) ? undefined : back
}

/**
 * How one copy differs from the file it holds.
 *
 * Compared by content, not by a timestamp: the copy is written when the change
 * is about to happen, so a metadata comparison would report every copy as
 * changed. A path that is gone is `deleted`; one that is no longer a regular
 * file cannot equal the copy either.
 * @param copy - absolute path of the copy.
 * @param target - absolute path of the file.
 * @returns the difference, or undefined when the two hold the same bytes.
 */
async function difference(copy: string, target: string): Promise<'modified' | 'deleted' | undefined> {
  let info
  try {
    info = await stat(target)
  } catch (error: unknown) {
    if (isMissing(error)) return 'deleted'
    throw error
  }
  if (!info.isFile()) return 'modified'
  return await sameBytes(copy, target) ? undefined : 'modified'
}

/** Bytes compared per read; large enough to keep syscalls rare, small enough to stay cheap. */
const COMPARE_CHUNK = 64 * 1024

/**
 * Bytes one side of a comparison may hold.
 *
 * Reading is what turns a sidebar click into memory and CPU, so a file above
 * this bound is reported with its size instead of being loaded: the copy has no
 * size cap, and a single 3 GB file must not be read to fill a pane.
 */
const MAX_COMPARISON_BYTES = 2 * 1024 * 1024

/**
 * Whether two files hold the same bytes, stopping at the first difference.
 * @param left - absolute path of the first file.
 * @param right - absolute path of the second file.
 * @returns true when every byte matches.
 */
async function sameBytes(left: string, right: string): Promise<boolean> {
  const [first, second] = await Promise.all([open(left, 'r'), open(right, 'r')])
  try {
    const leftChunk = Buffer.allocUnsafe(COMPARE_CHUNK)
    const rightChunk = Buffer.allocUnsafe(COMPARE_CHUNK)
    for (;;) {
      const [a, b] = await Promise.all([
        first.read(leftChunk, 0, COMPARE_CHUNK, null),
        second.read(rightChunk, 0, COMPARE_CHUNK, null),
      ])
      if (a.bytesRead !== b.bytesRead) return false
      if (a.bytesRead === 0) return true
      if (!leftChunk.subarray(0, a.bytesRead).equals(rightChunk.subarray(0, b.bytesRead))) return false
    }
  } finally {
    await Promise.all([first.close(), second.close()])
  }
}

/**
 * Decode one side of a comparison as UTF-8 text.
 *
 * A NUL byte is what other diff tools also use as the text/binary boundary, and
 * a byte sequence that is not valid UTF-8 (UTF-16, a legacy code page, a zip
 * container) is not text this view could render faithfully. Neither is an
 * error: the caller reports the side as binary and leaves the restore intact.
 * @param bytes - the side's bytes.
 * @returns the text, or undefined when the bytes are not UTF-8 text.
 */
function decodeText(bytes: Buffer): string | undefined {
  if (bytes.includes(0)) return undefined
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // Invalid UTF-8 is the answer to "is this text", not a failure to report.
    return undefined
  }
}

/**
 * Directory name for one session id.
 *
 * Hashed rather than used verbatim: a session id is opaque and may contain
 * characters a directory name cannot, and the mapping is one-way on purpose —
 * the backup directory is browsed by its file tree, not by session id.
 * @param session - the session id.
 * @returns a 32-character hexadecimal key.
 */
function sessionKeyOf(session: string): string {
  return createHash('sha256').update(session).digest('hex').slice(0, 32)
}

/** Whether a failure means the path simply is not there. */
function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * Whether one path exists, file or directory.
 * @param path - the absolute path to look for.
 * @returns true when it is there.
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error: unknown) {
    if (isMissing(error)) return false
    throw error
  }
}
