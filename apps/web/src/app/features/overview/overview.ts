import { httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import {
  addMonths,
  allocateMonth,
  bookedBreakdown,
  monthlyBreakdown,
  monthsBetween,
  monthTotals,
  netWorth,
  netWorthChange,
  spendingByCategory,
  type Transaction,
  type YearMonth,
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

  /** Laufender Monat */
  protected readonly today = this.clock.month();
  /** Angezeigter Monat (vor- und zurückblättern) */
  protected readonly month = signal<YearMonth>(this.today);
  protected readonly isCurrent = computed(() => this.month() === this.today);
  protected readonly monthTx = httpResource<Transaction[]>(
    () => `/api/transactions?month=${this.month()}`,
    {
      defaultValue: [],
    },
  );

  /** Tatsächlich gebucht im laufenden Monat, aufgeteilt wie der Plan */
  protected readonly booked = computed(() =>
    bookedBreakdown(this.monthTx.value(), this.store.items.items(), this.month()),
  );

  /**
   * Voraussichtlich im laufenden Monat. Kredite: schon Gebuchtes plus noch Offenes, damit die Zahl
   * vor und nach „Fällige übernehmen“ gleich bleibt.
   */
  protected readonly breakdown = computed(() => {
    // Laufender und künftige Monate: noch Offenes laut Plan; vergangene: nur Gebuchtes
    const month = this.month();
    const planned = this.planner.plan()?.months.find((m) => m.month === month);
    const booked = this.booked().loanCents;
    // Vergangener Monat ohne gebuchte Raten: was laut Plan fällig gewesen wäre
    const openLoans =
      month >= this.today
        ? (planned?.paidCents ?? 0)
        : booked === 0
          ? allocateMonth(this.store.loans.items(), month).paidCents
          : 0;
    return monthlyBreakdown({
      items: this.store.items.items(),
      pots: this.store.pots.items(),
      loans: this.store.loans.items(),
      month,
      loanCents: booked + openLoans,
    });
  });

  /** Zeilen „voraussichtlich / gebucht“; Ausgaben als positive Beträge */
  protected readonly compare = computed(() => {
    const p = this.breakdown();
    const b = this.booked();
    return [
      { key: 'income', plan: p.incomeCents, booked: b.incomeCents },
      { key: 'fixed', plan: p.fixedCents, booked: b.fixedCents },
      { key: 'reserve', plan: p.reserveCents, booked: b.reserveCents },
      { key: 'loans', plan: p.loanCents, booked: b.loanCents },
      { key: 'saving', plan: p.savingCents, booked: b.savingCents },
      { key: 'other', plan: null, booked: b.otherCents },
    ];
  });

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

  protected readonly totals = computed(() => monthTotals(this.monthTx.value(), this.month()));
  protected readonly spending = computed(() => {
    const rows = spendingByCategory(this.monthTx.value(), this.month());
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
      duration: formatDuration(this.t, monthsBetween(this.today, plan.debtFreeMonth) + 1),
    };
  });

  constructor() {
    // Buchungsstand der Kredite kann sich seit dem letzten Laden geändert haben
    void this.planner.refresh();
  }

  /** Vorzeichen für die Tabelle; bei 0 keins */
  protected sign(key: string, cents: number): string {
    if (cents === 0) return '';
    return key === 'income' ? '+' : '−';
  }

  protected shiftMonth(n: number) {
    this.month.update((m) => addMonths(m, n));
  }

  /** Nach „Fällige übernehmen“: Buchungen des Monats neu laden. */
  protected onBooked() {
    this.monthTx.reload();
    void this.planner.refresh();
  }
}
