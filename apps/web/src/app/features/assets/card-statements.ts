import { Component, computed, input, signal } from '@angular/core';
import { parseEuroToCents, type Account, type IsoDate } from '@financeanchor/shared';
import { TranslocoPipe } from '@jsverse/transloco';
import { DatePipe, MoneyPipe } from '../../core/format/pipes';

export interface StatementView {
  from: IsoDate;
  to: IsoDate;
  debitDate: IsoDate;
  amountCents: number;
  count: number;
  paid: boolean;
  transactions: { id: string; date: IsoDate; name: string; amountCents: number }[];
}

export interface CardStatementsView {
  cardId: string;
  current: StatementView;
  previous: StatementView;
}

/**
 * Eine Kreditkarte: offener Stand, laufende und letzte Abrechnung mit ihren Buchungen. Trägt man
 * den Betrag der Bankabrechnung ein, zeigt die Differenz, ob eine Buchung fehlt.
 */
@Component({
  selector: 'fa-card-statements',
  imports: [TranslocoPipe, MoneyPipe, DatePipe],
  template: `
    <div class="head">
      <h3>{{ card().name }}</h3>
      <p class="amt" [class.neg]="card().balanceCents < 0">{{ card().balanceCents | money }}</p>
    </div>
    <p class="small muted">
      {{ 'cards.open' | transloco }}
      @if (debitAccountName(); as acc) {
        · {{ 'cards.debitFrom' | transloco: { account: acc } }}
      }
    </p>

    @for (s of statements(); track s.key) {
      <details class="statement" [open]="s.key === 'previous' && !s.st.paid && s.st.count > 0">
        <summary>
          <span class="grow">
            <b>{{ 'cards.' + s.key | transloco }}</b>
            <span class="small muted">
              {{ s.st.from | faDate: 'dayMonth' }}–{{ s.st.to | faDate: 'dayMonth' }}
            </span>
          </span>
          <span class="sum">{{ s.st.amountCents | money }}</span>
        </summary>
        <p class="small muted">
          {{ (s.st.count === 1 ? 'cards.entry' : 'cards.entries') | transloco: { n: s.st.count } }}
          ·
          {{
            (s.st.paid ? 'cards.debited' : 'cards.debitOn')
              | transloco: { date: (s.st.debitDate | faDate) }
          }}
        </p>

        <div class="check">
          <label [for]="'bank-' + card().id + '-' + s.key">{{
            'cards.bankAmount' | transloco
          }}</label>
          <input
            [id]="'bank-' + card().id + '-' + s.key"
            inputmode="decimal"
            autocomplete="off"
            [placeholder]="'cards.bankPlaceholder' | transloco"
            (input)="setBank(s.key, $any($event.target).value)"
          />
          @if (difference(s.key, s.st); as d) {
            <p class="small" [class.ok]="d.cents === 0" [class.neg]="d.cents !== 0" role="status">
              @if (d.cents === 0) {
                {{ 'cards.matches' | transloco }}
              } @else if (d.cents > 0) {
                {{ 'cards.missing' | transloco: { amount: (d.cents | money) } }}
              } @else {
                {{ 'cards.tooMuch' | transloco: { amount: (-d.cents | money) } }}
              }
            </p>
          }
        </div>

        @if (s.st.transactions.length) {
          <ul class="tx small">
            @for (t of s.st.transactions; track t.id) {
              <li>
                <span class="muted">{{ t.date | faDate: 'dayMonth' }}</span>
                <span class="grow">{{ t.name }}</span>
                <span [class.pos]="t.amountCents > 0">{{ t.amountCents | money }}</span>
              </li>
            }
          </ul>
        } @else {
          <p class="small muted">{{ 'cards.noEntries' | transloco }}</p>
        }
      </details>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
    }
    h3 {
      margin: 0;
      font-size: 1rem;
    }
    .amt {
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .statement {
      margin-top: 10px;
      background: var(--bg);
      border-radius: var(--radius-sm);
      padding: 8px 10px;
    }
    summary {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      cursor: pointer;
    }
    .grow {
      flex: 1;
    }
    .sum {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .check {
      margin: 8px 0;
    }
    .tx {
      list-style: none;
      padding: 0;
      margin: 6px 0 0;
      display: grid;
      gap: 4px;
    }
    .tx li {
      display: flex;
      gap: 8px;
      font-variant-numeric: tabular-nums;
    }
    .ok {
      color: var(--pine);
    }
  `,
})
export class CardStatements {
  readonly card = input.required<Account>();
  readonly data = input.required<CardStatementsView>();
  /** Konten, um den Namen des Abbuchungskontos zu zeigen */
  readonly accounts = input<Account[]>([]);

  private readonly bank = signal<Record<string, number | null>>({});

  protected readonly statements = computed(() => [
    { key: 'previous' as const, st: this.data().previous },
    { key: 'current' as const, st: this.data().current },
  ]);
  protected readonly debitAccountName = computed(
    () => this.accounts().find((a) => a.id === this.card().debitAccountId)?.name ?? null,
  );

  protected setBank(key: string, value: string) {
    const cents = value.trim() ? parseEuroToCents(value) : null;
    this.bank.update((b) => ({ ...b, [key]: cents === null ? null : Math.abs(cents) }));
  }

  /** Positiv: laut Bank mehr als gebucht (es fehlt etwas); negativ: mehr gebucht als abgerechnet. */
  protected difference(key: string, st: StatementView): { cents: number } | null {
    const bank = this.bank()[key];
    return bank === null || bank === undefined ? null : { cents: bank - st.amountCents };
  }
}
