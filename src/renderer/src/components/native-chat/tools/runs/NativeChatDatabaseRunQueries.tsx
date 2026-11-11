import { useEffect, useMemo, useState } from 'react'
import { useNativeChatVisualOwner } from '../../media/visuals/native-chat-visual-owner'
import { createDatabaseRuntimeClient } from '@/runtime/database/database-runtime-client'
import type { NativeChatBlock } from '../../../../../../shared/native-chat/native-chat-types'
import type { DatabaseQueryRecord } from '../../../../../../shared/database/database-query-contracts'
import { NativeChatDatabaseQueryCard } from './NativeChatDatabaseQueryCard'

export function NativeChatDatabaseRunQueries({ blocks }: { blocks: readonly NativeChatBlock[] }) {
  const owner = useNativeChatVisualOwner()
  const ids = [
    ...new Set(
      blocks.flatMap((block) =>
        block.type === 'tool-result'
          ? [
              ...block.output
                .slice(0, 65536)
                .matchAll(
                  /"queryId"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/gi
                )
            ].map((match) => match[1])
          : []
      )
    )
  ]
    .slice(0, 20)
    .join(',')
  const client = useMemo(() => owner && createDatabaseRuntimeClient(owner.target), [owner])
  const [state, setState] = useState<{
    identity: string
    controllerRuntimeId: string
    results: DatabaseQueryRecord[]
  }>()
  const identity = JSON.stringify([owner?.sessionId, owner?.worktreeId, ids])
  useEffect(() => {
    if (!client || !owner || !ids) {
      return
    }
    let current = true
    void Promise.all([
      client.status(),
      Promise.allSettled(
        ids
          .split(',')
          .map((id) =>
            client.sessionQueryRecord({ worktree: owner.worktreeId }, id, owner.sessionId)
          )
      )
    ])
      .then(([status, records]) => {
        if (current) {
          setState({
            identity,
            controllerRuntimeId: status.runtimeId,
            results: records.flatMap((record, index) =>
              record.status === 'fulfilled' &&
              record.value.queryId === ids.split(',')[index] &&
              record.value.sessionId === owner.sessionId
                ? [record.value]
                : []
            )
          })
        }
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [client, owner, ids, identity])
  if (!owner || state?.identity !== identity || !state.results.length) {
    return null
  }
  return (
    <div className="my-2 space-y-2">
      {state.results.map((result) => (
        <NativeChatDatabaseQueryCard
          key={result.queryId}
          worktreeId={owner.worktreeId}
          sessionId={owner.sessionId}
          controllerRuntimeId={state.controllerRuntimeId}
          queryId={result.queryId}
          source={result.source}
          status={result.status}
        />
      ))}
    </div>
  )
}
