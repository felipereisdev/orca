import './generate-parsers.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import ts from 'typescript-api'

const root = resolve(import.meta.dirname, '..')
await build({
  entryPoints: [resolve(root, 'src/parse-sql.ts')],
  outfile: resolve(root, 'dist/parse-sql.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['antlr4ng'],
  logLevel: 'warning'
})
const sources = [
  'parse-sql',
  'database-query-syntax',
  'postgres-query-policy',
  'sql-server-query-policy',
  'oracle-query-policy',
  'database-query-policy',
  'database-query-policy-worker-entry',
  'database-query-policy-worker-path'
]
await build({
  entryPoints: sources
    .filter((name) => name !== 'parse-sql')
    .map((name) => resolve(root, `src/${name}.ts`)),
  outdir: resolve(root, 'dist'),
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'warning'
})
for (const name of sources) {
  const declarations = ts.transpileDeclaration(
    await readFile(resolve(root, `src/${name}.ts`), 'utf8'),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }
  )
  if (declarations.diagnostics.length) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(declarations.diagnostics, {
        getCanonicalFileName: (f) => f,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n'
      })
    )
  }
  await writeFile(resolve(root, `dist/${name}.d.ts`), declarations.outputText)
}
