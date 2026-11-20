// Runs the real CLI entry in a child process against a fake runtime socket, so signals, pipes and
// process exit are the real ones.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getRuntimeMetadataPath } from '../../shared/remote-runtime/bootstrap/runtime-bootstrap'

const TSX = join(process.cwd(), 'node_modules', '.bin', 'tsx')
const CLI_ENTRY = join(process.cwd(), 'src', 'cli', 'index.ts')
const RUNTIME_ID = 'runtime-fake'
const TOKEN = 'fake-auth-token'

type Request = { id: string; method: string; params: unknown }

const cleanups: (() => void)[] = []

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.()
  }
})

/** A runtime socket; `answer` replies through `respond`, now or later, or never. */
async function fakeRuntime(answer: (request: Request, respond: (result: unknown) => void) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-desktop-run-'))
  const endpoint = join(dir, 'rt.sock')
  const methods: string[] = []
  const waiters: { method: string; resolve: () => void }[] = []
  const sockets = new Set<Socket>()
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => sockets.delete(socket))
    let pending = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      pending += chunk
      let newline = pending.indexOf('\n')
      while (newline >= 0) {
        const request: Request = JSON.parse(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
        newline = pending.indexOf('\n')
        methods.push(request.method)
        for (const waiter of waiters.filter((entry) => entry.method === request.method)) {
          waiters.splice(waiters.indexOf(waiter), 1)
          waiter.resolve()
        }
        answer(request, (result) => {
          socket.write(
            `${JSON.stringify({ id: request.id, ok: true, result, _meta: { runtimeId: RUNTIME_ID } })}\n`
          )
        })
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(endpoint, resolve))
  writeFileSync(
    getRuntimeMetadataPath(dir),
    JSON.stringify({
      runtimeId: RUNTIME_ID,
      pid: process.pid,
      transports: [{ kind: 'unix', endpoint }],
      authToken: TOKEN,
      startedAt: 0
    })
  )
  cleanups.push(() => {
    for (const socket of sockets) {
      socket.destroy()
    }
    server.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return {
    userDataPath: dir,
    methods,
    /** Resolves once a request for `method` arrived. */
    waitFor: (method: string) =>
      methods.includes(method)
        ? Promise.resolve()
        : new Promise<void>((resolve) => waiters.push({ method, resolve }))
  }
}

function spawnCli(userDataPath: string, args: string[]) {
  // Only the fake runtime's profile: no ambient selection, pairing or source fence.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('ORCA_'))
  )
  const child = spawn(TSX, [CLI_ENTRY, ...args], {
    env: { ...env, ORCA_USER_DATA_PATH: userDataPath },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  // Unconditional: a test that failed or timed out must not leave the CLI running.
  cleanups.push(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
    }
  })
  return child
}

const posixOnly = process.platform === 'win32' ? describe.skip : describe

posixOnly('orca desktop run in a real process', () => {
  it(
    'exits 130 on SIGINT with stdout blocked, after sending the kill, and survives the reader closing',
    async () => {
      // 4 MiB of output: far past what a pipe buffers, so the CLI's writes block.
      const chunk = 'x'.repeat(64 * 1024)
      let reads = 0
      // The order this test drives: the CLI asks to kill, the reader goes away, the kill is answered.
      const steps: string[] = []
      let answerKill = (): void => {}
      const runtime = await fakeRuntime((request, respond) => {
        if (request.method === 'desktop.run.start') {
          respond({ runId: 'run-1' })
        } else if (request.method === 'desktop.run.read') {
          reads++
          if (reads === 1) {
            respond({
              events: Array.from({ length: 64 }, () => ({ stream: 'stdout', data: chunk })),
              cursor: 64
            })
          }
        } else if (request.method === 'desktop.run.kill') {
          // Answered once the test has closed the reader, so the pending write meets a closed pipe.
          steps.push('kill requested')
          answerKill = () => {
            steps.push('kill answered')
            respond({ killed: true })
          }
        }
      })
      const child = spawnCli(runtime.userDataPath, ['desktop', 'run', '--', 'flood'])
      const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
        child.once('exit', (code, signal) => {
          steps.push('exited')
          resolve({ code, signal })
        })
      )
      let stderr = ''
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (data: string) => {
        stderr += data
      })
      await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()))
      child.stdout.pause()

      child.kill('SIGINT')
      await runtime.waitFor('desktop.run.kill')
      child.stdout.destroy()
      steps.push('reader closed')
      answerKill()
      const { code, signal } = await exited

      expect(steps).toEqual(['kill requested', 'reader closed', 'kill answered', 'exited'])
      expect({ code, signal }).toEqual({ code: 130, signal: null })
      expect(stderr).not.toContain('EPIPE')
    },
    // Starting the CLI under tsx in a child process takes a few seconds on a loaded machine.
    30_000
  )
})
