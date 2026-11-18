import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'

const USER_IN_CONTROL_NOTE =
  'Refused with desktop_user_in_control while the user holds control; wait for the user to hand control back.'

export const DESKTOP_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['desktop', 'status'],
    summary: "Show the workspace desktop's state, size, controller and recording",
    usage: 'orca desktop status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: ['Run this first: input works only when state is ready and owner is agent.']
  },
  {
    path: ['desktop', 'screenshot'],
    summary: 'Save a PNG of the workspace desktop',
    usage: 'orca desktop screenshot [--out <path>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'out'],
    notes: ['Allowed while the user holds control. Without --out the PNG goes to a temp folder.']
  },
  {
    path: ['desktop', 'move'],
    summary: 'Move the desktop pointer',
    usage: 'orca desktop move --x <x> --y <y> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'x', 'y'],
    notes: [USER_IN_CONTROL_NOTE]
  },
  {
    path: ['desktop', 'click'],
    summary: 'Click on the desktop',
    usage: 'orca desktop click --x <x> --y <y> [--button left|middle|right] [--double] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'x', 'y', 'button', 'double'],
    booleanFlags: ['double'],
    notes: [USER_IN_CONTROL_NOTE]
  },
  {
    path: ['desktop', 'drag'],
    summary: 'Drag with the left button between two desktop points',
    usage: 'orca desktop drag --from-x <x> --from-y <y> --to-x <x> --to-y <y> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'from-x', 'from-y', 'to-x', 'to-y'],
    notes: [USER_IN_CONTROL_NOTE]
  },
  {
    path: ['desktop', 'scroll'],
    summary: 'Scroll the wheel at a desktop point',
    usage: 'orca desktop scroll --x <x> --y <y> --dy <steps> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'x', 'y', 'dy'],
    notes: ['--dy is in wheel steps: positive scrolls down, negative up.', USER_IN_CONTROL_NOTE]
  },
  {
    path: ['desktop', 'type'],
    summary: 'Type text on the desktop',
    usage: 'orca desktop type (--text <text> | --text-stdin) [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'text', 'text-stdin'],
    notes: [
      'At most 10000 characters, typed at about 5 ms each.',
      'Programs on the desktop can see what is typed: never type personal secrets.',
      USER_IN_CONTROL_NOTE
    ]
  },
  {
    path: ['desktop', 'key'],
    summary: 'Press a key or key combination on the desktop',
    usage: 'orca desktop key --combo <combo> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'combo'],
    examples: ['orca desktop key --combo ctrl+shift+t', 'orca desktop key --combo Return'],
    notes: [USER_IN_CONTROL_NOTE]
  },
  {
    path: ['desktop', 'run'],
    summary: 'Run a GUI program or test on the desktop and stream its output',
    usage: 'orca desktop run [--json] -- <command...>',
    allowedFlags: [...GLOBAL_FLAGS],
    trailingArgs: true,
    examples: ['orca desktop run -- npm run dev', 'orca desktop run -- npx playwright test'],
    notes: [
      'The only way to start GUI programs: the agent has no access to the display. The program runs in the current directory.',
      'Exits with the program exit code; Ctrl-C kills the program.',
      'With --json, prints one JSON object per output event, then {"exit":<code>}.',
      USER_IN_CONTROL_NOTE
    ]
  },
  {
    path: ['desktop', 'record', 'start'],
    summary: 'Start recording the desktop to an MP4',
    usage: 'orca desktop record start [--max-seconds <n>] [--max-bytes <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'max-seconds', 'max-bytes'],
    notes: [
      'Limits default to 600 seconds and 200 MB (--max-seconds 1-3600, --max-bytes 1 MB-2 GB); the recording stops by itself at either.'
    ]
  },
  {
    path: ['desktop', 'record', 'stop'],
    summary: 'Stop the desktop recording and print the line to paste into the chat',
    usage: 'orca desktop record stop [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: ['Paste the last printed line into your reply so the user can watch the video.']
  },
  {
    path: ['desktop', 'recordings'],
    summary: 'List desktop recordings on this environment',
    usage: 'orca desktop recordings [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  }
]
