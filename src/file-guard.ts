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
 * @module @guowenzhang/dsh-worktree/file-guard
 */

import { createHash } from 'node:crypto'
import { copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Pulls the `tools/*` event declarations into this program's type face. The
// registration itself lives in the plugin entry, so this module carries no
// runtime dependency on the tool registry.
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
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
  /** Session keys whose backups were already removed, so a repeated archive is cheap. */
  private readonly archived = new Set<string>()

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
    this.protected_.delete(key)
    this.created.delete(key)
    if (this.archived.has(key)) return false
    this.archived.add(key)
    const directory = join(this.directory, key)
    try {
      await rm(directory, { recursive: true, force: true })
    } catch (error: unknown) {
      // The session is over either way; a backup directory that survives is
      // wasted space, never a wrong answer, so the failure is dropped rather
      // than thrown into the archive path.
      void error
      return false
    }
    return true
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
