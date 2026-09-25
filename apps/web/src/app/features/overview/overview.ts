import { httpResource } from '@angular/common/http';
import { Component, computed, inject } from '@angular/core';
import {
  monthlyBreakdown,
  monthsBetween,
  monthTotals,
  netWorth,
  netWorthChange,
  spendingByCategory,
  type Transaction,
} from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { RouterLink } from '@angular/router';
import { Clock } from '../../core/clock';
import { FinanceStore } from '../../core/data/finance-store';
import { LoanPlanner } from '../../core/data/loan-planner';
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
  private readonly planner = inject(LoanPlanner);

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
      loanBudgetCents: this.store.settings()?.loanBudgetCents ?? null,
      strategy: this.store.settings()?.strategy ?? 'avalanche',
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
    const plan = this.planner.plan();
    if (!plan) return null;
    if (plan.stuck || !plan.debtFreeMonth) return { stuck: true as const };
    return {
      stuck: false as const,
      month: plan.debtFreeMonth,
      duration: formatDuration(this.t, monthsBetween(this.month, plan.debtFreeMonth) + 1),
    };
  });

  /** Nach „Fällige übernehmen“: Buchungen des Monats neu laden. */
  protected onBooked() {
    this.monthTx.reload();
    void this.planner.refresh();
  }
}
