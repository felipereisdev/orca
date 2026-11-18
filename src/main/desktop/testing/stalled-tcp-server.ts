import { createServer, type Socket } from 'node:net'

/** Accepts TCP connections and never writes, to exercise handshake timeouts. */
export async function startStalledTcpServer(): Promise<{ port: number; close(): Promise<void> }> {
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('stalled server has no TCP address')
  }
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy()
        }
        server.close(() => resolve())
      })
  }
}
