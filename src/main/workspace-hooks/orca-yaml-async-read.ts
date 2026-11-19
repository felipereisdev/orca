import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseOrcaYaml } from '../../shared/workspace-setup/orca-yaml'
import type { OrcaHooks } from '../../shared/workspace-setup/orca-yaml-hook-types'
import { windowsFsPath } from '../wsl/filesystem/wsl-unc-drive-fs-path'

/** `loadHooks` off the main thread's critical path: null when orca.yaml is missing or unreadable. */
export async function loadHooksAsync(repoPath: string): Promise<OrcaHooks | null> {
  try {
    return parseOrcaYaml(await readFile(windowsFsPath(join(repoPath, 'orca.yaml')), 'utf-8'))
  } catch {
    return null
  }
}
