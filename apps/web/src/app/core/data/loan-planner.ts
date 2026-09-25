import { Service, computed, inject, signal } from '@angular/core';
import { planLoans, type AllocateOptions } from '@financeanchor/shared';
import { Clock } from '../clock';
import { DueApi } from './due-api';
import { FinanceStore } from './finance-store';

/**
 * Gemeinsamer Tilgungsplan ab dem laufenden Monat. Was in diesem Monat schon gebucht ist,
 * steckt bereits in den Restschulden und wird nicht doppelt eingeplant.
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

  readonly plan = computed(() => {
    const s = this.store.settings();
    return planLoans(this.store.loans.items(), {
      budgetCents: s?.loanBudgetCents ?? null,
      strategy: s?.strategy ?? 'avalanche',
      startMonth: this.month,
      firstMonth: this.bookedThisMonth(),
    });
  });

  /** Aufteilung des laufenden Monats nach Anteilen. */
  readonly thisMonth = computed(() => {
    const m = this.plan()?.months[0];
    if (!m || m.month !== this.month) return null;
    const loans = m.loans;
    const sum = (f: (l: (typeof loans)[number]) => number) => loans.reduce((s, l) => s + f(l), 0);
    return {
      regularCents: sum((l) => l.regularCents),
      deadlineCents: sum((l) => l.deadlineCents),
      extraCents: sum((l) => l.extraCents),
      shortfallCents: m.shortfallCents,
      byId: new Map(loans.map((l) => [l.id, l])),
    };
  });

  constructor() {
    void this.refresh();
  }

  /** Nach „Fällige übernehmen“ oder gelöschten Kreditbuchungen neu laden. */
  async refresh(): Promise<void> {
    try {
      const entries = await this.dueApi.plan(this.month, this.clock.today());
      const booked = entries.filter((e) => e.booked && (e.type === 'loan' || e.type === 'extra'));
      this.bookedThisMonth.set({
        settled: new Set(booked.filter((e) => e.type === 'loan').map((e) => e.sourceId)),
        spentCents: booked.reduce((s, e) => s + Math.abs(e.amountCents), 0),
        noExtra: booked.some((e) => e.type === 'extra'),
      });
    } catch {
      // Ohne Buchungsstand wird ab dem vollen Monat gerechnet.
    }
  }
}
