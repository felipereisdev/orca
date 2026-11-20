import { describe, expect, it } from 'vitest'
import { loopbackLiteral } from './desktop-loopback-host'

describe('loopbackLiteral', () => {
  it('maps localhost to 127.0.0.1 and keeps only literal 127.x.x.x and ::1', () => {
    const accepted = ['127.0.0.1', '127.255.3.4', '::1', 'localhost', 'LOCALHOST']
    const refused = [
      '128.0.0.1',
      '10.0.0.1',
      '0.0.0.0',
      '::',
      '::2',
      '::ffff:127.0.0.1',
      '0:0:0:0:0:0:ffff:7f00:1',
      'localhost.localdomain',
      'localtest.me',
      '127.0.0.1.nip.io',
      ''
    ]

    expect(accepted.map(loopbackLiteral)).toEqual([
      '127.0.0.1',
      '127.255.3.4',
      '::1',
      '127.0.0.1',
      '127.0.0.1'
    ])
    expect(refused.filter((host) => loopbackLiteral(host) !== undefined)).toEqual([])
  })
})
