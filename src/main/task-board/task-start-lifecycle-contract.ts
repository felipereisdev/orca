import type { AgentSessionStatusEvent } from '../../shared/agent-session/agent-session-wire'
import type { PtyLivenessVerdict } from '../../shared/terminal/pty/lifecycle/pty-liveness-verdict'
import type { TaskStartRunStore } from './task-start-run-store'

export type OrchestratorLiveness = 'alive' | 'gone' | 'unverifiable'

export type TaskStartLifecycleDeps = {
  store: TaskStartRunStore
  /** False for an SSH host that is not connected, or a host this process cannot observe. */
  hostReachable(hostId: string): boolean
  terminal: {
    /** Null when the handle names no PTY; throws while the graph reloads. */
    ptyIdForHandle(handle: string): string | null
    /** `gone` only once the graph is ready and nothing (leaf, PTY or saved tab) holds the pane. */
    paneBinding(paneKey: string, worktreeId: string): 'unknown' | 'gone' | { ptyId: string | null }
    /** The owning host's verdict; null makes no claim. */
    ptyLiveness(ptyId: string): PtyLivenessVerdict | null
    /** The agent's own presence in a live PTY; null when nothing identifies it. */
    agentPresence(
      handle: string,
      exitedSince: number
    ): Promise<'live' | 'unverifiable' | 'exited' | null>
    /** Fires on any exit, certified or not (a dropped SSH relay too). */
    subscribeExit(ptyId: string, listener: () => void): () => void
    /** Confirmed agent exits in this PTY (the shell may live on). */
    subscribeAgentExited(ptyId: string, listener: () => void): () => void
  }
  chat: {
    /** From the structured-session authority: an idle chat is alive, a closed one gone. */
    liveness(sessionId: string): OrchestratorLiveness
    /** The session continuing this chat, its `/clear` successor included; null when unknown. */
    liveSessionId(sessionId: string): string | null
    subscribeTabHidden(listener: (sessionId: string) => void): () => void
    /** Null when no structured-session host is installed. */
    subscribeStatus(listener: (event: AgentSessionStatusEvent) => void): (() => void) | null
  }
  /** Bounds one reconcile; past it, runs are left as they are. */
  reconcileTimeoutMs?: number
}
