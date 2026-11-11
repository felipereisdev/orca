import { defineMethod } from '../../core'
import { RenameClaudeAccountParams } from '../../../../../shared/rpc-contract/accounts-params'

export const CLAUDE_ACCOUNT_NAME_METHODS = [
  defineMethod({
    name: 'accounts.renameClaude',
    permission: 'accounts-admin',
    params: RenameClaudeAccountParams,
    handler: async (params, { runtime }) =>
      runtime.renameClaudeAccount(params.accountId, params.label)
  })
] as const
