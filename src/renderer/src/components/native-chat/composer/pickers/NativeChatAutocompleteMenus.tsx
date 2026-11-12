import { PickerListbox, PickerOptionButton, PickerStatus } from './native-chat-picker-listbox'
import { nativeChatMentionChoices, type NativeChatMentionChoice } from './native-chat-mention-items'
import { memo, useEffect, useRef } from 'react'
import { Database, Package, RotateCcw } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { useUiLanguageRevision } from '@/i18n/use-ui-language-revision'
import type { SkillSourceKind } from '../../../../../../shared/skills'
import { FilenameFirstPath } from '@/components/file-path-cursor-tooltip'
import { FileTypeIcon } from '@/components/FileTypeIcon'
import type { ComposerAutocomplete } from '../../../../../../shared/native-chat/input/native-chat-composer-autocomplete'
import type { NativeChatPickerItem } from '../../../../../../shared/native-chat/input/native-chat-picker-items'
import type { NativeChatMentionFiles } from './use-native-chat-mention-files'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { localizeSlashCommandDescription } from './native-chat-slash-command-descriptions'
import { nativeChatPickerEmptyText } from './native-chat-picker-empty-text'

export const NativeChatPickerMenu = memo(function NativeChatPickerMenu({
  autocomplete,
  activeIndex,
  listboxId,
  onChoose,
  onRetry
}: {
  autocomplete: Extract<ComposerAutocomplete, { mode: 'slash' }>
  activeIndex: number
  listboxId: string
  onChoose: (item: NativeChatPickerItem) => void
  onRetry: () => void
}): React.JSX.Element {
  const t = useTranslate()
  useUiLanguageRevision()
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  const commands = autocomplete.items.filter(
    (item): item is Extract<NativeChatPickerItem, { kind: 'command' }> => item.kind === 'command'
  )
  const skills = autocomplete.items.filter(
    (item): item is Extract<NativeChatPickerItem, { kind: 'skill' }> => item.kind === 'skill'
  )

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, autocomplete.items])

  const hasSkillStatus =
    autocomplete.skillStatus === 'loading' || autocomplete.skillStatus === 'error'
  const showCommandsHeading = autocomplete.grouped && commands.length > 0
  const showSkillsHeading = autocomplete.grouped && (skills.length > 0 || hasSkillStatus)
  const noMatches =
    autocomplete.skillStatus === 'ready' && commands.length === 0 && skills.length === 0
  const checkingSkills = noMatches && autocomplete.skillsChecking && autocomplete.skillsEnabled
  const emptyText = noMatches ? nativeChatPickerEmptyText(autocomplete, t, checkingSkills) : null
  const collision = commands.find((item) => item.skillCollision)
  const duplicate = skills.find((item) => item.sources.length > 1)
  // One sentence for the line and the screen reader, so the two never disagree.
  const skillErrorText =
    autocomplete.skillErrorKind === 'unavailable'
      ? t(
          'components.native-chat.composer.skillsUnavailableHost',
          "Skills can't be listed in SSH chats"
        )
      : t('components.native-chat.composer.skillsLoadFailed', "Couldn't load skills")

  let optionIndex = 0
  return (
    <PickerListbox id={listboxId}>
      {showCommandsHeading ? <PickerGroupHeading kind="commands" /> : null}
      {commands.map((item) => {
        const index = optionIndex++
        return (
          <PickerOption
            key={item.id}
            item={item}
            index={index}
            activeIndex={activeIndex}
            listboxId={listboxId}
            activeItemRef={activeItemRef}
            onChoose={onChoose}
          />
        )
      })}
      {showSkillsHeading ? <PickerGroupHeading kind="skills" /> : null}
      {autocomplete.skillStatus === 'loading' ? (
        <PickerStatus busy>
          {t('components.native-chat.composer.loadingSkills', 'Loading skills...')}
        </PickerStatus>
      ) : null}
      {autocomplete.skillStatus === 'error' ? (
        <PickerStatus>
          <span className="min-w-0 flex-1">{skillErrorText}</span>
          {autocomplete.skillErrorKind !== 'unavailable' ? (
            <button
              type="button"
              onPointerDown={(event) => event.preventDefault()}
              onClick={onRetry}
              className="flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <RotateCcw className="size-3" />
              {t('components.native-chat.composer.retrySkills', 'Retry')}
            </button>
          ) : null}
        </PickerStatus>
      ) : null}
      {skills.map((item) => {
        const index = optionIndex++
        return (
          <PickerOption
            key={item.id}
            item={item}
            index={index}
            activeIndex={activeIndex}
            listboxId={listboxId}
            activeItemRef={activeItemRef}
            onChoose={onChoose}
          />
        )
      })}
      {noMatches ? <PickerStatus busy={checkingSkills}>{emptyText}</PickerStatus> : null}
      <div aria-live="polite" className="sr-only">
        {autocomplete.skillStatus === 'loading'
          ? t('components.native-chat.composer.loadingSkills', 'Loading skills...')
          : autocomplete.skillStatus === 'error'
            ? skillErrorText
            : emptyText
              ? emptyText
              : autocomplete.skillsEnabled
                ? [
                    t('components.native-chat.composer.skillsLoaded', 'Skills loaded'),
                    collision
                      ? getPickerAnnotation(collision, t)
                      : duplicate
                        ? getPickerAnnotation(duplicate, t)
                        : null
                  ]
                    .filter(Boolean)
                    .join('. ')
                : ''}
      </div>
    </PickerListbox>
  )
})

function PickerGroupHeading({ kind }: { kind: 'commands' | 'skills' }): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
      {kind === 'commands'
        ? t('components.native-chat.composer.commands', 'Commands')
        : t('components.native-chat.composer.skills', 'Skills')}
    </div>
  )
}

function PickerOption({
  item,
  index,
  activeIndex,
  listboxId,
  activeItemRef,
  onChoose
}: {
  item: NativeChatPickerItem
  index: number
  activeIndex: number
  listboxId: string
  activeItemRef: React.MutableRefObject<HTMLButtonElement | null>
  onChoose: (item: NativeChatPickerItem) => void
}): React.JSX.Element {
  const t = useTranslate()
  const annotation = getPickerAnnotation(item, t)
  const description =
    item.kind === 'command'
      ? localizeSlashCommandDescription(item.name, item.description)
      : item.description
  return (
    <PickerOptionButton
      id={`${listboxId}-option-${index}`}
      selected={index === activeIndex}
      activeItemRef={activeItemRef}
      onChoose={() => onChoose(item)}
    >
      {item.kind === 'skill' ? (
        <Package className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="min-w-0 truncate font-mono text-chat-code font-medium">
            {item.token}
          </span>
          {item.argumentHint ? (
            <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground">
              {item.argumentHint}
            </span>
          ) : null}
        </span>
        {description ? (
          <span className="block truncate text-xs text-muted-foreground">{description}</span>
        ) : null}
        {annotation ? (
          <span className="block break-all text-xs text-muted-foreground">{annotation}</span>
        ) : null}
      </span>
      {item.kind === 'skill' ? (
        <span className="shrink-0 pt-0.5 text-2xs text-muted-foreground">
          {scopeLabel(item.sources[0]?.sourceKind, t)}
        </span>
      ) : null}
    </PickerOptionButton>
  )
}

function getPickerAnnotation(item: NativeChatPickerItem, t: Translate = translate): string | null {
  if (item.kind === 'skill' && item.location) {
    return item.location
  }
  if (item.kind === 'command' && item.skillCollision) {
    return t(
      'components.native-chat.composer.skillCommandCollision',
      'Also a skill name - agent decides'
    )
  }
  if (item.kind === 'skill' && item.sources.length > 1) {
    // Use sourceCount because i18next treats count as pluralization input and these keys have no plural variants.
    return t(
      'components.native-chat.composer.skillMultipleSources',
      '{{sourceCount}} sources - agent resolves',
      { sourceCount: item.sources.length }
    )
  }
  return null
}

function scopeLabel(sourceKind: SkillSourceKind | undefined, t: Translate = translate): string {
  const labels: Record<string, string> = {
    repo: t('components.native-chat.composer.skillScopeProject', 'Project'),
    home: t('components.native-chat.composer.skillScopePersonal', 'Personal'),
    bundled: t('components.native-chat.composer.skillScopeBuiltIn', 'Built-in'),
    plugin: t('components.native-chat.composer.skillScopePlugin', 'Plugin')
  }
  return sourceKind ? (labels[sourceKind] ?? '') : ''
}

export const NativeChatMentionMenu = memo(function NativeChatMentionMenu({
  mention,
  activeIndex,
  listboxId,
  onChoose
}: {
  mention: NativeChatMentionFiles
  activeIndex: number
  listboxId: string
  onChoose: (path: NativeChatMentionChoice) => void
}): React.JSX.Element {
  const t = useTranslate()
  useUiLanguageRevision()
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  const selectedIndex = Math.min(activeIndex, nativeChatMentionChoices(mention).length - 1)

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, mention.files, mention.databases])

  const statusText =
    mention.files.length > 0
      ? null
      : mention.loading
        ? t('components.native-chat.composer.loadingFiles', 'Loading files...')
        : mention.failed
          ? t('components.native-chat.composer.filesLoadFailed', "Couldn't load files")
          : t('components.native-chat.composer.noFiles', 'No matching files')

  return (
    <PickerListbox id={listboxId}>
      {mention.files.length > 0 && (
        <div className="px-3 py-1 text-xs text-muted-foreground">
          {t('database.mention.files', 'Files')}
        </div>
      )}
      {mention.files.map((path, index) => (
        <PickerOptionButton
          key={path}
          id={`${listboxId}-option-${index}`}
          selected={index === selectedIndex}
          activeItemRef={activeItemRef}
          onChoose={() => onChoose(path)}
        >
          <FileTypeIcon
            filePath={path}
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          />
          <FilenameFirstPath path={path} />
        </PickerOptionButton>
      ))}
      {(mention.databases?.length ?? 0) > 0 && (
        <div className="px-3 py-1 text-xs text-muted-foreground">
          {t('database.mention.connections', 'Database connections')}
        </div>
      )}
      {mention.databases?.map((entry, offset) => (
        <PickerOptionButton
          key={entry.reference.connectionId}
          id={`${listboxId}-option-${mention.files.length + offset}`}
          selected={selectedIndex === mention.files.length + offset}
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
      {mention.databasesLoading && (
        <PickerStatus busy>
          {t('database.mention.loading', 'Loading database connections…')}
        </PickerStatus>
      )}
      {mention.databasesError && <PickerStatus>{mention.databasesError}</PickerStatus>}
      {statusText ? (
        <PickerStatus>
          {mention.loading ? <LoadingSpinner className="size-3.5" /> : null}
          {statusText}
        </PickerStatus>
      ) : null}
      <div aria-live="polite" className="sr-only">
        {statusText ?? ''}
      </div>
    </PickerListbox>
  )
})
