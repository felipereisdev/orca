import { describe, expect, it } from 'vitest'
import { desEncryptBlock } from './des-block-cipher'
import { vncAuthResponse } from './vnc-auth'

const SEQUENTIAL_CHALLENGE = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')

describe('vncAuthResponse', () => {
  it('matches a known vector', () => {
    // Reference: LibreSSL `openssl enc -des-ecb -nopad` keyed with each byte of "password" bit-reversed (RFC 6143 7.2.2).
    expect(vncAuthResponse('password', SEQUENTIAL_CHALLENGE).toString('hex')).toBe(
      'b866924125c8eebb9debc1db61c538e2'
    )
  })

  it('matches a response captured from a real VNC client', () => {
    // Published capture: https://catonmat.net/curious-case-of-des-algorithm
    const challenge = Buffer.from('0cfd6b8c5c04b3e50140b9de339e0ddb', 'hex')
    expect(vncAuthResponse('browsers', challenge).toString('hex')).toBe(
      '44eefc4883bb95f1c082c3e298c36a4a'
    )
  })

  it('zero-pads short passwords and truncates long ones to 8 bytes', () => {
    expect(vncAuthResponse('pw', SEQUENTIAL_CHALLENGE).toString('hex')).toBe(
      '858600d9af143c9e6541d3dd92a835d0'
    )
    expect(vncAuthResponse('passwordEXTRA', SEQUENTIAL_CHALLENGE).toString('hex')).toBe(
      'b866924125c8eebb9debc1db61c538e2'
    )
  })
})

describe('desEncryptBlock', () => {
  it('matches the classic DES worked example', () => {
    const key = Buffer.from('133457799bbcdff1', 'hex')
    const block = Buffer.from('0123456789abcdef', 'hex')
    expect(desEncryptBlock(key, block).toString('hex')).toBe('85e813540f0ab405')
  })
})
