declare module '@novnc/novnc' {
  /** A WebSocket or any channel with its shape, such as the Desktop tab's viewer channel. */
  type RfbChannel = {
    binaryType: string
    readonly protocol: string
    readonly readyState: number
    send: (data: ArrayBuffer | ArrayBufferView) => void
    close: () => void
  }

  /** The subset of noVNC's RFB client the Desktop tab uses; the package ships no types. */
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | RfbChannel)
    viewOnly: boolean
    scaleViewport: boolean
    resizeSession: boolean
    disconnect(): void
  }
}
