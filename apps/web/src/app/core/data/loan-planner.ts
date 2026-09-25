import { Service, computed, inject, signal } from '@angular/core';
import { loanAdvice, planLoans, type AllocateOptions } from '@financeanchor/shared';
import { Clock } from '../clock';
import { DueApi } from './due-api';
import { FinanceStore } from './finance-store';

/**
 * Tilgungsplan ab dem laufenden Monat mit genau den vereinbarten und selbst festgelegten Zahlungen,
 * dazu Vorschläge aus dem verfügbaren Geld. Was diesen Monat schon gebucht ist, steckt bereits in
 * den Restschulden und wird nicht doppelt eingeplant.
 */
@Service()
export class LoanPlanner {
  private readonly store = inject(FinanceStore);
  private readonly clock = inject(Clock);
  private readonly dueApi = inject(DueApi);

  readonly month = this.clock.month();
  private readonly bookedThisMonth = signal<AllocateOptions>({});

  /** Kredite, deren Monatsrate im laufenden Monat schon gebucht ist. */
  readonly settledIds = computed(() => this.bookedThisMonth().settled ?? new Set<string>());

  readonly plan = computed(() =>
    planLoans(this.store.loans.items(), {
      startMonth: this.month,
      firstMonth: this.bookedThisMonth(),
    }),
  );

  /** Geplante Zahlungen des laufenden Monats nach Art. */
  readonly thisMonth = computed(() => {
    const m = this.plan()?.months[0];
    if (!m || m.month !== this.month) return null;
    const loans = m.loans;
    const sum = (f: (l: (typeof loans)[number]) => number) => loans.reduce((s, l) => s + f(l), 0);
    return {
      regularCents: sum((l) => l.regularCents),
      deadlineCents: sum((l) => l.deadlineCents + l.savingCents),
      extraCents: sum((l) => l.extraCents),
    };
  });

  /** Vorschläge; ändern nichts am Plan, solange sie nicht übernommen werden. */
  readonly advice = computed(() => {
    const s = this.store.settings();
    return loanAdvice(this.store.loans.items(), {
      month: this.month,
      availableCents: s?.loanBudgetCents ?? null,
    });
  });

  constructor() {
    void this.refresh();
  }

  /** Nach „Fällige übernehmen“ oder gelöschten Kreditbuchungen neu laden. */
  async refresh(): Promise<void> {
    try {
      const entries = await this.dueApi.plan(this.month, this.clock.today());
      const booked = entries.filter(
        (e) => e.booked && (e.type === 'loan' || e.type === 'extra' || e.type === 'saving'),
      );
      this.bookedThisMonth.set({
        settled: new Set(
          booked.filter((e) => e.type === 'loan' || e.type === 'saving').map((e) => e.sourceId),
        ),
        noExtra: booked.some((e) => e.type === 'extra'),
      });
    } catch {
      // Ohne Buchungsstand wird ab dem vollen Monat gerechnet.
    }
  }
}
