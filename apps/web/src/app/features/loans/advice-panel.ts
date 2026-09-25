import { Component, computed, inject, output, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { LoanSuggestion, Strategy } from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { FinanceStore } from '../../core/data/finance-store';
import { LoanPlanner } from '../../core/data/loan-planner';
import { Segmented } from '../../core/forms/segmented';
import { toCentsOrNull } from '../../core/forms/validators';
import { Formatter } from '../../core/format/formatter';
import { MoneyPipe, MonthPipe } from '../../core/format/pipes';

/**
 * Vorschläge für zusätzliche Tilgung aus dem verfügbaren Geld. Nichts ändert sich am Plan, bis ein
 * Vorschlag übernommen wird – dann wird er zur festen Extra-Tilgung des Kredits.
 */
@Component({
  selector: 'fa-advice-panel',
  imports: [ReactiveFormsModule, TranslocoPipe, MoneyPipe, MonthPipe, Segmented],
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

    @if (advice().freeCents !== null) {
      @if (advice().freeCents! < 0) {
        <p class="warn" role="status">
          {{
            'loans.advice.overCommitted'
              | transloco
                : {
                    planned: (advice().committedCents | money),
                    available: (advice().availableCents | money),
                  }
          }}
        </p>
      } @else if (advice().freeCents! > 0) {
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
      }
    }

    @if (advice().suggestions.length) {
      <ul class="suggestions">
        @for (s of advice().suggestions; track s.kind + s.loanId) {
          <li>
            <p class="title">{{ title(s) }}</p>
            <p class="amount">
              +{{ s.addCents | money
              }}<span class="muted small"> {{ 'common.perMonth' | transloco }}</span>
            </p>
            <p class="small muted">
              @if (s.payoffMonth) {
                {{
                  'loans.advice.effect'
                    | transloco
                      : {
                          month: (s.payoffMonth | faMonth: 'short'),
                          n: s.monthsSooner,
                          interest: (s.interestSavedCents | money: true),
                        }
                }}
              }
              @if (s.fits === false) {
                <span class="neg"> · {{ 'loans.advice.notFitting' | transloco }}</span>
              }
            </p>
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
    } @else if (advice().availableCents === null) {
      <p class="small muted">{{ 'loans.advice.enterAvailable' | transloco }}</p>
    } @else if ((advice().freeCents ?? 0) === 0) {
      <p class="small muted">{{ 'loans.advice.nothingFree' | transloco }}</p>
    }

    @if (loanCount() > 1) {
      <div class="strategy">
        <p class="label" aria-hidden="true">{{ 'loans.strategy' | transloco }}</p>
        <fa-segmented
          [formControl]="strategy"
          [options]="strategyOptions()"
          [label]="'loans.strategy' | transloco"
        />
      </div>
    }
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
      gap: 10px;
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
      margin-top: 8px;
      background: var(--surface);
    }
    .strategy {
      margin-top: 14px;
    }
    .label {
      font-size: 0.82rem;
      color: var(--muted);
      margin-bottom: 4px;
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
  /** Strategie nur, wenn es mehrere Kredite gibt, die Extra bekommen können. */
  protected readonly loanCount = computed(
    () =>
      this.store.loans.items().filter((l) => l.balanceCents > 0 && l.paymentMode !== 'lump').length,
  );
  protected readonly availableText = computed(() => {
    const v = this.store.settings()?.loanBudgetCents ?? null;
    return v === null ? '' : this.f.amountInput(v);
  });
  protected readonly strategy = new FormControl<Strategy>(
    this.store.settings()?.strategy ?? 'avalanche',
    {
      nonNullable: true,
    },
  );
  protected readonly strategyOptions = computed(() => [
    { value: 'avalanche' as const, label: this.t.translate('loans.avalanche') },
    { value: 'snowball' as const, label: this.t.translate('loans.snowball') },
  ]);

  constructor() {
    this.strategy.valueChanges.subscribe(
      (strategy) => void this.store.updateSettings({ strategy }),
    );
  }

  protected title(s: LoanSuggestion): string {
    const loan = this.store.loans.byId().get(s.loanId);
    const name = loan?.name ?? '';
    return s.kind === 'target'
      ? this.t.translate('loans.advice.targetTitle', {
          name,
          month: loan?.targetMonth ? this.f.month(loan.targetMonth, 'short') : '',
        })
      : this.t.translate('loans.advice.allTitle', { name });
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
