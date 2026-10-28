/**
 * The HTTP edge of the Git-accounts capability.
 *
 * Every provider request goes through {@link fetchProviderJson}, the single
 * place the plugin talks to a Git host. A host answers with JSON, and the
 * handful of ways that can fail are classified here once, so the Host service
 * above maps one error type instead of each provider's own error dialect.
 *
 * Error messages name the endpoint but never its query string: Gitee carries
 * the access token as a URL parameter, so a message that echoed the full URL
 * would put the credential into a route response or a log line.
 * @module @guowenzhang/dsh-worktree/git-accounts/http
 */

/** Largest provider response this plugin reads, in bytes. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/** Longest a provider request may take before it fails as a network error, in milliseconds. */
const REQUEST_TIMEOUT_MS = 5_000

/** How a provider request failed, as the Host service reports it. */
export type ProviderErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'network'
  | 'bad_response'

/**
 * A failed provider request.
 *
 * The message is operator-facing and safe to forward: it carries the sanitized
 * endpoint and the provider's own error text, never the request's query string
 * or headers.
 */
export class GitProviderHttpError extends Error {
  /**
   * @param code - the failure class.
   * @param message - operator-facing text that never contains a token.
   * @param status - the HTTP status when a response was received.
   */
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'GitProviderHttpError'
  }
}

/** One provider response, decoded. */
export interface JsonResponse {
  /** The parsed JSON body. */
  readonly body: unknown
  /** Response headers, for pagination and scope hints. */
  readonly headers: Headers
}

/** One provider request, as the provider catalog builds it. */
export interface JsonRequest {
  /** Absolute request URL; it may carry a query-string credential. */
  readonly url: string
  /** Request headers. */
  readonly headers: Readonly<Record<string, string>>
}

/**
 * Return a URL with its query string, fragment, and credentials removed.
 *
 * Failure messages use this form so a Gitee token living in the query string
 * cannot travel with the message. The path is kept because it names which API
 * call failed.
 * @param url - the request URL to sanitize.
 * @returns `origin` plus path, never a query or fragment.
 */
export function sanitizeRequestUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch (error: unknown) {
    // Requests this plugin builds always parse, but an unparseable value must
    // still lose its query string, which is where a token could sit.
    void error
    return (url.split(/[?#]/, 1)[0] ?? '').replace(/\/\/[^/]*@/, '//')
  }
}

/**
 * Send one provider request and decode its JSON response.
 *
 * The request is a plain GET with the catalog's headers and a 5 second
 * timeout; a response body larger than 4 MiB is refused rather than buffered so
 * one misbehaving endpoint cannot exhaust the Host's memory.
 * @param request - the URL and headers to send.
 * @returns the parsed body and the response headers.
 * @throws {GitProviderHttpError} when the host refuses, the response is not
 * JSON, the size limit is exceeded, or the request cannot complete.
 */
export async function fetchProviderJson(request: JsonRequest): Promise<JsonResponse> {
  const endpoint = sanitizeRequestUrl(request.url)
  let response: Response
  try {
    response = await fetch(request.url, {
      method: 'GET',
      headers: request.headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error: unknown) {
    throw networkError(endpoint, error)
  }
  let text: string
  try {
    text = await readResponseText(response, endpoint)
  } catch (error: unknown) {
    if (error instanceof GitProviderHttpError) throw error
    throw networkError(endpoint, error)
  }
  if (!response.ok) throw responseError(response, text, endpoint)
  return { body: parseJsonBody(text, endpoint), headers: response.headers }
}

/**
 * Classify a non-2xx response from its status and headers.
 * @param response - the received response.
 * @param text - the already-read response body.
 * @param endpoint - the sanitized endpoint for the message.
 * @returns the error to throw.
 */
function responseError(response: Response, text: string, endpoint: string): GitProviderHttpError {
  const detail = providerMessage(text) ?? response.statusText.trim()
  const summary = `Git provider refused ${endpoint} with HTTP ${response.status}`
  return new GitProviderHttpError(
    failureCode(response.status, response.headers),
    detail === '' ? `${summary}.` : `${summary}: ${detail}`,
    response.status,
  )
}

/**
 * Map an HTTP status to the failure class the Host reports.
 * @param status - the HTTP status code.
 * @param headers - response headers, whose rate-limit counter distinguishes an
 * exhausted 403 from a plain permission refusal.
 * @returns the failure class.
 */
function failureCode(status: number, headers: Headers): ProviderErrorCode {
  if (status === 401) return 'unauthorized'
  if (status === 404) return 'not_found'
  if (status === 403) {
    return headers.get('x-ratelimit-remaining')?.trim() === '0' ? 'rate_limited' : 'forbidden'
  }
  if (status === 429) return 'rate_limited'
  return 'bad_response'
}

/**
 * Extract the provider's own explanation from an error body.
 * @param text - the response body.
 * @returns the message, error, or error description; `undefined` when absent.
 */
function providerMessage(text: string): string | undefined {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error: unknown) {
    // A non-JSON error body is itself the answer: the provider said nothing
    // machine-readable, so the caller falls back to the status text.
    void error
    return undefined
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const record = body as Record<string, unknown>
  for (const key of ['message', 'error', 'error_description']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (key === 'error' && typeof value === 'object' && value !== null) {
      const nested = (value as Record<string, unknown>).message
      if (typeof nested === 'string' && nested.trim() !== '') return nested.trim()
    }
  }
  return undefined
}

/**
 * Parse a successful response body as JSON.
 * @param text - the response body.
 * @param endpoint - the sanitized endpoint for the message.
 * @returns the parsed JSON value.
 * @throws {GitProviderHttpError} with code `bad_response` when the body is not JSON.
 */
function parseJsonBody(text: string, endpoint: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error: unknown) {
    void error
    throw new GitProviderHttpError('bad_response', `Git provider answered ${endpoint} with something other than JSON.`)
  }
}

/**
 * Read a response body, refusing one larger than {@link MAX_RESPONSE_BYTES}.
 *
 * The declared content length is checked first so an oversized body is never
 * read at all; the byte count is checked while streaming so a response that
 * lies about (or omits) its length is still bounded.
 * @param response - the response to read.
 * @param endpoint - the sanitized endpoint for the message.
 * @returns the decoded body text.
 * @throws {GitProviderHttpError} with code `bad_response` when the body is too large.
 */
async function readResponseText(response: Response, endpoint: string): Promise<string> {
  const declared = response.headers.get('content-length')
  const declaredBytes = declared === null ? Number.NaN : Number(declared)
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_RESPONSE_BYTES) {
    throw tooLarge(endpoint)
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      total += chunk.value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await cancelReader(reader)
        throw tooLarge(endpoint)
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/**
 * Cancel a response stream whose body will not be read to the end.
 * @param reader - the stream reader to cancel.
 */
async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel()
  } catch (error: unknown) {
    // The body is already discarded; a failing cancel cannot change the outcome.
    void error
  }
}

/**
 * Build the response-too-large error.
 * @param endpoint - the sanitized endpoint for the message.
 * @returns the error to throw.
 */
function tooLarge(endpoint: string): GitProviderHttpError {
  return new GitProviderHttpError(
    'bad_response',
    `The response from ${endpoint} is larger than 4 MiB, which this plugin does not read.`,
  )
}

/**
 * Build the request-failure error for a transport problem or a timeout.
 *
 * The underlying error's own message is deliberately not forwarded: it can
 * include the request URL with its query string.
 * @param endpoint - the sanitized endpoint for the message.
 * @param error - whatever the fetch call or body read rejected with.
 * @returns the error to throw.
 */
function networkError(endpoint: string, error: unknown): GitProviderHttpError {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
  const reason = name === 'TimeoutError'
    ? 'the request timed out after 5 seconds'
    : name === 'AbortError'
      ? 'the request was aborted'
      : 'the host could not be reached'
  return new GitProviderHttpError('network', `Could not reach ${endpoint}: ${reason}.`)
}
