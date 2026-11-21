import { execFile, execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:http'
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

// create.sh's token choice for a repo URL, with gh stubbed so it never reaches the real CLI.
function gitToken(dir, repoUrl, env = {}) {
  const bin = path.join(dir, 'stub-bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\necho gh-cli-token\n', { mode: 0o755 })
  return execFileSync(
    'bash',
    [
      '-c',
      'set -euo pipefail; repo_url="$2"; eval "$(sed -n "/^git_token()/,/^}/p" "$1/create.sh")"; git_token',
      '_',
      dir,
      repoUrl
    ],
    {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        ...env
      }
    }
  )
}

/**
 * Runs the real orca-desktop-clone as this user against `repoUrl`, which the home's git config
 * rewrites to `rewriteTo`; getent is stubbed to that home, and system config (a keychain helper) is off.
 */
function runClone(dir, { repoUrl, rewriteTo, token }) {
  const home = path.join(dir, 'home')
  const bin = path.join(dir, 'clone-bin')
  mkdirSync(home, { recursive: true })
  mkdirSync(bin, { recursive: true })
  writeFileSync(path.join(bin, 'getent'), `#!/bin/sh\necho "u:x:1:1::${home}:/bin/sh"\n`, {
    mode: 0o755
  })
  writeFileSync(path.join(home, '.gitconfig'), `[url "${rewriteTo}"]\n\tinsteadOf = ${repoUrl}\n`)
  return new Promise((resolve) => {
    const child = execFile(
      path.join(dir, 'orca-desktop-clone'),
      [repoUrl, path.join(dir, 'checkout')],
      {
        encoding: 'utf8',
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          GIT_CONFIG_NOSYSTEM: '1',
          XDG_CONFIG_HOME: path.join(home, '.config')
        }
      },
      (error, stdout, stderr) => resolve({ ok: !error, stderr, home })
    )
    child.stdin.end(`${token}\n`)
  })
}

function bareRepo(dir) {
  const work = path.join(dir, 'src')
  const bare = path.join(dir, 'served', 'repo.git')
  const git = (...args) =>
    execFileSync('git', args, { env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } })
  git('init', '-q', '-b', 'main', work)
  git(
    '-C',
    work,
    '-c',
    'user.email=t@t',
    '-c',
    'user.name=t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init'
  )
  git('clone', '-q', '--bare', work, bare)
  git('-C', bare, 'update-server-info')
  return bare
}

/** Serves a bare repo over git's dumb HTTP protocol, only to basic auth with this token. */
async function authServer(root, token) {
  const expected = `Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
  const server = createServer((request, response) => {
    if (request.headers.authorization !== expected) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="repo"' }).end()
      return
    }
    const file = path.join(root, new URL(request.url, 'http://x').pathname)
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(readFileSync(file))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  return `http://127.0.0.1:${server.address().port}`
}

const servers = []

function edit(file, change) {
  writeFileSync(file, change(readFileSync(file, 'utf8')))
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close()
  }
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
  it('passes a GitHub token only to github.com, and an explicit one only to its host', () => {
    const dir = extractTemplates()
    const github = { GH_TOKEN: 'gh-env-token' }
    const override = {
      ORCA_DESKTOP_GIT_TOKEN: 'other-token',
      ORCA_DESKTOP_GIT_TOKEN_HOST: 'git.example.test'
    }

    expect(gitToken(dir, 'https://github.com/acme/repo.git', github)).toBe('gh-env-token\n')
    expect(gitToken(dir, 'https://github.com/acme/repo.git')).toBe('gh-cli-token\n')
    expect(gitToken(dir, 'https://git.example.test/acme/repo.git', github)).toBe('\n')
    expect(gitToken(dir, 'https://git.example.test/acme/repo.git')).toBe('\n')
    expect(gitToken(dir, 'https://git.example.test/acme/repo.git', override)).toBe('other-token\n')
    expect(gitToken(dir, 'https://github.com/acme/repo.git', { ...github, ...override })).toBe(
      'gh-env-token\n'
    )
    expect(gitToken(dir, 'git@github.com:acme/repo.git', github)).toBe('\n')
  })

  it('stores the token only when the clone needed it', async () => {
    const anonymous = extractTemplates()
    const open = await runClone(anonymous, {
      repoUrl: 'https://github.com/acme/repo.git',
      rewriteTo: `file://${bareRepo(anonymous)}`,
      token: 'unused-token'
    })
    expect(open.ok).toBe(true)
    expect(existsSync(path.join(open.home, '.git-credentials'))).toBe(false)

    const authed = extractTemplates()
    const base = await authServer(path.join(authed, 'served'), 'good-token')
    bareRepo(authed)
    const needed = await runClone(authed, {
      repoUrl: 'https://github.com/acme/repo.git',
      rewriteTo: `${base}/repo.git`,
      token: 'good-token'
    })
    expect(needed.stderr).toBe('')
    expect(needed.ok).toBe(true)
    const store = path.join(needed.home, '.git-credentials')
    expect(readFileSync(store, 'utf8')).toBe('https://x-access-token:good-token@github.com\n')
    expect(statSync(store).mode & 0o777).toBe(0o600)
  })
})
