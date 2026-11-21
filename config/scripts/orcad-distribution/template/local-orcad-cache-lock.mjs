// Exclusive lock on the shared local orcad cache. The lock is a directory holding owner.json, so it
// appears whole or not at all, and stale recovery moves it aside with one atomic rename.
import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

const OWNER_FILE = 'owner.json'
const POLL_MS = 5_000
const WAIT_MS = 2 * 60 * 60 * 1000
const TOMBSTONE_RETENTION_MS = 24 * 60 * 60 * 1000

/** The lock's owner record, or null when no lock is held. */
export function readLocalOrcadCacheLockOwner(lockDir) {
  try {
    return JSON.parse(readFileSync(join(lockDir, OWNER_FILE), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function tryCreate(lockDir, owner) {
  const staging = `${lockDir}.new-${owner.token}`
  mkdirSync(staging, { recursive: true })
  // Why staged: a directory renamed into place already holds its owner, so no reader sees it half-made.
  writeFileSync(join(staging, OWNER_FILE), JSON.stringify(owner))
  try {
    renameSync(staging, lockDir)
    return true
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    if (['EEXIST', 'ENOTEMPTY', 'EISDIR'].includes(error?.code)) {
      return false
    }
    throw error
  }
}

/**
 * Moves aside the lock whose stale owner was `observed`. The tombstone is named after that owner's
 * token and kept, so a contender that saw the same stale owner cannot rename a fresh lock onto it.
 */
export function recoverStaleLocalOrcadCacheLock(lockDir, observed) {
  try {
    renameSync(lockDir, `${lockDir}.stale-${observed.token}`)
  } catch (error) {
    if (['ENOENT', 'EEXIST', 'ENOTEMPTY'].includes(error?.code)) {
      return false
    }
    throw error
  }
  const tombstone = `${lockDir}.stale-${observed.token}`
  if (readLocalOrcadCacheLockOwner(tombstone)?.token !== observed.token) {
    throw new Error(`moved a lock that was not the stale one: ${tombstone}`)
  }
  return true
}

function pruneTombstones(lockDir) {
  const prefix = `${basename(lockDir)}.stale-`
  for (const name of readdirSync(dirname(lockDir))) {
    const path = join(dirname(lockDir), name)
    if (name.startsWith(prefix) && Date.now() - statSync(path).mtimeMs > TOMBSTONE_RETENTION_MS) {
      rmSync(path, { recursive: true, force: true })
    }
  }
}

/** Waits for the lock (reclaiming one whose owner died) and returns its release. */
export async function acquireLocalOrcadCacheLock(
  lockDir,
  { waitMs = WAIT_MS, pollMs = POLL_MS, log = () => {} } = {}
) {
  mkdirSync(dirname(lockDir), { recursive: true })
  pruneTombstones(lockDir)
  const owner = { pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() }
  const deadline = Date.now() + waitMs
  let announced = false
  for (;;) {
    if (tryCreate(lockDir, owner)) {
      return () => {
        if (readLocalOrcadCacheLockOwner(lockDir)?.token === owner.token) {
          rmSync(lockDir, { recursive: true, force: true })
        }
      }
    }
    const holder = readLocalOrcadCacheLockOwner(lockDir)
    if (holder && !isAlive(holder.pid)) {
      recoverStaleLocalOrcadCacheLock(lockDir, holder)
      continue
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `another local orcad template build holds ${lockDir} (${JSON.stringify(holder)})`
      )
    }
    if (!announced) {
      log(`waiting for another local orcad template build (${lockDir})`)
      announced = true
    }
    await delay(pollMs)
  }
}
