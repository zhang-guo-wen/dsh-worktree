/**
 * Carry the composer's draft across the Session switch a worktree start causes.
 *
 * The Host starts the worktree Session outside the Client's Session Controller
 * and then the control navigates to it. That navigation is a switch to another
 * Session, and the draft the user had typed belongs to the screen, not to the
 * Session: it must move with them. The reference implementation is the Host's
 * own workspace switch (`ui-conversation`'s `selectWorkspace`), which reads the
 * current input's semantic snapshot, stages it on the next Session, and only
 * then clears the old one. This module performs the same three steps around the
 * navigation, with the worktree start's extra requirement that a failure
 * anywhere leaves the source draft exactly where it was.
 *
 * Nothing here sends: a draft moves only as unsent content.
 * @module @guowenzhang/dsh-worktree/client/draft-transfer
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { DraftAttachmentId, DraftInput, DraftSnapshot, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** One frame's ownership of the two Sessions a draft moves between. */
    worktreeDraftTransfer: unknown
  }
}

/**
 * The input face as the Host's own cross-session carry uses it.
 *
 * The published `SessionInput.setDraft` is typed for plain text, while the
 * implementation behind it takes a full semantic draft — the same narrowing the
 * Host's own `selectWorkspace` relies on when it moves a draft with its
 * reference chips to another Session.
 */
type DraftInputFace = Omit<SessionInput, 'setDraft'> & {
  setDraft(draft: DraftInput): void
}

/** File receipts are Session-owned, so carried files are staged for their new owner. */
interface DraftConversation {
  readonly input: { for(actx: Context): DraftInputFace }
  rebindDraftFiles?: (sessionId: SessionId, ids: readonly DraftAttachmentId[]) => void
}

/**
 * Stage one semantic snapshot, degrading to plain text where the host's
 * `setDraft` takes only text.
 *
 * The published `SessionInput.setDraft` contract is plain text; the semantic
 * draft form is what the same implementation accepts on hosts whose composer
 * carries reference chips across sessions (0.2.1+). Older hosts (0.2.0-rc.x)
 * throw on the object, so the carry probes once per move: an empty semantic
 * draft is a no-op where the form is supported and throws before touching
 * state where it is not, and the degraded form rides the clipboard projection
 * — the same carry the Host's own workspace switch performs on those hosts.
 * A failing chip restoration is not a capability answer and still reaches the
 * caller's rollback.
 * @param next - the target Session's input face.
 * @param snapshot - the semantic draft to stage.
 */
function stageSnapshot(next: DraftInputFace, snapshot: DraftSnapshot): void {
  try {
    next.setDraft({ text: '', references: [] })
  } catch (_error) {
    next.setDraft(snapshot.text)
    return
  }
  next.setDraft(snapshot)
}

/**
 * Show a started Session, carrying the current draft onto it first.
 *
 * Both Sessions are retained for the whole move: the Client disposes a
 * Session's input shell — and with it every draft attachment — as soon as its
 * last reference goes, and navigation releases the one the user is leaving.
 * @param ctx - the scope the Client services resolve on.
 * @param sessions - the Client Sessions service.
 * @param sourceId - the Session whose draft is carried.
 * @param targetId - the Session the draft is carried to.
 * @param open - shows the target Session; a throw leaves the source untouched.
 * @throws when the draft cannot be staged on the target; the caller reports it.
 */
export function openWithDraft(
  ctx: Context, sessions: ISessions, sourceId: SessionId, targetId: SessionId, open: () => void,
): void {
  if (sourceId === targetId) { open(); return }
  // Resolved through ctx.get rather than injection: this runs from a click
  // handler, outside any inject activation of the conversation service.
  const conversation = ctx.get('conversation') as DraftConversation | undefined
  if (conversation === undefined) {
    throw new Error('worktree: the conversation service is unavailable, so the draft cannot be carried over')
  }
  const source = sessions.retain(sourceId, { source: 'worktreeDraftTransfer' })
  try {
    const from = conversation.input.for(source.binding.ctx)
    const draft = from.state.getSnapshot()
    if (draft.phase === 'adjudicating' || draft.phase === 'submitting') {
      throw new Error('worktree: wait for the current submission to finish before switching sessions')
    }
    if (draft.draft === '' && draft.attachmentIds.length === 0) { open(); return }
    const target = sessions.retain(targetId, { source: 'worktreeDraftTransfer' })
    try {
      const next = conversation.input.for(target.binding.ctx)
      const existing = next.state.getSnapshot()
      // The target is a Session this start just created, so anything here is a
      // draft that already belongs to somebody else: refusing beats overwriting.
      if (existing.draft !== '' || existing.attachmentIds.length > 0
        || existing.phase === 'adjudicating' || existing.phase === 'submitting') {
        throw new Error('worktree: the worktree session already holds a draft, so nothing was moved')
      }
      if (draft.attachmentIds.length > 0 && conversation.rebindDraftFiles === undefined) {
        throw new Error('worktree: this host cannot carry draft attachments across sessions')
      }
      // Called as a method of the resolved service, the way the Host's own
      // carry does: the upload behind a file draft is a per-Session receipt.
      const rebindFiles = (sessionId: SessionId): void => {
        conversation.rebindDraftFiles!(sessionId, draft.attachmentIds)
      }
      try {
        // One call carries text and reference chips together: the snapshot's
        // ranges are validated against its own text on the way in, so a chip
        // either arrives as a chip or the whole move fails and rolls back.
        stageSnapshot(next, {
          text: draft.draft,
          references: draft.occurrences.map(({ occurrenceId: _id, ...reference }) => reference),
        })
        if (draft.attachmentIds.length > 0) {
          if (!next.addAttachments(draft.attachmentIds)) {
            throw new Error('worktree: the worktree session refused the draft attachments')
          }
          rebindFiles(targetId)
        }
        open()
      } catch (error) {
        next.setDraft('')
        for (const id of draft.attachmentIds) next.removeAttachment(id)
        if (draft.attachmentIds.length > 0) rebindFiles(sourceId)
        throw error
      }
      // Only a navigation that actually happened spends the old draft, and only
      // now: clearing it earlier would lose the work if the open were refused.
      from.setDraft('')
      for (const id of draft.attachmentIds) from.removeAttachment(id)
    } finally {
      target.release()
    }
  } finally {
    source.release()
  }
}
