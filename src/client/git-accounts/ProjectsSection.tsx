/**
 * The projects card: which account's projects are on screen, a search over the
 * rows already loaded, and the rows themselves.
 *
 * The card reads one page at a time through the injected `projects` call, and
 * only when a reader selects an account: a page that listed projects for every
 * account on mount would spend one Host request per row without anyone asking.
 * A failed read keeps whatever rows are already shown, because losing the list
 * the reader was reading is worse than a line saying the next read failed.
 *
 * The rows carry no mutation: this capability lists projects to identify them.
 * Copying the HTTPS clone URL and opening the project in a browser are the two
 * actions a project row has, and cloning stays out of scope.
 * @module @guowenzhang/dsh-worktree/client/git-accounts/ProjectsSection
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconCopyOutlineRegular, IconLinkOutlineRegular, IconSearchOutlineRegular, Input, Tag, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GitAccountSummary, GitAccountsInjected, GitProject, GitVisibility } from '../../git-accounts/types.ts'
import { PROVIDER_BRANDS, VISIBILITY_KEYS, formatDate, type Translate } from './presentation.ts'
import css from './GitAccountsPage.module.css'

/** One visibility's tag tone: public is healthy, internal is informational, the rest neutral. */
const VISIBILITY_TONES: Readonly<Record<GitVisibility, 'success' | 'info' | 'neutral' | 'outline'>> = {
  public: 'success',
  private: 'neutral',
  internal: 'info',
  unknown: 'outline',
}

/** The projects card's load state for one account. */
interface ProjectsState {
  /** The account the state describes, so a stale answer for a previous one is dropped. */
  readonly accountId: string | undefined
  /** Whether the first page is in flight, listed, refused, or impossible over SSH. */
  readonly status: 'idle' | 'loading' | 'ready' | 'failed' | 'ssh'
  /** Rows listed so far, oldest read first. */
  readonly projects: readonly GitProject[]
  /** Whether the Host says a further page exists. */
  readonly hasMore: boolean
  /** The one-based page the rows end at. */
  readonly page: number
  /** Whether a further page is in flight. */
  readonly more: boolean
  /** Why the last read failed, when it did. */
  readonly message?: string
}

/** The card before any account is chosen. */
const IDLE: ProjectsState = { accountId: undefined, status: 'idle', projects: [], hasMore: false, page: 0, more: false }

/** How many rows the first read's skeleton draws. */
const SKELETON_ROWS = 3

/** Props of {@link ProjectsSection}. */
export interface ProjectsSectionProps {
  /** The accounts whose projects can be listed. */
  readonly accounts: readonly GitAccountSummary[]
  /** The account whose projects are shown, when one is selected. */
  readonly selectedId: string | undefined
  /** Select one account's projects. */
  readonly onSelect: (accountId: string) => void
  /** The Host read that lists one page of projects. */
  readonly projects: GitAccountsInjected['projects']
  /** This plugin's copy reader. */
  readonly t: Translate
}

/**
 * Render the projects card.
 * @param props - the accounts, the selection, the Host read, and copy.
 * @returns the card.
 */
export function ProjectsSection({ accounts, selectedId, onSelect, projects, t }: ProjectsSectionProps): ReactNode {
  const [state, setState] = useState<ProjectsState>(IDLE)
  const [revision, setRevision] = useState(0)
  const [query, setQuery] = useState('')
  const [copyResult, setCopyResult] = useState<{ readonly id: string; readonly ok: boolean } | undefined>(undefined)

  // The first page is keyed on the selected account and the revision the reader
  // asked for: a retry re-reads, and switching accounts replaces the rows.
  useEffect(() => {
    if (selectedId === undefined) {
      setState(IDLE)
      return
    }
    // An SSH account authorizes Git transport, not the REST API that lists
    // projects; asking the Host would only produce a refusal the card already
    // knows the reason for.
    if (accounts.find(candidate => candidate.id === selectedId)?.auth === 'ssh') {
      setState({ accountId: selectedId, status: 'ssh', projects: [], hasMore: false, page: 0, more: false })
      return
    }
    let active = true
    setState(current => current.accountId === selectedId
      ? { ...current, status: 'loading', more: false }
      : { accountId: selectedId, status: 'loading', projects: [], hasMore: false, page: 0, more: false })
    void projects(selectedId, 1).then(result => {
      if (!active) return
      if (result.ok) {
        setState({
          accountId: selectedId,
          status: 'ready',
          projects: result.value.projects,
          hasMore: result.value.hasMore,
          page: 1,
          more: false,
        })
        return
      }
      // A refused read keeps the rows already on screen for this account; a
      // refusal for a different account drops what belonged to the previous one.
      setState(current => ({
        accountId: selectedId,
        status: 'failed',
        projects: current.accountId === selectedId ? current.projects : [],
        hasMore: current.accountId === selectedId ? current.hasMore : false,
        page: current.accountId === selectedId ? current.page : 0,
        more: false,
        message: result.message,
      }))
    })
    return () => { active = false }
  }, [accounts, projects, selectedId, revision])

  // The search and the copy feedback belong to the account on screen, not to the
  // card: another account's rows must not be filtered by a word typed for these.
  useEffect(() => {
    setQuery('')
    setCopyResult(undefined)
  }, [selectedId])

  const loadMore = (): void => {
    const current = state
    if (selectedId === undefined || current.accountId !== selectedId) return
    if (current.status === 'loading' || current.more || !current.hasMore) return
    const nextPage = current.page + 1
    setState(previous => ({ ...previous, more: true }))
    void projects(selectedId, nextPage).then(result => {
      setState(previous => {
        if (previous.accountId !== selectedId) return previous
        if (!result.ok) return { ...previous, more: false, status: 'failed', message: result.message }
        const seen = new Set(previous.projects.map(project => project.id))
        const appended = result.value.projects.filter(project => !seen.has(project.id))
        return {
          ...previous,
          more: false,
          status: 'ready',
          projects: [...previous.projects, ...appended],
          hasMore: result.value.hasMore,
          page: nextPage,
        }
      })
    })
  }

  const copy = (project: GitProject): void => {
    void writeClipboard(project.httpsUrl).then(ok => { setCopyResult({ id: project.id, ok }) })
  }

  const account = accounts.find(candidate => candidate.id === selectedId)
  // Before the effect for a freshly selected account runs, the stored state still
  // describes the previous one; rendering it as this account's loading state
  // keeps a frame from showing another account's rows under this one's heading.
  const shown: ProjectsState = state.accountId === selectedId
    ? state
    : { ...IDLE, accountId: selectedId, status: selectedId === undefined ? 'idle' : 'loading' }
  const search = query.trim().toLowerCase()
  const filtered = search === ''
    ? shown.projects
    : shown.projects.filter(project => project.name.toLowerCase().includes(search) || project.fullName.toLowerCase().includes(search))
  const loading = shown.status === 'loading' && shown.projects.length === 0
  const failed = shown.status === 'failed' && shown.message !== undefined

  return (
    <section
      className={css.card}
      aria-labelledby="git-accounts-projects-heading"
      aria-busy={shown.status === 'loading' || shown.more}
      data-git-accounts-card="projects"
    >
      <div className={css.cardHead}>
        <div className={css.cardText}>
          <h2 className={css.cardTitle} id="git-accounts-projects-heading">{t('gitAccounts.projects.title')}</h2>
          <p className={css.cardDescription}>{t('gitAccounts.projects.description')}</p>
        </div>
        {account === undefined ? null : (
          <span className={css.projectAccount}>
            {PROVIDER_BRANDS[account.provider]} · {account.host}
          </span>
        )}
      </div>
      {accounts.length === 0
        ? (
          <div className={css.empty} data-projects-empty="no-account">
            <p className={css.emptyText}>{t('gitAccounts.projects.emptyNoAccount')}</p>
          </div>
        )
        : (
          <>
            <div className={css.chips} role="group" aria-label={t('gitAccounts.projects.accounts')}>
              {accounts.map(candidate => (
                <button
                  key={candidate.id}
                  type="button"
                  className={css.chip}
                  aria-pressed={candidate.id === selectedId}
                  onClick={() => { onSelect(candidate.id) }}
                >
                  <span className={css.chipBrand}>{PROVIDER_BRANDS[candidate.provider]}</span>
                  <span className={css.chipLogin}>{candidate.login}</span>
                </button>
              ))}
            </div>
            {selectedId === undefined
              ? (
                <div className={css.empty} data-projects-empty="unchosen">
                  <p className={css.emptyText}>{t('gitAccounts.projects.choose')}</p>
                </div>
              )
              : (
                <div className={css.projects}>
                  {shown.status === 'ssh'
                    ? (
                      <div className={css.empty} data-projects-empty="ssh">
                        <p className={css.emptyText}>{t('gitAccounts.projects.sshUnavailable')}</p>
                        <p className={css.emptyHint}>{t('gitAccounts.projects.sshUnavailableHint')}</p>
                      </div>
                    )
                    : null}
                  {failed
                    ? (
                      <div className={css.inlineErrorRow}>
                        <p className={css.inlineError} role="alert" data-projects-error="true">
                          {t('gitAccounts.projects.failed', { message: shown.message ?? '' })}
                        </p>
                        <Button variant="outline" size="sm" onClick={() => { setRevision(value => value + 1) }}>
                          {t('gitAccounts.retry')}
                        </Button>
                      </div>
                    )
                    : null}
                  {shown.projects.length === 0 ? null : (
                    <div className={css.searchRow}>
                      <Input
                        type="search"
                        {...(css.search === undefined ? {} : { className: css.search })}
                        icon={<IconSearchOutlineRegular />}
                        value={query}
                        placeholder={t('gitAccounts.projects.searchPlaceholder')}
                        aria-label={t('gitAccounts.projects.search')}
                        onChange={(event) => { setQuery(event.target.value) }}
                      />
                      <span className={css.count} role="status">
                        {search === ''
                          ? t('gitAccounts.projects.count', { count: String(shown.projects.length) })
                          : t('gitAccounts.projects.searchCount', {
                            shown: String(filtered.length),
                            total: String(shown.projects.length),
                          })}
                      </span>
                    </div>
                  )}
                  {loading
                    ? (
                      <div className={css.skeletonList} role="status" aria-label={t('gitAccounts.projects.loading')} data-projects-loading="true">
                        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                          <span key={index} className={css.skeletonRow}>
                            <span className={css.skeletonBar} />
                            <span className={`${css.skeletonBar} ${css.skeletonBarShort}`} />
                          </span>
                        ))}
                      </div>
                    )
                    : null}
                  {shown.status === 'ready' && shown.projects.length === 0
                    ? (
                      <div className={css.empty} data-projects-empty="none">
                        <p className={css.emptyText}>{t('gitAccounts.projects.empty')}</p>
                        <p className={css.emptyHint}>{t('gitAccounts.projects.emptyHint')}</p>
                      </div>
                    )
                    : null}
                  {filtered.length === 0 ? null : (
                    <ul className={css.projectList} aria-label={t('gitAccounts.projects.title')}>
                      {filtered.map(project => (
                        <ProjectRow
                          key={project.id}
                          project={project}
                          copyResult={copyResult}
                          onCopy={copy}
                          t={t}
                        />
                      ))}
                    </ul>
                  )}
                  {search !== '' && filtered.length === 0 && shown.projects.length > 0
                    ? <p className={css.noMatch} role="status">{t('gitAccounts.projects.noMatch')}</p>
                    : null}
                  {shown.hasMore
                    ? (
                      <div className={css.loadMoreRow}>
                        <Button variant="outline" size="sm" disabled={shown.more} onClick={loadMore}>
                          {shown.more ? t('gitAccounts.projects.loadingMore') : t('gitAccounts.projects.loadMore')}
                        </Button>
                      </div>
                    )
                    : null}
                </div>
              )}
          </>
        )}
    </section>
  )
}

/**
 * Split a project's namespaced path into the namespace and the project's own
 * name, so the name is the emphasized part of the path the row shows.
 * @param project - the project whose path to split.
 * @returns the namespace prefix (empty when the path does not end with the name).
 */
function pathPrefix(project: GitProject): string {
  if (project.fullName === project.name || !project.fullName.endsWith(project.name)) return ''
  return project.fullName.slice(0, project.fullName.length - project.name.length)
}

/**
 * One project's row: what it is, who can see it, where it lives, and the two
 * actions that identify it outside the page.
 * @param props - the project, the last copy outcome, the copy action, and copy.
 * @returns the row.
 */
function ProjectRow({ project, copyResult, onCopy, t }: {
  readonly project: GitProject
  readonly copyResult: { readonly id: string; readonly ok: boolean } | undefined
  readonly onCopy: (project: GitProject) => void
  readonly t: Translate
}): ReactNode {
  const prefix = pathPrefix(project)
  const copied = copyResult?.id === project.id ? copyResult : undefined
  const copyLabel = copied === undefined
    ? t('gitAccounts.projects.copy')
    : copied.ok ? t('gitAccounts.projects.copied') : t('gitAccounts.projects.copyFailed')
  return (
    <li className={css.projectRow} data-project-id={project.id} data-project-visibility={project.visibility}>
      <div className={css.projectMain}>
        <div className={css.projectHead}>
          <span className={css.projectPath} title={project.fullName} data-project-path={project.fullName}>
            {prefix === '' ? null : <span className={css.projectNamespace}>{prefix}</span>}
            <span className={css.projectName}>{project.name}</span>
          </span>
          <Tag tone={VISIBILITY_TONES[project.visibility]}>{t(VISIBILITY_KEYS[project.visibility])}</Tag>
        </div>
        {project.description === undefined || project.description === '' ? null : (
          <p className={css.projectDescription}>{project.description}</p>
        )}
        <div className={css.projectMeta}>
          {project.defaultBranch === undefined ? null : (
            <span>{t('gitAccounts.projects.branch', { branch: project.defaultBranch })}</span>
          )}
          {project.updatedAt === undefined ? null : (
            <span>{t('gitAccounts.projects.updated', { date: formatDate(project.updatedAt) })}</span>
          )}
        </div>
      </div>
      <div className={css.projectActions}>
        <Button
          variant="ghost"
          size="sm"
          icon={<IconCopyOutlineRegular />}
          className={copied?.ok === false ? `${css.copyButton} ${css.copyFailed}` : css.copyButton}
          aria-label={t('gitAccounts.projects.copyOne', { name: project.name })}
          onClick={() => { onCopy(project) }}
        >
          {copyLabel}
        </Button>
        <a
          className={css.openLink}
          href={project.webUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={t('gitAccounts.projects.openOne', { name: project.name })}
        >
          <IconLinkOutlineRegular size={14} />
          {t('gitAccounts.projects.open')}
        </a>
      </div>
    </li>
  )
}
