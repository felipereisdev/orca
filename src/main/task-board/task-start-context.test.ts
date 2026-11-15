import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { TaskStartImage } from '../../shared/task-board/task-start-context-types'
import {
  collectTaskStartContext,
  createTaskStartFetchBytes,
  type TaskStartCard,
  type TaskStartContextDeps
} from './task-start-context'
import { createJiraAttachmentRegistry, createTaskStartFetchDeps } from './task-start-context-deps'
import { writeTaskStartImages } from './task-start-context-images'

function card(ref: TaskStartCard['ref'], provider: TaskStartCard['provider']): TaskStartCard {
  return {
    provider,
    displayId: '#1',
    title: 'T',
    url: 'https://gitlab.example/g/p/-/issues/1',
    ref
  }
}

function reject(): never {
  throw new Error('unused reader')
}

function depsWith(overrides: Partial<TaskStartContextDeps>): TaskStartContextDeps {
  return { github: reject, gitlab: reject, jira: reject, linear: reject, ...overrides }
}

const description: TaskStartImage['origin'] = { kind: 'description' }

describe('collectTaskStartContext', () => {
  it('orders GitHub comments chronologically', async () => {
    const deps = depsWith({
      github: async () => ({
        body: 'b',
        comments: [
          { author: 'b', createdAt: '2026-02-01T00:00:00Z', body: 'late' },
          { author: 'a', createdAt: '2026-01-01T00:00:00Z', body: 'early' }
        ]
      })
    })
    const ctx = await collectTaskStartContext(
      card({ provider: 'github', repoId: 'r', number: 1, issueRepo: null }, 'github'),
      deps
    )
    expect(ctx.comments.map((c) => c.body)).toEqual(['early', 'late'])
  })

  it('throws context_fetch_failed when the item cannot be read', async () => {
    const deps = depsWith({
      github: async () => {
        throw new Error('boom')
      }
    })
    await expect(
      collectTaskStartContext(
        card({ provider: 'github', repoId: 'r', number: 1, issueRepo: null }, 'github'),
        deps
      )
    ).rejects.toThrow('context_fetch_failed')
  })

  it('downloads GitLab uploads by secret and file name', async () => {
    const deps = depsWith({
      gitlab: async () => ({ body: 'see ![x](/uploads/abc/x.png)', comments: [] })
    })
    const c = card({ provider: 'gitlab', repoId: 'r', number: 1, projectRef: null }, 'gitlab')
    const ctx = await collectTaskStartContext(c, deps)
    expect(ctx.images[0].url).toBe('https://gitlab.example/g/p/uploads/abc/x.png')
    const gitlabUpload = vi.fn(async () => Buffer.from('x'))
    await createTaskStartFetchBytes(c, { fetchUrl: vi.fn(), gitlabUpload })(ctx.images[0])
    expect(gitlabUpload).toHaveBeenCalledWith(c, 'abc', 'x.png')
  })
})

describe('collectTaskStartContext for Jira', () => {
  it('uses attachments as images and drops inline base64 media', async () => {
    const deps = depsWith({
      jira: async () => ({
        description: 'a ![](data:image/png;base64,AAAA) b',
        attachmentUrls: ['https://j/att/1'],
        comments: [{ createdAt: '2026-01-01T00:00:00Z', body: '![](data:image/png;base64,BBBB)' }]
      })
    })
    const ctx = await collectTaskStartContext(
      card({ provider: 'jira', siteId: null, key: 'A-1' }, 'jira'),
      deps
    )
    expect(ctx.images.map((i) => i.url)).toEqual(['https://j/att/1'])
    expect(JSON.stringify(ctx)).not.toContain('base64')
  })

  it('collects only image uploads from GitLab', async () => {
    const deps = depsWith({
      gitlab: async () => ({
        body: '[f](/uploads/a1/doc.pdf) ![x](/uploads/b2/x.png)',
        comments: []
      })
    })
    const ctx = await collectTaskStartContext(
      card({ provider: 'gitlab', repoId: 'r', number: 1, projectRef: null }, 'gitlab'),
      deps
    )
    expect(ctx.images.map((i) => i.url)).toEqual(['https://gitlab.example/g/p/uploads/b2/x.png'])
  })
})

describe('createTaskStartFetchDeps', () => {
  it('returns GitLab upload bytes unchanged', async () => {
    const glabExec = vi.fn(async (_args: string[], _options: { encoding?: string }) => ({
      stdout: Buffer.from([0x89, 0x50])
    }))
    const fetchDeps = createTaskStartFetchDeps(() => null, createJiraAttachmentRegistry(), glabExec)
    const bytes = await fetchDeps.gitlabUpload(
      card({ provider: 'gitlab', repoId: 'r', number: 1, projectRef: null }, 'gitlab'),
      'abc',
      'x.png'
    )
    expect([...bytes]).toEqual([0x89, 0x50])
    expect(glabExec.mock.calls[0][1]).toMatchObject({ encoding: 'buffer' })
  })
})

describe('writeTaskStartImages', () => {
  it('keeps going when one image fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'task-start-'))
    const images: TaskStartImage[] = [
      { origin: description, url: 'https://h/a.png' },
      { origin: description, url: 'https://h/b.png' }
    ]
    const out = await writeTaskStartImages(
      images,
      { kind: 'local', rootDir: root },
      'run1',
      async (image) => {
        if (image.url.endsWith('a.png')) {
          throw new Error('nope')
        }
        return Buffer.from('ok')
      }
    )
    expect(out[0].failed).toBe(true)
    expect(out[0].path).toBeUndefined()
    expect(out[1].path).toContain(join('task-start', 'run1'))
  })

  it('does not write over SSH to a Windows host', async () => {
    const ssh = { exec: vi.fn(async () => '/home/u'), writeBuffer: vi.fn() }
    const fetchBytes = vi.fn(async () => Buffer.from('x'))
    const out = await writeTaskStartImages(
      [{ origin: description, url: 'https://h/a.png' }],
      { kind: 'ssh', connectionId: 'c', hostPlatform: 'windows' },
      'run1',
      fetchBytes,
      ssh
    )
    expect(ssh.exec).not.toHaveBeenCalled()
    expect(ssh.writeBuffer).not.toHaveBeenCalled()
    expect(out[0].failed).toBe(true)
  })
})
