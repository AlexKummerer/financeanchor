import { Component, DOCUMENT, computed, inject, signal, viewChild } from '@angular/core';
import {
  monthlyBreakdown,
  monthlyShare,
  nextDueMonth,
  viaReserve,
  type RecurringItem,
} from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Clock } from '../../core/clock';
import { FinanceStore } from '../../core/data/finance-store';
import { MoneyPipe, MonthPipe } from '../../core/format/pipes';
import { Dialogs } from '../../core/ui/dialogs';
import { ToastService } from '../../core/ui/toast.service';
import { RecurringForm, type RecurringFormValue } from './recurring-form';
import { ReservePanel } from './reserve-panel';

const KIND_ORDER = { income: 0, fixed: 1, saving: 2 } as const;

@Component({
  selector: 'fa-recurring',
  imports: [TranslocoPipe, MoneyPipe, MonthPipe, RecurringForm, ReservePanel],
  templateUrl: './recurring.html',
  styleUrl: './recurring.css',
})
export class RecurringPage {
  protected readonly store = inject(FinanceStore);
  private readonly clock = inject(Clock);
  private readonly dialogs = inject(Dialogs);
  private readonly toast = inject(ToastService);
  private readonly t = inject(TranslocoService);
  private readonly formRef = viewChild(RecurringForm);
  private readonly document = inject(DOCUMENT);

  protected readonly editing = signal<RecurringItem | null>(null);
  protected readonly formOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly month = this.clock.month();

  protected readonly breakdown = computed(() =>
    monthlyBreakdown({
      items: this.store.items.items(),
      pots: this.store.pots.items(),
      loans: [],
      month: this.month,
    }),
  );

  protected readonly rows = computed(() =>
    [...this.store.items.items()]
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || monthlyShare(b) - monthlyShare(a))
      .map((item) => ({
        item,
        tagClass: item.kind === 'income' ? 'inc' : item.kind === 'saving' ? 'save' : 'fix',
        tagLabel: item.kind === 'fixed' ? this.store.categoryName(item.categoryId) : null,
        monthly: monthlyShare(item),
        next: item.intervalMonths > 1 ? nextDueMonth(item, this.month) : null,
        viaReserve: viaReserve(item),
      })),
  );

  protected edit(item: RecurringItem) {
    this.editing.set(item);
    this.formOpen.set(true);
    queueMicrotask(() => this.document.getElementById('rc-name')?.focus());
  }

  protected cancelEdit() {
    this.editing.set(null);
  }

  protected async save(v: RecurringFormValue) {
    this.saving.set(true);
    try {
      const current = this.editing();
      if (current) {
        await this.store.items.update(current.id, v);
        this.editing.set(null);
        this.toast.show(this.t.translate('recurring.updated'));
      } else {
        await this.store.items.create(v);
        this.formRef()?.clear();
        this.toast.show(this.t.translate('recurring.saved'));
      }
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(item: RecurringItem) {
    const ok = await this.dialogs.confirm({
      title: this.t.translate('recurring.deleteTitle', { name: item.name }),
      message: this.t.translate('recurring.deleteText'),
      confirmLabel: this.t.translate('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await this.store.items.remove(item.id);
      if (this.editing()?.id === item.id) this.editing.set(null);
      this.toast.show(this.t.translate('tx.deleted'));
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    }
  }
}
