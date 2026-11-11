import { build } from 'esbuild'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import { runProcessSync } from '@orca/process-host'
import {
  ORCAD_COMMONJS_MODULE_OPTIONS,
  ORCAD_BUNDLE_PLUGINS,
  ORCAD_SERVER_BUILD_TARGET
} from './orcad-entry-build.mjs'
import { ORCAD_ARTIFACTS } from '../../../../src/shared/orcad-artifacts.ts'
import { stageOrcadDatabaseParser } from './orcad-database-parser-package.mjs'

const root = join(import.meta.dirname, '../../../..')
const require = createRequire(import.meta.url)
const {
  createPackagedRuntimeNodeModuleResources,
  readPackage
} = require('../../../packaged-runtime-node-modules.cjs')

it('loads desktop database drivers and the policy worker from their isolated shipped resources', () => {
  const deployment = realpathSync(mkdtempSync(join(tmpdir(), 'orca-desktop-database-')))
  try {
    const resources = createPackagedRuntimeNodeModuleResources(process.platform)
    const copied = new Set()
    const copy = (name, fromDir = root) => {
      if (copied.has(name)) {
        return
      }
      copied.add(name)
      const resource = resources.find(
        (entry) => entry.to.replaceAll('\\', '/') === `node_modules/${name}`
      )
      if (!resource) {
        throw new Error(`Missing desktop database resource ${name}`)
      }
      const info = readPackage(name, fromDir)
      mkdirSync(dirname(join(deployment, resource.to)), { recursive: true })
      cpSync(resource.from, join(deployment, resource.to), { recursive: true, dereference: true })
      for (const dependency of info.dependencies) {
        copy(dependency, info.packageDir)
      }
    }
    for (const name of ['pg', 'pg-cursor', 'mssql', 'oracledb', '@orca/sql-read-query-parser']) {
      copy(name)
    }
    const script = join(deployment, 'verify.mjs')
    cpSync(join(root, 'config/scripts/database/verify-database-runtime.mjs'), script)
    const result = runProcessSync({
      program: process.execPath,
      args: [script],
      cwd: deployment,
      env: { ORCA_BACKGROUND_LAUNCH: '1', NODE_PATH: '' },
      timeoutMs: 30000
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('Loaded database policy worker')
  } finally {
    rmSync(deployment, { recursive: true, force: true })
  }
}, 60000)

it('ships a hashed parser package and runs the bundled server database path outside the checkout', async () => {
  const deployment = realpathSync(mkdtempSync(join(tmpdir(), 'orcad-database-')))
  try {
    await stageOrcadDatabaseParser(root, deployment)
    await build({
      ...ORCAD_COMMONJS_MODULE_OPTIONS,
      stdin: {
        contents: `import {createPostgresAdapter} from './src/main/database/adapters/postgres-adapter'; import {createSqlServerAdapter} from './src/main/database/adapters/sql-server-adapter'; import {createOracleAdapter} from './src/main/database/adapters/oracle-adapter'; import {validateDatabaseReadQueryInWorker} from './src/main/database/query-policy/database-query-policy-worker'; Promise.all(['postgres','sql-server','oracle'].map(engine => validateDatabaseReadQueryInWorker(engine, 'SELECT 1'))).then(async () => { await Promise.all([createPostgresAdapter(),createSqlServerAdapter(),createOracleAdapter()].map(adapter=>adapter.dispose())); console.log('database-runtime-ready'); });`,
        resolveDir: root
      },
      outfile: join(deployment, 'server.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: ORCAD_SERVER_BUILD_TARGET,
      plugins: ORCAD_BUNDLE_PLUGINS
    })
    const installed = join(deployment, 'installed')
    mkdirSync(installed)
    for (const artifact of ORCAD_ARTIFACTS) {
      if (artifact.filename.startsWith('node_modules/@orca/sql-read-query-parser/')) {
        const destination = join(installed, artifact.filename)
        mkdirSync(dirname(destination), { recursive: true })
        cpSync(join(deployment, artifact.filename), destination)
      }
    }
    cpSync(join(deployment, 'server.cjs'), join(installed, 'server.cjs'))
    const result = runProcessSync({
      program: process.execPath,
      args: [join(installed, 'server.cjs')],
      cwd: installed,
      env: { ORCA_BACKGROUND_LAUNCH: '1', NODE_PATH: '' },
      timeoutMs: 30000
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toBe('database-runtime-ready\n')
  } finally {
    rmSync(deployment, { recursive: true, force: true })
  }
}, 60000)
