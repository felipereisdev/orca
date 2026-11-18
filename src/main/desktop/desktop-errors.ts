export type DesktopErrorCode =
  | 'desktop_user_in_control'
  | 'desktop_unavailable'
  | 'desktop_invalid_input'

const DESKTOP_ERROR_MESSAGES: Record<DesktopErrorCode, string> = {
  desktop_user_in_control: 'The user has taken control of the desktop.',
  desktop_unavailable: 'The desktop is not available.',
  desktop_invalid_input: 'The desktop input is not valid.'
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
