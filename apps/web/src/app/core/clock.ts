import { Service } from '@angular/core';
import type { IsoDate, YearMonth } from '@financeanchor/shared';

/** Aktuelles Datum in der Zeitzone des Geräts; in Tests ersetzbar. */
@Service()
export class Clock {
  now(): Date {
    return new Date();
  }

  today(): IsoDate {
    const d = this.now();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  month(): YearMonth {
    return this.today().slice(0, 7);
  }
}
