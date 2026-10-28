/**
 * The sidebar's Git-accounts glyph.
 *
 * The sidebar owns the row: its button, its label, and its selected state. This
 * component only draws the branch mark at the edge the owner asks for, so the
 * icon is decorative and carries no label of its own.
 * @module @guowenzhang/dsh-worktree/client/git-accounts/GitAccountsIcon
 */

import type { ReactNode } from 'react'
import { IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the left Sidebar's SlotMap merge (`sidebar.panellist`).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the Git-accounts icon at the size the sidebar asks for.
 * @param props - the sidebar's icon share: the requested edge; `active` is the
 * owner's selection state, which this glyph does not style itself.
 * @returns the icon element.
 */
export function GitAccountsIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconBranchOutlineRegular size={size} />
}
