import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  categoryNameKey,
  intervals,
  isYearMonth,
  type IntervalMonths,
  type RecurringItem,
  type RecurringKind,
} from '@financeanchor/shared';
import { TranslocoPipe } from '@jsverse/transloco';
import { Clock } from '../../core/clock';
import { FinanceStore } from '../../core/data/finance-store';
import { euroAmount, toCents } from '../../core/forms/validators';
import { Formatter } from '../../core/format/formatter';

export interface RecurringFormValue {
  name: string;
  amountCents: number;
  intervalMonths: IntervalMonths;
  kind: RecurringKind;
  startMonth: string;
  dueDay: number;
  categoryId: string;
}

/** Formular für einen wiederkehrenden Posten (Anlegen und Bearbeiten). */
@Component({
  selector: 'fa-recurring-form',
  imports: [ReactiveFormsModule, TranslocoPipe],
  template: `
    <form class="form-grid" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <div class="full">
        <label for="rc-name">{{ 'recurring.name' | transloco }}</label>
        <input
          id="rc-name"
          formControlName="name"
          [placeholder]="'recurring.namePlaceholder' | transloco"
          autocomplete="off"
          [attr.aria-invalid]="invalid('name')"
          aria-describedby="rc-name-err"
        />
        @if (invalid('name')) {
          <p id="rc-name-err" class="field-error">{{ 'forms.required' | transloco }}</p>
        }
      </div>
      <div>
        <label for="rc-amount">{{ 'recurring.amount' | transloco }}</label>
        <input
          id="rc-amount"
          formControlName="amount"
          inputmode="decimal"
          autocomplete="off"
          [attr.aria-invalid]="invalid('amount')"
          aria-describedby="rc-amount-err"
        />
        @if (invalid('amount')) {
          <p id="rc-amount-err" class="field-error">{{ 'forms.amountInvalid' | transloco }}</p>
        }
      </div>
      <div>
        <label for="rc-interval">{{ 'recurring.interval' | transloco }}</label>
        <select id="rc-interval" formControlName="intervalMonths">
          @for (i of intervals; track i) {
            <option [ngValue]="i">{{ 'recurring.intervals.' + i | transloco }}</option>
          }
        </select>
      </div>
      <div>
        <label for="rc-kind">{{ 'recurring.kind' | transloco }}</label>
        <select id="rc-kind" formControlName="kind">
          <option value="fixed">{{ 'recurring.kinds.fixed' | transloco }}</option>
          <option value="saving">{{ 'recurring.kinds.saving' | transloco }}</option>
          <option value="income">{{ 'recurring.kinds.income' | transloco }}</option>
        </select>
      </div>
      <div>
        <label for="rc-start">{{ 'recurring.startMonth' | transloco }}</label>
        <input
          id="rc-start"
          type="month"
          formControlName="startMonth"
          [attr.aria-invalid]="invalid('startMonth')"
        />
      </div>
      <div>
        <label for="rc-day">{{ 'recurring.dueDay' | transloco }}</label>
        <input
          id="rc-day"
          type="number"
          min="1"
          max="31"
          inputmode="numeric"
          formControlName="dueDay"
          [attr.aria-invalid]="invalid('dueDay')"
          aria-describedby="rc-day-hint"
        />
        <p id="rc-day-hint" class="small muted" style="margin-top: 4px">
          {{ 'recurring.dueDayHint' | transloco }}
        </p>
      </div>
      <div class="full">
        <label for="rc-cat">{{ 'recurring.category' | transloco }}</label>
        <input
          id="rc-cat"
          formControlName="category"
          list="rc-cats"
          [placeholder]="'recurring.categoryPlaceholder' | transloco"
          autocomplete="off"
          [attr.aria-invalid]="invalid('category')"
          aria-describedby="rc-cat-err"
        />
        @if (invalid('category')) {
          <p id="rc-cat-err" class="field-error">{{ 'forms.required' | transloco }}</p>
        }
        <datalist id="rc-cats">
          @for (c of store.userCategories(); track c.id) {
            <option [value]="c.name"></option>
          }
        </datalist>
      </div>
      <div class="full btnrow">
        <button class="btn" type="submit" [disabled]="busy()">
          {{ (item() ? 'recurring.update' : 'recurring.save') | transloco }}
        </button>
        @if (item()) {
          <button class="btn ghost" type="button" (click)="cancelled.emit()">
            {{ 'common.cancel' | transloco }}
          </button>
        }
      </div>
    </form>
  `,
})
export class RecurringForm {
  /** Zu bearbeitender Posten; ohne Wert wird ein neuer angelegt. */
  readonly item = input<RecurringItem | null>(null);
  readonly busy = input(false);
  readonly saved = output<RecurringFormValue>();
  readonly cancelled = output<void>();

  protected readonly store = inject(FinanceStore);
  private readonly clock = inject(Clock);
  private readonly f = inject(Formatter);
  protected readonly intervals = intervals;
  private readonly submitted = signal(false);

  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    amount: ['', euroAmount()],
    intervalMonths: this.fb.control<IntervalMonths>(1),
    kind: this.fb.control<RecurringKind>('fixed'),
    startMonth: [
      this.clock.month(),
      [
        Validators.required,
        (c: { value: string }) => (isYearMonth(c.value) ? null : { month: true }),
      ],
    ],
    dueDay: [1, [Validators.required, Validators.min(1), Validators.max(31)]],
    category: ['', [Validators.required, Validators.maxLength(100)]],
  });

  constructor() {
    effect(() => {
      const it = this.item();
      this.submitted.set(false);
      if (!it) {
        this.form.reset({
          startMonth: this.clock.month(),
          dueDay: 1,
          intervalMonths: 1,
          kind: 'fixed',
        });
        return;
      }
      this.form.reset({
        name: it.name,
        amount: this.f.amountInput(it.amountCents),
        intervalMonths: it.intervalMonths,
        kind: it.kind,
        startMonth: it.startMonth,
        dueDay: it.dueDay,
        category: this.store.categoryName(it.categoryId),
      });
    });
  }

  protected invalid(name: keyof typeof this.form.controls) {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitted());
  }

  protected async submit() {
    this.submitted.set(true);
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const key = categoryNameKey(v.category);
    const category =
      this.store.categories.items().find((c) => categoryNameKey(c.name) === key) ??
      (await this.store.categories.create({ name: v.category.trim() }));
    this.saved.emit({
      name: v.name.trim(),
      amountCents: toCents(v.amount),
      intervalMonths: v.intervalMonths,
      kind: v.kind,
      startMonth: v.startMonth,
      dueDay: v.dueDay,
      categoryId: category.id,
    });
  }

  /** Nach dem Speichern eines neuen Postens leeren. */
  clear() {
    this.form.reset({
      startMonth: this.clock.month(),
      dueDay: 1,
      intervalMonths: 1,
      kind: 'fixed',
    });
    this.submitted.set(false);
  }
}
