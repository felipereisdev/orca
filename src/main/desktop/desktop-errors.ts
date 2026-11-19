export type DesktopErrorCode =
  | 'desktop_user_in_control'
  | 'desktop_unavailable'
  | 'desktop_invalid_input'
  | 'desktop_agent_not_allowed'
  | 'desktop_controller_token_invalid'
  | 'desktop_run_unavailable'
  | 'desktop_launcher_rejected'
  | 'desktop_run_failed'
  | 'desktop_run_not_found'
  | 'desktop_screenshot_failed'
  | 'desktop_already_recording'
  | 'desktop_not_recording'
  | 'desktop_recording_unavailable'
  | 'desktop_recording_failed'
  | 'desktop_recording_not_found'
  | 'desktop_removal_pending'

const DESKTOP_ERROR_MESSAGES: Record<DesktopErrorCode, string> = {
  desktop_user_in_control: 'The user has taken control of the desktop.',
  desktop_unavailable: 'The desktop is not available.',
  desktop_invalid_input: 'The desktop input is not valid.',
  desktop_agent_not_allowed: 'Agents cannot configure, view or take control of the desktop.',
  desktop_controller_token_invalid:
    'The desktop controller token is missing or no longer valid; configure the desktop again.',
  desktop_run_unavailable: 'No desktop launcher is available to start programs.',
  desktop_launcher_rejected: 'The desktop launcher refused the request.',
  desktop_run_failed: 'The program could not be run on the desktop.',
  desktop_run_not_found: 'No desktop run with that id is running for this caller.',
  desktop_screenshot_failed: 'The screenshot could not be saved.',
  desktop_already_recording: 'The desktop is already being recorded.',
  desktop_not_recording: 'The desktop is not being recorded.',
  desktop_recording_unavailable: 'The desktop cannot be recorded (ffmpeg is required).',
  desktop_recording_failed: 'The desktop recording failed and was discarded.',
  desktop_recording_not_found: 'This computer has no copy of that desktop recording.',
  desktop_removal_pending: 'This workspace is being removed, so the desktop cannot be recorded.'
}

/** `reason` is a fixed code or caller-supplied text; credentials never go into it. */
export class DesktopError extends Error {
  readonly code: DesktopErrorCode
  readonly reason?: string

  constructor(code: DesktopErrorCode, reason?: string) {
    super(
      reason && code !== 'desktop_user_in_control'
        ? `${DESKTOP_ERROR_MESSAGES[code]} (${reason})`
        : DESKTOP_ERROR_MESSAGES[code]
    )
    this.name = 'DesktopError'
    this.code = code
    this.reason = reason
  }
}
