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
  'desktop_controller_token_invalid',
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

export type DesktopConfigureOutcome =
  | { outcome: 'configured'; controllerToken: string }
  | { outcome: 'skipped' | 'failed' }

function controllerTokenOf(result: unknown): string | null {
  return typeof result === 'object' &&
    result !== null &&
    'controllerToken' in result &&
    typeof result.controllerToken === 'string' &&
    result.controllerToken.length > 0
    ? result.controllerToken
    : null
}

/**
 * Hands the recipe's desktop to the environment's broker over the host's own pairing. The broker
 * binds it as controller only once the VNC password checks out, and answers with the controller
 * token the host keeps in memory; a failure only loses the desktop, never the workspace.
 */
export async function configureEnvironmentDesktop(
  runtimeEnvironmentId: string,
  desktop: EphemeralVmRecipeDesktop | null
): Promise<DesktopConfigureOutcome> {
  if (!desktop) {
    return { outcome: 'skipped' }
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
    const controllerToken = response.ok ? controllerTokenOf(response.result) : null
    if (controllerToken) {
      return { outcome: 'configured', controllerToken }
    }
    // A server that answers without a token is from before tokens and can never be viewed.
    code = response.ok ? 'unknown' : response.error.code
  } catch (error) {
    code = thrownCode(error)
  }
  console.warn('[ephemeral-vm] desktop configure failed', {
    environmentId: runtimeEnvironmentId,
    code: loggedFailureCode(code)
  })
  return { outcome: 'failed' }
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
