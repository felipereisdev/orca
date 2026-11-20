import { uiNumberFormat } from '@/i18n/ui-intl-formatters'

// Intl formatter caches key on option identity, so these must be module constants.
const PERCENT_FORMAT: Intl.NumberFormatOptions = { style: 'percent', maximumFractionDigits: 1 }
const byteUnit = (unit: string): Intl.NumberFormatOptions => ({
  style: 'unit',
  unit,
  unitDisplay: 'short',
  maximumFractionDigits: 1
})
// Decimal steps, matching the SI unit names Intl prints (kB, MB, GB).
const BYTE_UNITS: readonly [number, Intl.NumberFormatOptions][] = [
  [1e12, byteUnit('terabyte')],
  [1e9, byteUnit('gigabyte')],
  [1e6, byteUnit('megabyte')],
  [1e3, byteUnit('kilobyte')]
]
const BYTE_FORMAT = byteUnit('byte')

/** "12.5%" in the UI language; a recipe may report more than 100 on several cores. */
export function formatEphemeralVmCpuPercent(percent: number, intlLocale?: string): string {
  return uiNumberFormat(PERCENT_FORMAT, intlLocale).format(percent / 100)
}

/** "1.5 GB", "340 MB" in the UI language. */
export function formatEphemeralVmBytes(bytes: number, intlLocale?: string): string {
  const [size, format] = BYTE_UNITS.find(([unitSize]) => bytes >= unitSize) ?? [1, BYTE_FORMAT]
  return uiNumberFormat(format, intlLocale).format(bytes / size)
}
