import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { SettingsSubsectionHeader } from '../form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'
import type { DatabaseConnectionDraftController } from './use-database-connection-draft'
import { databaseEngineNames } from './database-connection-draft'
import { databaseConnectionSchema } from '../../../../../shared/database/database-configuration-schema'

export function DatabaseConnectionFields({ form }: { form: DatabaseConnectionDraftController }) {
  const t = useTranslate()
  const { draft, update } = form
  const engines = databaseConnectionSchema.shape.engine.options
    .filter((engine) => engine === draft.engine || form.capabilities?.engines.includes(engine))
    .map((engine) => ({ id: engine, label: databaseEngineNames[engine] }))
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="database-name">{t('database.form.name', 'Name')}</Label>
          <Input
            id="database-name"
            aria-invalid={form.invalidFields.has('displayName')}
            required
            maxLength={160}
            value={draft.displayName}
            onChange={(event) => update('displayName', event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="database-alias">{t('database.form.alias', 'Mention alias')}</Label>
          <Input
            id="database-alias"
            aria-invalid={form.invalidFields.has('alias')}
            required
            autoFocus
            maxLength={96}
            pattern="[a-z][a-z0-9-]*"
            placeholder={t('database.form.aliasPlaceholder', 'faturacao-hmg')}
            value={draft.alias}
            onChange={(event) => update('alias', event.target.value)}
            variant="code"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="database-engine">{t('database.form.engine', 'Database type')}</Label>
          <Select
            value={draft.engine}
            onValueChange={(value) => {
              const engine = engines.find(({ id }) => id === value)?.id
              if (engine) {
                update('engine', engine)
                if (!form.original) {
                  update(
                    'port',
                    String(engine === 'postgres' ? 5432 : engine === 'sql-server' ? 1433 : 1521)
                  )
                }
              }
            }}
          >
            <SelectTrigger id="database-engine">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {engines.map(({ id, label }) => (
                <SelectItem key={id} value={id} disabled={!form.capabilities?.engines.includes(id)}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="database-environment">
            {t('database.form.environment', 'Environment')}
          </Label>
          <Input
            id="database-environment"
            aria-invalid={form.invalidFields.has('environment')}
            required
            maxLength={80}
            placeholder={t('database.form.environmentPlaceholder', 'HMG')}
            value={draft.environment}
            onChange={(event) => update('environment', event.target.value)}
          />
        </div>
      </div>
      <div className="space-y-3">
        <SettingsSubsectionHeader title={t('database.form.endpoint', 'Connection')} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="database-server">{t('database.form.server', 'Server')}</Label>
            <Input
              id="database-server"
              aria-invalid={form.invalidFields.has('server')}
              required
              maxLength={253}
              value={draft.server}
              onChange={(event) => update('server', event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="database-port">{t('database.form.port', 'Port')}</Label>
            <Input
              id="database-port"
              aria-invalid={form.invalidFields.has('port')}
              required
              type="number"
              min={1}
              max={65535}
              value={draft.port}
              onChange={(event) => update('port', event.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="database-database">
            {draft.engine === 'oracle'
              ? t('database.form.service', 'Service name')
              : t('database.form.database', 'Database')}
          </Label>
          <Input
            id="database-database"
            aria-invalid={form.invalidFields.has('database')}
            required
            maxLength={128}
            value={draft.database}
            onChange={(event) => update('database', event.target.value)}
            autoComplete="off"
          />
        </div>
      </div>
      <div className="space-y-3">
        <SettingsSubsectionHeader
          title={t('database.form.credentials', 'Credentials')}
          description={
            form.original
              ? t(
                  'database.form.keepCredentials',
                  'Leave both fields blank to keep the stored credentials'
                )
              : t('database.form.readAccount', 'Use a dedicated read-only account')
          }
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="database-username">{t('database.form.username', 'Username')}</Label>
            <Input
              id="database-username"
              aria-invalid={form.invalidFields.has('username')}
              required={!form.original}
              maxLength={256}
              value={draft.username}
              onChange={(event) => update('username', event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="database-password">{t('database.form.password', 'Password')}</Label>
            <Input
              id="database-password"
              aria-invalid={form.invalidFields.has('password')}
              required={!form.original}
              maxLength={8192}
              type="password"
              value={draft.password}
              onChange={(event) => update('password', event.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>
      </div>
      <details className="space-y-3">
        <summary className="cursor-pointer text-sm">
          {t('database.form.tls', 'TLS certificate settings')}
        </summary>
        <p className="text-xs text-muted-foreground">
          {t('database.form.tlsHelp', 'TLS and certificate verification are always enabled')}
        </p>
        <div className="space-y-2">
          <Label htmlFor="database-tls-name">
            {t('database.form.tlsName', 'Certificate server name (optional)')}
          </Label>
          <Input
            id="database-tls-name"
            aria-invalid={form.invalidFields.has('serverName')}
            value={draft.serverName}
            onChange={(event) => update('serverName', event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="database-ca">
            {t('database.form.ca', 'CA certificate in PEM format (optional)')}
          </Label>
          <Textarea
            id="database-ca"
            aria-invalid={form.invalidFields.has('caCertificate')}
            rows={4}
            maxLength={65536}
            value={draft.caCertificate}
            onChange={(event) => update('caCertificate', event.target.value)}
            variant="code"
          />
        </div>
      </details>
    </div>
  )
}
