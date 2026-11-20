import { randomBytes } from 'node:crypto'
import type { Stats } from 'node:fs'
import { chmod, lstat, mkdir, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { errnoCodeOrUnknown } from '../../shared/errors/errno-code'
import { DesktopError } from './desktop-errors'

export type DesktopRecordingEntry = { id: string; path: string; bytes: number; createdAt: string }

/** Tasks that copy recordings to the host parse this name. */
const RECORDING_FILE = /^rec-([0-9a-f]{16})\.mp4$/

export function defaultRecordingsDir(): string {
  return join(homedir(), '.orca', 'desktop-recordings')
}

/** `partialPath` holds the encoder's output until it closed cleanly; listing never matches it. */
export function newRecordingFile(dir: string): { id: string; path: string; partialPath: string } {
  const id = randomBytes(8).toString('hex')
  return { id, path: join(dir, `rec-${id}.mp4`), partialPath: join(dir, `.rec-${id}.partial.mp4`) }
}

/** Recordings show the user's screen: the directory must be a real one we own, 0700. */
export async function preparePrivateRecordingsDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const info = await lstat(dir)
  const ownedByUs = process.getuid === undefined || info.uid === process.getuid()
  if (!info.isDirectory() || !ownedByUs) {
    throw new DesktopError('desktop_recording_unavailable', 'recordings_dir_unsafe')
  }
  if (process.platform !== 'win32' && (info.mode & 0o777) !== 0o700) {
    await chmod(dir, 0o700)
  }
}

/** Bytes of a regular file, 0 when it does not exist (yet). */
export async function recordingBytes(path: string): Promise<number> {
  try {
    const info = await lstat(path)
    return info.isFile() ? info.size : 0
  } catch {
    return 0
  }
}

export async function listRecordings(dir: string): Promise<DesktopRecordingEntry[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    if (errnoCodeOrUnknown(error) === 'ENOENT') {
      return []
    }
    throw error
  }
  const recordings: DesktopRecordingEntry[] = []
  for (const name of names.sort()) {
    const id = RECORDING_FILE.exec(name)?.[1]
    if (!id) {
      continue
    }
    const path = join(dir, name)
    let info: Stats
    try {
      info = await lstat(path)
    } catch (error) {
      if (errnoCodeOrUnknown(error) === 'ENOENT') {
        continue
      }
      throw error
    }
    if (info.isFile()) {
      const created = info.birthtimeMs > 0 ? info.birthtime : info.mtime
      recordings.push({ id, path, bytes: info.size, createdAt: created.toISOString() })
    }
  }
  return recordings.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}
