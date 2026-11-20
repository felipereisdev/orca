import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTempDirs } from '../../shared/testing/remove-temp-dirs.test-support'
import { isRecordingCopiedOnMac, noteCopiedRecording } from './desktop-recording-copies'

const dirs: string[] = []
afterEach(() => removeTempDirs(dirs.splice(0)))

describe('copied recording index', () => {
  it('a copy deleted or moved since it was indexed is not copied', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-rec-copies-'))
    dirs.push(dir)
    const path = join(dir, 'rec-1111111111111111.mp4')
    writeFileSync(path, 'mp4')
    noteCopiedRecording('1111111111111111', path)
    await expect(isRecordingCopiedOnMac('1111111111111111')).resolves.toBe(true)

    renameSync(path, join(dir, 'moved.mp4'))
    await expect(isRecordingCopiedOnMac('1111111111111111')).resolves.toBe(false)

    const deleted = join(dir, 'rec-2222222222222222.mp4')
    writeFileSync(deleted, 'mp4')
    noteCopiedRecording('2222222222222222', deleted)
    rmSync(deleted)
    await expect(isRecordingCopiedOnMac('2222222222222222')).resolves.toBe(false)
    await expect(isRecordingCopiedOnMac('3333333333333333')).resolves.toBe(false)
  })
})
