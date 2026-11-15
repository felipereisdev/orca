import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseExecutionHostId } from '../../../../src/shared/execution-host'
import type { TaskBoardWireCard } from '../../../../src/shared/task-board/task-board-wire-types'
import type { TaskStartRunSummary } from '../../../../src/shared/task-board/task-start-run'
import { useOptionalHostProtocolGates } from '../../components/host-protocol-gates-context'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { hostStackRouteHref, type HostStackRouteHref } from '../../navigation/host-stack-navigation'
import { readHostStatusReply } from '../../query/host-status-query'
import { readProbedHostCapabilities } from '../../transport/connection/host-status-probe-operations'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { mobileSessionRouteTarget } from '../../session/mobile-session-route'
import type { TaskBoardSheet } from './MobileTaskBoardCardSheets'
import type { TaskBoardRunActions } from './MobileTaskBoardCardRun'
import { hostServesTaskStart } from './task-board-capability'
import { startTask, stopTask, type TaskStartParams } from './task-board-operations'
import { taskStartErrorMessage } from './task-board-run-labels'

/** "Start as…" choices for one start; the confirmation sheet keeps them for its retry. */
export type TaskStartChoices = Omit<TaskStartParams, 'ref' | 'confirmPrimary'>

export type TaskStartAsStatus = { pending: boolean; error: string | null }

/** The orchestrator's session: its pane on the host, or a `runtime:` server's own workspace. */
export function taskStartRunSessionHref(
  hostId: string,
  run: TaskStartRunSummary
): HostStackRouteHref | null {
  const worktreeId = run.orchestrator?.worktreeId ?? run.worktreeId
  if (!worktreeId) {
    return null
  }
  const server = parseExecutionHostId(run.orchestrator?.hostId)
  return hostStackRouteHref(
    mobileSessionRouteTarget({
      hostId,
      worktreeId,
      ...(run.orchestrator?.paneKey ? { paneKey: run.orchestrator.paneKey } : {}),
      ...(server?.kind === 'runtime' ? { executionHost: server.id } : {})
    })
  )
}

/** The host announced task start; until a status reads, older hosts keep ▶︎/⏹ hidden. */
function useHostServesTaskStart(client: RpcClient | null, connected: boolean): boolean {
  const gates = useOptionalHostProtocolGates()
  const [probed, setProbed] = useState<readonly string[] | null>(null)
  const fromGates = gates && !gates.statusPending ? gates.hostCapabilities : null
  useEffect(() => {
    if (fromGates || !client || !connected) {
      return
    }
    let current = true
    void readHostStatusReply(client)
      .then((reply) => {
        if (current) {
          setProbed(readProbedHostCapabilities(reply))
        }
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [client, connected, fromGates])
  return hostServesTaskStart(fromGates ?? probed)
}

/** Starts, stops and opens task-start runs on the board's host, as the desktop board does. */
export function useTaskBoardStart(args: {
  hostId: string
  client: RpcClient | null
  connected: boolean
  onSheet: (sheet: TaskBoardSheet | null) => void
  /** The host's list again, so the card shows the run's current state. */
  rereadRuns: () => void
  notify: (message: string) => void
  openHref: (href: HostStackRouteHref) => void
}) {
  const { hostId, client, connected, onSheet, rereadRuns, notify, openHref } = args
  const t = useMobileTranslation()
  const supported = useHostServesTaskStart(client, connected)
  const [pendingRefKeys, setPendingRefKeys] = useState<ReadonlySet<string>>(new Set())
  const [startAs, setStartAs] = useState<TaskStartAsStatus>({ pending: false, error: null })
  const pendingRef = useRef(new Set<string>())

  const setPending = useCallback((refKey: string, pending: boolean): void => {
    if (pending) {
      pendingRef.current.add(refKey)
    } else {
      pendingRef.current.delete(refKey)
    }
    setPendingRefKeys(new Set(pendingRef.current))
  }, [])

  // Null while the host is out of reach: every start and stop needs it.
  const reachable = useCallback((): RpcClient | null => {
    if (!client || !connected) {
      notify(t('tasks.board.start.offline', 'Starting or stopping a task needs the host.'))
      return null
    }
    return client
  }, [client, connected, notify, t])

  const openRun = useCallback(
    (run: TaskStartRunSummary): void => {
      const href = taskStartRunSessionHref(hostId, run)
      if (href) {
        openHref(href)
      }
    },
    [hostId, openHref]
  )

  /** `fromSheet` keeps "Start as…" open to show an error the user can act on there. */
  const start = useCallback(
    async (
      card: TaskBoardWireCard,
      choices: TaskStartChoices & { confirmPrimary?: boolean },
      fromSheet: boolean
    ) => {
      const live = reachable()
      if (!live || pendingRef.current.has(card.refKey)) {
        return
      }
      setPending(card.refKey, true)
      if (fromSheet) {
        setStartAs({ pending: true, error: null })
      }
      const fail = (message: string): void => {
        if (fromSheet) {
          setStartAs({ pending: false, error: message })
        } else {
          notify(message)
        }
      }
      try {
        const result = await startTask(live, { ref: card.ref, ...choices })
        if (result.ok) {
          setStartAs({ pending: false, error: null })
          onSheet(null)
          openRun(result.run)
          return
        }
        if (result.error === 'repo_unresolved') {
          setStartAs({ pending: false, error: null })
          onSheet({ kind: 'start-as', card, repoRequired: true })
          return
        }
        if (result.error === 'primary_needs_confirmation') {
          const { confirmPrimary: _confirmed, ...rest } = choices
          setStartAs({ pending: false, error: null })
          onSheet({ kind: 'confirm-primary', card, choices: rest, reasons: result.reasons ?? [] })
          return
        }
        const message = taskStartErrorMessage(result.error, t)
        if (result.error === 'already_running' || result.error === 'primary_busy') {
          setStartAs({ pending: false, error: null })
          onSheet(null)
          notify(message)
          return
        }
        fail(message)
      } catch (cause) {
        fail(
          cause instanceof Error && cause.message
            ? cause.message
            : t('tasks.board.start.error.startFailed', 'Could not start the task.')
        )
      } finally {
        setPending(card.refKey, false)
        rereadRuns()
      }
    },
    [notify, onSheet, openRun, reachable, rereadRuns, setPending, t]
  )

  const stop = useCallback(
    async (card: TaskBoardWireCard) => {
      const live = reachable()
      if (!live || pendingRef.current.has(card.refKey)) {
        return
      }
      setPending(card.refKey, true)
      try {
        await stopTask(live, { ref: card.ref })
      } catch (cause) {
        notify(
          cause instanceof Error && cause.message
            ? cause.message
            : t('tasks.board.start.error.stopFailed', 'Could not stop the task.')
        )
      } finally {
        setPending(card.refKey, false)
        rereadRuns()
      }
    },
    [notify, reachable, rereadRuns, setPending, t]
  )

  const askStop = useCallback(
    async (card: TaskBoardWireCard) => {
      // The user already confirmed this stop; a repeat retries what was left unproven.
      if (card.taskStart?.state === 'stopping') {
        await stop(card)
        return
      }
      const live = reachable()
      if (!live || pendingRef.current.has(card.refKey)) {
        return
      }
      setPending(card.refKey, true)
      let workers: number | null = null
      try {
        const preview = await stopTask(live, { ref: card.ref, preview: true })
        workers = preview.agents === undefined ? null : Math.max(0, preview.agents - 1)
      } catch {
        // The confirmation still opens; it just cannot name how many agents stop.
      } finally {
        setPending(card.refKey, false)
      }
      onSheet({ kind: 'confirm-stop', card, workers })
    },
    [onSheet, reachable, setPending, stop]
  )

  const actions = useMemo<TaskBoardRunActions | null>(
    () =>
      supported
        ? {
            pendingRefKeys,
            onStart: (card) => void start(card, {}, false),
            onStop: (card) => void askStop(card),
            onOpenRun: (card) => {
              if (card.taskStart) {
                openRun(card.taskStart)
              }
            }
          }
        : null,
    [askStop, openRun, pendingRefKeys, start, supported]
  )

  return {
    actions,
    startAs,
    openStartAs: (card: TaskBoardWireCard) => {
      setStartAs({ pending: false, error: null })
      onSheet({ kind: 'start-as', card, repoRequired: false })
    },
    submitStartAs: (card: TaskBoardWireCard, choices: TaskStartChoices) =>
      void start(card, choices, true),
    confirmPrimary: (card: TaskBoardWireCard, choices: TaskStartChoices) => {
      onSheet(null)
      void start(card, { ...choices, confirmPrimary: true }, false)
    },
    confirmStop: (card: TaskBoardWireCard) => {
      onSheet(null)
      void stop(card)
    }
  }
}

export type TaskBoardStart = ReturnType<typeof useTaskBoardStart>
