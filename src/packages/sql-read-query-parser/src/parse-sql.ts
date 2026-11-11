import { BaseErrorListener, Token } from 'antlr4ng'
import { createDialect, isSqlRuleContext } from '../generated/engines.js'

export type SqlEngine = 'postgres' | 'sql-server' | 'oracle'

export type SqlSyntaxToken = {
  kind: string
  text: string
  index: number
}

export type SqlSyntaxNode = {
  rule: string
  firstToken: number
  lastToken: number
  children: SqlSyntaxNode[]
}

export type SqlSyntax = {
  root: SqlSyntaxNode
  tokens: SqlSyntaxToken[]
}

class RejectSqlSyntaxErrors extends BaseErrorListener {
  override syntaxError(): never {
    throw new Error('SQL syntax is unsupported or invalid')
  }
}

export function parseSql(engine: SqlEngine, sql: string): SqlSyntax {
  if (!sql.trim() || Buffer.byteLength(sql, 'utf8') > 65_536) {
    throw new Error('SQL must contain a query of at most 64 KiB')
  }
  const { lexer, parser, stream, root } = createDialect(engine, sql)
  const errors = new RejectSqlSyntaxErrors()
  lexer.removeErrorListeners()
  parser.removeErrorListeners()
  lexer.addErrorListener(errors)
  parser.addErrorListener(errors)
  stream.fill()
  const rawTokens = stream.getTokens()
  if (rawTokens.length > 16_384) {
    throw new Error('SQL query is too complex')
  }
  let depth = 0
  for (const token of rawTokens) {
    if (token.text === '(' && ++depth > 64) {
      throw new Error('SQL query is too deeply nested')
    }
    if (token.text === ')') {
      depth--
    }
  }
  const parsed = root()
  if (stream.LA(1) !== Token.EOF) {
    throw new Error('SQL contains unparsed input')
  }
  const syntax: SqlSyntaxNode = { rule: '', firstToken: 0, lastToken: 0, children: [] }
  const pending = [{ context: parsed, node: syntax }]
  let nodes = 0
  while (pending.length) {
    const current = pending.pop()!
    if (++nodes > 100_000) {
      throw new Error('SQL query is too complex')
    }
    current.node.rule = parser.ruleNames[current.context.ruleIndex]
    current.node.firstToken = current.context.start?.tokenIndex ?? 0
    current.node.lastToken = current.context.stop?.tokenIndex ?? 0
    for (const child of current.context.children) {
      if (!isSqlRuleContext(child)) {
        continue
      }
      const node: SqlSyntaxNode = { rule: '', firstToken: 0, lastToken: 0, children: [] }
      current.node.children.push(node)
      pending.push({ context: child, node })
    }
  }
  return {
    root: syntax,
    tokens: rawTokens
      .filter((t) => t.channel === Token.DEFAULT_CHANNEL && t.type !== Token.EOF)
      .map((t) => ({
        kind: lexer.vocabulary.getSymbolicName(t.type) ?? '',
        text: t.text ?? '',
        index: t.tokenIndex
      }))
  }
}
