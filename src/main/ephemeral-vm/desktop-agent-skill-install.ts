import { z } from 'zod'
import type { BundledSkillPlanRequest } from '../../shared/skills/bundled/bundled-skill-plan'
import { RECIPE_DESKTOP_AGENT_SKILL_NAMES } from '../../shared/skills/installation/ephemeral-vm-agent-skills'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/requests/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/catalog/runtime-environment-registry-root'

// Only what this caller reads; the environment's reply is checked, not trusted.
const PlanReply = z.object({ planDigest: z.string().regex(/^[0-9a-f]{64}$/u) })
const ExecuteReply = z.object({
  skills: z.array(z.object({ status: z.string(), ops: z.array(z.object({ status: z.string() })) }))
})

const PLAN_TIMEOUT_MS = 30_000
const EXECUTE_TIMEOUT_MS = 60_000

/** Environments whose agents already got the desktop skill in this app run; its disk keeps it across reconnects. */
const installedEnvironments = new Set<string>()

export type DesktopAgentSkillInstallOutcome = 'installed' | 'already-installed' | 'failed'

/**
 * Installs the desktop skill for the agents on a recipe environment's own host, through the same
 * `skills.*BundledOrca` RPCs Settings uses for a paired host. Its agents have no display, so
 * without the skill they try to run GUI apps directly. A failure only loses the skill.
 */
export async function installDesktopAgentSkillOnEnvironment(
  environmentId: string
): Promise<DesktopAgentSkillInstallOutcome> {
  if (installedEnvironments.has(environmentId)) {
    return 'already-installed'
  }
  const request: BundledSkillPlanRequest = { names: [...RECIPE_DESKTOP_AGENT_SKILL_NAMES] }
  const root = getRuntimeEnvironmentRegistryRoot()
  let code = 'unknown'
  try {
    const planned = await callRuntimeEnvironment(
      root,
      environmentId,
      'skills.planBundledOrca',
      request,
      PLAN_TIMEOUT_MS
    )
    const plan = planned.ok ? PlanReply.safeParse(planned.result).data : undefined
    if (plan) {
      const executed = await callRuntimeEnvironment(
        root,
        environmentId,
        'skills.executeBundledOrca',
        { planDigest: plan.planDigest, request },
        EXECUTE_TIMEOUT_MS
      )
      const result = executed.ok ? ExecuteReply.safeParse(executed.result).data : undefined
      const ran = result?.skills.every(
        (skill) => skill.status === 'ran' && skill.ops.every((op) => op.status !== 'failed')
      )
      if (ran) {
        installedEnvironments.add(environmentId)
        return 'installed'
      }
      code = executed.ok ? 'not_ran' : executed.error.code
    } else {
      code = planned.ok ? 'bad_plan' : planned.error.code
    }
  } catch (error) {
    code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : 'unknown'
  }
  console.warn('[ephemeral-vm] desktop skill install failed', { environmentId, code })
  return 'failed'
}

/** Test seam: forget which environments were installed. */
export function resetDesktopAgentSkillInstalls(): void {
  installedEnvironments.clear()
}
