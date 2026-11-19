import type { Translate } from '@/i18n/use-translate'

/** RPC messages are English by design, so the tab maps their codes to localized copy. */
export function desktopErrorMessage(code: string, t: Translate): string {
  switch (code) {
    case 'desktop_agent_not_allowed':
      return t(
        'desktop.tab.errors.notAllowed',
        'Only the computer that set up this desktop can view or control it.'
      )
    case 'desktop_controller_token_invalid':
      return t(
        'desktop.tab.errors.controllerStale',
        'This Mac needs to set up the desktop again. Select Try again.'
      )
    case 'desktop_unavailable':
      return t('desktop.tab.errors.unavailable', 'The desktop is not available right now.')
    case 'desktop_already_recording':
      return t('desktop.tab.errors.alreadyRecording', 'The desktop is already being recorded.')
    case 'desktop_not_recording':
      return t('desktop.tab.errors.notRecording', 'The desktop is not being recorded.')
    case 'desktop_recording_unavailable':
      return t(
        'desktop.tab.errors.recordingUnavailable',
        'This environment cannot record the desktop because ffmpeg is missing.'
      )
    case 'desktop_recording_failed':
      return t('desktop.tab.errors.recordingFailed', 'The recording failed and was discarded.')
    default:
      return t('desktop.tab.errors.unknown', 'Something went wrong. Try again.')
  }
}
