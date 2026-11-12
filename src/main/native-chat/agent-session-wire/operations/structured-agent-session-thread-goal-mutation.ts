import type {
  AgentSessionMutationEnvelope,
  AgentSessionMutationResult
} from '../../../../shared/agent-session/agent-session-wire'
import type {
  AgentSessionThreadGoalChange,
  AgentSessionThreadGoalResult
} from '../../../../shared/agent-session/agent-session-thread-goal-wire'
import type { StructuredAgentSessionCaller } from '../host/structured-agent-session-host-types'
import {
  runStructuredAgentSessionMutation,
  type StructuredAgentSessionMutationContext
} from './structured-agent-session-mutation-context'
import { runWithReadyStructuredAgentSessionOperation } from './structured-agent-session-ready-operation'
import { openWithReadyStructuredAgentSessionChild } from './structured-agent-session-operation-child'
import { refuseThreadGoalUnsupported, threadGoalPlan } from './structured-agent-session-thread-goal'

export async function changeStructuredAgentSessionThreadGoal(
  context: StructuredAgentSessionMutationContext,
  caller: StructuredAgentSessionCaller,
  params: { envelope: AgentSessionMutationEnvelope; change: AgentSessionThreadGoalChange }
): Promise<AgentSessionMutationResult<AgentSessionThreadGoalResult>> {
  const plan = threadGoalPlan(params)
  return runWithReadyStructuredAgentSessionOperation(
    context,
    caller.callerKey,
    params.envelope,
    plan,
    (selection) =>
      runStructuredAgentSessionMutation(
        context,
        caller,
        params.envelope,
        threadGoalPlan({ ...params, signal: selection.signal }),
        openWithReadyStructuredAgentSessionChild(context, params.envelope, selection)
      ),
    {
      goal: true,
      beforeAgent: (record) =>
        refuseThreadGoalUnsupported(context.deps.adapter, context.deps.agents, record?.provider)
    }
  )
}
