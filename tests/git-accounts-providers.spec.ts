/**
 * The Git provider catalog and its HTTP edge.
 *
 * The parsers are driven by captured provider response fixtures, so these specs
 * pin what each host's JSON becomes without a network call or a real token. The
 * HTTP edge runs against a stubbed global `fetch`, which is the way to assert
 * each failure class and to prove that a token never reaches an error message:
 * Gitee puts its token in the query string, so the message must not echo it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchProviderJson, GitProviderHttpError, sanitizeRequestUrl } from '../src/git-accounts/http.ts'
import { knownProviderForHost, providerSpec, ProviderDataError } from '../src/git-accounts/providers.ts'

/** The GitHub profile endpoint, used wherever a request URL is incidental. */
const GITHUB_USER = 'https://api.github.com/user'

/** Build a JSON response the way a provider would send it. */
function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/** Stub the global fetch with one responder and return the mock. */
function stubFetch(respond: (url: string, init?: RequestInit) => Promise<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => await respond(url, init))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Await a call that must fail with a provider HTTP error and return that error. */
async function providerError(call: Promise<unknown>): Promise<GitProviderHttpError> {
  try {
    await call
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(GitProviderHttpError)
    return error as GitProviderHttpError
  }
  throw new Error('the provider call resolved instead of failing')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('host normalization', () => {
  it('accepts a bare host', () => {
    expect(providerSpec('github').normalizeHost('github.com')).toBe('github.com')
  })

  it('reduces a URL with scheme and path to its host', () => {
    expect(providerSpec('gitlab').normalizeHost('https://gitlab.arcuchi.com')).toBe('gitlab.arcuchi.com')
    expect(providerSpec('gitlab').normalizeHost('https://gitlab.arcuchi.com/group/project?ref=main#readme'))
      .toBe('gitlab.arcuchi.com')
  })

  it('lowercases the host and keeps a non-default port', () => {
    expect(providerSpec('gitee').normalizeHost('https://GitLab.Example.COM:8443/group')).toBe('gitlab.example.com:8443')
  })

  it('drops credentials and trailing dots and slashes', () => {
    expect(providerSpec('github').normalizeHost('https://user:secret@github.com./')).toBe('github.com')
  })

  it('accepts a protocol-relative value', () => {
    expect(providerSpec('github').normalizeHost('//github.com/acme')).toBe('github.com')
  })

  it.each(['', '   ', 'git hub.com', 'https://', 'bad_host!', ':8443', 'host:99999'])(
    'rejects %j as a host',
    raw => {
      expect(() => providerSpec('github').normalizeHost(raw)).toThrow(ProviderDataError)
    },
  )

  it('explains why an empty host is unusable', () => {
    expect(() => providerSpec('github').normalizeHost('')).toThrow(/Git host/)
  })

  it('exposes the public default host for every provider', () => {
    expect(providerSpec('github').defaultHost).toBe('github.com')
    expect(providerSpec('gitlab').defaultHost).toBe('gitlab.com')
    expect(providerSpec('gitee').defaultHost).toBe('gitee.com')
    for (const provider of ['github', 'gitlab', 'gitee'] as const) {
      const spec = providerSpec(provider)
      expect(spec.id).toBe(provider)
      expect(spec.normalizeHost(`https://${spec.defaultHost}/`)).toBe(spec.defaultHost)
    }
  })
})

describe('knownProviderForHost', () => {
  it('names the public hosts exactly', () => {
    expect(knownProviderForHost('github.com')).toBe('github')
    expect(knownProviderForHost('gitlab.com')).toBe('gitlab')
    expect(knownProviderForHost('gitee.com')).toBe('gitee')
  })

  it('recognizes self-hosted hosts by name hint', () => {
    expect(knownProviderForHost('gitlab.arcuchi.com')).toBe('gitlab')
    expect(knownProviderForHost('gitee.enterprise.cn')).toBe('gitee')
    expect(knownProviderForHost('github.corp.example')).toBe('github')
  })

  it('normalizes before matching', () => {
    expect(knownProviderForHost('https://GitHub.com/acme')).toBe('github')
  })

  it('returns undefined for hosts that match no provider', () => {
    expect(knownProviderForHost('bitbucket.org')).toBeUndefined()
    expect(knownProviderForHost('code.example.com')).toBeUndefined()
  })
})

describe('provider request construction', () => {
  it('sends a GitHub token as a bearer header to the public API host', () => {
    const request = providerSpec('github').userRequest('github.com', 'ghp_fixture')
    expect(request.url).toBe(GITHUB_USER)
    expect(request.headers).toEqual({
      Authorization: 'Bearer ghp_fixture',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'user-agent': 'dsh-worktree',
    })
  })

  it('uses the /api/v3 path on a custom GitHub host', () => {
    expect(providerSpec('github').userRequest('github.corp.example', 'ghp_fixture').url)
      .toBe('https://github.corp.example/api/v3/user')
  })

  it('builds the GitHub project page request', () => {
    const request = providerSpec('github').projectsRequest('github.com', 'ghp_fixture', 2)
    expect(request.url).toBe(
      'https://api.github.com/user/repos?per_page=100&page=2&sort=updated'
      + '&affiliation=owner,collaborator,organization_member',
    )
    expect(request.headers.Authorization).toBe('Bearer ghp_fixture')
  })

  it('sends a GitLab token as a PRIVATE-TOKEN header', () => {
    const request = providerSpec('gitlab').userRequest('gitlab.com', 'glpat_fixture')
    expect(request.url).toBe('https://gitlab.com/api/v4/user')
    expect(request.headers).toEqual({ 'PRIVATE-TOKEN': 'glpat_fixture' })
  })

  it('builds the GitLab project page request on a self-hosted host', () => {
    expect(providerSpec('gitlab').projectsRequest('gitlab.arcuchi.com', 'glpat_fixture', 3).url).toBe(
      'https://gitlab.arcuchi.com/api/v4/projects?membership=true&simple=true&per_page=100&page=3'
      + '&order_by=last_activity_at&sort=desc',
    )
  })

  it('sends a Gitee token in the query string and no authorization header', () => {
    const request = providerSpec('gitee').userRequest('gitee.com', 'gitee_fixture')
    expect(request.url).toBe('https://gitee.com/api/v5/user?access_token=gitee_fixture')
    expect(request.headers).toEqual({})
  })

  it('encodes query-significant characters in a Gitee token', () => {
    const request = providerSpec('gitee').userRequest('gitee.com', 'a&b=c')
    expect(request.url).toBe(`https://gitee.com/api/v5/user?access_token=${encodeURIComponent('a&b=c')}`)
    expect(request.url).not.toContain('a&b')
  })

  it('builds the Gitee project page request on a custom host', () => {
    expect(providerSpec('gitee').projectsRequest('gitee.enterprise.cn', 'gitee_fixture', 2).url).toBe(
      'https://gitee.enterprise.cn/api/v5/user/repos?access_token=gitee_fixture&per_page=100&page=2&sort=updated',
    )
  })
})

describe('profile parsing', () => {
  it('reads the GitHub profile and reported scopes', () => {
    const profile = providerSpec('github').parseProfile({
      login: 'octocat',
      name: 'The Octocat',
      email: 'octocat@example.com',
      html_url: 'https://github.com/octocat',
      public_repos: 8,
    }, new Headers({ 'x-oauth-scopes': 'repo, read:user' }))
    expect(profile).toEqual({
      login: 'octocat',
      name: 'The Octocat',
      email: 'octocat@example.com',
      profileUrl: 'https://github.com/octocat',
      scopes: 'repo, read:user',
    })
  })

  it('leaves unreported GitHub profile fields undefined', () => {
    const profile = providerSpec('github').parseProfile({
      login: 'octocat',
      name: null,
      email: null,
      html_url: null,
    }, new Headers())
    expect(profile).toEqual({ login: 'octocat' })
    expect(profile.name).toBeUndefined()
    expect(profile.email).toBeUndefined()
    expect(profile.profileUrl).toBeUndefined()
    expect(profile.scopes).toBeUndefined()
  })

  it('rejects a GitHub profile without a login', () => {
    expect(() => providerSpec('github').parseProfile({ name: 'x' }, new Headers())).toThrow(/login/)
    expect(() => providerSpec('github').parseProfile({ login: 42 }, new Headers())).toThrow(ProviderDataError)
    expect(() => providerSpec('github').parseProfile(null, new Headers())).toThrow(/JSON object/)
    expect(() => providerSpec('github').parseProfile([], new Headers())).toThrow(/JSON object/)
  })

  it('reads the GitLab profile', () => {
    const profile = providerSpec('gitlab').parseProfile({
      username: 'alice',
      name: 'Alice',
      email: 'alice@example.com',
      web_url: 'https://gitlab.com/alice',
      avatar_url: 'https://gitlab.com/uploads/alice.png',
    }, new Headers())
    expect(profile).toEqual({
      login: 'alice',
      name: 'Alice',
      email: 'alice@example.com',
      profileUrl: 'https://gitlab.com/alice',
    })
  })

  it('rejects a GitLab profile without a username', () => {
    expect(() => providerSpec('gitlab').parseProfile({ login: 'alice' }, new Headers())).toThrow(/username/)
  })

  it('reads the Gitee profile', () => {
    const profile = providerSpec('gitee').parseProfile({
      login: 'bob',
      name: 'Bob',
      email: 'bob@example.com',
      html_url: 'https://gitee.com/bob',
    }, new Headers())
    expect(profile).toEqual({
      login: 'bob',
      name: 'Bob',
      email: 'bob@example.com',
      profileUrl: 'https://gitee.com/bob',
    })
  })

  it('rejects a Gitee profile without a login', () => {
    expect(() => providerSpec('gitee').parseProfile({ id: 1 }, new Headers())).toThrow(ProviderDataError)
  })
})

describe('project parsing', () => {
  const GITHUB_PROJECTS = [
    {
      id: 1296269,
      full_name: 'octocat/Hello-World',
      name: 'Hello-World',
      description: 'My first repository on GitHub!',
      private: false,
      default_branch: 'main',
      updated_at: '2026-10-20T10:00:00Z',
      html_url: 'https://github.com/octocat/Hello-World',
      clone_url: 'https://github.com/octocat/Hello-World.git',
      ssh_url: 'git@github.com:octocat/Hello-World.git',
      owner: { login: 'octocat' },
    },
    {
      id: 42,
      full_name: 'acme/private-widgets',
      name: 'private-widgets',
      private: true,
      html_url: 'https://github.com/acme/private-widgets',
      clone_url: 'https://github.com/acme/private-widgets.git',
    },
  ]

  it('maps GitHub projects and folds the private flag into visibility', () => {
    const page = providerSpec('github').parseProjects(GITHUB_PROJECTS, new Headers())
    expect(page.hasMore).toBe(false)
    expect(page.projects).toHaveLength(2)
    expect(page.projects[0]).toEqual({
      id: '1296269',
      fullName: 'octocat/Hello-World',
      name: 'Hello-World',
      description: 'My first repository on GitHub!',
      visibility: 'public',
      defaultBranch: 'main',
      updatedAt: '2026-10-20T10:00:00Z',
      webUrl: 'https://github.com/octocat/Hello-World',
      httpsUrl: 'https://github.com/octocat/Hello-World.git',
      sshUrl: 'git@github.com:octocat/Hello-World.git',
    })
    expect(page.projects[1]).toEqual({
      id: '42',
      fullName: 'acme/private-widgets',
      name: 'private-widgets',
      visibility: 'private',
      webUrl: 'https://github.com/acme/private-widgets',
      httpsUrl: 'https://github.com/acme/private-widgets.git',
    })
  })

  it('falls back to full_name when GitHub omits the numeric id', () => {
    const page = providerSpec('github').parseProjects([{
      full_name: 'acme/no-id',
      html_url: 'https://github.com/acme/no-id',
      clone_url: 'https://github.com/acme/no-id.git',
    }], new Headers())
    expect(page.projects[0]?.id).toBe('acme/no-id')
    expect(page.projects[0]?.name).toBe('no-id')
  })

  it('reports another GitHub page from the Link header', () => {
    const headers = new Headers({
      link: '<https://api.github.com/user/repos?per_page=100&page=2>; rel="next", '
        + '<https://api.github.com/user/repos?page=4>; rel="last"',
    })
    expect(providerSpec('github').parseProjects([], headers).hasMore).toBe(true)
  })

  it('reports another GitHub page when a full page arrives without a Link header', () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      full_name: `acme/repo-${index + 1}`,
      html_url: `https://github.com/acme/repo-${index + 1}`,
      clone_url: `https://github.com/acme/repo-${index + 1}.git`,
    }))
    const page = providerSpec('github').parseProjects(fullPage, new Headers())
    expect(page.projects).toHaveLength(100)
    expect(page.hasMore).toBe(true)
  })

  it('rejects a GitHub project page that is not an array', () => {
    expect(() => providerSpec('github').parseProjects({ message: 'nope' }, new Headers()))
      .toThrow(/not a JSON array/)
  })

  it('rejects a GitHub project row without a full_name or web URL', () => {
    expect(() => providerSpec('github').parseProjects([{
      html_url: 'https://github.com/acme/x',
      clone_url: 'https://github.com/acme/x.git',
    }], new Headers())).toThrow(/full_name/)
    expect(() => providerSpec('github').parseProjects([{
      full_name: 'acme/x',
      clone_url: 'https://github.com/acme/x.git',
    }], new Headers())).toThrow(/html_url/)
  })

  const GITLAB_PROJECTS = [
    {
      id: 278964,
      path_with_namespace: 'gitlab-org/gitlab',
      name: 'GitLab',
      description: 'The open source DevOps platform',
      visibility: 'public',
      default_branch: 'master',
      last_activity_at: '2026-10-22T09:30:00Z',
      web_url: 'https://gitlab.com/gitlab-org/gitlab',
      http_url_to_repo: 'https://gitlab.com/gitlab-org/gitlab.git',
      ssh_url_to_repo: 'git@gitlab.com:gitlab-org/gitlab.git',
    },
    {
      id: 7,
      path_with_namespace: 'acme/internal-tools',
      name: 'internal-tools',
      visibility: 'internal',
      web_url: 'https://gitlab.com/acme/internal-tools',
      http_url_to_repo: 'https://gitlab.com/acme/internal-tools.git',
    },
    {
      id: 8,
      path_with_namespace: 'acme/secret',
      name: 'secret',
      visibility: 'private',
      web_url: 'https://gitlab.com/acme/secret',
      http_url_to_repo: 'https://gitlab.com/acme/secret.git',
    },
    {
      id: 9,
      path_with_namespace: 'acme/odd',
      name: 'odd',
      visibility: 'top-secret',
      web_url: 'https://gitlab.com/acme/odd',
      http_url_to_repo: 'https://gitlab.com/acme/odd.git',
    },
  ]

  it('maps GitLab projects including internal and unknown visibility', () => {
    const page = providerSpec('gitlab').parseProjects(GITLAB_PROJECTS, new Headers())
    expect(page.projects.map(project => project.visibility)).toEqual(['public', 'internal', 'private', 'unknown'])
    expect(page.projects[0]).toEqual({
      id: '278964',
      fullName: 'gitlab-org/gitlab',
      name: 'GitLab',
      description: 'The open source DevOps platform',
      visibility: 'public',
      defaultBranch: 'master',
      updatedAt: '2026-10-22T09:30:00Z',
      webUrl: 'https://gitlab.com/gitlab-org/gitlab',
      httpsUrl: 'https://gitlab.com/gitlab-org/gitlab.git',
      sshUrl: 'git@gitlab.com:gitlab-org/gitlab.git',
    })
    expect(page.projects[1]).toEqual({
      id: '7',
      fullName: 'acme/internal-tools',
      name: 'internal-tools',
      visibility: 'internal',
      webUrl: 'https://gitlab.com/acme/internal-tools',
      httpsUrl: 'https://gitlab.com/acme/internal-tools.git',
    })
  })

  it('reports another GitLab page from x-next-page', () => {
    expect(providerSpec('gitlab').parseProjects([], new Headers({ 'x-next-page': '2' })).hasMore).toBe(true)
    expect(providerSpec('gitlab').parseProjects([], new Headers({ 'x-next-page': '' })).hasMore).toBe(false)
  })

  it('reports another GitLab page when a full page arrives', () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      path_with_namespace: `acme/repo-${index + 1}`,
      name: `repo-${index + 1}`,
      visibility: 'private',
      web_url: `https://gitlab.com/acme/repo-${index + 1}`,
      http_url_to_repo: `https://gitlab.com/acme/repo-${index + 1}.git`,
    }))
    expect(providerSpec('gitlab').parseProjects(fullPage, new Headers()).hasMore).toBe(true)
  })

  it('rejects a GitLab project row without path_with_namespace', () => {
    expect(() => providerSpec('gitlab').parseProjects([{
      id: 1,
      web_url: 'https://gitlab.com/acme/x',
      http_url_to_repo: 'https://gitlab.com/acme/x.git',
    }], new Headers())).toThrow(/path_with_namespace/)
  })

  const GITEE_PROJECTS = [
    {
      id: 123456,
      full_name: 'oschina/git-osc',
      name: 'git-osc',
      description: 'Git@OSC',
      private: false,
      default_branch: 'master',
      updated_at: '2026-10-01T02:00:00Z',
      html_url: 'https://gitee.com/oschina/git-osc',
      clone_url: 'https://gitee.com/oschina/git-osc.git',
      ssh_url: 'git@gitee.com:oschina/git-osc.git',
    },
    {
      id: 654321,
      full_name: 'acme/hidden',
      name: 'hidden',
      private: true,
      html_url: 'https://gitee.com/acme/hidden',
      clone_url: 'https://gitee.com/acme/hidden.git',
    },
  ]

  it('maps Gitee projects and private flags', () => {
    const page = providerSpec('gitee').parseProjects(GITEE_PROJECTS, new Headers())
    expect(page.projects.map(project => project.visibility)).toEqual(['public', 'private'])
    expect(page.projects[0]).toEqual({
      id: '123456',
      fullName: 'oschina/git-osc',
      name: 'git-osc',
      description: 'Git@OSC',
      visibility: 'public',
      defaultBranch: 'master',
      updatedAt: '2026-10-01T02:00:00Z',
      webUrl: 'https://gitee.com/oschina/git-osc',
      httpsUrl: 'https://gitee.com/oschina/git-osc.git',
      sshUrl: 'git@gitee.com:oschina/git-osc.git',
    })
    expect(page.projects[1]).toEqual({
      id: '654321',
      fullName: 'acme/hidden',
      name: 'hidden',
      visibility: 'private',
      webUrl: 'https://gitee.com/acme/hidden',
      httpsUrl: 'https://gitee.com/acme/hidden.git',
    })
    expect(page.hasMore).toBe(false)
  })

  it('reports another Gitee page when a full page arrives', () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      full_name: `acme/repo-${index + 1}`,
      name: `repo-${index + 1}`,
      private: false,
      html_url: `https://gitee.com/acme/repo-${index + 1}`,
      clone_url: `https://gitee.com/acme/repo-${index + 1}.git`,
    }))
    expect(providerSpec('gitee').parseProjects(fullPage, new Headers()).hasMore).toBe(true)
  })

  it('rejects a Gitee project row without full_name', () => {
    expect(() => providerSpec('gitee').parseProjects([{
      id: 1,
      html_url: 'https://gitee.com/acme/x',
      clone_url: 'https://gitee.com/acme/x.git',
    }], new Headers())).toThrow(/full_name/)
  })
})

describe('sanitizeRequestUrl', () => {
  it('drops the query string and fragment', () => {
    expect(sanitizeRequestUrl('https://gitee.com/api/v5/user?access_token=secret-token#frag'))
      .toBe('https://gitee.com/api/v5/user')
  })

  it('drops credentials but keeps the host, port, and path', () => {
    expect(sanitizeRequestUrl('https://user:pass@gitlab.example.com:8443/api/v4/user?x=1'))
      .toBe('https://gitlab.example.com:8443/api/v4/user')
  })

  it('strips the query from a value it cannot parse', () => {
    expect(sanitizeRequestUrl('not a url?access_token=secret-token')).toBe('not a url')
  })

  it('strips credentials from a value it cannot parse', () => {
    expect(sanitizeRequestUrl('//user:pass@host/path?access_token=secret-token')).toBe('//host/path')
  })
})

describe('fetchProviderJson', () => {
  it('returns the parsed JSON body and the response headers', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ login: 'octocat' }, 200, { 'x-oauth-scopes': 'repo' }))
    const response = await fetchProviderJson({ url: GITHUB_USER, headers: { Authorization: 'Bearer ghp_fixture' } })
    expect(response.body).toEqual({ login: 'octocat' })
    expect(response.headers.get('x-oauth-scopes')).toBe('repo')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(GITHUB_USER)
    expect(init).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer ghp_fixture' } })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('classifies 401 as unauthorized and keeps the provider message', async () => {
    stubFetch(async () => jsonResponse({ message: 'Bad credentials' }, 401))
    const error = await providerError(fetchProviderJson({ url: GITHUB_USER, headers: {} }))
    expect(error).toMatchObject({ code: 'unauthorized', status: 401 })
    expect(error.message).toContain('Bad credentials')
    expect(error.message).not.toContain('ghp_fixture')
  })

  it('classifies an exhausted 403 as rate_limited', async () => {
    stubFetch(async () => jsonResponse({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0' }))
    const error = await providerError(fetchProviderJson({ url: GITHUB_USER, headers: {} }))
    expect(error).toMatchObject({ code: 'rate_limited', status: 403 })
    expect(error.message).toContain('API rate limit exceeded')
  })

  it('classifies any other 403 as forbidden', async () => {
    stubFetch(async () => jsonResponse({ message: 'Resource not accessible by integration' }, 403, {
      'x-ratelimit-remaining': '42',
    }))
    const error = await providerError(fetchProviderJson({ url: GITHUB_USER, headers: {} }))
    expect(error).toMatchObject({ code: 'forbidden', status: 403 })
  })

  it('classifies 404 as not_found', async () => {
    stubFetch(async () => jsonResponse({ message: 'Not Found' }, 404))
    const error = await providerError(fetchProviderJson({ url: GITHUB_USER, headers: {} }))
    expect(error).toMatchObject({ code: 'not_found', status: 404 })
  })

  it('classifies 429 as rate_limited', async () => {
    stubFetch(async () => jsonResponse({ message: 'Too many requests' }, 429))
    const error = await providerError(fetchProviderJson({ url: GITHUB_USER, headers: {} }))
    expect(error).toMatchObject({ code: 'rate_limited', status: 429 })
  })

  it('classifies an unexpected status as bad_response', async () => {
    stubFetch(async () => new Response('upstream exploded', { status: 500, statusText: 'Internal Server Error' }))
    const error = await providerError(fetchProviderJson({ url: GITHUB_USER, headers: {} }))
    expect(error).toMatchObject({ code: 'bad_response', status: 500 })
    expect(error.message).toContain('HTTP 500')
    expect(error.message).toContain('Internal Server Error')
  })

  it('reports a successful response whose body is not JSON', async () => {
    stubFetch(async () => new Response('<html>gateway</html>', { status: 200 }))
    const error = await providerError(fetchProviderJson({ url: GITHUB_USER, headers: {} }))
    expect(error.code).toBe('bad_response')
    expect(error.message).toMatch(/other than JSON/)
  })

  it('reads error_description from an OAuth-style error body', async () => {
    stubFetch(async () => jsonResponse({ error_description: 'The authorization has expired' }, 400))
    const error = await providerError(fetchProviderJson({ url: GITHUB_USER, headers: {} }))
    expect(error.code).toBe('bad_response')
    expect(error.message).toContain('The authorization has expired')
  })

  it('reads a nested provider error message', async () => {
    stubFetch(async () => jsonResponse({ error: { message: 'nested refusal' } }, 422))
    const error = await providerError(fetchProviderJson({ url: GITHUB_USER, headers: {} }))
    expect(error.message).toContain('nested refusal')
  })

  it('never puts a query-string token into a refusal message', async () => {
    stubFetch(async () => jsonResponse({ message: 'Bad credentials' }, 401))
    const error = await providerError(fetchProviderJson({
      url: 'https://gitee.com/api/v5/user?access_token=secret-token',
      headers: {},
    }))
    expect(error.message).toContain('https://gitee.com/api/v5/user')
    expect(error.message).not.toContain('secret-token')
    expect(error.message).not.toContain('access_token')
  })

  it('classifies a transport rejection as network without echoing the URL query', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    const error = await providerError(fetchProviderJson({
      url: 'https://gitee.com/api/v5/user?access_token=secret-token',
      headers: {},
    }))
    expect(error.code).toBe('network')
    expect(error.message).toContain('https://gitee.com/api/v5/user')
    expect(error.message).not.toContain('secret-token')
    expect(error.message).not.toContain('access_token')
  })

  it('classifies a timeout as network', async () => {
    stubFetch(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    const error = await providerError(fetchProviderJson({ url: GITHUB_USER, headers: {} }))
    expect(error.code).toBe('network')
    expect(error.message).toMatch(/timed out/)
  })

  it('classifies an abort as network', async () => {
    stubFetch(async () => {
      throw new DOMException('The operation was aborted', 'AbortError')
    })
    const error = await providerError(fetchProviderJson({ url: GITHUB_USER, headers: {} }))
    expect(error.code).toBe('network')
    expect(error.message).toMatch(/aborted/)
  })

  it('refuses a response whose declared length exceeds 4 MiB', async () => {
    stubFetch(async () => new Response('{}', {
      status: 200,
      headers: { 'content-length': String(4 * 1024 * 1024 + 1) },
    }))
    const error = await providerError(fetchProviderJson({ url: GITHUB_USER, headers: {} }))
    expect(error.code).toBe('bad_response')
    expect(error.message).toMatch(/larger than 4 MiB/)
  })

  it('refuses a streamed response that grows past 4 MiB', async () => {
    stubFetch(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 3; index += 1) controller.enqueue(new Uint8Array(2 * 1024 * 1024))
        controller.close()
      },
    }), { status: 200 }))
    const error = await providerError(fetchProviderJson({ url: GITHUB_USER, headers: {} }))
    expect(error.code).toBe('bad_response')
    expect(error.message).toMatch(/larger than 4 MiB/)
  })
})
