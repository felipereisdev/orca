/** Runs `work` until it settles or `timeoutMs` passes; the signal aborts on the deadline. */
export async function withDeadline<T>(
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>
): Promise<T | 'timeout'> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve('timeout')
    }, timeoutMs)
  })
  try {
    return await Promise.race([work(controller.signal), deadline])
  } finally {
    clearTimeout(timer)
  }
}
