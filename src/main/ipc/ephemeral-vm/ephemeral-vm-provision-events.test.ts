import { describe, expect, it } from 'vitest'
import { createProvisionEventForwarder } from './ephemeral-vm-provision-events'

const PASSWORD = 'abc12345'
const WITHHELD = '[stderr line withheld: may contain a secret]'

function stderrText(events: { stream: string; chunk: string }[]): string {
  return events
    .filter((event) => event.stream === 'stderr')
    .map((event) => event.chunk)
    .join('')
}

function forwarder() {
  const events: { stream: string; chunk: string }[] = []
  const provisionEvents = createProvisionEventForwarder('provision-1', ({ stream, chunk }) =>
    events.push({ stream, chunk })
  )
  return { events, provisionEvents }
}

describe('createProvisionEventForwarder', () => {
  it('streams stderr live and withholds stdout until the step finishes', () => {
    const { events, provisionEvents } = forwarder()

    provisionEvents.send('stderr', 'booting\n')
    provisionEvents.send('stdout', '{"schemaVersion":1,\n')
    expect(events).toEqual([{ stream: 'stderr', chunk: 'booting\n' }])
  })

  it('shows a pretty-printed result split across chunks only through structured redaction', () => {
    const { events, provisionEvents } = forwarder()
    const result = [
      '{',
      '  "schemaVersion": 1,',
      '  "connection": { "type": "ssh", "projectRoot": "/workspace/repo",',
      '    "target": { "label": "Box", "host": "box.example.com", "port": 22, "username": "dev" } },',
      '  "desktop": { "type": "vnc", "port": 5901, "password"',
      `    : "${PASSWORD}" }`,
      '}'
    ].join('\n')
    for (const chunk of result.match(/[\s\S]{1,7}/g) ?? []) {
      provisionEvents.send('stdout', chunk)
    }
    expect(events).toEqual([])
    provisionEvents.finish(result)
    provisionEvents.finish(result)

    expect(events).toHaveLength(1)
    expect(events[0]?.stream).toBe('stdout')
    expect(JSON.parse(events[0]?.chunk ?? '')).toMatchObject({
      desktop: { type: 'vnc', port: 5901, host: '127.0.0.1', password: '[redacted]' }
    })
    expect(events[0]?.chunk).not.toContain(PASSWORD)
  })

  it('replaces stdout that is not a recipe result with its byte count', () => {
    const { events, provisionEvents } = forwarder()
    const stdout = `${'x'.repeat(300 * 1024)}{"password":"${PASSWORD}"}`
    provisionEvents.send('stdout', stdout.slice(0, 256 * 1024 + 3))
    provisionEvents.send('stdout', stdout.slice(256 * 1024 + 3))
    provisionEvents.finish(stdout)

    expect(events).toEqual([
      { stream: 'stdout', chunk: '[recipe stdout withheld: not a recipe result, 307223 bytes]\n' }
    ])
  })

  it('withholds a stderr line whose password spans two chunks', () => {
    const { events, provisionEvents } = forwarder()
    provisionEvents.send('stderr', 'debug {"password":"abc')
    provisionEvents.send('stderr', '12345"}\nnext')
    provisionEvents.finish('')

    expect(events).toEqual([
      { stream: 'stderr', chunk: `${WITHHELD}\n` },
      { stream: 'stderr', chunk: 'next' }
    ])
  })

  it('streams an ordinary progress line live', () => {
    const { events, provisionEvents } = forwarder()
    provisionEvents.send('stderr', 'pulling image 42%\nstill ')
    expect(events).toEqual([{ stream: 'stderr', chunk: 'pulling image 42%\n' }])
  })

  it('never forwards a pending password line when completed lines push the buffer over the cap', () => {
    const { events, provisionEvents } = forwarder()
    provisionEvents.send('stderr', `${'progress line\n'.repeat(20 * 1024)}debug {"password":"abc`)
    provisionEvents.send('stderr', '12345"}\n')
    provisionEvents.finish('')

    const stderr = stderrText(events)
    expect(stderr).not.toContain('abc')
    expect(stderr).not.toContain('12345')
    expect(stderr).toBe(`${'progress line\n'.repeat(20 * 1024)}${WITHHELD}\n`)
  })

  it('withholds a pretty-printed password key and its value line split across chunks', () => {
    const { events, provisionEvents } = forwarder()
    provisionEvents.send('stderr', '{\n  "desktop": {\n    "password":\n      "abc1')
    provisionEvents.send('stderr', '2345"\n  }\n}\n')
    provisionEvents.finish('')

    expect(stderrText(events)).toBe(`{\n  "desktop": {\n${WITHHELD}\n${WITHHELD}\n  }\n}\n`)
  })

  it('withholds an incomplete line over the cap with its byte count, discards it to the next newline and withholds the line after it', () => {
    const { events, provisionEvents } = forwarder()
    const long = `${'x'.repeat(256 * 1024)}{"secret-ish":"${PASSWORD}`
    provisionEvents.send('stderr', long)
    provisionEvents.send('stderr', `${PASSWORD}"}\nnext line\nafter\n`)
    provisionEvents.finish('')

    expect(events).toEqual([
      {
        stream: 'stderr',
        chunk: `[stderr line withheld: ${Buffer.byteLength(long)} bytes without a line break]\n`
      },
      { stream: 'stderr', chunk: `${WITHHELD}\n` },
      { stream: 'stderr', chunk: 'after\n' }
    ])
  })

  it('applies the rules to the final partial line', () => {
    const { events, provisionEvents } = forwarder()
    provisionEvents.send('stderr', 'api_key =\n')
    provisionEvents.send('stderr', `  ${PASSWORD}`)
    provisionEvents.finish('')

    expect(events).toEqual([
      { stream: 'stderr', chunk: `${WITHHELD}\n` },
      { stream: 'stderr', chunk: WITHHELD }
    ])
  })

  it('withholds the value line after a password key followed by a whitespace run past the cap', () => {
    const { events, provisionEvents } = forwarder()
    provisionEvents.send('stderr', 'config password:')
    provisionEvents.send('stderr', ' '.repeat(300 * 1024))
    provisionEvents.send('stderr', '\n')
    provisionEvents.send('stderr', `  ${PASSWORD}\nnext\n`)
    provisionEvents.finish('')

    const stderr = stderrText(events)
    expect(stderr).not.toContain(PASSWORD)
    expect(stderr).toBe(
      `[stderr line withheld: ${16 + 300 * 1024} bytes without a line break]\n${WITHHELD}\nnext\n`
    )
  })

  it('counts the cap in UTF-8 bytes', () => {
    const { events, provisionEvents } = forwarder()
    // 100 Ki characters of a 3-byte character: under 256 Ki UTF-16 units, over 256 KiB in UTF-8.
    const line = '\u20ac'.repeat(100 * 1024)
    provisionEvents.send('stderr', line)
    provisionEvents.finish('')

    expect(events).toEqual([
      {
        stream: 'stderr',
        chunk: `[stderr line withheld: ${300 * 1024} bytes without a line break]\n`
      }
    ])
  })

  it('classifies keys padded with long whitespace runs', () => {
    const { events, provisionEvents } = forwarder()
    const spaces = ' '.repeat(64 * 1024)
    provisionEvents.send('stderr', `password:${spaces}x\n`)
    provisionEvents.send('stderr', `progress${spaces}x\n`)
    provisionEvents.send('stderr', `"token"${spaces}\n`)
    provisionEvents.send('stderr', `${PASSWORD}\n`)

    expect(events.map((event) => event.chunk.length)).toEqual([
      WITHHELD.length + 1,
      `progress${spaces}x\n`.length,
      WITHHELD.length + 1,
      WITHHELD.length + 1
    ])
  })

  it('does not swallow the line after an over-cap line that ends with a bare carriage return', () => {
    const { events, provisionEvents } = forwarder()
    const long = 'x'.repeat(256 * 1024 + 1)
    provisionEvents.send('stderr', `${long}\r`)
    provisionEvents.send('stderr', 'progress 50%\r')
    provisionEvents.finish('')

    expect(events).toEqual([
      { stream: 'stderr', chunk: `${long}\r` },
      { stream: 'stderr', chunk: 'progress 50%\r' }
    ])
  })
})
