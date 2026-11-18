import { randomBytes } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readdirSync } from 'node:fs'
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

export function newRecordingFile(dir: string): { id: string; path: string } {
  const id = randomBytes(8).toString('hex')
  return { id, path: join(dir, `rec-${id}.mp4`) }
}

/** Recordings show the user's screen: the directory must be a real one we own, 0700. */
export function preparePrivateRecordingsDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const info = lstatSync(dir)
  const ownedByUs = process.getuid === undefined || info.uid === process.getuid()
  if (!info.isDirectory() || !ownedByUs) {
    throw new DesktopError('desktop_recording_unavailable', 'recordings_dir_unsafe')
  }
  if (process.platform !== 'win32' && (info.mode & 0o777) !== 0o700) {
    chmodSync(dir, 0o700)
  }
}

/** Bytes of a regular file, 0 when it does not exist (yet). */
export function recordingBytes(path: string): number {
  try {
    const info = lstatSync(path)
    return info.isFile() ? info.size : 0
  } catch {
    return 0
  }
}

export function listRecordings(dir: string): DesktopRecordingEntry[] {
  let names: string[]
  try {
    names = readdirSync(dir)
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
    try {
      const info = lstatSync(path)
      if (info.isFile()) {
        const created = info.birthtimeMs > 0 ? info.birthtime : info.mtime
        recordings.push({ id, path, bytes: info.size, createdAt: created.toISOString() })
      }
    } catch {
      // Removed while listing.
    }
  }
  return recordings.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}
