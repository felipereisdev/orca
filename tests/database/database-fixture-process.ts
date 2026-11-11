import { runProcess } from '@orca/process-host'
export async function runDatabaseFixtureProcess(
  program: string,
  args: string[],
  timeoutMs = 30000
) {
  const result = await runProcess({ program, args, timeoutMs })
  if (result.code !== 0) {
    throw new Error(`${program} fixture failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}
