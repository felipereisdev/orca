// @protected-copy: certificate trust is a security decision.
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { SecuritySurface } from '@/components/ui/security-surface'
import { useTranslate } from '@/i18n/use-translate'

export function DatabaseCertificateTrust({
  checked,
  onChange
}: {
  checked: boolean
  onChange(value: boolean): void
}) {
  const t = useTranslate()
  return (
    <SecuritySurface>
      <div className="flex items-start gap-3">
        <Checkbox
          id="database-trust-server-certificate"
          className="mt-0.5"
          checked={checked}
          onCheckedChange={(value) => onChange(value === true)}
          aria-describedby="database-trust-server-certificate-help"
        />
        <div className="space-y-1">
          <Label htmlFor="database-trust-server-certificate">
            {t('database.form.trustServerCertificate', 'Trust server certificate')}
          </Label>
          <p id="database-trust-server-certificate-help" className="text-xs text-muted-foreground">
            {t(
              'database.form.trustServerCertificateHelp',
              'For local development. When enabled, encryption stays on but the server certificate is not verified.'
            )}
          </p>
        </div>
      </div>
    </SecuritySurface>
  )
}
