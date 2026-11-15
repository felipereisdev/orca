import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { mapWithConcurrency } from '../../shared/map-with-concurrency'
import type { TaskStartImage } from '../../shared/task-board/task-start-context-types'
import { TASK_START_IMAGE_MAX_BYTES } from './task-start-image-fetch'

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
export const MAX_TASK_START_IMAGES = 20
const DOWNLOAD_CONCURRENCY = 4

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

/** Run ids are operation ids; anything else could step out of the task-start root. */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

type RunDir = { kind: 'local'; dir: string } | { kind: 'ssh'; connectionId: string; dir: string }

/** The run's folder under the task-start root of the target host; throws when it cannot be named. */
async function runDir(
  target: TaskStartImageTarget,
  runId: string,
  ssh: Pick<TaskStartSshAccess, 'exec'> | undefined
): Promise<RunDir> {
  if (!RUN_ID.test(runId)) {
    throw new Error('unsafe task-start run id')
  }
  if (target.kind === 'local') {
    const root = join(target.rootDir, 'task-start')
    const dir = join(root, runId)
    if (!dir.startsWith(root + sep)) {
      throw new Error('run folder outside the task-start root')
    }
    return { kind: 'local', dir }
  }
  if (target.hostPlatform === 'windows' || !ssh) {
    throw new Error('no posix write channel to the SSH host')
  }
  const home = (await ssh.exec(target.connectionId, 'printf %s "$HOME"')).trim()
  if (!home.startsWith('/')) {
    throw new Error('remote HOME is not absolute')
  }
  const root = `${home.replace(/\/+$/, '')}/.orca/task-start/`
  const dir = `${root}${runId}`
  if (!dir.startsWith(root) || dir.length <= root.length) {
    throw new Error('run folder outside the task-start root')
  }
  return { kind: 'ssh', connectionId: target.connectionId, dir }
}

async function saveImage(
  image: TaskStartImage,
  index: number,
  folder: RunDir,
  fetchBytes: (image: TaskStartImage) => Promise<Buffer>,
  ssh: TaskStartSshAccess | undefined
): Promise<TaskStartImage> {
  try {
    const bytes = await fetchBytes(image)
    // Provider downloads (Jira, GitLab) are held to the same cap as the open-internet fetch.
    if (bytes.length > TASK_START_IMAGE_MAX_BYTES) {
      return kept(image)
    }
    const name = fileNameFor(image, index)
    if (folder.kind === 'local') {
      const path = join(folder.dir, name)
      await writeFile(path, bytes)
      return { origin: image.origin, url: image.url, path }
    }
    const path = `${folder.dir}/${name}`
    await ssh!.writeBuffer(folder.connectionId, path, bytes)
    return { origin: image.origin, url: image.url, path }
  } catch {
    return kept(image)
  }
}

/** Saves up to `MAX_TASK_START_IMAGES` under the run's folder, a few at a time; the rest, and any
 *  that fails, keep only their URL. */
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
  let folder: RunDir
  try {
    folder = await runDir(target, runId, ssh)
    await (folder.kind === 'local'
      ? mkdir(folder.dir, { recursive: true })
      : ssh!.exec(folder.connectionId, `mkdir -p ${shellQuote(folder.dir)}`))
  } catch {
    return images.map(kept)
  }
  const saved = await mapWithConcurrency(
    images.slice(0, MAX_TASK_START_IMAGES),
    DOWNLOAD_CONCURRENCY,
    (image, index) => saveImage(image, index, folder, fetchBytes, ssh)
  )
  return [...saved, ...images.slice(MAX_TASK_START_IMAGES).map(kept)]
}

/** Removes a run's image folder; never anything outside the task-start root. */
export async function removeTaskStartImages(
  target: TaskStartImageTarget,
  runId: string,
  ssh?: Pick<TaskStartSshAccess, 'exec'>
): Promise<void> {
  const folder = await runDir(target, runId, ssh)
  if (folder.kind === 'local') {
    await rm(folder.dir, { recursive: true, force: true })
    return
  }
  await ssh!.exec(folder.connectionId, `rm -rf ${shellQuote(folder.dir)}`)
}
