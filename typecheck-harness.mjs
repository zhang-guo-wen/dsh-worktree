import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(fileURLToPath(import.meta.url))
const harness = resolve(process.env.DSH_HARNESS_ROOT ?? resolve(root, '../../deepseek-harness'))

function config(path, extendsPath) {
  const read = ts.readConfigFile(path, ts.sys.readFile)
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
  if (extendsPath) read.config.extends = extendsPath
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(path), undefined, path)
  if (parsed.errors.length) throw new Error(format(parsed.errors))
  return parsed
}

function format(diagnostics) {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: path => path,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  })
}

const plugin = config(resolve(root, 'tsconfig.harness.json'), resolve(harness, 'tsconfig.base.json'))
let failed = false
for (const face of ['host', 'client']) {
  const upstream = config(resolve(harness, `tsconfig.${face}.json`))
  // Referenced projects retain their own compiler options. Flattening vendor,
  // Host and Client source into this plugin's Program creates artificial errors.
  const options = {
    ...plugin.options,
    noEmit: true,
    composite: false,
    incremental: false,
    disableSourceOfProjectReferenceRedirect: true,
  }
  const roots = plugin.fileNames.filter(path => {
    const client = relative(root, path).replaceAll('\\', '/').startsWith('src/client/')
    return face === 'client' ? client : !client
  })
  if (face === 'client') {
    const client = config(resolve(harness, 'tsconfig.base.client.json'))
    options.lib = client.options.lib
    options.typeRoots = [...client.options.typeRoots, resolve(root, 'node_modules/@types')]
    options.types = ['node', 'react', 'client-build-environment']
    // Use the existing package CSS declarations, not a permissive wildcard.
    roots.push(...upstream.fileNames.filter(path => path.endsWith('/css-modules.d.ts') || path.endsWith('\\css-modules.d.ts')))
  }
  // Check the upstream face separately as well: project references must not
  // conceal real Harness failures. Existing outputs/contracts are a prerequisite.
  for (const [label, fileNames, compilerOptions, references] of [
    [`Harness ${face}`, upstream.fileNames, { ...upstream.options, noEmit: true, incremental: false, composite: false }, upstream.projectReferences],
    [`Worktree ${face}`, roots, options, upstream.projectReferences],
  ]) {
    const program = ts.createProgram({ rootNames: fileNames, options: compilerOptions, projectReferences: references })
    const diagnostics = ts.getPreEmitDiagnostics(program)
    console.log(`${label}: ${diagnostics.length} diagnostics`)
    if (diagnostics.length) {
      console.error(format(diagnostics))
      failed = true
    }
  }
}
if (failed) process.exitCode = 1
