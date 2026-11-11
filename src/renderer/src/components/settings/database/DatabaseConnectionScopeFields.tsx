import { HostCombobox } from '@/components/host-picker/HostCombobox'
import RepoMultiCombobox from '@/components/ui/repo-multi-combobox'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { databaseProjectIdentityKey } from '../../../../../shared/database/database-project-scope'
import type { DatabaseSettingsOptions } from '../../../../../shared/database/database-settings-options'
import type { DatabaseConnectionDraftController } from './use-database-connection-draft'
import { parseExecutionHostId } from '../../../../../shared/execution-host'
import { useTranslate } from '@/i18n/use-translate'

export function DatabaseConnectionScopeFields({
  form,
  options
}: {
  form: DatabaseConnectionDraftController
  options: DatabaseSettingsOptions
}) {
  const t = useTranslate()
  const selected = new Set(form.draft.projects.map(databaseProjectIdentityKey))
  const projects = options.projects.map((project) => ({
    ...project,
    id: project.key,
    displayName: project.label
  }))
  const hosts = options.hosts.map((host) => ({ id: host.executionHostId, label: host.label }))
  if (!hosts.some((host) => host.id === form.draft.executionHostId)) {
    hosts.push({ id: form.draft.executionHostId, label: form.draft.executionHostId })
  }
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="database-execution-host">
          {t('database.form.executionHost', 'Execute on')}
        </Label>
        <HostCombobox
          id="database-execution-host"
          ariaLabel={t('database.form.executionHost', 'Execute on')}
          value={form.draft.executionHostId}
          options={hosts}
          disabled={form.pending || Boolean(form.original)}
          onChange={(id) => {
            const host = parseExecutionHostId(id)
            if (host) {
              form.update('executionHostId', host.id)
            }
          }}
        />
        {form.original ? (
          <p className="text-xs text-muted-foreground">
            {t(
              'database.form.hostLocked',
              'Create a new connection to move credentials to another host'
            )}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label>{t('database.form.projects', 'Associated projects')}</Label>
        <RepoMultiCombobox
          repos={projects}
          triggerClassName="h-9"
          selected={selected}
          ariaLabel={t('database.form.projects', 'Associated projects')}
          allowEmpty
          onChange={(keys) =>
            form.update(
              'projects',
              options.projects
                .filter((project) => keys.has(project.key))
                .map((project) => project.project)
            )
          }
          onSelectAll={() =>
            form.update(
              'projects',
              options.projects.map((project) => project.project)
            )
          }
          getRepoHostLabel={(project) => project.project.executionHostId}
        />
        <p className="text-xs text-muted-foreground">
          {t(
            'database.form.projectHelp',
            'The same connection can be used by several projects, including folder workspaces'
          )}
        </p>
      </div>
      {form.hostChecking && form.showPending ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t('database.form.checkingHost', 'Checking execution host…')}
        </p>
      ) : null}
      {form.hostError || form.capabilities?.protectedCredentialStorage === false ? (
        <div role="alert" className="space-y-2 text-xs text-destructive">
          <p>
            {form.hostError ??
              t(
                'database.form.storageUnavailable',
                'Protected credential storage is unavailable on this host'
              )}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={form.retryHost}>
            {t('database.retry', 'Retry')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
