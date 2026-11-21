#!/usr/bin/env node
// Builds a partial orcad template for local builds: glibc Linux targets, each in a Docker container of its own arch.
// Targets: ORCA_LOCAL_ORCAD_TARGETS (default linux-arm64-glibc, `none` skips). Writes out/orcad-template.
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { runProcessSync } from '@orca/process-host'
import { ORCAD_CLI_PACKAGE_FILENAME } from '../../../../src/shared/remote-runtime/orcad-distribution/orcad-artifacts.ts'
import {
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
if [ -n "\${ORCA_TEMPLATE_TARGETS:-}" ]; then
  CI=true pnpm -C mobile install --frozen-lockfile
  node config/scripts/build/mobile-web-app/build-mobile-web-app-bundle.mjs
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON config/scripts/orcad-distribution/template/build-orcad-template.mjs --targets "$ORCA_TEMPLATE_TARGETS"
fi
`

function log(message) {
  console.log(`[local-orcad-template] ${message}`)
}

function run(program, args, options = {}) {
  const result = runProcessSync({
    program,
    args,
    cwd: options.cwd ?? ROOT,
    timeoutMs: options.timeoutMs ?? null,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  })
  if (result.code !== 0 && !options.allowFailure) {
    const detail = options.capture ? `: ${result.stderr.trim()}` : ''
    throw new Error(`${program} ${args[0]} exited ${result.code ?? result.signal}${detail}`)
  }
  return result
}

function git(args, cwd = ROOT) {
  return run('git', args, { cwd, capture: true }).stdout.trim()
}

function dockerUnavailableReason(program) {
  try {
    const result = run(program, ['info', '--format', '{{.ServerVersion}}'], {
      capture: true,
      allowFailure: true,
      timeoutMs: 30_000
    })
    return result.code === 0
      ? null
      : `Docker is not running (${result.stderr.trim() || 'no daemon'})`
  } catch (error) {
    return `Docker is not installed (${error instanceof Error ? error.message : String(error)})`
  }
}

function ensureBuilderImage(dockerArch, platform) {
  const image = `orca-local-orcad-builder:node${NODE_VERSION}-docker${DOCKER_CLI_VERSION}-${dockerArch}`
  if (
    run('docker', ['image', 'inspect', image], { capture: true, allowFailure: true }).code === 0
  ) {
    return image
  }
  log(`building ${image}`)
  const contextDir = join(CACHE_ROOT, 'builder-image')
  mkdirSync(contextDir, { recursive: true })
  writeFileSync(join(contextDir, 'Dockerfile'), BUILDER_DOCKERFILE)
  run('docker', [
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
  ])
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

function runBuilder({ image, platform, cacheDir, src, slots, templateTargets, mergeFrom }) {
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
  run('docker', [
    'run',
    '--rm',
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
  ])
}

const LOCK_POLL_MS = 5_000
const LOCK_WAIT_MS = 2 * 60 * 60 * 1000

function lockHolderIsAlive(lockPath) {
  let holder
  try {
    holder = JSON.parse(readFileSync(lockPath, 'utf8'))
  } catch {
    // A half-written lock is a holder starting up; an old unreadable one is debris.
    return existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs < 10_000
  }
  try {
    process.kill(holder.pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/** Exclusive lock on the shared cache; a lock whose owner died is reclaimed. Returns its release. */
export function acquireLocalOrcadCacheLock(lockPath, { waitMs = LOCK_WAIT_MS } = {}) {
  const deadline = Date.now() + waitMs
  let announced = false
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx')
      writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
      closeSync(fd)
      return () => rmSync(lockPath, { force: true })
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error
      }
    }
    if (!lockHolderIsAlive(lockPath)) {
      rmSync(lockPath, { force: true })
      continue
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `another local orcad template build holds ${lockPath} (${readFileSync(lockPath, 'utf8')})`
      )
    }
    if (!announced) {
      log(`waiting for another local orcad template build (${lockPath})`)
      announced = true
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_POLL_MS)
  }
}

/** The template's CLI package records the commit it was built from; refuse any other checkout's. */
export function assertTemplateFromCommit(templateDir, head) {
  const { commit } = JSON.parse(
    readFileSync(join(templateDir, ...ORCAD_CLI_PACKAGE_FILENAME.split('/')), 'utf8')
  )
  if (commit !== head) {
    throw new Error(`the built template comes from ${commit}, not this checkout's HEAD ${head}`)
  }
}

function buildInCache(targets, byPlatform, outputDir) {
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
    const image = ensureBuilderImage(build.dockerArch, build.platform)
    prepareCheckout(build.src, head)
    runBuilder({
      ...build,
      image,
      slots: isPrimary ? targets : build.slots,
      templateTargets: isPrimary ? targets : [],
      mergeFrom: isPrimary ? others.map((other) => join(other.src, 'out', 'orcad-prebuilds')) : []
    })
    log(`${build.platform} done in ${Math.round((Date.now() - phaseStartedAt) / 1000)}s`)
  }
  const builtDir = join(primary.src, 'out', 'orcad-template')
  assertTemplateFromCommit(builtDir, head)
  cpSync(builtDir, outputDir, { recursive: true, verbatimSymlinks: true })
  assertTemplateFromCommit(outputDir, head)
}

/** Builds out/orcad-template for the declared targets; any run that produces none leaves none behind. */
export function buildLocalOrcadTemplate(env = process.env, options = {}) {
  const outputDir = options.outputDir ?? join(ROOT, 'out', 'orcad-template')
  // Why first: a stale template from an older HEAD or other targets must never be packaged.
  rmSync(outputDir, { recursive: true, force: true })
  const targets = localOrcadTemplateTargets(env)
  if (!targets) {
    log(`skipped: ${LOCAL_ORCAD_TARGETS_ENV}=none`)
    return { status: 'skipped', reason: `${LOCAL_ORCAD_TARGETS_ENV}=none` }
  }
  const byPlatform = new Map()
  for (const target of targets) {
    const platform = localOrcadDockerPlatform(target)
    byPlatform.set(platform, [...(byPlatform.get(platform) ?? []), target])
  }
  const unavailable = dockerUnavailableReason(options.dockerProgram ?? 'docker')
  if (unavailable) {
    log(`skipped: ${unavailable}; this build ships no orcad template`)
    return { status: 'skipped', reason: unavailable }
  }
  const startedAt = Date.now()
  mkdirSync(CACHE_ROOT, { recursive: true })
  const release = acquireLocalOrcadCacheLock(join(CACHE_ROOT, '.lock'))
  try {
    buildInCache(targets, byPlatform, outputDir)
    verifyPackagedOrcadTemplate(dirname(outputDir), targets, { exact: true })
  } catch (error) {
    rmSync(outputDir, { recursive: true, force: true })
    throw error
  } finally {
    release()
  }
  log(`ok — ${targets.join(', ')} in ${Math.round((Date.now() - startedAt) / 1000)}s`)
  return { status: 'built', targets }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    buildLocalOrcadTemplate()
  } catch (error) {
    console.error(
      `[local-orcad-template] failed: ${error instanceof Error ? error.message : String(error)}`
    )
    process.exitCode = 1
  }
}
