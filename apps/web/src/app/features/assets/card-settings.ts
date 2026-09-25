import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import type { Account } from '@financeanchor/shared';
import { TranslocoPipe } from '@jsverse/transloco';

export interface CardSettings {
  statementDay: number;
  debitDay: number;
  debitAccountId: string | null;
}

/** Tage 1–31 für die Auswahl; 31 steht für „Monatsende“. */
export const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

/** Stichtag, Abbuchungstag und Abbuchungskonto einer Kreditkarte ändern. */
@Component({
  selector: 'fa-card-settings-dialog',
  imports: [ReactiveFormsModule, TranslocoPipe],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()">
      <h2 id="fa-dialog-title" style="margin-top: 0">{{ data.card.name }}</h2>
      <div class="stack">
        <div>
          <label for="cs-statement">{{ 'cards.statementDay' | transloco }}</label>
          <select
            id="cs-statement"
            formControlName="statementDay"
            aria-describedby="cs-statement-hint"
          >
            @for (d of days; track d) {
              <option [ngValue]="d">
                {{ d === 31 ? ('cards.monthEnd' | transloco) : d + '.' }}
              </option>
            }
          </select>
          <p id="cs-statement-hint" class="small muted">{{ 'cards.statementHint' | transloco }}</p>
        </div>
        <div>
          <label for="cs-debit">{{ 'cards.debitDay' | transloco }}</label>
          <select id="cs-debit" formControlName="debitDay" aria-describedby="cs-debit-hint">
            @for (d of days; track d) {
              <option [ngValue]="d">{{ d + '.' }}</option>
            }
          </select>
          <p id="cs-debit-hint" class="small muted">{{ 'cards.debitHint' | transloco }}</p>
        </div>
        <div>
          <label for="cs-account">{{ 'cards.debitAccount' | transloco }}</label>
          <select id="cs-account" formControlName="debitAccountId">
            <option [ngValue]="null">{{ 'cards.noDebitAccount' | transloco }}</option>
            @for (a of data.accounts; track a.id) {
              <option [ngValue]="a.id">{{ a.name }}</option>
            }
          </select>
        </div>
      </div>
      <div class="btnrow" style="margin-top: 18px; justify-content: flex-end">
        <button type="button" class="btn ghost" (click)="ref.close(undefined)">
          {{ 'common.cancel' | transloco }}
        </button>
        <button type="submit" class="btn">{{ 'common.save' | transloco }}</button>
      </div>
    </form>
  `,
})
export class CardSettingsDialog {
  protected readonly data = inject<{ card: Account; accounts: Account[] }>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<CardSettings>>(DialogRef);
  protected readonly days = DAYS;
  protected readonly form = inject(FormBuilder).nonNullable.group({
    statementDay: this.data.card.statementDay ?? 31,
    debitDay: this.data.card.debitDay ?? 1,
    debitAccountId: inject(FormBuilder).control<string | null>(this.data.card.debitAccountId),
  });

  protected save() {
    this.ref.close(this.form.getRawValue());
  }
}
