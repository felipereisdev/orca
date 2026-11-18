import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { errnoCodeOrUnknown } from '../../shared/errors/errno-code'
import { DesktopError } from './desktop-errors'

const SCREENSHOT_DIR = 'orca-desktop'
const MAX_NAME_ATTEMPTS = 100

function failure(error: unknown): DesktopError {
  if (error instanceof DesktopError) {
    return error
  }
  return new DesktopError('desktop_screenshot_failed', errnoCodeOrUnknown(error))
}

/** The temp dir is shared with other users: ours must be a real directory we own, 0700. */
async function privateScreenshotDir(tmpDir: string): Promise<string> {
  const dir = join(tmpDir, SCREENSHOT_DIR)
  await mkdir(dir, { mode: 0o700 }).catch((error: unknown) => {
    if (errnoCodeOrUnknown(error) !== 'EEXIST') {
      throw error
    }
  })
  const info = await lstat(dir)
  const ownedByUs = process.getuid === undefined || info.uid === process.getuid()
  if (!info.isDirectory() || !ownedByUs) {
    throw new DesktopError('desktop_screenshot_failed', 'screenshot_dir_unsafe')
  }
  if (process.platform !== 'win32' && (info.mode & 0o777) !== 0o700) {
    await chmod(dir, 0o700)
  }
  return dir
}

/**
 * A chosen destination is replaced, never opened: an existing entry must be a regular file (not a
 * symlink, FIFO or device), and the image goes to a fresh 0600 file renamed over it.
 */
async function writeChosenDestination(png: Buffer, out: string): Promise<string> {
  const path = resolve(out)
  const existing = await lstat(path).catch((error: unknown) => {
    if (errnoCodeOrUnknown(error) === 'ENOENT') {
      return undefined
    }
    throw error
  })
  if (existing && !existing.isFile()) {
    throw new DesktopError('desktop_invalid_input', '--out must be a regular file or a new path')
  }
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, png, { mode: 0o600, flag: 'wx' })
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
  return path
}

/** Writes `png` to `out`, or to a new file in `<tmpDir>/orca-desktop`; returns its path. */
export async function writeDesktopScreenshot(
  png: Buffer,
  { out, tmpDir }: { out?: string; tmpDir: string }
): Promise<string> {
  try {
    if (out !== undefined) {
      return await writeChosenDestination(png, out)
    }
    const dir = await privateScreenshotDir(tmpDir)
    const stamp = Date.now()
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt++) {
      const path = join(dir, `screenshot-${stamp}${attempt > 0 ? `-${attempt}` : ''}.png`)
      try {
        // `wx` never follows or overwrites an existing entry.
        await writeFile(path, png, { mode: 0o600, flag: 'wx' })
        return path
      } catch (error) {
        if (errnoCodeOrUnknown(error) !== 'EEXIST') {
          throw error
        }
      }
    }
    throw new DesktopError('desktop_screenshot_failed', 'screenshot_name_taken')
  } catch (error) {
    throw failure(error)
  }
}
