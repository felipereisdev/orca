# Docker desktop over SSH: templates

Load this when you write the scripts for `references/docker-desktop-ssh.md`. Every file below goes
into `scripts/orca-vm/docker-desktop/` unchanged; configuration lives in environment variables or
`docker-desktop.env`, not in edits. To write them all at once from the repo root:

```bash
mkdir -p scripts/orca-vm/docker-desktop
ORCA skills get orca-per-workspace-env --reference references/docker-desktop-ssh-templates.md |
  node -e '
const fs = require("fs"), path = require("path")
const text = fs.readFileSync(0, "utf8")
for (const [, name, , body] of text.matchAll(/^### `([^`]+)`\n\n.*\n\n(`{3,})[a-z]*\n([\s\S]*?)\n\2$/gm)) {
  const file = path.join(process.argv[1], name)
  fs.writeFileSync(file, body + "\n")
  fs.chmodSync(file, name === "Dockerfile" ? 0o644 : 0o755)
}' scripts/orca-vm/docker-desktop
```

The first five files are copied into the image; the rest run on the machine where Orca runs.

### `Dockerfile`

The image. Its hash (with the four files it copies) names `orca-desktop:<hash>`.

```dockerfile
# Orca desktop environment: sshd for the agent user, a VNC desktop only the Orca server can drive.
# Users: vnc runs Xvnc and owns the VNC password; gui runs the launcher and every program it starts;
# dev is the agent/SSH user, with no X access and no sudo. dev and gui share the checkout via `work`:
# /work is setgid `work`, and dev's SSH sessions and the launcher use umask 002.
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

# Agent CLIs baked into the image; the auth image adds their login.
ARG AGENT_PACKAGES="@openai/codex@0.170.0 @anthropic-ai/claude-code@2.1.328"

# A fixed Debian snapshot pins every package version without listing each one (apt checks the
# signatures, so plain HTTP is fine before ca-certificates exists).
RUN sed -i \
      -e 's|http://deb.debian.org/debian-security|http://snapshot.debian.org/archive/debian-security/20261115T000000Z|' \
      -e 's|http://deb.debian.org/debian|http://snapshot.debian.org/archive/debian/20261115T000000Z|' \
      /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Check-Valid-Until=false update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates ffmpeg fluxbox git iproute2 openssh-client openssh-server procps \
      tigervnc-standalone-server tigervnc-tools util-linux x11-utils xauth \
      fonts-dejavu-core libasound2 libatk-bridge2.0-0 libatspi2.0-0 libcups2 libdrm2 libgbm1 \
      libgtk-3-0 libnotify4 libnss3 libsecret-1-0 libx11-xcb1 libxcomposite1 libxdamage1 \
      libxkbcommon0 libxrandr2 libxshmfence1 libxss1 libxtst6 xdg-utils \
    && rm -rf /var/lib/apt/lists/* \
    && if command -v sudo || command -v xdotool; then echo 'sudo/xdotool must not be installed' >&2; exit 1; fi

RUN npm install -g ${AGENT_PACKAGES} && npm cache clean --force

RUN userdel -r node \
    && groupadd -g 1200 work && groupadd -g 1300 xdisplay \
    && useradd -m -u 1100 -U -G xdisplay -s /usr/sbin/nologin vnc \
    && useradd -m -u 1101 -U -G work,xdisplay -s /usr/sbin/nologin gui \
    && useradd -m -u 1000 -U -G work -s /bin/bash dev \
    && chmod 0700 /home/vnc /home/gui /home/dev \
    && install -d -o root -g xdisplay -m 1770 /tmp/.X11-unix \
    && install -d -o dev -g work -m 2770 /work \
    && sed -ri 's/^session\s+required\s+pam_loginuid\.so/session optional pam_loginuid.so/' /etc/pam.d/sshd \
    && echo 'session optional pam_umask.so umask=0002' >> /etc/pam.d/sshd \
    && printf '%s\n' 'PasswordAuthentication no' 'KbdInteractiveAuthentication no' \
      'PermitRootLogin no' 'AllowUsers dev' 'X11Forwarding no' 'PermitTunnel no' \
      'AllowStreamLocalForwarding no' 'PermitUserEnvironment no' > /etc/ssh/sshd_config.d/orca.conf \
    && rm -f /etc/ssh/ssh_host_*

COPY --chmod=0755 orca-desktop-entrypoint orca-desktop-secrets /usr/local/sbin/
COPY --chmod=0755 orca-desktop-clone orca-desktop-launcher /usr/local/bin/

EXPOSE 22
ENTRYPOINT ["/usr/local/sbin/orca-desktop-entrypoint"]
```

### `orca-desktop-entrypoint`

Root supervisor inside the container: desktop ports held first, then sshd; rotates secrets in place.

```bash
#!/bin/bash
# Child of docker --init's tini, as root. Holds the desktop ports before anyone can log in: Xvnc
# (vnc) and the launcher (gui) start with throwaway secrets, and sshd starts only once both
# listen on loopback as their own users. orca-desktop-secrets then rotates the real secrets in
# place, without restarting either: the VNC password file is rewritten (Xvnc reads it on every
# authentication) and the launcher reads the new token from a pipe only root can write.
set -eu
umask 022

run_dir=/run/orca-desktop
control="$run_dir/secrets"
token_pipe="$run_dir/launcher-token"
geometry="${ORCA_DESKTOP_GEOMETRY:-1600x1000}"
gui_env=(DISPLAY=:1 XAUTHORITY=/home/gui/.Xauthority ORCA_DESKTOP_DEFAULT_CWD=/work)
# Direct commands (not functions) in the background, so $! is the program's own pid.
as_vnc=(setpriv --reuid=vnc --regid=vnc --init-groups --reset-env --)
as_gui=(setpriv --reuid=gui --regid=gui --init-groups --reset-env --)

install -d -o root -g root -m 0700 "$run_dir"
rm -f "$control" "$token_pipe" "$run_dir/ready" "$run_dir/failed"
mkfifo -m 0600 "$control" "$token_pipe"
# Root keeps the token pipe open read-write, so the launcher never sees end of file.
exec 4<>"$token_pipe"

xvnc_pid='' wm_pid='' launcher_pid='' sshd_pid=''

alive() { [ -n "$1" ] && kill -0 "$1" 2>/dev/null; }
random_secret() { head -c "$1" /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n' | cut -c1-"$2"; }

# Rewrites the VNC password file as vnc and proves it holds exactly this password.
write_vnc_password() {
  # shellcheck disable=SC2016 # $HOME expands in vnc's shell.
  printf '%s\n' "$1" | "${as_vnc[@]}" sh -c \
    'umask 077 && mkdir -p "$HOME/.vnc" && vncpasswd -f > "$HOME/.vnc/passwd.new" && mv -f "$HOME/.vnc/passwd.new" "$HOME/.vnc/passwd"' ||
    return 1
  # shellcheck disable=SC2016
  printf '%s\n' "$1" | "${as_vnc[@]}" sh -c 'vncpasswd -f | cmp -s - "$HOME/.vnc/passwd"'
}

write_cookies() {
  local cookie user
  cookie="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  [ "${#cookie}" -eq 32 ] || return 1
  for user in vnc gui; do
    # shellcheck disable=SC2016
    printf 'add :1 MIT-MAGIC-COOKIE-1 %s\n' "$cookie" |
      setpriv --reuid="$user" --regid="$user" --init-groups --reset-env -- sh -c \
        'umask 077 && rm -f "$HOME/.Xauthority" && xauth -q -f "$HOME/.Xauthority" source - && [ -s "$HOME/.Xauthority" ]' ||
      return 1
  done
}

# The listener on 127.0.0.1:<port> exists and belongs to <uid> (socket owner, from sock_diag).
listener_owned() { ss -Hltne "sport = :$1" | grep -q " 127\.0\.0\.1:$1 .* uid:$2 "; }

wait_until() { # <tenths of a second> <command...>
  local tries="$1"
  shift
  while [ "$tries" -gt 0 ]; do
    "$@" && return 0
    tries=$((tries - 1))
    sleep 0.1
  done
  return 1
}

start_xvnc() {
  "${as_vnc[@]}" Xvnc :1 -localhost -interface 127.0.0.1 -rfbport 5901 -nolisten tcp \
    -SecurityTypes VncAuth -PasswordFile /home/vnc/.vnc/passwd -auth /home/vnc/.Xauthority \
    -extension XTEST -geometry "$geometry" -depth 24 -desktop orca &
  xvnc_pid=$!
  wait_until 100 listener_owned 5901 "$(id -u vnc)" && wait_until 50 test -S /tmp/.X11-unix/X1
}

start_wm() {
  "${as_gui[@]}" env "${gui_env[@]}" fluxbox >/dev/null 2>&1 &
  wm_pid=$!
}

start_launcher() {
  "${as_gui[@]}" env "${gui_env[@]}" /usr/local/bin/orca-desktop-launcher <"$token_pipe" &
  launcher_pid=$!
  printf '%s\n' "$token" >&4 && wait_until 100 listener_owned 5902 "$(id -u gui)"
}

# The launcher answers the handshake with this token and runs a program as gui.
launcher_holds_token() {
  [ "$(printf '%s\n' "$token" | /usr/local/bin/orca-desktop-launcher --probe)" = \
    '{"result":"started","stdout":"gui\n","exit":0}' ]
}

shutdown() {
  local pid
  for pid in "$launcher_pid" "$wm_pid" "$xvnc_pid" "$sshd_pid"; do
    alive "$pid" && kill -TERM "$pid" 2>/dev/null || true
  done
  wait || true
  exit 0
}
trap shutdown TERM INT

# Boot: throwaway secrets nobody else knows, ports held, then sshd.
token="$(random_secret 48 43)"
if ! { write_vnc_password "$(random_secret 12 8)" && write_cookies && start_xvnc && start_wm &&
  start_launcher; }; then
  echo 'orca-desktop: the desktop did not start' >&2
  exit 1
fi
[ -s /etc/ssh/ssh_host_ed25519_key ] || ssh-keygen -A >/dev/null
install -d -m 0755 /run/sshd
/usr/sbin/sshd -D -e &
sshd_pid=$!

rotate() { # <password> <token>; nothing restarts
  write_vnc_password "$1" || return 1
  token="$2"
  printf '%s\n' "$token" >&4 || return 1
  wait_until 50 launcher_holds_token &&
    listener_owned 5901 "$(id -u vnc)" && listener_owned 5902 "$(id -u gui)"
}

valid_password() { [[ "$1" =~ ^[A-Za-z0-9_-]{6,8}$ ]]; }
valid_token() { [[ "$1" =~ ^[A-Za-z0-9_-]{32,256}$ ]]; }

exec 3<>"$control"
while true; do
  if IFS= read -r -t 5 password <&3; then
    IFS= read -r -t 5 new_token <&3 || new_token=''
    IFS= read -r -t 5 nonce <&3 || nonce=''
    if valid_password "$password" && valid_token "$new_token" && [ -n "$nonce" ] &&
      rotate "$password" "$new_token"; then
      printf '%s\n' "$nonce" >"$run_dir/ready"
    else
      echo 'orca-desktop: the new secrets were not installed' >&2
      printf '%s\n' "$nonce" >"$run_dir/failed"
    fi
    password='' new_token=''
    continue
  fi
  alive "$sshd_pid" || { echo 'orca-desktop: sshd exited' >&2; shutdown; }
  # A crashed piece restarts with the secrets it already has (see the reference's limits).
  if ! alive "$xvnc_pid"; then
    echo 'orca-desktop: Xvnc exited; restarting' >&2
    start_xvnc || true
  fi
  alive "$wm_pid" || start_wm
  if ! alive "$launcher_pid"; then
    echo 'orca-desktop: the launcher exited; restarting' >&2
    start_launcher || true
  fi
done
```

### `orca-desktop-secrets`

Root-only hand-off of the VNC password and launcher token from stdin to the entrypoint.

```bash
#!/bin/bash
# Runs as root via `docker exec -i -u root`. Reads the VNC password and the launcher token from
# stdin (one per line), hands them to the entrypoint through its root-only FIFO, and waits until
# the desktop holds them (the entrypoint proves both before it answers). Then it checks that the
# desktop ports still belong to vnc and gui. Secrets never appear in argv or in a file.
set -eu
run_dir=/run/orca-desktop
fifo="$run_dir/secrets"

IFS= read -r password
IFS= read -r token
nonce="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"

for _ in $(seq 1 100); do
  [ -p "$fifo" ] && break
  sleep 0.1
done
[ -p "$fifo" ] || { echo 'orca-desktop: the entrypoint is not running' >&2; exit 1; }

printf '%s\n%s\n%s\n' "$password" "$token" "$nonce" > "$fifo"
password='' token=''

for _ in $(seq 1 300); do
  if [ "$(cat "$run_dir/ready" 2>/dev/null)" = "$nonce" ]; then
    for owner in 5901:vnc 5902:gui; do
      port="${owner%:*}" uid="$(id -u "${owner#*:}")"
      ss -Hltne "sport = :$port" | grep -q " 127\.0\.0\.1:$port .* uid:$uid " ||
        { echo "orca-desktop: port $port is not held by ${owner#*:}" >&2; exit 1; }
    done
    exit 0
  fi
  if [ "$(cat "$run_dir/failed" 2>/dev/null)" = "$nonce" ]; then
    echo 'orca-desktop: the desktop did not take the new secrets' >&2
    exit 1
  fi
  sleep 0.1
done
echo 'orca-desktop: timed out waiting for the desktop' >&2
exit 1
```

### `orca-desktop-clone`

Clones the repo as `dev`, with the git token on stdin.

```bash
#!/bin/bash
# Runs as dev: orca-desktop-clone <url> <dest> [ref]. The first stdin line is the git token (may be
# empty); it reaches git only through a GIT_ASKPASS helper reading a 0600 file removed on exit.
set -eu
url="$1" dest="$2" ref="${3:-}"
IFS= read -r token || true

umask 077
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if [ -n "$token" ]; then
  printf '%s\n' "$token" > "$tmp/token"
  # shellcheck disable=SC2016 # $1 belongs to the helper script.
  printf '#!/bin/sh\ncase "$1" in Username*) echo x-access-token ;; *) cat %s ;; esac\n' \
    "$tmp/token" > "$tmp/askpass"
  chmod 0700 "$tmp/askpass"
  export GIT_ASKPASS="$tmp/askpass"
fi
token=''
export GIT_TERMINAL_PROMPT=0

# /work is setgid `work`: gui gets read/write on the checkout through the group.
umask 007
if [ -d "$dest/.git" ]; then
  git -C "$dest" fetch --quiet origin
else
  git clone --quiet -- "$url" "$dest"
fi
if [ -n "$ref" ]; then
  git -C "$dest" checkout --quiet "$ref"
fi
```

### `orca-desktop-launcher`

The launcher (`gui`): the handshake and JSON-lines protocol Orca uses for `orca desktop run`, plus the doctor probes.

```javascript
#!/usr/bin/env node
// Orca desktop launcher. Runs as `gui`, listens on 127.0.0.1:5902 and starts programs on the
// desktop for whoever proves the token (only the environment's Orca server). Each stdin line is a
// new token (root rotates it); it lives only in this process's memory and never crosses a
// connection. JSON lines, one TCP connection per program; nonces are 32 random bytes in hex and
// proofs hex HMAC-SHA256(token, "<label>|<nonce>|<nonce>"):
//   -> {"op":"hello","nonce":B}
//   <- {"nonce":L,"proof":HMAC("orca-launcher-server|B|L")}
//   -> {"op":"run","proof":HMAC("orca-launcher-client|L|B"),"argv":[...],"cwd"?,"env"?}
//   <- {"id"} | {"stream":"stdout"|"stderr","data"} ... | {"exit":<code>}  (signal death: 128 + n)
//   -> {"op":"kill","id"}   kills the run's process group
// A refusal replaces the id and closes: {"error":"bad_token"} or {"error":"<code>"}.
// `--probe` (doctor and entrypoint): token on stdin, runs `id -un`; prints one JSON result.
// `--vnc-probe` (doctor): checks that 127.0.0.1:5901 offers only VNC auth and refuses a wrong answer.
'use strict'
const net = require('node:net')
const crypto = require('node:crypto')
const os = require('node:os')
const { spawn } = require('node:child_process')

const HOST = '127.0.0.1'
const PORT = 5902
const VNC_PORT = 5901
const MAX_LINE_CHARS = 1024 * 1024
const MAX_RUNS = 64
const KILL_GRACE_MS = 5000
const NONCE = /^[0-9a-f]{64}$/

const newNonce = () => crypto.randomBytes(32).toString('hex')
const proof = (token, label, first, second) =>
  crypto.createHmac('sha256', token).update(`${label}|${first}|${second}`).digest('hex')
const proofMatches = (expected, received) =>
  typeof received === 'string' &&
  received.length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))

function lineSplitter(onLine, onOverflow) {
  let pending = ''
  return (chunk) => {
    pending += chunk
    let newline = pending.indexOf('\n')
    while (newline !== -1) {
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      if (line.length > MAX_LINE_CHARS) return onOverflow()
      if (line.trim() !== '') onLine(line)
      newline = pending.indexOf('\n')
    }
    if (pending.length > MAX_LINE_CHARS) onOverflow()
  }
}

function isStringRecord(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  )
}

function serve() {
  let token = ''
  let listening = false
  let running = 0
  const baseEnv = {
    HOME: process.env.HOME,
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    SHELL: '/bin/bash',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
    DISPLAY: process.env.DISPLAY,
    XAUTHORITY: process.env.XAUTHORITY,
    // Chromium's SUID sandbox cannot start under no-new-privileges; the container is the boundary.
    ELECTRON_DISABLE_SANDBOX: '1'
  }
  const defaultCwd = process.env.ORCA_DESKTOP_DEFAULT_CWD || process.env.HOME || '/'

  const server = net.createServer((socket) => {
    socket.setEncoding('utf8')
    socket.on('error', () => {})
    // Each connection is bound to the token current when it said hello.
    let session = null
    let child = null
    let runId = null
    let refused = false
    let exited = false
    const send = (message) => socket.writable && socket.write(`${JSON.stringify(message)}\n`)
    const refuse = (code) => {
      if (refused) return
      refused = true
      send({ error: code })
      socket.end()
    }
    const killGroup = () => {
      if (!child || exited) return
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {}
      setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {}
      }, KILL_GRACE_MS).unref()
    }

    const start = (request) => {
      const { argv, cwd, env } = request
      if (
        !Array.isArray(argv) ||
        argv.length === 0 ||
        !argv.every((part) => typeof part === 'string') ||
        (cwd !== undefined && typeof cwd !== 'string') ||
        (env !== undefined && !isStringRecord(env))
      ) {
        return refuse('bad_request')
      }
      if (running >= MAX_RUNS) return refuse('too_many_runs')
      runId = crypto.randomUUID()
      running++
      child = spawn(argv[0], argv.slice(1), {
        cwd: cwd || defaultCwd,
        env: { ...baseEnv, ...env },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let spawned = false
      child.once('error', () => {
        if (!spawned) {
          exited = true
          running--
          refuse('spawn_failed')
        }
      })
      child.once('spawn', () => {
        spawned = true
        send({ id: runId })
        let waitingForDrain = false
        for (const stream of ['stdout', 'stderr']) {
          child[stream].setEncoding('utf8')
          child[stream].on('data', (data) => {
            // TCP is the flow control: stop reading the program while the client is behind.
            if (send({ stream, data }) === false && !waitingForDrain) {
              waitingForDrain = true
              child.stdout.pause()
              child.stderr.pause()
              socket.once('drain', () => {
                waitingForDrain = false
                child.stdout.resume()
                child.stderr.resume()
              })
            }
          })
        }
      })
      child.once('close', (code, signal) => {
        if (!spawned) return
        exited = true
        running--
        send({ exit: code ?? 128 + (os.constants.signals[signal] ?? 0) })
        socket.end()
      })
    }

    const onLine = (line) => {
      if (refused) return
      let request
      try {
        request = JSON.parse(line)
      } catch {
        return runId ? undefined : refuse('bad_request')
      }
      if (request === null || typeof request !== 'object')
        return runId ? undefined : refuse('bad_request')
      if (!session) {
        if (
          request.op !== 'hello' ||
          typeof request.nonce !== 'string' ||
          !NONCE.test(request.nonce)
        ) {
          return refuse('bad_request')
        }
        session = { token, broker: request.nonce, launcher: newNonce() }
        send({
          nonce: session.launcher,
          proof: proof(session.token, 'orca-launcher-server', session.broker, session.launcher)
        })
        return
      }
      if (!runId) {
        const expected = proof(
          session.token,
          'orca-launcher-client',
          session.launcher,
          session.broker
        )
        if (request.op !== 'run' || !proofMatches(expected, request.proof))
          return refuse('bad_token')
        return start(request)
      }
      if (request.op === 'kill' && request.id === runId) killGroup()
    }
    socket.on(
      'data',
      lineSplitter(onLine, () => {
        refuse('bad_request')
        socket.destroy()
      })
    )
    // A run whose client went away is killed with its whole process group.
    socket.once('close', killGroup)
  })
  server.on('error', (error) => {
    process.stderr.write(`orca-desktop-launcher: ${error.code || 'listen failed'}\n`)
    process.exit(1)
  })

  process.stdin.setEncoding('utf8')
  process.stdin.on(
    'data',
    lineSplitter(
      (line) => {
        const next = line.trim()
        if (next.length < 32) return
        token = next
        if (!listening) {
          listening = true
          server.listen(PORT, HOST)
        }
      },
      () => {}
    )
  )
  process.stdin.on('end', () => process.exit(1))
}

function readStdinLine() {
  return new Promise((resolve) => {
    let text = ''
    process.stdin.setEncoding('utf8')
    const done = () => {
      process.stdin.removeAllListeners()
      process.stdin.destroy()
      resolve(text.split('\n')[0].trim())
    }
    process.stdin.on('data', (chunk) => {
      text += chunk
      if (text.includes('\n') || text.length > 4096) done()
    })
    process.stdin.on('end', done)
    process.stdin.on('error', done)
  })
}

// Results: started (with stdout and exit), rejected (the launcher refused our proof),
// server_proof_mismatch (the listener proved a different token), unreachable, protocol_error.
// An empty token skips checking the listener and sends a proof made with no token.
function probe(token) {
  const socket = net.connect({ host: HOST, port: PORT })
  const result = { result: 'unknown', stdout: '' }
  const broker = newNonce()
  let authenticated = false
  const finish = () => {
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exit(0)
  }
  socket.setEncoding('utf8')
  socket.on('error', () => {
    result.result = 'unreachable'
    finish()
  })
  socket.on('close', finish)
  socket.on(
    'data',
    lineSplitter(
      (line) => {
        let reply
        try {
          reply = JSON.parse(line)
        } catch {
          result.result = 'protocol_error'
          return socket.destroy()
        }
        if (!authenticated && typeof reply.nonce === 'string') {
          if (
            token &&
            !proofMatches(proof(token, 'orca-launcher-server', broker, reply.nonce), reply.proof)
          ) {
            result.result = 'server_proof_mismatch'
            return socket.destroy()
          }
          authenticated = true
          const key = token || crypto.randomBytes(32).toString('hex')
          socket.write(
            `${JSON.stringify({ op: 'run', proof: proof(key, 'orca-launcher-client', reply.nonce, broker), argv: ['id', '-un'] })}\n`
          )
        } else if (reply.error === 'bad_token') result.result = 'rejected'
        else if (typeof reply.error === 'string') result.result = `refused:${reply.error}`
        else if (typeof reply.id === 'string') result.result = 'started'
        else if (reply.stream === 'stdout') result.stdout += reply.data
        else if (typeof reply.exit === 'number') result.exit = reply.exit
      },
      () => socket.destroy()
    )
  )
  socket.once('connect', () => socket.write(`${JSON.stringify({ op: 'hello', nonce: broker })}\n`))
  setTimeout(finish, 10000).unref()
}

// RFB 3.8: the server must offer only VNC authentication (2) and refuse a random response.
function vncProbe() {
  const socket = net.connect({ host: HOST, port: VNC_PORT })
  const result = { types: null, auth: 'unknown' }
  let buffer = Buffer.alloc(0)
  let stage = 'version'
  const finish = () => {
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exit(0)
  }
  socket.on('error', () => {
    result.auth = 'unreachable'
    finish()
  })
  socket.on('close', finish)
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    if (stage === 'version' && buffer.length >= 12) {
      buffer = buffer.subarray(12)
      socket.write('RFB 003.008\n')
      stage = 'types'
    }
    if (stage === 'types' && buffer.length >= 1 && buffer.length >= 1 + buffer[0]) {
      result.types = [...buffer.subarray(1, 1 + buffer[0])]
      buffer = buffer.subarray(1 + buffer[0])
      if (!result.types.includes(2)) return socket.destroy()
      socket.write(Buffer.from([2]))
      stage = 'challenge'
    }
    if (stage === 'challenge' && buffer.length >= 16) {
      buffer = buffer.subarray(16)
      socket.write(crypto.randomBytes(16))
      stage = 'result'
    }
    if (stage === 'result' && buffer.length >= 4) {
      result.auth = buffer.readUInt32BE(0) === 0 ? 'accepted' : 'refused'
      socket.destroy()
    }
  })
  setTimeout(finish, 10000).unref()
}

process.umask(0o002)
if (process.argv[2] === '--probe') readStdinLine().then(probe)
else if (process.argv[2] === '--vnc-probe') vncProbe()
else serve()
```

### `orca-docker-desktop.sh`

Shared by the recipe scripts: Docker over SSH, image, `docker run` flags, secrets, JSON.

```bash
# shellcheck shell=bash disable=SC2016 # single quotes hold JavaScript and remote shell text.
# Sourced by the recipe scripts after they set `here`. Runs Docker on $ORCA_DOCKER_HOST over SSH, or
# locally when it is empty. Every script keeps stdout for its JSON; progress goes to stderr.

: "${here:?set here to the scripts directory before sourcing}"

# Non-secret settings may live in docker-desktop.env next to the scripts (KEY=value lines, read, not
# sourced); variables already set in the environment win.
if [ -f "$here/docker-desktop.env" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      ORCA_DOCKER_* | ORCA_DESKTOP_*) [ -n "${!key+x}" ] || export "$key=$value" ;;
    esac
  done <"$here/docker-desktop.env"
fi

docker_host="${ORCA_DOCKER_HOST:-}"
docker_bin="${ORCA_DOCKER_BIN:-docker}"
agent="${ORCA_DESKTOP_AGENT:-codex}"
ssh_key="${ORCA_DESKTOP_SSH_KEY:-$here/id_ed25519}"
known_hosts="${ORCA_DESKTOP_KNOWN_HOSTS:-$HOME/.ssh/known_hosts}"
image_files=(Dockerfile orca-desktop-entrypoint orca-desktop-secrets orca-desktop-clone orca-desktop-launcher)

log() { printf 'orca-docker-desktop: %s\n' "$*" >&2; }
die() {
  log "$*"
  exit 1
}

shell_quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

dk() {
  if [ -z "$docker_host" ]; then
    "$docker_bin" "$@"
    return
  fi
  local command arg
  command="$(shell_quote "$docker_bin")"
  for arg in "$@"; do
    command+=" $(shell_quote "$arg")"
  done
  ssh -T -o BatchMode=yes -- "$docker_host" "$command"
}

sha256_hex() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi | cut -d' ' -f1
}

image_hash() {
  local file
  for file in "${image_files[@]}"; do
    printf '%s\0' "$file"
    cat "$here/$file"
    printf '\0'
  done | sha256_hex | cut -c1-20
}

base_image="orca-desktop:$(image_hash)"
auth_image="orca-desktop-auth:$(image_hash)-$agent"

ensure_base_image() {
  if dk image inspect "$base_image" >/dev/null 2>&1; then
    return
  fi
  log "building $base_image (once per Dockerfile hash)"
  # A gzipped ustar stream is unambiguous build context (no macOS xattr entries, owner 0).
  local owner=(--owner=0 --group=0)
  tar --version 2>/dev/null | grep -q bsdtar && owner=(--uid 0 --gid 0)
  COPYFILE_DISABLE=1 tar -C "$here" --format=ustar "${owner[@]}" -cf - "${image_files[@]}" |
    gzip -c | dk build --label orca.desktop=base -t "$base_image" - >&2
}

pick_image() {
  if dk image inspect "$auth_image" >/dev/null 2>&1; then
    printf '%s\n' "$auth_image"
  else
    log "no $auth_image yet; using $base_image, so $agent starts signed out (run auth.sh)"
    printf '%s\n' "$base_image"
  fi
}

container_name() {
  printf 'orca-desktop-%s' "$(printf '%s' "$1" | LC_ALL=C tr -c 'A-Za-z0-9_.-' '-' | cut -c1-48)"
}

# >>> docker run flags (doctor-extra.sh refuses anything weaker; never add a mount or host namespace)
docker_run_args() { # <name> <label key=value> <image>; sets run_args for the caller
  # shellcheck disable=SC2034
  run_args=(run -d --name "$1" --hostname orca-desktop
    --label "$2"
    --init --security-opt no-new-privileges --cap-drop ALL
    --cap-add CHOWN --cap-add SETUID --cap-add SETGID --cap-add AUDIT_WRITE
    --cap-add SYS_CHROOT --cap-add KILL
    --cpus "${ORCA_DESKTOP_CPUS:-2}" --memory "${ORCA_DESKTOP_MEMORY:-4g}"
    --pids-limit "${ORCA_DESKTOP_PIDS:-2048}"
    -p 127.0.0.1:0:22
    "$3")
}
# <<< docker run flags

check_ptrace_scope() { # <image>
  local scope
  scope="$(dk run --rm --network none --cap-drop ALL --security-opt no-new-privileges \
    --entrypoint cat "$1" /proc/sys/kernel/yama/ptrace_scope 2>/dev/null || true)"
  case "$scope" in
    1 | 2 | 3) ;;
    *) die "kernel.yama.ptrace_scope on the Docker host is '${scope:-unknown}'; it must be 1 or more so the agent cannot read the Orca server's memory. See the reference's setup section." ;;
  esac
}

label_of() { dk container inspect -f '{{index .Config.Labels "orca.workspace"}}' "$1" 2>/dev/null; }

# Sets container_id; empty only when Docker confirms there is no such container. Any other
# failure (Docker or SSH down) stops the script instead of passing for "already gone".
# shellcheck disable=SC2034 # container_id is read by the caller.
lookup_container() {
  local out
  if out="$(dk container inspect -f '{{.Id}}' "$1" 2>&1)"; then
    container_id="$out"
    return
  fi
  case "$out" in
    *'No such container'* | *'No such object'*) container_id='' ;;
    *) die "cannot inspect $1: $out" ;;
  esac
}

require_label() { # <name> <expected instance id or empty>
  local label
  label="$(label_of "$1")" || die "container $1 does not exist"
  [ -n "$label" ] || die "refusing to touch $1: it has no orca.workspace label"
  [ -z "$2" ] || [ "$label" = "$2" ] || die "refusing to touch $1: labeled for $label, not $2"
}

read_payload() { payload="$(cat)"; }

payload_value() { # <JS expression over d, the lifecycle payload>
  printf '%s' "${payload:-}" | node -e '
let text = ""
process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
  const d = text.trim() ? JSON.parse(text) : {}
  const value = (() => { try { return ('"$1"') } catch { return undefined } })()
  process.stdout.write(value === undefined || value === null ? "" : String(value))
})'
}

resolve_lifecycle_target() {
  instance_id="$(payload_value 'd.instanceId')"
  instance_id="${instance_id:-${ORCA_VM_INSTANCE_ID:-}}"
  name="$(payload_value 'd.recipeResult.userData.resourceId')"
  if [ -z "$name" ]; then
    [ -n "$instance_id" ] || die 'no resourceId or instanceId in the lifecycle payload'
    name="$(container_name "$instance_id")"
  fi
}

ensure_ssh_key() {
  [ -f "$ssh_key" ] || ssh-keygen -q -t ed25519 -N '' -C orca-docker-desktop -f "$ssh_key" >&2
}

container_ssh_port() {
  dk port "$1" 22/tcp | sed -n 's/^127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' | head -n 1
}

container_host_key() {
  local key
  for _ in $(seq 1 100); do
    key="$(dk exec -u root "$1" cat /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null || true)"
    if [ -n "$key" ]; then
      printf '%s\n' "$key" | cut -d' ' -f1,2
      return
    fi
    sleep 0.2
  done
  die "container $1 has no SSH host key"
}

authorize_ssh_key() {
  dk exec -i -u dev "$1" sh -c \
    'umask 077 && mkdir -p "$HOME/.ssh" && cat > "$HOME/.ssh/authorized_keys"' <"$ssh_key.pub"
}

record_known_host() { # <port> <key>
  mkdir -p "$(dirname "$known_hosts")"
  touch "$known_hosts"
  ssh-keygen -R "[127.0.0.1]:$1" -f "$known_hosts" >/dev/null 2>&1 || true
  printf '[127.0.0.1]:%s %s\n' "$1" "$2" >>"$known_hosts"
}

forget_known_host() { # <port> <key>; only while the entry is still this container's key
  [ -n "$1" ] && [ -n "$2" ] && [ -f "$known_hosts" ] || return 0
  if ssh-keygen -F "[127.0.0.1]:$1" -f "$known_hosts" 2>/dev/null | grep -qF "$2"; then
    ssh-keygen -R "[127.0.0.1]:$1" -f "$known_hosts" >/dev/null 2>&1 || true
  fi
}

remove_container() { # <name> [ssh port]; also forgets its known_hosts entry
  local port="${2:-}" key
  [ -n "$port" ] || port="$(container_ssh_port "$1" 2>/dev/null || true)"
  key="$(dk cp "$1:/etc/ssh/ssh_host_ed25519_key.pub" - 2>/dev/null | tar -xOf - 2>/dev/null | cut -d' ' -f1,2 || true)"
  dk rm -f "$1" >/dev/null
  forget_known_host "$port" "$key"
}

new_desktop_secrets() {
  password="$(node -e 'process.stdout.write(require("crypto").randomBytes(6).toString("base64url"))')"
  token="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')"
}

send_desktop_secrets() { # <name>; restarts the desktop with $password and $token, both over stdin
  printf '%s\n%s\n' "$password" "$token" |
    dk exec -i -u root "$1" /usr/local/sbin/orca-desktop-secrets >&2
}

emit_result() { # <name> <ssh port> <project root> <instance id>
  printf '%s\n%s\n' "$password" "$token" | node -e '
const [name, port, projectRoot, instanceId, dockerHost, identityFile] = process.argv.slice(1)
let text = ""
process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
  const [password, token] = text.split("\n")
  const target = { label: name, host: "127.0.0.1", port: Number(port), username: "dev", identityFile, identitiesOnly: true }
  if (dockerHost) target.jumpHost = dockerHost
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    connection: { type: "ssh", target, projectRoot },
    userData: { provider: "docker-desktop", resourceId: name, instanceId, dockerHost },
    desktop: { type: "vnc", host: "127.0.0.1", port: 5901, password, launcher: { port: 5902, token } }
  })}\n`)
})' "$1" "$2" "$3" "$4" "$docker_host" "$ssh_key"
}
```

### `create.sh`

Recipe `create`.

```bash
#!/usr/bin/env bash
# Recipe `create`: one hardened desktop container per workspace. Prints only the recipe JSON.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=orca-docker-desktop.sh
. "$here/orca-docker-desktop.sh"

instance_id="${ORCA_VM_INSTANCE_ID:-}"
[ -n "$instance_id" ] || die 'ORCA_VM_INSTANCE_ID is empty'
[ "${ORCA_RECIPE_RESULT_SCHEMA_VERSION:-1}" = 1 ] || die 'this recipe does not support provisioned-root'
name="$(container_name "$instance_id")"

repo_url="${ORCA_DESKTOP_REPO_URL:-${ORCA_REPO_URL:-}}"
[ -n "$repo_url" ] || repo_url="$(git -C "${ORCA_REPO_PATH:-.}" remote get-url origin)"
repo_name="$(basename "${repo_url%/}" .git)"
repo_name="$(printf '%s' "$repo_name" | LC_ALL=C tr -c 'A-Za-z0-9_.-' '-')"
project_root="/work/$repo_name"

git_token() {
  case "$repo_url" in
    https://*) printf '%s\n' "${GH_TOKEN:-${GITHUB_TOKEN:-$(gh auth token 2>/dev/null || true)}}" ;;
    *) printf '\n' ;;
  esac
}

ensure_base_image
image="$(pick_image)"
check_ptrace_scope "$image"
ensure_ssh_key

lookup_container "$name"
if [ -n "$container_id" ]; then
  require_label "$container_id" "$instance_id"
  log "replacing the unfinished container $name"
  remove_container "$container_id"
fi

docker_run_args "$name" "orca.workspace=$instance_id" "$image"
container_id="$(dk "${run_args[@]}")"
[ -n "$container_id" ] || die "docker run returned no container id for $name"
# Cleanup is armed only now and removes by id: a create that lost the name never touches the winner.
finished=0
trap '[ "$finished" = 1 ] || remove_container "$container_id" 2>/dev/null || true' EXIT
port="$(container_ssh_port "$container_id")"
[ -n "$port" ] || die "container $name published no loopback SSH port"
record_known_host "$port" "$(container_host_key "$container_id")"
authorize_ssh_key "$container_id"

log "cloning $repo_url into $project_root"
git_token | dk exec -i -u dev "$container_id" /usr/local/bin/orca-desktop-clone \
  "$repo_url" "$project_root" "${ORCA_DESKTOP_REPO_REF:-}" >&2

new_desktop_secrets
send_desktop_secrets "$container_id"
emit_result "$name" "$port" "$project_root" "$instance_id"
finished=1
```

### `suspend.sh`

Recipe `suspend`.

```bash
#!/usr/bin/env bash
# Recipe `suspend`: stops the container and keeps its state. Lifecycle payload on stdin.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=orca-docker-desktop.sh
. "$here/orca-docker-desktop.sh"

read_payload
resolve_lifecycle_target
require_label "$name" "$instance_id"
dk stop "$name" >/dev/null
log "stopped $name"
```

### `resume.sh`

Recipe `resume`.

```bash
#!/usr/bin/env bash
# Recipe `resume`: starts the stopped container, renews the VNC password and the launcher token,
# and prints the full recipe JSON again (the SSH port can change across a restart).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=orca-docker-desktop.sh
. "$here/orca-docker-desktop.sh"

read_payload
resolve_lifecycle_target
require_label "$name" "$instance_id"
project_root="$(payload_value 'd.recipeResult.connection.projectRoot')"
[ -n "$project_root" ] || die 'no projectRoot in the lifecycle payload'

previous_port="$(payload_value 'd.recipeResult.connection.target.port')"

dk start "$name" >/dev/null
port="$(container_ssh_port "$name")"
[ -n "$port" ] || die "container $name published no loopback SSH port"
key="$(container_host_key "$name")"
forget_known_host "$previous_port" "$key"
record_known_host "$port" "$key"

new_desktop_secrets
send_desktop_secrets "$name"
emit_result "$name" "$port" "$project_root" "$instance_id"
```

### `destroy.sh`

Recipe `destroy`.

```bash
#!/usr/bin/env bash
# Recipe `destroy`: removes the workspace's container, and only a container labeled orca.workspace.
# Lifecycle payload on stdin; without a recipe result it falls back to ORCA_VM_INSTANCE_ID.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=orca-docker-desktop.sh
. "$here/orca-docker-desktop.sh"

read_payload
resolve_lifecycle_target
lookup_container "$name"
if [ -z "$container_id" ]; then
  log "$name is already gone"
  exit 0
fi
require_label "$container_id" "$instance_id"

remove_container "$container_id" "$(payload_value 'd.recipeResult.connection.target.port')"
log "removed $name"
```

### `stats.sh`

Recipe `stats`, for when Orca reads that step.

```bash
#!/usr/bin/env bash
# shellcheck disable=SC2016 # single quotes hold JavaScript and remote shell text.
# Recipe `stats` (wired by a later Orca version): prints {cpuPercent, memoryBytes, diskBytes} for the
# workspace's container. diskBytes is the container's writable layer. Lifecycle payload on stdin.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=orca-docker-desktop.sh
. "$here/orca-docker-desktop.sh"

read_payload
resolve_lifecycle_target
require_label "$name" "$instance_id"

usage="$(dk stats --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}' "$name")"
disk="$(dk container inspect --size -f '{{.SizeRw}}' "$name")"
node -e '
const [usage, disk] = process.argv.slice(1)
const [cpu, memory] = usage.split("|")
const units = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4 }
const bytes = (text) => {
  const match = /^([\d.]+)\s*([A-Za-z]+)$/.exec(text.trim())
  return match ? Math.round(Number(match[1]) * (units[match[2].toUpperCase()] ?? 0)) : 0
}
process.stdout.write(`${JSON.stringify({
  cpuPercent: Math.max(0, Number.parseFloat(cpu) || 0),
  memoryBytes: bytes(memory.split("/")[0]),
  diskBytes: Math.max(0, Number.parseInt(disk, 10) || 0)
})}\n`)' "$usage" "$disk"
```

### `auth.sh`

Hand-run, interactive: commits the signed-in auth image.

```bash
#!/usr/bin/env bash
# Run by hand, in a terminal: starts the base image, waits while you sign the agent in, verifies the
# login and commits orca-desktop-auth:<hash>-<agent>, which create.sh then prefers.
# ORCA_DESKTOP_AGENT picks the agent: codex (default) or claude.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=orca-docker-desktop.sh
. "$here/orca-docker-desktop.sh"

case "$agent" in
  codex) login_command='codex login --device-auth' status_command='codex login status' ;;
  claude) login_command='claude auth login' status_command='claude auth status' ;;
  *) die "unknown ORCA_DESKTOP_AGENT '$agent' (codex or claude)" ;;
esac
{ : </dev/tty; } 2>/dev/null || die 'auth.sh is interactive; run it in a terminal'

ensure_base_image
name="orca-desktop-auth-$agent-$$"
trap 'dk rm -f "$name" >/dev/null 2>&1 || true' EXIT
# Its own label: `docker commit` copies labels into the image, and orca.workspace is per workspace.
docker_run_args "$name" "orca.desktop.auth=$agent" "$base_image"
dk "${run_args[@]}" >/dev/null

exec_prefix=''
[ -z "$docker_host" ] || exec_prefix="ssh -t $(shell_quote "$docker_host") "
log 'In another terminal, sign the agent in with:'
printf '\n  %s%s exec -it -u dev %s %s\n\n' "$exec_prefix" "$docker_bin" "$name" "$login_command" >&2
log 'Press Enter here once the login finished.'
read -r _ </dev/tty

dk exec -u dev "$name" sh -c "$status_command" >&2 || die "$agent is not signed in; nothing was committed"
# Every container must generate its own host keys; never ship this one's.
dk exec -u root "$name" sh -c 'rm -f /etc/ssh/ssh_host_*'
dk stop "$name" >/dev/null
dk commit "$name" "$auth_image" >/dev/null
log "committed $auth_image; new workspaces start signed in"
```

### `doctor-extra.sh`

Security checks on top of `orca vm recipe doctor`.

```bash
#!/usr/bin/env bash
# shellcheck disable=SC2016 # single quotes hold JavaScript and remote shell text.
# Security checks for this recipe, on top of `orca vm recipe doctor`.
#   doctor-extra.sh [--known ID]...                  provisions a throwaway environment with
#                                                    create.sh, runs every check, destroys it
#   doctor-extra.sh --container NAME [--known ID]... checks a running environment (no secret checks)
# --known names an instance id Orca still lists (Settings > VMs); other labeled containers are
# reported as orphans. Every denial must show the expected refusal, not just any failure; secrets
# never enter a process run as dev or gui. Exit status 1 when any check fails.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=orca-docker-desktop.sh
. "$here/orca-docker-desktop.sh"

container='' known=() failures=0 password='' token='' instance=''
while [ $# -gt 0 ]; do
  case "$1" in
    --container) container="$2" && shift 2 ;;
    --known) known+=("$2") && shift 2 ;;
    *) die "unknown argument $1" ;;
  esac
done

work="$(mktemp -d)"
cleanup() {
  rm -rf "$work"
  if [ -n "$instance" ]; then
    printf '{"instanceId":"%s"}' "$instance" | "$here/destroy.sh" || true
  fi
}
trap cleanup EXIT

report() { # <pass|FAIL|warn> <id> <message>
  printf '%-4s  %-26s %s\n' "$1" "$2" "$3"
  [ "$1" != FAIL ] || failures=$((failures + 1))
}
check() { # <id> <message> <command...>
  local id="$1" message="$2"
  shift 2
  if "$@"; then report pass "$id" "$message"; else report FAIL "$id" "$message"; fi
}

as() { # <user> <command...>, in the container
  local user="$1"
  shift
  dk exec -u "$user" "$container" "$@"
}

# The command ran as <user>, failed, and said <refusal>; a Docker or exec error does not count.
refused() { # <refusal text> <user> <command...>
  local refusal="$1" output
  shift
  if output="$(as "$@" 2>&1)"; then
    printf '  unexpectedly succeeded: %s\n' "$output" >&2
    return 1
  fi
  case "$output" in
    *"$refusal"*) return 0 ;;
    *) printf '  failed without "%s": %s\n' "$refusal" "$output" >&2 && return 1 ;;
  esac
}

# 1 when neither secret is in <file>, 0 when one is, anything else when grep failed.
secrets_absent_from() {
  local status=0
  printf '%s\n%s\n' "$password" "$token" | grep -aqF -f /dev/stdin "$1" || status=$?
  [ "$status" -eq 1 ] || { [ "$status" -eq 0 ] && printf '  a secret is in %s\n' "$(basename "$1")" >&2; return 1; }
}

template_flags_ok() {
  local block required refused_anywhere='--privileged|docker\.sock|--(net|network|pid|ipc|uts|userns|cgroupns)[ =]+"?host|unconfined'
  block="$(sed -n '/^# >>> docker run flags/,/^# <<< docker run flags/p' "$here/orca-docker-desktop.sh")"
  [ -n "$block" ] || return 1
  ! grep -Eq -- "(^|[[:space:]])(-v|--volume|--mount|--device|--volumes-from)([ =]|$)|/Users|\\\$HOME|--cap-add[ =]+\"?(ALL|SYS_ADMIN|SYS_PTRACE|SYS_MODULE|NET_ADMIN|DAC_READ_SEARCH|DAC_OVERRIDE)" <<<"$block" || return 1
  for required in '--init' 'no-new-privileges' '--cap-drop ALL' '--pids-limit' '--memory' '--cpus' '127.0.0.1:0:22'; do
    grep -qF -- "$required" <<<"$block" || return 1
  done
  ! grep -Eq -- "$refused_anywhere" "$here"/create.sh "$here"/resume.sh "$here"/auth.sh "$here"/orca-docker-desktop.sh
}

host_config_ok() {
  dk container inspect "$container" | node -e '
let text = ""
process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
  const [info] = JSON.parse(text)
  const h = info.HostConfig
  const allowedCaps = ["CHOWN", "SETUID", "SETGID", "AUDIT_WRITE", "SYS_CHROOT", "KILL"]
  const bare = (cap) => cap.replace(/^CAP_/, "")
  const problems = []
  if (h.Privileged) problems.push("privileged")
  for (const mode of ["NetworkMode", "PidMode", "IpcMode", "UTSMode", "UsernsMode", "CgroupnsMode"])
    if (h[mode] === "host") problems.push(`${mode}=host`)
  if ((h.Binds ?? []).length || (info.Mounts ?? []).length) problems.push("mounts")
  if ((h.Devices ?? []).length) problems.push("devices")
  if (!(h.CapDrop ?? []).map(bare).includes("ALL")) problems.push("cap-drop ALL missing")
  const extra = (h.CapAdd ?? []).map(bare).filter((cap) => !allowedCaps.includes(cap))
  if (extra.length) problems.push(`cap-add ${extra.join(",")}`)
  const opts = h.SecurityOpt ?? []
  if (!opts.some((opt) => /^no-new-privileges(:true|=true)?$/.test(opt))) problems.push("no-new-privileges missing")
  if (opts.some((opt) => opt.includes("unconfined"))) problems.push("unconfined profile")
  if (h.Init !== true) problems.push("init missing")
  if (!(h.PidsLimit > 0) || !(h.Memory > 0) || !(h.NanoCpus > 0)) problems.push("resource limits missing")
  for (const [port, bindings] of Object.entries(h.PortBindings ?? {}))
    if (port !== "22/tcp" || (bindings ?? []).some((b) => b.HostIp !== "127.0.0.1")) problems.push(`published ${port}`)
  if (!info.Config.Labels?.["orca.workspace"]) problems.push("orca.workspace label missing")
  if (problems.length) {
    process.stderr.write(`  ${problems.join("; ")}\n`)
    process.exit(1)
  }
})'
}

ptrace_scope_ok() { [ "$(as root cat /proc/sys/kernel/yama/ptrace_scope)" -ge 1 ]; }

dev_groups_ok() { [ "$(as root id -nG dev)" = 'dev work' ]; }

no_sudo_or_xdotool() {
  [ "$(as root sh -c 'command -v sudo || echo no-sudo; command -v xdotool || echo no-xdotool')" = \
    "$(printf 'no-sudo\nno-xdotool')" ]
}

# Bound to 127.0.0.1 (or ::1) only, and owned by the right user (socket uid from sock_diag).
desktop_ports_held() {
  as root ss -Hltne >"$work/listen"
  grep -Eq " 127\.0\.0\.1:5901 .* uid:$(as root id -u vnc) " "$work/listen" &&
    grep -Eq " 127\.0\.0\.1:5902 .* uid:$(as root id -u gui) " "$work/listen" &&
    ! grep -E ' [^ ]*:590[12] ' "$work/listen" | grep -Evq ' (127\.0\.0\.1|\[::1\]):590[12] '
}

gui_opens_display() {
  dk exec -u gui -e DISPLAY=:1 -e XAUTHORITY=/home/gui/.Xauthority "$container" xdpyinfo >/dev/null
}
dev_cannot_open_display() {
  dk exec -u dev -e DISPLAY=:1 "$container" xdpyinfo >"$work/xdpyinfo" 2>&1 && return 1
  grep -q 'unable to open display' "$work/xdpyinfo"
}
dev_cannot_read_cookie() { refused 'Permission denied' dev cat /home/gui/.Xauthority; }
dev_cannot_list_x_sockets() { refused 'Permission denied' dev ls /tmp/.X11-unix; }

vnc_password_file_private() {
  [ "$(as vnc stat -c '%U %a' /home/vnc/.vnc/passwd)" = 'vnc 600' ] &&
    refused 'Permission denied' dev cat /home/vnc/.vnc/passwd &&
    refused 'Permission denied' gui cat /home/vnc/.vnc/passwd
}

vnc_refuses_wrong_answer() {
  [ "$(as dev /usr/local/bin/orca-desktop-launcher --vnc-probe)" = '{"types":[2],"auth":"refused"}' ]
}

launcher_probe() { # <user>; stdin: token line
  dk exec -i -u "$1" "$container" /usr/local/bin/orca-desktop-launcher --probe
}
launcher_refuses_dev() {
  [ "$(printf '\n' | launcher_probe dev)" = '{"result":"rejected","stdout":""}' ] &&
    [ "$(printf 'not-the-token-not-the-token-not-the-token\n' | launcher_probe dev)" = \
      '{"result":"server_proof_mismatch","stdout":""}' ]
}
launcher_runs_as_gui_for_root() {
  [ "$(printf '%s\n' "$token" | launcher_probe root)" = '{"result":"started","stdout":"gui\n","exit":0}' ]
}

secrets_not_in_inspect() {
  dk container inspect "$container" >"$work/inspect"
  secrets_absent_from "$work/inspect"
}

secrets_not_in_processes() {
  local user
  # This machine (where create.sh ran) and, when remote, the Docker host.
  ps -A -ww -o args >"$work/host-ps"
  if [ -n "$docker_host" ]; then
    ssh -T -o BatchMode=yes -- "$docker_host" ps -A -ww -o args >>"$work/host-ps"
  fi
  as root ps -A -ww -o args >"$work/container-ps"
  for user in root vnc gui dev; do
    # Each user reads its own processes' environments (root lacks CAP_SYS_PTRACE for the others).
    as "$user" sh -c \
      'for f in /proc/[0-9]*/environ /proc/[0-9]*/cmdline; do { tr "\0" "\n" < "$f"; } 2>/dev/null; done' \
      >"$work/proc-$user"
    [ -s "$work/proc-$user" ] || return 1
  done
  [ -s "$work/host-ps" ] && [ -s "$work/container-ps" ] &&
    secrets_absent_from "$work/host-ps" && secrets_absent_from "$work/container-ps" &&
    for user in root vnc gui dev; do secrets_absent_from "$work/proc-$user" || return 1; done
}

# Each user streams every file it can read to this machine, where the secrets are searched.
secrets_not_in_readable_files() {
  local user
  for user in dev gui; do
    as "$user" sh -c 'find /home /tmp /run /work /etc /var/tmp /opt -xdev \
      \( -type d \( ! -readable -o ! -executable \) -prune \) -o \( -type f -readable -print0 \) |
      xargs -0 -r cat --' >"$work/files-$user" 2>"$work/files-$user.err" ||
      { sed 's/^/  /' "$work/files-$user.err" >&2; return 1; }
    [ -s "$work/files-$user" ] && secrets_absent_from "$work/files-$user" || return 1
  done
}

list_orphans() {
  local label line state is_known id others=0
  dk ps -a --filter label=orca.workspace --format '{{.Label "orca.workspace"}}|{{.Names}}|{{.State}}' >"$work/labeled"
  while IFS='|' read -r label line state; do
    [ -n "$label" ] && [ "$label" != "$instance" ] || continue
    others=1
    is_known=0
    for id in "${known[@]+"${known[@]}"}"; do [ "$id" != "$label" ] || is_known=1; done
    if [ "$is_known" = 1 ]; then
      report pass orphans.known "$line ($state) belongs to instance $label"
    elif [ ${#known[@]} -gt 0 ]; then
      report warn orphans.found "$line ($state): instance $label has no Orca record; remove with destroy.sh"
    else
      report warn orphans.unverified "$line ($state), instance $label: compare with Settings > VMs or pass --known"
    fi
  done <"$work/labeled"
  [ "$others" = 1 ] || report pass orphans.none 'no other container carries an orca.workspace label'
}

if [ -z "$container" ]; then
  instance="doctor-$(node -e 'process.stdout.write(require("crypto").randomBytes(4).toString("hex"))')"
  log "provisioning a throwaway environment ($instance)"
  ORCA_VM_INSTANCE_ID="$instance" "$here/create.sh" >"$work/result.json"
  {
    IFS= read -r container
    IFS= read -r password
    IFS= read -r token
  } < <(node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8"))
process.stdout.write([d.userData.resourceId, d.desktop.password, d.desktop.launcher.token].join("\n") + "\n")' <"$work/result.json")
  rm -f "$work/result.json"
fi

check template.flags 'the docker run flags hold none of the refused flags' template_flags_ok
check container.hardening 'the container runs with exactly those flags' host_config_ok
check kernel.ptrace_scope 'kernel.yama.ptrace_scope >= 1' ptrace_scope_ok
check users.dev_groups 'dev is only in dev and work (not vnc, gui or xdisplay)' dev_groups_ok
check users.no_sudo 'no sudo and no xdotool in the image' no_sudo_or_xdotool
check desktop.ports 'VNC (5901) is held by vnc and the launcher (5902) by gui, on loopback only' desktop_ports_held
check display.gui_allowed 'gui opens DISPLAY=:1 with its cookie (control)' gui_opens_display
check display.dev_denied 'dev cannot open DISPLAY=:1 ("unable to open display")' dev_cannot_open_display
check display.dev_no_cookie "dev cannot read gui's X cookie (Permission denied)" dev_cannot_read_cookie
check display.dev_no_socket 'dev cannot list /tmp/.X11-unix (Permission denied)' dev_cannot_list_x_sockets
check vnc.password_file 'VNC password file is vnc 0600; dev and gui get Permission denied' vnc_password_file_private
check vnc.wrong_password 'VNC offers only VNC auth and refuses a wrong answer from dev' vnc_refuses_wrong_answer
check launcher.dev_refused 'from dev: no token is refused, a wrong token fails the handshake' launcher_refuses_dev
if [ -n "$token" ]; then
  check launcher.with_token 'from root with the token: runs `id -un` as gui' launcher_runs_as_gui_for_root
  check secrets.inspect 'password and token absent from docker inspect' secrets_not_in_inspect
  check secrets.processes 'password and token absent from ps, cmdlines and environments' secrets_not_in_processes
  check secrets.files 'password and token absent from files dev or gui can read' secrets_not_in_readable_files
else
  report warn secrets.skipped 'secret checks need a provision; run without --container'
fi
list_orphans

if [ "$failures" -gt 0 ]; then
  log "$failures check(s) failed"
  exit 1
fi
log 'all checks passed'
```
