import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopEnvironmentFake as env } from './desktop-environment-fake.test-support'

vi.mock('electron', () => ({ app: { getPath: () => '/user-data' } }))
vi.mock('../ipc/runtime-environments/requests/runtime-environment-transport-routing', async () =>
  (await import('./desktop-environment-fake.test-support')).fakeTransportRoutingModule()
)

import { configureEnvironmentDesktop } from './desktop-configure'

const PASSWORD = 'abc12345'
// The token contains the password, so redacting one first would leave part of the other.
const TOKEN = `tok${PASSWORD}-launcher-0123456789abcdef0123`
const DESKTOP = {
  type: 'vnc' as const,
  host: '127.0.0.1',
  port: 5901,
  password: PASSWORD,
  launcher: { port: 7070, token: TOKEN }
}

describe('configureEnvironmentDesktop', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
    env.reset()
  })

  it('skips when the recipe has no desktop', async () => {
    expect(await configureEnvironmentDesktop('env-1', null)).toBe('skipped')
    expect(env.calls).toEqual([])
  })

  it('a failing configure logs only a fixed message and an allowlisted code', async () => {
    env.configure = () => ({
      id: 'r',
      ok: false,
      error: { code: 'desktop_unavailable', message: `bad ${TOKEN} ${PASSWORD}` }
    })
    expect(await configureEnvironmentDesktop('env-1', DESKTOP)).toBe('failed')
    env.configure = () => ({
      id: 'r',
      ok: false,
      error: { code: `leak-${PASSWORD}`, message: TOKEN }
    })
    expect(await configureEnvironmentDesktop('env-1', DESKTOP)).toBe('failed')
    env.configure = () => {
      throw Object.assign(new Error(`refused {"password":"${PASSWORD}"} ${TOKEN}`), {
        code: TOKEN
      })
    }
    expect(await configureEnvironmentDesktop('env-1', DESKTOP)).toBe('failed')

    expect(warn.mock.calls).toEqual([
      [
        '[ephemeral-vm] desktop configure failed',
        { environmentId: 'env-1', code: 'desktop_unavailable' }
      ],
      ['[ephemeral-vm] desktop configure failed', { environmentId: 'env-1', code: 'unknown' }],
      ['[ephemeral-vm] desktop configure failed', { environmentId: 'env-1', code: 'unknown' }]
    ])
  })
})
