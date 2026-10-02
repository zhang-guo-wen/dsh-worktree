/**
 * The overlay seat for the archive flow's second notice.
 *
 * One banner per checkout removal the Host performed, rendered in the frame's
 * own floating layer beside the Workspace surface's "Session archived" toast.
 * All the bookkeeping lives in `checkout-notice-store.ts`; this module only
 * renders the head of the queue its observer publishes.
 *
 * Both outcomes get a banner because both are facts the user would otherwise
 * have to infer from a checkout directory that may or may not still be there. A
 * refusal carries the Host's own reason, so "archived but kept" never reads as
 * "archived and cleaned up".
 *
 * @module @guowenzhang/dsh-worktree/client/checkout-notice
 */

import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CheckoutNotice, CheckoutProbe } from './checkout-notice-store.ts'
// Type-only: pulls the ui-layout SlotMap merge (`shell.overlay`).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

export type {
  CheckoutNotice, CheckoutProbe, NoticedWorkspace, NoticeQueue, WorkspacesFace,
} from './checkout-notice-store.ts'
export { observeCheckouts } from './checkout-notice-store.ts'

/** The seat's injected face. */
export interface CheckoutNoticeInjected {
  hooks: {
    /**
     * Banner queue bound by the renderer as `useNotices`: the seat is a pure
     * renderer of what the observer publishes.
     */
    notices: SnapshotStore<CheckoutNotice[]>
  }
  /** Asks the Host what happened to a path whose row disappeared. */
  probe: CheckoutProbe
  /** Resolves one banner's copy in this plugin's locale. */
  text: (notice: CheckoutNotice) => string
  /** Drops the banner once it finished fading. */
  dismiss: (seq: number) => void
}

/** Full component props for the overlay seat. */
export type CheckoutNoticeProps =
  PropsRuntime<'shell.overlay'>
  & InjectFace<CheckoutNoticeInjected>

/**
 * Render the current banner.
 * @param props - the banner queue, the localized copy, and the dismisser.
 * @returns the banner, or null while nothing was removed.
 */
export function CheckoutNoticeToast({ useNotices, text, dismiss }: CheckoutNoticeProps) {
  const head = useNotices(queue => queue[0])
  if (head === undefined) return null
  return (
    <Toast
      key={`worktree-checkout-${String(head.seq)}`}
      text={text(head)}
      // A refusal keeps the warning tint with its own glyph; a removal takes the
      // design's success treatment, which brings its own.
      {...head.outcome === 'removed' ? { tone: 'success' as const } : { icon: <IconWarningOutlineRegular /> }}
      onDone={() => { dismiss(head.seq) }}
    />
  )
}
