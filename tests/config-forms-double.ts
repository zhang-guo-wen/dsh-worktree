/**
 * The configuration-forms double the browser-half specs mount against.
 *
 * A spec that mounts the browser half needs this service present before
 * `apply` runs: the settings page builds its staged form from it, and a page
 * is registered while the Host serves the entry. The double keeps both
 * decisions in the spec's hands — whether the entry is served, and what the
 * next write records — instead of standing up the real describe mirror and its
 * transport.
 */

/** One form snapshot, in the shape the shared form model reads. */
export interface ConfigFormDoubleSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value: Record<string, unknown> | undefined
  base: unknown
  user: unknown
  revision: number | undefined
  writable: boolean
  mode: 'host' | 'memory'
}

/** One recorded mutation. */
export interface RecordedMutation {
  readonly ops: readonly { readonly op: string; readonly path: readonly string[]; readonly value?: unknown }[]
  readonly expectedRevision: number | undefined
}

/** What a mounted browser half's configuration-forms double exposes. */
export interface ConfigFormsDouble {
  /** The service value itself, ready for `ctx.provide`. */
  readonly service: unknown
  /** Snapshots the page reads; a case replaces one to simulate a Host edit. */
  readonly snapshot: { current: ConfigFormDoubleSnapshot }
  /** Mutations the page's save performed, in order. */
  readonly mutations: RecordedMutation[]
  /** Namespaces the page asked the Host to serve. */
  readonly watched: string[][]
}

/**
 * Build a configuration-forms double.
 * @param options.served - whether the Host serves the entry, which is what lets the page register.
 * @param options.value - the entry's resolved section, as the Host would project it.
 * @param options.user - the raw override layer, in which a field's presence marks it overridden.
 * @returns the double's service value and its recorded state.
 */
export function configFormsDouble(options: {
  served?: boolean
  value?: Record<string, unknown>
  user?: Record<string, unknown>
} = {}): ConfigFormsDouble {
  const snapshot = {
    current: {
      status: (options.served ?? false) ? 'ready' : 'loading',
      value: options.value,
      base: {},
      user: options.user ?? {},
      revision: 1,
      writable: true,
      mode: 'host',
    } as ConfigFormDoubleSnapshot,
  }
  const mutations: RecordedMutation[] = []
  const watched: string[][] = []
  const listeners = new Set<() => void>()
  const form = {
    getSnapshot: () => snapshot.current,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    mutate: async (ops: RecordedMutation['ops'], expectedRevision?: number) => {
      mutations.push({ ops, expectedRevision })
      return true
    },
    set: async (field: string, value: unknown) => {
      mutations.push({ ops: [{ op: 'set', path: [field], value }], expectedRevision: undefined })
      return true
    },
    unset: async (field: string) => {
      mutations.push({ ops: [{ op: 'unset', path: [field] }], expectedRevision: undefined })
      return true
    },
  }
  const service = {
    get: () => form,
    whileServed: (namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void) => {
      watched.push([...namespaces])
      const off = (options.served ?? false) ? register(new Set(namespaces)) : undefined
      return () => { off?.() }
    },
  }
  return { service, snapshot, mutations, watched }
}
