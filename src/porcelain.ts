/**
 * Parsing of Git's machine-readable output.
 *
 * The listings are the authority for every worktree this plugin will accept a
 * command against: a path handed back from the model is matched against a
 * parsed record before it can become a git argument, so an invented path can
 * never reach `git worktree remove`. Prunable records are kept in the parse
 * result (their presence is a fact the caller reports) and filtered by the
 * consumers that act on live checkouts. The branch listing is what the browser
 * half offers as the base of a new branch, so it is parsed here too rather than
 * re-split at each caller.
 * @module @zhang-guo-wen/dsh-worktree/porcelain
 */

/** One parsed `git worktree list --porcelain` record. */
export interface WorktreeRecord {
  /** Absolute checkout path as Git reports it (may still carry symlinks). */
  readonly path: string
  /** Short branch name, or `HEAD` for a detached checkout. */
  readonly branch: string
  /** Full commit id the worktree currently has checked out. */
  readonly head: string
  /** Whether Git holds a lock entry for this worktree. */
  readonly locked: boolean
  /** Whether Git reports the administrative metadata as prunable (checkout gone). */
  readonly prunable: boolean
}

/**
 * Parse porcelain records, accepting both the newline-separated form and the
 * NUL-separated form produced by `-z`.
 *
 * Records are separated by a blank line in the newline form and by a bare NUL
 * in the `-z` form; fields within a record are `key value` pairs. Only the
 * fields this plugin consumes are read, and unknown keys are ignored so a
 * future Git addition cannot fail the parse.
 * @param output - raw stdout of `git worktree list --porcelain[-z]`.
 * @returns one record per worktree, in Git's own order (main worktree first).
 */
export function parseWorktreeList(output: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = []
  let path: string | undefined
  let branch = 'HEAD'
  let head = ''
  let locked = false
  let prunable = false

  const flush = (): void => {
    if (path === undefined) return
    records.push({ path, branch, head, locked, prunable })
    path = undefined
    branch = 'HEAD'
    head = ''
    locked = false
    prunable = false
  }

  // `-z` separates records with NUL; the newline form separates them with a
  // blank line. Splitting on NUL and treating an empty chunk as "no record"
  // covers both, because the newline form then yields one chunk per record
  // whose lines are split below.
  for (const chunk of output.split('\0')) {
    for (const line of chunk.split('\n')) {
      if (line === '') {
        // A blank line ends a newline-form record. In the `-z` form every
        // record's trailing newline produces this same empty line, so the
        // flush is idempotent there.
        flush()
        continue
      }
      if (line.startsWith('worktree ')) {
        // A new `worktree` key with one already open means the previous record
        // was not terminated by a blank line; close it before starting another.
        flush()
        path = line.slice('worktree '.length)
        continue
      }
      if (line.startsWith('branch ')) {
        branch = shortBranch(line.slice('branch '.length))
        continue
      }
      if (line.startsWith('HEAD ')) {
        head = line.slice('HEAD '.length)
        continue
      }
      if (line === 'locked' || line.startsWith('locked ')) {
        locked = true
        continue
      }
      if (line === 'prunable' || line.startsWith('prunable ')) {
        prunable = true
      }
    }
  }
  flush()
  return records
}

/**
 * Reduce a full ref to the short branch name Git would print.
 * @param ref - a full ref such as `refs/heads/feature/x`.
 * @returns the short name, or the input unchanged when it is not a `refs/heads` ref.
 */
function shortBranch(ref: string): string {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
}

/**
 * The live checkouts of a listing: prunable records name administrative
 * metadata whose checkout directory is already gone, so no command may target
 * them.
 * @param records - parsed porcelain records.
 * @returns the records whose checkout still exists.
 */
export function liveWorktrees(records: readonly WorktreeRecord[]): WorktreeRecord[] {
  return records.filter(record => !record.prunable)
}

/**
 * Parse `git for-each-ref --format=%(refname:short) refs/heads` output.
 *
 * One branch name per line: a ref name cannot contain a newline or be empty, so
 * a blank line is the only malformed record and it is dropped rather than
 * becoming an empty branch the caller could select.
 * @param output - raw stdout of the branch listing.
 * @returns the short branch names, in Git's own order.
 */
export function parseBranchList(output: string): string[] {
  return output.split('\n').filter(line => line !== '')
}
