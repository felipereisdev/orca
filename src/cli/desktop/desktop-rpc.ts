import type { RuntimeClient } from '../runtime/client'
import { RuntimeRpcFailureError, type RuntimeCallOptions } from '../runtime/connection/types'
import type { RuntimeRpcSuccess } from '../../shared/remote-runtime/rpc/runtime-rpc-envelope'

const DESKTOP_NEXT_STEPS: Record<string, string> = {
  desktop_user_in_control: 'Wait for the user to hand control back.',
  desktop_unavailable: 'Run `orca desktop status` to see why the desktop is not available.'
}

/** Adds what to do next to desktop errors the agent can only wait out or inspect. */
function withDesktopNextStep(error: unknown): unknown {
  if (!(error instanceof RuntimeRpcFailureError)) {
    return error
  }
  const step = DESKTOP_NEXT_STEPS[error.code]
  if (!step) {
    return error
  }
  const data = error.response.error.data
  return new RuntimeRpcFailureError({
    ...error.response,
    error: {
      ...error.response.error,
      data: { ...(data && typeof data === 'object' ? data : {}), nextSteps: [step] }
    }
  })
}

export async function callDesktop<TResult>(
  client: Pick<RuntimeClient, 'call'>,
  method: string,
  params: unknown,
  options?: RuntimeCallOptions
): Promise<RuntimeRpcSuccess<TResult>> {
  try {
    return options === undefined
      ? await client.call<TResult>(method, params)
      : await client.call<TResult>(method, params, options)
  } catch (error) {
    throw withDesktopNextStep(error)
  }
}
