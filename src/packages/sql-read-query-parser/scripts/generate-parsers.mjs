import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
// The pinned package's public index exports a type as a value; its CLI imports Tool directly.
const { Tool } = await import(new URL('./Tool.js', import.meta.resolve('antlr-ng')).href)
const targets = [
  { directory: 'postgresql', lexer: 'PostgreSQLLexer', parser: 'PostgreSQLParser', entry: 'root' },
  { directory: 'tsql', lexer: 'TSqlLexer', parser: 'TSqlParser', entry: 'tsql_file' },
  { directory: 'plsql', lexer: 'PlSqlLexer', parser: 'PlSqlParser', entry: 'sql_script' }
]

for (const target of targets) {
  const input = join(root, 'grammars', target.directory)
  const output = join(root, 'generated-src', target.directory)
  await mkdir(output, { recursive: true })
  for (const file of await readdir(input)) {
    if (file.endsWith('.g4')) {
      const grammar = (await readFile(join(input, file), 'utf8')).replace(
        /\/\/ Insert here @header for C\+\+ (lexer|parser)\./g,
        (_, kind) => {
          const base = `${kind === 'lexer' ? target.lexer : target.parser}Base`
          return `@header {import { ${base} } from "./${base}.js"}`
        }
      )
      await writeFile(join(output, file), grammar)
    } else if (file.endsWith('.ts')) {
      await copyFile(join(input, file), join(output, file))
    }
  }
  const tool = new Tool([
    '-Dlanguage=TypeScript',
    '--exact-output-dir',
    '-o',
    output,
    '--lib',
    output,
    join(output, `${target.lexer}.g4`),
    join(output, `${target.parser}.g4`)
  ])
  tool.processGrammarsOnCommandLine()
  if (tool.errorManager.errors > 0) {
    throw new Error(`SQL parser generation failed: ${target.directory}`)
  }
}

const imports = targets.flatMap((t) => [
  `import { ${t.lexer} } from "./${t.directory}/${t.lexer}.js"`,
  `import { ${t.parser} } from "./${t.directory}/${t.parser}.js"`
])
const cases = targets.map((t, i) => {
  const engine = ['postgres', 'sql-server', 'oracle'][i]
  return `case "${engine}": { const lexer = new ${
    t.lexer
  }(CharStream.fromString(sql)); const stream = new CommonTokenStream(lexer); const parser = new ${
    t.parser
  }(stream); return { lexer, parser, stream, root: () => parser.${t.entry}() }; }`
})
const entry = join(root, 'generated-src', 'engines.ts')
await writeFile(
  entry,
  `import { CharStream, CommonTokenStream, ParserRuleContext } from "antlr4ng"\n${imports.join(
    '\n'
  )}\nexport function createDialect(engine, sql) { switch(engine) { ${cases.join(
    '\n'
  )} default: throw new Error("Unsupported SQL dialect") } }\nexport function isSqlRuleContext(node) { return node instanceof ParserRuleContext }\n`
)
await mkdir(join(root, 'generated'), { recursive: true })
await build({
  entryPoints: [entry],
  outfile: join(root, 'generated', 'engines.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['antlr4ng'],
  logLevel: 'warning'
})
await writeFile(
  join(root, 'generated', 'engines.d.ts'),
  'import type { Lexer, Parser, ParserRuleContext, CommonTokenStream } from "antlr4ng"\nexport declare function createDialect(engine: "postgres" | "sql-server" | "oracle", sql: string): { lexer: Lexer; parser: Parser; stream: CommonTokenStream; root(): ParserRuleContext }\nexport declare function isSqlRuleContext(node: unknown): node is ParserRuleContext\n'
)
