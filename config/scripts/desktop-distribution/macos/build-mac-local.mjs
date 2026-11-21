import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildLocalOrcadTemplate } from '../../orcad-distribution/template/build-local-orcad-template.mjs'
import { LOCAL_ORCAD_TARGETS_ENV } from '../../orcad-distribution/template/local-orcad-template-targets.cjs'

export function createLocalBuildVersion(baseVersion, timestamp, commit) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(baseVersion)) {
    throw new Error(`Package version is not valid semver: ${baseVersion}`)
  }
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error('Local build timestamp is invalid.')
  }
  const sanitizedCommit = commit.replace(/[^0-9A-Za-z-]/g, '').slice(0, 12)
  if (!sanitizedCommit) {
    throw new Error('Git commit identity is empty.')
  }
  const suffix = `local.${timestamp}.${sanitizedCommit}`
  return baseVersion.includes('-') ? `${baseVersion}.${suffix}` : `${baseVersion}-${suffix}`
}

export function getLocalBuildIdentity() {
  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
  const commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    encoding: 'utf8'
  }).trim()
  return {
    commit,
    version: createLocalBuildVersion(packageJson.version, Date.now(), commit)
  }
}

/** Env that declares the template to electron-builder; a failed or skipped build ships none, never a stale one. */
export function localOrcadTemplateEnv(env = process.env) {
  if (env[LOCAL_ORCAD_TARGETS_ENV]?.trim() === 'none') {
    return {}
  }
  try {
    const result = buildLocalOrcadTemplate(env)
    if (result.status === 'built') {
      return { [LOCAL_ORCAD_TARGETS_ENV]: result.targets.join(',') }
    }
  } catch (error) {
    console.error(
      `[build:mac] orcad template build failed, packaging without it: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  rmSync(resolve('out', 'orcad-template'), { recursive: true, force: true })
  return { [LOCAL_ORCAD_TARGETS_ENV]: undefined }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const identity = getLocalBuildIdentity()
  console.log(`[build:mac] local update version ${identity.version}`)
  const templateEnv = localOrcadTemplateEnv()
  execFileSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'electron-builder', '--config', 'config/electron-builder.config.cjs', '--mac'],
    {
      env: {
        ...process.env,
        ...templateEnv,
        ORCA_BUILD_COMMIT: identity.commit,
        ORCA_LOCAL_BUILD_VERSION: identity.version
      },
      stdio: 'inherit'
    }
  )
}
