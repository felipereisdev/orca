import { defineFixture } from '../../component-fixtures/component-fixture'
import { DesktopTabLayout } from './DesktopTabBody'
import type { DesktopActions, DesktopView } from './use-desktop-session'

const noop = (): void => {}
const actions: DesktopActions = {
  takeControl: noop,
  handBack: noop,
  startRecording: noop,
  stopRecording: noop,
  retry: noop
}

// Stands in for the noVNC canvas, which needs a live environment.
function FakeDesktop() {
  return (
    <div className="absolute inset-0 bg-muted">
      <div className="absolute top-8 left-10 h-40 w-72 rounded-md border border-border bg-card shadow-lg">
        <div className="h-5 rounded-t-md bg-border" />
      </div>
    </div>
  )
}

function frame(view: DesktopView, error: string | null = null) {
  return () => (
    <div className="relative h-[360px]">
      <DesktopTabLayout
        view={view}
        busy={false}
        error={error}
        actions={actions}
        viewer={<FakeDesktop />}
      />
    </div>
  )
}

export const agentInControl = defineFixture({
  width: 720,
  render: frame({ kind: 'ready', owner: 'agent', recording: false })
})

export const userInControl = defineFixture({
  width: 720,
  render: frame({ kind: 'ready', owner: 'user', recording: false })
})

export const recording = defineFixture({
  width: 720,
  render: frame({ kind: 'ready', owner: 'agent', recording: true })
})

export const unavailable = defineFixture({
  width: 720,
  render: frame({ kind: 'unavailable' })
})

export const recordingFailed = defineFixture({
  width: 720,
  render: frame({ kind: 'ready', owner: 'user', recording: false }, 'desktop_recording_failed')
})
