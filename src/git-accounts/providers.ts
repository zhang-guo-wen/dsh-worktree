/**
 * The Git provider catalog.
 *
 * One entry per supported host family: where its API lives, how a token
 * travels, and how its JSON becomes the account and project facts the page
 * renders. The Host service drives every provider through this one interface,
 * so account storage, routes, and the page never learn a provider's dialect.
 *
 * The parsers validate what the page needs and tolerate what a host may omit. A
 * missing login or project path fails with a message naming the provider and
 * field; a missing display name, description, or SSH URL is simply absent from
 * the result.
 * @module @guowenzhang/dsh-worktree/git-accounts/providers
 */

import { DEFAULT_PROVIDER_HOSTS } from './types.ts'
import type { GitProvider, GitVisibility } from './types.ts'

/** How many projects one page of a provider list asks for. */
const PAGE_SIZE = 100

/** One request a provider spec builds; the HTTP edge sends it unchanged. */
export interface ProviderHttpRequest {
  /** Absolute request URL. */
  readonly url: string
  /** Request headers. */
  readonly headers: Readonly<Record<string, string>>
}

/** The account facts a host reports for a verified token. */
export interface AccountProfile {
  /** The host's login for the account. */
  readonly login: string
  /** Display name the host reports, when it reports one. */
  readonly name?: string
  /** Email the host reports publicly, when it reports one. */
  readonly email?: string
  /** The account's profile page on its host. */
  readonly profileUrl?: string
  /** Token scopes the host reports, space-separated, when it reports them. */
  readonly scopes?: string
}

/** One project as a host reports it, before the Host attaches the account. */
export interface ProviderProjectFacts {
  /** Host-side identity of the project. */
  readonly id: string
  /** Namespaced path the host displays. */
  readonly fullName: string
  /** The project's own name. */
  readonly name: string
  /** The project description, when the host has one. */
  readonly description?: string
  /** Visibility, folded to the answers every provider shares. */
  readonly visibility: GitVisibility
  /** Default branch name, when the host reports one. */
  readonly defaultBranch?: string
  /** Last activity, ISO 8601, when the host reports one. */
  readonly updatedAt?: string
  /** Browser URL. */
  readonly webUrl: string
  /** HTTPS clone URL. */
  readonly httpsUrl: string
  /** SSH clone URL, when the host reports one. */
  readonly sshUrl?: string
}

/** One page of projects, with the host's own statement about further pages. */
export interface ProviderProjectsPage {
  /** This page's rows. */
  readonly projects: readonly ProviderProjectFacts[]
  /** Whether the host says a further page exists. */
  readonly hasMore: boolean
}

/** Everything the Host needs to speak one provider's REST API. */
export interface ProviderSpec {
  /** The host family this spec speaks. */
  readonly id: GitProvider
  /** The provider's public host, used when a stored credential names no host. */
  readonly defaultHost: string
  /**
   * Reduce user input to the host that serves this account.
   * @param raw - a host, optionally with scheme, credentials, path, or port.
   * @returns the bare lowercase host, keeping a non-default port.
   * @throws {ProviderDataError} when the value cannot be a host.
   */
  normalizeHost(raw: string): string
  /**
   * Build the request that verifies a token and reads the account profile.
   * @param host - the account's host, as returned by `normalizeHost`.
   * @param token - the access token.
   * @returns the request the HTTP edge sends.
   */
  userRequest(host: string, token: string): ProviderHttpRequest
  /**
   * Read the account profile out of the host's JSON answer.
   * @param body - the parsed response body.
   * @param headers - the response headers, which can carry reported scopes.
   * @returns the account profile.
   * @throws {ProviderDataError} when the body is not a profile object.
   */
  parseProfile(body: unknown, headers: Headers): AccountProfile
  /**
   * Build the request that lists one page of the account's projects.
   * @param host - the account's host, as returned by `normalizeHost`.
   * @param token - the access token.
   * @param page - one-based page number.
   * @returns the request the HTTP edge sends.
   */
  projectsRequest(host: string, token: string, page: number): ProviderHttpRequest
  /**
   * Read one page of projects out of the host's JSON answer.
   * @param body - the parsed response body.
   * @param headers - the response headers, which can signal a further page.
   * @returns the page's projects and whether more exist.
   * @throws {ProviderDataError} when the body is not a project array or a row lacks a required field.
   */
  parseProjects(body: unknown, headers: Headers): ProviderProjectsPage
}

/** A provider response that does not carry the facts the catalog expects. */
export class ProviderDataError extends Error {
  /**
   * @param message - what was missing or malformed, naming the provider and field.
   */
  constructor(message: string) {
    super(message)
    this.name = 'ProviderDataError'
  }
}

/**
 * Return the catalog entry for one host family.
 * @param provider - the host family.
 * @returns its spec.
 * @throws {ProviderDataError} when the value is not a supported provider.
 */
export function providerSpec(provider: GitProvider): ProviderSpec {
  switch (provider) {
    case 'github':
      return GITHUB
    case 'gitlab':
      return GITLAB
    case 'gitee':
      return GITEE
    default:
      throw new ProviderDataError(`Unknown Git provider: ${String(provider)}.`)
  }
}

/**
 * Name the host family a host belongs to.
 *
 * The public hosts answer exactly; any other host falls back to a name hint, so
 * a self-hosted `gitlab.arcuchi.com` or `github.corp.example` is recognized
 * without configuration.
 * @param host - host name, or a value such as a URL.
 * @returns the host family, or `undefined` when the host matches none.
 */
export function knownProviderForHost(host: string): GitProvider | undefined {
  let candidate = typeof host === 'string' ? host.trim().toLowerCase() : ''
  try {
    candidate = normalizeHostValue(host)
  } catch (error: unknown) {
    // Matching a name hint is still useful for a malformed value; the value
    // keeps its scheme and path, so the hints below ignore those separators.
    void error
  }
  if (candidate === 'github.com') return 'github'
  if (candidate === 'gitlab.com') return 'gitlab'
  if (candidate === 'gitee.com') return 'gitee'
  if (candidate.includes('gitlab')) return 'gitlab'
  if (candidate.includes('gitee')) return 'gitee'
  if (candidate.includes('github')) return 'github'
  return undefined
}

/** GitHub's REST API. */
const GITHUB: ProviderSpec = {
  id: 'github',
  defaultHost: DEFAULT_PROVIDER_HOSTS.github,
  normalizeHost: normalizeHostValue,
  userRequest(host, token) {
    return { url: `${githubApiBase(host)}/user`, headers: githubHeaders(token) }
  },
  parseProfile(body, headers) {
    const record = jsonObject(body, 'GitHub profile')
    const login = requiredString(record, 'login', 'GitHub profile')
    const name = optionalString(record, 'name')
    const email = optionalString(record, 'email')
    const profileUrl = optionalString(record, 'html_url')
    const scopes = optionalHeader(headers, 'x-oauth-scopes')
    return {
      login,
      ...(name === undefined ? {} : { name }),
      ...(email === undefined ? {} : { email }),
      ...(profileUrl === undefined ? {} : { profileUrl }),
      ...(scopes === undefined ? {} : { scopes }),
    }
  },
  projectsRequest(host, token, page) {
    return {
      url: `${githubApiBase(host)}/user/repos?per_page=${PAGE_SIZE}&page=${page}&sort=updated`
        + '&affiliation=owner,collaborator,organization_member',
      headers: githubHeaders(token),
    }
  },
  parseProjects(body, headers) {
    const rows = jsonArray(body, 'GitHub projects')
    const projects = rows.map((row, index) => parseGithubProject(row, index))
    return {
      projects,
      hasMore: linkHasNextPage(headers.get('link')) || rows.length === PAGE_SIZE,
    }
  },
}

/** GitLab's REST API, on the public host or a self-hosted instance. */
const GITLAB: ProviderSpec = {
  id: 'gitlab',
  defaultHost: DEFAULT_PROVIDER_HOSTS.gitlab,
  normalizeHost: normalizeHostValue,
  userRequest(host, token) {
    return { url: `${gitlabApiBase(host)}/user`, headers: { 'PRIVATE-TOKEN': token } }
  },
  parseProfile(body) {
    const record = jsonObject(body, 'GitLab profile')
    const login = requiredString(record, 'username', 'GitLab profile')
    const name = optionalString(record, 'name')
    const email = optionalString(record, 'email')
    const profileUrl = optionalString(record, 'web_url')
    return {
      login,
      ...(name === undefined ? {} : { name }),
      ...(email === undefined ? {} : { email }),
      ...(profileUrl === undefined ? {} : { profileUrl }),
    }
  },
  projectsRequest(host, token, page) {
    return {
      url: `${gitlabApiBase(host)}/projects?membership=true&simple=true&per_page=${PAGE_SIZE}`
        + `&page=${page}&order_by=last_activity_at&sort=desc`,
      headers: { 'PRIVATE-TOKEN': token },
    }
  },
  parseProjects(body, headers) {
    const rows = jsonArray(body, 'GitLab projects')
    const projects = rows.map((row, index) => parseGitlabProject(row, index))
    const nextPage = headers.get('x-next-page')
    return {
      projects,
      hasMore: (nextPage !== null && nextPage.trim() !== '') || rows.length === PAGE_SIZE,
    }
  },
}

/** Gitee's REST API, which takes the token as a query parameter. */
const GITEE: ProviderSpec = {
  id: 'gitee',
  defaultHost: DEFAULT_PROVIDER_HOSTS.gitee,
  normalizeHost: normalizeHostValue,
  userRequest(host, token) {
    return {
      url: `${giteeApiBase(host)}/user?access_token=${encodeURIComponent(token)}`,
      headers: {},
    }
  },
  parseProfile(body) {
    const record = jsonObject(body, 'Gitee profile')
    const login = requiredString(record, 'login', 'Gitee profile')
    const name = optionalString(record, 'name')
    const email = optionalString(record, 'email')
    const profileUrl = optionalString(record, 'html_url')
    return {
      login,
      ...(name === undefined ? {} : { name }),
      ...(email === undefined ? {} : { email }),
      ...(profileUrl === undefined ? {} : { profileUrl }),
    }
  },
  projectsRequest(host, token, page) {
    return {
      url: `${giteeApiBase(host)}/user/repos?access_token=${encodeURIComponent(token)}`
        + `&per_page=${PAGE_SIZE}&page=${page}&sort=updated`,
      headers: {},
    }
  },
  parseProjects(body) {
    const rows = jsonArray(body, 'Gitee projects')
    return {
      projects: rows.map((row, index) => parseGiteeProject(row, index)),
      hasMore: rows.length === PAGE_SIZE,
    }
  },
}

/**
 * Reduce user input to a bare host.
 *
 * Input may carry a scheme, credentials, a path, a query, or a fragment, as in
 * `https://gitlab.arcuchi.com/some/path`; only the lowercase host and its
 * optional port survive.
 * @param raw - the host value to normalize.
 * @returns the bare host, for example `gitlab.arcuchi.com` or `host:8443`.
 * @throws {ProviderDataError} when the value cannot name a host.
 */
function normalizeHostValue(raw: string): string {
  if (typeof raw !== 'string') throw new ProviderDataError('A Git host is required.')
  const text = raw.trim()
  if (text.length === 0) throw new ProviderDataError('A Git host is required.')
  let authority = text
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(authority)
  if (scheme !== null) authority = authority.slice(scheme[0].length)
  authority = authority.replace(/^\/+/, '')
  const at = authority.lastIndexOf('@')
  if (at !== -1) authority = authority.slice(at + 1)
  authority = (authority.split(/[/?#]/, 1)[0] ?? '').toLowerCase().replace(/\.+$/, '')
  if (!HOST_PATTERN.test(authority)) {
    throw new ProviderDataError(
      `${JSON.stringify(raw)} is not a Git host. Use a host name such as ${DEFAULT_PROVIDER_HOSTS.github}, `
      + 'with an optional port and nothing else.',
    )
  }
  const port = /:([0-9]+)$/.exec(authority)
  if (port !== null && Number(port[1]) > 65_535) {
    throw new ProviderDataError(`${JSON.stringify(raw)} has a port outside 1-65535.`)
  }
  return authority
}

/** A host name with optional port: labels of letters, digits, and inner dashes. */
const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::[0-9]{1,5})?$/

/**
 * Base URL of GitHub's REST API for a host.
 *
 * The public host keeps its dedicated API host; GitHub Enterprise serves the
 * same API under `/api/v3` on the account's own host.
 * @param host - the account's host.
 * @returns the API base, without a trailing slash.
 */
function githubApiBase(host: string): string {
  const normalized = normalizeHostValue(host)
  return normalized === DEFAULT_PROVIDER_HOSTS.github ? 'https://api.github.com' : `https://${normalized}/api/v3`
}

/**
 * Base URL of GitLab's REST API for a host.
 * @param host - the account's host.
 * @returns the API base, without a trailing slash.
 */
function gitlabApiBase(host: string): string {
  return `https://${normalizeHostValue(host)}/api/v4`
}

/**
 * Base URL of Gitee's REST API for a host.
 * @param host - the account's host.
 * @returns the API base, without a trailing slash.
 */
function giteeApiBase(host: string): string {
  return `https://${normalizeHostValue(host)}/api/v5`
}

/**
 * Headers every GitHub API request sends.
 * @param token - the access token.
 * @returns the request headers.
 */
function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'user-agent': 'dsh-worktree',
  }
}

/**
 * Read one GitHub project row.
 * @param row - one element of the response array.
 * @param index - the row's position, for the diagnostic.
 * @returns the project facts.
 * @throws {ProviderDataError} when a required field is missing.
 */
function parseGithubProject(row: unknown, index: number): ProviderProjectFacts {
  const label = `GitHub project ${index + 1}`
  const record = jsonObject(row, label)
  const fullName = requiredString(record, 'full_name', label)
  const webUrl = requiredString(record, 'html_url', label)
  const httpsUrl = requiredString(record, 'clone_url', label)
  const idValue = record.id
  const description = optionalString(record, 'description')
  const defaultBranch = optionalString(record, 'default_branch')
  const updatedAt = optionalString(record, 'updated_at')
  const sshUrl = optionalString(record, 'ssh_url')
  return {
    id: typeof idValue === 'number' || typeof idValue === 'string' ? String(idValue) : fullName,
    fullName,
    name: optionalString(record, 'name') ?? lastSegment(fullName),
    visibility: record.private === true ? 'private' : 'public',
    webUrl,
    httpsUrl,
    ...(description === undefined ? {} : { description }),
    ...(defaultBranch === undefined ? {} : { defaultBranch }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(sshUrl === undefined ? {} : { sshUrl }),
  }
}

/**
 * Read one GitLab project row.
 * @param row - one element of the response array.
 * @param index - the row's position, for the diagnostic.
 * @returns the project facts.
 * @throws {ProviderDataError} when a required field is missing.
 */
function parseGitlabProject(row: unknown, index: number): ProviderProjectFacts {
  const label = `GitLab project ${index + 1}`
  const record = jsonObject(row, label)
  const fullName = requiredString(record, 'path_with_namespace', label)
  const webUrl = requiredString(record, 'web_url', label)
  const httpsUrl = requiredString(record, 'http_url_to_repo', label)
  const idValue = record.id
  const description = optionalString(record, 'description')
  const defaultBranch = optionalString(record, 'default_branch')
  const updatedAt = optionalString(record, 'last_activity_at')
  const sshUrl = optionalString(record, 'ssh_url_to_repo')
  return {
    id: typeof idValue === 'number' || typeof idValue === 'string' ? String(idValue) : fullName,
    fullName,
    name: optionalString(record, 'name') ?? lastSegment(fullName),
    visibility: gitlabVisibility(record.visibility),
    webUrl,
    httpsUrl,
    ...(description === undefined ? {} : { description }),
    ...(defaultBranch === undefined ? {} : { defaultBranch }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(sshUrl === undefined ? {} : { sshUrl }),
  }
}

/**
 * Read one Gitee project row.
 * @param row - one element of the response array.
 * @param index - the row's position, for the diagnostic.
 * @returns the project facts.
 * @throws {ProviderDataError} when a required field is missing.
 */
function parseGiteeProject(row: unknown, index: number): ProviderProjectFacts {
  const label = `Gitee project ${index + 1}`
  const record = jsonObject(row, label)
  const fullName = requiredString(record, 'full_name', label)
  const webUrl = requiredString(record, 'html_url', label)
  const httpsUrl = requiredString(record, 'clone_url', label)
  const idValue = record.id
  const description = optionalString(record, 'description')
  const defaultBranch = optionalString(record, 'default_branch')
  const updatedAt = optionalString(record, 'updated_at')
  const sshUrl = optionalString(record, 'ssh_url')
  return {
    id: typeof idValue === 'number' || typeof idValue === 'string' ? String(idValue) : fullName,
    fullName,
    name: optionalString(record, 'name') ?? lastSegment(fullName),
    visibility: record.private === true ? 'private' : 'public',
    webUrl,
    httpsUrl,
    ...(description === undefined ? {} : { description }),
    ...(defaultBranch === undefined ? {} : { defaultBranch }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(sshUrl === undefined ? {} : { sshUrl }),
  }
}

/**
 * Fold GitLab's visibility vocabulary onto the shared one.
 * @param value - the `visibility` field of a GitLab project.
 * @returns the shared visibility, or `unknown` for an unrecognized value.
 */
function gitlabVisibility(value: unknown): GitVisibility {
  return value === 'public' || value === 'internal' || value === 'private' ? value : 'unknown'
}

/**
 * Assert a parsed JSON value is an object.
 * @param value - the parsed value.
 * @param label - what the object should represent, for the diagnostic.
 * @returns the value as a field map.
 * @throws {ProviderDataError} when the value is not an object.
 */
function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProviderDataError(`${label} response is not a JSON object.`)
  }
  return value as Record<string, unknown>
}

/**
 * Assert a parsed JSON value is an array.
 * @param value - the parsed value.
 * @param label - what the array should represent, for the diagnostic.
 * @returns the value as an array.
 * @throws {ProviderDataError} when the value is not an array.
 */
function jsonArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new ProviderDataError(`${label} response is not a JSON array.`)
  return value
}

/**
 * Read a required string field.
 * @param record - the row.
 * @param key - the field name.
 * @param label - what the row represents, for the diagnostic.
 * @returns the field value.
 * @throws {ProviderDataError} when the field is absent, empty, or not a string.
 */
function requiredString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProviderDataError(`${label} response has no "${key}".`)
  }
  return value
}

/**
 * Read an optional string field, treating `null` and empty strings as absent.
 * @param record - the row.
 * @param key - the field name.
 * @returns the field value, or `undefined`.
 */
function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * Read an optional response header.
 * @param headers - the response headers.
 * @param name - the header name.
 * @returns the trimmed value, or `undefined` when absent or empty.
 */
function optionalHeader(headers: Headers, name: string): string | undefined {
  const value = headers.get(name)
  if (value === null) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Whether a GitHub `Link` header advertises a next page.
 * @param link - the response's `Link` header, or `null`.
 * @returns true when the header carries `rel="next"`.
 */
function linkHasNextPage(link: string | null): boolean {
  return link !== null && /rel\s*=\s*"?next"?/.test(link)
}

/**
 * The last segment of a namespaced path.
 * @param path - a path such as `acme/widgets`.
 * @returns the final segment.
 */
function lastSegment(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}
