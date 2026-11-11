import type { SqlSyntax, SqlSyntaxNode, SqlSyntaxToken } from './parse-sql'

export class DatabaseQuerySyntax {
  readonly rules: SqlSyntaxNode[] = []
  private readonly positions = new Map<number, number>()

  constructor(readonly syntax: SqlSyntax) {
    syntax.tokens.forEach((token, index) => this.positions.set(token.index, index))
    const pending = [syntax.root]
    while (pending.length) {
      const node = pending.pop()!
      this.rules.push(node)
      pending.push(...node.children)
    }
  }

  nodes(rule: string): SqlSyntaxNode[] {
    return this.rules.filter((node) => node.rule === rule)
  }

  tokens(node: SqlSyntaxNode): SqlSyntaxToken[] {
    const first = this.positions.get(node.firstToken)
    const last = this.positions.get(node.lastToken)
    if (first === undefined || last === undefined) {
      return []
    }
    return this.syntax.tokens.slice(first, last + 1)
  }

  name(node: SqlSyntaxNode): string {
    return this.tokens(node)
      .map((token) => token.text)
      .join('')
      .toLowerCase()
  }

  refuseRules(names: readonly string[]): void {
    const denied = new Set(names)
    if (this.rules.some((node) => denied.has(node.rule))) {
      throw new Error('SQL construct is not supported for read-only access')
    }
  }

  refuseKeywords(names: readonly string[]): void {
    const denied = new Set(names)
    if (this.syntax.tokens.some((token) => denied.has(token.kind))) {
      throw new Error('SQL operation is not supported for read-only access')
    }
  }

  requireSingleSelect(statementRule: string, selectRule: string): void {
    const statements = this.nodes(statementRule)
    if (statements.length !== 1 || statements[0].children[0]?.rule !== selectRule) {
      throw new Error('Submit one supported read query')
    }
  }

  requireFunctions(rule: string, allowed: readonly string[], prefix = ''): void {
    const names = new Set(allowed)
    for (const node of this.nodes(rule)) {
      const name = this.name(node)
      if (
        !names.has(name) &&
        (!prefix || !name.startsWith(prefix) || !names.has(name.slice(prefix.length)))
      ) {
        throw new Error('SQL function is outside the supported read-only subset')
      }
    }
  }

  requireLocalRelations(rule: string): void {
    for (const node of this.nodes(rule)) {
      if (this.tokens(node).filter((token) => token.text === '.').length > 1) {
        throw new Error('Cross-database references are not supported')
      }
    }
  }
}
