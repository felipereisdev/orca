import AsyncStorage from '@react-native-async-storage/async-storage'
import { persistMirrored } from './mirrored-storage-keys'

/** Which Tasks view opens for a host: My board or the per-provider lists. */
export type TasksSurface = 'board' | 'lists'

// One key holding the hosts whose last choice was My board: a per-host key would need a prefix the page negotiates.
const TASKS_SURFACE_KEY = 'orca:tasksSurface'

let tasksSurfaceWrite: Promise<void> = Promise.resolve()

async function readBoardHosts(): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse((await AsyncStorage.getItem(TASKS_SURFACE_KEY)) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((hostId): hostId is string => typeof hostId === 'string')
      : []
  } catch {
    return []
  }
}

export async function loadTasksSurface(hostId: string): Promise<TasksSurface> {
  await tasksSurfaceWrite
  return (await readBoardHosts()).includes(hostId) ? 'board' : 'lists'
}

// A refused write (an older app shell) only means Tasks opens on the lists next time.
export function saveTasksSurface(hostId: string, surface: TasksSurface): Promise<void> {
  // Chained: two quick switches on different hosts must not each drop the other's choice.
  const write = tasksSurfaceWrite.then(async () => {
    const others = (await readBoardHosts()).filter((candidate) => candidate !== hostId)
    await persistMirrored(
      TASKS_SURFACE_KEY,
      JSON.stringify(surface === 'board' ? [...others, hostId] : others)
    )
  })
  tasksSurfaceWrite = write.catch((error: unknown) => {
    console.warn('Tasks view could not be saved', error)
  })
  return tasksSurfaceWrite
}
