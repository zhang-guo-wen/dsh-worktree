/**
 * The file backup settings page, in two cards: the policy every later checkout
 * is created under, and the protection that runs over files inside a session.
 *
 * Each card is a title, an explanation, and its own rows, laid out in the
 * settings column's two-column shape (label and explanation left, control
 * right), so this page reads like every other page beside it. The Worktree card
 * answers what a checkout looks like — whether the child repositories come
 * along, how deep the search for them goes, and where the directory lands. The
 * backup card answers what happens to the files inside it. Everything else the
 * entry accepts — the agent subdirectory, the git bound, the route options — is
 * deployment composition, edited in the profile's own patch.
 *
 * Every valid edit saves automatically through the shared settings scope.
 * There is no manual-save footer, and leaving the page never discards a write.
 * @module @guowenzhang/dsh-worktree/client/SettingsSection
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { WORKTREE_LAYOUTS } from '../policy.ts'
import { request, type GitCheckResult } from './api.ts'
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
 * Group rows under one heading, on the settings cards' shared material.
 *
 * The heading names the surface the rows below answer for. Its id is what the
 * region points at, so a screen reader announces the group by the same words
 * the page shows above it.
 * @param props - the heading's identity and text, and the rows it groups.
 * @returns the card.
 */
function Card(props: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={css.card} aria-labelledby={`${props.id}-heading`}>
      <h3 className={css.cardTitle} id={`${props.id}-heading`}>{props.title}</h3>
      {props.children}
    </section>
  )
}

/**
 * Render a row's choices as one row of buttons with a sliding selection.
 *
 * The buttons are the same control the Appearance row uses — buttons carrying
 * `aria-pressed` — because this is a preference, not a set of panels: tablist
 * semantics with no panel to control would promise navigation that does not
 * exist. The two properties the indicator derives its geometry from are
 * plugin-private: the `--dsh-` prefix names Host-owned properties. The buttons
 * carry `aria-pressed` rather than tab semantics, so the wrapper is a named
 * `group`: a set of toggles with one name, not a tab list.
 * @param props - the row identity, its staged value, the labelled choices, and the write.
 * @returns the segmented control.
 */
function ChoiceRow(props: {
  id: string
  label: string
  text: string
  options: readonly { value: string; label: string }[]
  disabled: boolean
  onEdit: (value: string) => void
}) {
  const selected = props.options.findIndex(option => option.value === props.text)
  const indicator = {
    '--worktree-choice-count': String(props.options.length),
    '--worktree-choice-index': String(Math.max(selected, 0)),
  } as CSSProperties
  return (
    <div className={css.choices} style={indicator} role="group" aria-label={props.label}>
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
 * Render the file backup page.
 * @param props - the composition's other props, this plugin's copy, and the form face.
 * @returns the settings page.
 */
export function WorktreeSettingsSection(props: WorktreeSettingsSectionProps) {
  const { t } = props
  const state = props.useWorktreeSettings(snapshot => snapshot)
  const [gitStatus, setGitStatus] = useState<{ kind: 'checking' | 'available' | 'missing' | 'failed'; detail?: string }>({ kind: 'checking' })
  useEffect(() => {
    let active = true
    void request<GitCheckResult>('check', {}).then(result => {
      if (!active) return
      if (result.ok) setGitStatus({ kind: 'available', detail: result.value.version })
      else if (result.code === 'git_not_found' || /\bspawn\s+git\s+ENOENT\b/iu.test(result.message)) {
        setGitStatus({ kind: 'missing' })
      } else setGitStatus({ kind: 'failed', detail: result.message })
    }).catch(error => {
      if (active) setGitStatus({ kind: 'failed', detail: error instanceof Error ? error.message : String(error) })
    })
    return () => { active = false }
  }, [])
  const labels = formLabels(t)
  const readOnly = !state.writable
  // A row another row's answer has settled says so where it sits: an inert
  // control with no explanation is how a settings page teaches people that
  // settings do nothing. The dependency is read from the DRAFT, so flipping
  // the switch answers immediately rather than at the next load.
  const createsNested = state.nestedRepositories.text !== 'none'
  if (!state.available) return <p className={css.notice} role="status">{labels.unavailable}</p>

  // The same rule as the scan depth: a switch that cannot mean anything yet
  // says so where it sits rather than going inert without explanation. The
  // store renders an absent value as the schema default, so only an explicit
  // `false` means off here.
  const guardsFiles = state.fileGuard.text !== 'false'

  // The Git state belongs to the card that creates checkouts, so it sits at
  // that card's head rather than above both: what it reports answers the first
  // card's subject, not the page's.
  const gitLine = gitStatus.kind === 'checking' ? t('settings.gitChecking')
    : gitStatus.kind === 'available' ? `${t('settings.gitAvailable')} · ${gitStatus.detail}`
      : gitStatus.kind === 'missing' ? t('settings.gitMissing')
        : `${t('settings.gitFailed')}：${gitStatus.detail}`

  return (
    <div className={css.page}>
      <h2 className={css.pageTitle}>{t('settings.title')}</h2>
      <p className={css.pageDescription}>{t('settings.description')}</p>
      {!state.writable ? <p className={css.notice} role="status">{labels.readOnly}</p> : null}
      <Card id="worktree" title={t('settings.worktree.cardTitle')}>
        <p className={`${css.gitStatus} ${gitStatus.kind === 'missing' || gitStatus.kind === 'failed' ? css.gitError : ''}`} role="status">
          {gitLine}
        </p>
        <Row
          id="worktree-nested"
          title={t('settings.nested.label')}
          description={t('settings.nested.hint')}
          control={(
            <Switch
              checked={createsNested}
              label={t('settings.nested.label')}
              disabled={readOnly}
              // Layout class only: on a touch device the stylesheet grows this
              // button's transparent hit area to 44px, because the primitive's
              // 36x20 body is fixed and must stay as it is.
              className={css.switchHit}
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
              label={t('settings.layout.label')}
              text={state.defaultPath.text}
              options={WORKTREE_LAYOUTS.map(value => ({ value, label: t(`option.${value}` as WorktreeCopyKey) }))}
              disabled={readOnly}
              onEdit={(value) => { props.edit('defaultPath', value) }}
            />
          )}
        />
      </Card>
      <Card id="backup" title={t('settings.backup.cardTitle')}>
        <Row
          id="worktree-file-guard"
          title={t('settings.guard.label')}
          description={t('settings.guard.hint')}
          control={(
            <Switch
              checked={guardsFiles}
              label={t('settings.guard.label')}
              disabled={readOnly}
              className={css.switchHit}
              onChange={(next) => { props.edit('fileGuard', String(next)) }}
            />
          )}
        />
        <Row
          id="worktree-deny-destructive"
          title={t('settings.deny.label')}
          description={guardsFiles ? t('settings.deny.hint') : t('settings.deny.inactive')}
          control={(
            <Switch
              checked={state.denyDestructiveCommands.text !== 'false'}
              label={t('settings.deny.label')}
              disabled={readOnly || !guardsFiles}
              onChange={(next) => { props.edit('denyDestructiveCommands', String(next)) }}
            />
          )}
        />
      </Card>
      {state.nestedScanDepth.invalid ? <p className={css.failed} role="status">{t('settings.invalidNumber')}</p> : null}
      {state.failed ? <p className={css.failed} role="status">{labels.saveFailed}</p> : null}
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
