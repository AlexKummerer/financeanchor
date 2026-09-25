import { HttpClient, httpResource } from '@angular/common/http';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  categoryNameKey,
  monthOfDate,
  monthTotals,
  type Category,
  type Transaction,
  type YearMonth,
} from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { Clock } from '../../core/clock';
import { FinanceStore } from '../../core/data/finance-store';
import { Segmented } from '../../core/forms/segmented';
import { euroAmount, toCents } from '../../core/forms/validators';
import { DatePipe, MoneyPipe, MonthPipe } from '../../core/format/pipes';
import { ApiError } from '../../core/http/api-error';
import { Dialogs } from '../../core/ui/dialogs';
import { ToastService } from '../../core/ui/toast.service';
import { CategoriesManager } from './categories-manager';

type Kind = 'out' | 'in';

@Component({
  selector: 'fa-transactions',
  imports: [
    ReactiveFormsModule,
    TranslocoPipe,
    MoneyPipe,
    MonthPipe,
    DatePipe,
    Segmented,
    CategoriesManager,
  ],
  templateUrl: './transactions.html',
  styleUrl: './transactions.css',
})
export class TransactionsPage {
  protected readonly store = inject(FinanceStore);
  private readonly http = inject(HttpClient);
  private readonly clock = inject(Clock);
  private readonly t = inject(TranslocoService);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(Dialogs);
  private readonly amountEl = viewChild<ElementRef<HTMLInputElement>>('amountInput');
  private readonly categoriesManager = viewChild(CategoriesManager);

  protected readonly month = signal<YearMonth>(this.clock.month());
  protected readonly transactions = httpResource<Transaction[]>(
    () => `/api/transactions?month=${this.month()}`,
    {
      defaultValue: [],
    },
  );
  private readonly monthsWithData = httpResource<YearMonth[]>(() => '/api/transactions/months', {
    defaultValue: [],
  });
  private readonly suggestions = httpResource<{ name: string; categoryId: string }[]>(
    () => '/api/transactions/suggestions',
    { defaultValue: [] },
  );

  protected readonly months = computed(() =>
    [...new Set([this.clock.month(), this.month(), ...this.monthsWithData.value()])]
      .sort()
      .reverse(),
  );
  protected readonly totals = computed(() => monthTotals(this.transactions.value(), this.month()));
  protected readonly nameSuggestions = computed(() => this.suggestions.value().map((s) => s.name));

  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly form = this.fb.group({
    kind: this.fb.control<Kind>('out'),
    amount: ['', euroAmount()],
    date: [this.clock.today(), Validators.required],
    name: ['', [Validators.required, Validators.maxLength(100)]],
    category: ['', [Validators.required, Validators.maxLength(100)]],
  });
  protected readonly kindOptions = computed(() => [
    { value: 'out' as const, label: this.t.translate('tx.expense') },
    { value: 'in' as const, label: this.t.translate('tx.income') },
  ]);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);

  constructor() {
    // Bekannter Name → zuletzt verwendete Kategorie vorschlagen (wie im Prototyp).
    this.form.controls.name.valueChanges.subscribe((name) => {
      if (this.form.controls.category.value) return;
      const hit = this.suggestions.value().find((s) => s.name === name);
      if (hit) this.form.controls.category.setValue(this.store.categoryName(hit.categoryId));
    });
  }

  protected invalid(name: 'amount' | 'date' | 'name' | 'category') {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitted());
  }

  protected async submit() {
    this.submitted.set(true);
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    const v = this.form.getRawValue();
    try {
      const category = await this.categoryFor(v.category);
      const cents = toCents(v.amount);
      await firstValueFrom(
        this.http.post<Transaction>('/api/transactions', {
          date: v.date,
          name: v.name.trim(),
          categoryId: category.id,
          amountCents: v.kind === 'in' ? cents : -cents,
        }),
      );
      this.month.set(monthOfDate(v.date));
      this.transactions.reload();
      this.monthsWithData.reload();
      this.suggestions.reload();
      this.categoriesManager()?.refresh();
      this.form.patchValue({ amount: '', name: '', category: '' });
      this.form.markAsUntouched();
      this.submitted.set(false);
      this.toast.show(this.t.translate('tx.saved'));
      this.amountEl()?.nativeElement.focus();
    } catch {
      this.toast.show(this.t.translate('errors.saveFailed'), 'error');
    } finally {
      this.saving.set(false);
    }
  }

  /** Vorhandene Kategorie (ohne Groß-/Kleinschreibung) oder neu anlegen. */
  private async categoryFor(name: string): Promise<Category> {
    const key = categoryNameKey(name);
    const existing = this.store.categories.items().find((c) => categoryNameKey(c.name) === key);
    return existing ?? this.store.categories.create({ name: name.trim() });
  }

  protected async remove(tx: Transaction) {
    if (tx.kind !== 'normal') {
      const ok = await this.dialogs.confirm({
        title: this.t.translate('tx.deleteManagedTitle'),
        message: this.t.translate('tx.deleteManagedText'),
        confirmLabel: this.t.translate('common.delete'),
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await firstValueFrom(this.http.delete(`/api/transactions/${tx.id}`));
      this.transactions.reload();
      this.monthsWithData.reload();
      this.categoriesManager()?.refresh();
      if (tx.kind !== 'normal') await this.store.reloadBalances();
      this.toast.show(this.t.translate('tx.deleted'));
    } catch (err) {
      this.toast.show(
        this.t.translate(err instanceof ApiError ? 'errors.saveFailed' : 'errors.generic'),
        'error',
      );
    }
  }

  protected onCategoriesChanged() {
    this.transactions.reload();
    this.suggestions.reload();
  }
}
