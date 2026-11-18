import { createServer, type Socket } from 'node:net'

/** What a run request carried, minus the token (only whether it matched). */
export type FakeLauncherRun = {
  id: string
  argv: string[]
  cwd?: string
  env?: Record<string, string>
}

export type FakeDesktopLauncher = {
  port: number
  runs: FakeLauncherRun[]
  /** Ids killed by a valid `kill` request. */
  killed: string[]
  /** Requests refused for a wrong or missing token. */
  rejected: number
  /** TCP connections accepted so far. */
  connections: number
  /** Resolves once the connection of run `id` closed (a real launcher kills it then too). */
  waitForClosed(id: string): Promise<void>
  /** Sends `message` (an output line or `{exit}`) on a `hang` run that is still running. */
  emit(id: string, message: { stream: 'stdout' | 'stderr'; data: string } | { exit: number }): void
  close(): Promise<void>
}

type LauncherRequest = {
  token?: unknown
  op?: unknown
  id?: unknown
  argv?: unknown
  cwd?: unknown
  env?: unknown
}

function send(socket: Socket, message: unknown): void {
  socket.write(`${JSON.stringify(message)}\n`)
}

/**
 * A TCP launcher speaking the protocol in desktop-launcher-client.ts. Fake commands:
 * `echo <words…>`, `fail <code> <message>` (stderr, then exit code), `report` (prints the argv,
 * cwd and env it received as JSON), `hang` (runs until killed), `flood <lines> <chars>` (writes
 * every stdout line at once, ignoring backpressure) and `bigline <chars>` (one stdout line whose
 * data has that many chars). Anything else fails to spawn.
 */
export async function startFakeDesktopLauncher(token: string): Promise<FakeDesktopLauncher> {
  const sockets = new Set<Socket>()
  const runs: FakeLauncherRun[] = []
  const killed: string[] = []
  const closed: string[] = []
  const closeWaiters: { id: string; resolve: () => void }[] = []
  const hanging = new Map<string, Socket>()
  let rejected = 0
  let connections = 0
  let nextId = 1

  const markClosed = (id: string): void => {
    closed.push(id)
    for (const waiter of closeWaiters.filter((entry) => entry.id === id)) {
      waiter.resolve()
    }
  }

  const start = (
    socket: Socket,
    request: LauncherRequest
  ): { id: string; hanging: boolean } | undefined => {
    const argv = Array.isArray(request.argv) ? request.argv.map(String) : []
    const [command, ...args] = argv
    if (!['echo', 'fail', 'report', 'hang', 'flood', 'bigline'].includes(command ?? '')) {
      send(socket, { error: 'spawn_failed' })
      socket.end()
      return undefined
    }
    const id = `run-${nextId++}`
    const run: FakeLauncherRun = { id, argv }
    if (typeof request.cwd === 'string') {
      run.cwd = request.cwd
    }
    if (request.env && typeof request.env === 'object') {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test fake echoes whatever env object it received.
      run.env = request.env as Record<string, string>
    }
    runs.push(run)
    send(socket, { id })
    if (command === 'echo') {
      send(socket, { stream: 'stdout', data: `${args.join(' ')}\n` })
      send(socket, { exit: 0 })
      socket.end()
    } else if (command === 'fail') {
      send(socket, { stream: 'stderr', data: `${args.slice(1).join(' ')}\n` })
      send(socket, { exit: Number(args[0]) })
      socket.end()
    } else if (command === 'flood') {
      const line = 'x'.repeat(Number(args[1]))
      for (let index = 0; index < Number(args[0]); index++) {
        send(socket, { stream: 'stdout', data: line })
      }
      send(socket, { exit: 0 })
      socket.end()
    } else if (command === 'bigline') {
      send(socket, { stream: 'stdout', data: 'x'.repeat(Number(args[0])) })
      send(socket, { exit: 0 })
      socket.end()
    } else if (command === 'report') {
      send(socket, { stream: 'stdout', data: JSON.stringify(run) })
      send(socket, { exit: 0 })
      socket.end()
    } else {
      send(socket, { stream: 'stdout', data: 'started\n' })
      return { id, hanging: true }
    }
    return { id, hanging: false }
  }

  const server = createServer((socket) => {
    connections++
    sockets.add(socket)
    let running: string | undefined
    let started: string | undefined
    let pending = ''
    socket.setEncoding('utf8')
    socket.on('error', () => {})
    socket.once('close', () => {
      sockets.delete(socket)
      if (started) {
        hanging.delete(started)
        markClosed(started)
      }
    })
    socket.on('data', (chunk: string) => {
      pending += chunk
      let newline = pending.indexOf('\n')
      while (newline >= 0) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        newline = pending.indexOf('\n')
        let request: LauncherRequest
        try {
          request = JSON.parse(line)
        } catch {
          send(socket, { error: 'bad_request' })
          socket.end()
          return
        }
        if (request.token !== token) {
          rejected++
          send(socket, { error: 'bad_token' })
          socket.end()
          return
        }
        if (request.op === 'run' && running === undefined) {
          const run = start(socket, request)
          started = run?.id
          running = run?.hanging ? run.id : undefined
          if (running) {
            hanging.set(running, socket)
          }
        } else if (request.op === 'kill' && request.id === running && running) {
          killed.push(running)
          hanging.delete(running)
          send(socket, { exit: 143 })
          running = undefined
          socket.end()
        }
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('fake launcher has no TCP address')
  }
  return {
    port: address.port,
    runs,
    killed,
    get rejected() {
      return rejected
    },
    get connections() {
      return connections
    },
    waitForClosed: (id) =>
      closed.includes(id)
        ? Promise.resolve()
        : new Promise<void>((resolve) => closeWaiters.push({ id, resolve })),
    emit: (id, message) => {
      const socket = hanging.get(id)
      if (!socket) {
        throw new Error(`fake launcher run ${id} is not running`)
      }
      send(socket, message)
      if ('exit' in message) {
        hanging.delete(id)
        socket.end()
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy()
        }
        server.close(() => resolve())
      })
  }
}
