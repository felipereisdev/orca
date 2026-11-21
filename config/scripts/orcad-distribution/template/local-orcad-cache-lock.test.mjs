import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireLocalOrcadCacheLock,
  readLocalOrcadCacheLockOwner,
  recoverStaleLocalOrcadCacheLock
} from './local-orcad-cache-lock.mjs'

const DEAD_PID = 2 ** 22 + 1
const dirs = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function staleLock() {
  const root = mkdtempSync(join(tmpdir(), 'local-orcad-lock-'))
  dirs.push(root)
  const lockDir = join(root, 'build.lock')
  mkdirSync(lockDir)
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: DEAD_PID, token: 'dead' }))
  return lockDir
}

describe('acquireLocalOrcadCacheLock', () => {
  it('refuses a lock a live build holds, and releases its own', async () => {
    const lockDir = staleLock()
    rmSync(lockDir, { recursive: true })
    const release = await acquireLocalOrcadCacheLock(lockDir, { waitMs: 0 })
    await expect(acquireLocalOrcadCacheLock(lockDir, { waitMs: 0 })).rejects.toThrow(
      String(process.pid)
    )
    release()
    expect(existsSync(lockDir)).toBe(false)
  })

  it('gives a stale lock to only one of two contenders', async () => {
    const lockDir = staleLock()
    const results = await Promise.allSettled([
      acquireLocalOrcadCacheLock(lockDir, { waitMs: 0 }),
      acquireLocalOrcadCacheLock(lockDir, { waitMs: 0 })
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  })

  it('cannot move aside a fresh lock for a contender that saw the stale owner', async () => {
    const lockDir = staleLock()
    const observed = readLocalOrcadCacheLockOwner(lockDir)
    await acquireLocalOrcadCacheLock(lockDir, { waitMs: 0 })
    const winner = readLocalOrcadCacheLockOwner(lockDir)
    expect(recoverStaleLocalOrcadCacheLock(lockDir, observed)).toBe(false)
    expect(readLocalOrcadCacheLockOwner(lockDir)).toEqual(winner)
  })
})
