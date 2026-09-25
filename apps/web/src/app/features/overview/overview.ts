import { httpResource } from '@angular/common/http';
import { Component, computed, inject } from '@angular/core';
import {
  addMonths,
  monthlyBreakdown,
  monthTotals,
  netWorth,
  netWorthChange,
  simulatePayoff,
  spendingByCategory,
  type Transaction,
} from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { RouterLink } from '@angular/router';
import { Clock } from '../../core/clock';
import { FinanceStore } from '../../core/data/finance-store';
import { formatDuration } from '../../core/format/duration';
import { Formatter } from '../../core/format/formatter';
import { DatePipe, MoneyPipe, MonthPipe } from '../../core/format/pipes';
import { DuePanel } from './due-panel';
import { FlowBar } from './flow-bar';

@Component({
  selector: 'fa-overview',
  imports: [TranslocoPipe, MoneyPipe, MonthPipe, DatePipe, FlowBar, DuePanel, RouterLink],
  templateUrl: './overview.html',
  styleUrl: './overview.css',
})
export class OverviewPage {
  protected readonly store = inject(FinanceStore);
  private readonly clock = inject(Clock);
  private readonly t = inject(TranslocoService);
  private readonly f = inject(Formatter);

  protected readonly month = this.clock.month();
  protected readonly monthTx = httpResource<Transaction[]>(
    () => `/api/transactions?month=${this.month}`,
    {
      defaultValue: [],
    },
  );

  protected readonly breakdown = computed(() =>
    monthlyBreakdown({
      items: this.store.items.items(),
      pots: this.store.pots.items(),
      loans: this.store.loans.items(),
      extraPaymentCents: this.store.settings()?.extraPaymentCents ?? 0,
      month: this.month,
    }),
  );

  protected readonly flowSummary = computed(() => {
    const b = this.breakdown();
    const m = (c: number) => this.f.money(c, true);
    return this.t.translate('overview.flowSummary', {
      income: m(b.incomeCents),
      fixed: m(b.fixedCents),
      reserve: m(b.reserveCents),
      loans: m(b.loanCents),
      saving: m(b.savingCents),
      free: m(b.freeCents),
    });
  });

  protected readonly worth = computed(() =>
    netWorth(this.store.accounts.items(), this.store.loans.items()),
  );
  protected readonly worthChange = computed(() => netWorthChange(this.store.snapshots.items()));
  protected readonly openLoans = computed(
    () => this.store.loans.items().filter((l) => l.balanceCents > 0).length,
  );

  protected readonly totals = computed(() => monthTotals(this.monthTx.value(), this.month));
  protected readonly spending = computed(() => {
    const rows = spendingByCategory(this.monthTx.value(), this.month);
    const max = rows[0]?.amountCents ?? 1;
    return rows.map((r) => ({
      ...r,
      name: this.store.categoryName(r.categoryId),
      share: (r.amountCents / max) * 100,
    }));
  });

  protected readonly payoff = computed(() => {
    const s = this.store.settings();
    const sim = simulatePayoff(
      this.store.loans.items(),
      s?.extraPaymentCents ?? 0,
      s?.strategy ?? 'avalanche',
    );
    if (!sim) return null;
    return sim.stuck
      ? { stuck: true as const }
      : {
          stuck: false as const,
          month: addMonths(this.month, sim.months),
          duration: formatDuration(this.t, sim.months),
        };
  });

  /** Nach „Fällige übernehmen“: Buchungen des Monats neu laden. */
  protected onBooked() {
    this.monthTx.reload();
  }
}
