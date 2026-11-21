import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeOrcadTemplateTestFixture } from './orcad-template-test-fixture.mjs'
import { verifyPackagedOrcadTemplate } from './verify-packaged-orcad-template.cjs'

const LOCAL = { ORCA_LOCAL_ORCAD_TARGETS: 'linux-x64-glibc' }
const dirs = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function resources(options) {
  const dir = await mkdtemp(join(tmpdir(), 'verify-orcad-template-'))
  dirs.push(dir)
  await writeOrcadTemplateTestFixture(dir, options)
  return dir
}

describe('verifyPackagedOrcadTemplate during packaging', () => {
  it('accepts the partial template a local build declares', async () => {
    const dir = await resources({ targets: ['linux-x64-glibc'] })
    expect(() => verifyPackagedOrcadTemplate(dir, undefined, { env: LOCAL })).not.toThrow()
  })

  it('demands every target from a release build that inherited a local declaration', async () => {
    const dir = await resources({ targets: ['linux-x64-glibc'] })
    for (const release of [{ ORCA_MAC_RELEASE: '1' }, { ORCA_REQUIRE_ORCAD_TEMPLATE: '1' }]) {
      expect(() =>
        verifyPackagedOrcadTemplate(dir, undefined, { env: { ...LOCAL, ...release } })
      ).toThrow('target manifest inventory mismatch')
    }
  })

  it('refuses a compat target a local build did not declare', async () => {
    const dir = await resources({ targets: ['linux-x64-glibc'], compat: true })
    expect(() => verifyPackagedOrcadTemplate(dir, undefined, { env: LOCAL })).toThrow(
      'target manifest inventory mismatch'
    )
  })

  it('keeps optional compat targets for the release matrix', async () => {
    const dir = await resources({ compat: true })
    expect(() => verifyPackagedOrcadTemplate(dir, undefined, { env: {} })).not.toThrow()
  })
})
