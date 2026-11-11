import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ORCAD_DATABASE_PARSER_ARTIFACTS } from '../../../../src/shared/orcad-artifacts.ts'
import { ORCAD_SERVER_BUILD_TARGET } from './orcad-entry-build.mjs'

export async function stageOrcadDatabaseParser(root, outputDir) {
  for (const artifact of ORCAD_DATABASE_PARSER_ARTIFACTS) {
    const destination = join(outputDir, artifact)
    mkdirSync(dirname(destination), { recursive: true })
    if (artifact.endsWith('/dist/parse-sql.js')) {
      await build({
        entryPoints: [join(root, artifact)],
        outfile: destination,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: ORCAD_SERVER_BUILD_TARGET,
        logLevel: 'error'
      })
    } else {
      copyFileSync(join(root, artifact), destination)
    }
  }
}
