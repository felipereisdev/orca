// Local builds declare the partial orcad template they ship; release packaging keeps the full matrix.
const {
  ORCAD_TEMPLATE_TARGETS
} = require('../../../../src/shared/node-runtime/node-runtime-pin.ts')

const LOCAL_ORCAD_TARGETS_ENV = 'ORCA_LOCAL_ORCAD_TARGETS'
const DEFAULT_LOCAL_ORCAD_TARGETS = ['linux-arm64-glibc']
const DOCKER_ARCH_BY_TARGET_ARCH = { arm64: 'arm64', x64: 'amd64' }

/** The targets a local build ships, or null when `none` turns the template step off. */
function localOrcadTemplateTargets(env = process.env) {
  const value = (env[LOCAL_ORCAD_TARGETS_ENV] ?? '').trim()
  if (value === '') {
    return [...DEFAULT_LOCAL_ORCAD_TARGETS]
  }
  if (value === 'none') {
    return null
  }
  const targets = [
    ...new Set(
      value
        .split(',')
        .map((target) => target.trim())
        .filter(Boolean)
    )
  ]
  const unknown = targets.filter((target) => !ORCAD_TEMPLATE_TARGETS.includes(target))
  if (targets.length === 0 || unknown.length > 0) {
    throw new Error(
      `${LOCAL_ORCAD_TARGETS_ENV} needs none or a comma-separated subset of ` +
        `${ORCAD_TEMPLATE_TARGETS.join(',')}; got ${value}`
    )
  }
  return targets
}

/** Docker platform that builds `target` natively; only glibc Linux targets build in a container. */
function localOrcadDockerPlatform(target) {
  const match = /^linux-(arm64|x64)-glibc$/.exec(target)
  if (!match) {
    throw new Error(
      `Local orcad templates build only linux-*-glibc targets in Docker; ${target} needs the release pipeline`
    )
  }
  return `linux/${DOCKER_ARCH_BY_TARGET_ARCH[match[1]]}`
}

// Release and CI builds always verify the full matrix, whatever a developer's shell exported.
const RELEASE_BUILD_FLAGS = [
  'ORCA_REQUIRE_ORCAD_TEMPLATE',
  'ORCA_MAC_RELEASE',
  'ORCA_MAC_HOURLY',
  'ORCA_MAC_DAILY',
  'ORCA_MAC_ADHOC',
  'ORCA_WIN_HOURLY',
  'ORCA_WIN_DAILY',
  'ORCA_WIN_ADHOC',
  'ORCA_LINUX_ARM64_RELEASE'
]

function isReleaseOrCiBuild(env) {
  const ci = (env.CI ?? '').trim().toLowerCase()
  return (
    RELEASE_BUILD_FLAGS.some((flag) => env[flag] === '1') ||
    (ci !== '' && ci !== '0' && ci !== 'false') ||
    env.GITHUB_ACTIONS === 'true'
  )
}

/** The exact targets a local build declared for packaging; null means verify the release matrix. */
function localPackagingOrcadTemplateTargets(env = process.env) {
  if (isReleaseOrCiBuild(env) || !(env[LOCAL_ORCAD_TARGETS_ENV] ?? '').trim()) {
    return null
  }
  return localOrcadTemplateTargets(env)
}

module.exports = {
  DEFAULT_LOCAL_ORCAD_TARGETS,
  LOCAL_ORCAD_TARGETS_ENV,
  localOrcadDockerPlatform,
  localOrcadTemplateTargets,
  localPackagingOrcadTemplateTargets
}
