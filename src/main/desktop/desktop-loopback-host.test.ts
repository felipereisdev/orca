import { describe, expect, it } from 'vitest'
import { isLoopbackHost } from './desktop-loopback-host'

describe('isLoopbackHost', () => {
  it('accepts 127.0.0.0/8, ::1 and localhost only', () => {
    const accepted = [
      '127.0.0.1',
      '127.255.3.4',
      '::1',
      '0:0:0:0:0:0:0:1',
      'localhost',
      'LOCALHOST'
    ]
    const refused = [
      '128.0.0.1',
      '10.0.0.1',
      '0.0.0.0',
      '::',
      '::2',
      'localhost.evil.com',
      '127.0.0.1.nip.io',
      ''
    ]

    expect(accepted.filter((host) => !isLoopbackHost(host))).toEqual([])
    expect(refused.filter((host) => isLoopbackHost(host))).toEqual([])
  })
})
