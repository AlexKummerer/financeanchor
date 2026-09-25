import { Component, DOCUMENT, computed, inject, signal, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { monthsBetween, requiredThisMonth, type Loan, type Strategy } from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { FinanceStore } from '../../core/data/finance-store';
import { LoanPlanner } from '../../core/data/loan-planner';
import { Segmented } from '../../core/forms/segmented';
import { toCentsOrNull } from '../../core/forms/validators';
import { formatDuration } from '../../core/format/duration';
import { Formatter } from '../../core/format/formatter';
import { MoneyPipe, MonthPipe } from '../../core/format/pipes';
import { Dialogs } from '../../core/ui/dialogs';
import { ToastService } from '../../core/ui/toast.service';
import { AllocationTable } from './allocation-table';
import { LoanCard } from './loan-card';
import { LoanForm, type LoanFormValue } from './loan-form';

@Component({
  selector: 'fa-loans',
  imports: [
    ReactiveFormsModule,
    TranslocoPipe,
    MoneyPipe,
    MonthPipe,
    Segmented,
    LoanForm,
    LoanCard,
    AllocationTable,
  ],
  templateUrl: './loans.html',
  styleUrl: './loans.css',
})
export class LoansPage {
  protected readonly store = inject(FinanceStore);
  protected readonly planner = inject(LoanPlanner);
  private readonly t = inject(TranslocoService);
  private readonly f = inject(Formatter);
  private readonly dialogs = inject(Dialogs);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);
  private readonly formRef = viewChild(LoanForm);

  protected readonly month = this.planner.month;
  protected readonly editing = signal<Loan | null>(null);
  protected readonly formOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly budgetError = signal(false);

  protected readonly strategy = new FormControl<Strategy>(
    this.store.settings()?.strategy ?? 'avalanche',
    {
      nonNullable: true,
    },
  );
  protected readonly strategyOptions = computed(() => [
    { value: 'avalanche' as const, label: this.t.translate('loans.avalanche') },
    { value: 'snowball' as const, label: this.t.translate('loans.snowball') },
  ]);

  protected readonly budget = computed(() => this.store.settings()?.loanBudgetCents ?? null);
  protected readonly budgetText = computed(() => {
    const b = this.budget();
    return b === null ? '' : this.f.amountInput(b);
  });
  /** Mindestbudget: Pflichtraten und Fristen in diesem Monat (ohne schon Gebuchtes zu berücksichtigen). */
  protected readonly required = computed(() =>
    requiredThisMonth(this.store.loans.items(), this.month),
  );
  protected readonly requiredText = computed(() => this.f.amountInput(this.required()));

  protected readonly payoff = computed(() => {
    const plan = this.planner.plan();
    if (!plan || plan.stuck || !plan.debtFreeMonth) return null;
    return {
      month: plan.debtFreeMonth,
      duration: formatDuration(this.t, monthsBetween(this.month, plan.debtFreeMonth) + 1),
      interest: plan.totalInterestCents,
    };
  });
  protected readonly openLoans = computed(() =>
    this.store.loans.items().filter((l) => l.balanceCents > 0),
  );

  constructor() {
    this.strategy.valueChanges.subscribe((strategy) => void this.saveSettings({ strategy }));
  }

  protected saveBudget(value: string) {
    const cents = toCentsOrNull(value);
    const invalid = value.trim() !== '' && (cents === null || cents < 0);
    this.budgetError.set(invalid);
    if (!invalid) void this.saveSettings({ loanBudgetCents: cents });
  }

  private async saveSettings(patch: { strategy?: Strategy; loanBudgetCents?: number | null }) {
    try {
      await this.store.updateSettings(patch);
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    }
  }

  protected edit(loan: Loan) {
    this.editing.set(loan);
    this.formOpen.set(true);
    queueMicrotask(() => this.document.getElementById('ln-name')?.focus());
  }

  protected async save(v: LoanFormValue) {
    this.saving.set(true);
    try {
      const current = this.editing();
      if (current) {
        const { kind, ...rest } = v;
        await this.store.loans.update(current.id, { kind, ...rest });
        this.editing.set(null);
        this.toast.show(this.t.translate('loans.updated'));
      } else {
        await this.store.loans.create(v);
        this.formRef()?.clear();
        this.toast.show(this.t.translate('loans.saved'));
      }
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(loan: Loan) {
    const ok = await this.dialogs.confirm({
      title: this.t.translate('loans.deleteTitle', { name: loan.name }),
      message: this.t.translate('recurring.deleteText'),
      confirmLabel: this.t.translate('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await this.store.loans.remove(loan.id);
      if (this.editing()?.id === loan.id) this.editing.set(null);
      this.toast.show(this.t.translate('tx.deleted'));
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    }
  }
}
