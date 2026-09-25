import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { parsePercentToBasisPoints, type Loan } from '@financeanchor/shared';
import { TranslocoPipe } from '@jsverse/transloco';
import { euroAmount, percent, toCents, toCentsOrNull } from '../../core/forms/validators';
import { Formatter } from '../../core/format/formatter';

export interface LoanFormValue {
  name: string;
  balanceCents: number;
  rateBp: number;
  paymentCents: number;
  originalCents?: number;
  dueDay: number;
}

/** Formular für einen Kredit (Anlegen und Bearbeiten). */
@Component({
  selector: 'fa-loan-form',
  imports: [ReactiveFormsModule, TranslocoPipe],
  template: `
    <form class="form-grid" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <div class="full">
        <label for="ln-name">{{ 'loans.name' | transloco }}</label>
        <input
          id="ln-name"
          formControlName="name"
          [placeholder]="'loans.namePlaceholder' | transloco"
          autocomplete="off"
          [attr.aria-invalid]="invalid('name')"
          aria-describedby="ln-name-err"
        />
        @if (invalid('name')) {
          <p id="ln-name-err" class="field-error">{{ 'forms.required' | transloco }}</p>
        }
      </div>
      <div>
        <label for="ln-balance">{{ 'loans.balance' | transloco }}</label>
        <input
          id="ln-balance"
          formControlName="balance"
          inputmode="decimal"
          autocomplete="off"
          [attr.aria-invalid]="invalid('balance')"
          aria-describedby="ln-balance-err"
        />
        @if (invalid('balance')) {
          <p id="ln-balance-err" class="field-error">{{ 'forms.amountInvalid' | transloco }}</p>
        }
      </div>
      <div>
        <label for="ln-rate">{{ 'loans.rate' | transloco }}</label>
        <input
          id="ln-rate"
          formControlName="rate"
          inputmode="decimal"
          autocomplete="off"
          [attr.aria-invalid]="invalid('rate')"
          aria-describedby="ln-rate-err"
        />
        @if (invalid('rate')) {
          <p id="ln-rate-err" class="field-error">{{ 'forms.percentInvalid' | transloco }}</p>
        }
      </div>
      <div>
        <label for="ln-payment">{{ 'loans.payment' | transloco }}</label>
        <input
          id="ln-payment"
          formControlName="payment"
          inputmode="decimal"
          autocomplete="off"
          [attr.aria-invalid]="invalid('payment')"
          aria-describedby="ln-payment-err"
        />
        @if (invalid('payment')) {
          <p id="ln-payment-err" class="field-error">{{ 'forms.amountInvalid' | transloco }}</p>
        }
      </div>
      <div>
        <label for="ln-original">{{ 'loans.original' | transloco }}</label>
        <input
          id="ln-original"
          formControlName="original"
          inputmode="decimal"
          autocomplete="off"
          [placeholder]="'loans.optional' | transloco"
          [attr.aria-invalid]="invalid('original')"
        />
      </div>
      <div>
        <label for="ln-day">{{ 'loans.dueDay' | transloco }}</label>
        <input
          id="ln-day"
          type="number"
          min="1"
          max="31"
          inputmode="numeric"
          formControlName="dueDay"
          [attr.aria-invalid]="invalid('dueDay')"
        />
      </div>
      <div class="full btnrow">
        <button class="btn" type="submit" [disabled]="busy()">
          {{ (loan() ? 'loans.update' : 'loans.save') | transloco }}
        </button>
        @if (loan()) {
          <button class="btn ghost" type="button" (click)="cancelled.emit()">
            {{ 'common.cancel' | transloco }}
          </button>
        }
      </div>
    </form>
  `,
})
export class LoanForm {
  readonly loan = input<Loan | null>(null);
  readonly busy = input(false);
  readonly saved = output<LoanFormValue>();
  readonly cancelled = output<void>();

  private readonly f = inject(Formatter);
  private readonly submitted = signal(false);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    balance: ['', euroAmount({ min: 0 })],
    rate: ['', percent()],
    payment: ['', euroAmount()],
    original: ['', euroAmount({ min: 0, required: false })],
    dueDay: [1, [Validators.required, Validators.min(1), Validators.max(31)]],
  });

  constructor() {
    effect(() => {
      const l = this.loan();
      this.submitted.set(false);
      if (!l) {
        this.clear();
        return;
      }
      this.form.reset({
        name: l.name,
        balance: this.f.amountInput(l.balanceCents),
        rate: this.f.percent(l.rateBp),
        payment: this.f.amountInput(l.paymentCents),
        original: this.f.amountInput(l.originalCents),
        dueDay: l.dueDay,
      });
    });
  }

  protected invalid(name: keyof typeof this.form.controls) {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitted());
  }

  protected submit() {
    this.submitted.set(true);
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const original = toCentsOrNull(v.original);
    this.saved.emit({
      name: v.name.trim(),
      balanceCents: toCents(v.balance),
      rateBp: parsePercentToBasisPoints(v.rate) ?? 0,
      paymentCents: toCents(v.payment),
      ...(original !== null ? { originalCents: original } : {}),
      dueDay: v.dueDay,
    });
  }

  clear() {
    this.form.reset({ dueDay: 1 });
    this.submitted.set(false);
  }
}
