import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'

/**
 * The controller token this Mac's newest configure of the environment's desktop received. It lives
 * only in main's memory; viewing and handing over control need it besides the paired identity.
 */
export async function readDesktopControllerToken(
  target: RuntimeClientTarget
): Promise<string | undefined> {
  if (target.kind !== 'environment') {
    return undefined
  }
  try {
    const token = await window.api.ephemeralVm.desktopControllerToken({
      environmentId: target.environmentId
    })
    return token ?? undefined
  } catch {
    return undefined
  }
}

/** Asks main to hand the desktop to the environment again (Retry); false when it could not. */
export async function reconfigureEnvironmentDesktop(target: RuntimeClientTarget): Promise<boolean> {
  if (target.kind !== 'environment') {
    return false
  }
  try {
    return (
      (await window.api.ephemeralVm.reconfigureDesktop({ environmentId: target.environmentId })) ===
      true
    )
  } catch {
    return false
  }
}
