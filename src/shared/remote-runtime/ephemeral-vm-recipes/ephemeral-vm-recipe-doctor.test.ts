import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTempDirs } from '../../testing/remove-temp-dirs.test-support'
import { doctorEphemeralVmRecipe } from './ephemeral-vm-recipe-doctor'

const roots: string[] = []

afterEach(async () => {
  await removeTempDirs(roots.splice(0))
})

function doctorStats(stats: string, scripts: string[]) {
  const repoPath = mkdtempSync(join(tmpdir(), 'orca-vm-doctor-'))
  roots.push(repoPath)
  for (const script of ['create.sh', 'destroy.sh', ...scripts]) {
    writeFileSync(join(repoPath, script), '#!/bin/sh\n')
    chmodSync(join(repoPath, script), 0o755)
  }
  const result = doctorEphemeralVmRecipe({
    repoPath,
    recipeId: 'docker',
    localExecutionSupported: true,
    recipes: [
      { id: 'docker', name: 'Docker', create: './create.sh', destroy: './destroy.sh', stats }
    ]
  })
  return { ok: result.ok, stats: result.checks.find((check) => check.id === 'recipe.stats') }
}

describe('doctorEphemeralVmRecipe', () => {
  it('doctor validates the stats path like the other steps', () => {
    expect(doctorStats('./stats.sh', ['stats.sh'])).toEqual({
      ok: true,
      stats: { id: 'recipe.stats', status: 'pass', message: 'Command path exists: ./stats.sh' }
    })
    expect(doctorStats('./missing-stats.sh', [])).toMatchObject({
      ok: false,
      stats: { id: 'recipe.stats', status: 'fail' }
    })
  })
})
