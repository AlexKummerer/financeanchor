import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators, type AbstractControl } from '@angular/forms';
import {
  isIsoDate,
  isYearMonth,
  parsePercentToBasisPoints,
  type Loan,
  type LoanCreate,
  type LoanKind,
  type PaymentMode,
  type YearMonth,
} from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Segmented } from '../../core/forms/segmented';
import { euroAmount, percent, toCents, toCentsOrNull } from '../../core/forms/validators';
import { Formatter } from '../../core/format/formatter';

export type LoanFormValue = LoanCreate;

const optionalMonth = (c: AbstractControl<string>) =>
  !c.value || isYearMonth(c.value) ? null : { month: true };
const requiredDate = (c: AbstractControl<string>) =>
  isIsoDate(c.value ?? '') ? null : { date: true };

/** Formular für einen Kredit: Ratenkredit oder „Tilgen bis Datum“ (Anlegen und Bearbeiten). */
@Component({
  selector: 'fa-loan-form',
  imports: [ReactiveFormsModule, TranslocoPipe, Segmented],
  template: `
    <form class="form-grid" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <div class="full">
        <fa-segmented
          formControlName="kind"
          [options]="kindOptions()"
          [label]="'loans.kind' | transloco"
        />
        <p class="small muted hint">
          {{ (isDeadline() ? 'loans.kindDeadlineHint' : 'loans.kindInstallmentHint') | transloco }}
        </p>
      </div>
      <div class="full">
        <label for="ln-name">{{ 'loans.name' | transloco }}</label>
        <input
          id="ln-name"
          formControlName="name"
          [placeholder]="
            (isDeadline() ? 'loans.namePlaceholderDeadline' : 'loans.namePlaceholder') | transloco
          "
          autocomplete="off"
          [attr.aria-invalid]="invalid('name')"
          aria-describedby="ln-name-err"
        />
        @if (invalid('name')) {
          <p id="ln-name-err" class="field-error">{{ 'forms.required' | transloco }}</p>
        }
      </div>
      <div>
        <label for="ln-balance">{{
          (isDeadline() ? 'loans.amountOpen' : 'loans.balance') | transloco
        }}</label>
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
      @if (isDeadline()) {
        <div>
          <label for="ln-due-date">{{ 'loans.dueDate' | transloco }}</label>
          <input
            id="ln-due-date"
            type="date"
            formControlName="dueDate"
            [attr.aria-invalid]="invalid('dueDate')"
            aria-describedby="ln-due-date-err"
          />
          @if (invalid('dueDate')) {
            <p id="ln-due-date-err" class="field-error">{{ 'forms.required' | transloco }}</p>
          }
        </div>
        <div class="full">
          <fa-segmented
            formControlName="paymentMode"
            [options]="modeOptions()"
            [label]="'loans.paymentMode' | transloco"
          />
          <p class="small muted hint">
            {{
              (form.controls.paymentMode.value === 'lump' ? 'loans.lumpHint' : 'loans.spreadHint')
                | transloco
            }}
          </p>
        </div>
        @if (form.controls.paymentMode.value === 'lump') {
          <div>
            <label class="check" for="ln-save-up">
              <input
                id="ln-save-up"
                type="checkbox"
                formControlName="saveUp"
                aria-describedby="ln-save-up-hint"
              />
              {{ 'loans.saveUpField' | transloco }}
            </label>
            <p id="ln-save-up-hint" class="small muted hint">
              {{ 'loans.saveUpHint' | transloco }}
            </p>
          </div>
          <div>
            <label for="ln-saved">{{ 'loans.savedField' | transloco }}</label>
            <input
              id="ln-saved"
              formControlName="saved"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0"
              [attr.aria-invalid]="invalid('saved')"
              aria-describedby="ln-saved-hint"
            />
            <p id="ln-saved-hint" class="small muted hint">{{ 'loans.savedHint' | transloco }}</p>
          </div>
        }
        <div>
          <label for="ln-rate">{{ 'loans.rateOptional' | transloco }}</label>
          <input
            id="ln-rate"
            formControlName="rate"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0"
            [attr.aria-invalid]="invalid('rate')"
            aria-describedby="ln-rate-err"
          />
          @if (invalid('rate')) {
            <p id="ln-rate-err" class="field-error">{{ 'forms.percentInvalid' | transloco }}</p>
          }
        </div>
      } @else {
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
        <div>
          <label for="ln-target">{{ 'loans.target' | transloco }}</label>
          <input
            id="ln-target"
            type="month"
            formControlName="targetMonth"
            [attr.aria-invalid]="invalid('targetMonth')"
            aria-describedby="ln-target-hint"
          />
          <p id="ln-target-hint" class="small muted hint">{{ 'loans.targetHint' | transloco }}</p>
        </div>
      }
      @if (!(isDeadline() && form.controls.paymentMode.value === 'lump')) {
        <div>
          <label for="ln-extra">{{ 'loans.extraField' | transloco }}</label>
          <input
            id="ln-extra"
            formControlName="extra"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0"
            [attr.aria-invalid]="invalid('extra')"
            aria-describedby="ln-extra-hint"
          />
          <p id="ln-extra-hint" class="small muted hint">{{ 'loans.extraHint' | transloco }}</p>
        </div>
      }
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
  styles: `
    .check {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 44px;
      font-weight: 500;
    }
    .check input {
      width: 20px;
      height: 20px;
      margin: 0;
    }
    .hint {
      margin-top: 6px;
    }
  `,
})
export class LoanForm {
  readonly loan = input<Loan | null>(null);
  /** Planungsmonat: ab hier gilt eine geänderte Extra-Tilgung */
  readonly planMonth = input<YearMonth | null>(null);
  readonly busy = input(false);
  readonly saved = output<LoanFormValue>();
  readonly cancelled = output<void>();

  private readonly f = inject(Formatter);
  private readonly t = inject(TranslocoService);
  private readonly submitted = signal(false);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly form = this.fb.group({
    kind: this.fb.control<LoanKind>('installment'),
    name: ['', [Validators.required, Validators.maxLength(100)]],
    balance: ['', euroAmount({ min: 0 })],
    rate: ['', percent()],
    payment: ['', euroAmount()],
    original: ['', euroAmount({ min: 0, required: false })],
    dueDay: [1, [Validators.required, Validators.min(1), Validators.max(31)]],
    targetMonth: ['', optionalMonth],
    dueDate: ['', requiredDate],
    paymentMode: this.fb.control<PaymentMode>('spread'),
    saved: ['', euroAmount({ min: 0, required: false })],
    saveUp: [true],
    extra: ['', euroAmount({ min: 0, required: false })],
  });

  private readonly kind = toSignal(this.form.controls.kind.valueChanges, {
    initialValue: this.form.controls.kind.value,
  });
  protected readonly isDeadline = computed(() => this.kind() === 'deadline');
  protected readonly kindOptions = computed(() => [
    { value: 'installment' as const, label: this.t.translate('loans.kinds.installment') },
    { value: 'deadline' as const, label: this.t.translate('loans.kinds.deadline') },
  ]);
  protected readonly modeOptions = computed(() => [
    { value: 'spread' as const, label: this.t.translate('loans.modes.spread') },
    { value: 'lump' as const, label: this.t.translate('loans.modes.lump') },
  ]);

  constructor() {
    effect(() => {
      const l = this.loan();
      this.submitted.set(false);
      if (!l) {
        this.clear();
        return;
      }
      this.form.reset({
        kind: l.kind,
        name: l.name,
        balance: this.f.amountInput(l.balanceCents),
        rate: l.rateBp ? this.f.percent(l.rateBp) : l.kind === 'deadline' ? '' : '0',
        payment: l.paymentCents ? this.f.amountInput(l.paymentCents) : '',
        original: this.f.amountInput(l.originalCents),
        dueDay: l.dueDay,
        targetMonth: l.targetMonth ?? '',
        dueDate: l.dueDate ?? '',
        paymentMode: l.paymentMode ?? 'spread',
        saved: l.savedCents ? this.f.amountInput(l.savedCents) : '',
        saveUp: l.saveUp,
        extra: l.extraMonthlyCents ? this.f.amountInput(l.extraMonthlyCents) : '',
      });
    });
    // Felder der jeweils anderen Art zählen für die Gültigkeit nicht.
    this.form.controls.kind.valueChanges.subscribe((k) => this.applyKind(k));
    this.applyKind(this.form.controls.kind.value);
  }

  private applyKind(kind: LoanKind) {
    const c = this.form.controls;
    const deadline = kind === 'deadline';
    for (const ctl of [c.payment, c.dueDay, c.targetMonth])
      (deadline ? ctl.disable : ctl.enable).call(ctl, { emitEvent: false });
    for (const ctl of [c.dueDate, c.paymentMode, c.saved])
      (deadline ? ctl.enable : ctl.disable).call(ctl, { emitEvent: false });
    // Zins ist bei Fristen optional
    c.rate.setValidators(
      deadline
        ? (x: AbstractControl<string>) => (!x.value?.trim() ? null : percent()(x))
        : percent(),
    );
    c.rate.updateValueAndValidity({ emitEvent: false });
  }

  protected invalid(name: keyof typeof this.form.controls) {
    const c = this.form.controls[name];
    return c.enabled && c.invalid && (c.touched || this.submitted());
  }

  protected submit() {
    this.submitted.set(true);
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const original = toCentsOrNull(v.original);
    const extraMonthlyCents = toCentsOrNull(v.extra) ?? 0;
    // Geänderte Extra-Tilgung gilt ab dem Planungsmonat; unverändert bleibt ihr Startmonat
    const before = this.loan();
    const extraFromMonth =
      before && before.extraMonthlyCents === extraMonthlyCents
        ? before.extraFromMonth
        : this.planMonth();
    const common = {
      name: v.name.trim(),
      balanceCents: toCents(v.balance),
      rateBp: v.rate.trim() ? (parsePercentToBasisPoints(v.rate) ?? 0) : 0,
      ...(original !== null ? { originalCents: original } : {}),
    };
    this.saved.emit(
      v.kind === 'deadline'
        ? {
            ...common,
            kind: 'deadline',
            dueDate: v.dueDate,
            paymentMode: v.paymentMode,
            savedCents: v.paymentMode === 'lump' ? (toCentsOrNull(v.saved) ?? 0) : 0,
            saveUp: v.paymentMode === 'lump' ? v.saveUp : true,
            extraMonthlyCents: v.paymentMode === 'lump' ? 0 : extraMonthlyCents,
            extraFromMonth: v.paymentMode === 'lump' ? null : extraFromMonth,
          }
        : {
            ...common,
            kind: 'installment',
            paymentCents: toCents(v.payment),
            dueDay: v.dueDay,
            targetMonth: v.targetMonth || null,
            extraMonthlyCents,
            extraFromMonth,
          },
    );
  }

  clear() {
    this.form.reset({
      kind: 'installment',
      dueDay: 1,
      paymentMode: 'spread',
      targetMonth: '',
      dueDate: '',
    });
    this.applyKind('installment');
    this.submitted.set(false);
  }
}
