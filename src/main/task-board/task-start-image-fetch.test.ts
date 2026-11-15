import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { TaskStartImage } from '../../shared/task-board/task-start-context-types'
import { writeTaskStartImages } from './task-start-context-images'
import {
  fetchTaskStartImage,
  type ImageFetchDeps,
  type ImageResponse
} from './task-start-image-fetch'

const description = { kind: 'description' } as const

function answer(contentType: string, chunks: string[]): ImageResponse {
  return {
    status: 200,
    contentType,
    body: (async function* () {
      for (const chunk of chunks) {
        yield Buffer.from(chunk)
      }
    })(),
    abort: vi.fn()
  }
}

function deps(addresses: Record<string, string>, response: () => ImageResponse): ImageFetchDeps {
  return {
    resolve: async (host) => [{ address: addresses[host] ?? '93.184.215.14', family: 4 }],
    get: vi.fn(async () => response())
  }
}

describe('fetchTaskStartImage', () => {
  it('refuses loopback, private and plain-http image URLs without connecting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'task-start-'))
    const fetchDeps = deps({ 'intranet.example': '10.0.0.5' }, () => answer('image/png', ['x']))
    const images: TaskStartImage[] = [
      'https://127.0.0.1/a.png',
      'https://[::1]/b.png',
      'https://intranet.example/c.png',
      'http://example.com/d.png'
    ].map((url) => ({ origin: description, url }))

    const out = await writeTaskStartImages(images, { kind: 'local', rootDir: root }, 'run1', (i) =>
      fetchTaskStartImage(i.url, fetchDeps)
    )

    expect(out.map((image) => image.failed)).toEqual([true, true, true, true])
    expect(fetchDeps.get).not.toHaveBeenCalled()
  })

  it('accepts only an image answer', async () => {
    await expect(
      fetchTaskStartImage(
        'https://example.com/a.png',
        deps({}, () => answer('text/html', ['<p>']))
      )
    ).rejects.toThrow('Not an image')
    const png = await fetchTaskStartImage(
      'https://example.com/a.png',
      deps({}, () => answer('image/png', ['ok']))
    )
    expect(png.toString()).toBe('ok')
  })

  it('aborts an image past the byte cap', async () => {
    const response = answer('image/png', ['12345', '67890'])
    await expect(
      fetchTaskStartImage(
        'https://example.com/a.png',
        deps({}, () => response),
        8
      )
    ).rejects.toThrow('Image is too large')
    expect(response.abort).toHaveBeenCalled()
  })
})

describe('writeTaskStartImages caps', () => {
  it('saves the first 20 images and keeps the rest as URLs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'task-start-'))
    const images: TaskStartImage[] = Array.from({ length: 22 }, (_, i) => ({
      origin: description,
      url: `https://h/${i}.png`
    }))

    const out = await writeTaskStartImages(
      images,
      { kind: 'local', rootDir: root },
      'run1',
      async () => Buffer.from('ok')
    )

    expect(out.filter((image) => image.path)).toHaveLength(20)
    expect(out.slice(20)).toEqual([
      { origin: description, url: 'https://h/20.png', failed: true },
      { origin: description, url: 'https://h/21.png', failed: true }
    ])
  })
})
