import { Component, computed, input, signal } from '@angular/core';
import {
  parseEuroToCents,
  scenarioFor,
  suggestedScenarios,
  type PlanLoan,
  type Scenario,
  type YearMonth,
} from '@financeanchor/shared';
import { TranslocoPipe } from '@jsverse/transloco';
import { MoneyPipe, MonthPipe } from '../../core/format/pipes';

/** „Was wäre, wenn“: Monatsbetrag → getilgt im Monat → Zinsen, dazu ein eigener Betrag. */
@Component({
  selector: 'fa-scenario-table',
  imports: [TranslocoPipe, MoneyPipe, MonthPipe],
  template: `
    <div class="scroll">
      <table>
        <caption class="visually-hidden">
          {{
            'loans.scenario.caption' | transloco: { name: name() }
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ 'loans.scenario.monthly' | transloco }}</th>
            <th scope="col">{{ 'loans.scenario.payoff' | transloco }}</th>
            <th scope="col">{{ 'loans.scenario.interest' | transloco }}</th>
          </tr>
        </thead>
        <tbody>
          @for (s of rows(); track s.monthlyCents; let first = $first) {
            <tr [class.custom]="s === custom()">
              <th scope="row">
                {{ s.monthlyCents | money }}
                @if (first && hasDeadline()) {
                  <span class="note">{{ 'loans.scenario.needed' | transloco }}</span>
                }
                @if (s === custom()) {
                  <span class="note">{{ 'loans.scenario.own' | transloco }}</span>
                }
              </th>
              <td [class.neg]="s.meetsDeadline === false">
                @if (s.stuck) {
                  {{ 'loans.notForeseeable' | transloco }}
                } @else {
                  {{ s.payoffMonth | faMonth: 'short' }}
                  <span class="note">{{
                    'loans.scenario.months' | transloco: { n: s.months }
                  }}</span>
                }
              </td>
              <td>{{ s.stuck ? '–' : (s.totalInterestCents | money: true) }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <form class="own" (submit)="$event.preventDefault(); try(amount.value)">
      <label [for]="'sc-' + id()">{{ 'loans.scenario.try' | transloco }}</label>
      <div class="row">
        <input
          #amount
          [id]="'sc-' + id()"
          inputmode="decimal"
          autocomplete="off"
          [attr.aria-invalid]="error()"
          placeholder="0,00"
        />
        <button class="btn ghost" type="submit">
          {{ 'loans.scenario.calculate' | transloco }}
        </button>
      </div>
      @if (error()) {
        <p class="field-error" role="alert">{{ 'forms.amountInvalid' | transloco }}</p>
      }
    </form>
  `,
  styles: `
    .scroll {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    th,
    td {
      text-align: right;
      padding: 7px 4px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }
    th:first-child {
      text-align: left;
    }
    thead th {
      color: var(--muted);
      font-weight: 500;
    }
    tbody th {
      font-weight: 600;
    }
    .note {
      display: block;
      font-size: 0.74rem;
      color: var(--muted);
      font-weight: 400;
    }
    tr.custom {
      background: var(--pine-soft);
    }
    .own {
      margin-top: 12px;
    }
    .row {
      display: flex;
      gap: 8px;
    }
    .row .btn {
      flex: none;
    }
  `,
})
export class ScenarioTable {
  readonly loan = input.required<PlanLoan>();
  readonly name = input.required<string>();
  readonly month = input.required<YearMonth>();

  protected readonly custom = signal<Scenario | null>(null);
  protected readonly error = signal(false);
  protected readonly id = computed(() => this.loan().id);
  protected readonly hasDeadline = computed(
    () => this.loan().kind === 'deadline' || this.loan().targetMonth !== null,
  );
  protected readonly rows = computed(() => {
    const base = suggestedScenarios(this.loan(), this.month());
    const own = this.custom();
    if (!own) return base;
    return [...base.filter((s) => s.monthlyCents !== own.monthlyCents), own].sort(
      (a, b) => a.monthlyCents - b.monthlyCents,
    );
  });

  protected try(value: string) {
    const cents = parseEuroToCents(value);
    this.error.set(cents === null || cents <= 0);
    if (cents !== null && cents > 0) this.custom.set(scenarioFor(this.loan(), cents, this.month()));
  }
}
