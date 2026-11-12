import { Lexer, type Token } from 'marked'

type Node = { type: string; [key: string]: unknown }
type Mark = { type: string; attrs?: Record<string, unknown> }

function inline(tokens: Token[], marks: Mark[] = []): Node[] {
  return tokens.flatMap((token): Node[] => {
    switch (token.type) {
      case 'strong':
      case 'em':
      case 'del':
        return inline(token.tokens ?? [], [
          ...marks,
          { type: token.type === 'strong' ? 'strong' : token.type === 'em' ? 'em' : 'strike' }
        ])
      case 'link': {
        let safe = false
        try {
          const url = new URL(token.href)
          safe =
            ['http:', 'https:', 'mailto:'].includes(url.protocol) && !url.username && !url.password
        } catch {
          // Relative links remain readable text.
        }
        return inline(
          token.tokens ?? [],
          safe ? [...marks, { type: 'link', attrs: { href: token.href } }] : marks
        )
      }
      case 'br':
        return [{ type: 'hardBreak' }]
      case 'codespan':
        return [{ type: 'text', text: token.text, marks: [{ type: 'code' }] }]
      default: {
        if ('tokens' in token && token.tokens) {
          return inline(token.tokens, marks)
        }
        const text = 'text' in token ? token.text : token.raw
        return text ? [{ type: 'text', text, ...(marks.length ? { marks } : {}) }] : []
      }
    }
  })
}

function blocks(tokens: Token[]): Node[] {
  return tokens.flatMap((token): Node[] => {
    switch (token.type) {
      case 'space':
        return []
      case 'list':
        return [
          {
            type: token.ordered ? 'orderedList' : 'bulletList',
            ...(token.ordered ? { attrs: { order: token.start || 1 } } : {}),
            content: token.items.map((item) => ({ type: 'listItem', content: blocks(item.tokens) }))
          }
        ]
      case 'blockquote':
        return [{ type: 'blockquote', content: blocks(token.tokens ?? []) }]
      case 'heading':
        return [
          { type: 'heading', attrs: { level: token.depth }, content: inline(token.tokens ?? []) }
        ]
      case 'code':
        return [
          {
            type: 'codeBlock',
            ...(token.lang ? { attrs: { language: token.lang.split(/\s/)[0] } } : {}),
            content: token.text ? [{ type: 'text', text: token.text }] : []
          }
        ]
      case 'hr':
        return [{ type: 'rule' }]
      default:
        return [
          {
            type: 'paragraph',
            content: inline('tokens' in token && token.tokens ? token.tokens : [token])
          }
        ]
    }
  })
}

export function markdownToAdf(text: string): Node {
  const content = blocks(Lexer.lex(text))
  return {
    type: 'doc',
    version: 1,
    content: content.length ? content : [{ type: 'paragraph', content: [] }]
  }
}
