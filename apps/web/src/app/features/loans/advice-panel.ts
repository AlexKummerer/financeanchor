import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, output, signal } from '@angular/core';
import type { LoanSuggestion } from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { FinanceStore } from '../../core/data/finance-store';
import { LoanPlanner } from '../../core/data/loan-planner';
import { toCentsOrNull } from '../../core/forms/validators';
import { Formatter } from '../../core/format/formatter';
import { MoneyPipe, MonthPipe } from '../../core/format/pipes';

/**
 * Vorschläge für zusätzliche Tilgung aus dem verfügbaren Geld. Reicht es nicht, zeigt das Panel,
 * woraus sich die geplanten Zahlungen zusammensetzen. Nichts ändert sich am Plan, bis ein Vorschlag
 * übernommen wird – dann wird er zur festen Extra-Tilgung des Kredits.
 */
@Component({
  selector: 'fa-advice-panel',
  imports: [NgTemplateOutlet, TranslocoPipe, MoneyPipe, MonthPipe],
  template: `
    <div>
      <label for="ln-available">{{ 'loans.advice.available' | transloco }}</label>
      <input
        id="ln-available"
        inputmode="decimal"
        autocomplete="off"
        [value]="availableText()"
        placeholder="0"
        [attr.aria-invalid]="error()"
        aria-describedby="ln-available-hint"
        (change)="saveAvailable($any($event.target).value)"
      />
      @if (error()) {
        <p class="field-error">{{ 'forms.amountInvalid' | transloco }}</p>
      }
      <p id="ln-available-hint" class="small muted hint">
        {{ 'loans.advice.availableHint' | transloco }}
      </p>
    </div>

    @if (advice().availableCents === null) {
      <p class="small muted">{{ 'loans.advice.enterAvailable' | transloco }}</p>
    } @else if (advice().freeCents! < 0) {
      <p class="warn" role="status">
        {{
          'loans.advice.overCommitted'
            | transloco
              : {
                  planned: (advice().committedCents | money),
                  available: (advice().availableCents | money),
                  missing: (-advice().freeCents! | money),
                }
        }}
      </p>
      <p class="small muted hint">{{ 'loans.advice.overHint' | transloco }}</p>
      <ng-container *ngTemplateOutlet="breakdown" />
    } @else {
      @if (advice().freeCents! > 0) {
        <p class="free">
          {{
            'loans.advice.free'
              | transloco
                : {
                    amount: (advice().freeCents | money),
                    planned: (advice().committedCents | money),
                  }
          }}
        </p>
      } @else {
        <p class="small muted free">{{ 'loans.advice.nothingFree' | transloco }}</p>
      }

      @if (advice().suggestions.length) {
        <ul class="suggestions">
          @for (s of advice().suggestions; track s.kind + s.loanId) {
            <li>
              <p class="title">{{ title(s) }}</p>
              <p class="small">{{ why(s) }}</p>
              <p class="amount">
                +{{ s.addCents | money
                }}<span class="muted small"> {{ 'common.perMonth' | transloco }}</span>
              </p>
              @if (s.payoffMonth) {
                <p class="small muted">
                  {{
                    (s.interestSavedCents > 0
                      ? 'loans.advice.effect'
                      : 'loans.advice.effectNoInterest'
                    )
                      | transloco
                        : {
                            month: (s.payoffMonth | faMonth: 'short'),
                            n: s.monthsSooner,
                            interest: (s.interestSavedCents | money: true),
                          }
                  }}
                </p>
              }
              <button class="btn ghost" type="button" [disabled]="busy()" (click)="adopt(s)">
                {{ 'loans.advice.adopt' | transloco }}
              </button>
            </li>
          }
        </ul>
        @if (advice().baseline; as b) {
          <p class="small muted">
            {{
              (b.debtFreeMonth ? 'loans.advice.baseline' : 'loans.advice.baselineStuck')
                | transloco
                  : {
                      month: (b.debtFreeMonth | faMonth: 'short'),
                      interest: (b.totalInterestCents | money: true),
                    }
            }}
          </p>
        }
      }

      @if (advice().committed.length) {
        <details class="more">
          <summary>
            {{
              'loans.advice.breakdown' | transloco: { planned: (advice().committedCents | money) }
            }}
          </summary>
          <ng-container *ngTemplateOutlet="breakdown" />
        </details>
      }
    }

    <ng-template #breakdown>
      <table class="breakdown small">
        <tbody>
          @for (c of advice().committed; track c.loanId + c.kind) {
            <tr>
              <td>
                {{ loanName(c.loanId) }}
                <span class="muted">
                  ·
                  {{
                    'loans.advice.item.' + c.kind
                      | transloco: { month: (c.untilMonth | faMonth: 'short') }
                  }}
                </span>
              </td>
              <td class="num">{{ c.amountCents | money }}</td>
            </tr>
          }
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{{ 'loans.advice.plannedTotal' | transloco }}</th>
            <td class="num">{{ advice().committedCents | money }}</td>
          </tr>
          @if (advice().freeCents! < 0) {
            <tr class="neg">
              <th scope="row">{{ 'loans.advice.missing' | transloco }}</th>
              <td class="num">{{ -advice().freeCents! | money }}</td>
            </tr>
          }
        </tfoot>
      </table>
    </ng-template>
  `,
  styles: `
    .hint {
      margin-top: 4px;
    }
    .free {
      margin-top: 12px;
    }
    .suggestions {
      list-style: none;
      padding: 0;
      margin: 12px 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
    }
    .suggestions li {
      display: flex;
      flex-direction: column;
    }
    .suggestions li .btn {
      margin-top: auto;
      align-self: flex-start;
    }
    .suggestions li {
      background: var(--bg);
      border-radius: var(--radius-sm);
      padding: 12px;
    }
    .title {
      font-weight: 600;
    }
    .amount {
      font-size: 1.2rem;
      font-weight: 700;
      margin: 2px 0;
    }
    .suggestions .btn {
      background: var(--surface);
    }
    .amount + .small {
      margin-bottom: 8px;
    }
    .breakdown {
      width: 100%;
      margin-top: 8px;
      border-collapse: collapse;
    }
    .breakdown td,
    .breakdown th {
      padding: 4px 0;
      text-align: left;
      font-weight: normal;
    }
    .breakdown tfoot th,
    .breakdown tfoot td {
      font-weight: 600;
      border-top: 1px solid var(--line);
    }
    .num {
      text-align: right !important;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .more {
      margin-top: 12px;
    }
  `,
})
export class AdvicePanel {
  /** Ein Vorschlag wurde übernommen (Kredit-ID, neue Extra-Tilgung). */
  readonly adopted = output<{ loanId: string; extraMonthlyCents: number }>();

  private readonly store = inject(FinanceStore);
  private readonly planner = inject(LoanPlanner);
  private readonly t = inject(TranslocoService);
  private readonly f = inject(Formatter);

  protected readonly advice = this.planner.advice;
  protected readonly error = signal(false);
  protected readonly busy = signal(false);
  protected readonly availableText = computed(() => {
    const v = this.store.settings()?.loanBudgetCents ?? null;
    return v === null ? '' : this.f.amountInput(v);
  });

  protected loanName(id: string): string {
    return this.store.loans.byId().get(id)?.name ?? '';
  }

  protected title(s: LoanSuggestion): string {
    const loan = this.store.loans.byId().get(s.loanId);
    switch (s.kind) {
      case 'target':
        return this.t.translate('loans.advice.targetTitle', {
          month: loan?.targetMonth ? this.f.month(loan.targetMonth, 'short') : '',
        });
      case 'interest':
        return this.t.translate('loans.advice.interestTitle');
      case 'relief':
        return this.t.translate('loans.advice.reliefTitle');
    }
  }

  protected why(s: LoanSuggestion): string {
    const loan = this.store.loans.byId().get(s.loanId);
    const name = loan?.name ?? '';
    switch (s.kind) {
      case 'target':
        return this.t.translate('loans.advice.targetWhy', {
          name,
          month: loan?.targetMonth ? this.f.month(loan.targetMonth, 'short') : '',
        });
      case 'interest':
        return this.t.translate('loans.advice.interestWhy', {
          name,
          rate: this.f.percent(loan?.rateBp ?? 0),
        });
      case 'relief':
        return s.freedPaymentCents > 0
          ? this.t.translate('loans.advice.reliefWhy', {
              name,
              payment: this.f.money(s.freedPaymentCents),
            })
          : this.t.translate('loans.advice.reliefWhyNoRate', { name });
    }
  }

  protected saveAvailable(value: string) {
    const cents = toCentsOrNull(value);
    const invalid = value.trim() !== '' && (cents === null || cents < 0);
    this.error.set(invalid);
    if (!invalid) void this.store.updateSettings({ loanBudgetCents: cents });
  }

  protected adopt(s: LoanSuggestion) {
    this.adopted.emit({ loanId: s.loanId, extraMonthlyCents: s.newExtraMonthlyCents });
  }
}
