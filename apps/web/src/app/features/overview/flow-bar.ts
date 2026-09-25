import { Component, computed, input } from '@angular/core';
import type { MonthlyBreakdown } from '@financeanchor/shared';
import { TranslocoPipe } from '@jsverse/transloco';
import { MoneyPipe } from '../../core/format/pipes';

interface Segment {
  key: 'fix' | 'res' | 'debt' | 'save' | 'free';
  labelKey: string;
  cents: number;
}

/** „Wohin fließt ein Monat“: Balken und Legende der Aufteilung. */
@Component({
  selector: 'fa-flow-bar',
  imports: [TranslocoPipe, MoneyPipe],
  template: `
    <div class="bar" role="img" [attr.aria-label]="summary()">
      @for (s of segments(); track s.key) {
        <span [class]="'seg-' + s.key" [style.flex-grow]="s.cents / base()"></span>
      }
    </div>
    <ul class="legend">
      @for (s of segments(); track s.key) {
        <li>
          <span class="dot" [class]="'dot seg-' + s.key" aria-hidden="true"></span
          >{{ s.labelKey | transloco }}
          <b>{{ s.cents | money: true }}</b>
        </li>
      }
    </ul>
  `,
  styles: `
    .bar {
      display: flex;
      height: 46px;
      border-radius: 12px;
      overflow: hidden;
      margin: 16px 0 10px;
      background: var(--line);
    }
    .bar span {
      display: block;
      height: 100%;
      transition: flex-grow 0.5s ease;
    }
    .seg-fix {
      background: var(--fix);
    }
    .seg-res {
      background: var(--res);
    }
    .seg-debt {
      background: var(--debt);
    }
    .seg-save {
      background: var(--save);
    }
    .seg-free {
      background: var(--pine);
    }
    .legend {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 16px;
    }
    .legend li {
      display: flex;
      gap: 8px;
      align-items: baseline;
    }
    .legend b {
      margin-left: auto;
      font-weight: 600;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 3px;
      flex: none;
      transform: translateY(1px);
    }
  `,
})
export class FlowBar {
  readonly breakdown = input.required<MonthlyBreakdown>();
  readonly summary = input.required<string>();

  protected readonly segments = computed<Segment[]>(() => {
    const b = this.breakdown();
    return [
      { key: 'fix', labelKey: 'overview.fixed', cents: b.fixedCents },
      { key: 'res', labelKey: 'overview.reserve', cents: b.reserveCents },
      { key: 'debt', labelKey: 'overview.loans', cents: b.loanCents },
      { key: 'save', labelKey: 'overview.saving', cents: b.savingCents },
      { key: 'free', labelKey: 'overview.free', cents: Math.max(0, b.freeCents) },
    ];
  });

  protected readonly base = computed(() => {
    const b = this.breakdown();
    const spent = b.fixedCents + b.reserveCents + b.loanCents + b.savingCents;
    return Math.max(b.incomeCents, spent, 1);
  });
}
