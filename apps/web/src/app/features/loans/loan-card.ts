import { Component, computed, inject, input, output } from '@angular/core';
import {
  budgetUsed,
  daysBetween,
  deadlineMonthOf,
  extraNeededForTarget,
  monthsUntil,
  requiredMonthly,
  type Loan,
  type LoanPlan,
} from '@financeanchor/shared';
import { TranslocoPipe } from '@jsverse/transloco';
import { Clock } from '../../core/clock';
import { LoanPlanner } from '../../core/data/loan-planner';
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
  /** Neue feste Extra-Tilgung pro Monat */
  readonly setExtra = output<number>();

  private readonly clock = inject(Clock);
  private readonly planner = inject(LoanPlanner);
  protected readonly f = inject(Formatter);
  protected readonly month = this.clock.month();
  /** Monat, für den geplant wird (nächster, wenn der laufende schon ganz gebucht ist) */
  protected readonly planMonth = computed(() => this.planner.adviceMonth());

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
  /** Bei „Tilgen bis Datum“ mit Teilzahlungen: nötige Rate bis zur Frist. */
  protected readonly neededMonthly = computed(() => {
    const l = this.loan();
    if (l.kind !== 'deadline' || this.isLump() || l.balanceCents <= 0) return null;
    return requiredMonthly(l, this.planMonth());
  });
  /** Ratenkredit mit Ziel: fehlender Betrag pro Monat (0 = Ziel wird erreicht). */
  protected readonly targetGap = computed(() =>
    extraNeededForTarget(this.loan(), this.planMonth()),
  );
  /** Übernehmen nur, wenn die Lücke ins übrige verfügbare Geld passt (oder nichts eingetragen ist). */
  protected readonly gapFits = computed(() => {
    const free = this.planner.advice().freeCents;
    return free === null || (this.targetGap() ?? 0) <= free;
  });
  /** Einmalzahlung: pro Monat zurückzulegen bis zur Fälligkeit. */
  protected readonly savingMonthly = computed(() => {
    const l = this.loan();
    const d = this.deadline();
    if (!this.isLump() || !d || l.balanceCents <= 0) return null;
    const rest = Math.max(0, l.balanceCents - l.savedCents);
    return Math.ceil(rest / monthsUntil(this.planMonth(), d));
  });

  /** Beispielrechnung übernommen: Extra-Tilgung = Monatsbetrag minus Pflichtbetrag. */
  protected adoptScenario(monthlyCents: number) {
    this.setExtra.emit(Math.max(0, monthlyCents - requiredMonthly(this.loan(), this.planMonth())));
  }

  protected adoptTargetGap() {
    this.setExtra.emit(this.loan().extraMonthlyCents + (this.targetGap() ?? 0));
  }

  protected readonly daysLeft = computed(() => {
    const due = this.loan().dueDate;
    return due ? daysBetween(this.clock.today(), due) : null;
  });
  protected readonly thisMonth = computed(() => {
    const m = this.plan()?.months.find((x) => x.month === this.planMonth());
    if (!m) return null;
    const x = m.loans.find((l) => l.id === this.loan().id);
    return x ? budgetUsed(x) : null;
  });
}
