import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { DialogCancel, DialogError, DialogWarning } from '@/components/ui/dialog-parts'
import { useTranslate } from '@/i18n/use-translate'
import type {
  RecipeRemovalCheckResult,
  RecipeRemovalCopyFailure,
  RecipeRemovalPreflight
} from '../../../../../../shared/remote-runtime/ephemeral-vm-recipes/recipe-removal-preflight'
import {
  ackMap,
  type RecipeRemovalAcks,
  type RecipeRemovalCandidate,
  type RecipeRemovalResult
} from '@/runtime/ephemeral-vm/recipe-removal-preflights'
import {
  recipeRemovalCopyErrorText,
  recipeRemovalLossLines,
  recipeRemovalReasonText
} from './recipe-removal-preflight-copy'

/** "Remove anyway": main makes each undecided answer usable only now, at the user's word. */
async function confirmAnyway(results: readonly RecipeRemovalResult[]): Promise<RecipeRemovalAcks> {
  await Promise.all(
    results
      .filter((result) => result.preflight.status !== 'clean' && result.preflight.ack)
      .map((result) =>
        window.api.ephemeralVm.confirmRemoval({ ack: result.preflight.ack }).catch(() => false)
      )
  )
  return ackMap(results)
}

function RemoveFooter({
  busy,
  primaryCopy,
  onRemoveAnyway,
  children
}: {
  busy: boolean
  primaryCopy: boolean
  onRemoveAnyway: () => void
  children?: ReactNode
}): JSX.Element {
  const t = useTranslate()
  return (
    <DialogFooter>
      <DialogCancel disabled={busy}>
        {t('workspaceDeletion.recipeCheck.cancel', 'Cancel')}
      </DialogCancel>
      <Button
        size="sm"
        variant={primaryCopy ? 'outline' : 'destructive'}
        disabled={busy}
        onClick={onRemoveAnyway}
      >
        {t('workspaceDeletion.recipeCheck.removeAnyway', 'Remove anyway')}
      </Button>
      {children}
    </DialogFooter>
  )
}

function PreflightSummary({ preflight }: { preflight: RecipeRemovalPreflight }): JSX.Element {
  const t = useTranslate()
  const lossLines = recipeRemovalLossLines(preflight, t)
  return (
    <>
      {preflight.status === 'unchecked' ? (
        <p className="text-[13px] text-muted-foreground">
          {recipeRemovalReasonText(preflight.reason, t)}
        </p>
      ) : null}
      {lossLines.length > 0 ? (
        <ul className="list-disc pl-5 text-[13px] text-muted-foreground">
          {lossLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

/** Busy while `work` runs; even a rejected call gives close and retry back. */
async function whileBusy(
  markBusy: (busy: boolean) => void,
  work: () => Promise<void>
): Promise<void> {
  markBusy(true)
  try {
    await work()
  } finally {
    markBusy(false)
  }
}

/** Hands the decided acks on; resolves once the removal they start holds its claim (or not). */
type RemoveWith = (acks: RecipeRemovalAcks) => Promise<void>

type Decision =
  | { kind: 'remove'; acks: RecipeRemovalAcks }
  | { kind: 'failed'; reason: RecipeRemovalCopyFailure }
  /** Recordings still arrived during the copy: show the new counts instead of removing. */
  | { kind: 'pending'; preflight: RecipeRemovalCheckResult }

function SingleWorkspacePanel({
  candidate,
  preflight: checked,
  sessionId,
  onCopyAck,
  onRemove,
  onBusyChange
}: {
  candidate: RecipeRemovalCandidate
  preflight: RecipeRemovalCheckResult
  /** The copy's ack joins the dialog's session, so closing revokes it with the rest. */
  sessionId?: string
  onCopyAck?: (ack: string) => void
  onRemove: RemoveWith
  onBusyChange?: (busy: boolean) => void
}): JSX.Element {
  const t = useTranslate()
  const [preflight, setPreflight] = useState(checked)
  const [busy, setBusy] = useState(false)
  const [copyError, setCopyError] = useState<RecipeRemovalCopyFailure | null>(null)
  // A dialog closed or retargeted mid-decision must never remove afterwards.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      onBusyChange?.(false)
    }
  }, [onBusyChange])
  const canCopy =
    preflight.status === 'unsafe' &&
    (preflight.recordingsNotCopied.length > 0 || preflight.recordingInProgress === true)

  const markBusy = (next: boolean): void => {
    // A closed panel only lets go of the dialog (its unmount already did); it never re-renders.
    if (next || mounted.current) {
      setBusy(next)
      onBusyChange?.(next)
    }
  }
  const decide = (run: () => Promise<Decision>): Promise<void> =>
    whileBusy(markBusy, async () => {
      setCopyError(null)
      const outcome = await run()
      if (!mounted.current) {
        return
      }
      if (outcome.kind === 'remove') {
        // Busy until the removal holds its claim, so the dialog can't be dismissed under it.
        await onRemove(outcome.acks)
      } else if (outcome.kind === 'failed') {
        setCopyError(outcome.reason)
      } else {
        setPreflight(outcome.preflight)
      }
    })

  const copyAndRemove = async (): Promise<Decision> => {
    const result = await window.api.ephemeralVm
      .copyRecordingsBeforeRemoval({ ...candidate.request, ...(sessionId ? { sessionId } : {}) })
      .catch(() => ({ ok: false as const, reason: 'unreachable' as const }))
    if (result.ok) {
      onCopyAck?.(result.ack)
      // The copy proved nothing is pending; its ack is the one the removal spends.
      return { kind: 'remove', acks: new Map([[candidate.key, result.ack]]) }
    }
    if (result.reason === 'still_pending') {
      onCopyAck?.(result.preflight.ack)
      return { kind: 'pending', preflight: result.preflight }
    }
    return { kind: 'failed', reason: result.reason }
  }

  return (
    <>
      <div className="flex min-w-0 flex-col gap-1.5" data-recipe-removal-check={preflight.status}>
        <DialogWarning>
          {preflight.status === 'unchecked'
            ? t('workspaceDeletion.recipeCheck.uncheckedTitle', "Couldn't verify this workspace")
            : t(
                'workspaceDeletion.recipeCheck.unsafeTitle',
                'This workspace has work that is not safe yet:'
              )}
        </DialogWarning>
        <PreflightSummary preflight={preflight} />
      </div>
      {copyError ? <DialogError>{recipeRemovalCopyErrorText(copyError, t)}</DialogError> : null}
      <RemoveFooter
        busy={busy}
        primaryCopy={canCopy}
        onRemoveAnyway={() =>
          void decide(async () => ({
            kind: 'remove',
            acks: await confirmAnyway([{ candidate, preflight }])
          }))
        }
      >
        {canCopy ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => void decide(copyAndRemove)}
          >
            {busy
              ? t('workspaceDeletion.recipeCheck.copying', 'Copying recordings…')
              : t('workspaceDeletion.recipeCheck.copyAndRemove', 'Copy recordings and remove')}
          </Button>
        ) : null}
      </RemoveFooter>
    </>
  )
}

function AggregatePanel({
  results,
  onRemove,
  onBusyChange
}: {
  results: RecipeRemovalResult[]
  onRemove: RemoveWith
  onBusyChange?: (busy: boolean) => void
}): JSX.Element {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const markBusy = (next: boolean): void => {
    setBusy(next)
    onBusyChange?.(next)
  }
  const removeAnyway = (): Promise<void> =>
    whileBusy(markBusy, async () => onRemove(await confirmAnyway(results)))
  return (
    <>
      <div className="flex min-w-0 flex-col gap-1.5" data-recipe-removal-check="aggregate">
        <DialogWarning>
          {t(
            'workspaceDeletion.recipeCheck.aggregateTitle',
            'Some of these workspaces have work that is not safe yet:'
          )}
        </DialogWarning>
        {results
          .filter((result) => result.preflight.status !== 'clean')
          .map(({ candidate, preflight }) => (
            <div key={candidate.key} className="min-w-0">
              <p className="text-[13px] font-medium break-words text-foreground">
                {candidate.displayName}
                {preflight.status === 'unchecked'
                  ? ` — ${t('workspaceDeletion.recipeCheck.uncheckedTitle', "Couldn't verify this workspace")}`
                  : null}
              </p>
              <PreflightSummary preflight={preflight} />
            </div>
          ))}
      </div>
      <RemoveFooter busy={busy} primaryCopy={false} onRemoveAnyway={() => void removeAnyway()} />
    </>
  )
}

export function RecipeRemovalResultsPanel({
  results,
  single,
  onCopyAck,
  onRemove,
  onBusyChange
}: {
  results: RecipeRemovalResult[]
  single: boolean
  onCopyAck?: (ack: string) => void
  onRemove: RemoveWith
  onBusyChange?: (busy: boolean) => void
}): JSX.Element | null {
  const notClean = results.filter((result) => result.preflight.status !== 'clean')
  if (notClean.length === 0) {
    return null
  }
  if (single && results.length === 1) {
    const [only] = results
    return (
      <SingleWorkspacePanel
        key={only.candidate.key}
        candidate={only.candidate}
        preflight={only.preflight}
        sessionId={only.sessionId}
        onCopyAck={onCopyAck}
        onRemove={onRemove}
        onBusyChange={onBusyChange}
      />
    )
  }
  return <AggregatePanel results={results} onRemove={onRemove} onBusyChange={onBusyChange} />
}
