import { ShieldCheck, ShieldAlert, Plug, Save } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { useTranslate } from '@/i18n/use-translate'
import type { DatabaseRuntimeClient } from '@/runtime/database/database-runtime-client'
import type { DatabaseSettingsOptions } from '../../../../../shared/database/database-settings-options'
import { useDatabaseConnectionDraft } from './use-database-connection-draft'
import { DatabaseConnectionFields } from './DatabaseConnectionFields'
import { DatabaseConnectionScopeFields } from './DatabaseConnectionScopeFields'

export function DatabaseConnectionSheet({
  client,
  connectionId,
  options,
  onClose,
  onSaved
}: {
  client: DatabaseRuntimeClient
  connectionId: string | null
  options: DatabaseSettingsOptions
  onClose(): void
  onSaved(): void
}) {
  const t = useTranslate()
  const confirm = useConfirmationDialog()
  const form = useDatabaseConnectionDraft(client, connectionId, options)
  async function close() {
    if (form.saving) {
      return
    }
    if (
      form.dirty &&
      !(await confirm({
        title: t('database.form.discardTitle', 'Discard connection changes?'),
        description: t(
          'database.form.discardHelp',
          'The unsaved changes and entered credentials will be discarded'
        ),
        confirmLabel: t('database.form.discard', 'Discard'),
        cancelVariant: 'ghost',
        compact: true
      }))
    ) {
      return
    }
    onClose()
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) {
          void close()
        }
      }}
    >
      <SheetContent className="w-full sm:max-w-xl" showCloseButton={!form.saving}>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b">
            <SheetHeader>
              <SheetTitle>
                {connectionId
                  ? t('database.form.edit', 'Edit connection')
                  : t('database.form.add', 'New connection')}
              </SheetTitle>
              <SheetDescription>
                {t(
                  'database.form.description',
                  'Register an environment once and associate it with projects'
                )}
              </SheetDescription>
            </SheetHeader>
          </div>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault()
              void form.save().then((saved) => {
                if (saved) {
                  onSaved()
                }
              })
            }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto p-6 scrollbar-sleek">
              {form.loading ? (
                <p className="text-sm text-muted-foreground">
                  {t('database.loading', 'Loading connection…')}
                </p>
              ) : connectionId && !form.original ? null : (
                <fieldset disabled={form.pending} className="space-y-6">
                  <DatabaseConnectionScopeFields form={form} options={options} />
                  <DatabaseConnectionFields form={form} />
                </fieldset>
              )}
              {form.error ? (
                <p role="alert" className="mt-4 text-sm text-destructive">
                  {form.error}
                </p>
              ) : null}
              {form.test ? (
                <div role="status" className="mt-4 flex items-start gap-2 text-sm">
                  {form.original?.accessMode === 'read-write' || form.test.readOnlyProfile ? (
                    <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                  )}
                  <p>
                    {form.original?.accessMode === 'read-write'
                      ? t('database.form.writeConnected', 'Connected · Read and write')
                      : form.test.readOnlyProfile
                        ? t(
                            'database.form.verified',
                            'Connection and read-only account profile verified'
                          )
                        : t(
                            'database.form.notVerified',
                            'The account does not match the read-only profile'
                          )}
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {form.test.serverVersion}
                    </span>
                  </p>
                </div>
              ) : null}
            </div>
            <footer className="space-y-2 border-t p-4">
              {form.dirty || !form.original ? (
                <p className="text-xs text-muted-foreground">
                  {t('database.form.saveBeforeTest', 'Save changes before testing the connection')}
                </p>
              ) : null}
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={form.pending || form.dirty || !form.original}
                  onClick={() => void form.testSaved()}
                >
                  {form.testing && form.showPending ? (
                    <LoadingSpinner className="size-4" />
                  ) : (
                    <Plug className="size-4" />
                  )}
                  {t('database.form.testSaved', 'Test saved connection')}
                </Button>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={form.saving}
                    onClick={() => void close()}
                  >
                    {t('database.cancel', 'Cancel')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      (!form.dirty && Boolean(form.original)) ||
                      (Boolean(connectionId) && !form.original) ||
                      form.pending ||
                      !form.capabilities?.protectedCredentialStorage ||
                      !form.capabilities.engines.includes(form.draft.engine)
                    }
                  >
                    {form.saving && form.showPending ? (
                      <LoadingSpinner className="size-4" />
                    ) : (
                      <Save className="size-4" />
                    )}
                    {t('database.form.save', 'Save connection')}
                  </Button>
                </div>
              </div>
            </footer>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  )
}
