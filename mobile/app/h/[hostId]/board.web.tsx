import { MobileTaskBoardScreen } from '../../../src/tasks/board/MobileTaskBoardScreen'

// Render screen directly: native sibling imports a shell module that throws in browsers, and manifest imports every route.
export default function MobileTaskBoardRoute() {
  return <MobileTaskBoardScreen />
}
