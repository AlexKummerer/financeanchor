import { Component, DOCUMENT, computed, inject, signal, viewChild } from '@angular/core';
import { loanTotals, monthsBetween, type Loan } from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { FinanceStore } from '../../core/data/finance-store';
import { LoanPlanner } from '../../core/data/loan-planner';
import { formatDuration } from '../../core/format/duration';
import { Formatter } from '../../core/format/formatter';
import { MoneyPipe, MonthPipe } from '../../core/format/pipes';
import { Dialogs } from '../../core/ui/dialogs';
import { ToastService } from '../../core/ui/toast.service';
import { AdvicePanel } from './advice-panel';
import { AllocationTable } from './allocation-table';
import { LoanCard } from './loan-card';
import { LoanForm, type LoanFormValue } from './loan-form';

@Component({
  selector: 'fa-loans',
  imports: [TranslocoPipe, MoneyPipe, MonthPipe, LoanForm, LoanCard, AllocationTable, AdvicePanel],
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

  constructor() {
    // Buchungsstand kann sich auf anderen Seiten geändert haben (Fällige übernehmen, Löschen)
    void this.planner.refresh();
  }

  protected readonly totals = computed(() => loanTotals(this.store.loans.items()));
  /** Zinsen im Planungsmonat */
  protected readonly monthInterest = computed(() => {
    const m = this.planner.plan()?.months.find((x) => x.month === this.planner.adviceMonth());
    return m ? m.loans.reduce((s, l) => s + l.interestCents, 0) : null;
  });

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

  /** Vorschlag übernehmen: wird zur festen Extra-Tilgung des Kredits. */
  protected async setExtra(e: { loanId: string; extraMonthlyCents: number }) {
    try {
      await this.store.loans.update(e.loanId, {
        extraMonthlyCents: e.extraMonthlyCents,
        extraFromMonth: this.planner.adviceMonth(),
      });
      this.toast.show(
        this.t.translate('loans.advice.adopted', { amount: this.f.money(e.extraMonthlyCents) }),
      );
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    }
  }

  /** Vorschlag übernehmen: je Kredit eine feste Extra-Tilgung. */
  protected async adoptSuggestion(parts: { loanId: string; extraMonthlyCents: number }[]) {
    try {
      for (const p of parts) {
        await this.store.loans.update(p.loanId, {
          extraMonthlyCents: p.extraMonthlyCents,
          extraFromMonth: this.planner.adviceMonth(),
        });
      }
      this.toast.show(this.t.translate('loans.advice.adoptedMany', { n: parts.length }));
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
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
