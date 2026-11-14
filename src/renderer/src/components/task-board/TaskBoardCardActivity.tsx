import React from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  GitBranch,
  GitPullRequest,
  MessageSquare
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  TaskBoardChecks,
  TaskBoardWireCard
} from '../../../../shared/task-board/task-board-wire-types'

const CHECK_ICONS: Record<Exclude<TaskBoardChecks, 'none'>, typeof CheckCircle2> = {
  success: CheckCircle2,
  failure: AlertCircle,
  pending: Clock3
}
const CHECK_TONES: Record<Exclude<TaskBoardChecks, 'none'>, string> = {
  success: 'text-emerald-600 dark:text-emerald-400',
  failure: 'text-rose-600 dark:text-rose-400',
  pending: 'text-amber-600 dark:text-amber-400'
}

/** The workspace's branch, commits ahead, review and checks; the host sends it only for started cards. */
function TaskBoardCardProgress({
  progress
}: {
  progress: NonNullable<TaskBoardWireCard['progress']>
}): React.JSX.Element {
  const t = useTranslate()
  const { branch, commitsAhead, review, checks } = progress
  const CheckIcon = checks === 'none' ? null : CHECK_ICONS[checks]
  return (
    <div className="mt-1.5 flex min-w-0 items-center gap-2 text-3xs text-muted-foreground">
      {branch ? (
        <span className="flex min-w-0 items-center gap-1 font-mono">
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">{branch}</span>
        </span>
      ) : null}
      {commitsAhead ? (
        <span className="shrink-0">
          {t('taskBoard.commitsAhead', '{{count}} ahead', { count: commitsAhead })}
        </span>
      ) : null}
      {review ? (
        <span className="flex shrink-0 items-center gap-0.5">
          <GitPullRequest className="size-3" />
          <span>#{review.number}</span>
        </span>
      ) : null}
      {CheckIcon && checks !== 'none' ? (
        <span className={cn('flex shrink-0 items-center', CHECK_TONES[checks])}>
          <CheckIcon className="size-3" />
          <span className="sr-only">
            {checks === 'success'
              ? t('taskBoard.checksPassed', 'Checks passed')
              : checks === 'failure'
                ? t('taskBoard.checksFailed', 'Checks failed')
                : t('taskBoard.checksPending', 'Checks pending')}
          </span>
        </span>
      ) : null}
    </div>
  )
}

/** The newest comment, with how many the user has not seen yet. */
function TaskBoardCardComments({
  latest,
  unread
}: {
  latest: TaskBoardWireCard['latestComment']
  unread: number
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-3xs text-muted-foreground">
      <MessageSquare className="size-3 shrink-0" />
      {latest ? (
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-foreground">{latest.author}</span> {latest.excerpt}
        </span>
      ) : (
        <span className="min-w-0 flex-1" />
      )}
      {unread > 0 ? (
        <Badge
          variant="count"
          aria-label={t('taskBoard.unreadComments', '{{count}} unread comments', {
            count: unread
          })}
        >
          {unread}
        </Badge>
      ) : null}
    </div>
  )
}

/** What happened on a started card since it was picked up; nothing for cards the host did not enrich. */
export function TaskBoardCardActivity({ card }: { card: TaskBoardWireCard }): React.JSX.Element {
  const unread = card.unreadComments ?? 0
  return (
    <>
      {card.progress ? <TaskBoardCardProgress progress={card.progress} /> : null}
      {card.latestComment || unread > 0 ? (
        <TaskBoardCardComments latest={card.latestComment} unread={unread} />
      ) : null}
    </>
  )
}
