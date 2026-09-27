/**
 * The worktree settings page: the policy every later checkout is created under.
 *
 * Three rows, each the settings column's own two-column shape (label and
 * explanation left, control right), so this page reads like every other page
 * beside it. The rows are the three choices that actually change what a
 * checkout looks like: whether the child repositories come along, how deep the
 * search for them goes, and where the directory lands. Everything else the
 * entry accepts — the agent subdirectory, the git bound, the tool names — is
 * deployment composition, edited in the profile's own patch.
 *
 * The footer carries `[Reset to default] [Save]` together, which is why this
 * page renders its own frame instead of the shared one: the shared frame's
 * footer holds the save alone, and a reset that stands far from the rows it
 * clears is the control people forget exists. Staging and saving still come
 * from the shared form model.
 * @module @guowenzhang/dsh-worktree/client/SettingsSection
 */

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { WORKTREE_LAYOUTS } from '../policy.ts'
import { formLabels, type WorktreeCopyKey } from './locales.ts'
import type { WorktreeSettingsFace } from './settings-store.ts'
import css from './SettingsSection.module.css'

/** Full component props. */
export type WorktreeSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'worktree'>
  & InjectFace<WorktreeSettingsFace>

/**
 * Render one settings row: what it edits on the left, the control on the right.
 * @param props - the row's title, its explanation, and its control.
 * @returns the row.
 */
function Row(props: { id: string; title: string; description: string; control: ReactNode }) {
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <span className={css.title} id={`${props.id}-label`}>{props.title}</span>
        <span className={css.desc} id={`${props.id}-message`}>{props.description}</span>
      </div>
      <div className={css.control}>{props.control}</div>
    </div>
  )
}

/**
 * Render a row's choices as one row of buttons with a sliding selection.
 *
 * The buttons are the same control the Appearance row uses — buttons carrying
 * `aria-pressed` — because this is a preference, not a set of panels: tablist
 * semantics with no panel to control would promise navigation that does not
 * exist.
 * @param props - the row identity, its staged value, the labelled choices, and the write.
 * @returns the segmented control.
 */
function ChoiceRow(props: {
  id: string
  text: string
  options: readonly { value: string; label: string }[]
  disabled: boolean
  onEdit: (value: string) => void
}) {
  const selected = props.options.findIndex(option => option.value === props.text)
  const indicator = {
    '--dsh-choice-count': String(props.options.length),
    '--dsh-choice-index': String(Math.max(selected, 0)),
  } as CSSProperties
  return (
    <div className={css.choices} style={indicator}>
      <span aria-hidden="true" className={css.indicator} />
      {props.options.map(option => (
        <button
          key={option.value}
          type="button"
          className={css.choice}
          aria-pressed={option.value === props.text}
          aria-describedby={`${props.id}-message`}
          disabled={props.disabled}
          onClick={() => { props.onEdit(option.value) }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Render the worktree policy page.
 * @param props - the composition's other props, this plugin's copy, and the form face.
 * @returns the settings page.
 */
export function WorktreeSettingsSection(props: WorktreeSettingsSectionProps) {
  const { t } = props
  const state = props.useWorktreeSettings(snapshot => snapshot)
  const labels = formLabels(t)
  const readOnly = !state.writable
  // A row another row's answer has settled says so where it sits: an inert
  // control with no explanation is how a settings page teaches people that
  // settings do nothing. The dependency is read from the DRAFT, so flipping
  // the switch answers immediately rather than at the next load.
  const createsNested = state.nestedRepositories.text !== 'none'
  const overridden = [state.nestedRepositories, state.defaultPath, state.nestedScanDepth]
    .some(field => field.overridden)
  // Leaving the page drops every staged edit, exactly as the shared frame
  // does; the ref keeps the latest discard without re-subscribing.
  const discard = useRef(props.discard)
  discard.current = props.discard
  useEffect(() => () => { discard.current() }, [])
  if (!state.available) return <p className={css.notice} role="status">{labels.unavailable}</p>

  /**
   * Clear every row's override, so each one falls back to the composition
   * layer. The clears are staged like any other edit and ride the same save.
   */
  const resetAll = (): void => {
    if (state.nestedRepositories.overridden) props.resetField('nestedRepositories')
    if (state.defaultPath.overridden) props.resetField('defaultPath')
    if (state.nestedScanDepth.overridden) props.resetField('nestedScanDepth')
  }
  const blocked = !state.dirty || state.invalid || state.saving

  return (
    <div className={css.page}>
      <h2 className={css.pageTitle}>{t('settings.title')}</h2>
      {!state.writable ? <p className={css.notice} role="status">{labels.readOnly}</p> : null}
      <Row
        id="worktree-nested"
        title={t('settings.nested.label')}
        description={t('settings.nested.hint')}
        control={(
          <Switch
            checked={createsNested}
            label={t('settings.nested.label')}
            disabled={readOnly}
            // The switch is the whole choice: on means submodules and nested
            // repositories both come along, which is `all`; off means the
            // parent alone. The middle policy stays reachable from the
            // deployment's own patch.
            onChange={(next) => { props.edit('nestedRepositories', next ? 'all' : 'none') }}
          />
        )}
      />
      <Row
        id="worktree-scan-depth"
        title={t('settings.depth.label')}
        description={createsNested ? t('settings.depth.hint') : t('settings.depth.inactive')}
        control={(
          <input
            type="text"
            inputMode="numeric"
            className={`${css.input} ${css.inputNumber}`}
            aria-labelledby="worktree-scan-depth-label"
            aria-describedby="worktree-scan-depth-message"
            aria-invalid={state.nestedScanDepth.invalid || undefined}
            value={state.nestedScanDepth.text}
            disabled={readOnly || !createsNested}
            onChange={(event) => { props.edit('nestedScanDepth', event.target.value) }}
          />
        )}
      />
      <Row
        id="worktree-default-path"
        title={t('settings.layout.label')}
        // The explanation IS the chosen path: which directory a checkout lands
        // in is the one thing this row decides, and the answer changes with the
        // choice rather than repeating it.
        description={t(layoutPathKey(state.defaultPath.text))}
        control={(
          <ChoiceRow
            id="worktree-default-path"
            text={state.defaultPath.text}
            options={WORKTREE_LAYOUTS.map(value => ({ value, label: t(`option.${value}` as WorktreeCopyKey) }))}
            disabled={readOnly}
            onEdit={(value) => { props.edit('defaultPath', value) }}
          />
        )}
      />
      <div className={css.footer}>
        {state.failed ? <p className={css.failed} role="status">{labels.saveFailed}</p> : null}
        <button type="button" className={css.resetAll} disabled={readOnly || !overridden} onClick={resetAll}>
          {t('settings.reset')}
        </button>
        <button type="button" className={css.save} disabled={blocked} onClick={props.save}>
          {state.saving ? labels.saving : labels.save}
        </button>
      </div>
    </div>
  )
}

/**
 * The dictionary key naming one layout's directory.
 * @param value - the staged layout, empty before the Host answers.
 * @returns the key holding that layout's path.
 */
function layoutPathKey(value: string): WorktreeCopyKey {
  return `layout.path.${WORKTREE_LAYOUTS.includes(value as never) ? value : WORKTREE_LAYOUTS[0]}` as WorktreeCopyKey
}
