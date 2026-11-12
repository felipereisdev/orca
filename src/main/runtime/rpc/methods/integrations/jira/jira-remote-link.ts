import { AddRemoteLink } from '../../../../../../shared/rpc-contract/jira-remote-link-params'
import { addRemoteLink } from '../../../../../jira/jira-remote-link'
import { defineMethod } from '../../../core'

export const JIRA_REMOTE_LINK_METHODS = [
  defineMethod({
    name: 'jira.addRemoteLink',
    permission: 'workspace',
    params: AddRemoteLink,
    handler: (params) => addRemoteLink(params)
  })
]
