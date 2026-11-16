import { expect, it } from 'vitest'
import type { ClaudeManagedAccount } from '../managed-account-types'
import { migrateLegacyClaudeAccountLabels } from './legacy-claude-account-labels'

function account(id: string, label?: string): ClaudeManagedAccount & { label?: string } {
  return {
    id,
    email: `${id}@example.test`,
    managedAuthPath: `/profiles/${id}`,
    authMethod: 'subscription-oauth',
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0,
    ...(label === undefined ? {} : { label })
  }
}

it('moves a saved label into the Claude account names and strips it from the record', () => {
  const migrated = migrateLegacyClaudeAccountLabels({
    claudeManagedAccounts: [account('work', 'Empresa'), account('personal')],
    managedAccountDisplayNames: { codex: { cx: 'Codex work' } }
  })
  expect(migrated.managedAccountDisplayNames).toEqual({
    codex: { cx: 'Codex work' },
    claude: { work: 'Empresa' }
  })
  expect(migrated.claudeManagedAccounts?.map((entry) => 'label' in entry)).toEqual([false, false])
  expect(migrated.claudeManagedAccounts?.map((entry) => entry.id)).toEqual(['work', 'personal'])
})

it('keeps a name the user already gave over the old label', () => {
  const migrated = migrateLegacyClaudeAccountLabels({
    claudeManagedAccounts: [account('work', 'Empresa')],
    managedAccountDisplayNames: { claude: { work: 'Ucloud' } }
  })
  expect(migrated.managedAccountDisplayNames?.claude).toEqual({ work: 'Ucloud' })
})

it('drops a label longer than an account name may be', () => {
  const migrated = migrateLegacyClaudeAccountLabels({
    claudeManagedAccounts: [account('work', 'x'.repeat(121))]
  })
  expect(migrated.managedAccountDisplayNames?.claude).toEqual({})
  expect(migrated.claudeManagedAccounts?.[0]).not.toHaveProperty('label')
})

it('changes nothing when no account carries a label', () => {
  expect(
    migrateLegacyClaudeAccountLabels({
      claudeManagedAccounts: [account('work')],
      managedAccountDisplayNames: { claude: { work: 'Ucloud' } }
    })
  ).toEqual({})
})
