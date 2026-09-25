import { Service, computed, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { toSignal } from '@angular/core/rxjs-interop';
import type { Cents, IsoDate, YearMonth } from '@financeanchor/shared';

const LOCALES: Record<string, string> = { de: 'de-DE', en: 'en-GB' };

/** Formatierung von Beträgen und Daten für die aktive Sprache. Beträge kommen immer in Cent. */
@Service()
export class Formatter {
  private readonly lang = toSignal(inject(TranslocoService).langChanges$, { initialValue: 'de' });
  readonly locale = computed(() => LOCALES[this.lang()] ?? 'de-DE');

  private readonly money2 = computed(
    () => new Intl.NumberFormat(this.locale(), { style: 'currency', currency: 'EUR' }),
  );
  private readonly money0 = computed(
    () =>
      new Intl.NumberFormat(this.locale(), {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }),
  );

  /** `whole` rundet für große Übersichtszahlen auf ganze Euro (nur Anzeige). */
  money(cents: Cents, whole = false): string {
    return (whole ? this.money0() : this.money2()).format(cents / 100);
  }

  /** Betrag für Eingabefelder, ohne Währung („1234,56“). */
  amountInput(cents: Cents): string {
    return new Intl.NumberFormat(this.locale(), {
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
      useGrouping: false,
    }).format(cents / 100);
  }

  percent(basisPoints: number): string {
    return new Intl.NumberFormat(this.locale(), { maximumFractionDigits: 2 }).format(
      basisPoints / 100,
    );
  }

  date(iso: IsoDate, style: 'short' | 'dayMonth' | 'long' = 'short'): string {
    const d = new Date(`${iso}T12:00:00Z`);
    const opts: Intl.DateTimeFormatOptions =
      style === 'dayMonth'
        ? { day: '2-digit', month: '2-digit', timeZone: 'UTC' }
        : style === 'long'
          ? { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
          : { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' };
    return new Intl.DateTimeFormat(this.locale(), opts).format(d);
  }

  month(ym: YearMonth, style: 'long' | 'short' | 'longNoYear' | 'shortNoYear' = 'long'): string {
    const d = new Date(`${ym}-15T12:00:00Z`);
    const month = style.startsWith('long') ? 'long' : 'short';
    const opts: Intl.DateTimeFormatOptions = style.endsWith('NoYear')
      ? { month, timeZone: 'UTC' }
      : { month, year: 'numeric', timeZone: 'UTC' };
    return new Intl.DateTimeFormat(this.locale(), opts).format(d);
  }
}
