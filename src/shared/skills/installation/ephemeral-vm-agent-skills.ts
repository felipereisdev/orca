import type { GlobalSettings } from '../../settings/global-settings-types'

export const EPHEMERAL_VMS_SKILL_NAME = 'orca-per-workspace-env'
export const ORCA_DESKTOP_SKILL_NAME = 'orca-desktop'

/** What Settings > VMs offers this host's agents; nothing while the experiment is off. */
export function ephemeralVmAgentSkillNames(
  settings: Pick<GlobalSettings, 'experimentalEphemeralVms'>
): readonly string[] {
  return settings.experimentalEphemeralVms === true
    ? [EPHEMERAL_VMS_SKILL_NAME, ORCA_DESKTOP_SKILL_NAME]
    : []
}

/** Installed on a recipe environment's own host once its desktop is handed over: its agents have no display. */
export const RECIPE_DESKTOP_AGENT_SKILL_NAMES: readonly string[] = [ORCA_DESKTOP_SKILL_NAME]
