import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeTempDirs } from '../../shared/testing/remove-temp-dirs.test-support'
import type { RuntimeClient } from '../runtime/client'
import { VM_HANDLERS } from './vm'

const PASSWORD = 'abc12345'

describe('vm recipe doctor --provision', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    process.exitCode = undefined
    await removeTempDirs(tempDirs.splice(0))
  })

  async function runDoctor(createScript: string): Promise<string> {
    const repoPath = mkdtempSync(join(tmpdir(), 'orca-vm-doctor-'))
    tempDirs.push(repoPath)
    writeFileSync(join(repoPath, 'create.js'), createScript)
    writeFileSync(
      join(repoPath, 'orca.yaml'),
      [
        'environmentRecipes:',
        '  - id: sandbox',
        '    name: Sandbox',
        `    create: ${JSON.stringify(`"${process.execPath}" "${join(repoPath, 'create.js')}"`)}`,
        '    destroy: none'
      ].join('\n')
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await VM_HANDLERS['vm recipe doctor']({
      flags: new Map<string, string | boolean>([
        ['recipe-id', 'sandbox'],
        ['provision', true]
      ]),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the local recipe doctor never calls the runtime client.
      client: {} as unknown as RuntimeClient,
      cwd: repoPath,
      json: false
    })
    return log.mock.calls.map((call) => String(call[0])).join('\n')
  }

  it('never shows a pretty-printed desktop password from stdout', async () => {
    const result = {
      schemaVersion: 1,
      connection: {
        type: 'ssh',
        projectRoot: '/workspace/repo',
        target: { label: 'Box', host: 'box.example.com', port: 22, username: 'dev' }
      },
      desktop: { type: 'vnc', port: 5901, password: PASSWORD }
    }
    const pretty = JSON.stringify(result, null, 2).replace('"password": ', '"password"\n  : ')
    const output = await runDoctor(
      `for (const part of ${JSON.stringify(pretty)}.match(/[\\s\\S]{1,5}/g)) process.stdout.write(part)`
    )

    expect(output).toContain('"password":"[redacted]"')
    expect(output).not.toContain(PASSWORD)
  })

  it('withholds stdout that is not a recipe result when provisioning fails', async () => {
    const output = await runDoctor(
      `process.stdout.write('{"desktop": {"password"\\n: "${PASSWORD}"} broken')`
    )

    expect(output).toContain('[recipe stdout withheld: not a recipe result, 44 bytes]')
    expect(output).not.toContain(PASSWORD)
  })
  it('withholds a stderr password line in the transcript and the remediation', async () => {
    const output = await runDoctor(
      [
        `process.stderr.write('vnc password:\\n  ${PASSWORD}\\nstarting\\n')`,
        `process.stderr.write('PASSWORD=${PASSWORD}\\n')`,
        'process.exit(3)'
      ].join(';')
    )

    expect(output).toContain('[stderr line withheld: may contain a secret]')
    expect(output).not.toContain(PASSWORD)
  })
})
