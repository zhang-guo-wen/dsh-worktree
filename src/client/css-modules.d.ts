/**
 * Ambient declarations for the browser build of this package.
 * @module @zhang-guo-wen/dsh-worktree/client/env
 */

/** CSS Modules: the bundler replaces this with the compiled class map. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

/** The DSH client module loader this package's browser half registers into. */
declare interface Window {
  __ModuleLoader__?: {
    load(entry: { id: string; factory: (require: (id: string) => unknown) => unknown }): void
  }
}
