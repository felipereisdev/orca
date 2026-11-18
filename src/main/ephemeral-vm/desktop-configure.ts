import {
  getEphemeralVmRecipeResultDesktop,
  type EphemeralVmRecipeDesktop
} from '../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipes'
import type { EphemeralVmRuntimeRecord } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'
import type { GlobalSettings } from '../../shared/settings/global-settings-types'
import {
  RUNTIME_ENVIRONMENT_ASLEEP_ERROR_CODE,
  RUNTIME_ENVIRONMENT_WAKE_FAILED_ERROR_CODE,
  RUNTIME_ENVIRONMENT_WAKING_ERROR_CODE
} from '../../shared/remote-runtime/recipe-vm-wake'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/catalog/runtime-environment-registry-root'

const CONFIGURE_TIMEOUT_MS = 15_000

// Only these codes reach the log: remote and thrown text can echo the password or token.
const LOGGED_FAILURE_CODES = new Set([
  'desktop_unavailable',
  'desktop_invalid_input',
  'desktop_agent_not_allowed',
  'method_not_found',
  'unauthorized',
  'forbidden',
  'timeout',
  'runtime_environment_changed',
  'runtime_manually_disconnected',
  'remote_runtime_unavailable',
  RUNTIME_ENVIRONMENT_WAKING_ERROR_CODE,
  RUNTIME_ENVIRONMENT_WAKE_FAILED_ERROR_CODE,
  RUNTIME_ENVIRONMENT_ASLEEP_ERROR_CODE
])

export type DesktopSettingsSource = {
  getSettings(): Pick<GlobalSettings, 'experimentalEphemeralVms'>
}
export type DesktopRuntime = Pick<
  EphemeralVmRuntimeRecord,
  'id' | 'runtimeEnvironmentId' | 'workspaceId' | 'recipeResult'
>

function loggedFailureCode(code: unknown): string {
  return typeof code === 'string' && LOGGED_FAILURE_CODES.has(code) ? code : 'unknown'
}

function thrownCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

/**
 * Hands the recipe's desktop to the environment's broker over the host's own pairing, which the
 * broker binds as its controller; a failure only loses the desktop, never the workspace.
 */
export async function configureEnvironmentDesktop(
  runtimeEnvironmentId: string,
  desktop: EphemeralVmRecipeDesktop | null
): Promise<'configured' | 'skipped' | 'failed'> {
  if (!desktop) {
    return 'skipped'
  }
  let code: unknown
  try {
    const response = await callRuntimeEnvironment(
      getRuntimeEnvironmentRegistryRoot(),
      runtimeEnvironmentId,
      'desktop.configure',
      {
        host: desktop.host,
        port: desktop.port,
        password: desktop.password,
        ...(desktop.launcher ? { launcher: desktop.launcher } : {})
      },
      CONFIGURE_TIMEOUT_MS
    )
    if (response.ok) {
      return 'configured'
    }
    code = response.error.code
  } catch (error) {
    code = thrownCode(error)
  }
  console.warn('[ephemeral-vm] desktop configure failed', {
    environmentId: runtimeEnvironmentId,
    code: loggedFailureCode(code)
  })
  return 'failed'
}

/** The runtime's environment and desktop when the host should hand it over, else null. */
export function runtimeDesktop(
  store: DesktopSettingsSource,
  runtime: Omit<DesktopRuntime, 'id'>
): { environmentId: string; desktop: EphemeralVmRecipeDesktop } | null {
  const desktop = runtime.recipeResult
    ? getEphemeralVmRecipeResultDesktop(runtime.recipeResult)
    : null
  if (!desktop || !runtime.runtimeEnvironmentId) {
    return null
  }
  // The environment's desktop RPCs do not check the experiment; the host is its gate.
  return store.getSettings().experimentalEphemeralVms === true
    ? { environmentId: runtime.runtimeEnvironmentId, desktop }
    : null
}
