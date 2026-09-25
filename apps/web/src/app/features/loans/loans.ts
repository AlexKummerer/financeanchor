import { Component, DOCUMENT, computed, inject, signal, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { addMonths, simulatePayoff, type Loan, type Strategy } from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Clock } from '../../core/clock';
import { FinanceStore } from '../../core/data/finance-store';
import { Segmented } from '../../core/forms/segmented';
import { toCentsOrNull } from '../../core/forms/validators';
import { formatDuration } from '../../core/format/duration';
import { Formatter } from '../../core/format/formatter';
import { MoneyPipe, MonthPipe } from '../../core/format/pipes';
import { Dialogs } from '../../core/ui/dialogs';
import { ToastService } from '../../core/ui/toast.service';
import { LoanForm, type LoanFormValue } from './loan-form';

@Component({
  selector: 'fa-loans',
  imports: [ReactiveFormsModule, TranslocoPipe, MoneyPipe, MonthPipe, Segmented, LoanForm],
  templateUrl: './loans.html',
  styleUrl: './loans.css',
})
export class LoansPage {
  protected readonly store = inject(FinanceStore);
  private readonly clock = inject(Clock);
  private readonly t = inject(TranslocoService);
  protected readonly f = inject(Formatter);
  private readonly dialogs = inject(Dialogs);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);
  private readonly formRef = viewChild(LoanForm);

  protected readonly month = this.clock.month();
  protected readonly editing = signal<Loan | null>(null);
  protected readonly formOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly extraError = signal(false);

  protected readonly strategy = new FormControl<Strategy>(
    this.store.settings()?.strategy ?? 'avalanche',
    { nonNullable: true },
  );
  protected readonly strategyOptions = computed(() => [
    { value: 'avalanche' as const, label: this.t.translate('loans.avalanche') },
    { value: 'snowball' as const, label: this.t.translate('loans.snowball') },
  ]);
  protected readonly extraText = computed(() => {
    const c = this.store.settings()?.extraPaymentCents ?? 0;
    return c ? this.f.amountInput(c) : '';
  });

  protected readonly sim = computed(() => {
    const s = this.store.settings();
    return simulatePayoff(
      this.store.loans.items(),
      s?.extraPaymentCents ?? 0,
      s?.strategy ?? 'avalanche',
    );
  });
  protected readonly payoff = computed(() => {
    const sim = this.sim();
    if (!sim || sim.stuck) return null;
    return {
      month: addMonths(this.month, sim.months),
      duration: formatDuration(this.t, sim.months),
      interest: sim.totalInterestCents,
    };
  });
  protected readonly rows = computed(() => {
    const sim = this.sim();
    return this.store.loans.items().map((loan) => {
      const orig = loan.originalCents || loan.balanceCents;
      const paidPct =
        orig > 0 ? Math.min(100, Math.max(0, (1 - loan.balanceCents / orig) * 100)) : 0;
      const done = sim?.payoffMonthById[loan.id];
      return {
        loan,
        paidPct,
        paidRounded: Math.round(paidPct),
        showPaid: loan.originalCents > loan.balanceCents,
        payoffMonth: done != null ? addMonths(this.month, done) : null,
      };
    });
  });

  constructor() {
    this.strategy.valueChanges.subscribe((strategy) => void this.saveSettings({ strategy }));
  }

  protected saveExtra(value: string) {
    const cents = toCentsOrNull(value);
    const invalid = value.trim() !== '' && (cents === null || cents < 0);
    this.extraError.set(invalid);
    if (!invalid) void this.saveSettings({ extraPaymentCents: cents ?? 0 });
  }

  private async saveSettings(patch: { strategy?: Strategy; extraPaymentCents?: number }) {
    try {
      await this.store.updateSettings(patch);
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    }
  }

  protected edit(loan: Loan) {
    this.editing.set(loan);
    this.formOpen.set(true);
    queueMicrotask(() => this.document.getElementById('ln-balance')?.focus());
  }

  protected async save(v: LoanFormValue) {
    this.saving.set(true);
    try {
      const current = this.editing();
      if (current) {
        await this.store.loans.update(current.id, v);
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
