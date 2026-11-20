import { Database } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type { NativeChatMentionChoice } from './native-chat-mention-items'
import type { NativeChatMentionFiles } from './use-native-chat-mention-files'
import { PickerOptionButton, PickerStatus } from './NativeChatPickerParts'

/** The `@` menu's database connections: after the files, so their option ids continue the files'. */
export function NativeChatDatabaseMentionOptions({
  mention,
  listboxId,
  selectedIndex,
  activeItemRef,
  onChoose
}: {
  mention: NativeChatMentionFiles
  listboxId: string
  selectedIndex: number
  activeItemRef: React.MutableRefObject<HTMLButtonElement | null>
  onChoose: (path: NativeChatMentionChoice) => void
}): React.JSX.Element {
  const t = useTranslate()
  const databases = mention.databases ?? []
  const first = mention.files.length
  return (
    <>
      {databases.length > 0 ? (
        <div className="px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {t('database.mention.connections', 'Database connections')}
        </div>
      ) : null}
      {databases.map((entry, offset) => (
        <PickerOptionButton
          key={entry.reference.connectionId}
          id={`${listboxId}-option-${first + offset}`}
          selected={selectedIndex === first + offset}
          activeItemRef={activeItemRef}
          onChoose={() => onChoose(entry.reference)}
        >
          <Database className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate">@{entry.reference.aliasAtSelection}</p>
            <p className="text-xs text-muted-foreground">
              {entry.engine} · {entry.environment} · {entry.executionHostId}
            </p>
          </div>
        </PickerOptionButton>
      ))}
      {mention.databasesLoading ? (
        <PickerStatus busy>
          {t('database.mention.loading', 'Loading database connections…')}
        </PickerStatus>
      ) : null}
      {mention.databasesError ? <PickerStatus>{mention.databasesError}</PickerStatus> : null}
    </>
  )
}
