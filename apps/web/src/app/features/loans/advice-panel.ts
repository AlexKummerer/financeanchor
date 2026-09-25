import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, output, signal } from '@angular/core';
import type { LoanSuggestion, SuggestionPart } from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { FinanceStore } from '../../core/data/finance-store';
import { LoanPlanner } from '../../core/data/loan-planner';
import { toCentsOrNull } from '../../core/forms/validators';
import { Formatter } from '../../core/format/formatter';
import { MoneyPipe, MonthPipe } from '../../core/format/pipes';
import { AllocationTable } from './allocation-table';

/**
 * Vorschläge für zusätzliche Tilgung aus dem verfügbaren Geld. Reicht es nicht, zeigt das Panel,
 * woraus sich die geplanten Zahlungen zusammensetzen. Nichts ändert sich am Plan, bis ein Vorschlag
 * übernommen wird – dann wird er zur festen Extra-Tilgung des Kredits.
 */
@Component({
  selector: 'fa-advice-panel',
  imports: [NgTemplateOutlet, TranslocoPipe, MoneyPipe, MonthPipe, AllocationTable],
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
          @for (s of advice().suggestions; track $index) {
            <li>
              <p class="title">{{ title(s) }}</p>
              <p class="small">{{ why(s) }}</p>
              <p class="amount">
                +{{ s.addCents | money
                }}<span class="muted small"> {{ 'common.perMonth' | transloco }}</span>
              </p>
              <ul class="parts small">
                @for (p of s.parts; track p.loanId) {
                  <li>
                    <span>{{ loanName(p.loanId) }} +{{ p.addCents | money }}</span>
                    <span class="muted">{{ partEffect(p) }}</span>
                  </li>
                }
              </ul>
              @if (freedNow(s); as freed) {
                <p class="small">
                  {{ 'loans.advice.freed' | transloco: { amount: (freed | money) } }}
                </p>
              }
              @if (s.interestSavedCents > 0) {
                <p class="small muted">
                  {{
                    'loans.advice.interestSaved'
                      | transloco: { interest: (s.interestSavedCents | money: true) }
                  }}
                </p>
              }
              <details class="more">
                <summary>{{ 'loans.advice.preview' | transloco }}</summary>
                <fa-allocation-table
                  [plan]="previews()[$index] ?? null"
                  [loans]="loans()"
                  [settled]="planner.settledIds()"
                />
              </details>
              <button class="btn ghost" type="button" [disabled]="busy()" (click)="adopt(s)">
                {{ 'loans.advice.adopt' | transloco }}
              </button>
            </li>
          }
        </ul>
        <p class="small muted">
          {{ 'loans.advice.from' | transloco: { month: (planner.month | faMonth) } }}
        </p>
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
    .suggestions > li {
      display: flex;
      flex-direction: column;
    }
    .suggestions > li .btn {
      margin-top: auto;
      align-self: flex-start;
    }
    .suggestions > li {
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
    .parts {
      list-style: none;
      padding: 0;
      margin: 4px 0 8px;
      display: grid;
      gap: 2px;
    }
    .parts li {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      column-gap: 8px;
    }
    .suggestions > li > .btn {
      margin-top: auto;
    }
    .suggestions > li > p.small + .btn,
    .parts + .btn {
      margin-top: 8px;
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
    .suggestions details.more {
      margin: 4px 0 10px;
    }
    .suggestions details.more[open] fa-allocation-table {
      display: block;
      margin-top: 6px;
      padding: 6px;
      background: var(--surface);
      border-radius: var(--radius-sm);
    }
  `,
})
export class AdvicePanel {
  /** Ein Vorschlag wurde übernommen (je Kredit die neue Extra-Tilgung). */
  readonly adopted = output<{ loanId: string; extraMonthlyCents: number }[]>();

  private readonly store = inject(FinanceStore);
  protected readonly planner = inject(LoanPlanner);
  private readonly t = inject(TranslocoService);
  private readonly f = inject(Formatter);

  protected readonly advice = this.planner.advice;
  protected readonly error = signal(false);
  protected readonly busy = signal(false);
  protected readonly loans = this.store.loans.items;
  /** Aufteilung pro Monat, als wäre der Vorschlag übernommen */
  protected readonly previews = computed(() =>
    this.advice().suggestions.map((s) =>
      this.planner.planWith(
        s.parts.map((p) => ({ loanId: p.loanId, extraMonthlyCents: p.newExtraMonthlyCents })),
      ),
    ),
  );
  protected readonly availableText = computed(() => {
    const v = this.store.settings()?.loanBudgetCents ?? null;
    return v === null ? '' : this.f.amountInput(v);
  });

  protected loanName(id: string): string {
    return this.store.loans.byId().get(id)?.name ?? '';
  }

  protected title(s: LoanSuggestion): string {
    switch (s.kind) {
      case 'target': {
        const loan = this.store.loans.byId().get(s.parts[0]?.loanId ?? '');
        return this.t.translate('loans.advice.targetTitle', {
          month: loan?.targetMonth ? this.f.month(loan.targetMonth, 'short') : '',
        });
      }
      case 'interest':
        return this.t.translate('loans.advice.interestTitle');
      case 'relief':
        return this.t.translate('loans.advice.reliefTitle');
    }
  }

  protected why(s: LoanSuggestion): string {
    if (s.kind !== 'target') return this.t.translate(`loans.advice.${s.kind}Why`);
    const loan = this.store.loans.byId().get(s.parts[0]?.loanId ?? '');
    return this.t.translate('loans.advice.targetWhy', {
      name: loan?.name ?? '',
      month: loan?.targetMonth ? this.f.month(loan.targetMonth, 'short') : '',
    });
  }

  protected partEffect(p: SuggestionPart): string {
    if (!p.payoffMonth) return '';
    if (p.payoffMonth === this.planner.month) return this.t.translate('loans.advice.partNow');
    return this.t.translate(
      p.monthsSooner > 1
        ? 'loans.advice.part'
        : p.monthsSooner === 1
          ? 'loans.advice.partOne'
          : 'loans.advice.partSame',
      {
        month: this.f.month(p.payoffMonth, 'short'),
        n: p.monthsSooner,
      },
    );
  }

  /** Raten, die schon nach diesem Monat wegfallen. */
  protected freedNow(s: LoanSuggestion): number {
    return s.parts
      .filter((p) => p.payoffMonth === this.planner.month)
      .reduce((sum, p) => sum + p.freedPaymentCents, 0);
  }

  protected saveAvailable(value: string) {
    const cents = toCentsOrNull(value);
    const invalid = value.trim() !== '' && (cents === null || cents < 0);
    this.error.set(invalid);
    if (!invalid) void this.store.updateSettings({ loanBudgetCents: cents });
  }

  protected adopt(s: LoanSuggestion) {
    this.adopted.emit(
      s.parts.map((p) => ({ loanId: p.loanId, extraMonthlyCents: p.newExtraMonthlyCents })),
    );
  }
}
