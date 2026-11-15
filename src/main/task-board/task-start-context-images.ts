import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskStartImage } from '../../shared/task-board/task-start-context-types'

export type TaskStartImageTarget =
  | { kind: 'local'; rootDir: string }
  | { kind: 'ssh'; connectionId: string; hostPlatform: 'posix' | 'windows' }

export type TaskStartSshAccess = {
  /** Runs a shell command on the connection and answers its stdout. */
  exec(connectionId: string, command: string): Promise<string>
  /** `remotePath` must be absolute: the transport expands neither `~` nor creates directories. */
  writeBuffer(connectionId: string, remotePath: string, contents: Buffer): Promise<void>
}

const EXTENSION = /\.[A-Za-z0-9]{1,8}$/

function fileNameFor(image: TaskStartImage, index: number): string {
  let base = ''
  try {
    base = decodeURIComponent(new URL(image.url).pathname.split('/').pop() ?? '')
  } catch {
    base = ''
  }
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '')
  const name = safe || 'image'
  return `${String(index + 1).padStart(2, '0')}-${EXTENSION.test(name) ? name : `${name}.png`}`
}

function kept(image: TaskStartImage): TaskStartImage {
  return { origin: image.origin, url: image.url, failed: true }
}

/** Saves each image under the run's folder; one failing image never stops the others. */
export async function writeTaskStartImages(
  images: TaskStartImage[],
  target: TaskStartImageTarget,
  runId: string,
  fetchBytes: (image: TaskStartImage) => Promise<Buffer>,
  ssh?: TaskStartSshAccess
): Promise<TaskStartImage[]> {
  if (images.length === 0) {
    return []
  }
  if (target.kind === 'ssh' && (target.hostPlatform === 'windows' || !ssh)) {
    return images.map(kept)
  }
  let dir: string
  try {
    if (target.kind === 'local') {
      dir = join(target.rootDir, 'task-start', runId)
      await mkdir(dir, { recursive: true })
    } else {
      const home = (await ssh!.exec(target.connectionId, 'printf %s "$HOME"')).trim()
      if (!home.startsWith('/')) {
        throw new Error('remote HOME is not absolute')
      }
      dir = `${home}/.orca/task-start/${runId}`
      await ssh!.exec(target.connectionId, `mkdir -p '${dir}'`)
    }
  } catch {
    return images.map(kept)
  }
  return Promise.all(
    images.map(async (image, index) => {
      try {
        const bytes = await fetchBytes(image)
        const name = fileNameFor(image, index)
        if (target.kind === 'local') {
          const path = join(dir, name)
          await writeFile(path, bytes)
          return { origin: image.origin, url: image.url, path }
        }
        const path = `${dir}/${name}`
        await ssh!.writeBuffer(target.connectionId, path, bytes)
        return { origin: image.origin, url: image.url, path }
      } catch {
        return kept(image)
      }
    })
  )
}
