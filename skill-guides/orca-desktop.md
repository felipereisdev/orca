---
name: orca-desktop
description: >-
  Drive the remote Linux desktop of an Orca environment-recipe workspace through
  `orca desktop`: run GUI apps and end-to-end tests on it, take screenshots, click,
  type and record a test as a video the user can watch in the chat. Use when a
  workspace's environment has a desktop and the task needs a visible GUI or a recorded
  test. For a local app window use `orca-computer-use`; for Orca's embedded browser use
  `orca-cli`.
---

# Orca Desktop

`ORCA` is a placeholder for the executable you resolved in the stub; substitute it before running.

Some environment-recipe workspaces have a desktop: a Linux X display the user can watch and
take over from the workspace's Desktop tab. `ORCA desktop` is the only way an agent reaches it.

## Check the desktop first

Run `ORCA desktop status --json` before anything else. Act only when the state is `ready`
and the owner is `agent`. `desktop_unavailable` means this workspace has no desktop, or it
is not up yet: report it, and retry only if it was still starting.

## Start GUI programs and tests only through `run`

You have no access to the display: there is no usable `DISPLAY`, and connecting to the X
or VNC server directly fails. Start every GUI program, browser and end-to-end test with:

```text
ORCA desktop run -- npx playwright test
ORCA desktop run -- npm run dev
```

The program runs as a separate desktop user, in the current directory, and its output
streams back. The command exits with the program's exit code; Ctrl-C kills it. Do not try
to reach the display any other way (`DISPLAY=:1`, `xhost`, the VNC or launcher port).

## Look and act

| Goal       | Command                                                                    |
| ---------- | -------------------------------------------------------------------------- |
| Screenshot | `ORCA desktop screenshot [--out <path>] --json`                            |
| Move       | `ORCA desktop move --x <x> --y <y> --json`                                 |
| Click      | `ORCA desktop click --x <x> --y <y> [--button right] [--double] --json`    |
| Drag       | `ORCA desktop drag --from-x <x> --from-y <y> --to-x <x> --to-y <y> --json` |
| Scroll     | `ORCA desktop scroll --x <x> --y <y> --dy <steps> --json`                  |
| Type       | `ORCA desktop type --text "hello" --json` (or `--text-stdin`)              |
| Key        | `ORCA desktop key --combo ctrl+shift+t --json`                             |

Coordinates are desktop pixels; take a screenshot to find them, and another to check the
result.

## When the user takes control

While the user holds control, these commands fail with `desktop_user_in_control`:

- input: `move`, `click`, `drag`, `scroll`, `type` and `key`
- `run`: no new program starts. Programs already running keep going, and their output keeps streaming.

These keep working while the user holds control: `status`, `screenshot`, `record start`,
`record stop` and `recordings`.

Never try to get around the refusal: do not retry in a loop or look for another way in.
Wait for the user to hand control back (check `ORCA desktop status` now and then), or ask
the user in your reply. Control returns to you a few seconds after the user closes the
Desktop tab.

## Record a test

When the user asks you to record a test:

1. `ORCA desktop record start` (limits default to 10 minutes and 200 MB; it stops by itself
   at either).
2. Run the test, normally with `ORCA desktop run -- …`.
3. `ORCA desktop record stop`.
4. Paste the last line it prints, for example
   `![Gravação do teste](</home/dev/.orca/desktop-recordings/rec-….mp4>)`, unchanged into
   your reply. The chat plays it inline, on desktop and on mobile.

`ORCA desktop recordings` lists the recordings on the environment. `desktop_not_recording`
means no recording is running; `desktop_recording_unavailable` means the environment
cannot record (ffmpeg is missing).

## Privacy

Programs running on the environment's desktop can see whatever is shown and typed there.
Never type passwords, tokens or other personal secrets on it, and do not open private
data the task does not need.
