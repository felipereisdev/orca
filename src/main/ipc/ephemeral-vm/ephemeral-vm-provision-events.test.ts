import { describe, expect, it } from 'vitest'
import { createProvisionEventForwarder } from './ephemeral-vm-provision-events'

const PASSWORD = 'abc12345'

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
    provisionEvents.finishStdout(result)
    provisionEvents.finishStdout(result)

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
    provisionEvents.finishStdout(stdout)

    expect(events).toEqual([
      { stream: 'stdout', chunk: '[recipe stdout withheld: not a recipe result, 307223 bytes]\n' }
    ])
  })
})
