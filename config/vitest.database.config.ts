import { defineConfig } from 'vitest/config'
import base from './vitest.config'

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    projects: undefined,
    include: ['tests/database/**/*.integration.test.ts'],
    exclude: [],
    maxWorkers: 1
  }
})
