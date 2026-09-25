import { Pipe, inject, type PipeTransform } from '@angular/core';
import type { Cents, IsoDate, YearMonth } from '@financeanchor/shared';
import { Formatter } from './formatter';

// Nicht rein, weil die Ausgabe von der aktiven Sprache abhängt (Signal im Formatter).

@Pipe({ name: 'money', pure: false })
export class MoneyPipe implements PipeTransform {
  private readonly f = inject(Formatter);
  transform(cents: Cents | null | undefined, whole = false): string {
    return cents == null ? '–' : this.f.money(cents, whole);
  }
}

@Pipe({ name: 'faDate', pure: false })
export class DatePipe implements PipeTransform {
  private readonly f = inject(Formatter);
  transform(
    iso: IsoDate | null | undefined,
    style: 'short' | 'dayMonth' | 'long' = 'short',
  ): string {
    return iso ? this.f.date(iso, style) : '';
  }
}

@Pipe({ name: 'faMonth', pure: false })
export class MonthPipe implements PipeTransform {
  private readonly f = inject(Formatter);
  transform(
    ym: YearMonth | null | undefined,
    style: 'long' | 'short' | 'longNoYear' | 'shortNoYear' = 'long',
  ): string {
    return ym ? this.f.month(ym, style) : '';
  }
}
