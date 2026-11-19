/**
 * Runtimes this process provisioned that no workspace has been attached to yet. Only these (or
 * records still provisioning or failed) may be rolled back without a removal check: nothing was
 * ever done in them. Kept in memory, so after a restart such a VM is cleaned up through Cloud VMs.
 */
const unattached = new Set<string>()

export function noteUnattachedProvision(runtimeId: string): void {
  unattached.add(runtimeId)
}

export function forgetUnattachedProvision(runtimeId: string): void {
  unattached.delete(runtimeId)
}

export function isUnattachedProvision(runtimeId: string): boolean {
  return unattached.has(runtimeId)
}
