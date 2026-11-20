export type DesktopOwner = 'agent' | 'user'

export type DesktopStatus = {
  state: 'unconfigured' | 'connecting' | 'ready' | 'unavailable'
  reason?: string
  owner: DesktopOwner
  width?: number
  height?: number
  recording: boolean
}
