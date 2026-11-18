import {
  getEphemeralVmRecipeResultDesktop,
  type EphemeralVmRecipeDesktop
} from '../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipes'
import { redactEphemeralVmRecipeDiagnosticText } from '../../shared/remote-runtime/ephemeral-vm-recipes/ephemeral-vm-recipe-diagnostic-redaction'
import type { EphemeralVmRuntimeRecord } from '../../shared/remote-runtime/ephemeral-vm-store/ephemeral-vm-runtimes'
import type { GlobalSettings } from '../../shared/settings/global-settings-types'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/catalog/runtime-environment-registry-root'
import { syncEnvironmentRecordings } from './desktop-recording-sync'

const CONFIGURE_TIMEOUT_MS = 15_000

type DesktopSettingsSource = { getSettings(): Pick<GlobalSettings, 'experimentalEphemeralVms'> }
type DesktopRuntime = Pick<
  EphemeralVmRuntimeRecord,
  'runtimeEnvironmentId' | 'workspaceId' | 'recipeResult'
>

/** An error text with the desktop's password and launcher token removed, even when echoed raw. */
function redactDesktopSecrets(text: string, desktop: EphemeralVmRecipeDesktop): string {
  let redacted = text
  for (const secret of [desktop.password, desktop.launcher?.token]) {
    if (secret) {
      redacted = redacted.split(secret).join('[redacted]')
    }
  }
  return redactEphemeralVmRecipeDiagnosticText(redacted)
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
  let failure: string
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
    failure = `${response.error.code}: ${response.error.message}`
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }
  console.warn(
    '[ephemeral-vm] desktop configure failed',
    runtimeEnvironmentId,
    redactDesktopSecrets(failure, desktop)
  )
  return 'failed'
}

function runtimeDesktop(
  store: DesktopSettingsSource,
  runtime: DesktopRuntime
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

/** After provisioning or resume: configure the desktop, then keep its recordings on this Mac. */
export async function handOffRecipeEnvironmentDesktop(
  store: DesktopSettingsSource,
  runtime: DesktopRuntime
): Promise<void> {
  const target = runtimeDesktop(store, runtime)
  if (!target) {
    return
  }
  const outcome = await configureEnvironmentDesktop(target.environmentId, target.desktop)
  // Only the identity that configured may subscribe to the desktop's events.
  if (outcome === 'configured' && runtime.workspaceId) {
    syncEnvironmentRecordings(target.environmentId, runtime.workspaceId)
  }
}

/** A workspace attached to an already configured environment starts copying its recordings. */
export function startRecipeWorkspaceRecordingSync(
  store: DesktopSettingsSource,
  runtime: DesktopRuntime
): void {
  const target = runtimeDesktop(store, runtime)
  if (target && runtime.workspaceId) {
    syncEnvironmentRecordings(target.environmentId, runtime.workspaceId)
  }
}
