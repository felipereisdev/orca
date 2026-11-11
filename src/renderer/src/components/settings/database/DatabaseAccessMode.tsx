// @protected-copy: database write access changes agent permissions.
import { Label } from '@/components/ui/label'
import { SecuritySurface } from '@/components/ui/security-surface'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
import type { DatabaseConnectionDraftController } from './use-database-connection-draft'

export function DatabaseAccessMode({ form }: { form: DatabaseConnectionDraftController }) {
  const t = useTranslate()
  return (
    <SecuritySurface>
      <div className="space-y-2">
        <Label htmlFor="database-access-mode">{t('database.form.accessMode', 'Access mode')}</Label>
        <Select
          value={form.draft.accessMode}
          onValueChange={(value) => {
            if (value === 'read-only' || value === 'read-write') {
              form.update('accessMode', value)
            }
          }}
        >
          <SelectTrigger
            id="database-access-mode"
            className="h-9 w-full"
            aria-describedby="database-access-mode-help"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="read-only">{t('database.access.readOnly', 'Read only')}</SelectItem>
            <SelectItem value="read-write">
              {t('database.access.readWrite', 'Read and write')}
            </SelectItem>
          </SelectContent>
        </Select>
        <p id="database-access-mode-help" className="text-xs text-muted-foreground">
          {form.draft.accessMode === 'read-write'
            ? t(
                'database.form.writeHelp',
                'Agents can modify data and structure, run routines, and execute any SQL allowed by this account. Changes may be committed immediately.'
              )
            : t(
                'database.form.readHelp',
                'Only supported read-only queries and a verified read-only account are allowed.'
              )}
        </p>
      </div>
    </SecuritySurface>
  )
}
