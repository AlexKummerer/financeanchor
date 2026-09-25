import { Component, computed, input, signal } from '@angular/core';
import type { LoanPlan } from '@financeanchor/shared';
import { TranslocoPipe } from '@jsverse/transloco';
import { MoneyPipe, MonthPipe } from '../../core/format/pipes';

const FIRST = 12;

/** Tilgungsplan eines Kredits aus dem gemeinsamen Plan: Zahlung, Zins, Tilgung, Restschuld je Monat. */
@Component({
  selector: 'fa-schedule-table',
  imports: [TranslocoPipe, MoneyPipe, MonthPipe],
  template: `
    @if (rows().length === 0) {
      <p class="empty">{{ 'loans.schedule.empty' | transloco }}</p>
    } @else {
      <div class="scroll">
        <table>
          <caption class="visually-hidden">
            {{
              'loans.schedule.caption' | transloco: { name: name() }
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ 'loans.schedule.month' | transloco }}</th>
              <th scope="col">{{ 'loans.schedule.payment' | transloco }}</th>
              <th scope="col">{{ 'loans.schedule.interest' | transloco }}</th>
              <th scope="col">{{ 'loans.schedule.principal' | transloco }}</th>
              <th scope="col">{{ 'loans.schedule.balance' | transloco }}</th>
            </tr>
          </thead>
          <tbody>
            @for (r of visible(); track r.month) {
              <tr [class.short]="r.shortfall > 0">
                <th scope="row">{{ r.month | faMonth: 'short' }}</th>
                <td>{{ r.paid | money }}</td>
                <td>{{ r.interest | money }}</td>
                <td>{{ r.paid - r.interest | money }}</td>
                <td>{{ r.balance | money }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (rows().length > first) {
        <button
          class="linkbtn"
          type="button"
          (click)="all.set(!all())"
          [attr.aria-expanded]="all()"
        >
          {{
            (all() ? 'loans.schedule.less' : 'loans.schedule.all') | transloco: { n: rows().length }
          }}
        </button>
      }
    }
  `,
  styles: `
    .scroll {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.86rem;
    }
    th,
    td {
      text-align: right;
      padding: 6px 4px;
      border-bottom: 1px solid var(--line);
      white-space: nowrap;
    }
    th:first-child {
      text-align: left;
    }
    thead th {
      color: var(--muted);
      font-weight: 500;
    }
    tbody th {
      font-weight: 500;
    }
    tr.short td {
      color: var(--debt);
    }
  `,
})
export class ScheduleTable {
  readonly plan = input.required<LoanPlan | null>();
  readonly loanId = input.required<string>();
  readonly name = input.required<string>();

  protected readonly first = FIRST;
  protected readonly all = signal(false);
  protected readonly rows = computed(() => {
    const plan = this.plan();
    if (!plan) return [];
    const out: {
      month: string;
      paid: number;
      interest: number;
      balance: number;
      shortfall: number;
    }[] = [];
    for (const m of plan.months) {
      const l = m.loans.find((x) => x.id === this.loanId());
      if (!l || l.balanceBeforeCents <= 0) continue;
      out.push({
        month: m.month,
        paid: l.regularCents + l.deadlineCents + l.extraCents,
        interest: l.interestCents,
        balance: l.balanceAfterCents,
        shortfall: l.shortfallCents,
      });
      if (l.balanceAfterCents === 0) break;
    }
    return out;
  });
  protected readonly visible = computed(() =>
    this.all() ? this.rows() : this.rows().slice(0, FIRST),
  );
}
