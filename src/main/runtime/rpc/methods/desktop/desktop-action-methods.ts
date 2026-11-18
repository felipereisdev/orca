import type { DesktopBroker } from '../../../../desktop/desktop-broker'
import { writeDesktopScreenshot } from '../../../../desktop/desktop-screenshot-file'
import {
  DesktopClickParams,
  DesktopDragParams,
  DesktopKeyParams,
  DesktopMoveParams,
  DesktopScreenshotParams,
  DesktopScrollParams,
  DesktopTypeParams
} from '../../../../../shared/rpc-contract/desktop/desktop-params'
import { defineMethod } from '../../core'

/**
 * What an agent does on the desktop. Agents may call these (unlike viewer and control); the
 * broker refuses input while the user holds control, and screenshots stay allowed.
 */
export function createDesktopActionMethods(getBroker: () => DesktopBroker, tmpDir: () => string) {
  const act = async (action: (broker: DesktopBroker) => Promise<void>) => {
    const broker = getBroker()
    await action(broker)
    return broker.status()
  }
  return [
    defineMethod({
      name: 'desktop.screenshot',
      permission: 'workspace',
      params: DesktopScreenshotParams,
      handler: async (params) => {
        const { png, width, height } = await getBroker().screenshot()
        const path = await writeDesktopScreenshot(png, { out: params.out, tmpDir: tmpDir() })
        return { path, width, height }
      }
    }),
    defineMethod({
      name: 'desktop.move',
      permission: 'workspace',
      params: DesktopMoveParams,
      handler: async ({ x, y }) => act((broker) => broker.move(x, y))
    }),
    defineMethod({
      name: 'desktop.click',
      permission: 'workspace',
      params: DesktopClickParams,
      handler: async ({ x, y, button, double }) =>
        act((broker) => broker.click(x, y, { button: button ?? 'left', double }))
    }),
    defineMethod({
      name: 'desktop.drag',
      permission: 'workspace',
      params: DesktopDragParams,
      handler: async ({ fromX, fromY, toX, toY }) =>
        act((broker) => broker.drag({ x: fromX, y: fromY }, { x: toX, y: toY }))
    }),
    defineMethod({
      name: 'desktop.scroll',
      permission: 'workspace',
      params: DesktopScrollParams,
      handler: async ({ x, y, dy }) => act((broker) => broker.scroll(x, y, { dy }))
    }),
    defineMethod({
      name: 'desktop.type',
      permission: 'workspace',
      params: DesktopTypeParams,
      handler: async ({ text }) => act((broker) => broker.type(text))
    }),
    defineMethod({
      name: 'desktop.key',
      permission: 'workspace',
      params: DesktopKeyParams,
      handler: async ({ combo }) => act((broker) => broker.key(combo))
    })
  ]
}
