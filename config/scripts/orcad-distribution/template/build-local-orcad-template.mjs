#!/usr/bin/env node
// Builds a partial orcad template for local builds: glibc Linux targets, each in a Docker container of its own arch.
// Targets: ORCA_LOCAL_ORCAD_TARGETS (default linux-arm64-glibc, `none` skips). Writes out/orcad-template.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { runProcess, runProcessSync } from '@orca/process-host'
import { ORCAD_CLI_PACKAGE_FILENAME } from '../../../../src/shared/remote-runtime/orcad-distribution/orcad-artifacts.ts'
import { acquireLocalOrcadCacheLock } from './local-orcad-cache-lock.mjs'
import {
  isReleaseOrCiBuild,
  LOCAL_ORCAD_TARGETS_ENV,
  localOrcadDockerPlatform,
  localOrcadTemplateTargets
} from './local-orcad-template-targets.cjs'
import { verifyPackagedOrcadTemplate } from './verify-packaged-orcad-template.cjs'

const ROOT = resolve(import.meta.dirname, '../../../..')
// Why short: tsx IPC unix sockets live under the checkout and break past ~100 characters.
const CACHE_ROOT = join(homedir(), '.cache', 'orca-local-orcad')
const NODE_VERSION = '24.22.3'
const DOCKER_CLI_VERSION = '27.5.1'
const NODE_ARCH = { arm64: 'arm64', amd64: 'x64' }
const DOCKER_CLI_ARCH = { arm64: 'aarch64', amd64: 'x86_64' }

const BUILDER_DOCKERFILE = `FROM ubuntu:24.04
ARG NODE_VERSION
ARG NODE_ARCH
ARG DOCKER_CLI_VERSION
ARG DOCKER_CLI_ARCH
RUN apt-get update \\
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl ca-certificates git python3 make g++ xz-utils \\
  && rm -rf /var/lib/apt/lists/*
RUN set -eu; cd /tmp; f="node-v\${NODE_VERSION}-linux-\${NODE_ARCH}.tar.xz"; \\
  curl -fsSLO "https://nodejs.org/dist/v\${NODE_VERSION}/\${f}"; \\
  curl -fsSL "https://nodejs.org/dist/v\${NODE_VERSION}/SHASUMS256.txt" | grep " \${f}\\$" | sha256sum -c -; \\
  tar -xJf "\${f}" -C /usr/local --strip-components=1; rm "\${f}"
RUN curl -fsSL "https://download.docker.com/linux/static/stable/\${DOCKER_CLI_ARCH}/docker-\${DOCKER_CLI_VERSION}.tgz" \\
  | tar -xz -C /usr/local/bin --strip-components=1 docker/docker
RUN corepack enable
`

// Constant script; every value reaches it through the container's environment.
const CONTAINER_SCRIPT = `set -euo pipefail
if [ -n "\${ORCA_HOST_OWNER:-}" ]; then trap 'chown -R "$ORCA_HOST_OWNER" "$ORCA_CACHE_DIR"' EXIT; fi
mkdir -p "$HOME"
git config --global --add safe.directory '*'
cd "$ORCA_SRC"
rm -rf out/orcad-prebuilds out/orcad-prebuilds-merged out/orcad-template out/.orcad-template-build
CI=true pnpm install --frozen-lockfile
pnpm build:orcad-prebuilds
if [ -n "\${ORCA_MERGE_PREBUILDS:-}" ]; then
  IFS=: read -r -a others <<< "$ORCA_MERGE_PREBUILDS"
  node config/scripts/orcad-distribution/prebuilds/merge-orcad-prebuilds.mjs --out out/orcad-prebuilds-merged out/orcad-prebuilds "\${others[@]}"
  rm -rf out/orcad-prebuilds
  mv out/orcad-prebuilds-merged out/orcad-prebuilds
fi
pnpm build:orcad-prebuilds --require-slots "$ORCA_REQUIRE_SLOTS"
git rev-parse HEAD > out/orcad-prebuilds.commit
if [ -n "\${ORCA_TEMPLATE_TARGETS:-}" ]; then
  CI=true pnpm -C mobile install --frozen-lockfile
  node config/scripts/build/mobile-web-app/build-mobile-web-app-bundle.mjs
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON config/scripts/orcad-distribution/template/build-orcad-template.mjs --targets "$ORCA_TEMPLATE_TARGETS"
fi
`

// Bounds for each docker call; a dead daemon must never hold `pnpm build:mac`.
const DOCKER_TIMEOUTS = {
  info: ['ORCA_LOCAL_ORCAD_DOCKER_INFO_TIMEOUT_MS', 30_000],
  inspect: ['ORCA_LOCAL_ORCAD_DOCKER_INSPECT_TIMEOUT_MS', 60_000],
  build: ['ORCA_LOCAL_ORCAD_DOCKER_BUILD_TIMEOUT_MS', 30 * 60_000],
  run: ['ORCA_LOCAL_ORCAD_DOCKER_RUN_TIMEOUT_MS', 60 * 60_000]
}

class DockerTimeoutError extends Error {}

function log(message) {
  console.log(`[local-orcad-template] ${message}`)
}

function git(args, cwd = ROOT) {
  const result = runProcessSync({ program: 'git', args, cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.code !== 0) {
    throw new Error(
      `git ${args[0]} exited ${result.code ?? result.signal}: ${result.stderr.trim()}`
    )
  }
  return result.stdout.trim()
}

function dockerTimeoutMs(kind, env) {
  const [name, fallback] = DOCKER_TIMEOUTS[kind]
  const value = Number(env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** One docker call; past `timeoutMs` the shared runner sends SIGTERM, then SIGKILL, and returns. */
export function runDocker(args, { program = 'docker', timeoutMs, capture = false }) {
  return runProcess({
    program,
    args,
    cwd: ROOT,
    timeoutMs,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  })
}

async function docker(args, context, kind, options = {}) {
  const timeoutMs = dockerTimeoutMs(kind, context.env)
  const result = await runDocker(args, { program: context.docker, timeoutMs, ...options })
  if (result.timedOut) {
    throw new DockerTimeoutError(`docker ${args[0]} timed out after ${timeoutMs}ms`)
  }
  if (result.code !== 0 && !options.allowFailure) {
    throw new Error(`docker ${args[0]} exited ${result.code ?? result.signal}`)
  }
  return result
}

async function dockerUnavailableReason(context) {
  try {
    const result = await docker(['info', '--format', '{{.ServerVersion}}'], context, 'info', {
      capture: true,
      allowFailure: true
    })
    return result.code === 0
      ? null
      : `Docker is not running (${result.stderr.trim() || 'no daemon'})`
  } catch (error) {
    if (error instanceof DockerTimeoutError) {
      return `Docker did not answer: ${error.message}`
    }
    return `Docker is not installed (${error instanceof Error ? error.message : String(error)})`
  }
}

async function ensureBuilderImage(context, dockerArch, platform) {
  const image = `orca-local-orcad-builder:node${NODE_VERSION}-docker${DOCKER_CLI_VERSION}-${dockerArch}`
  const inspected = await docker(['image', 'inspect', image], context, 'inspect', {
    capture: true,
    allowFailure: true
  })
  if (inspected.code === 0) {
    return image
  }
  log(`building ${image}`)
  const contextDir = join(CACHE_ROOT, 'builder-image')
  mkdirSync(contextDir, { recursive: true })
  writeFileSync(join(contextDir, 'Dockerfile'), BUILDER_DOCKERFILE)
  await docker(
    [
      'build',
      '--platform',
      platform,
      '--build-arg',
      `NODE_VERSION=${NODE_VERSION}`,
      '--build-arg',
      `NODE_ARCH=${NODE_ARCH[dockerArch]}`,
      '--build-arg',
      `DOCKER_CLI_VERSION=${DOCKER_CLI_VERSION}`,
      '--build-arg',
      `DOCKER_CLI_ARCH=${DOCKER_CLI_ARCH[dockerArch]}`,
      '-t',
      image,
      contextDir
    ],
    context,
    'build'
  )
  return image
}

// A standalone clone, not a worktree: Linux node_modules stay apart from the host's and no registration is left behind.
function prepareCheckout(src, head) {
  if (!existsSync(join(src, '.git'))) {
    rmSync(src, { recursive: true, force: true })
    git(['clone', '--quiet', '--no-checkout', ROOT, src])
  }
  git(['fetch', '--quiet', '--no-tags', ROOT, 'HEAD'], src)
  const fetched = git(['rev-parse', 'FETCH_HEAD'], src)
  if (fetched !== head) {
    throw new Error(`HEAD moved while fetching (${fetched} instead of ${head}); run again`)
  }
  git(['checkout', '--quiet', '--force', '--detach', head], src)
  git(['clean', '-fdq'], src)
}

async function runBuilder(
  context,
  { image, platform, cacheDir, src, slots, templateTargets, mergeFrom }
) {
  const owner =
    process.platform === 'linux' && typeof process.getuid === 'function'
      ? `${process.getuid()}:${process.getgid()}`
      : ''
  const env = {
    HOME: join(cacheDir, 'home'),
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    ORCA_CACHE_DIR: cacheDir,
    ORCA_SRC: src,
    ORCA_REQUIRE_SLOTS: slots.join(','),
    ORCA_TEMPLATE_TARGETS: templateTargets.join(','),
    ORCA_MERGE_PREBUILDS: mergeFrom.join(':'),
    ORCA_HOST_OWNER: owner
  }
  // Named, so a timed-out run's container is removed: killing the CLI does not stop it.
  const name = `orca-local-orcad-${process.pid}-${platform.split('/')[1]}`
  try {
    await docker(
      [
        'run',
        '--rm',
        '--name',
        name,
        '--platform',
        platform,
        '-v',
        '/var/run/docker.sock:/var/run/docker.sock',
        // Same path inside and out, so nested `docker run` bind mounts resolve on the host.
        '-v',
        `${cacheDir}:${cacheDir}`,
        ...mergeFrom.flatMap((dir) => ['-v', `${dir}:${dir}:ro`]),
        ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
        '-w',
        src,
        image,
        'bash',
        '-c',
        CONTAINER_SCRIPT
      ],
      context,
      'run'
    )
  } catch (error) {
    if (error instanceof DockerTimeoutError) {
      await docker(['rm', '-f', name], context, 'inspect', { capture: true, allowFailure: true })
    }
    throw error
  }
}

const BUILT_COMMIT_FILES = {
  // The template's CLI package records the commit it was built from.
  template: (dir) => ({ path: join(dir, ...ORCAD_CLI_PACKAGE_FILENAME.split('/')), json: true }),
  // Each arch's checkout stamps its prebuilds after building them.
  prebuilds: (dir) => ({ path: join(dir, 'out', 'orcad-prebuilds.commit'), json: false })
}

/** Refuses a template or a checkout's prebuilds built from anything but `head`. */
export function assertBuiltFromCommit(kind, dir, head) {
  const { path, json } = BUILT_COMMIT_FILES[kind](dir)
  let commit
  try {
    const text = readFileSync(path, 'utf8')
    commit = json ? JSON.parse(text).commit : text.trim()
  } catch (error) {
    throw new Error(`the built ${kind} has no commit stamp at ${path}`, { cause: error })
  }
  if (commit !== head) {
    throw new Error(`the built ${kind} comes from ${commit}, not this checkout's HEAD ${head}`)
  }
}

async function buildInCache(context, targets, byPlatform, outputDir) {
  const head = git(['rev-parse', 'HEAD'])
  if (git(['status', '--porcelain', '--untracked-files=normal'])) {
    log(`warning: uncommitted changes are not in the template; it is built from HEAD ${head}`)
  }
  log(`building ${targets.join(', ')} from ${head}`)
  // The first target's platform builds the template last, from every platform's prebuilds.
  const builds = [...byPlatform].map(([platform, slots]) => {
    const dockerArch = platform.split('/')[1]
    const cacheDir = join(CACHE_ROOT, `linux-${dockerArch}`)
    return { platform, slots, dockerArch, cacheDir, src: join(cacheDir, 'src') }
  })
  const [primary, ...others] = builds
  for (const build of [...others, primary]) {
    const phaseStartedAt = Date.now()
    const isPrimary = build === primary
    if (isPrimary) {
      for (const other of others) {
        assertBuiltFromCommit('prebuilds', other.src, head)
      }
    }
    const image = await ensureBuilderImage(context, build.dockerArch, build.platform)
    prepareCheckout(build.src, head)
    await runBuilder(context, {
      ...build,
      image,
      slots: isPrimary ? targets : build.slots,
      templateTargets: isPrimary ? targets : [],
      mergeFrom: isPrimary ? others.map((other) => join(other.src, 'out', 'orcad-prebuilds')) : []
    })
    assertBuiltFromCommit('prebuilds', build.src, head)
    log(`${build.platform} done in ${Math.round((Date.now() - phaseStartedAt) / 1000)}s`)
  }
  const builtDir = join(primary.src, 'out', 'orcad-template')
  assertBuiltFromCommit('template', builtDir, head)
  cpSync(builtDir, outputDir, { recursive: true, verbatimSymlinks: true })
  assertBuiltFromCommit('template', outputDir, head)
}

function skipped(reason) {
  log(`skipped: ${reason}; this build ships no orcad template`)
  return { status: 'skipped', reason }
}

/** Builds out/orcad-template for the declared targets; any run that produces none leaves none behind. */
export async function buildLocalOrcadTemplate(env = process.env, options = {}) {
  if (isReleaseOrCiBuild(env)) {
    // Why untouched: CI and release packaging verify the full matrix from their own template.
    log('skipped: a CI or release build packages its own full template')
    return { status: 'skipped', reason: 'CI or release build' }
  }
  const outputDir = options.outputDir ?? join(ROOT, 'out', 'orcad-template')
  // Why first: a stale template from an older HEAD or other targets must never be packaged.
  rmSync(outputDir, { recursive: true, force: true })
  const targets = localOrcadTemplateTargets(env)
  if (!targets) {
    return skipped(`${LOCAL_ORCAD_TARGETS_ENV}=none`)
  }
  const byPlatform = new Map()
  for (const target of targets) {
    const platform = localOrcadDockerPlatform(target)
    byPlatform.set(platform, [...(byPlatform.get(platform) ?? []), target])
  }
  const context = { env, docker: options.dockerProgram ?? 'docker' }
  const unavailable = await dockerUnavailableReason(context)
  if (unavailable) {
    return skipped(unavailable)
  }
  const startedAt = Date.now()
  const release = await acquireLocalOrcadCacheLock(join(CACHE_ROOT, 'build.lock'), { log })
  try {
    await buildInCache(context, targets, byPlatform, outputDir)
    verifyPackagedOrcadTemplate(dirname(outputDir), targets, { exact: true })
  } catch (error) {
    rmSync(outputDir, { recursive: true, force: true })
    if (error instanceof DockerTimeoutError) {
      return skipped(error.message)
    }
    throw error
  } finally {
    release()
  }
  log(`ok — ${targets.join(', ')} in ${Math.round((Date.now() - startedAt) / 1000)}s`)
  return { status: 'built', targets }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    await buildLocalOrcadTemplate()
  } catch (error) {
    console.error(
      `[local-orcad-template] failed: ${error instanceof Error ? error.message : String(error)}`
    )
    process.exitCode = 1
  }
}
