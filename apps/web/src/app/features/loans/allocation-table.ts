import { Component, computed, input, signal } from '@angular/core';
import { budgetUsed, type Loan, type LoanPlan } from '@financeanchor/shared';
import { TranslocoPipe } from '@jsverse/transloco';
import { MoneyPipe, MonthPipe } from '../../core/format/pipes';

const FIRST = 12;

/** Wie sich das Budget Monat für Monat auf die Kredite verteilt. */
@Component({
  selector: 'fa-allocation-table',
  imports: [TranslocoPipe, MoneyPipe, MonthPipe],
  template: `
    <div class="scroll" tabindex="0" [attr.aria-label]="'loans.allocation.caption' | transloco">
      <table>
        <caption class="visually-hidden">
          {{
            'loans.allocation.caption' | transloco
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ 'loans.schedule.month' | transloco }}</th>
            @for (l of columns(); track l.id) {
              <th scope="col">{{ l.name }}</th>
            }
            <th scope="col">{{ 'loans.allocation.total' | transloco }}</th>
          </tr>
        </thead>
        <tbody>
          @for (r of visible(); track r.month) {
            <tr>
              <th scope="row">{{ r.month | faMonth: 'short' }}</th>
              @for (c of r.cells; track $index) {
                <td>
                  @if (c === 'booked') {
                    <span class="booked">{{ 'loans.allocation.booked' | transloco }}</span>
                  } @else {
                    {{ c === null ? '–' : (c | money: true) }}
                  }
                </td>
              }
              <td class="total">{{ r.total | money: true }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    @if (rows().length > first) {
      <button class="linkbtn" type="button" (click)="all.set(!all())" [attr.aria-expanded]="all()">
        {{
          (all() ? 'loans.schedule.less' : 'loans.schedule.all') | transloco: { n: rows().length }
        }}
      </button>
    }
  `,
  styles: `
    .scroll {
      overflow-x: auto;
    }
    table {
      border-collapse: collapse;
      font-size: 0.86rem;
      min-width: 100%;
    }
    th,
    td {
      text-align: right;
      padding: 6px 6px;
      border-bottom: 1px solid var(--line);
      white-space: nowrap;
    }
    th:first-child {
      text-align: left;
      position: sticky;
      left: 0;
      background: var(--surface);
    }
    thead th {
      color: var(--muted);
      font-weight: 500;
      max-width: 9rem;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    tbody th {
      font-weight: 500;
    }
    .total {
      font-weight: 600;
    }
    .booked {
      color: var(--pine);
      font-size: 0.8rem;
    }
    .warn-text {
      color: var(--debt);
      margin-top: 8px;
    }
  `,
})
export class AllocationTable {
  readonly plan = input.required<LoanPlan | null>();
  readonly loans = input.required<Loan[]>();
  /** Im ersten Monat schon gebuchte Raten */
  readonly settled = input<ReadonlySet<string>>(new Set());

  protected readonly first = FIRST;
  protected readonly all = signal(false);
  protected readonly columns = computed(() => this.loans().filter((l) => l.balanceCents > 0));
  protected readonly rows = computed(() => {
    const plan = this.plan();
    if (!plan) return [];
    return plan.months.map((m, i) => {
      const cells = this.columns().map((l): number | null | 'booked' => {
        const x = m.loans.find((y) => y.id === l.id);
        if (!x || x.balanceBeforeCents <= 0) return null;
        const paid = budgetUsed(x);
        return i === 0 && paid === 0 && this.settled().has(l.id) ? 'booked' : paid;
      });
      return { month: m.month, cells, total: m.paidCents };
    });
  });
  protected readonly visible = computed(() =>
    this.all() ? this.rows() : this.rows().slice(0, FIRST),
  );
}
