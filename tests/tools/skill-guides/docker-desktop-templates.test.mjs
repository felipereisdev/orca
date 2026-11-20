import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const TEMPLATES = path.resolve(
  'skill-guides/orca-per-workspace-env/references/docker-desktop-ssh-templates.md'
)
const SENTINEL_ARGS = [
  'run',
  '-d',
  '--name',
  'orca-ptrace-scope',
  '--label',
  'orca.purpose=ptrace-scope',
  '--restart=always',
  '--privileged',
  '--network',
  'none',
  '--memory',
  '16m',
  '--cpus',
  '0.05',
  'busybox:1.37',
  'sh',
  '-c',
  'echo 1 > /proc/sys/kernel/yama/ptrace_scope && exec sleep 2147483647'
]
const ONE_OFF_ARGS = [
  'run',
  '--rm',
  '--privileged',
  '--network',
  'none',
  'debian:bookworm-slim',
  'sh',
  '-c',
  'echo 1 > /proc/sys/kernel/yama/ptrace_scope'
]
const directories = []

// Same extraction the reference documents for writing the scripts.
function extractTemplates() {
  const dir = mkdtempSync(path.join(tmpdir(), 'orca-docker-desktop-'))
  directories.push(dir)
  const text = readFileSync(TEMPLATES, 'utf8')
  for (const [, name, , body] of text.matchAll(
    /^### `([^`]+)`\n\n.*\n\n(`{3,})[a-z]*\n([\s\S]*?)\n\2$/gm
  )) {
    writeFileSync(path.join(dir, name), `${body}\n`, { mode: 0o755 })
  }
  return dir
}

function printedFix(dir, env) {
  return execFileSync(
    'bash',
    [
      '-c',
      'set -euo pipefail; here="$1"; . "$here/orca-docker-desktop.sh"; ptrace_scope_fix',
      '_',
      dir
    ],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } }
  )
}

// Parses a printed command the way a pasting shell would, without running it.
function words(command, cwd) {
  const out = execFileSync('bash', ['-c', 'eval "set -- $1"; printf "%s\\0" "$@"', '_', command], {
    cwd,
    encoding: 'utf8'
  })
  return out.split('\0').slice(0, -1)
}

function commandsOf(text) {
  return {
    remove: /remove it later with (.*)\):$/m.exec(text)[1],
    sentinel: text.split('\n')[1].slice(2),
    oneOff: text.split('\n')[3].slice(2)
  }
}

function flagsOk(dir) {
  const result = spawnSync(
    'bash',
    [
      '-c',
      'set -euo pipefail; here="$1"; eval "$(sed -n "/^template_flags_ok()/,/^}/p" "$here/doctor-extra.sh")"; template_flags_ok',
      '_',
      dir
    ],
    { encoding: 'utf8' }
  )
  return result.status === 0
}

function edit(file, change) {
  writeFileSync(file, change(readFileSync(file, 'utf8')))
}

afterEach(() => {
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform === 'win32')('docker desktop recipe templates', () => {
  it('prints host commands that keep a hostile Docker path and host as data', () => {
    const dir = extractTemplates()
    const bin = "/opt/$(touch pwned-bin)/dock'er `touch pwned-tick`"
    const host = '-oProxyCommand=touch pwned-host'
    const commands = commandsOf(printedFix(dir, { ORCA_DOCKER_HOST: host, ORCA_DOCKER_BIN: bin }))

    for (const [command, args] of [
      [commands.remove, ['rm', '-f', 'orca-ptrace-scope']],
      [commands.sentinel, SENTINEL_ARGS],
      [commands.oneOff, ONE_OFF_ARGS]
    ]) {
      const local = words(command, dir)
      expect(local.slice(0, 3)).toEqual(['ssh', '--', host])
      expect(local).toHaveLength(4)
      expect(words(local[3], dir)).toEqual([bin, ...args])
    }
    for (const marker of ['pwned-bin', 'pwned-tick', 'pwned-host']) {
      expect(existsSync(path.join(dir, marker))).toBe(false)
    }
  })

  it('prints plain docker commands without a Docker host', () => {
    const dir = extractTemplates()
    const commands = commandsOf(printedFix(dir, { ORCA_DOCKER_HOST: '', ORCA_DOCKER_BIN: '' }))

    expect(words(commands.sentinel, dir)).toEqual(['docker', ...SENTINEL_ARGS])
    expect(words(commands.oneOff, dir)).toEqual(['docker', ...ONE_OFF_ARGS])
  })

  it('lets the doctor exempt only the two exact hint lines from the --privileged refusal', () => {
    const pristine = extractTemplates()
    expect(flagsOk(pristine)).toBe(true)

    const stray = extractTemplates()
    edit(path.join(stray, 'resume.sh'), (text) => `${text}dk run --privileged x\n`)
    expect(flagsOk(stray)).toBe(false)

    const extended = extractTemplates()
    edit(path.join(extended, 'orca-docker-desktop.sh'), (text) =>
      text.replace('exec sleep 2147483647\')"', 'exec sleep 2147483647\')"; dk run --privileged y')
    )
    expect(flagsOk(extended)).toBe(false)

    const inserted = extractTemplates()
    edit(path.join(inserted, 'orca-docker-desktop.sh'), (text) =>
      text.replace('ptrace_scope_fix() {\n', 'ptrace_scope_fix() {\n  dk run --privileged z\n')
    )
    expect(flagsOk(inserted)).toBe(false)
  })
})
