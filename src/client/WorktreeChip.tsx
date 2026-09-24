/**
 * The worktree control on the new-session screen.
 *
 * One pill holds both facts the choice is made of: the local branch a new
 * branch starts from, and whether the session moves into a new checkout at all.
 * It sits beside the workspace picker and the agent-preset chip and follows
 * their geometry — the same ghost row, the same rounded ends — drawn one step
 * smaller and clear of the composer card's corner.
 *
 * A session's working directory is fixed at creation, so this control is
 * available only while the session is blank and the choice cannot be revised
 * afterwards — starting a new session is the way to change it.
 *
 * The worktree half is one-way: checking it creates the checkout and starts the
 * session inside it, and nothing checks it back off. A failed start leaves it
 * unchecked with its reason, and the next check retries.
 * @module @guowenzhang/dsh-worktree/client/WorktreeChip
 */

import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconBranchOutlineRegular, IconChevronDownOutlineRegular, IconProjectAddOutlineRegular,
  IconWarningOutlineRegular, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the hero controls).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorktreeSeatState } from './seat-store.ts'
import css from './WorktreeChip.module.css'

/** Registration-side business face for the control. */
export interface WorktreeChipInjected {
  hooks: {
    /** Seat snapshot bound by the renderer as useWorktreeSeat. */
    worktreeSeat: SnapshotStore<WorktreeSeatState>
    /** Whether this Session may still choose (no turn has run yet). */
    editable: SnapshotStore<boolean>
  }
  /**
   * Probe one Session's directory and keep the seat current until it closes.
   * @param sessionId - the Session the composer belongs to.
   * @returns resolution once the probe settled; the subscription outlives it.
   */
  load: (sessionId: string) => Promise<void>
  /** Read the local branches the base can be picked from. */
  loadBranches: () => Promise<void>
  /** Stage the local branch a new branch starts from. */
  selectBase: (base: string) => void
  /** Stage the choice, which creates the checkout and starts the Session. */
  setEnabled: (enabled: boolean) => void
}

/** Full component props. */
export type WorktreeChipProps =
  PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'worktree'>
  & InjectFace<WorktreeChipInjected>

/**
 * Render the worktree control.
 * @param props - composed slot props.
 * @returns the pill, or null when this Session is not a Git repository or can no longer choose.
 */
export function WorktreeChip({
  session, useWorktreeSeat, useEditable, load, loadBranches, selectBase, setEnabled, t,
}: WorktreeChipProps) {
  const state = useWorktreeSeat(snapshot => snapshot)
  const editable = useEditable(value => value)
  const [open, setOpen] = useState(false)

  // Probe the Session this composer belongs to. The dock renders only for a
  // Session, so its owner props are the authoritative identity here.
  useEffect(() => {
    void load(session.sessionId)
  }, [load, session.sessionId])

  // Hidden twice over: the deployment may have no repository to isolate, and a
  // Session that already ran a turn can no longer choose its directory. The
  // second condition is the visible consequence of the immutable header cwd,
  // so the control disappears rather than offering an action the Host would refuse.
  if (!state.visible || !editable) return null

  const busy = state.creating
  // An isolated Session reports the choice that put it there and offers no
  // change: the branch it was created from, checked, with the branch it now
  // holds in the tooltip. The alternative is a checkout inside a checkout.
  const locked = state.isolated
  const baseLabel = state.base === 'HEAD' ? t('branch.head') : state.base
  const lockedHint = t('seat.applied', { branch: state.checkoutBranch })
  // Before the first read the staged base is the only known branch, so the menu
  // offers it rather than opening empty.
  const options = state.branches ?? [state.base]
  return (
    <div className={css.row}>
      <div className={css.pill}>
        <Menu
          open={open}
          onClose={() => { setOpen(false) }}
          items={options.map(name => ({ id: name, label: name }))}
          selectedId={state.base}
          onSelect={(id) => {
            setOpen(false)
            selectBase(id)
          }}
          align="start"
          portal
          anchor={(
            <button
              type="button"
              className={css.branch}
              aria-haspopup="menu"
              aria-expanded={open}
              title={locked ? lockedHint : t('branch.hint')}
              disabled={busy || locked}
              onClick={() => {
                if (!open) void loadBranches()
                setOpen(value => !value)
              }}
            >
              <IconBranchOutlineRegular className={css.branchIcon} size={14} />
              <span className={css.branchLabel}>{baseLabel}</span>
              {!locked && <IconChevronDownOutlineRegular className={css.chevron} size={12} />}
            </button>
          )}
        />
        <span className={css.divider} aria-hidden="true" />
        <label className={css.seat} title={locked ? lockedHint : state.error ?? t('seat.hint')}>
          <input
            type="checkbox"
            checked={state.enabled || locked}
            disabled={busy || locked}
            // One-way: the choice is spent by the start it triggers, so there is
            // no check that turns it back off.
            onChange={() => { setEnabled(true) }}
          />
          {/* The glyph travels with the label text: the checkout this segment
              stages is registered as a workspace of its own, so it wears the
              product's own add-workspace mark. Decorative — the text beside it
              is the checkbox's accessible name. */}
          <span className={css.seatGlyph} aria-hidden="true">
            <IconProjectAddOutlineRegular size={14} />
          </span>
          <span>{busy ? t('seat.creating') : t('seat.label')}</span>
        </label>
        {state.error !== null && !locked && <IconWarningOutlineRegular className={css.seatIconError} size={14} />}
      </div>
    </div>
  )
}
