import { Component, computed, inject, input, output } from '@angular/core';
import {
  budgetUsed,
  daysBetween,
  deadlineMonthOf,
  monthsUntil,
  paymentToPayOff,
  type Loan,
  type LoanPlan,
} from '@financeanchor/shared';
import { TranslocoPipe } from '@jsverse/transloco';
import { Clock } from '../../core/clock';
import { Formatter } from '../../core/format/formatter';
import { DatePipe, MoneyPipe, MonthPipe } from '../../core/format/pipes';
import { ScenarioTable } from './scenario-table';
import { ScheduleTable } from './schedule-table';

/** Ein Kredit mit Fortschritt, Frist-Status, Rate dieses Monats, Beispielrechnung und Tilgungsplan. */
@Component({
  selector: 'fa-loan-card',
  imports: [TranslocoPipe, MoneyPipe, MonthPipe, DatePipe, ScenarioTable, ScheduleTable],
  templateUrl: './loan-card.html',
  styleUrl: './loan-card.css',
})
export class LoanCard {
  readonly loan = input.required<Loan>();
  readonly plan = input.required<LoanPlan | null>();
  /** Monatsrate im laufenden Monat schon gebucht */
  readonly bookedThisMonth = input(false);
  readonly edit = output<void>();
  readonly remove = output<void>();

  private readonly clock = inject(Clock);
  protected readonly f = inject(Formatter);
  protected readonly month = this.clock.month();

  protected readonly isLump = computed(
    () => this.loan().kind === 'deadline' && this.loan().paymentMode === 'lump',
  );
  protected readonly deadline = computed(() => deadlineMonthOf(this.loan()));
  protected readonly paidPct = computed(() => {
    const l = this.loan();
    const orig = l.originalCents || l.balanceCents;
    return orig > 0 ? Math.round(Math.min(100, Math.max(0, (1 - l.balanceCents / orig) * 100))) : 0;
  });
  protected readonly payoffMonth = computed(
    () => this.plan()?.payoffMonthById[this.loan().id] ?? null,
  );
  protected readonly deadlineStatus = computed(
    () => this.plan()?.deadlines[this.loan().id] ?? null,
  );
  /** Rate, die für die Frist nötig ist (für sich allein betrachtet). */
  protected readonly neededMonthly = computed(() => {
    const l = this.loan();
    const d = this.deadline();
    if (!d || this.isLump() || l.balanceCents <= 0) return null;
    return paymentToPayOff(l.balanceCents, l.rateBp, monthsUntil(this.month, d));
  });
  /** Beim Ratenkredit mit Ziel: Aufstockung über die Bankrate hinaus. */
  protected readonly targetTopUp = computed(() => {
    const need = this.neededMonthly();
    const rate = this.loan().paymentCents;
    return this.loan().kind === 'installment' && need !== null && rate !== null
      ? need - rate
      : null;
  });
  /** Einmalzahlung: pro Monat zurückzulegen bis zur Fälligkeit. */
  protected readonly savingMonthly = computed(() => {
    const l = this.loan();
    const d = this.deadline();
    if (!this.isLump() || !d || l.balanceCents <= 0) return null;
    const rest = Math.max(0, l.balanceCents - l.savedCents);
    return Math.ceil(rest / monthsUntil(this.month, d));
  });
  protected readonly daysLeft = computed(() => {
    const due = this.loan().dueDate;
    return due ? daysBetween(this.clock.today(), due) : null;
  });
  protected readonly thisMonth = computed(() => {
    const m = this.plan()?.months[0];
    if (!m || m.month !== this.month) return null;
    const x = m.loans.find((l) => l.id === this.loan().id);
    return x ? budgetUsed(x) : null;
  });
}
