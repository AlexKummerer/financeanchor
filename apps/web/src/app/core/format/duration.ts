import type { TranslocoService } from '@jsverse/transloco';

/**
 * „2 Jahren 3 Monaten“ bzw. „sofort“, mit Einzahl/Mehrzahl über i18n-Schlüssel.
 * Steht immer nach „in …“, daher im Deutschen im Dativ.
 */
export function formatDuration(t: TranslocoService, months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts: string[] = [];
  if (y) parts.push(t.translate(y === 1 ? 'duration.year' : 'duration.years', { n: y }));
  if (m) parts.push(t.translate(m === 1 ? 'duration.month' : 'duration.months', { n: m }));
  return parts.length ? parts.join(' ') : t.translate('duration.now');
}
