import { DesktopBroker } from './desktop-broker'

let broker: DesktopBroker | undefined

/** The process-wide broker of this environment's Orca server. */
export function getDesktopBroker(): DesktopBroker {
  broker ??= new DesktopBroker()
  return broker
}
