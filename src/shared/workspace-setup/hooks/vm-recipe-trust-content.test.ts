import { describe, expect, it } from 'vitest'
import { hashOrcaHookContent } from '../../hashing/orca-hook-content-hash'
import type { OrcaHooks } from '../orca-yaml-hook-types'
import { parseOrcaYaml } from '../orca-yaml'
import { getVmRecipeTrustContent } from './vm-recipe-trust-content'

const hashOf = (yaml: string): string =>
  hashOrcaHookContent(getVmRecipeTrustContent(parseOrcaYaml(yaml)))

const recipeYaml = (...extraLines: string[]): string =>
  [
    'environmentRecipes:',
    '  - id: docker',
    '    name: Docker',
    '    create: ./create.sh',
    ...extraLines.map((line) => `    ${line}`)
  ].join('\n')

describe('getVmRecipeTrustContent', () => {
  it('changes when timeoutSeconds is added, changed or removed', () => {
    const without = hashOf(recipeYaml())
    const sixty = hashOf(recipeYaml('timeoutSeconds: 60'))
    const ninety = hashOf(recipeYaml('timeoutSeconds: 90'))
    const perMode = hashOf(recipeYaml('timeoutSeconds:', '  create: 60'))

    expect(new Set([without, sixty, ninety, perMode]).size).toBe(4)
  })

  it('changes when a recipe carries a field it did not have before', () => {
    const hooks = parseOrcaYaml(recipeYaml())
    const recipe = hooks?.environmentRecipes?.[0]
    expect(recipe).toBeDefined()
    // A field a later parser version adds.
    const withFutureField: OrcaHooks = {
      scripts: {},
      environmentRecipes: [Object.assign({}, recipe, { futureStep: './future.sh' })]
    }

    expect(hashOrcaHookContent(getVmRecipeTrustContent(withFutureField))).not.toBe(
      hashOrcaHookContent(getVmRecipeTrustContent(hooks))
    )
  })

  it('ignores key order in orca.yaml', () => {
    const ordered = [
      'environmentRecipes:',
      '  - id: docker',
      '    name: Docker',
      '    create: ./create.sh',
      '    stats: ./stats.sh',
      '    timeoutSeconds:',
      '      create: 60',
      '      destroy: 30'
    ].join('\n')
    const shuffled = [
      'environmentRecipes:',
      '  - timeoutSeconds:',
      '      destroy: 30',
      '      create: 60',
      '    stats: ./stats.sh',
      '    create: ./create.sh',
      '    name: Docker',
      '    id: docker'
    ].join('\n')

    expect(hashOf(shuffled)).toBe(hashOf(ordered))
  })
})
