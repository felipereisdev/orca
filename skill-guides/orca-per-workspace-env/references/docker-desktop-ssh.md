# Docker desktop over SSH

Load this when the environment is a Linux Docker container with a desktop (VNC) that Orca shows in
the workspace's Desktop tab, on this machine or on another Mac used as a "VPS". The templates are
in `references/docker-desktop-ssh-templates.md`; read that one when you write the files.

## What it does

`create` starts one hardened container per workspace from a Debian image built once per hash of its
files. Inside it, sshd serves the agent user `dev`; Xvnc, Fluxbox and a small launcher run the
desktop. The script clones the repo into `/work/<repo>`, sends a fresh VNC password and launcher
token into the container over stdin, and prints SSH-mode recipe JSON with a `desktop` block:

```json
{
  "schemaVersion": 1,
  "connection": {
    "type": "ssh",
    "target": {
      "label": "orca-desktop-<instance>",
      "host": "127.0.0.1",
      "port": 49153,
      "username": "dev",
      "identityFile": "/abs/scripts/orca-vm/docker-desktop/id_ed25519",
      "identitiesOnly": true,
      "jumpHost": "user@air.local"
    },
    "projectRoot": "/work/<repo>"
  },
  "userData": { "provider": "docker-desktop", "resourceId": "orca-desktop-<instance>" },
  "desktop": {
    "type": "vnc",
    "host": "127.0.0.1",
    "port": 5901,
    "password": "<8 chars>",
    "launcher": { "port": 5902, "token": "<43 chars>" }
  }
}
```

`jumpHost` appears only with `ORCA_DOCKER_HOST`. The container publishes only SSH, on the Docker
host's `127.0.0.1`; VNC (5901) and the launcher (5902) listen on the container's loopback and
are never published. Orca's server in the environment dials them there.

## Security model

Three users split the desktop:

- `vnc` runs Xvnc and owns the VNC password file (mode 0600), nothing else.
- `gui` runs the launcher and every program it starts. It reaches the display only through its
  own MIT-MAGIC-COOKIE in `~gui/.Xauthority` and cannot read `vnc`'s files.
- `dev` is the agent and SSH user: no X access (no cookie, no access to `/tmp/.X11-unix`), no
  sudo, and in neither the `vnc` nor the `gui` group. It shares `/work` with `gui` through the
  `work` group (setgid directory, umask 002), so launched programs can run and build the checkout.

Secrets travel over stdin only. The VNC password reaches `vncpasswd -f` on stdin; the launcher
token reaches the launcher on stdin and stays in its memory, never in env, argv or a file
(`/proc/<pid>/environ` is readable by the same uid). The token never crosses a connection either:
Orca's server and the launcher prove it to each other with HMAC-SHA256 over fresh 32-byte nonces,
the launcher first, so a listener that does not know the token receives only a nonce and the run
fails with `desktop_launcher_rejected`; a malformed or missing proof is a rejection too. The
launcher checks a client's proof against its current token, gives an unauthenticated connection
five seconds, and closes every unauthenticated connection when the token rotates. The git token reaches a `GIT_ASKPASS` helper through a 0600
file removed after the clone.

The desktop ports are held before anyone can log in. On every container start the root entrypoint
starts Xvnc (as `vnc`) and the launcher (as `gui`) with throwaway secrets, waits until 5901 and
5902 listen on loopback owned by those users, and only then starts sshd. Rotating the secrets
(create and resume) restarts neither: TigerVNC reads its password file on every authentication, so
the file is rewritten in place, and the launcher takes the new token from a pipe only root can
write. The entrypoint answers only after checking the password file, proving the new token
against the launcher and checking the listeners' owners; otherwise `create.sh` and `resume.sh` fail
instead of printing JSON. Xvnc runs with `-extension XTEST`, the image ships no `xdotool`, and
`docker run` uses `--init`, `no-new-privileges`, `--cap-drop ALL` plus only what sshd and the
supervisor need, CPU, memory and process limits, and the `orca.workspace=<instance>` label. It
never uses `--privileged`, the Docker socket, host network, PID or IPC namespaces, or any mount;
`doctor-extra.sh` refuses all of them.

The honest limit: Orca's server in the environment runs as `dev`, the same user as the agent. The
password and token live only in that server's memory, and the environment requires
`kernel.yama.ptrace_scope` ≥ 1 so the agent cannot attach to the process that started it.
`create.sh` refuses to start otherwise. This blocks practical workarounds; it is not a boundary
against code that exploits the kernel. One window remains: if Xvnc or the launcher crashes, the
entrypoint restarts it within about five seconds, and meanwhile the agent could bind the freed
port. A fake launcher learns nothing (the handshake) and only blocks runs until it exits. A fake
VNC server, however, would receive the server's answer to a challenge it chose, which allows an
offline guess of the 8-character password; if the logs show `Xvnc exited; restarting`, suspend
and resume the workspace to rotate the password. Programs on the desktop, which the agent can start with
`orca desktop run`, can observe what the desktop shows and what is typed into it, so never type
personal secrets into the environment's desktop. Docker Desktop and OrbStack also let containers
reach the Docker host's own services through `host.docker.internal`; keep nothing sensitive
listening there.

## Setting up a Mac as the Docker host

On the Mac that runs the containers (the "VPS"):

1. Install OrbStack or Docker Desktop and confirm `docker info` works in a non-interactive SSH
   session. Non-interactive SSH on macOS gets a minimal `PATH`, so set `ORCA_DOCKER_BIN` to the
   absolute path from `command -v docker` (for example `/usr/local/bin/docker`).
2. Turn on Remote Login (System Settings > General > Sharing) and authorize the main Mac's SSH
   key for this user. `ssh -o BatchMode=yes user@air.local true` must succeed without a prompt.
3. Raise `kernel.yama.ptrace_scope` in the Docker VM (OrbStack ships it at 0). The setting lives in
   that VM's kernel and may not survive a restart of OrbStack or Docker Desktop, so repeat it
   whenever `create.sh` refuses:
   `docker run --rm --privileged --network none debian:bookworm-slim sh -c 'echo 1 > /proc/sys/kernel/yama/ptrace_scope'`.
   This is a one-off admin step on the Docker host; no workspace container is privileged.

The main Mac runs the recipe scripts. They need `bash`, `node`, `ssh`, `ssh-keygen` and `tar`.

## `ORCA_DOCKER_HOST`

Every Docker call runs as `ssh "$ORCA_DOCKER_HOST" docker …`, with each argument quoted for the
remote shell. Leave it empty to run Docker on this machine, which is also how to try the recipe
locally. Orca does not always inherit the shell's environment, so put non-secret settings in
`scripts/orca-vm/docker-desktop/docker-desktop.env` as `KEY=value` lines; variables already in the
environment win. The scripts read only `ORCA_DOCKER_*` and `ORCA_DESKTOP_*` keys from it:

| Variable                                                        | Default                      | Meaning                                      |
| --------------------------------------------------------------- | ---------------------------- | -------------------------------------------- |
| `ORCA_DOCKER_HOST`                                              | empty (local Docker)         | SSH destination of the Docker host           |
| `ORCA_DOCKER_BIN`                                               | `docker`                     | Docker CLI path on that host                 |
| `ORCA_DESKTOP_AGENT`                                            | `codex`                      | Agent whose auth image to use (`claude`)     |
| `ORCA_DESKTOP_SSH_KEY`                                          | `<scripts>/id_ed25519`       | Key Orca uses to reach `dev`; made if absent |
| `ORCA_DESKTOP_KNOWN_HOSTS`                                      | `~/.ssh/known_hosts`         | Where container host keys are recorded       |
| `ORCA_DESKTOP_REPO_URL`                                         | `ORCA_REPO_URL`, else origin | Repo to clone into `/work`                   |
| `ORCA_DESKTOP_REPO_REF`                                         | default branch               | Ref to check out after cloning               |
| `ORCA_DESKTOP_CPUS`, `ORCA_DESKTOP_MEMORY`, `ORCA_DESKTOP_PIDS` | `2`, `4g`, `2048`            | Limits                                       |

With a remote host, Orca reaches the container through the Docker host: the target is
`127.0.0.1:<published port>` with `jumpHost` set to `ORCA_DOCKER_HOST`. Each container generates
its own SSH host key on first start; `create` and `resume` read it through `docker exec` and record
it under `[127.0.0.1]:<port>`, replacing only a stale entry for that endpoint, and `destroy`
removes the entry while it still matches the container. The git token (`GH_TOKEN`, `GITHUB_TOKEN`,
else `gh auth token`) is sent only for `https://` repo URLs.

Gitignore `id_ed25519`, `id_ed25519.pub` and `docker-desktop.env`.

## Wiring the recipe

Write every file from the templates reference into `scripts/orca-vm/docker-desktop/`, then:

```yaml
environmentRecipes:
  - id: docker-desktop
    name: Docker desktop
    create: ./scripts/orca-vm/docker-desktop/create.sh
    suspend: ./scripts/orca-vm/docker-desktop/suspend.sh
    resume: ./scripts/orca-vm/docker-desktop/resume.sh
    destroy: ./scripts/orca-vm/docker-desktop/destroy.sh
    timeoutSeconds:
      create: 1800 # the first create builds the image
      suspend: 120
      resume: 300
      destroy: 120
    passEnv: [GH_TOKEN, GITHUB_TOKEN, SSH_AUTH_SOCK, 'ORCA_DOCKER_*', 'ORCA_DESKTOP_*']
```

## Base and auth images

`create.sh` builds `orca-desktop:<hash>` when the Docker host lacks it; the hash covers the
Dockerfile and the four files copied into the image, so editing any of them rebuilds once. The
image pins its base by digest, Debian packages by a snapshot date, and the agent CLIs by version.

`auth.sh` is the interactive auth snapshot. Run it by hand in a terminal with
`ORCA_DESKTOP_AGENT=codex` or `claude`: it starts the base image, prints the exact
`docker exec -it -u dev … login` command for the user to run (prefixed with `ssh -t <host>` when
remote), waits for Enter, checks the agent's status command by exit code, deletes the SSH host
keys and commits `orca-desktop-auth:<hash>-<agent>`. `create.sh` uses that image when present and
otherwise warns and uses the base one. A Dockerfile change needs a new `auth.sh` run.

## Suspend and resume

`suspend.sh` runs `docker stop` and keeps the container's state. `resume.sh` runs `docker start`,
records the host key under the new published port (it can change), rotates the VNC password and
launcher token in place, and prints the full recipe JSON again; Orca then reconfigures the desktop.

## Stats

`stats.sh` prints `{"cpuPercent":…,"memoryBytes":…,"diskBytes":…}`: CPU and memory from
`docker stats --no-stream`, and `diskBytes` as the container's writable layer (`SizeRw` from
`docker container inspect --size`), which is what this workspace added on top of the shared image,
not the image itself or `docker system df` totals. It reads the lifecycle payload on stdin like the other
steps. The recipe above leaves it out: wire it as a `stats` step once the installed Orca reads one
(an Orca without that step ignores the key, so nothing would run it).

## `doctor-extra.sh`

`orca vm recipe doctor` checks the wiring; `doctor-extra.sh` checks the security model. With no
arguments it provisions a throwaway environment through `create.sh`, runs every check and destroys
it. `--container <name>` checks a running environment without the secret checks. Pass
`--known <instance id>` for each environment Orca still lists in Settings > VMs; other containers
with an `orca.workspace` label are reported as orphans (`warn`), to remove with `destroy.sh`. With
no other labeled container the run is all `pass`.

The checks: the `docker run` flag block holds none of the refused flags and the container runs
with exactly those; `ptrace_scope` ≥ 1; `dev` is only in `dev` and `work`; no sudo or xdotool;
5901 and 5902 listen on loopback only, owned by `vnc` and `gui`; `gui` opens `DISPLAY=:1`
(control) while `dev` gets "unable to open display" and "Permission denied" on the cookie and on
`/tmp/.X11-unix`; the VNC password file is `vnc` 0600 and `dev` and `gui` get "Permission denied";
VNC offers only VNC authentication and refuses a wrong answer from `dev`; from `dev` the launcher
refuses a run without the token and a wrong token fails the handshake, while from root with the
token it runs `id -un` as `gui`; the password and token appear in neither `docker inspect`, nor
`ps`, command lines or environments on the hosts and in the container, nor any file `dev` or `gui`
can read (the files are streamed to this machine and searched here). Each denial must show its
expected refusal after a marker proving it ran as that user, so a Docker, SSH or exec error fails
the check; the launcher probe accepts a run only after the launcher proved the token, and any run
evidence outweighs a refusal in either order (`unverified_run`); an empty or failed `docker inspect`
and a failed `find` fail their checks; and the secrets never enter a process run as `dev` or `gui`.
The positive controls (the ports, `gui` on the display, the launcher with the token) retry up to
five times, one second apart, to ride out a supervised restart. Each denial of the display, the
VNC server or the launcher runs between two passes of its control that name the same listener, so
a service that is down or an impostor on its port fails the check, and a restart in between makes
the bracket run again. The process and file scans skip only a process or file that disappeared
during the scan; any other read error fails. Every check prints its line, then a
`<n> pass, <n> FAIL, <n> warn` summary; exit status 1 means a check failed.

## Electron apps

Chromium's SUID sandbox cannot start under `no-new-privileges`, so the launcher sets
`ELECTRON_DISABLE_SANDBOX=1` for the programs it starts; the container is the isolation boundary.
The image carries the Electron runtime libraries for linux/arm64 and amd64. Run the app with
`orca desktop run -- npm run dev` from the checkout.

## Validação manual (com o usuário)

Feita junto com o usuário, no Mac que roda os containers e no Mac principal, com o repo de teste
escolhido por ele:

1. No Mac dos containers, `ptrace_scope` em 1 (passo 3 da configuração) e `docker info` por SSH
   funcionando; no Mac principal, `docker-desktop.env` com `ORCA_DOCKER_HOST` e `ORCA_DOCKER_BIN`.
2. `ORCA vm recipe doctor docker-desktop --json` sem `fail` nem `warn`, e `doctor-extra.sh` com
   todas as checagens `pass`.
3. Rodar `auth.sh`, fazer o login do agente no comando impresso e confirmar a imagem
   `orca-desktop-auth:<hash>-<agente>`.
4. Criar um workspace pela receita: ele abre, e a aba Desktop mostra o desktop do Fluxbox.
5. No terminal do agente: `orca desktop run -- npm run dev` abre o app no desktop, e
   `orca desktop click` / `orca desktop type` agem visivelmente.
6. No terminal do agente, `DISPLAY=:1 xdpyinfo` falha (sem acesso ao display).
7. Clicar em **Assumir controle**: `orca desktop click` do agente retorna `desktop_user_in_control`,
   e tentativas diretas do agente (`xdotool`, conectar na porta VNC sem a senha) falham.
8. Clicar em **Devolver ao agente**: os comandos do agente voltam a funcionar.
9. O agente grava um teste curto (`orca desktop record start` / `stop`) e o vídeo toca na conversa
   no Mac e no iPhone.
10. Suspender e retomar o workspace: o estado do container se mantém (arquivos no checkout) e a aba
    Desktop reconecta.
11. A barra de status mostra o ambiente rodando com uso de CPU, memória e disco (quando o passo
    `stats` estiver ligado).
12. Remover o workspace com uma gravação ainda não copiada: o Orca avisa antes de remover; depois,
    `docker ps -a --filter label=orca.workspace` não lista mais o container.
