import { describe, expect, it } from 'vitest'
import { encodePairingOffer } from '../pairing/pairing'
import { PAIRING_OFFER_VERSION } from '../pairing/mobile-relay-pairing-offer'
import {
  getEphemeralVmRecipeResultWarnings,
  redactEphemeralVmRecipeResultForDiagnostics
} from './ephemeral-vm-recipe-diagnostics'
import { redactEphemeralVmRecipeDiagnosticText } from './ephemeral-vm-recipe-diagnostic-redaction'
import {
  getEphemeralVmRecipeResultDesktop,
  parseEphemeralVmRecipeResult
} from './ephemeral-vm-recipes'

function makePairingCode(endpoint = 'wss://sandbox.example.com'): string {
  return encodePairingOffer({
    v: PAIRING_OFFER_VERSION,
    endpoint,
    deviceToken: 'token',
    publicKeyB64: 'public-key'
  })
}

describe('parseEphemeralVmRecipeResult', () => {
  it('warns for public insecure websocket endpoints', () => {
    expect(
      getEphemeralVmRecipeResultWarnings({
        schemaVersion: 1,
        pairingCode: makePairingCode('ws://sandbox.example.com:6767'),
        projectRoot: '/workspace/repo'
      })
    ).toEqual([
      expect.objectContaining({
        id: 'recipe.result.endpoint.public_ws',
        message: expect.stringContaining('ws://sandbox.example.com:6767')
      })
    ])
    expect(
      getEphemeralVmRecipeResultWarnings({
        schemaVersion: 1,
        pairingCode: makePairingCode('ws://127.0.0.1:6767'),
        projectRoot: '/workspace/repo'
      })
    ).toEqual([])
    expect(
      getEphemeralVmRecipeResultWarnings({
        schemaVersion: 1,
        pairingCode: makePairingCode('wss://sandbox.example.com'),
        projectRoot: '/workspace/repo'
      })
    ).toEqual([])
  })

  it('redacts pairing material and secret-looking fields in diagnostics', () => {
    const pairingCode = makePairingCode()

    expect(
      redactEphemeralVmRecipeDiagnosticText(
        JSON.stringify({
          pairingCode,
          token: 'provider-token',
          identityFile: '/secret/key',
          proxyCommand: 'provider token',
          ok: true
        })
      )
    ).toBe(
      '{"pairingCode":"[redacted]","token":"[redacted]","identityFile":"[redacted]","proxyCommand":"[redacted]","ok":true}'
    )
    expect(
      redactEphemeralVmRecipeDiagnosticText(
        'clone https://recipe-user:recipe-token@git.example.com/team/repo.git'
      )
    ).toBe('clone https://git.example.com/team/repo.git')
    expect(
      redactEphemeralVmRecipeResultForDiagnostics({
        schemaVersion: 1,
        pairingCode,
        projectRoot: '/workspace/repo',
        userData: {
          providerResourceId: 'sandbox-123',
          accessToken: 'provider-token',
          nested: { apiKey: 'key', region: 'us-east-1' }
        }
      })
    ).toEqual({
      schemaVersion: 1,
      pairingCode: 'orca://pair?code=[redacted]',
      projectRoot: '/workspace/repo',
      userData: {
        providerResourceId: 'sandbox-123',
        accessToken: '[redacted]',
        nested: { apiKey: '[redacted]', region: 'us-east-1' }
      }
    })
    expect(
      redactEphemeralVmRecipeResultForDiagnostics({
        schemaVersion: 1,
        connection: {
          type: 'ssh',
          projectRoot: '/workspace/repo',
          target: {
            label: 'Sandbox',
            host: 'sandbox.example.com',
            port: 22,
            username: 'root',
            identityFile: '/secret/key',
            identityAgent: '/secret/agent.sock',
            proxyCommand: 'provider ssh-proxy sandbox-123'
          }
        }
      })
    ).toEqual({
      schemaVersion: 1,
      connection: {
        type: 'ssh',
        projectRoot: '/workspace/repo',
        target: {
          label: 'Sandbox',
          host: 'sandbox.example.com',
          port: 22,
          username: 'root',
          identityFile: '[redacted-path]',
          identityAgent: '[redacted-path]',
          proxyCommand: '[redacted]'
        }
      }
    })
  })

  it('parses a v1 connection result with a VNC desktop', () => {
    const parsed = parseEphemeralVmRecipeResult(
      JSON.stringify({
        ...sshConnectionResult(),
        desktop: { type: 'vnc', port: 5901, password: 'abc12345' }
      })
    )

    expect(parsed.ok).toBe(true)
    expect(parsed.ok && getEphemeralVmRecipeResultDesktop(parsed.result)).toEqual({
      type: 'vnc',
      port: 5901,
      host: '127.0.0.1',
      password: 'abc12345'
    })
  })

  it('results without desktop still parse and the helper returns null', () => {
    const parsed = parseEphemeralVmRecipeResult(JSON.stringify(sshConnectionResult()))

    expect(parsed.ok).toBe(true)
    expect(parsed.ok && getEphemeralVmRecipeResultDesktop(parsed.result)).toBeNull()
  })

  it('rejects desktop with an unknown type or a password over 8 chars', () => {
    expect(
      parseEphemeralVmRecipeResult(
        JSON.stringify({
          ...sshConnectionResult(),
          desktop: { type: 'rdp', port: 5901, password: 'abc12345' }
        })
      ).ok
    ).toBe(false)
    expect(
      parseEphemeralVmRecipeResult(
        JSON.stringify({
          ...sshConnectionResult(),
          desktop: { type: 'vnc', port: 5901, password: 'abc123456' }
        })
      ).ok
    ).toBe(false)
  })

  it('redacts the desktop password in diagnostics', () => {
    const desktop = {
      type: 'vnc' as const,
      port: 5901,
      host: '127.0.0.1',
      password: 'abc12345',
      launcher: { port: 7001, token: 'launcher-token-0123456789abcdef0123456789' }
    }

    expect(
      redactEphemeralVmRecipeResultForDiagnostics({ ...sshConnectionResult(), desktop }).desktop
    ).toEqual({
      type: 'vnc',
      port: 5901,
      host: '127.0.0.1',
      password: '[redacted]',
      launcher: { port: 7001, token: '[redacted]' }
    })
    expect(redactEphemeralVmRecipeDiagnosticText(JSON.stringify({ desktop }))).toBe(
      '{"desktop":{"type":"vnc","port":5901,"host":"127.0.0.1","password":"[redacted]","launcher":{"port":7001,"token":"[redacted]"}}}'
    )
  })
})

function sshConnectionResult() {
  return {
    schemaVersion: 1 as const,
    connection: {
      type: 'ssh' as const,
      projectRoot: '/workspace/repo',
      target: { label: 'Sandbox', host: 'sandbox.example.com', port: 22, username: 'root' }
    }
  }
}
