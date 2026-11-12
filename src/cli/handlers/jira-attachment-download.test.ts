import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { saveJiraAttachment } from './jira-attachment-download'
import type { JiraAttachmentReadResult } from '../../shared/jira/jira-agent-access'

const chunk: JiraAttachmentReadResult = {
  id: '10',
  filename: '../../shot.png',
  mimeType: 'image/png',
  size: 3,
  content: 'YWJj',
  offset: 0,
  nextOffset: null
}

it('contains untrusted attachment filenames inside the output directory and refuses overwrites', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orca-jira-download-'))
  try {
    const file = await saveJiraAttachment(directory, chunk, async () => {
      throw new Error('Unexpected chunk')
    })
    expect(file.path).toBe(join(directory, '10-shot.png'))
    expect(await readFile(file.path, 'utf8')).toBe('abc')
    await expect(saveJiraAttachment(directory, chunk, async () => chunk)).rejects.toMatchObject({
      code: 'jira_attachment_exists'
    })
    expect(await readFile(file.path, 'utf8')).toBe('abc')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('removes incomplete files when the chunk offsets are inconsistent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orca-jira-download-'))
  try {
    await writeFile(join(directory, 'keep.txt'), 'keep')
    await expect(
      saveJiraAttachment(directory, { ...chunk, size: 6, nextOffset: 3 }, async () => ({
        ...chunk,
        size: 6,
        offset: 4
      }))
    ).rejects.toMatchObject({ code: 'jira_attachment_transfer_failed' })
    expect(await readdir(directory)).toEqual(['keep.txt'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
