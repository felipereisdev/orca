import { expect, it } from 'vitest'
import { adfToMarkdownText } from './adf-markdown'
import { jiraAgentMarkdownOptions } from './jira-agent-media'
const attachments = [
  { id: '12', filename: 'first.png', mimeType: 'image/png', size: 3 },
  { id: '34', filename: 'second.png', mimeType: 'image/png', size: 3 }
]
function render(ids: string[], html: string): string {
  const body = {
    type: 'doc',
    content: ids.map((id) => ({ type: 'media', attrs: { id, alt: 'unknown.png' } }))
  }
  return adfToMarkdownText(
    body,
    jiraAgentMarkdownOptions(body, html, attachments, 'https://jira.example')
  )
}
it('preserves duplicate image positions when repeated media UUIDs bind consistently', () => {
  expect(
    render(
      ['uuid', 'uuid'],
      '<img src="/secure/attachment/12/first.png"><img src="/secure/attachment/12/first.png">'
    )
  ).toBe('[Attachment: first.png (id: 12)]\n\n[Attachment: first.png (id: 12)]')
  expect(
    render(
      ['uuid', 'uuid'],
      '<img src="/secure/attachment/12/first.png"><img src="/secure/attachment/34/second.png">'
    )
  ).toBe('[Media: uuid]\n\n[Media: uuid]')
})
it('uses explicit image media IDs instead of assuming rendered image order', () => {
  expect(
    render(
      ['a', 'b'],
      '<img data-media-id="b" src="/secure/attachment/34/second.png"><img data-media-id="a" data-attachment-id="12">'
    )
  ).toBe('[Attachment: first.png (id: 12)]\n\n[Attachment: second.png (id: 34)]')
})
it('keeps unknown media unresolved when external or unknown images invalidate the sequence', () => {
  expect(
    render(['uuid'], '<img src="https://external.example/secure/attachment/12/first.png">')
  ).toBe('[Media: uuid]')
  expect(render(['uuid'], '<img src="/secure/attachment/999/unknown.png">')).toBe('[Media: uuid]')
  expect(
    render(
      ['uuid'],
      '<img src="/secure/attachment/12/first.png"><img src="https://external.example/logo.png">'
    )
  ).toBe('[Media: uuid]')
})
it('rejects conflicting explicit bindings and ignores image-shaped markup inside comments and scripts', () => {
  expect(
    render(
      ['uuid'],
      '<img data-media-id="uuid" src="/secure/attachment/12/first.png"><img data-media-id="uuid" src="/secure/attachment/34/second.png">'
    )
  ).toBe('[Media: uuid]')
  expect(
    render(
      ['uuid'],
      '<!-- <img src="/secure/attachment/34/second.png"> --><script>"<img src=\'/secure/attachment/34/second.png\'>"</script><img src="/secure/attachment/12/first.png">'
    )
  ).toBe('[Attachment: first.png (id: 12)]')
})
