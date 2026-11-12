import { describe, expect, it } from 'vitest'
import { markdownToAdf } from './markdown-adf'

describe('Markdown comment ADF', () => {
  it('preserves nested lists, emphasis, links and inline code', () => {
    expect(
      markdownToAdf('- **bold** and *soft*\n  1. [review](https://example.com/pull/3) with `code`')
    ).toEqual({
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
                    { type: 'text', text: ' and ' },
                    { type: 'text', text: 'soft', marks: [{ type: 'em' }] }
                  ]
                },
                {
                  type: 'orderedList',
                  attrs: { order: 1 },
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          content: [
                            {
                              type: 'text',
                              text: 'review',
                              marks: [
                                { type: 'link', attrs: { href: 'https://example.com/pull/3' } }
                              ]
                            },
                            { type: 'text', text: ' with ' },
                            { type: 'text', text: 'code', marks: [{ type: 'code' }] }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })
  })
  it('keeps executable and credential-bearing destinations out of link marks', () => {
    expect(
      markdownToAdf('[run](javascript:alert) [secret](https://user:password@example.com/x)')
    ).toEqual({
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'run' },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'secret' }
          ]
        }
      ]
    })
  })
})
