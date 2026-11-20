import { describe, expect, it } from 'vitest'
import {
  buildEphemeralVmRecipeCleanupCommand,
  buildEphemeralVmRecipeManualCleanupPayload
} from './ephemeral-vm-recipe-lifecycle-payload'

describe('manual cleanup payload', () => {
  it('never carries the desktop credentials into the copied command or payload', () => {
    const payload = buildEphemeralVmRecipeManualCleanupPayload({
      recipe: { id: 'docker-desktop' },
      context: { recipeId: 'docker-desktop', instanceId: 'runtime-1', repoPath: '/repo' },
      recipeResult: {
        schemaVersion: 1,
        pairingCode: 'orca://pair#abc',
        projectRoot: '/workspace',
        userData: { container: 'orca-ws-1' },
        desktop: {
          type: 'vnc',
          host: '127.0.0.1',
          port: 5901,
          password: 'vncpw123',
          launcher: { port: 5902, token: 'launcher-token-0123456789abcdef0123456789' }
        }
      }
    })
    const command = buildEphemeralVmRecipeCleanupCommand({
      destroyCommand: './destroy.sh',
      payload
    })
    const encoded = /Buffer\.from\("([^"]+)"/.exec(command)?.[1] ?? ''
    const copied = [
      JSON.stringify(payload),
      command,
      Buffer.from(encoded, 'base64').toString('utf8')
    ].join('\n')

    expect(copied).not.toContain('vncpw123')
    expect(copied).not.toContain('launcher-token-0123456789abcdef0123456789')
    expect(payload.recipeResult).toEqual({
      schemaVersion: 1,
      pairingCode: 'orca://pair#abc',
      projectRoot: '/workspace',
      userData: { container: 'orca-ws-1' }
    })
  })
})
